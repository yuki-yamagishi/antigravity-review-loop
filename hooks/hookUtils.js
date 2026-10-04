/**
 * Hook Utilities (hooks/hookUtils.js)
 * Helper functions for stdin/stdout JSON protocol and workspace path resolution in Antigravity lifecycle hooks.
 */

import fs from 'fs';
import path from 'path';

export async function readStdinJson(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let raw = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({});
      }
    }, timeoutMs);
    if (timer.unref) timer.unref();

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });

    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try {
          const trimmed = raw.trim();
          resolve(trimmed ? JSON.parse(trimmed) : {});
        } catch {
          resolve({});
        }
      }
    });

    process.stdin.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({});
      }
    });
  });
}

export function writeStdoutJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Searches upward from startDir to find the plugin root directory
 * identified by plugin.json.
 */
export function findPluginRoot(startDir) {
  let cur = path.resolve(startDir);
  while (cur && path.dirname(cur) !== cur) {
    if (fs.existsSync(path.join(cur, 'plugin.json'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return path.resolve(startDir, '..');
}

/**
 * Searches upward from startDir to find the host project root directory
 * identified by .git directory and/or package.json.
 */
export function findProjectRoot(startDir) {
  let cur = path.resolve(startDir);
  while (cur && path.dirname(cur) !== cur) {
    if (path.basename(cur) === '.agents' || cur.split(path.sep).includes('.agents')) {
      cur = path.dirname(cur);
      continue;
    }
    if (fs.existsSync(path.join(cur, '.git')) || fs.existsSync(path.join(cur, 'package.json'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return path.resolve(startDir, '../../../..');
}

/**
 * Resolves the issue directory (e.g. ISSUE-005_slug) under issuesDir for a given issue number.
 */
export function findIssueDir(issuesDir, issueNum) {
  if (!issuesDir || !fs.existsSync(issuesDir) || !issueNum) return null;
  try {
    const entries = fs.readdirSync(issuesDir);
    const prefixPadded = `ISSUE-${String(issueNum).padStart(3, '0')}`;
    const prefixRaw = `ISSUE-${issueNum}`;
    return entries.find((e) => e.startsWith(prefixPadded) || e.startsWith(prefixRaw)) || null;
  } catch {
    return null;
  }
}
