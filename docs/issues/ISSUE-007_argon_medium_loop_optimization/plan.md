# 実装計画書 (Implementation Plan) - Issue #7

## 1. 変更ファイル一覧

| ファイル | 役割・変更内容 |
| :--- | :--- |
| `hooks.json` | `safety-guard` の `PreToolUse` `matcher` を `"run_command\|write_file\|edit_file\|write_to_file\|replace_file_content\|multi_replace_file_content"` に拡張、`pr-body-audit-gate` の登録 |
| `hooks/safetyGuard.js` | `verifyConfigNotTampered` に `write_file`/`edit_file` (`args.Path`) 対応を追加、`verifySingleCommandExecution`（クォート認識型コマンド連結遮断）を追加、テスト拒絶ガイダンスに `npm.cmd` 補足を追加 |
| `hooks/prBodyAuditGate.js` (新規) | `gh pr create` / `gh pr edit` 実行時の PR Body 経緯語混入検知・拒絶（および `autoOverwritePrBody` 時の自動置換） |
| `hooks/prBodyStaleGuard.js` (新規) | オープン PR 存在時に最新コードコミットと `walkthrough.md` / PR Body の鮮度を検証する Stop ガード |
| `hooks/stopHook.js` | `verifyPrBodyNotStale` を統合し、親エージェント完了時に Stale PR Body を物理拒絶 |
| `scripts/sync-pr-body.js` (新規) | `walkthrough.md`（SSoT）と `git diff --stat` からクリーンな PR Body を決定論的に生成・同期 |
| `scripts/generate-pr-body.js` (新規) | `sync-pr-body.js` へのラッパーエントリポイント |
| `config/reviewLoopConfig.js` | `codeDirs`, `disallowedPrBodyTerms`, `autoOverwritePrBody` 設定キーの追加 |
| `agents/fleet_reviewer.md` | 「過剰攻撃・粗探し防止ガードレール（反例提示の義務化、ゴールポスト移動禁止、ゼロ件恐怖症排除、好みの `[must]`/`[should]` 化禁止）」の追加 |
| `rules/AGENTS.md` (新規) | Antigravity 公式プラグイン仕様に準拠したフロントマターなし常時適用ルール（単一コマンド実行規約・品質ガバナンス原則） |
| `skills/dev-lifecycle/SKILL.md` | Windows PowerShell 環境における `npm.cmd` 実行に関する補足の追加 |
| `skills/review-self-healing/SKILL.md` | `sync-pr-body.js` による PR Body 同期フローおよび `npm.cmd` 補足の反映 |
| `templates/review-loop.config.example.json` | 新規設定キーのサンプル反映 |
| `README.md`, `package.json`, `tsconfig.json` | ドキュメント・スクリプト定義・型チェック設定の更新 |
| `tests/hooks.test.ts` | `write_file`/`edit_file` 設定改ざん拒絶テスト、単一コマンド連結拒絶＆クォート内記号許可テストの追加 |
| `tests/config.test.ts`, `tests/prBodyAuditGate.test.ts`, `tests/prBodyStaleGuard.test.ts`, `tests/syncPrBody.test.ts` | 設定層および PR Body 同期・監査・鮮度ガードの単体テスト |

---

## 2. 実装手順 (TDD Inner Loop)

1. **Phase 1: PR Body SSoT 同期機構・監査ゲート・Stale ガードの検証とコミット**
   - `scripts/sync-pr-body.js`, `hooks/prBodyAuditGate.js`, `hooks/prBodyStaleGuard.js`, `hooks/stopHook.js`, `config/reviewLoopConfig.js` および対応テストの動作を確認。
2. **Phase 2: `safetyGuard.js` & `hooks.json` の強化（TDD Red -> Green -> Refactor）**
   - `tests/hooks.test.ts` に以下のテストケースを追加：
     - `write_file` / `edit_file`（`args.Path`）での `review-loop.config.json` 変更拒絶と通常ファイル許可
     - クォート外の `;`, `&&`, `||`, `|` を含む `run_command` の拒絶
     - クォート内の `;`, `&&`, `||`, `|`（例: `git commit -m "fix: a; b && c | d"`）および `2>&1` の許可
   - `hooks/safetyGuard.js` に `verifySingleCommandExecution` と `write_file`/`edit_file` 対応を実装し、`hooks.json` の `matcher` を更新。
3. **Phase 3: `agents/fleet_reviewer.md` ガードレール統一 & `rules/AGENTS.md` 整備 & スキル更新**
   - `agents/fleet_reviewer.md` に反例提示義務等のガードレールを追加。
   - `rules/AGENTS.md` を作成。
   - `skills/dev-lifecycle/SKILL.md` 等に Windows PowerShell 向け `npm.cmd` 案内を追記。
4. **Phase 4: Outer Loop 品質ゲート & 4軸ドキュメント (`walkthrough.md`) 完成**
   - `npx.cmd tsc --noEmit` および `npm.cmd test -- --run` で全テスト PASS を確認。
   - `walkthrough.md` の作成と `issue.md` の Pre-PR Process DoD チェック更新。

---

## 3. 検証手順

- Inner Loop（対象テスト単発実行）: `npm.cmd test -- tests/hooks.test.ts --run`
- 型チェック: `npx.cmd tsc --noEmit`
- Outer Loop（全量テスト実行）: `npm.cmd test -- --run`
