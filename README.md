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

| コマンド                                  | 内容                                   |
|-------------------------------------------|----------------------------------------|
| `mise run dev`                            | 開発サーバを起動する                   |
| `mise run sync-content -- sizu`           | しずかなインターネットの記事を同期する |
| `mise run sync-content -- hatena`         | はてなブログの記事を同期する           |
| `mise run sync-content -- speakerdeck`    | Speaker Deck の登壇資料を同期する      |
| `mise run prune-content`                  | 保持件数を適用し、無効リンクを除去する |
| `mise run sync-content -- sizu --dry-run` | 同期差分を表示する（書き込みなし）     |
| `mise run prune-content -- --dry-run`     | 削除差分を表示する（書き込みなし）     |
| `mise run build`                          | 本番用にビルドする（出力先は `dist/`） |
| `mise run preview`                        | ビルド結果をローカルで確認する         |
| `mise run lint`                           | Biome、Stylelint と export 関数のテスト確認を実行する（[ADR 0026](docs/adr/0026-check-exported-function-tests.md)） |
| `mise run format`                         | Biome でファイルを整形する             |
| `mise run check`                          | `astro check` で型チェックする         |
| `mise run test`                           | 固定 fixture で生成ページをテストする  |
| `mise run lighthouse-ci`                  | Lighthouse CI でビルド成果物を検査する |

## 外部コンテンツの自動更新

GitHub Actions が毎日 JST 06:17 に3サービスを並列で同期し、サービスごとに PR を作成します。JST 07:17 には最新の `main`
を対象に、記事20件・登壇資料10件の上限を適用し、リンク切れを確認する共通の削除 PR を作成します。差分がない場合は PR
を作成・維持しません。必須 CI 成功後は自動マージします。未マージの同期 PR があっても削除処理を実行し、同期 PR
の変更は次回の削除処理で確認します。

自動 PR には GitHub App のトークンを使います。リポジトリに `APP_CLIENT_ID` Actions Variable と `APP_PRIVATE_KEY` Actions
Secret を登録してください。App は対象リポジトリにインストールし、Repository permissions の Contents と Pull requests を
Read and write にします。ブランチ保護では既存 CI の必須チェックを設定し、リポジトリ設定で Auto-merge を有効にしてください。初回の同期
PR と削除 PR は内容を確認して手動マージし、以後の自動マージを有効にします。

ワークフローは Actions の「Update content」からサービスを選んで手動実行できます。「Prune content」は削除処理の手動実行です。ローカルでは上の
dry-run コマンドで差分を確認できます。フィード取得やリンク確認に失敗した処理は失敗として記録され、確認できないリンクは削除されません。

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
