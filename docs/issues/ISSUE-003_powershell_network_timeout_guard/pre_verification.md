# 事前検証ログ (Pre-Verification Log)

## 1. 実施日時
2026-09-30

## 2. 課題の整理
Issue #1 では `curl` / `curl.exe` に対するタイムアウト指定（`-m`, `--max-time`, `--connect-timeout`）を強制したが、Windows / PowerShell 環境において標準的に利用される `Invoke-WebRequest`、`Invoke-RestMethod`、およびその短縮エイリアス `iwr`、`irm` が監視から漏れていた。
エージェントが PowerShell でこれらをタイムアウト未指定で呼び出した場合、サーバー無応答によりプロセスが永久ハングする。

## 3. 重複・パッチワーク点検 (Impact & Duplication Check)
既存の `hooks/safetyGuard.js` における `verifyCurlTimeoutSpecified` の構造、正規表現、戻り値形式を横断調査した。
- 既存の `verifyCurlTimeoutSpecified` は `curl` の実行形式のみを検査しており、PowerShell コマンドレットには関与していない。
- パッチワーク的な場当たり修正（例: `verifyCurlTimeoutSpecified` に無理やり正規表現を詰め込む）を避け、責務を分離した `verifyPowerShellWebTimeoutSpecified` を新設してパイプラインに追加する。
- 共通の戻り値インターフェース `{ decision: 'allow' | 'deny', reason?: string }` を維持する。
- 既存の `handleSafetyGuard` パイプラインに組み込むことで、後方互換性と可読性を完全に保証する。
- 偽陽性対策（コミットメッセージや `firmware` のような部分一致防止）についても単語境界とコマンド先頭・ラッパー判定によって確実に対処する。

## 4. 影響範囲の特定
- 変更ファイル:
  - `hooks/safetyGuard.js`: PowerShell Web リクエストのタイムアウト検証ロジック追加
  - `tests/hooks.test.ts`: 新規テストケースの追加
  - `README.md`: セーフティガード機能の説明更新
