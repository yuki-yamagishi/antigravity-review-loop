/**
 * PR Body Stale Guard Hook (hooks/prBodyStaleGuard.js)
 *
 * Intercepts agent Stop event.
 * Rejects stop with {"decision": "continue", "reason": "..."} if:
 * 1. An open PR exists for the branch.
 * 2. Recent code commits (src/, hooks/, etc.) are newer than walkthrough.md or PR Body.
 *
 * Mechanically forces autonomous agents to synchronize PR Body before completing session.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { findProjectRoot, findIssueDir, readStdinJson, writeStdoutJson } from './hookUtils.js';
import { loadConfig } from '../config/reviewLoopConfig.js';
import { defaultStateMachine } from '../state/loopState.js';
import { resolveWalkthroughPath } from '../scripts/sync-pr-body.js';

export function getLatestCodeCommit(options = {}) {
  const exec = options.execFn || execSync;
  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || process.cwd();
  const config = options.config || loadConfig(projectRoot);

  const codeDirs = Array.isArray(config.codeDirs) ? config.codeDirs : [
    'src', 'frontend/src', 'lib', 'hooks', 'state', 'skills', 'config', 'scripts',
  ];

  // Filter to directories or files that actually exist in the project
  const existingTargets = codeDirs.filter((dir) => {
    try {
      return fsModule.existsSync(path.resolve(projectRoot, dir));
    } catch {
      return false;
    }
  });

  if (existingTargets.length === 0) {
    // If none of the specific code dirs exist, look at git root excluding docs and agents
    try {
      const out = exec('git log -1 --format=%ct:%H -- . ":!docs" ":!.agents"', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (out && out.includes(':')) {
        const [timeStr, hash] = out.split(':');
        return { timestamp: parseInt(timeStr, 10), hash: hash.trim() };
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    const targetsStr = existingTargets.map((t) => `"${t}"`).join(' ');
    const out = exec(`git log -1 --format=%ct:%H -- ${targetsStr}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (out && out.includes(':')) {
      const [timeStr, hash] = out.split(':');
      return { timestamp: parseInt(timeStr, 10), hash: hash.trim() };
    }
  } catch {
    return null;
  }

  return null;
}

export function getWalkthroughTimestamp(walkthroughPath, options = {}) {
  const fsModule = options.fs || fs;
  const exec = options.execFn || execSync;
  const projectRoot = options.projectRoot || process.cwd();

  if (!walkthroughPath || !fsModule.existsSync(walkthroughPath)) {
    return null;
  }

  let fileMtimeSec = 0;
  try {
    const stat = fsModule.statSync(walkthroughPath);
    fileMtimeSec = Math.floor(stat.mtimeMs / 1000);
  } catch {}

  let gitCommitSec = 0;
  try {
    const rel = path.relative(projectRoot, walkthroughPath).replace(/\\/g, '/');
    const out = exec(`git log -1 --format=%ct -- "${rel}"`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (out) gitCommitSec = parseInt(out, 10);
  } catch {}

  return Math.max(fileMtimeSec, gitCommitSec);
}

export function getPrBodySyncStatus(prNumber, options = {}) {
  const fsModule = options.fs || fs;
  const exec = options.execFn || execSync;
  const projectRoot = options.projectRoot || process.cwd();

  const localPrBodyPath = path.resolve(projectRoot, '.agents', 'pr_body.md');
  let localCommitHash = null;
  let localMtimeSec = 0;

  if (fsModule.existsSync(localPrBodyPath)) {
    try {
      const content = fsModule.readFileSync(localPrBodyPath, 'utf8');
      const match = content.match(/<!--\s*SYNCED_COMMIT:\s*([a-f0-9]+)\s*-->/i);
      if (match) localCommitHash = match[1];
      const stat = fsModule.statSync(localPrBodyPath);
      localMtimeSec = Math.floor(stat.mtimeMs / 1000);
    } catch {}
  }

  // Check remote PR body if gh is available
  let remoteSyncedCommit = null;
  let remoteUpdatedAtSec = 0;
  if (options.checkRemote !== false && prNumber) {
    try {
      const prJson = exec(`gh pr view ${prNumber} --json body,updatedAt`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(prJson);
      if (parsed.body) {
        const match = parsed.body.match(/<!--\s*SYNCED_COMMIT:\s*([a-f0-9]+)\s*-->/i);
        if (match) remoteSyncedCommit = match[1];
      }
      if (parsed.updatedAt) {
        remoteUpdatedAtSec = Math.floor(new Date(parsed.updatedAt).getTime() / 1000);
      }
    } catch {}
  }

  return {
    localPrBodyPath,
    localCommitHash,
    localMtimeSec,
    remoteSyncedCommit,
    remoteUpdatedAtSec,
  };
}

/**
 * Checks whether PR Body or walkthrough.md is stale compared to latest code commits.
 */
