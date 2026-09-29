# 実装計画書 (Implementation Plan)

## 1. 概要
`hooks/safetyGuard.js` において、PowerShell ネイティブの HTTP コマンドレット（`Invoke-WebRequest`, `Invoke-RestMethod`）およびそのエイリアス（`iwr`, `irm`）について、タイムアウト（`-TimeoutSec`）未指定の実行を物理遮断する安全ガードを実装する。

## 2. 変更対象ファイル一覧
1. `hooks/safetyGuard.js`: `verifyPowerShellWebTimeoutSpecified` 関数の実装と `handleSafetyGuard` パイプラインへの追加。
2. `tests/hooks.test.ts`: PowerShell ネットワークコマンドのタイムアウト有無、エイリアス、ラッパー経由呼び出し、偽陽性防止の包括的テスト追加。
3. `README.md`: セーフティガード機能の監視対象コマンドに関する説明更新。
4. `docs/issues/ISSUE-003_powershell_network_timeout_guard/walkthrough.md`: 実装成果レポート。

## 3. 実装手順
1. [x] Fast TDD: `tests/hooks.test.ts` に PowerShell HTTP コマンドのテストケースを追加（失敗することを確認）。
2. [x] `hooks/safetyGuard.js` に `verifyPowerShellWebTimeoutSpecified` を実装し、テストをパスさせる。
3. [x] 境界値・エッジケース（偽陽性防止、`powershell -Command` 経由等）を網羅。
4. [x] 全量テストの実行（全 128 テスト合格）。
5. [x] ドキュメント更新（README.md, walkthrough.md）。
