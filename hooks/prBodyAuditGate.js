/**
 * PR Body Audit Gate Hook (hooks/prBodyAuditGate.js)
 *
 * PreToolUse hook for run_command intercepting `gh pr create` and `gh pr edit`.
 *
 * Enforces strict boundary separation on PR Body:
 * 1. Checks that "## 主な変更点" does not contain conversation artifacts or justification terms
 *    (e.g., '撤回', '勝手に', '指摘され', '自作自演', etc.).
 * 2. If disallowed terms are detected:
 *    - In deny mode (default): Rejects execution with {"decision": "deny", "reason": "..."}.
 *    - In overwrite mode (config.autoOverwritePrBody: true): Automatically generates a clean
 *      body via sync-pr-body.js and rewrites tool arguments with {"decision": "allow", "overwrite": {...}}.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { findProjectRoot, readStdinJson, writeStdoutJson } from './hookUtils.js';
import { loadConfig } from '../config/reviewLoopConfig.js';
import { syncPrBody } from '../scripts/sync-pr-body.js';

const DEFAULT_DISALLOWED_TERMS = [
  '撤回',
  '取りやめ',
  '取り下げ',
  '勝手に',
  '指摘され',
  '指摘を受け',
  '指摘により',
  '自作自演',
  '言い訳',
  'やっぱり',
  '戻した',
  'やめました',
];

/**
 * Parses and extracts PR Body content and argument metadata from commandLine.
 */
export function extractPrBodyFromCommand(commandLine, projectRoot = process.cwd(), fsModule = fs) {
  if (!commandLine || typeof commandLine !== 'string') return null;

  // 1. Check for --body-file / -F
  const bodyFileMatch = commandLine.match(/(?:--body-file|-F)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (bodyFileMatch) {
    const rawPath = bodyFileMatch[1] || bodyFileMatch[2] || bodyFileMatch[3];
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
    let content = '';
    try {
      if (fsModule.existsSync(resolvedPath)) {
        content = fsModule.readFileSync(resolvedPath, 'utf8');
      }
    } catch {}

    return {
      type: 'body-file',
      rawPath,
      resolvedPath,
      content,
      rawMatch: bodyFileMatch[0],
    };
  }

  // 2. Check for --body / -b
  const bodyMatch = commandLine.match(/(?:--body|-b)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/i);
  if (bodyMatch) {
    const content = bodyMatch[1] !== undefined ? bodyMatch[1] : (bodyMatch[2] !== undefined ? bodyMatch[2] : bodyMatch[3]);
    return {
      type: 'body',
      content: content || '',
      rawMatch: bodyMatch[0],
    };
  }

  return null;
}

/**
 * Extracts "## 主な変更点" and "## レビュー対応履歴" sections from PR Body.
 */
export function extractPrBodySections(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { mainChanges: '', reviewHistory: '', other: '' };
  }

  let mainChanges = '';
  const mainMatch = bodyText.match(/##\s+(?:\d+\.\s*)?(?:主な変更点|主な改修内容|成果物一覧|実施された改修内容|変更内容|Changes)[^\n]*\n([\s\S]*?)(?=\n##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴|変更ファイル一覧|検証結果)|$)/i);
  if (mainMatch) {
    mainChanges = mainMatch[1];
  }

  let reviewHistory = '';
  const reviewMatch = bodyText.match(/##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (reviewMatch) {
    reviewHistory = reviewMatch[1];
  }

  // Text outside review history
  const nonReviewText = bodyText.replace(/##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴)[^\n]*\n[\s\S]*?(?=\n##\s|$)/i, '');

  return {
    mainChanges,
    reviewHistory,
    nonReviewText,
  };
}

/**
 * Checks if target section contains any disallowed conversation terms.
 */
export function findDisallowedTerms(text, terms = DEFAULT_DISALLOWED_TERMS) {
  if (!text) return [];
  const found = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(escaped, 'i').test(text)) {
      found.push(term);
    }
  }
  return found;
}

/**
 * PreToolUse Hook Handler for PR Body Audit.
 */
export function handlePrBodyAuditGate(payload = {}, options = {}) {
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};
  const commandLine = args.CommandLine || '';

  if (toolName !== 'run_command' || !commandLine) {
    return { decision: 'allow' };
  }

  const trimmed = commandLine.trim();
  if (!/\bgh\s+pr\s+(?:create|edit)\b/i.test(trimmed)) {
    return { decision: 'allow' };
  }

  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
  const config = options.config || loadConfig(projectRoot);
  const disallowedTerms = config.disallowedPrBodyTerms || DEFAULT_DISALLOWED_TERMS;
  const isAutoOverwrite = options.autoOverwrite !== undefined ? Boolean(options.autoOverwrite) : Boolean(config.autoOverwritePrBody);

  const prBodyInfo = extractPrBodyFromCommand(trimmed, projectRoot, fsModule);
  if (!prBodyInfo || !prBodyInfo.content) {
    // If no body flags are provided, let command proceed or be caught by other validators
    return { decision: 'allow' };
  }

  const sections = extractPrBodySections(prBodyInfo.content);
  // Check main changes section first; if not explicitly split, check non-review text
  const targetCheckText = sections.mainChanges || sections.nonReviewText;
  const detectedViolations = findDisallowedTerms(targetCheckText, disallowedTerms);

  if (detectedViolations.length > 0) {
    const violationList = detectedViolations.join(', ');

    // Overwrite mode: Automatically replace with deterministic clean PR Body via sync-pr-body.js
    if (isAutoOverwrite) {
      try {
        const syncFn = options.syncPrBodyFn || syncPrBody;
        const syncResult = syncFn({
          projectRoot,
          fs: fsModule,
          ...options,
        });

        const cleanBodyRelPath = path.relative(projectRoot, syncResult.outputPath).replace(/\\/g, '/');

        // Rewrite CommandLine: Replace existing --body / --body-file with new --body-file
        let newCommandLine = trimmed;
        if (prBodyInfo.type === 'body-file') {
          newCommandLine = trimmed.replace(
            prBodyInfo.rawMatch,
            `--body-file "${cleanBodyRelPath}"`
          );
        } else {
          newCommandLine = trimmed.replace(
            prBodyInfo.rawMatch,
            `--body-file "${cleanBodyRelPath}"`
          );
        }

        return {
          decision: 'allow',
          overwrite: {
            CommandLine: newCommandLine,
          },
          reason: `[PrBodyAuditGate] Conversation context / patchwork wording (${violationList}) detected in PR Body. Automatically replaced with clean body generated from walkthrough.md (${cleanBodyRelPath}).`,
        };
      } catch (err) {
        return {
          decision: 'deny',
          reason: `[PrBodyAuditGate Denied] Patchwork/conversation context term(s) [${violationList}] detected in "## 主な変更点". Automatic overwrite failed: ${err.message}.`,
        };
      }
    }

    // Deny mode (default): Reject command execution
    return {
      decision: 'deny',
      reason: `[PrBodyAuditGate Denied] Patchwork/conversation context term(s) [${violationList}] detected in "## 主な変更点". Trial-and-error context and debate belong exclusively in "## レビュー対応履歴". (Remediation Guidance: Clean up "## 主な変更点" in walkthrough.md and run 'node scripts/sync-pr-body.js' to generate a clean PR body.)`,
    };
  }

  return { decision: 'allow' };
}

const isDirectExecution = process.argv[1] &&
  (fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase());

if (isDirectExecution) {
  readStdinJson().then((payload) => {
    const result = handlePrBodyAuditGate(payload);
    writeStdoutJson(result);
    process.exit(0);
  });
}
