# AGENTS.md

- AGENTS.md は毎回読み込まれるため、記載は最小限にし、詳細は README や ADR にまとめる。

## Markdown

- Markdown ファイルを作成・編集したら、JetBrains IDE の MCP サーバの `reformat_file` で整形する。

## ADR

- サイト全体または複数箇所に適用される技術・設計方針を決定したら、`docs/adr` に ADR（Architecture Decision Record）を追加する。
    - ファイル名は `NNNN-<内容を表す英語のスラッグ>.md` とし、番号は既存の最大番号の次にする。
    - フォーマットは既存の ADR に合わせる。
    - 個別ページの実装詳細や一時的な作業手順は ADR にせず、必要なドキュメントやコードに記載する。
- ドキュメントには決定内容のみを記載して該当する ADR へリンクし、背景や理由は ADR に記載する。

## コード

- コードを作成・編集したら、`mise run format` で整形し、`mise run lint` と `mise run check` でエラーが無いことを確認する。
- export
  する関数ごとに、その関数の振る舞いを直接検証するテストを書く。複数の関数を同じテストで検証してもよい（[ADR 0026](docs/adr/0026-check-exported-function-tests.md)）。
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
