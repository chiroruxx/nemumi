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

[mise](https://mise.jdx.dev/) をインストールし、シェルで有効化する。Homebrew の場合:

```shell
brew install mise
```

Homebrew 版は fish
では自動で有効化される。その他のシェルは [mise のドキュメント](https://mise.jdx.dev/getting-started.html) を参照。
その後、リポジトリのルートで次のコマンドを一度実行する。

```shell
./scripts/setup.sh
```

スクリプトは `mise.toml` を信頼し、Node.js と pnpm をインストールしてから、`.env.example` を `.env`
にコピーし、依存パッケージをインストールする。既存の `.env` は上書きしない。Node.js（`.node-version`）と pnpm（`mise.toml`
）は記載したバージョンが mise によってインストールされるため、個別のインストールは不要。

## 開発

開発サーバを起動し、http://localhost:4321 を開く。

```shell
mise run dev
```

利用可能なコマンドと説明は、次のコマンドで確認する。

```shell
mise tasks
```

## ライセンス

ライセンスは設定していない。コード・コンテンツともに、すべての権利を保持する（All rights reserved）。

## ドキュメント

- [プロジェクト](docs/projects)
- [ADR（Architecture Decision Records）](docs/adr)
