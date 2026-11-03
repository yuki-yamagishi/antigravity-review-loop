# Issue #7: Gemini 4 Argon (Medium) 向け開発ループ最適化・物理ガード強化・SSoT PR Body同期

## 1. 解決すべき課題・背景 (Why)

- **現在の問題点**:
  `antigravity-review-loop` を Gemini 4 Argon (Medium) 環境で運用するにあたり、現行ツール仕様との乖離および物理ガードの死角が以下の 5 点存在する：
  1. **PR Body の会話引きずり・陳腐化（Stale PR Body）**: エージェントが手書きで PR 本文を更新する際、「撤回」「勝手に」「指摘され」等の会話経緯語が仕様セクション（`## 主な変更点`）に混入する、あるいはコード修正コミット後に `walkthrough.md` や PR 本文が未同期のまま停止する問題がある。
  2. **現行ファイル編集ツールに対する設定改ざん防止の漏れ**: `hooks/safetyGuard.js` の `verifyConfigNotTampered` および `hooks.json` の `matcher` が旧ツール名（`write_to_file`, `replace_file_content`, `multi_replace_file_content`、引数 `TargetFile`）のみを対象としており、現行のネイティブツール `write_file` / `edit_file`（引数 `Path`）による `review-loop.config.json` の改ざんを物理阻止できない。
  3. **単一コマンド実行規約の物理ゲート欠如とプラグインルール構成**: セミコロン（`;`）、`&&`、`||`、パイプ（`|`）による複数コマンド連結禁止が `rules/single-command.md` のプロンプト指示にとどまり、`safetyGuard.js` による物理遮断がない。また、Antigravity 公式プラグイン仕様で推奨される `rules/AGENTS.md`（フロントマターなし）が未配置である。
  4. **Fleet レビュアー間のガードレール非対称性**: `fleet_completion_auditor.md` と `fleet_dor_auditor.md` には「反例提示の義務化（Counterexample Obligation）」「ゴールポスト移動の厳禁」「ゼロ件恐怖症の排除」が定義されているが、`fleet_reviewer.md` には同ガードレールが存在せず、主観的な指摘で再レビューが収束しにくいリスクがある。
  5. **Windows PowerShell 環境における `npm` 実行摩擦**: Windows PowerShell の ExecutionPolicy により `npm.ps1` が拒絶される環境において、スキルや Remediation Guidance に `npm.cmd` の案内がなく、初回実行ターンが無駄に消費される。
- **背景と真の動機**:
  ”Good intentions don't work. Mechanisms do.” の原則に基づき、Gemini 4 Argon (Medium) の高速な思考テンポを活かしつつ、設定改ざん・コマンド連結・PR Body 汚染・無限レビューループを物理的仕組み（Hooks & CLI & SSoT）で封じ込める。
- **放置した場合の影響**:
  1. エージェントが `write_file` / `edit_file` で `review-loop.config.json` を書き換えて安全制約をバイパスできる。
  2. Medium ティアの効率化バイアスにより複数コマンド連結が実行され、Allowlist 判定や監査ログの可観測性が損なわれる。
  3. PR 本文に試行錯誤の言い訳が混入し、または最新コミットと乖離したままセッションが終了する。
  4. `fleet_reviewer` が反例なき主観的指摘を出し続け、レビューループの収束性が低下する。

---

## 2. 変更内容の概要 (What)

1. **決定論的 PR Body 一発同期 CLI と監査・鮮度ガードの導入**:
   - `scripts/sync-pr-body.js`（および互換エントリ `scripts/generate-pr-body.js`）: `walkthrough.md`（SSoT）と `git diff --stat` から、`## 主な変更点`（恒久仕様のみ、経緯語サニタイズ）と `## レビュー対応履歴` を厳格に境界分離した PR Body（`.agents/pr_body.md`）を決定論的に生成・同期。
   - `hooks/prBodyAuditGate.js`（`PreToolUse`）: `gh pr create` / `gh pr edit` 実行時、`## 主な変更点` に経緯語（`撤回`, `勝手に`, `指摘され` 等）が含まれる場合に物理拒絶（または `autoOverwritePrBody: true` 時に自動置換）。
   - `hooks/prBodyStaleGuard.js`（`Stop` フック統合）: オープン PR が存在する状態で、最新コードコミットが `walkthrough.md` または PR Body（`SYNCED_COMMIT` / 更新時刻）より新しい場合に Stop を `continue` で拒絶。
2. **`safetyGuard.js` および `hooks.json` の現行ツール対応 & 単一コマンド物理ゲート化**:
   - `hooks.json`: `safety-guard` の `PreToolUse` `matcher` を `"run_command|write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content"` に拡張。
   - `hooks/safetyGuard.js`: `verifyConfigNotTampered` で `write_file` / `edit_file` および `args.Path || args.TargetFile` を検査対象に追加。
   - `hooks/safetyGuard.js`: `verifySingleCommandExecution` を新設し、クォート外の `;`、`&&`、`||`、`|` による複数コマンド連結を検知して `deny` する物理ゲートを実装。
3. **プラグインルール `rules/AGENTS.md` の整備**:
   - Antigravity 公式プラグイン仕様に準拠したフロントマターなしの `rules/AGENTS.md` を配置し、単一コマンド実行規約および品質ガバナンス原則を明記（既存の `rules/single-command.md` との整合維持）。
4. **`fleet_reviewer.md` への反例提示義務・粗探し防止ガードレールの統一**:
   - `agents/fleet_reviewer.md` に「過剰攻撃・粗探し防止ガードレール（反例提示の義務化、ゴールポスト移動の厳禁、ゼロ件恐怖症の排除と `[good]` 評価、スタイルの好みの `[must]`/`[should]` 化禁止）」を追加。
