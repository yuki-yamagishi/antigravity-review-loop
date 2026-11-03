# Antigravity Review Loop (`antigravity-review-loop`)

[![CI](https://github.com/yuki-yamagishi/antigravity-review-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/yuki-yamagishi/antigravity-review-loop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Autonomous self-healing PR review loop & quality governance plugin for Google Antigravity.**

Antigravity 公式プラグイン仕様（`plugins/<plugin-name>/plugin.json`）に完全準拠した、AIペアプログラミング向け自律レビューループ＆品質ガバナンス機構です。

---

## 🌟 主な機能 (Key Features)

1. **物理ライフサイクルフック (`hooks.json`)**:
   - `branchDoRGate.js`: ブランチ作成前の Definition of Ready（DoR: GitHub Issue状態/ラベル、Why・排除リスク・Given-When-Then受入シナリオ・テンプレート未記入検知）および作業ツリーのクリーン性を物理強制。
   - `safetyGuard.js`: 自律エージェントによる `gh pr merge` の直接実行（人間による最終マージ専権の侵害）、対話型テストによるハング、およびタイムアウト未指定のネットワークコマンド（`curl`、PowerShell の `Invoke-WebRequest` / `Invoke-RestMethod` / `iwr` / `irm`）を物理遮断。
   - `prePrAuditGate.js`: PR作成前の4軸ドキュメント（issue, pre_verification, plan, walkthrough）およびPre-PR DoDの未完了チェックを物理検証。
   - `prBodyAuditGate.js`: `gh pr create` / `gh pr edit` 実行時、PR Body の「## 主な変更点」に会話引きずりパターン（「撤回」「勝手に」「指摘され」等の経緯語）が混入することを物理検知・拒絶（または `overwrite` による自動置換）。
   - `stopHook.js` / `prBodyStaleGuard.js`: PR作成後、レビューループ未解決時の早期停止をブロックするとともに、最新のコードコミットが `walkthrough.md` や PR Body より新しい場合（Stale PR Body）のセッション終了を物理拒絶。
   - `postPrCreate.js`: PR作成成功時にループ状態マシンを自動で `PR_CREATED` に遷移。

2. **決定論的 PR Body 一発同期 CLI (`scripts/sync-pr-body.js`)**:
   - `walkthrough.md`（設計・成果の正本）＋ Git 実差分（`git diff --stat origin/main...HEAD`）から、恒久的な仕様差分（`## 主な変更点`）とレビュー対応履歴（`## レビュー対応履歴`）を厳格に境界分離したクリーンな PR Body を決定論的に一発再生成。

3. **独立サブエージェント合議制 (`agents/`)**:
   - `fleet_dor_auditor`: Pre-Phase（ブランチ前）の要件定義・DoR・Why・受入シナリオを厳格に監査。
   - `fleet_reviewer`: コード品質・型安全性・設計原則・セキュリティを客観的に精査する専門レビュアー。
   - `fleet_completion_auditor`: Issue の Why・排除リスク・受け入れ基準（DoD）の達成度を反証的かつ公正に検証する批判的完了性監査役。

4. **段階的開示スキル群 (`skills/`)**:
   - `issue-lifecycle`: Definition of Ready（DoR）および Issue 着手・ブランチ作成プロトコル。
   - `dev-lifecycle`: TDD高速反復・4軸ドキュメント・段階的コミット・品質ゲート Runbook。
   - `review-self-healing`: PR作成、CI監視、Fleetレビュー受領、指摘自己修復（`resolveReview`）、PR Body 同期（`sync-pr-body`）、解決報告、マージ依頼プロトコル。

5. **単一コマンド実行規約 & プラグイン常時ルール (`rules/`)**:
   - `AGENTS.md` / `single-command.md`: シェルコマンド連結（`;`, `&&`, `||`, `|`）を禁止し（`safetyGuard.js` でも物理遮断）、セキュリティ監査性と自動承認精度を維持。

6. **柔軟な設定層によるホスト固有ルールの注入 (`config/`)**:
   - `review-loop.config.json`（または `.agents/review-loop.config.json`）を配置することで、プロジェクト固有の非対話テストコマンド許可リスト（`allowedTestCommands`）、Issue 格納先（`issuesDir`）、DoR ラベル（`readyLabels`）、監視コードディレクトリ（`codeDirs`）、PR Body 禁止用語（`disallowedPrBodyTerms`）などを自由にカスタマイズ可能。

---

## 🚀 導入方法 (Installation)

### 方式 1: Git Submodule としてプロジェクトに導入 (推奨)

プロジェクトのルートで以下を実行します：

```bash
git submodule add https://github.com/yuki-yamagishi/antigravity-review-loop.git .agents/plugins/antigravity-review-loop
```

他メンバーや CI 環境では、通常のクローン時に以下でプラグインも展開されます：

```bash
git clone --recurse-submodules <YOUR_PROJECT_URL>
# または既存リポジトリで
git submodule update --init --recursive
```

### 方式 2: Git Clone として配置

```bash
git clone https://github.com/yuki-yamagishi/antigravity-review-loop.git .agents/plugins/antigravity-review-loop
```

---

## 📁 プラグイン構造 (Directory Layout)

```text
.agents/plugins/antigravity-review-loop/
├── plugin.json                    # 公式プラグインマニフェスト
├── hooks.json                     # ライフサイクルフック定義
├── config/                        # 設定層ローダー
│   └── reviewLoopConfig.js
├── hooks/                         # フック実装スクリプト
│   ├── branchDoRGate.js
│   ├── hookUtils.js
│   ├── postPrCreate.js
│   ├── prePrAuditGate.js
│   ├── prBodyAuditGate.js
│   ├── prBodyStaleGuard.js
│   ├── safetyGuard.js
│   └── stopHook.js
├── scripts/                       # SSoT PR Body 決定論的生成 CLI
│   ├── generate-pr-body.js
│   └── sync-pr-body.js
├── skills/                        # 専門スキル群
│   ├── dev-lifecycle/SKILL.md
│   ├── issue-lifecycle/SKILL.md
│   └── review-self-healing/SKILL.md
├── rules/                         # ルール群
│   ├── AGENTS.md
│   └── single-command.md
├── agents/                        # 同梱サブエージェント群
│   ├── fleet_reviewer.md
│   ├── fleet_completion_auditor.md
│   └── fleet_dor_auditor.md
├── templates/                     # DoR & 事前検証標準テンプレート群
│   ├── template_issue.md
│   └── template_pre_verification.md
└── state/                         # 状態マシン
    ├── loopState.js
    └── .gitignore
```

---

## 🧪 テストの実行 (Testing)

本リポジトリ単体で Vitest による全テストを実行できます：

```bash
npm install
npm test
```

---

## 📄 ライセンス (License)

[MIT License](LICENSE) © 2026 Yuki Yamagishi
