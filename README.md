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

| コマンド                 | 内容                                   |
|--------------------------|----------------------------------------|
| `mise run dev`           | 開発サーバを起動する                   |
| `mise run build`         | 本番用にビルドする（出力先は `dist/`） |
| `mise run preview`       | ビルド結果をローカルで確認する         |
| `mise run lint`          | Biome と Stylelint で Lint を実行する  |
| `mise run format`        | Biome でファイルを整形する             |
| `mise run check`         | `astro check` で型チェックする         |
| `mise run test`          | 固定 fixture で生成ページをテストする  |
| `mise run lighthouse-ci` | Lighthouse CI でビルド成果物を検査する |

## コンテンツの追加

登壇と活動は、`src/content/talks/` または `src/content/activities/` に YAML ファイルを1件ずつ追加する。日付は `YYYY-MM-DD`
形式で記載し、同じディレクトリ内で重複しないファイル名を付ける。項目名と必須・任意項目は [コンテンツ定義](src/content.config.ts)
で確認できる。

### 登壇を追加する

`src/content/talks/` に YAML ファイルを作成する。`date` と `title` は必須。`types` と `url` は任意で、スライドなどのリンクがある場合は
`url` に設定する。

```yaml
date: "2026-06-17"
types:
  - "登壇資料"
title: "発表タイトル"
url: "https://example.com/slides"
```

### 活動を追加する

`src/content/activities/` に YAML ファイルを作成する。`startDate` と `title` は必須。複数日開催の場合は `endDate` を追加する。
`types`、`url`、`description` は任意。終了日は開始日以降の日付にする。

```yaml
startDate: "2026-09-11"
endDate: "2026-09-12"
types:
  - "運営"
  - "登壇"
title: "活動タイトル"
url: "https://example.com/event"
description: "活動の説明"
```

追加後は `mise run check` でコンテンツの型を確認し、`mise run dev` で表示を確認する。

## CI

PR と `main` へのプッシュで、GitHub Actions（`.github/workflows/ci.yml`）が通常の Lint・型チェック・テスト・ビルドと
Lighthouse CI を並列で実行する。Lighthouse CI はビルド成果物をモバイル条件で計測し、基準を満たさない場合は失敗する。レポートは
CI の Artifact から14日間取得できる（[ADR 0023](docs/adr/0023-monitor-quality-with-lighthouse-ci.md)）。
`main` へのマージには、リポジトリのルールセットで必須に設定されたチェックの成功が必要。

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