export function verifyPrBodyNotStale(options = {}) {
  const exec = options.execFn || execSync;
  const fsModule = options.fs || fs;
  const projectRoot = options.projectRoot || process.cwd();
  const stateMachine = options.stateMachine || defaultStateMachine;
  const state = stateMachine.getState();

  // 1. Identify open PR on current branch
  let prNumber = options.prNumber;
  let isOpenPr = false;

  if (options.isOpenPr !== undefined) {
    isOpenPr = Boolean(options.isOpenPr);
    prNumber = prNumber || state.prNumber;
  } else {
    try {
      const out = exec('gh pr view --json number,state', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (out) {
        const parsed = JSON.parse(out);
        if (parsed.state === 'OPEN') {
          prNumber = parsed.number;
          isOpenPr = true;
        }
      }
    } catch {
      // No open PR found on current branch via gh
    }
  }

  // If there is no open PR, no stale PR Body check is needed
  if (!isOpenPr || !prNumber) {
    return {
      allowed: true,
      reason: 'No open PR detected; PR Body freshness check passed.',
    };
  }

  // 2. Retrieve latest code commit
  const latestCode = getLatestCodeCommit({
    ...options,
    projectRoot,
    fs: fsModule,
    execFn: exec,
  });

  if (!latestCode || !latestCode.timestamp) {
    return {
      allowed: true,
      reason: 'No recent code commits found; freshness check passed.',
    };
  }

  // 3. Retrieve walkthrough.md timestamp
  let walkthroughPath = resolveWalkthroughPath({
    ...options,
    projectRoot,
    fs: fsModule,
    issueNum: options.issueNum,
  });

  if (!walkthroughPath && !options.issueNum && prNumber) {
    walkthroughPath = resolveWalkthroughPath({
      ...options,
      projectRoot,
      fs: fsModule,
      issueNum: prNumber,
    });
  }

  if (!walkthroughPath || !fsModule.existsSync(walkthroughPath)) {
    return {
      allowed: false,
      decision: 'continue',
      reason: `[PrBodyStaleGuard] Stale PR Body: walkthrough.md (SSoT) is missing for open PR #${prNumber}. (Remediation Guidance: Create walkthrough.md and run 'node scripts/sync-pr-body.js --update-pr' before stopping.)`,
    };
  }

  const walkthroughTimestamp = getWalkthroughTimestamp(walkthroughPath, {
    ...options,
    projectRoot,
    fs: fsModule,
    execFn: exec,
  });

  const relWalkthrough = path.relative(projectRoot, walkthroughPath).replace(/\\/g, '/');
  const shortCodeHash = latestCode.hash.slice(0, 7);

  // Buffer: allow small 2-second timestamp variance between commit time and disk write
  const TIMESTAMP_TOLERANCE_SEC = 2;

  // Check 1: Code commit is newer than walkthrough.md
  if (latestCode.timestamp > (walkthroughTimestamp + TIMESTAMP_TOLERANCE_SEC)) {
    return {
      allowed: false,
      decision: 'continue',
      reason: `[PrBodyStaleGuard] Stale PR Body detected: Latest code commit (${shortCodeHash}) is newer than ${relWalkthrough} for PR #${prNumber}. (Remediation Guidance: Update ${relWalkthrough} with your latest fixes, then run 'node scripts/sync-pr-body.js --update-pr' before stopping.)`,
    };
  }

  // Check 2: PR Body synchronization status
  const prBodyStatus = getPrBodySyncStatus(prNumber, {
    ...options,
    projectRoot,
    fs: fsModule,
    execFn: exec,
  });

  const isHashSynced =
    (prBodyStatus.localCommitHash && (latestCode.hash.startsWith(prBodyStatus.localCommitHash) || prBodyStatus.localCommitHash.startsWith(latestCode.hash))) ||
    (prBodyStatus.remoteSyncedCommit && (latestCode.hash.startsWith(prBodyStatus.remoteSyncedCommit) || prBodyStatus.remoteSyncedCommit.startsWith(latestCode.hash)));

  const isTimeSynced =
    prBodyStatus.localMtimeSec >= (latestCode.timestamp - TIMESTAMP_TOLERANCE_SEC) ||
    prBodyStatus.remoteUpdatedAtSec >= (latestCode.timestamp - TIMESTAMP_TOLERANCE_SEC);

  if (!isHashSynced && !isTimeSynced) {
    return {
      allowed: false,
      decision: 'continue',
      reason: `[PrBodyStaleGuard] Stale PR Body detected: PR Body has not been synchronized with the latest code commit (${shortCodeHash}) for PR #${prNumber}. (Remediation Guidance: Run 'node scripts/sync-pr-body.js --update-pr' to synchronize PR Body before stopping.)`,
    };
  }

  return {
    allowed: true,
    reason: `PR Body and walkthrough.md are up to date with code commit (${shortCodeHash}) for PR #${prNumber}.`,
  };
}

/**
 * Stop hook handler for PR Body freshness.
 */
export function handlePrBodyStaleStop(payload = {}, options = {}) {
  const check = verifyPrBodyNotStale(options);
  if (!check.allowed) {
    return {
      decision: 'continue',
      reason: check.reason,
    };
  }
  return {
    decision: 'allow',
    reason: check.reason,
  };
}

const isDirectExecution = process.argv[1] &&
  (fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase());

if (isDirectExecution) {
  readStdinJson().then((payload) => {
    const result = handlePrBodyStaleStop(payload);
    writeStdoutJson(result);
    process.exit(0);
  });
}
