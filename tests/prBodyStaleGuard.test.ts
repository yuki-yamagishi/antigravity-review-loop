import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LoopStateMachine } from '../state/loopState.js';
import {
  verifyPrBodyNotStale,
  getLatestCodeCommit,
  getWalkthroughTimestamp,
  getPrBodySyncStatus,
  handlePrBodyStaleStop,
} from '../hooks/prBodyStaleGuard.js';
import { handleStop } from '../hooks/stopHook.js';

describe('PR Body Stale Guard Hook (hooks/prBodyStaleGuard.js)', () => {
  let tempDir: string;
  let testMachine: LoopStateMachine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-stale-test-'));
    const stateFile = path.join(tempDir, 'loop_state.json');
    testMachine = new LoopStateMachine(stateFile);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('allows stop when there is no active open PR', () => {
    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      execFn: vi.fn().mockImplementation(() => {
        throw new Error('No PR');
      }),
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('No open PR detected');
  });

  it('allows stop when open PR exists but no code commits found', () => {
    testMachine.setPrCreated(12);
    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: vi.fn().mockImplementation(() => {
        throw new Error('No commit');
      }),
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('No recent code commits');
  });

  it('blocks stop when code commit exists but walkthrough.md is missing', () => {
    testMachine.setPrCreated(12);

    // Mock code directory and commit
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('git log -1 --format=%ct:%H')) {
        return '1700000100:a1b2c3d4e5f6';
      }
      return '';
    });

    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: mockExec,
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('continue');
    expect(result.reason).toContain('walkthrough.md (SSoT) is missing');
  });

  it('blocks stop when latest code commit is newer than walkthrough.md', () => {
    testMachine.setPrCreated(12);

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-012_test');
    fs.mkdirSync(issueDir, { recursive: true });
    const walkthroughPath = path.join(issueDir, 'walkthrough.md');
    fs.writeFileSync(walkthroughPath, '# Walkthrough 12', 'utf8');

    // Code commit at t=1700000500, walkthrough last modified at t=1700000100
    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('git log -1 --format=%ct:%H')) {
        return '1700000500:fedcba987654';
      }
      if (cmd.includes('walkthrough.md')) {
        return '1700000100';
      }
      return '';
    });

    // Mock file stat mtime
    const mockFs = {
      ...fs,
      statSync: vi.fn().mockReturnValue({ mtimeMs: 1700000100 * 1000 }),
    };

    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: mockExec,
      fs: mockFs,
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('continue');
    expect(result.reason).toContain('Stale PR Body detected');
    expect(result.reason).toContain('newer than');
    expect(result.reason).toContain('walkthrough.md');
  });

  it('blocks stop when walkthrough is updated but PR Body is not synchronized with latest commit', () => {
    testMachine.setPrCreated(12);

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-012_test');
    fs.mkdirSync(issueDir, { recursive: true });
    const walkthroughPath = path.join(issueDir, 'walkthrough.md');
    fs.writeFileSync(walkthroughPath, '# Walkthrough 12', 'utf8');

    // Create an old PR body file
    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'pr_body.md'),
      '<!-- SYNCED_COMMIT: oldcommit111 -->\n## 主な変更点\nold',
      'utf8'
    );

    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('git log -1 --format=%ct:%H')) {
        return '1700000500:newcommit999';
      }
      if (cmd.includes('walkthrough.md')) {
        return '1700000550'; // walkthrough is newer
      }
      return '';
    });

    const mockFs = {
      ...fs,
      statSync: (filePath: string) => {
        if (String(filePath).includes('walkthrough.md')) {
          return { mtimeMs: 1700000550 * 1000 };
        }
        if (String(filePath).includes('pr_body.md')) {
          return { mtimeMs: 1700000100 * 1000 }; // older than code commit
        }
        return fs.statSync(filePath);
      },
    };

    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: mockExec,
      fs: mockFs,
      checkRemote: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('continue');
    expect(result.reason).toContain('PR Body has not been synchronized');
    expect(result.reason).toContain('newcomm');
  });

  it('allows stop when walkthrough.md and PR Body are both fully synchronized with latest code commit', () => {
    testMachine.setPrCreated(12);

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-012_test');
    fs.mkdirSync(issueDir, { recursive: true });
    const walkthroughPath = path.join(issueDir, 'walkthrough.md');
    fs.writeFileSync(walkthroughPath, '# Walkthrough 12', 'utf8');

    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'pr_body.md'),
      '<!-- SYNCED_COMMIT: commit999999 -->\n## 主な変更点\nclean',
      'utf8'
    );

    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('git log -1 --format=%ct:%H')) {
        return '1700000500:commit999999';
      }
      if (cmd.includes('walkthrough.md')) {
        return '1700000550';
      }
      return '';
    });

    const mockFs = {
      ...fs,
      statSync: (filePath: string) => {
        if (String(filePath).includes('walkthrough.md')) {
          return { mtimeMs: 1700000550 * 1000 };
        }
        if (String(filePath).includes('pr_body.md')) {
          return { mtimeMs: 1700000560 * 1000 };
        }
        return fs.statSync(filePath);
      },
    };

    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: mockExec,
      fs: mockFs,
      checkRemote: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('up to date with code commit');
  });

  it('resolves walkthrough.md from branch issue number even when prNumber differs from issueNum (e.g. Issue #7 / PR #8)', () => {
    testMachine.setPrCreated(8); // PR #8

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Issue is #7, not #8
    const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-007_argon_opt');
    fs.mkdirSync(issueDir, { recursive: true });
    const walkthroughPath = path.join(issueDir, 'walkthrough.md');
    fs.writeFileSync(walkthroughPath, '# Walkthrough 7', 'utf8');

    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'pr_body.md'),
      '<!-- SYNCED_COMMIT: commit777777 -->\n## 主な変更点\nclean',
      'utf8'
    );

    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('git branch --show-current')) {
        return 'feature/issue-7-argon-medium-loop-optimization';
      }
      if (cmd.includes('git log -1 --format=%ct:%H')) {
        return '1700000500:commit777777';
      }
      if (cmd.includes('walkthrough.md')) {
        return '1700000550';
      }
      return '';
    });

    const mockFs = {
      ...fs,
      statSync: (filePath: string) => {
        if (String(filePath).includes('walkthrough.md')) {
          return { mtimeMs: 1700000550 * 1000 };
        }
        if (String(filePath).includes('pr_body.md')) {
          return { mtimeMs: 1700000560 * 1000 };
        }
        return fs.statSync(filePath);
      },
    };

    const result = verifyPrBodyNotStale({
      projectRoot: tempDir,
      stateMachine: testMachine,
      isOpenPr: true,
      execFn: mockExec,
      fs: mockFs,
      checkRemote: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('PR #8');
  });

  describe('Integration with stopHook (handleStop)', () => {
    it('blocks handleStop with continue if RESOLVED_LGTM is reached but PR Body is stale', () => {
      testMachine.setPrCreated(12);
      testMachine.setReviewResult({ lgtm: true, issues: [] }); // Status is RESOLVED_LGTM!

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-012_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(path.join(issueDir, 'walkthrough.md'), '# Walkthrough', 'utf8');

      // Latest code commit is newer than walkthrough
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('git log -1 --format=%ct:%H')) {
          return '1700000999:commitabc';
        }
        if (cmd.includes('walkthrough.md')) {
          return '1700000100';
        }
        return '';
      });

      const mockFs = {
        ...fs,
        statSync: vi.fn().mockReturnValue({ mtimeMs: 1700000100 * 1000 }),
      };

      const result = handleStop({}, testMachine, {
        projectRoot: tempDir,
        isOpenPr: true,
        execFn: mockExec,
        fs: mockFs,
        checkRemote: false,
      });

      // Even though RESOLVED_LGTM is reached, stop is physically BLOCKED because PR Body is stale!
      expect(result.decision).toBe('continue');
      expect(result.reason).toContain('Stale PR Body detected');
      expect(result.reason).toContain('sync-pr-body.js');
    });

    it('bypasses PR Body stale check when running inside a subagent context', () => {
      testMachine.setPrCreated(12);
      testMachine.setReviewResult({ lgtm: true, issues: [] });

      const result = handleStop({ isSubagent: true }, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('subagent context');
    });
  });
});
