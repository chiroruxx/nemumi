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

### 主なコマンド

| コマンド                                  | 内容                                                                                                                                                                 |
|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `mise run dev`                            | 開発サーバを起動する                                                                                                                                                 |
| `mise run sync-content -- sizu`           | しずかなインターネットの記事を同期する                                                                                                                               |
| `mise run sync-content -- hatena`         | はてなブログの記事を同期する                                                                                                                                         |
| `mise run sync-content -- speakerdeck`    | Speaker Deck の登壇資料を同期する                                                                                                                                    |
| `mise run prune-content`                  | 保持件数を適用し、無効リンクを除去する                                                                                                                               |
| `mise run sync-content -- sizu --dry-run` | 同期差分を表示する（書き込みなし）                                                                                                                                   |
| `mise run prune-content -- --dry-run`     | 削除差分を表示する（書き込みなし）                                                                                                                                   |
| `mise run build`                          | 本番用にビルドする（出力先は `dist/`）                                                                                                                               |
| `mise run preview`                        | ビルド結果をローカルで確認する                                                                                                                                       |
| `mise run lint`                           | Biome、Stylelint と export 関数のテスト確認を実行する（[ADR 0026](docs/adr/0026-check-exported-function-tests.md)）                                                  |
| `mise run check-exported-function-tests`  | export 関数のテスト対応だけを確認する（[ADR 0026](docs/adr/0026-check-exported-function-tests.md)、[ADR 0031](docs/adr/0031-align-test-runner-and-static-check.md)） |
| `mise run format`                         | Biome でファイルを整形する                                                                                                                                           |
| `mise run check`                          | `astro check` で型チェックする                                                                                                                                       |
| `mise run test`                           | Astro をビルドし、`tests/**/*.test.ts` を再帰的に実行する                                                                                                            |
| `mise run lighthouse-ci`                  | Lighthouse CI でビルド成果物を検査する                                                                                                                               |

## 外部コンテンツの自動更新

GitHub Actions は毎日 JST 06:17 に3サービスを並列で同期し、JST 07:17 に `main` の保存済みデータを対象に prune
します。同期はサービス別 PR、prune は共通 PR を作成・更新します。同期が失敗したサービスは差分を適用せず、他サービスの同期は継続します。prune
は同期 PR のマージを待たず、実行時点の最新 `main` を対象にします。

PR 作成には、この repository にインストールした GitHub App を使います。`APP_CLIENT_ID` を
`Settings > Secrets and variables > Actions > Variables` に、`APP_PRIVATE_KEY` を同じ画面の `Secrets` に登録してください。App
をこの repository にインストールし、`Contents: Read and write` と `Pull requests: Read and write` を付与します。branch
protection の bypass 権限は不要です。workflow の `GITHUB_TOKEN` は read-only のままです。

`CONTENT_AUTO_MERGE` が文字列 `true` のとき、必須 CI 成功後に auto-merge を要求します。それ以外（未設定を含む）は新たな自動マージを要求せず、PR
の確認・マージは手動です。自動マージを使う場合は repository 設定で Auto-merge と必須チェックも有効にしてください。初回は自動マージを無効にして差分と
CI を確認し、手動マージします。

「Update content」はサービスを選択して手動実行できます。「Prune
content」も手動実行できます。ローカルでは [dry-run コマンド](#主なコマンド)で同期・削除予定を確認できます。GitHub Actions
はどちらも10分で終了します。

PR の作成・更新と差分消失時のクローズは `create-pull-request` に委譲します。人が閉じた PR があっても、次回以降の差分で PR
作成・更新を続けます。automation branch
は自動処理専用とし、手動コミットがあっても停止せず、生成結果で上書きされる場合があります（[ADR 0034](docs/adr/0034-delegate-content-pr-management.md)）。

`CONTENT_AUTO_MERGE=false` または未設定では、以後の実行で自動マージを要求しません。すでにPRで有効な auto-merge
は残るため、必要なら各PR画面の `Disable auto-merge`（または `gh pr merge <番号> --disable-auto`
）で個別に解除してください。両workflowを無効化しても、すでにPRへ設定した auto-merge は解除されません。自動処理全体を止める場合は「Update
content」と「Prune content」の両 workflow を無効にし、既存PRの auto-merge も必要に応じて解除してください。通信期限、保持方針、PR
の運用は [ADR 0025](docs/adr/0025-sync-external-content-from-rss.md)、[ADR 0027](docs/adr/0027-prune-stored-content-without-rss.md)、[ADR 0029](docs/adr/0029-bound-content-network-execution.md)、[ADR 0030](docs/adr/0030-guard-content-automation-lifecycle.md)、[ADR 0034](docs/adr/0034-delegate-content-pr-management.md)
を参照してください。

## コンテンツの追加

サイト全体の日付タイムゾーンは `TZ` で指定する。初回セットアップ時に作成される `.env` の値を変更できる。
`mise run` の各タスクと Astro は `.env` を読み込む。未設定時は `Asia/Tokyo`
を使う。詳細は [ADR 0032](docs/adr/0032-site-time-zone.md) を参照。

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