5. **Windows PowerShell 環境向け `npm.cmd` ガイダンスの補強**:
   - `hooks/safetyGuard.js` のテスト拒絶メッセージおよび `skills/dev-lifecycle/SKILL.md`、`skills/review-self-healing/SKILL.md` に PowerShell 環境での `npm.cmd` 実行に関する案内を明記。

---

## 3. 排除するリスク (Risks to Eliminate)

- **リスク 1: `write_file` / `edit_file` による設定ファイル改ざん**: 現行ツール名と `args.Path` を `hooks.json` および `safetyGuard.js` で捕捉し、エージェントによる `review-loop.config.json` 書き換えを物理遮断する。
- **リスク 2: クォート内文字の誤検知による単一コマンドガードの暴発**: URL や引数文字列（クォート内 `"a;b"` や `'a|b'`、またはリダイレクト `2>&1`）をコマンド連結と誤認しないよう、クォート状態を走査するパーサーで安全に判定する。
- **リスク 3: PR 本文の経緯語汚染およびコード修正後の更新忘れ**: `prBodyAuditGate.js` と `prBodyStaleGuard.js` により、不適切な PR 本文の送信と未同期状態でのセッション停止を物理ブロックする。
- **リスク 4: 主観的コードレビューによる無限ループ**: `fleet_reviewer.md` に反例提示義務を課し、客観的な破綻シナリオがない指摘によるブロックを排除する。

---

## 4. 設計方針・アーキテクチャ決定

- **クォート認識型コマンド連結検出 (`verifySingleCommandExecution`)**:
  - シングルクォート `'...'` およびダブルクォート `"..."` 内の文字、エスケープ文字を除外した上で、シェル演算子 `;`、`&&`、`||`、およびパイプ `|`（ただし `2>&1` 等のファイルディスクリプタ複製は除外）を検出して拒絶する。
- **SSoT 駆動の PR Body 管理**:
  - `walkthrough.md` を唯一の正本とし、`scripts/sync-pr-body.js` が `<!-- SYNCED_COMMIT: <hash> -->` メタデータを埋め込むことで、`prBodyStaleGuard.js` が決定論的に鮮度を検証できるようにする。
- **公式プラグイン規約準拠**:
  - `rules/AGENTS.md` をプレーン Markdown として配置し、プラグイン有効時に常時ルールとして確実にロードされる構造とする。

---

## 5. 受け入れ基準 (Acceptance Criteria / Definition of Done)

### 5.1. 機能受け入れシナリオ (Given-When-Then)

- **シナリオ 1: `write_file` / `edit_file` による設定ファイル改ざんの拒絶**
  - **Given**: エージェントが `write_file` または `edit_file` ツールを呼び出し、`args.Path` に `review-loop.config.json` または `.agents/review-loop.config.json` を指定する。
  - **When**: `safetyGuard.js`（`PreToolUse`）が実行される。
  - **Then**: `decision: 'deny'` が返され、設定ファイルの変更が物理的にブロックされる。

- **シナリオ 2: 複数コマンド連結の物理拒絶（異常系）とクォート内記号の許可（正常系・境界値）**
  - **Given**: エージェントが `run_command` ツールを実行する。
  - **When**: `git status ; git branch`、`git add . && git commit -m "msg"`、または `Get-ChildItem | Select-Object Name` のようにクォート外で `;`、`&&`、`||`、`|` を使用した場合。
  - **Then**: `safetyGuard.js` により `decision: 'deny'` が返され、単一コマンドに分割するよう Remediation Guidance が提示される。一方で、`git commit -m "fix: a; b & c | d"` や `node -e "console.log('a && b')"` のようにクォート内にのみ記号が含まれる場合は `decision: 'allow'` となる。

- **シナリオ 3: PR Body の経緯語混入拒絶と Stale PR Body 停止ガード**
  - **Given**: オープン PR が存在するブランチで作業している。
  - **When**: `gh pr create` / `gh pr edit` の `## 主な変更点` に「撤回」「指摘され」等の禁止用語が含まれる場合、または最新コードコミット後に `walkthrough.md` / PR Body を同期せず Stop しようとした場合。
  - **Then**: `prBodyAuditGate.js` が `deny`（または `autoOverwritePrBody` 有効時に自動置換）し、`prBodyStaleGuard.js` が Stop を `decision: 'continue'` でブロックする。

- **シナリオ 4: `fleet_reviewer.md` および `rules/AGENTS.md` の整備**
  - **Given**: プラグインの `agents/fleet_reviewer.md` と `rules/AGENTS.md` を参照する。
  - **When**: 内容と構造を検証する。
  - **Then**: `fleet_reviewer.md` に反例提示義務・ゴールポスト移動禁止・ゼロ件恐怖症排除のガードレールが含まれ、`rules/AGENTS.md` がフロントマターなしのプレーン Markdown として存在する。

### 5.2. PR作成前プロセス完了基準 (Pre-PR Process DoD)

- [x] 対象スコープの単体テストおよび E2E テストが作成され、100% PASS していること
- [x] プロジェクトの型検査・静的解析・品質ゲートが PASS していること
- [x] 関連ドキュメント（4軸ドキュメント: `issue.md`, `pre_verification.md`, `plan.md`, `walkthrough.md`）の整備・更新が完了していること

### 5.3. マージ前完了ゲート (Pre-Merge Gate)

- [ ] リモート CI（GitHub Actions 等）が PASS していること
- [ ] 独立サブエージェント合議レビュー（Code Reviewer & Completion Auditor）の LGTM を受領していること
- [ ] 人間（ユーザー）による最終確認とマージが実施されること
