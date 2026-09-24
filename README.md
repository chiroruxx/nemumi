# nemumi

自身が発信している情報（プロフィール、記事、登壇、コミュニティ活動など）をまとめる個人サイト。

## 技術スタック

- フレームワーク: Astro（SSG）
- コンテンツ管理: Astro Content Collections
- ホスティング: Cloudflare Workers（Static Assets）
- ツールのバージョン管理: mise
- ランタイム: Node.js 26
- パッケージマネージャ: pnpm
- Formatter / Linter: Biome
- 型チェック: astro check（TypeScript 6）

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

   Node.js と pnpm は `mise.toml` に記載したバージョンが mise によってインストールされるため、個別のインストールは不要。

3. 依存パッケージをインストールする。

   ```shell
   pnpm install
   ```

## 開発

開発サーバを起動し、http://localhost:4321 を開く。

```shell
pnpm dev
```

### 主なコマンド

| コマンド       | 内容                                         |
|----------------|----------------------------------------------|
| `pnpm dev`     | 開発サーバを起動する                         |
| `pnpm build`   | 本番用にビルドする（出力先は `dist/`）       |
| `pnpm preview` | ビルド結果をローカルで確認する               |
| `pnpm lint`    | Biome で整形と Lint をチェックする           |
| `pnpm format`  | Biome で整形し、自動修正できる問題を修正する |
| `pnpm check`   | `astro check` で型チェックする               |

## ドキュメント

- [プロジェクト](docs/projects)
- [ADR（Architecture Decision Records）](docs/adr)
