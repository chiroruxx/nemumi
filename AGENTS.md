# AGENTS.md

- AGENTS.md は毎回読み込まれるため、記載は最小限にする。
- 親エージェントが指示・統制・レビューを行い、実装や作業は Luna のサブエージェントに委任する。
- PR は責務単位に分け、すべて GitHub の Stacked Pull Requests として直前のブランチを base にする。Squash merge 後は stack を更新する。
- PR 本文には [テンプレート](.github/PULL_REQUEST_TEMPLATE.md)を使い、「概要」「背景」を記載する。「詳細」は必要な場合のみ追加する。

## Pull Request

- PR は単一の責務に分け、すべて Stacked Pull Request として直前のブランチを base にする。Squash merge 後は stack を更新する。
- PR 本文には[テンプレート](.github/PULL_REQUEST_TEMPLATE.md)を使い、「概要」「背景」を記載する。「詳細」は必要な場合のみ追加する。

## Markdown

- Markdown ファイルを作成・編集したら、利用可能な場合は JetBrains IDE の MCP サーバの `reformat_file`
  で整形する。利用できない場合は、見出し・リスト・コードブロック・リンクの構造を確認する。

## ADR

- サイト全体またに適用される技術・設計方針を決定したら、`docs/adr` に ADR（Architecture Decision Record）を追加する。
    - ファイル名は `YYYY-MM-DD-<内容を表す英語のスラッグ>.md` とする。日付は決定日とし、更新時も変更しない。同日の ADR
      はスラッグで区別する。
    - フォーマットは既存の ADR に合わせる。
    - ADR には設計の決定とその背景・理由を記載し、機能の仕様や具体的な設定値・処理手順は記載しない。
      仕様は対応するドキュメントやコード・テストで管理する。
    - 個別ページの実装詳細や一時的な作業手順は ADR にせず、必要なドキュメントやコードに記載する。
    - 新規ライブラリの導入やアーキテクチャ（ディレクトリ）構成の変更の際は追加する。
    - ただのリファクタリングや機能実装で追加してはいけない。
- ADR 以外のドキュメントには仕様や決定内容を記載し、設計上の背景・理由は該当する ADR へリンクする。

## README

- このリポジトリ全体を管理する人に資する内容を記載する。
    - 特定の機能やスクリプトの内容は記載しない。

## コード

- 実装手順は [implementation-workflow skill](.agents/skills/implementation-workflow/SKILL.md) を参照する。プロジェクト文書では必須要件・未採用候補・実装裁量を区別し、未採用候補は採用が決まるまで実装しない。
- 必須要件を満たすため、標準 API と既存依存を先に確認する。契約変更で不要になった処理も同じ変更で整理する。
- バグ修正では、不具合を再現するテストを先に書き、実装を変更する前に失敗することを確認する。
- リファクタリングでは、維持すべき振る舞いを検証する既存テストを使い、不足する場合のみ変更前にテストを追加する。
  実装を変更する前に、そのテストが成功することを確認する。
- バグ修正・リファクタリング後は、対象の振る舞いを検証するテストと関連する既存テストを実行し、すべて成功することを確認する。

- コードを作成・編集したら、`mise run format` で整形し、`mise run lint` と `mise run check` でエラーが無いことを確認する。
- export
  する関数ごとに、その関数の振る舞いを直接検証するテストを書く。複数の関数を同じテストで検証してもよい（[export 関数の直接テストを静的に確認する](docs/adr/2026-10-13-check-exported-function-tests.md)）。
- Lint
  の無効化は対象ルールの直前で次の行だけに適用し、コメントに理由を記載する（[Lint の無効化方針](docs/adr/2026-10-17-require-reasons-for-lint-suppressions.md)）。
- 設定ファイルでルールを無効化したり、既定値を上書きしたり、例外を追加したりするときは、理由を該当設定の近くにコメントで記載する。コメントに対応しない形式の場合は、その設定に対応するドキュメントに理由を記載する。

## 命名

- 名前は機械的な語順の統一ではなく、同じ概念に既存の呼び方を一貫して使う。名前を追加・変更する前に、識別子・ファイル名・コマンド名など近い役割の既存名を確認し、不要な同義語を増やさない。
- 同義語を同じ概念に使い分けない（例: 同じ取得処理に `get` と `retrieve`、同じ同期処理に `sync` と `synchronize`
  を混在させない）。意味を区別する必要がある場合は、名前の違いが示す動作の違いをコードやドキュメントで明記する。
- 同じ概念を表す既存名が複数あり判断が曖昧な場合は、近接する呼び出し側や利用者向けコマンドの命名に合わせる。意味が異なる場合に限って別の語を使い、その違いをコードやドキュメントで説明する。
- ファイルを改名・移動したら、package.json、import、ワークフロー、ドキュメントを更新し、旧パスや旧称が残っていないことを `rg`
  で確認する。

## 開発

- セットアップ手順と主なコマンドは [README.md](README.md) を参照する。
- エージェントが開発サーバを起動する場合は、`pnpm dev` ではなくバックグラウンドモードを使う。

  ```shell
  mise exec -- pnpm astro dev --background
  ```

  停止・状態確認・ログ確認には `mise exec -- pnpm astro dev stop`、`mise exec -- pnpm astro dev status`、
  `mise exec -- pnpm astro dev logs` を使う。

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
