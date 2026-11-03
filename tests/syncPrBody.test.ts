import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  parseWalkthrough,
  sanitizeMainChanges,
  generatePrBody,
  syncPrBody,
  resolveWalkthroughPath,
  getGitDiffStat,
} from '../scripts/sync-pr-body.js';
import { LoopStateMachine } from '../state/loopState.js';

describe('Deterministic PR Body Synchronizer (scripts/sync-pr-body.js)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-pr-body-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('sanitizeMainChanges & parseWalkthrough', () => {
    it('sanitizes conversation context / trial-and-error phrases from main changes', () => {
      const input = [
        '1. **設定層の導入**: 設定ファイルを読み込む機構を追加。',
        '2. **古い実装の撤回**: ユーザーに指摘されて勝手に実装したワークアラウンドを撤回しました。',
        '3. **フックの強化**: PreToolUse フックで安全性を向上。',
      ].join('\n');

      const sanitized = sanitizeMainChanges(input);
      expect(sanitized).toContain('1. **設定層の導入**');
      expect(sanitized).toContain('3. **フックの強化**');
      expect(sanitized).not.toContain('勝手に');
      expect(sanitized).not.toContain('指摘されて');
      expect(sanitized).not.toContain('撤回しました');
    });

    it('extracts structured sections with boundary separation', () => {
      const walkthroughContent = `# 作業成果レポート (Walkthrough) - Issue #5: プラグイン抽象化

## 1. 概要
設定層の導入と安全ガードの強化を実施した。

## 2. 成果物一覧
1. **設定層 (config/reviewLoopConfig.js)**: 設定のロードとマージ。
2. **安全ガード (hooks/safetyGuard.js)**: 非対話テスト判定の精緻化。

## 3. レビュー対応履歴
| レビュアー | 指摘内容 (Must/Should) | 対応コミット | 対応概要 |
|---|---|---|---|
| codeReviewer | [must] 設定改ざん防止の強化 | a1b2c3d | safetyGuard に検知追加 |
| completionAuditor | [should] 非対話フラグの精緻化 | e4f5g6h | -- 後のフラグ解釈に対応 |

## 4. 検証結果
全 152 テストが 100% PASS。
`;

      const parsed = parseWalkthrough(walkthroughContent);
      expect(parsed.title).toContain('Issue #5');
      expect(parsed.overview).toContain('設定層の導入と安全ガードの強化');
      expect(parsed.mainChanges).toContain('config/reviewLoopConfig.js');
      expect(parsed.mainChanges).toContain('hooks/safetyGuard.js');
      expect(parsed.reviewHistory).toContain('| codeReviewer | [must] 設定改ざん防止の強化');
      expect(parsed.verification).toContain('全 152 テストが 100% PASS');
    });

    it('provides fallback review history table if not present in walkthrough', () => {
      const simpleWalkthrough = `# Walkthrough

## 概要
初回の実装です。

## 主な変更点
- 新機能 A を追加。
`;
      const parsed = parseWalkthrough(simpleWalkthrough);
      expect(parsed.reviewHistory).toContain('| レビュアー | 指摘内容 (Must/Should) | 対応コミット | 対応概要 |');
      expect(parsed.reviewHistory).toContain('初回PR作成');
    });

    it('does not misidentify inline mentions of `## 主な変更点` or `## レビュー対応履歴` as section headers', () => {
      const walkthroughWithInlineMentions = `# Walkthrough

## 1. 概要
概要。

## 2. 主な変更点
1. \`walkthrough.md\` から恒久仕様（\`## 主な変更点\`）と対応経緯（\`## レビュー対応履歴\`）を厳格に境界分離。
2. 追加のガード実装。

## 3. レビュー対応履歴
| レビュアー | 指摘内容 (Must/Should) | 対応コミット | 対応概要 |
|---|---|---|---|
| fleet_dor_auditor | 指摘なし | - | 一発合格 |
`;
      const parsed = parseWalkthrough(walkthroughWithInlineMentions);
      expect(parsed.mainChanges).toContain('追加のガード実装');
      expect(parsed.reviewHistory).toContain('fleet_dor_auditor');
      expect(parsed.reviewHistory).not.toContain('追加のガード実装');
      expect(parsed.reviewHistory).not.toContain('## 3. レビュー対応履歴');
    });
  });

  describe('resolveWalkthroughPath', () => {
    it('finds walkthrough.md by issue number in docs/issues', () => {
      const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-042_cool_feature');
      fs.mkdirSync(issueDir, { recursive: true });
      const walkthroughFile = path.join(issueDir, 'walkthrough.md');
      fs.writeFileSync(walkthroughFile, '# Walkthrough 42', 'utf8');

      const resolved = resolveWalkthroughPath({
        projectRoot: tempDir,
        issueNum: 42,
      });

      expect(resolved).toBe(walkthroughFile);
    });

    it('falls back to custom walkthroughPath when specified', () => {
      const customFile = path.join(tempDir, 'custom_walkthrough.md');
      fs.writeFileSync(customFile, '# Custom', 'utf8');

      const resolved = resolveWalkthroughPath({
        projectRoot: tempDir,
        walkthroughPath: 'custom_walkthrough.md',
      });

      expect(resolved).toBe(customFile);
    });

    it('returns null if walkthrough does not exist', () => {
      const resolved = resolveWalkthroughPath({
        projectRoot: tempDir,
        issueNum: 999,
      });

      expect(resolved).toBeNull();
    });
  });

  describe('generatePrBody & syncPrBody', () => {
    it('throws error if walkthrough.md is missing', () => {
      expect(() => {
        generatePrBody({ projectRoot: tempDir, issueNum: 99 });
      }).toThrow(/walkthrough\.md \(SSoT\) could not be found/);
    });

    it('deterministically generates clean PR Body with metadata and diff stat', () => {
      const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-010_api_refactor');
      fs.mkdirSync(issueDir, { recursive: true });
      const walkthroughFile = path.join(issueDir, 'walkthrough.md');
      fs.writeFileSync(
        walkthroughFile,
        `# Walkthrough Issue #10

## 概要
API のエンドポイントをリファクタリング。

## 主な変更点
- GET /items のレスポンスを型定義。

## 検証結果
単体テスト合格。
`,
        'utf8'
      );

      const mockExec = vi.fn().mockReturnValue(' 3 files changed, 45 insertions(+), 12 deletions(-)');

      const result = generatePrBody({
        projectRoot: tempDir,
        issueNum: 10,
        execFn: mockExec,
        commitHash: 'deadbeef12345678',
        diffStat: ' 3 files changed, 45 insertions(+), 12 deletions(-)',
      });

      expect(result.prBody).toContain('<!-- AUTO-GENERATED PR BODY BY antigravity-review-loop -->');
      expect(result.prBody).toContain('<!-- SYNCED_COMMIT: deadbeef12345678 -->');
      expect(result.prBody).toContain('Closes #10');
      expect(result.prBody).toContain('## 概要');
      expect(result.prBody).toContain('## 主な変更点');
      expect(result.prBody).toContain('## レビュー対応履歴');
      expect(result.prBody).toContain('## 変更ファイル一覧 (git diff --stat)');
      expect(result.prBody).toContain('3 files changed, 45 insertions(+)');
      expect(result.prBody).toContain('## 検証結果');
    });

    it('syncPrBody writes to disk and calls gh pr edit when updatePr is true', () => {
      const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-005_feature');
      fs.mkdirSync(issueDir, { recursive: true });
      fs.writeFileSync(
        path.join(issueDir, 'walkthrough.md'),
        `# Walkthrough #5\n## 概要\n成果\n## 成果物一覧\n- 成果物A\n`,
        'utf8'
      );

      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('gh pr edit')) {
          return '';
        }
        return 'dummy';
      });

      const stateMachine = new LoopStateMachine(path.join(tempDir, 'loop_state.json'));
      stateMachine.setPrCreated(5);

      const syncResult = syncPrBody({
        projectRoot: tempDir,
        issueNum: 5,
        execFn: mockExec,
        commitHash: 'abc1234',
        diffStat: ' 1 file changed',
        updatePr: true,
        stateMachine,
      });

      expect(syncResult.success).toBe(true);
      expect(fs.existsSync(syncResult.outputPath)).toBe(true);
      const saved = fs.readFileSync(syncResult.outputPath, 'utf8');
      expect(saved).toContain('Closes #5');
      expect(syncResult.updatedPr).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr edit 5 --body-file'),
        expect.anything()
      );
    });

    it('CLI scripts/sync-pr-body.js runs successfully via child process', () => {
      const issueDir = path.join(tempDir, 'docs', 'issues', 'ISSUE-007_cli_test');
      fs.mkdirSync(issueDir, { recursive: true });
      const walkthroughPath = path.join(issueDir, 'walkthrough.md');
      fs.writeFileSync(
        walkthroughPath,
        `# Walkthrough 7\n## 概要\nCLIテスト\n## 成果物一覧\n- 成果物 CLI\n`,
        'utf8'
      );

      const scriptPath = path.resolve('scripts/sync-pr-body.js');
      const outPath = path.join(tempDir, 'out_pr_body.md');
      const cmd = `node "${scriptPath}" --walkthrough "${walkthroughPath}" --issue 7 --output "${outPath}"`;
      const stdout = execSync(cmd, { cwd: tempDir, encoding: 'utf8' });

      expect(stdout).toContain('[OK]');
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, 'utf8');
      expect(content).toContain('Closes #7');
      expect(content).toContain('## 主な変更点');
    });
  });
});
