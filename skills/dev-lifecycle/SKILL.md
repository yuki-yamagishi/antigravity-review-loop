---
name: dev-lifecycle
description: プロジェクトにおける実装・TDD高速反復・4軸ドキュメント作成・段階的コミット・品質ゲートの実行 Runbook。機能開発や改修時に使用する。
---

# 開発・TDD反復 Runbook (dev-lifecycle)

このスキルは、プロジェクトにおけるアーキテクチャ原則に準拠した実装、4軸ドキュメント整備、段階的コミット、およびフル品質ゲートの実行手順を定めます。

---

## 1. コア実装 & 4軸ドキュメント整備

1. **アーキテクチャ境界と関心分離の徹底**:
   - 純粋なビジネスロジック・ドメインモデルは UI や外部依存（フレームワーク、DB、外部通信等）から独立させ、100% 単体テスト可能を維持する（プロジェクトの `AGENTS.md` や ADR に定義された設計原則に準拠）。
2. **Issue フォルダ完結型ドキュメントの作成**:
   `docs/issues/ISSUE-XXX_<slug>/` 配下に以下の 4 ファイルを完全日本語で作成：
   - `issue.md`: Why・排除リスク・機能受け入れシナリオ (Given-When-Then)・受入基準
   - `pre_verification.md`: 事前検証ログ ＋ 重複・パッチワーク点検（Impact & Duplication Check）
   - `plan.md`: 実装計画書（変更ファイル一覧、実装内容、検証手順）
   - `walkthrough.md`: 実装成果レポート（作業完了時に成果を記録）
   ※ プラグイン同梱の `templates/template_issue.md` および `templates/template_pre_verification.md`（またはプロジェクト既存テンプレート）を雛形として活用すること。
3. **ルートポインタの更新 (運用されている場合)**:
   プロジェクトでルートポインタファイル（例: `docs/pre_phase_verification.md`, `docs/implementation_plan.md`, `docs/walkthrough.md` 等）を運用している場合は、対象 Issue フォルダを指すよう更新する。
4. **ADR（設計決定記録）の作成 (必要な場合)**:
   - アーキテクチャの変更や設計決定時は `docs/adr/000X-xxx.md` を作成し、インデックス一覧にも登録する。

---

## 2. Inner Loop（高速反復）と Outer Loop（品質ゲート）の分離

1. **Inner Loop（開発中・TDD高速反復）**:
   - 思考のテンポと開発生産性を極大化するため、軽微な修正のたびに全量テストや重いプロダクションビルドを実行しない。
   - **型チェック・構文検査の局所確認**:
     ```bash
     # 例: プロジェクトの高速型チェック
     npx tsc --noEmit
     ```
   - **対象テストファイルのダイレクト非対話実行**:
     ```bash
     # 例: 変更ファイルに関連するテストのみを指定して単発実行（ウォッチモード厳禁）
     npm test -- <対象テストパス> -- --run
     # またはプロジェクトの高速テスト用スクリプト（例: test:run, test:fast, test:related 等）
     npm run test:run <対象テストパス>
     ```

2. **段階的コミット (TDD中間コミット)**:
   - TDD の各フェーズ（Red/Green/Refactor）で論理的単位ごとにコミットを実施する。
   - コミット時は `issue.md` と `plan.md` が整備されていれば中間コミット可能。
   - Conventional Commits 規約に準拠（`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`）。

3. **Outer Loop（プッシュ前・Git Hook・CI）**:
   - リモートプッシュ前や PR レビュー時、および CI において、包括的な全量検査を実行し、リポジトリ全体の無破壊を保証する。
   - プロジェクトで定義された品質ゲートコマンドを実行する：
     ```bash
     # 例: 非対話フラグ付き全量テスト（safetyGuard で確実に許可される標準形式）
     npm test -- --run
     # またはプロジェクトのチェックコマンド（例: npm run check, npm run lint 等）
     npm run check
     ```

4. **リモートプッシュ**:
   ```bash
   git push origin <ブランチ名>
   ```
