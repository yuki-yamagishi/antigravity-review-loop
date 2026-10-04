/**
 * Safety Guard Hook (hooks/safetyGuard.js)
 * 
 * Enforces execution safety:
 * 1. Prohibits direct gh pr merge by the agent (merging is exclusively performed by human).
 * 2. Prohibits interactive watch tests.
 * 3. Prohibits network commands (curl, Invoke-WebRequest, Invoke-RestMethod, iwr, irm)
 *    without explicit positive timeout to prevent process hangs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readStdinJson, writeStdoutJson, findProjectRoot } from './hookUtils.js';
import { loadConfig } from '../config/reviewLoopConfig.js';

/**
 * Validates that gh pr merge is not executed directly by autonomous agents.
 */
function verifyGhPrMergeProhibited(commandLine) {
  if (/\bgh\s+pr\s+merge\b/i.test(commandLine)) {
    return {
      decision: 'deny',
      reason: "[SafetyGuard Denied] Direct execution of 'gh pr merge' by the autonomous agent is strictly prohibited. Merging to main is exclusively performed by the user (human). Please request the user to review and merge the PR.",
    };
  }
  return { decision: 'allow' };
}

/**
 * Validates that interactive watch tests causing process hang are not executed.
 */
function verifyNonInteractiveTestExecution(commandLine, config = {}) {
  // Check if explicitly allowed in config (allowedTestCommands)
  const allowedCommands = config.allowedTestCommands || [];
  if (Array.isArray(allowedCommands)) {
    for (const allowed of allowedCommands) {
      if (typeof allowed === 'string' && commandLine.trim() === allowed.trim()) {
        return { decision: 'allow' };
      }
      if (allowed instanceof RegExp && allowed.test(commandLine)) {
        return { decision: 'allow' };
      }
    }
  }

  // Detect npm test invocations
  if (/\bnpm(?:\.cmd)?\s+(?:run\s+)?test\b/i.test(commandLine)) {
    // 1. Check for standard npm argument-separated non-interactive flags (npm test -- --run / --watch=false)
    const hasForwardedFlag = /--\s+.*(?:--run\b|--watch=false|--no-watch|--ci\b)/i.test(commandLine);

    // 2. Check for direct non-interactive flags (supported by vitest, etc.)
    const hasDirectFlag = /--run\b/i.test(commandLine) || 
      /(?:--watch=false|--no-watch|--watchAll=false|--ci\b)/i.test(commandLine);

    // 3. Check for dedicated non-interactive scripts
    const hasNonInteractiveScript = /\btest:(?:run|coverage|fast|related)\b/i.test(commandLine);

    if (hasForwardedFlag || hasDirectFlag || hasNonInteractiveScript) {
      return { decision: 'allow' };
    }

    return {
      decision: 'deny',
      reason: "[SafetyGuard Denied] Interactive test runner detected. Specify a non-interactive flag (e.g. 'npm test -- --run', 'npm test -- --watch=false') or configure 'allowedTestCommands' in 'review-loop.config.json' for deterministic execution.",
    };
  }

  return { decision: 'allow' };
}

/**
 * Validates that network command 'curl' is executed with an explicit timeout.
 */
function verifyCurlTimeoutSpecified(commandLine) {
  // Only match when curl or curl.exe is invoked as the command (not as an argument to git, echo, etc.)
  if (/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+)?curl(?:\.exe)?\b/i.test(commandLine)) {
    const hasTimeout = /(?:(?:^|\s)-m\s*\d+(?:\.\d+)?|(?:^|\s)(?:--max-time|--connect-timeout)(?:=|\s+)\d+(?:\.\d+)?)/i.test(commandLine);
    if (!hasTimeout) {
      return {
        decision: 'deny',
        reason: "[SafetyGuard Denied] Network command 'curl' executed without timeout. Specify a timeout using '--max-time <seconds>' or '-m <seconds>' (e.g. 'curl --max-time 10 ...') to prevent process hangs.",
      };
    }
  }
  return { decision: 'allow' };
}

/**
 * Validates that PowerShell network commands (Invoke-WebRequest, Invoke-RestMethod, iwr, irm)
 * are executed with an explicit positive timeout (-TimeoutSec > 0).
 */
function verifyPowerShellWebTimeoutSpecified(commandLine) {
  // Pattern 1: Direct invocation (including env prefix, sudo, and variable assignment like $res = ...)
  const isDirectWebCmd = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+)?(?:\$[A-Za-z0-9_]+\s*=\s*)?(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(commandLine);

  // Pattern 2: Invocation via powershell/pwsh wrapper (e.g. powershell -Command "..." or pwsh -c "...")
  const isWrapper = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+)?(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(commandLine);
  const wrapperHasWebCmd = isWrapper && /(?:^|[;"'\s]|\$[A-Za-z0-9_]+\s*=\s*)(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(commandLine);

  if (isDirectWebCmd || wrapperHasWebCmd) {
    const timeoutMatch = commandLine.match(/(?:^|\s)-TimeoutSec(?::|=|\s+)(\d+(?:\.\d+)?)/i);
    if (!timeoutMatch) {
      return {
        decision: 'deny',
        reason: "[SafetyGuard Denied] Network command 'Invoke-WebRequest' / 'Invoke-RestMethod' (or alias 'iwr' / 'irm') executed without timeout. Specify a timeout using '-TimeoutSec <seconds>' (e.g. 'Invoke-WebRequest -TimeoutSec 10 ...') to prevent process hangs.",
      };
    }

    const timeoutVal = parseFloat(timeoutMatch[1]);
    if (isNaN(timeoutVal) || timeoutVal <= 0) {
      return {
        decision: 'deny',
        reason: "[SafetyGuard Denied] Network command 'Invoke-WebRequest' / 'Invoke-RestMethod' (or alias 'iwr' / 'irm') executed with invalid timeout ('-TimeoutSec 0' indicates indefinite wait). Specify a positive timeout of at least 1 second using '-TimeoutSec <seconds>' to prevent process hangs.",
      };
    }
  }

  return { decision: 'allow' };
}

export function handleSafetyGuard(payload = {}, options = {}) {
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};
  const commandLine = args.CommandLine || '';

  if (toolName !== 'run_command' || !commandLine) {
    return { decision: 'allow' };
  }

  const trimmed = commandLine.trim();
  const currentScriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = options.projectRoot !== undefined ? options.projectRoot : findProjectRoot(currentScriptDir);
  const config = options.config || (projectRoot ? loadConfig(projectRoot) : {});

  // Safety verification pipeline
  const checks = [
    () => verifyGhPrMergeProhibited(trimmed),
    () => verifyNonInteractiveTestExecution(trimmed, config),
    () => verifyCurlTimeoutSpecified(trimmed),
    () => verifyPowerShellWebTimeoutSpecified(trimmed),
  ];

  for (const check of checks) {
    const result = check();
    if (result.decision === 'deny') {
      return result;
    }
  }

  return { decision: 'allow' };
}

const isDirectExecution = process.argv[1] && 
  (fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase());

if (isDirectExecution) {
  readStdinJson().then((payload) => {
    const result = handleSafetyGuard(payload);
    writeStdoutJson(result);
    process.exit(0);
  });
}
