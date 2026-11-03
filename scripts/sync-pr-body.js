/**
 * Deterministic PR Body Generator & Synchronizer (scripts/sync-pr-body.js)
 *
 * Single Source of Truth (SSoT): walkthrough.md + Git real diff (git diff --stat origin/main...HEAD)
 *
 * Enforces structural boundary separation:
 * - "## 主な変更点": Output only permanent specification and architectural differences.
 *   Strictly blocks conversation history, justifications, and trial-and-error context.
 * - "## レビュー対応履歴": Mechanically transcribed from walkthrough.md's review response table.
 *   All debate and review fixes are exclusively collected here.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { findProjectRoot, findIssueDir } from '../hooks/hookUtils.js';
import { loadConfig } from '../config/reviewLoopConfig.js';
import { defaultStateMachine } from '../state/loopState.js';

const DISALLOWED_TERMS_DEFAULT = [
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
 * Strips conversation artifacts or warning terms from main changes text
 * to guarantee clean specifications for third-party reviewers.
 */
export function sanitizeMainChanges(text, disallowedTerms = DISALLOWED_TERMS_DEFAULT) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const sanitizedLines = [];
  const escapedTerms = disallowedTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const disallowedRegex = new RegExp(`(?:${escapedTerms.join('|')})`, 'i');

  const fluffRegex = /(?:根本的(?:に|な)|明確(?:に|な)|完全(?:に|な)|確実(?:に|な)|徹底的(?:に|な)|抜本的(?:に|な)|劇的(?:に|な)|飛躍的(?:に|な)|完璧(?:に|な)|美しく|美しい|鉄壁(?:の|に|な)?|堂々と|極めて|非常に|見事に)/g;

  for (const rawLine of lines) {
    const line = rawLine.replace(fluffRegex, '');
    if (disallowedRegex.test(line)) {
      // Clean up trial-and-error phrases, converting them to clean architectural notes or skipping purely conversational lines
      const cleaned = line
        .replace(/勝手に[^\s、。]*[、。]?/g, '')
        .replace(/自作自演[^\s、。]*[、。]?/g, '')
        .replace(/言い訳[^\s、。]*[、。]?/g, '')
        .replace(/やっぱり[^\s、。]*[、。]?/g, '')
        .replace(/(?:レビュー|指摘)(?:事項)?(?:[0-9a-zA-Z\s]*)(?:に基づき|を受けて|により)[、。]?/g, '')
        .replace(/(?:〜|~)?(?:を)?(?:撤回|取りやめ|取り下げ|やめました|戻した)[、。]?/g, '');

      if (cleaned.trim().length > 0 && !disallowedRegex.test(cleaned)) {
        sanitizedLines.push(cleaned);
      }
    } else {
      sanitizedLines.push(line);
    }
  }

  return sanitizedLines.join('\n').trim();
}

/**
 * Parses walkthrough.md into structured sections.
 */
