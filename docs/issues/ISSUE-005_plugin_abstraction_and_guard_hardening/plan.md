# 実装計画書 (Implementation Plan) - Issue #5

## 1. 変更ファイル一覧

| ファイル | 役割・変更内容 |
| :--- | :--- |
| `config/reviewLoopConfig.js` (新規) | 設定層ローダー。ホスト側 `.agents/review-loop.config.json` のロードとデフォルト値マージ |
| `hooks/hookUtils.js` | `findIssueDir` の共通化、プラグインルート解決 `findPluginRoot` の追加 |
| `hooks/safetyGuard.js` | 設定層の非対話コマンド許可リスト対応、`-- --run` 等の npm 引数分離、ガイダンス改善 |
| `hooks/branchDoRGate.js` | `findIssueDir` の利用、英字プレースホルダーおよび空欄行の未記入検知強化 |
| `hooks/prePrAuditGate.js` | `findIssueDir` の利用 |
| `templates/template_issue.md` | 標準プレースホルダー記法（`{{ISSUE_NUMBER}}`, `[TODO: ...]`）の整備 |
| `templates/template_pre_verification.md` | 標準プレースホルダー記法の整備 |
| `.gitattributes` (新規) | 改行コード（LF/CRLF）の正規化ルール定義 |
| `state/loopState.js` | 古い未実在 ADR 参照ヘッダーの整理 |
| `tests/config.test.ts` (新規) | 設定層ローダーの単体テスト |
| `tests/hooks.test.ts` | テンプレートすり抜け防止テスト、npm test 引数分離テスト、設定層連携テストの追加 |

## 2. 実装手順 (TDD Inner Loop)

1. **Phase 1: 設定層の実装 (`config/reviewLoopConfig.js`) & 単体テスト (`tests/config.test.ts`)**
2. **Phase 2: `hookUtils.js` のリファクタリング（Issue ディレクトリ探索の共通化とプラグインルート解決）**
3. **Phase 3: `branchDoRGate.js` の未記入検知強化 & テンプレート記法標準化 & テスト追加**
4. **Phase 4: `safetyGuard.js` の非対話テスト判定精緻化 & テスト追加**
5. **Phase 5: `.gitattributes` 追加と改行正規化、ヘッダーコメント等クリーンアップ**
6. **Phase 6: 全テスト実行 & 成果レポート (`walkthrough.md`) 作成**

## 3. 検証手順

- 単体テスト反復実行: `npm.cmd test`
- テンプレートそのままコピー時の拒絶テストのパス確認
- `npm test -- --run` および設定ファイル経由のテスト許可確認
