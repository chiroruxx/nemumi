# nemumi

自身が発信している情報（プロフィール、記事、登壇、コミュニティ活動など）をまとめる個人サイト。

https://nemumi.dev

## 技術スタック

- フレームワーク: Astro（SSG）
- コンテンツ管理: Astro Content Collections
- ホスティング: Cloudflare Workers（Static Assets）
- ツールのバージョン管理: mise
- ランタイム: Node.js 26
- パッケージマネージャ: pnpm
- 整形: Biome
- Lint: Biome（Astro 内の CSS 以外）と Stylelint（Astro 内の CSS 全般）
- 型チェック: astro check（TypeScript 6）
- CI: GitHub Actions

## 初回セットアップ

1. [mise](https://mise.jdx.dev/) をインストールし、シェルで有効化する。

   ```shell
   brew install mise
   ```

   Homebrew 版は fish
   では自動で有効化される。その他のシェルは [mise のドキュメント](https://mise.jdx.dev/getting-started.html) を参照。

2. リポジトリのディレクトリで `mise.toml` を信頼し、Node.js と pnpm をインストールする。

   ```shell
   mise trust
   mise install
   ```

   Node.js（`.node-version`）と pnpm（`mise.toml`）は、記載したバージョンが mise によってインストールされるため、個別のインストールは不要。

3. 依存パッケージをインストールする。`mise run` はシェルの mise 連携が有効でなくても、プロジェクトで指定した Node.js と
   pnpm を使う。

   ```shell
   mise run install
   ```

## 開発

開発サーバを起動し、http://localhost:4321 を開く。

```shell
mise run dev
```

### 主なコマンド

| コマンド           | 内容                                   |
|--------------------|----------------------------------------|
| `mise run dev`     | 開発サーバを起動する                   |
| `mise run build`   | 本番用にビルドする（出力先は `dist/`） |
| `mise run preview` | ビルド結果をローカルで確認する         |
| `mise run lint`    | Biome と Stylelint で Lint を実行する  |
| `mise run format`  | Biome でファイルを整形する             |
| `mise run check`   | `astro check` で型チェックする         |
| `mise run test`    | 固定 fixture で生成ページをテストする  |

## CI

PR と `main` へのプッシュで、GitHub Actions（`.github/workflows/ci.yml`）が Lint・型チェック・ビルドを実行する。
`main` へのマージには、このチェックの成功が必要。

## デプロイ

`main` ブランチへのプッシュで、Cloudflare Workers Builds が自動でビルド・デプロイする。
Worker の設定（独自ドメイン `nemumi.dev` の紐付けを含む）は `wrangler.jsonc` に記載している。

Workers Builds のダッシュボードでは、以下を設定している。

| 項目                                 | 値                              |
|--------------------------------------|---------------------------------|
| ビルドコマンド                       | `pnpm build`                    |
| デプロイコマンド                     | `pnpm wrangler deploy`          |
| 本番以外のブランチのデプロイコマンド | `pnpm wrangler versions upload` |
| 環境変数 `PNPM_VERSION`              | `12`（`mise.toml` と合わせる）  |

Node.js のバージョンは `.node-version` から読まれる。

## ライセンス

ライセンスは設定していない。コード・コンテンツともに、すべての権利を保持する（All rights reserved）。

## ドキュメント

- [プロジェクト](docs/projects)
- [ADR（Architecture Decision Records）](docs/adr)
