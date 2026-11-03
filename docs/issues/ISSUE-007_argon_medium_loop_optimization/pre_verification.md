# Issue #7 事前検証ログ (Pre-Phase Verification)

## 1. 現状調査・コードベース解析

- **対象コンポーネント**:
  - `hooks.json`: ライフサイクルフックのイベント・マッチャー定義
  - `hooks/safetyGuard.js`: コマンドおよびファイル操作の安全性検証フック
  - `hooks/prBodyAuditGate.js`, `hooks/prBodyStaleGuard.js`, `hooks/stopHook.js`: PR Body の品質・鮮度検証フック
  - `scripts/sync-pr-body.js`, `scripts/generate-pr-body.js`: SSoT（`walkthrough.md`）からの PR Body 決定論的生成スクリプト
  - `config/reviewLoopConfig.js`: 設定層ローダー（`codeDirs`, `disallowedPrBodyTerms`, `autoOverwritePrBody`）
  - `agents/fleet_reviewer.md`: コード品質レビューサブエージェントのシステムプロンプト
  - `rules/single-command.md`, `rules/AGENTS.md`: 単一コマンド実行規約とプラグイン標準ルール
  - `skills/dev-lifecycle/SKILL.md`, `skills/review-self-healing/SKILL.md`: 開発・レビューループ Runbook
- **既存の挙動**:
  - `safetyGuard.js` の `verifyConfigNotTampered` は `write_to_file`, `replace_file_content`, `multi_replace_file_content` と `args.TargetFile` のみをチェックしており、`write_file` / `edit_file`（`args.Path`）を見逃す。また `hooks.json` の `safety-guard` の `matcher` が `"run_command"` のみとなっている。
  - `safetyGuard.js` には単一コマンド実行規約（`;`, `&&`, `||`, `|` 禁止）を検証する物理ガードが存在しない。
  - `fleet_reviewer.md` には `fleet_completion_auditor.md` や `fleet_dor_auditor.md` に存在する「過剰攻撃・粗探し防止ガードレール（反例提示の義務化等）」が欠落している。
  - `prBodyAuditGate.js`, `prBodyStaleGuard.js`, `sync-pr-body.js` はワーキングツリーに未コミット状態で実装されており、テストスイート（189件）が PASS している。

---

## 2. 影響範囲の特定 (Impact Analysis)

- **変更対象ファイル**:
  - `hooks.json`
  - `hooks/safetyGuard.js`
  - `hooks/stopHook.js`
  - `hooks/prBodyAuditGate.js`
  - `hooks/prBodyStaleGuard.js`
  - `scripts/sync-pr-body.js`
  - `scripts/generate-pr-body.js`
  - `config/reviewLoopConfig.js`
  - `agents/fleet_reviewer.md`
  - `rules/AGENTS.md`
  - `skills/dev-lifecycle/SKILL.md`
  - `skills/review-self-healing/SKILL.md`
  - `templates/review-loop.config.example.json`
  - `README.md`
  - `package.json`, `tsconfig.json`
  - `tests/hooks.test.ts`, `tests/config.test.ts`, `tests/prBodyAuditGate.test.ts`, `tests/prBodyStaleGuard.test.ts`, `tests/syncPrBody.test.ts`
- **影響を受けるコンポーネント**:
  - `PreToolUse` フック（`run_command`, `write_file`, `edit_file` 呼び出し時のガード判定）
  - `Stop` フック（オープン PR 存在時の PR Body 鮮度検証）
  - サブエージェント `fleet_reviewer` のレビュー判定基準

---

## 3. 重複・パッチワーク点検 (Impact & Duplication Check)

- **既存の類似機能・共通基盤の有無**:
  - 設定ファイル改ざん防止は既に `safetyGuard.js` 内の `verifyConfigNotTampered` に実装されているため、別ファイルや別フックを乱立させるのではなく、既存の `verifyConfigNotTampered` と `hooks.json` の `safety-guard` マッチャーを拡張して一元管理する。
  - 単一コマンド検証も `safetyGuard.js` の検証パイプライン（`checks` 配列）に `verifySingleCommandExecution` として組み込むことで、すべての `run_command` に対して統一的に適用する。
  - PR Body の禁止用語リストは `config/reviewLoopConfig.js` の `disallowedPrBodyTerms` で一元定義し、`sync-pr-body.js` と `prBodyAuditGate.js` の双方から参照する設計とする。
- **過去の ADR / 設計決定との整合性**:
  - グローバル開発憲章の「1.1. Good intentions don't work. Mechanisms do.」「2.2. 客観的合議レビュー & 自己承認の物理禁止」「3.1. 内外分離」「3.2. 単一コマンド実行規約」に完全整合する。
- **根本的解決（リファクタリング含む）の妥当性判断**:
  - プロンプトでの注意喚起にとどまっていた単一コマンド規約や現行ファイル編集ツールの監査漏れを、フックによる物理的拒絶メカニズムへ昇華させる根本的解決である。

---

## 4. 事前検証手順と結果

- **検証項目**:
  - 既存テストスイートの実行確認
  - テストケース内の `run_command` ペイロードにおける単一コマンド規約との整合性確認
- **実行コマンド / 手順**:
  - `npm.cmd test -- --run` を実行し、既存 11 テストファイル（189 テスト）の動作を確認。
  - `tests/hooks.test.ts` 内で `handleSafetyGuard` に渡されているテスト用コマンド文字列を調査（`git checkout main && git pull` のような連結コマンドが他のガード検証用テストデータに含まれていないか確認）。
- **検証結果**:
  - `npm.cmd test -- --run` は 189 件すべて PASS。
  - `tests/hooks.test.ts` の `safetyGuard` テスト群を確認し、単一コマンドガード追加時に既存テストケースと干渉しない順序・テストケース設計を行えることを確認した。
