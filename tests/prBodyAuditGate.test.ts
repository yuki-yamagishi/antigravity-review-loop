import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  extractPrBodyFromCommand,
  extractPrBodySections,
  findDisallowedTerms,
  handlePrBodyAuditGate,
} from '../hooks/prBodyAuditGate.js';

describe('PR Body Audit Gate Hook (hooks/prBodyAuditGate.js)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-audit-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('extractPrBodyFromCommand', () => {
    it('extracts content from --body-file argument', () => {
      const prBodyPath = path.join(tempDir, 'temp_body.md');
      fs.writeFileSync(prBodyPath, '## 概要\nテスト本文', 'utf8');

      const cmd = `gh pr create --title "test" --body-file "${prBodyPath}"`;
      const result = extractPrBodyFromCommand(cmd, tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('body-file');
      expect(result?.content).toBe('## 概要\nテスト本文');
    });

    it('extracts content from -F short flag', () => {
      const prBodyPath = path.join(tempDir, 'temp_body.md');
      fs.writeFileSync(prBodyPath, '## 概要\nショートフラグ', 'utf8');

      const cmd = `gh pr edit 5 -F "${prBodyPath}"`;
      const result = extractPrBodyFromCommand(cmd, tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('body-file');
      expect(result?.content).toBe('## 概要\nショートフラグ');
    });

    it('extracts content from --body string', () => {
      const cmd = `gh pr create --title "feat" --body "## 概要\\nダイレクト文字列"`;
      const result = extractPrBodyFromCommand(cmd, tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('body');
      expect(result?.content).toContain('ダイレクト文字列');
    });

    it('returns null for non-body commands', () => {
      const cmd = `gh pr view 5 --json number`;
      const result = extractPrBodyFromCommand(cmd, tempDir);
      expect(result).toBeNull();
    });

    it('does not falsely match -B (--base), -f (--fill), or branch suffixes like feat-b / feat-f', () => {
      const cmd1 = `gh pr create -B main --title "feat: test" --body "## 主な変更点\\n指摘されて勝手に撤回"`;
      const res1 = extractPrBodyFromCommand(cmd1, tempDir);
      expect(res1?.type).toBe('body');
      expect(res1?.content).toContain('指摘されて勝手に撤回');

      const cmd2 = `gh pr create --head feature/sub-b --title "feat: test" --body "## 主な変更点\\n指摘されて撤回"`;
      const res2 = extractPrBodyFromCommand(cmd2, tempDir);
      expect(res2?.type).toBe('body');
      expect(res2?.content).toContain('指摘されて撤回');

      const prBodyPath = path.join(tempDir, 'real_body.md');
      fs.writeFileSync(prBodyPath, '## 主な変更点\n勝手に実装', 'utf8');
      const cmd3 = `gh pr create -f --head feature/sub-f -F "${prBodyPath}"`;
      const res3 = extractPrBodyFromCommand(cmd3, tempDir);
      expect(res3?.type).toBe('body-file');
      expect(res3?.content).toContain('勝手に実装');
    });
  });

  describe('extractPrBodySections & findDisallowedTerms', () => {
    it('separates main changes and review history accurately', () => {
      const text = `## 概要
Issue の解決。

## 主な変更点
1. 新しい認証ロジックを実装。

## レビュー対応履歴
| レビュアー | 指摘内容 | 対応コミット |
|---|---|---|
| codeReviewer | [must] 指摘された脆弱性を修正 | abc1234 |
`;
      const sections = extractPrBodySections(text);
      expect(sections.mainChanges).toContain('新しい認証ロジックを実装');
      expect(sections.reviewHistory).toContain('指摘された脆弱性を修正');

      // The word "指摘された" is only in review history, not in main changes
      const mainTerms = findDisallowedTerms(sections.mainChanges);
      expect(mainTerms).toEqual([]);

      const reviewTerms = findDisallowedTerms(sections.reviewHistory);
      expect(reviewTerms).toContain('指摘され');
    });

    it('does not get confused by inline markdown mentions of `## レビュー対応履歴` inside main changes', () => {
      const text = `## 概要
概要説明。

## 主な変更点
- SSoT から恒久仕様（\`## 主な変更点\`）と対応経緯（\`## レビュー対応履歴\`）を分離。
- 指摘されて勝手に撤回した記述。

## レビュー対応履歴
| レビュアー | 指摘 | 対応 |
|---|---|---|
`;
      const sections = extractPrBodySections(text);
      expect(sections.mainChanges).toContain('指摘されて勝手に撤回した記述');
      expect(sections.reviewHistory).not.toContain('指摘されて勝手に撤回した記述');
      expect(findDisallowedTerms(sections.mainChanges)).toEqual(expect.arrayContaining(['撤回', '勝手に', '指摘され']));
    });
  });

  describe('handlePrBodyAuditGate execution', () => {
    it('allows commands unrelated to gh pr create/edit', () => {
      const payload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm test -- --run' },
        },
      };
      const result = handlePrBodyAuditGate(payload);
      expect(result.decision).toBe('allow');
    });

    it('allows gh pr create when PR Body is clean without conversational leakage', () => {
      const bodyPath = path.join(tempDir, 'clean_body.md');
      fs.writeFileSync(
        bodyPath,
        `## 概要\nCloses #5\n## 主な変更点\n- 設定層の導入\n## レビュー対応履歴\n| レビュアー | 指摘 | 対応 |\n`,
        'utf8'
      );

      const payload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: `gh pr create --title "clean" --body-file "${bodyPath}"` },
        },
      };

      const result = handlePrBodyAuditGate(payload, { projectRoot: tempDir });
      expect(result.decision).toBe('allow');
    });

    it('allows disallowed terms if they are exclusively inside ## レビュー対応履歴', () => {
      const bodyPath = path.join(tempDir, 'valid_history_body.md');
      fs.writeFileSync(
        bodyPath,
        `## 概要\nCloses #5\n## 主な変更点\n- 新機能の実装\n## レビュー対応履歴\n- レビュアーに指摘されて修正しました\n`,
        'utf8'
      );

      const payload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: `gh pr create --title "valid" --body-file "${bodyPath}"` },
        },
      };

      const result = handlePrBodyAuditGate(payload, { projectRoot: tempDir });
      expect(result.decision).toBe('allow');
    });

    it('denies execution when conversation leakage terms are detected in ## 主な変更点 (Default Deny Mode)', () => {
      const bodyPath = path.join(tempDir, 'leaky_body.md');
      fs.writeFileSync(
        bodyPath,
        `## 概要\nCloses #5\n## 主な変更点\n- ユーザーに指摘されて勝手に実装したコードを撤回しました\n## レビュー対応履歴\n履歴なし\n`,
        'utf8'
      );

      const payload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: `gh pr create --title "leak" --body-file "${bodyPath}"` },
        },
      };

      const result = handlePrBodyAuditGate(payload, { projectRoot: tempDir });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('[PrBodyAuditGate Denied]');
      expect(result.reason).toContain('撤回');
      expect(result.reason).toContain('勝手に');
      expect(result.reason).toContain('sync-pr-body.js');
    });

    it('rewrites command with clean file path when autoOverwrite is enabled (Overwrite Mode)', () => {
      const leakyBodyPath = path.join(tempDir, 'leaky_body.md');
      fs.writeFileSync(
        leakyBodyPath,
        `## 概要\nCloses #5\n## 主な変更点\n- 指摘されて撤回\n`,
        'utf8'
      );

      const cleanOutputPath = path.join(tempDir, '.agents', 'pr_body.md');
      const mockSyncFn = vi.fn().mockReturnValue({
        outputPath: cleanOutputPath,
        prBody: '## 概要\nClean\n## 主な変更点\n- Clean specification',
      });

      const payload = {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: `gh pr edit 5 --body-file "${leakyBodyPath}"` },
        },
      };

      const result = handlePrBodyAuditGate(payload, {
        projectRoot: tempDir,
        autoOverwrite: true,
        syncPrBodyFn: mockSyncFn,
      });

      expect(result.decision).toBe('allow');
      expect(result.overwrite).toBeDefined();
      expect(result.overwrite?.CommandLine).toContain('--body-file ".agents/pr_body.md"');
      expect(result.reason).toContain('[PrBodyAuditGate]');
      expect(result.reason).toContain('Automatically replaced');
    });
  });
});