export function parseWalkthrough(content, disallowedTerms = DISALLOWED_TERMS_DEFAULT) {
  if (!content || typeof content !== 'string') {
    return {
      title: '',
      overview: '',
      mainChanges: '',
      reviewHistory: '',
      verification: '',
      raw: '',
    };
  }

  // 1. Title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 2. Overview section (## 概要, ## 1. 概要, ## Overview)
  let overview = '';
  const overviewMatch = content.match(/(?:^|\n)##\s+(?:\d+\.\s*)?(?:概要|Overview)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (overviewMatch) {
    overview = overviewMatch[1].trim();
  }

  // 3. Main Changes section (## 成果物一覧, ## 実施された改修内容, ## 主な変更点, ## 改修内容, ## Changes)
  let mainChanges = '';
  const mainChangesMatch = content.match(/(?:^|\n)##\s+(?:\d+\.\s*)?(?:成果物一覧|実施された改修内容|主な変更点|主な改修内容|改修内容|変更内容|Changes)[^\n]*\n([\s\S]*?)(?=\n##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴|検証結果|Verification)|$)/i);
  if (mainChangesMatch) {
    mainChanges = sanitizeMainChanges(mainChangesMatch[1].trim(), disallowedTerms);
  } else {
    // Fallback: look for section 2 or whatever follows overview
    const genericMatch = content.match(/(?:^|\n)##\s+(?:\d+\.\s*)?[^\n]+\n([\s\S]*?)(?=\n##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴|検証結果|Verification)|$)/i);
    if (genericMatch && genericMatch[1] !== overview) {
      mainChanges = sanitizeMainChanges(genericMatch[1].trim(), disallowedTerms);
    }
  }

  // 4. Review History section (## レビュー対応履歴, ## レビュー指摘対応, ## 指摘対応, ## 修正履歴, ## 対応履歴)
  let reviewHistory = '';
  const reviewMatch = content.match(/(?:^|\n)##\s+(?:\d+\.\s*)?(?:レビュー対応履歴|レビュー指摘対応|指摘対応|修正履歴|対応履歴|Review\s*History)[^\n]*\n([\s\S]*?)(?=\n##\s+(?:\d+\.\s*)?(?:検証結果|Verification)|$)/i);
  if (reviewMatch) {
    reviewHistory = reviewMatch[1].trim();
  }

  // If no review history table exists in walkthrough, provide clean default structure
  if (!reviewHistory) {
    reviewHistory = [
      '| レビュアー | 指摘内容 (Must/Should) | 対応コミット | 対応概要 |',
      '|---|---|---|---|',
      '| - | *初回PR作成（レビュー未受領）* | - | 初回実装完了 |',
    ].join('\n');
  }

  // 5. Verification Results section (## 検証結果, ## 3. 検証結果, ## Verification)
  let verification = '';
  const verificationMatch = content.match(/(?:^|\n)##\s+(?:\d+\.\s*)?(?:検証結果|テスト結果|Verification\s*Results?)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (verificationMatch) {
    verification = verificationMatch[1].trim();
  }

  return {
    title,
    overview,
    mainChanges,
    reviewHistory,
    verification,
    raw: content,
  };
}

/**
 * Retrieves git diff --stat against target base branch.
 */
export function getGitDiffStat(options = {}) {
  const exec = options.execFn || execSync;
  const projectRoot = options.projectRoot || process.cwd();
  const baseBranch = options.baseBranch || 'origin/main';

  const candidates = [
    `git diff --stat ${baseBranch}...HEAD`,
    'git diff --stat main...HEAD',
    'git diff --stat HEAD~1...HEAD',
    'git diff --stat HEAD~1',
    'git diff --stat',
  ];

  for (const cmd of candidates) {
    try {
      const out = exec(cmd, { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (out) return out;
    } catch {
      // Try next candidate
    }
  }

  return 'No git diff statistics available.';
}

/**
 * Retrieves current HEAD commit hash.
 */
export function getHeadCommitHash(options = {}) {
  const exec = options.execFn || execSync;
  const projectRoot = options.projectRoot || process.cwd();
  try {
    return exec('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '0000000000000000000000000000000000000000';
  }
}

/**
 * Finds target issue walkthrough path.
 */
export function resolveWalkthroughPath(options = {}) {
  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || process.cwd();
  const config = options.config || loadConfig(projectRoot);
  const issuesDir = path.resolve(projectRoot, config.issuesDir || 'docs/issues');

  if (options.walkthroughPath) {
    const customPath = path.resolve(projectRoot, options.walkthroughPath);
    if (fsModule.existsSync(customPath)) {
      return customPath;
    }
  }

  // Detect issue number
  let issueNum = options.issueNum;
  if (!issueNum) {
    const exec = options.execFn || execSync;
    let branch = '';
    try {
      branch = exec('git branch --show-current', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {}

    const patternStr = config.branchIssuePattern || '(?:issue[/-]|issue-|#|feat/|feature/|fix/)(\\d+)';
    const match = branch.match(new RegExp(patternStr, 'i')) || branch.match(/issue-(\d+)/i) || branch.match(/(\d+)/);
    if (match) {
      issueNum = parseInt(match[1], 10);
    }
  }

  if (issueNum) {
    const issueDirName = findIssueDir(issuesDir, issueNum);
    if (issueDirName) {
      const targetWalkthrough = path.resolve(issuesDir, issueDirName, 'walkthrough.md');
      if (fsModule.existsSync(targetWalkthrough)) {
        return targetWalkthrough;
      }
    }
  }

  // Fallbacks: root pointers
  const rootCandidates = [
    path.resolve(projectRoot, 'docs/walkthrough.md'),
    path.resolve(projectRoot, 'walkthrough.md'),
  ];
  for (const cand of rootCandidates) {
    if (fsModule.existsSync(cand)) {
      return cand;
    }
  }

  return null;
}

/**
 * Deterministically generates PR Body from SSoT (walkthrough.md + git diff).
 */
export function generatePrBody(options = {}) {
  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || process.cwd();
  const config = options.config || loadConfig(projectRoot);
  const disallowedTerms = config.disallowedPrBodyTerms || DISALLOWED_TERMS_DEFAULT;

  const walkthroughPath = resolveWalkthroughPath(options);
  if (!walkthroughPath || !fsModule.existsSync(walkthroughPath)) {
    throw new Error(
      `[sync-pr-body] walkthrough.md (SSoT) could not be found. Please create or verify walkthrough.md before generating PR Body.`
    );
  }

  const walkthroughContent = fsModule.readFileSync(walkthroughPath, 'utf8');
  const parsed = parseWalkthrough(walkthroughContent, disallowedTerms);
  const diffStat = options.diffStat !== undefined ? options.diffStat : getGitDiffStat(options);
  const commitHash = options.commitHash || getHeadCommitHash(options);
  const relWalkthrough = path.relative(projectRoot, walkthroughPath).replace(/\\/g, '/');

  // Determine issue number
  let issueNum = options.issueNum;
  if (!issueNum) {
    const issueMatch = walkthroughPath.match(/ISSUE-(\d+)/i) || walkthroughContent.match(/Issue\s*#?(\d+)/i);
    if (issueMatch) {
      issueNum = parseInt(issueMatch[1], 10);
    }
  }

  const lines = [
    `<!-- AUTO-GENERATED PR BODY BY antigravity-review-loop -->`,
    `<!-- SSOT: ${relWalkthrough} -->`,
    `<!-- SYNCED_COMMIT: ${commitHash} -->`,
    `<!-- GENERATED_AT: ${new Date().toISOString()} -->`,
    '',
    `## 概要`,
  ];

  if (issueNum) {
    lines.push(`Closes #${issueNum}`, '');
  }

  if (parsed.overview) {
    lines.push(parsed.overview, '');
  } else {
    lines.push(parsed.title || '本 PR は課題の実装・改修成果を反映したものです。', '');
  }

  lines.push(`## 主な変更点`, parsed.mainChanges || '（恒久的な仕様変更点はありません）', '');
  lines.push(`## レビュー対応履歴`, parsed.reviewHistory, '');
  lines.push(`## 変更ファイル一覧 (git diff --stat)`, '```', diffStat, '```', '');

  if (parsed.verification) {
    lines.push(`## 検証結果`, parsed.verification, '');
  }

  const prBody = lines.join('\n');

  return {
    prBody,
    commitHash,
    issueNum,
    walkthroughPath,
    relWalkthrough,
    parsed,
  };
}

/**
 * Writes deterministic PR Body to disk and optionally synchronizes with GitHub PR.
 */
export function syncPrBody(options = {}) {
  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || process.cwd();
  const exec = options.execFn || execSync;

  const generated = generatePrBody(options);
  const defaultOutputDir = path.resolve(projectRoot, '.agents');
  const defaultOutputPath = path.resolve(defaultOutputDir, 'pr_body.md');
  const outputPath = options.outputPath ? path.resolve(projectRoot, options.outputPath) : defaultOutputPath;

  const outputDir = path.dirname(outputPath);
  if (!fsModule.existsSync(outputDir)) {
    fsModule.mkdirSync(outputDir, { recursive: true });
  }

  fsModule.writeFileSync(outputPath, generated.prBody, 'utf8');

  let updatedPr = false;
  if (options.updatePr) {
    let prNum = options.prNumber;
    if (!prNum) {
      const stateMachine = options.stateMachine || defaultStateMachine;
      const state = stateMachine.getState();
      prNum = state.prNumber;
    }

    if (!prNum) {
      try {
        const viewOut = exec('gh pr view --json number --jq .number', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        prNum = parseInt(viewOut, 10);
      } catch {}
    }

    if (prNum && !isNaN(prNum)) {
      try {
        exec(`gh pr edit ${prNum} --body-file "${outputPath}"`, { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        updatedPr = true;
      } catch (err) {
        throw new Error(`Failed to update GitHub PR #${prNum} with new body: ${err.message}`);
      }
    }
  }

  return {
    success: true,
    outputPath,
    prBody: generated.prBody,
    commitHash: generated.commitHash,
    issueNum: generated.issueNum,
    walkthroughPath: generated.walkthroughPath,
    updatedPr,
  };
}

// CLI runner
const isDirectExecution = process.argv[1] &&
  (fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase() ||
   process.argv[1].toLowerCase().endsWith('sync-pr-body.js'));

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const options = {
    updatePr: args.includes('--update-pr'),
    stdout: args.includes('--stdout'),
    dryRun: args.includes('--dry-run'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--issue' && args[i + 1]) options.issueNum = parseInt(args[++i], 10);
    if (args[i] === '--walkthrough' && args[i + 1]) options.walkthroughPath = args[++i];
    if (args[i] === '--output' && args[i + 1]) options.outputPath = args[++i];
    if (args[i] === '--base' && args[i + 1]) options.baseBranch = args[++i];
  }

  try {
    if (options.dryRun || options.stdout) {
      const result = generatePrBody(options);
      console.log(result.prBody);
    } else {
      const result = syncPrBody(options);
      console.log(`[OK] Successfully synchronized PR Body from SSoT (${result.walkthroughPath}) -> ${result.outputPath}`);
      if (result.updatedPr) {
        console.log(`[OK] Updated GitHub PR Body with clean synchronized content.`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(`[BLOCKED] ${err.message}`);
    process.exit(1);
  }
}
