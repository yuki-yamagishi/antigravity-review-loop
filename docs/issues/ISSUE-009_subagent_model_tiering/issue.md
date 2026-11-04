# Issue #9: feat: サブエージェントの役割別モデル適正配分とダウングレード設定 (subagentModels)

## 1. 解決すべき課題・背景 (Why)

- **現在の問題点**:
  - 現在の自律レビューループでは、サブエージェント（`fleet_dor_auditor`、`fleet_completion_auditor`、`fleet_reviewer`）のモデル指定が明確に階層化されておらず、親エージェントのモデル（`Model: "inherit"`）に一律委ねられている。
  - 親エージェントが高度な推論を要するタスクのために `Gemini 4 Argon`（`medium` / `low`）で起動されている場合、定型的なチェックリスト照合タスクである `fleet_dor_auditor`（5観点DoR監査）や `fleet_completion_auditor`（Given-When-Then照合）までもが Argon で実行され、高価な Argon トークンを過剰に消費してしまう。
- **背景と真の動機**:
  - 2026年11月現在の公式仕様において、Antigravity の標準モデルは `gemini-3.8-flash` であり、長期ソフトウェアエンジニアリングや自律エージェントの日常業務は Flash-High で十分にカバーできる。
  - 一方で、高難度の設計や反例提示を要するコード品質レビュー（`fleet_reviewer`）には Argon や親モデルの推論深度を活かす価値がある。
  - したがって、設定ファイルの変更なしに「定型監査 2 体は `flash` へ自動ダウングレードし、`fleet_reviewer` のみ親モデルを継承する」デフォルト挙動を提供し、かつ `review-loop.config.json` の `subagentModels` によりプロジェクトごとにカスタマイズ可能にする必要がある。
- **放置した場合の影響**:
  - 親エージェントを Argon で動かすたびに、定型的なドキュメント監査で Argon トークンが 3 重に消費され、運用コストと遅延が増大する。

---

## 2. 変更内容の概要 (What)

1. **`reviewLoopConfig.js` / `review-loop.config.json` における `subagentModels` 設定の追加**:
   - `subagentModels: { dorAuditor: "flash", completionAuditor: "flash", codeReviewer: "inherit" }` をデフォルトとしてサポート。
   - 各キー（`dorAuditor`, `completionAuditor`, `codeReviewer`）に `inherit` / `flash` / `flash_lite` / `pro` の許可値をバリデーション。
2. **`templates/review-loop.config.example.json` の更新**:
   - `subagentModels` の設定例とコメントを追加。
3. **`skills/pre-phase-dor/SKILL.md`、`skills/review-self-healing/SKILL.md`、`rules/AGENTS.md` の更新**:
   - サブエージェント起動時（`invoke_subagent`）に、設定された `subagentModels`（デフォルト: `dorAuditor` と `completionAuditor` は `flash`、`codeReviewer` は `inherit`）に従って `Model` 引数を渡す手順を規定。
4. **単体テストの拡充 (`tests/config.test.ts`)**:
   - `subagentModels` のデフォルト値取得、正常値バリデーション、異常値フォールバックのテストを追加。

---

## 3. 排除するリスク (Risks to Eliminate)

- **リスク 1: 不正なモデルティア指定による `invoke_subagent` 実行失敗**:
  - `inherit`, `flash`, `flash_lite`, `pro` 以外の文字列が指定された場合は、デフォルト値（`dorAuditor: "flash"`, `completionAuditor: "flash"`, `codeReviewer: "inherit"`）へ安全にフォールバックし、stderr に警告を出力して実行時エラーを防ぐ。
- **リスク 2: 既存 `review-loop.config.json` との後方互換性破壊**:
  - `subagentModels` が未定義の既存設定ファイルでも、デフォルト値が透過的に適用されるよう `cloneDefaults()` / `mergeConfig()` を設計する。

---

## 4. 設計方針・アーキテクチャ決定

- Antigravity 公式の `invoke_subagent` スキーマ（`enum: ["inherit", "flash_lite", "flash", "pro"]`）に厳格に準拠する。
- 設定層（`config/reviewLoopConfig.js`）を Single Source of Truth（SSoT）とし、スキーマバリデーションを実施する。

---

## 5. 受け入れ基準 (Acceptance Criteria / Definition of Done)

### 5.1. 機能受け入れシナリオ (Given-When-Then)

- **シナリオ 1: デフォルト設定の自動適用（正常系）**
  - **Given**: `review-loop.config.json` に `subagentModels` が未指定である
  - **When**: `loadConfig()` を実行する
  - **Then**: `config.subagentModels` が `{ dorAuditor: "flash", completionAuditor: "flash", codeReviewer: "inherit" }` を返すこと
- **シナリオ 2: カスタム設定の上書き（正常系）**
  - **Given**: `review-loop.config.json` に `{ "subagentModels": { "dorAuditor": "inherit", "codeReviewer": "inherit" } }` が定義されている
  - **When**: `loadConfig()` を実行する
  - **Then**: 指定されたキーが正しく上書きされ、未指定の `completionAuditor` はデフォルトの `"flash"` が維持されること
- **シナリオ 3: 不正値の拒絶と安全フォールバック（異常系）**
  - **Given**: `subagentModels` に無効なモデル名（例: `"unknown-model"` や数値など）が渡される
  - **When**: `loadConfig()` を実行する
  - **Then**: 警告が出力され、デフォルト値に安全にフォールバックされること

### 5.2. PR作成前プロセス完了基準 (Pre-PR Process DoD)

- [x] 対象スコープの単体テストが作成され、100% PASS していること
- [x] プロジェクトの型検査（`npx.cmd tsc --noEmit`）および全量テスト（`npm.cmd test -- --run`）が PASS していること
- [x] 4軸ドキュメント（`issue.md`, `pre_verification.md`, `plan.md`, `walkthrough.md`）の整備が完了していること

### 5.3. マージ前完了ゲート (Pre-Merge Gate)

- [ ] リモート CI（GitHub Actions 等）が PASS していること
- [ ] 独立サブエージェント合議レビュー（Code Reviewer & Completion Auditor）の LGTM を受領していること
- [ ] 人間（ユーザー）による最終確認とマージが実施されること
