# Issue #3: safetyGuard における PowerShell HTTP コマンド (Invoke-WebRequest / Invoke-RestMethod) のタイムアウト未指定遮断

## 1. 解決すべき課題・背景 (Why)
Issue #1 において、タイムアウト未指定の `curl` コマンドを物理遮断する安全フック（`safetyGuard.js`）を導入した。
しかし、その監視対象が `curl` / `curl.exe` のみとなっており、PowerShell ネイティブの HTTP コマンドレットである `Invoke-WebRequest` および `Invoke-RestMethod`（ならびにそのエイリアス `iwr`, `irm`）が監視対象から完全に漏れていた（仕組みの抜け穴）。
その結果、自律エージェントが PowerShell 上でタイムアウトを指定せずにこれらのコマンドを実行した場合にフックが `allow` を返してしまい、リモートサーバーの無応答や遅延に対して PowerShell プロセスが無期限に応答を待機して永久ハング状態に陥る事象が発生した。

## 2. 変更内容の概要 (What)
1. `hooks/safetyGuard.js`:
   - `Invoke-WebRequest`、`Invoke-RestMethod`、およびエイリアス `iwr`、`irm`（直接実行、変数代入文 `$res = ...`、および `powershell`/`pwsh -Command` 経由）を監視対象に追加。
   - `-TimeoutSec` フラグが未指定、または無期限待機を意味する `0` が指定された場合に物理拒絶（`deny`）し、1 秒以上の正の整数タイムアウト設定を強制する。
   - コマンドラインの偽陽性（コミットメッセージや文字列内の単語）を防止する境界判定を実装。
2. `tests/hooks.test.ts`:
   - PowerShell ネイティブ HTTP コマンドのタイムアウト有無判定、無効値（`0` 秒）遮断、変数代入構文、ラッパー経由実行、および偽陽性防止のテストケースを追加。
3. ドキュメント（README.md のセーフティガード仕様）の更新。

## 3. 排除するリスク (Risks to Eliminate)
- PowerShell ネイティブコマンド（`Invoke-WebRequest`, `Invoke-RestMethod`, `iwr`, `irm`）のタイムアウト未指定実行による無期限プロセスハング。
- `-TimeoutSec 0`（無期限待機）指定によるタイムアウト設定の形骸化およびプロセスハング。
- 変数代入構文（`$res = Invoke-RestMethod ...`）やラッパー呼び出し（`powershell -Command "..."`）による検知すり抜け。
- コミットメッセージや出力先パス等に `iwr` や `irm` が含まれる場合の誤遮断（偽陽性）。

## 4. 設計方針
- `hooks/safetyGuard.js` において、`verifyPowerShellWebTimeoutSpecified` を新設し、PowerShell ネイティブの HTTP コマンド呼び出し（直接実行、変数代入文、および `powershell`/`pwsh` の `-Command` / `-c` 呼び出し）を正確に検知する。
- タイムアウト指定フラグとして `-TimeoutSec` の後に続く値が 1 以上の正の整数（`[1-9]\d*`）であることを検証する。セパレータは空白（`-TimeoutSec 10`）、コロン（`-TimeoutSec:10`）、イコール（`-TimeoutSec=10`）を許容する。値が `0` の場合は無期限待機となるため明示的に拒絶する。
- コマンド名やエイリアスが単語の一部（例: `firmware`）や引用符内の引数（例: `git commit -m "fix iwr"`）として使用されている場合の誤遮断を境界判定によって完全に防止する。

## 5. 受け入れ基準 (Acceptance Criteria / DoD)

### 5.1. 機能受け入れシナリオ (Given-When-Then)
- **シナリオ 1: タイムアウト未指定 PowerShell HTTP コマンドの遮断**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: タイムアウト未指定の `Invoke-WebRequest https://example.com`、`iwr https://example.com`、`Invoke-RestMethod https://api.example.com`、`irm https://api.example.com` を直接実行しようとする。
  - **Then**: `safetyGuard.js` により `deny` され、`-TimeoutSec <seconds>`（1 秒以上の正の整数）の指定を促すエラーメッセージが返る。
- **シナリオ 2: powershell/pwsh ラッパー経由のタイムアウト未指定遮断**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: `powershell -Command "Invoke-RestMethod https://api.example.com"` や `pwsh -c "iwr https://example.com"` を実行しようとする。
  - **Then**: `safetyGuard.js` により `deny` される。
- **シナリオ 3: タイムアウト指定済みコマンドの許可**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: `Invoke-WebRequest -TimeoutSec 10 https://example.com`、`iwr -TimeoutSec 5 https://example.com`、`Invoke-RestMethod -TimeoutSec:30 https://api.example.com`、`irm -TimeoutSec=15 https://api.example.com` を実行する。
  - **Then**: `safetyGuard.js` により `allow` される。
- **シナリオ 4: 誤検知（偽陽性）の防止**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: `git commit -m "fix: iwr handling"` や `echo "firmware update"` を実行する。
  - **Then**: `safetyGuard.js` により `allow` される。
- **シナリオ 5: 無効なタイムアウト値（0 秒）の拒絶**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: `Invoke-WebRequest -TimeoutSec 0 https://example.com` や `iwr -TimeoutSec:0 https://example.com` を実行しようとする。
  - **Then**: `safetyGuard.js` により `deny` され、1 秒以上の正の整数を指定するよう促すエラーメッセージが返る。
- **シナリオ 6: 変数代入を伴うコマンドレット呼び出しのタイムアウト未指定遮断**
  - **Given**: 自律エージェントが `run_command` を呼び出す。
  - **When**: `$res = Invoke-RestMethod https://api.example.com` や `powershell -Command "$data = iwr https://example.com"` を実行しようとする。
  - **Then**: `safetyGuard.js` により `deny` される。

### 5.2. PR作成前プロセス完了基準 (Pre-PR Process DoD)
- [x] Fast TDD による単体テスト通過
- [x] 全テストスイートが 100% 合格
- [x] 第三者サブエージェント合議レビュー（Code Reviewer & Completion Auditor）LGTM 受領

### 5.3. マージ前完了ゲート (Pre-Merge Gate)
- [ ] CI パス
- [ ] ユーザーによる最終マージ承認
