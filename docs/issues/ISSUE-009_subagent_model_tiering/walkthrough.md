# 作業成果レポート (Walkthrough) - Issue #9: サブエージェントの役割別モデル適正配分とダウングレード設定 (subagentModels)

## 1. 概要
親エージェントが高度推論（`Gemini 4 Argon` 等）で実行されている場合でも、定型チェック（`fleet_dor_auditor`, `fleet_completion_auditor`）で高価なトークンを浪費しないよう、デフォルトで `flash` への自動ダウングレードを適用し、深いコード品質レビュー（`fleet_reviewer`）のみ親モデル（`inherit`）を継承する仕組みを導入した。また、`review-loop.config.json` の `subagentModels` によりプロジェクトごとにカスタマイズ可能とした。

## 2. 主な変更点

1. **`reviewLoopConfig.js` / `review-loop.config.json` における `subagentModels` サポート**:
   - `subagentModels: { dorAuditor: 'flash', completionAuditor: 'flash', codeReviewer: 'inherit' }` をデフォルトとして定義。
   - `inherit`, `flash`, `flash_lite`, `pro` の 4 ティアを安全に検証し、無効値は安全にフォールバック。
2. **テンプレート・スキルドキュメント・ルールの整備**:
   - `templates/review-loop.config.example.json`、`skills/issue-lifecycle/SKILL.md`、`skills/review-self-healing/SKILL.md`、`rules/AGENTS.md` にサブエージェントモデル指定規約を明記。
3. **テストと型定義の整備**:
   - `tests/config.test.ts`、`tests/env.d.ts` にテストと型定義を追加。

## 3. レビュー対応履歴

| レビュアー | 指摘内容 (Must/Should) | 対応コミット | 対応概要 |
|---|---|---|---|
| `fleet_dor_auditor` | *指摘なし (`READY_TO_BRANCH`: 5観点すべて `[good]` 評価)* | - | Pre-Phase 要件定義・Given-When-Then シナリオ一発合格 |

## 4. 検証結果

- `npx.cmd tsc --noEmit`: エラー 0 件（Exit Code 0）で PASS。
- `npm.cmd test -- --run`: 全 11 テストファイル、197 件のテストが PASS。
  - `tests/config.test.ts` (10 tests PASS): `subagentModels` のデフォルト値取得、部分上書き、不正値フォールバックのテストを含む。
  - その他既存テストスイート全件 PASS。
