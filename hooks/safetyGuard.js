/**
 * Safety Guard Hook (.agents/hooks/safetyGuard.js)
 * 
 * Enforces execution safety:
 * 1. Prohibits direct gh pr merge by the agent (merging is exclusively performed by human).
 * 2. Prohibits interactive watch tests.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readStdinJson, writeStdoutJson } from './hookUtils.js';

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
function verifyNonInteractiveTestExecution(commandLine) {
  if (/\bnpm(?:\.cmd)?\s+(?:run\s+)?test\b/i.test(commandLine) && 
      !/--run\b/i.test(commandLine) && 
      !/\btest:(?:run|coverage|fast|related)\b/i.test(commandLine)) {
    return {
      decision: 'deny',
      reason: "[SafetyGuard Denied] Interactive test runner detected. Use 'npm run test:fast', 'npm run test:related', or 'npm run test:run' for deterministic execution.",
    };
  }
  return { decision: 'allow' };
}

export function handleSafetyGuard(payload = {}) {
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};
  const commandLine = args.CommandLine || '';

  if (toolName !== 'run_command' || !commandLine) {
    return { decision: 'allow' };
  }

  const trimmed = commandLine.trim();

  // Safety verification pipeline
  const checks = [
    () => verifyGhPrMergeProhibited(trimmed),
    () => verifyNonInteractiveTestExecution(trimmed),
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
