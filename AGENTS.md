# AGENTS.md

## Markdown

- Markdown ファイルを作成・編集したら、JetBrains IDE の MCP サーバの `reformat_file` で整形する。

## ADR

- 技術的な決定をしたら、`docs/adr` に ADR（Architecture Decision Record）を追加する。
    - ファイル名は `NNNN-<内容を表す英語のスラッグ>.md` とし、番号は既存の最大番号の次にする。
    - フォーマットは既存の ADR に合わせる。
- ドキュメントには決定内容のみを記載して該当する ADR へリンクし、背景や理由は ADR に記載する。

## コード

- コードを作成・編集したら、`pnpm format` で整形し、`pnpm lint` と `pnpm check` でエラーが無いことを確認する。

## 開発

- セットアップ手順と主なコマンドは [README.md](README.md) を参照する。
- エージェントが開発サーバを起動する場合は、`pnpm dev` ではなくバックグラウンドモードを使う。

  ```shell
  pnpm astro dev --background
  ```

  停止・状態確認・ログ確認には `pnpm astro dev stop`、`pnpm astro dev status`、`pnpm astro dev logs` を使う。

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
