# Issue #9 事前検証ログ (Pre-Phase Verification)

## 1. 現状調査・コードベース解析

- **対象コンポーネント**:
  - `config/reviewLoopConfig.js`: 設定ローダー・パーサー・バリデーター
  - `templates/review-loop.config.example.json`: 設定雛形
  - `skills/pre-phase-dor/SKILL.md`: `fleet_dor_auditor` 起動フロー
  - `skills/review-self-healing/SKILL.md`: `fleet_reviewer` および `fleet_completion_auditor` 起動フロー
  - `rules/AGENTS.md`: プラグイン全体の常時適用ルール
- **既存の挙動**:
  - `config/reviewLoopConfig.js` の `DEFAULTS` には `subagentModels` が存在しない。
  - 各スキルおよびエージェント起動ドキュメントでは、モデル引数の指定が明記されておらず、暗黙的に `inherit` のみとなっていた。

---

## 2. 影響範囲の特定 (Impact Analysis)

- **変更対象ファイル**:
  - `config/reviewLoopConfig.js`: `DEFAULTS` への `subagentModels` 追加、`mergeConfig` のバリデーション追加
  - `templates/review-loop.config.example.json`: `subagentModels` フィールド追加
  - `skills/pre-phase-dor/SKILL.md`: `Model: "flash"` 指定の明記
  - `skills/review-self-healing/SKILL.md`: `fleet_dor_auditor: "flash"`, `fleet_completion_auditor: "flash"`, `fleet_reviewer: "inherit"` の手順明記
  - `rules/AGENTS.md`: サブエージェント起動時のモデルティア規約の明記
  - `tests/config.test.ts`: 設定読み込み・バリデーションテスト追加
  - `tests/env.d.ts`: 型定義更新
- **影響を受けるコンポーネント**:
  - サブエージェント起動処理を行う親エージェントおよび設定読み込み層。他の Hook ロジック（`safetyGuard.js`、`prBodyAuditGate.js` 等）への破壊的影響はない。

---

## 3. 重複・パッチワーク点検 (Impact & Duplication Check)

- **既存の類似機能・共通基盤の有無**:
  - `reviewLoopConfig.js` はすでに `allowedTestCommands`、`issuesDir`、`codeDirs` 等のキーに対して安全なデフォルト値・部分マージ・バリデーション・警告出力を備えている。
  - 今回の `subagentModels` もこの既存の `mergeConfig` パターンをそのまま拡張して実装するため、車輪の再発明や場当たり的なパッチワークは一切発生しない。
- **過去の ADR / 設計決定との整合性**:
  - 「設定ファイル改ざん防止（`safetyGuard.js`）」および「SSoT 駆動の決定論的設定解決」の方針に完全に合致する。
- **根本的解決（リファクタリング含む）の妥当性判断**:
  - ハードコードでのダウングレードではなく、中央設定層（`reviewLoopConfig.js`）でデフォルト値を担保しつつプロジェクト単位で上書き可能にする設計であり、高い拡張性と保守性を備える。

---

## 4. 事前検証手順と結果

- **検証項目**: 既存テストスイートの健全性確認
- **実行コマンド / 手順**: `npm.cmd test -- --run`
- **検証結果**: 全 11 テストファイル、196 件すべて PASS を確認済み。
