# 作業成果レポート (Walkthrough) - Issue #5: プラグインの抽象化・設定層導入とDoR/安全ガードの是正

## 1. 概要
特定プロジェクト名（JobEval）の残存排除にとどまらず、レビュー指摘事項（Must 2件、Should 4件、Process 2件、Nits）に基づき、プラグインとしての抽象化・責務分離の甘さを包括的に是正した。

## 2. 成果物一覧

1. **設定層（Config Layer）の実装 & ガード配線**:
   - `config/reviewLoopConfig.js`: ホストプロジェクトの設定ファイル探索（優先順: `review-loop.config.json` > `.agents/review-loop.config.json` > `.review-loop.json`）を行い、安全な相対パスバリデーション（`..` 拒絶）、配列型検査、デフォルトフォールバックを実装。
   - `templates/review-loop.config.example.json`: 設定ファイルの標準サンプルを同梱。
   - `tests/config.test.ts`: 優先度解決、不正パス遮断、空配列拒絶を含む単体テスト（7件、100% PASS）。
2. **エージェントによる設定改ざんの物理防止 (Hardened Guard)**:
   - `hooks/safetyGuard.js`: 自律エージェントが安全制約や DoR ゲートを勝手に緩和・無力化することを防ぐため、ファイル書き込みツール（`write_to_file`, `replace_file_content`, `multi_replace_file_content`）およびシェルコマンド（`rm`, `Set-Content` 等）による `review-loop.config.json` の変更を物理拒絶（`verifyConfigNotTampered`）。
3. **DoR テンプレート未記入検知の強化 & 設定配線 (Must 2 & Should 7)**:
   - `hooks/branchDoRGate.js`: 英字プレースホルダー（`<ISSUE_NUMBER>` 等）および空欄項目（`- **現在の問題点**: ` 等）を確実に検出してブランチ作成を拒絶。
   - `readyLabels` の判定において固定正規表現 OR を排除し、設定値（デフォルト: `status: ready`, `status: in-progress`）に正しく準拠。
   - `findPluginRoot` を用いた動的テンプレート相対パスの案内。
   - `templates/template_issue.md`, `templates/template_pre_verification.md`: プレースホルダー記法を堅牢に標準化。
4. **safetyGuard の非対話テスト判定精緻化 (Must 1 & Must 3)**:
   - `hooks/safetyGuard.js`: npm のフラグ解釈に合わせ、`--` 以降に渡された非対話フラグ（`-- --run`, `-- --watch=false` 等）および非対話スクリプト（`test:run` 等）を正確に認識。`--` のない `npm test --watch=false` 等の誤ったフラグ渡しは確実に拒絶。
   - `skills/dev-lifecycle/SKILL.md`, `skills/review-self-healing/SKILL.md`: ガイダンスで案内するコマンドを `npm test -- --run` 等の安全な非対話コマンドに統一。
5. **Pre-PR ゲートの設定層完全配線 (Hooks Wiring)**:
   - `hooks/prePrAuditGate.js`: `config.requiredAxisDocs`、`config.adrDir`、`config.ssotFile` を受け取り、設定されたドキュメント群および SSOT/ADR パスを動的に検証。
6. **Issue ディレクトリ探索の共通化 & プロジェクトルート復元 (Nits & Should 5/8)**:
   - `hooks/hookUtils.js`: `findIssueDir` および `findPluginRoot` を新設・集約。`findProjectRoot` は `.git` かつ `package.json` が存在するディレクトリ（AND 条件）に厳密化。
7. **プラグインパス動的解決 & ガイダンス汎用化**:
   - `state/loopState.js`: `resolveScriptCliPath` ヘルパーを新設し、ホストプロジェクトのプラグイン配置に応じた相対パス（`.agents/plugins/antigravity-review-loop/...` 等）を動的に解決。
   - `skills/review-self-healing/SKILL.md`: ドキュメント内の実行パスを汎用化（`<プラグインパス>`）し、配置場所に応じた注記を追加。
8. **正規表現エスケープの厳格化 & 見出し・プレースホルダー定数テーブル化**:
   - `hooks/branchDoRGate.js`: `escapePathForRegex` を実装し、特殊文字（`.` や `+`）を含む `issuesDir` に対しても安全に動作するよう保護。セクション見出しやプレースホルダーの正規表現を定数テーブルとしてエクスポート。
9. **フック共通ユーティリティの単体テスト新設**:
   - `tests/hookUtils.test.ts`: `findProjectRoot`（モノレポ誤認防止、`.git` + `package.json` AND 条件、`.agents` スキップ）、`findPluginRoot`、`findIssueDir` の包括的単体テスト（6件、100% PASS）。
10. **改行コードの正規化 (Process 8)**:
   - `.gitattributes`: クロスプラットフォーム開発における改行コード正規化（LF）ルールを定義し、`git add --renormalize .` を実行。
11. **言語中立化・クリーンアップ**:
   - `agents/fleet_reviewer.md`: TypeScript 固定から言語中立な型安全性観点へ抽象化。
   - `state/loopState.js`: 未実在の古い ADR 参照コメントを整理。

## 3. 検証結果

- `npm.cmd test`: 全 8 テストファイル、**152 件のテストが 100% PASS**。
- `JobEval` の残存検索: 0件（完全排除確認）。
- テンプレートそのままコピー時のブランチ作成拒絶: 正常にブロックされることを確認。
- 設定ファイル改ざん防止: ツール呼び出し・シェルコマンドともに正常に拒絶されることを確認。
- 非対話テストコマンド判定: 引数付き（`npm test -- tests/hooks.test.ts --run` 等）や `--` の有無による判定精緻化を確認。
- 特殊パス・モノレポ・モック環境での決定論的動作確認。
