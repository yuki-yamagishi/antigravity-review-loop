# Issue #5 事前検証ログ (Pre-Phase Verification)

## 1. 現状調査・コードベース解析

- **対象コンポーネント**: 
  - `hooks/branchDoRGate.js`: DoR ゲート検証、未記入プレースホルダー検知ロジック
  - `hooks/safetyGuard.js`: 非対話テスト実行判定ロジック、PowerShell/curl タイムアウトガード
  - `hooks/hookUtils.js`: プロジェクトルート解決、Issue ディレクトリ解決ロジック
  - `templates/template_issue.md`, `templates/template_pre_verification.md`: 標準テンプレート
  - `skills/*`, `agents/*`: スキル・サブエージェントプロンプト
- **既存の挙動**: 
  - `branchDoRGate.js` の `placeholderPatterns` は日本語ベース中心であり、`<ISSUE_NUMBER>` やコロン直後の空欄行を素通りさせてしまう。
  - `safetyGuard.js` は `npm test` を一律でブロックし、引数解釈（`--` の有無）も考慮していないため、非対話指定との整合が崩れている。
  - プラグイン側の設定注入機構がなく、プロジェクト固有の規約がハードコードされている。

---

## 2. 影響範囲の特定 (Impact Analysis)

- **変更対象ファイル**: 
  - `config/reviewLoopConfig.js` (新規)
  - `hooks/branchDoRGate.js`
  - `hooks/safetyGuard.js`
  - `hooks/hookUtils.js`
  - `templates/template_issue.md`
  - `templates/template_pre_verification.md`
  - `.gitattributes` (新規)
  - `tests/hooks.test.ts`
  - `tests/config.test.ts` (新規)
- **影響を受けるコンポーネント**: 
  - ライフサイクルフック実行時の判定処理
  - 既存のフック単体テストスイート

---

## 3. 重複・パッチワーク点検 (Impact & Duplication Check)

- **既存の類似機能・共通基盤の有無**: 
  - Issue ディレクトリ解決ロジックが `branchDoRGate.js` と `prePrAuditGate.js` で重複してインライン実装されていたため、`hookUtils.findIssueDir(issuesDir, issueNum)` に共通化・集約する。
  - 設定の解決についても、各フックが個別に環境変数を参照する場当たり的なパッチワークを避け、単一の `reviewLoopConfig.js` から一括取得するクリーンな設計にする。
- **過去の ADR / 設計決定との整合性**: 
  - 単一コマンド実行原則、非対話実行原則、Why-First 原則、客観的合議レビュー原則に完全に合致。
- **根本的解決（リファクタリング含む）の妥当性判断**: 
  - 表層的な文字列置換や場当たり的な if 文の追加ではなく、設定層の新設・バリデーションの一般化・重複のユーティリティ集約という根本的リファクタリングを実施する。

---

## 4. 事前検証手順と結果

- **検証項目**: 
  - `npm.cmd test` による既存テストの正常動作確認
  - `gh issue view 5` によるリモート Issue の存在と `status: ready` の確認
- **実行コマンド / 手順**: 
  - `npm.cmd test` -> 128 tests PASS
  - `gh issue view 5 --json state,labels` -> state: OPEN, labels: [status: ready]
- **検証結果**: 
  - 基盤環境は完全に正常であり、リファクタリングに着手可能な状態を確認。
