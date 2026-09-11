import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { LoopStateMachine, STATUS } from '../state/loopState.js';
import { handleStop } from '../hooks/stopHook.js';
import { handleSafetyGuard } from '../hooks/safetyGuard.js';
import { handleBranchDoRGate } from '../hooks/branchDoRGate.js';
import { handlePrePrAuditGate } from '../hooks/prePrAuditGate.js';
import { handlePostPrCreate } from '../hooks/postPrCreate.js';

describe('Lifecycle Hooks (antigravity-review-loop/hooks/)', () => {
  let tempDir: string;
  let testStateFile: string;
  let testMachine: LoopStateMachine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
    testStateFile = path.join(tempDir, 'loop_state.json');
    testMachine = new LoopStateMachine(testStateFile);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignored
    }
  });

  describe('stopHook (antigravity-review-loop/hooks/stopHook.js)', () => {
    it('allows stop when status is IDLE', () => {
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('IDLE');
    });

    it('rejects stop with continue when status is PR_CREATED', () => {
      testMachine.setPrCreated(46);
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('continue');
      expect(result.reason).toContain('Stop rejected');
      expect(result.reason).toContain('PR_CREATED');
      expect(result.reason).toContain('loopState.js reset');
    });

    it('rejects stop with continue when status is REVIEW_REQUESTED', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewRequested();
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('continue');
      expect(result.reason).toContain('REVIEW_REQUESTED');
      expect(result.reason).toContain('loopState.js reset');
    });

    it('rejects stop with continue when status is NEEDS_FIX', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewResult({
        lgtm: false,
        issues: [
          { id: '1', type: 'must', description: 'Fix blocker', resolved: false },
        ],
      });
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('continue');
      expect(result.reason).toContain('NEEDS_FIX');
      expect(result.reason).toContain('loopState.js reset');
    });

    it('allows stop when status is RESOLVED_LGTM', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewResult({
        lgtm: true,
        issues: [],
      });
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('RESOLVED_LGTM');
    });

    it('allows stop when status is PR_CREATED but active subagents are running (payload.hasActiveSubagents: true)', () => {
      testMachine.setPrCreated(46);
      const result = handleStop({ hasActiveSubagents: true }, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('Active subagent running');
      expect(result.reason).toContain('PR_CREATED');
    });

    it('allows stop when status is PR_CREATED and payload.fullyIdle is false (official Antigravity payload)', () => {
      testMachine.setPrCreated(46);
      const result = handleStop({ fullyIdle: false }, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('Active subagent running');
      expect(result.reason).toContain('PR_CREATED');
    });

    it('allows stop when status is PR_CREATED and state has activeSubagents: true', () => {
      testMachine.setPrCreated(46);
      testMachine.setActiveSubagents(true);
      const result = handleStop({}, testMachine);
      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('Active subagent running');
      expect(result.reason).toContain('PR_CREATED');
    });

    it('allows stop when payload has activeSubagents array or count in PR_CREATED', () => {
      testMachine.setPrCreated(46);

      const result1 = handleStop({ activeSubagents: 2 }, testMachine);
      expect(result1.decision).toBe('allow');

      const result2 = handleStop({ subagents: ['subagent-1'] }, testMachine);
      expect(result2.decision).toBe('allow');

      const result3 = handleStop({ active_subagents: 1 }, testMachine);
      expect(result3.decision).toBe('allow');
    });

    it('allows stop when payload has activeSubagents array or count in REVIEW_REQUESTED', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewRequested({ activeSubagents: false });

      const result1 = handleStop({ activeSubagents: 1 }, testMachine);
      expect(result1.decision).toBe('allow');

      const result2 = handleStop({ subagents: [{ role: 'fleet-reviewer' }] }, testMachine);
      expect(result2.decision).toBe('allow');
    });

    it('allows stop when environment variable ACTIVE_SUBAGENTS is true', () => {
      testMachine.setPrCreated(46);
      process.env.ACTIVE_SUBAGENTS = 'true';
      try {
        const result = handleStop({}, testMachine);
        expect(result.decision).toBe('allow');
        expect(result.reason).toContain('Active subagent running');
      } finally {
        delete process.env.ACTIVE_SUBAGENTS;
      }
    });

    it('allows stop unconditionally when payload specifies subagent context (isSubagent: true, role, agentType)', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewResult({
        lgtm: false,
        issues: [{ id: '1', type: 'must', description: 'Blocker', resolved: false }],
      });

      const result1 = handleStop({ isSubagent: true }, testMachine);
      expect(result1.decision).toBe('allow');
      expect(result1.reason).toContain('subagent context');

      const result2 = handleStop({ role: 'fleet-reviewer' }, testMachine);
      expect(result2.decision).toBe('allow');
      expect(result2.reason).toContain('subagent context');

      const result3 = handleStop({ agentRole: 'Code Reviewer' }, testMachine);
      expect(result3.decision).toBe('allow');
      expect(result3.reason).toContain('subagent context');
    });

    it('allows stop unconditionally when ANTIGRAVITY_SUBAGENT environment variable is set', () => {
      testMachine.setPrCreated(46);
      testMachine.setReviewResult({
        lgtm: false,
        issues: [{ id: '1', type: 'must', description: 'Blocker', resolved: false }],
      });

      process.env.ANTIGRAVITY_SUBAGENT = 'true';
      try {
        const result = handleStop({}, testMachine);
        expect(result.decision).toBe('allow');
        expect(result.reason).toContain('subagent context');
      } finally {
        delete process.env.ANTIGRAVITY_SUBAGENT;
      }
    });
  });

  describe('safetyGuard (antigravity-review-loop/hooks/safetyGuard.js)', () => {
    it('allows non-command tools', () => {
      const result = handleSafetyGuard({
        toolCall: {
          name: 'view_file',
          args: { AbsolutePath: 'test.txt' },
        },
      });
      expect(result.decision).toBe('allow');
    });

    it('allows safe shell commands', () => {
      const result1 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git status' },
        },
      });
      expect(result1.decision).toBe('allow');

      const result2 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run check:fast' },
        },
      });
      expect(result2.decision).toBe('allow');
    });

    it('denies unauthorized gh pr merge command', () => {
      const result = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'gh pr merge 46 --squash' },
        },
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('gh pr merge');
      expect(result.reason).toContain('prohibited');
    });

    it('denies direct gh pr merge with various arguments', () => {
      const result = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'gh pr merge 123 --merge' },
        },
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('gh pr merge');
    });

    it('denies hanging interactive npm test command', () => {
      const result1 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm test' },
        },
      });
      expect(result1.decision).toBe('deny');
      expect(result1.reason).toContain('Interactive test runner detected');

      const result2 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test' },
        },
      });
      expect(result2.decision).toBe('deny');
      expect(result2.reason).toContain('Interactive test runner detected');

      const result3 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm.cmd test' },
        },
      });
      expect(result3.decision).toBe('deny');
      expect(result3.reason).toContain('Interactive test runner detected');

      const result4 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm.cmd run test' },
        },
      });
      expect(result4.decision).toBe('deny');
      expect(result4.reason).toContain('Interactive test runner detected');
    });

    it('allows non-hanging test commands (npm run test:run, npm test --run, npm run test:coverage, test:fast, test:related)', () => {
      const result1 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test:run' },
        },
      });
      expect(result1.decision).toBe('allow');

      const result2 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm test --run' },
        },
      });
      expect(result2.decision).toBe('allow');

      const result3 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test:coverage' },
        },
      });
      expect(result3.decision).toBe('allow');

      const result4 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm.cmd run test:coverage' },
        },
      });
      expect(result4.decision).toBe('allow');

      const result5 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test:fast' },
        },
      });
      expect(result5.decision).toBe('allow');

      const result6 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm.cmd run test:fast' },
        },
      });
      expect(result6.decision).toBe('allow');

      const result7 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test:related' },
        },
      });
      expect(result7.decision).toBe('allow');

      const result8 = handleSafetyGuard({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm.cmd run test:related' },
        },
      });
      expect(result8.decision).toBe('allow');
    });

    it('executes directly via node CLI with stdin/stdout JSON protocol', () => {
      const handlerPath = path.resolve(__dirname, '../hooks/safetyGuard.js');
      const inputPayload = JSON.stringify({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'gh pr merge 50 --auto' },
        },
      });
      const stdout = execSync(`node "${handlerPath}"`, {
        input: inputPayload,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.decision).toBe('deny');
      expect(parsed.reason).toContain('gh pr merge');
    });
  });

  describe('branchDoRGate (antigravity-review-loop/hooks/branchDoRGate.js)', () => {
    it('allows non-branch commands immediately', () => {
      const result = handleBranchDoRGate({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git status' },
        },
      });
      expect(result.decision).toBe('allow');
    });

    it('denies branch creation if working tree is dirty', () => {
      const mockExec = vi.fn().mockReturnValue(' M src/index.ts\n?? newfile.ts');
      const result = handleBranchDoRGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'git checkout -b feature/issue-99-test' },
          },
        },
        { execFn: mockExec, stateMachine: testMachine }
      );
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Working tree is dirty');
    });

    it('allows branch creation if untracked files are only under docs/issues/', () => {
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'dor-clean-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nWhy details\n\n## 3. 排除するリスク\nRisk details\n\n## 5. 受け入れ基準\n- [ ] 機能受け入れ基準および単体テストが正常に動作すること\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre-Verification\n\n## 1. 日時\n2026-09-09\n\n## 3. 重複・パッチワーク点検 (Impact & Duplication Check)\nNo duplication found.\n'
      );

      const mockExec = vi.fn().mockReturnValue('?? docs/issues/ISSUE-099_test/issue.md\n?? docs/issues/ISSUE-099_test/pre_verification.md\n');
      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('allow');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('denies branch creation if loopState is not IDLE', () => {
      testMachine.setPrCreated(46);
      const mockExec = vi.fn().mockReturnValue('');
      const result = handleBranchDoRGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'git checkout -b feature/issue-99-test' },
          },
        },
        { execFn: mockExec, stateMachine: testMachine }
      );
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('An active review loop is still running');
    });

    it('denies branch creation if issue.md does not exist for the issue', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const result = handleBranchDoRGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'git checkout -b feature/issue-99999-nonexistent' },
          },
        },
        { execFn: mockExec, stateMachine: testMachine }
      );
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('No issue document found for Issue #99999');
    });

    it('denies branch creation if issue.md lacks Why or Risk sections', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'why-check-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(path.join(issueDir, 'issue.md'), '# Issue 99\n\n## 1. Description\nSome description without why or risk');

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('deny');
        expect(result.reason).toContain('Missing required sections');
        expect(result.reason).toContain('template_issue.md');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('denies branch creation if pre_verification.md does not exist in target issue dir', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-verif-missing-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\n- [ ] 機能受け入れ基準および単体テストが正常に動作すること\n'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('deny');
        expect(result.reason).toContain('pre_verification.md does not exist');
        expect(result.reason).toContain('template_pre_verification.md');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('denies branch creation if pre_verification.md lacks Impact & Duplication Check section', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-missing-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\n- [ ] 機能受け入れ基準および単体テストが正常に動作すること\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre Verification\n\n## 1. 日時\n2026-09-09\n\n## 2. 課題\n課題記述のみ'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('deny');
        expect(result.reason).toContain("Missing 'Impact & Duplication Check' section");
        expect(result.reason).toContain('template_pre_verification.md');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('denies branch creation if issue.md lacks concrete Acceptance Criteria', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'criteria-vague-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\nEmpty header\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre Verification\n\n## 1. 日時\n2026-09-09\n\n## 3. 重複・パッチワーク点検 (Impact & Duplication Check)\n調査済み\n'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('deny');
        expect(result.reason).toContain('Acceptance Criteria in ISSUE-099_test/issue.md is empty or too vague');
        expect(result.reason).toContain('fleet_dor_auditor');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('denies branch creation if issue.md contains ambiguous terms in acceptance criteria', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'vague-terms-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\n- [ ] スコアリングが適切に改善されること\n- [ ] 必要に応じてよしなに調整すること\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre Verification\n\n## 1. 日時\n2026-09-09\n\n## 3. 重複・パッチワーク点検 (Impact & Duplication Check)\n調査済み\n'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('deny');
        expect(result.reason).toContain('contains ambiguous terms');
        expect(result.reason).toContain('fleet_dor_auditor');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('allows branch creation when issue.md contains template guidance blockquotes but clean Given-When-Then scenarios', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'blockquote-clean-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\n\n> ⚠️ **【重要】曖昧語の禁止**:\n> 「適切に」「よしなに」「必要に応じて」といった曖昧な言葉は使用禁止。\n\n- **シナリオ 1: 正常系**\n  - **Given**: 初期状態\n  - **When**: 実行\n  - **Then**: 期待結果\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre Verification\n\n## 1. 日時\n2026-09-09\n\n## 3. 重複・パッチワーク点検 (Impact & Duplication Check)\n既存コード調査済み。重複なし。'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('allow');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('allows branch creation when tree is clean, state is IDLE, issue.md has Why/Risk/Acceptance, and pre_verification.md has Impact Check', () => {
      const mockExec = vi.fn().mockReturnValue('');
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'why-pass-'));
      const issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 1. 解決すべき課題・背景 (Why)\nSome why\n\n## 3. 排除するリスク (Risks to Eliminate)\nSome risk\n\n## 5. 受け入れ基準\n- **シナリオ 1: 正常系**\n  - **Given**: 初期状態\n  - **When**: 実行\n  - **Then**: 期待結果\n'
      );
      fs.writeFileSync(
        path.join(issueDir, 'pre_verification.md'),
        '# Pre Verification\n\n## 1. 日時\n2026-09-09\n\n## 3. 重複・パッチワーク点検 (Impact & Duplication Check)\n既存コード調査済み。重複なし。'
      );

      try {
        const result = handleBranchDoRGate(
          {
            toolCall: {
              name: 'run_command',
              args: { CommandLine: 'git checkout -b feature/issue-99-test' },
            },
          },
          { execFn: mockExec, stateMachine: testMachine, projectRoot: tempProject }
        );
        expect(result.decision).toBe('allow');
      } finally {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it('executes directly via node CLI with stdin/stdout JSON protocol', () => {
      const handlerPath = path.resolve(__dirname, '../hooks/branchDoRGate.js');
      const inputPayload = JSON.stringify({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git status' },
        },
      });
      const stdout = execSync(`node "${handlerPath}"`, {
        input: inputPayload,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.decision).toBe('allow');
    });
  });

  describe('prePrAuditGate (antigravity-review-loop/hooks/prePrAuditGate.js)', () => {
    let tempProject: string;
    let issueDir: string;
    let adrDir: string;

    beforeEach(() => {
      tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-pr-audit-'));
      issueDir = path.join(tempProject, 'docs/issues/ISSUE-099_test');
      adrDir = path.join(tempProject, 'docs/adr');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.mkdirSync(adrDir, { recursive: true });

      // Setup complete 4-axis docs
      fs.writeFileSync(path.join(issueDir, 'issue.md'), '# Issue 99\n\n## 5. 受け入れ基準\n- [x] All done\n');
      fs.writeFileSync(path.join(issueDir, 'pre_verification.md'), '# Pre Verification\nSome verification details here\n');
      fs.writeFileSync(path.join(issueDir, 'plan.md'), '# Implementation Plan\nDetailed plan content here\n');
      fs.writeFileSync(path.join(issueDir, 'walkthrough.md'), '# Walkthrough Report\nDetailed walkthrough results\n');

      // Setup ADR and synchronized SSOT
      fs.writeFileSync(path.join(adrDir, '0018-test-architecture.md'), '# ADR-0018\nContent\n');
      fs.writeFileSync(
        path.join(tempProject, 'docs/architecture_overview.md'),
        '# SSOT\nCovers ADR-0001 to ADR-0018\n'
      );
    });

    afterEach(() => {
      fs.rmSync(tempProject, { recursive: true, force: true });
    });

    it('allows non-PR commands immediately', () => {
      const result = handlePrePrAuditGate({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin main' },
        },
      });
      expect(result.decision).toBe('allow');
    });

    it('denies gh pr create if any 4-axis document is missing or empty', () => {
      fs.unlinkSync(path.join(issueDir, 'walkthrough.md'));

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Pre-PR Audit Failed: Missing or incomplete 4-axis document');
      expect(result.reason).toContain('walkthrough.md');
    });

    it('denies gh pr create if acceptance criteria contains unchecked items (- [ ])', () => {
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n- [x] Item 1 done\n- [ ] Item 2 pending\n'
      );

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Pre-PR Audit Failed: Unchecked Pre-PR acceptance criteria (- [ ])');
      expect(result.reason).toContain('marked as [x]');

      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n- [x] Item 1 done\n- [   ] Item 2 pending with spaces\n'
      );

      const resultWithSpaces = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(resultWithSpaces.decision).toBe('deny');
      expect(resultWithSpaces.reason).toContain('Pre-PR Audit Failed: Unchecked Pre-PR acceptance criteria (- [ ])');
    });

    it('allows gh pr create when 5.1 Pre-PR DoD is completed even if 5.2 Pre-Merge Gate has unchecked items', () => {
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n\n### 5.1. PR作成前完了基準 (Pre-PR DoD)\n- [x] Implementation done\n- [x] Fast tests passed\n\n### 5.2. マージ前完了ゲート (Pre-Merge Gate)\n- [ ] CI passed\n- [ ] Fleet review LGTM\n- [ ] Human merged\n'
      );

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('allow');
    });

    it('denies gh pr create if 5.1 Pre-PR DoD has unchecked items even if 5.2 is present', () => {
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n\n### 5.1. PR作成前完了基準 (Pre-PR DoD)\n- [x] Implementation done\n- [ ] Fast tests not run\n\n### 5.2. マージ前完了ゲート (Pre-Merge Gate)\n- [ ] CI passed\n'
      );

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Pre-PR Audit Failed: Unchecked Pre-PR acceptance criteria (- [ ])');
    });

    it('denies gh pr create if new format 5.2 Pre-PR Process DoD has unchecked items when 5.1 is Given-When-Then', () => {
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n\n### 5.1. 機能受け入れシナリオ (Given-When-Then)\n- **シナリオ 1**\n  - **Given**: 初期状態\n  - **When**: 実行\n  - **Then**: 期待結果\n\n### 5.2. PR作成前プロセス完了基準 (Pre-PR Process DoD)\n- [x] Unit test passed\n- [ ] Quality gate not run\n\n### 5.3. マージ前完了ゲート (Pre-Merge Gate)\n- [ ] CI passed\n'
      );

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Pre-PR Audit Failed: Unchecked Pre-PR acceptance criteria (- [ ])');
    });

    it('allows gh pr create when new format 5.2 Pre-PR Process DoD is completed even if 5.3 has unchecked items', () => {
      fs.writeFileSync(
        path.join(issueDir, 'issue.md'),
        '# Issue 99\n\n## 5. 受け入れ基準\n\n### 5.1. 機能受け入れシナリオ (Given-When-Then)\n- **シナリオ 1**\n  - **Given**: 初期状態\n  - **When**: 実行\n  - **Then**: 期待結果\n\n### 5.2. PR作成前プロセス完了基準 (Pre-PR Process DoD)\n- [x] Unit test passed\n- [x] Quality gate passed\n\n### 5.3. マージ前完了ゲート (Pre-Merge Gate)\n- [ ] CI passed\n- [ ] Fleet review LGTM\n'
      );

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('allow');
    });

    it('denies gh pr create if latest ADR is not synchronized in architecture_overview.md (SSOT)', () => {
      fs.writeFileSync(path.join(adrDir, '0019-new-feature.md'), '# ADR-0019\n');

      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Pre-PR Audit Failed: The latest ADR (0019-new-feature.md) is not synchronized');
      expect(result.reason).toContain('architecture_overview.md');
    });

    it('allows gh pr create when all pre-PR audit checks pass', () => {
      const result = handlePrePrAuditGate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test"' },
          },
        },
        { currentBranch: 'feature/issue-99-test', projectRoot: tempProject }
      );

      expect(result.decision).toBe('allow');
    });

    it('executes directly via node CLI with stdin/stdout JSON protocol', () => {
      const handlerPath = path.resolve(__dirname, '../hooks/prePrAuditGate.js');
      const inputPayload = JSON.stringify({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin main' },
        },
      });
      const stdout = execSync(`node "${handlerPath}"`, {
        input: inputPayload,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.decision).toBe('allow');
    });
  });

  describe('postPrCreate (antigravity-review-loop/hooks/postPrCreate.js)', () => {
    it('ignores failed commands with error', () => {
      const result = handlePostPrCreate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title test' },
          },
          error: 'exit status 1',
        },
        testMachine
      );
      expect(result).toEqual({});
      expect(testMachine.getState().status).toBe(STATUS.IDLE);
    });

    it('transitions state to PR_CREATED on successful gh pr create (fallback)', () => {
      const result = handlePostPrCreate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --title "feat: test PR" --body "..."' },
          },
        },
        testMachine
      );
      expect(result).toEqual({});
      expect(testMachine.getState().status).toBe(STATUS.PR_CREATED);
      expect(testMachine.getState().prNumber).toBeGreaterThan(0);
    });

    it('extracts PR number from tool output URL', () => {
      const result = handlePostPrCreate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create' },
          },
          result: 'https://github.com/yuki-yamagishi/job-eval/pull/99\n',
        },
        testMachine
      );
      expect(result).toEqual({});
      expect(testMachine.getState().status).toBe(STATUS.PR_CREATED);
      expect(testMachine.getState().prNumber).toBe(99);
    });

    it('does not falsely extract issue number from command line and uses safe fallback or PR URL', () => {
      const result = handlePostPrCreate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --body "Closes #46"' },
          },
          result: 'https://github.com/yuki-yamagishi/job-eval/pull/105\n',
        },
        testMachine
      );
      expect(result).toEqual({});
      expect(testMachine.getState().status).toBe(STATUS.PR_CREATED);
      expect(testMachine.getState().prNumber).toBe(105);
    });

    it('uses safe fallback when no PR URL is detected', () => {
      const result = handlePostPrCreate(
        {
          toolCall: {
            name: 'run_command',
            args: { CommandLine: 'gh pr create --body "Closes #46"' },
          },
        },
        testMachine
      );
      expect(result).toEqual({});
      expect(testMachine.getState().status).toBe(STATUS.PR_CREATED);
      expect(testMachine.getState().prNumber).toBeGreaterThanOrEqual(1);
    });

    it('executes directly via node CLI with stdin/stdout JSON protocol', () => {
      const handlerPath = path.resolve(__dirname, '../hooks/postPrCreate.js');
      const inputPayload = JSON.stringify({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git status' },
        },
      });
      const stdout = execSync(`node "${handlerPath}"`, {
        input: inputPayload,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({});
    });
  });
});

