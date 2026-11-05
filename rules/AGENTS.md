# Antigravity Review Loop Rules

本プラグイン（`antigravity-review-loop`）が有効なワークスペースでは、以下の実行規約および品質ガバナンス原則を常時遵守すること。

## 1. 単一コマンド実行規約 (Single Command Execution)

シェルコマンド（`run_command` ツール等）を実行する際は、以下のルールを厳格に遵守すること（違反時は `safetyGuard.js` により物理拒絶される）：

1. **複数コマンドの連結禁止**:
   - PowerShell のセミコロン（`;`）、`&&`、`||`、またはパイプ（`|`）を用いて複数のコマンドを 1 行に連結して実行してはならない。
2. **単一コマンド実行の義務化**:
   - 1 回のツール呼び出しにつき、必ず単一のコマンド（例: `git status` のみ、`git branch -a` のみ）として個別に実行すること。
3. **Windows PowerShell 環境での `npm` 実行**:
   - Windows PowerShell 環境で ExecutionPolicy により `npm`（`npm.ps1`）の実行が拒絶される場合は、`npm.cmd`（例: `npm.cmd test -- --run`）および `npx.cmd` を使用すること。

## 2. 自律レビューループ・ガバナンス原則

1. **設定ファイルの改ざん禁止**:
   - `review-loop.config.json`（または `.agents/review-loop.config.json`、`.review-loop.json`）をエージェントが `write_file`、`edit_file`、またはシェルコマンドで変更することは物理的に禁止されている。
2. **非対話テスト実行の徹底**:
   - `npm test` 実行時はウォッチモードによるプロセスハングを防ぐため、必ず `--` 以降に非対話フラグを渡すこと（例: `npm test -- --run` または `npm.cmd test -- --run`）。
3. **SSoT 駆動の PR Body 同期**:
   - PR 本文は手書きせず、必ず正本である `walkthrough.md` を更新した上で `node <プラグインパス>/scripts/sync-pr-body.js`（更新時は `--update-pr`）を実行して決定論的に同期すること。
4. **サブエージェントモデルの階層化 (subagentModels) と物理強制**:
   - サブエージェント起動時は `review-loop.config.json`（`config/reviewLoopConfig.js`）の `subagentModels` に準拠すること（`safetyGuard.js` の `PreToolUse` フックにより、`invoke_subagent` / `start_subagent` 実行時に `Model` 引数が `subagentModels` に自動上書き（`overwrite`）される）。
   - `fleet_dor_auditor` および `fleet_completion_auditor` はデフォルトで `Model: "flash"` にダウングレードし、親エージェントが高度推論モデル（Argon 等）の場合でも定型チェックでのトークン消費を抑える。
   - `fleet_reviewer` は `Model: "inherit"` を使用し、親モデルの推論深度を継承して具体的な反例を構築すること。
   - **過去のサブエージェント流用時の注意**: 既に別のモデル設定（例: `Model: "inherit"`）で起動された古いサブエージェントに対して `send_message` を送ると、起動時のモデルが維持されてしまうため、モデルティアが異なる場合は既存のサブエージェントに `send_message` せず、必ず `invoke_subagent` で所定の `Model` を指定して新規起動すること。
5. **人間による最終マージ専権**:
   - `gh pr merge` の直接実行は禁止されている。Fleet 2 者（`fleet_reviewer` & `fleet_completion_auditor`）双方の `LGTM` 獲得と CI 合格を確認した後、ユーザーにマージを依頼すること。
