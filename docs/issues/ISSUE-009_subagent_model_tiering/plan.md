# 実装計画書 (Implementation Plan) - Issue #9: サブエージェントの役割別モデル適正配分とダウングレード設定 (subagentModels)

## 1. 概要
親エージェントが高度推論（`Gemini 4 Argon` 等）で実行されている場合でも、定型チェック（`fleet_dor_auditor`, `fleet_completion_auditor`）で高価なトークンを浪費しないよう、デフォルトで `flash` への自動ダウングレードを適用し、深いコード品質レビュー（`fleet_reviewer`）のみ親モデル（`inherit`）を継承する仕組みを導入する。また、`review-loop.config.json` の `subagentModels` によりプロジェクトごとに上書き可能とする。

---

## 2. 変更予定ファイル一覧

1. `config/reviewLoopConfig.js`:
   - `DEFAULTS` に `subagentModels: { dorAuditor: 'flash', completionAuditor: 'flash', codeReviewer: 'inherit' }` を追加。
   - `VALID_SUBAGENT_MODELS`（許可値: `'inherit' | 'flash' | 'flash_lite' | 'pro'`）を定義。
   - `mergeConfig` にてキーごとのマージとフォールバック処理を実装。
2. `hooks.json` & `hooks/safetyGuard.js`:
   - `hooks.json` の `safety-guard` `PreToolUse` `matcher` に `invoke_subagent|start_subagent` を追加。
   - `hooks/safetyGuard.js` に `detectSubagentRoleKey` と `verifySubagentModelTier` を追加し、`config.subagentModels` に基づき `Model` 引数を `overwrite` で物理強制。
3. `templates/review-loop.config.example.json`:
   - `subagentModels` の設定例を追加。
4. `tests/env.d.ts`:
   - `reviewLoopConfig.js` および `safetyGuard.js` の型定義を更新。
5. `tests/config.test.ts` & `tests/hooks.test.ts`:
   - デフォルト値の検証、部分上書きの検証、無効値指定時のフォールバック、および `safetyGuard.js` による `PreToolUse` `overwrite` の単体テストを追加。
6. `skills/issue-lifecycle/SKILL.md` / `skills/review-self-healing/SKILL.md` / `rules/AGENTS.md`:
   - `invoke_subagent` 実行時のモデルティア指定規約および物理強制を明記。
7. `docs/issues/ISSUE-009_subagent_model_tiering/walkthrough.md`:
   - 実装成果と検証結果を記録。

---

## 3. 実装ステップ

### Step 1: `config/reviewLoopConfig.js` の拡張
- `VALID_SUBAGENT_MODELS = new Set(['inherit', 'flash', 'flash_lite', 'pro'])` を定義。
- `cloneDefaults()` および `mergeConfig()` にて `subagentModels` を統合。

### Step 2: 型定義と単体テストの実装
- `tests/env.d.ts` に `subagentModels` の型を反映。
- `tests/config.test.ts` にテストケースを追加。
- `npm.cmd test -- tests/config.test.ts --run` および `npx.cmd tsc --noEmit` で検証。

### Step 3: テンプレートおよびスキルドキュメントの更新
- `templates/review-loop.config.example.json` に設定例を追加。
- `skills/pre-phase-dor/SKILL.md`、`skills/review-self-healing/SKILL.md`、`rules/AGENTS.md` にサブエージェントモデル指定のガイドラインを追記。

### Step 4: 全量回帰テストと成果物レポート作成
- `npm.cmd test -- --run` および `npx.cmd tsc --noEmit` を実行。
- `walkthrough.md` を作成。

---

## 4. 検証手順

1. 単体テスト: `npm.cmd test -- tests/config.test.ts --run`
2. 型検査: `npx.cmd tsc --noEmit`
3. 全量テスト: `npm.cmd test -- --run`
