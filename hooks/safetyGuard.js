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
 * Non-interactive flags are only honoured when forwarded to the script after '--'
 * (before '--', npm interprets them as its own config and the runner never sees them).
 */
function verifyNonInteractiveTestExecution(commandLine, config = {}) {
  const allowedCommands = Array.isArray(config.allowedTestCommands) ? config.allowedTestCommands : [];
  if (allowedCommands.some((allowed) => typeof allowed === 'string' && commandLine.trim() === allowed.trim())) {
    return { decision: 'allow' };
  }

  if (/\bnpm(?:\.cmd)?\s+(?:run\s+)?test\b/i.test(commandLine)) {
    const hasForwardedFlag = /\s--\s+(?:\S+\s+)*--(?:run|watch=false|no-watch|watchAll=false|ci)(?=\s|$)/i.test(commandLine);
    const hasNonInteractiveScript = /\bnpm(?:\.cmd)?\s+run\s+test:(?:run|coverage|fast|related)\b/i.test(commandLine);

    if (hasForwardedFlag || hasNonInteractiveScript) {
      return { decision: 'allow' };
    }

    return {
      decision: 'deny',
      reason: "[SafetyGuard Denied] Interactive test runner detected. Forward a non-interactive flag after '--' (e.g. 'npm test -- --run', 'npm test -- --watch=false'), use a dedicated script such as 'npm run test:run', or declare the exact command in 'allowedTestCommands' of review-loop.config.json.",
    };
  }

  return { decision: 'allow' };
}

const CONFIG_NAME_PATTERN = /(?:^|[\\/\s"'])(?:\.agents[\\/])?(?:review-loop\.config\.json|\.review-loop\.json)\b/i;
const WRITE_INDICATOR = />|\b(?:Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|sc|ac|ri|clc|ni|mi|cpi|rni|touch|tee|sed|mv|cp|rm|del|ren|truncate|git\s+(?:checkout|restore|stash|reset|clean))\b/i;

/**
 * Prevents the agent from loosening guard policy by editing the review-loop config.
 * Config changes must be made by the human user.
 */
function verifyConfigNotTampered(toolName, args, commandLine) {
  const denyResult = {
    decision: 'deny',
    reason: "[SafetyGuard Denied] Modifying review-loop.config.json is prohibited for autonomous agents because it controls safety guards and DoR gates. Ask the user to change it.",
  };
  if (toolName === 'write_to_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
    const target = String(args.TargetFile || '');
    if (CONFIG_NAME_PATTERN.test(` ${target}`)) return denyResult;
    return { decision: 'allow' };
  }
  if (toolName === 'run_command' && CONFIG_NAME_PATTERN.test(commandLine) && WRITE_INDICATOR.test(commandLine)) {
    return denyResult;
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

  // Prohibit modifying review-loop configuration via file write tools
  if (toolName === 'write_to_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
    return verifyConfigNotTampered(toolName, args, '');
  }

  if (toolName !== 'run_command' || !commandLine) {
    return { decision: 'allow' };
  }

  const trimmed = commandLine.trim();
  const currentScriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = options.projectRoot !== undefined ? options.projectRoot : findProjectRoot(currentScriptDir);
  const config = options.config || (projectRoot ? loadConfig(projectRoot) : {});

  // Safety verification pipeline
  const checks = [
    () => verifyConfigNotTampered(toolName, args, trimmed),
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
