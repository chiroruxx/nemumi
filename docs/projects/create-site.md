# 個人サイト作成

## 概要

### 主な目的やターゲット

自身が発信している情報をまとめる。
ブログ機能も実装したいが、最初は別サイトにあるブログへのリンクで良い。

- **想定する訪問者**: 知り合いや採用担当者など
- **訪問者に取ってほしい行動**: 各リンクに飛んで、読みたい情報にアクセスしてほしい。

### 載せたいコンテンツのイメージ

記事・スライドへのリンクは各コンテンツに含め、SNS などのアカウントリンクはプロフィールに含める。独立した Links 一覧は設けない。

- Profile（プロフィール）
    - 表示名は `chihiro`（小文字）。活動拠点と得意な領域を含む短い自己紹介。仕事・役割や経歴の年表は載せない。顔写真は使わず、アイコン画像を載せる。
    - X（旧Twitter）、mixi2、GitHub のアカウントリンクをこの順に載せる。
- Articles / Blog（外部ブログの記事）
    - はてなブログ、しずかな（しずかなインターネット）など、普段書いている外部媒体の記事へのリンク。
    - 新着記事の RSS 自動取得は将来の検討事項とする（[将来の検討事項](#将来の検討事項)を参照）。
- Talks / Slides（登壇・発表履歴）
    - Speaker Deck や Docswell のスライドと、これまでの発表内容をまとめる。
    - 一覧では開催日・発表タイトル・「登壇」タグとスライドへのリンクを表示し、イベント名とサムネイルは載せない。
- Activities（活動の記録）
    - コミュニティ運営やコミュニティでのイベントなどの活動記録。関連ページへのリンクも各項目に含める。
- Communities（コミュニティ）
    - 主催している勉強会やコミュニティの紹介。各コミュニティのアイコンを主役にし、関連ページへのリンクも各項目に含める。

### MVP（最初の公開範囲）

- 「載せたいコンテンツのイメージ」に挙げた Profile、Articles / Blog、Activities、Talks / Slides、Communities を含める。

### 作り方・技術スタック

- フレームワーク: Astro（SSG）
- コンテンツ管理: Astro Content Collections（YAML / Markdown + スキーマ）（[ADR 0009](../adr/0009-content-collections.md)）
- ホスティング: Cloudflare Workers（Static Assets）（[ADR 0001](../adr/0001-hosting-cloudflare-workers.md)）
- ドメイン: nemumi.dev（Cloudflare Registrar）（[ADR 0008](../adr/0008-domain-nemumi-dev.md)）
- スタイリング: Step 5 で決める（Tailwind CSS / CSS Modules など）
- ツールのバージョン管理: mise（Node.js は `.node-version`、その他は
  `mise.toml`）（[ADR 0002](../adr/0002-tool-version-management-mise.md)）
- ランタイム: Node.js 26（[ADR 0003](../adr/0003-nodejs-26.md)）
- パッケージマネージャ: pnpm（[ADR 0004](../adr/0004-package-manager-pnpm.md)）
- Formatter / Linter: Biome（[ADR 0005](../adr/0005-formatter-linter-biome.md)）
- 型チェック: astro check + TypeScript 6（[ADR 0006](../adr/0006-type-check-astro-check.md)）
- CI: GitHub Actions（[ADR 0007](../adr/0007-ci-github-actions.md)）

## ロードマップ

### Step 1: 環境構築とプロジェクトの初期化 ✅ 完了

- **やったこと**:
    - mise で Node.js 26 と pnpm 12 をインストールし、`mise.toml`・`.node-version`・`package.json` の `engines` でバージョンを固定
    - `pnpm create astro` で minimal テンプレートからプロジェクトを作成（TypeScript は strict）
    - Biome の導入（`pnpm lint` / `pnpm format`）と、Claude Code の hook による編集時の自動整形
    - `astro check` の導入（`pnpm check`）
    - `.gitignore` の整備（`.idea/` などの IDE 設定ファイルを含める）
    - ローカルでの動作確認
    - README へのセットアップ手順・開発手順の記載

### Step 2: リポジトリ作成 & デプロイ ✅ 完了

- **やったこと**:
    - GitHub へコードをプッシュする（デフォルトブランチ名を `main` に統一）
    - `wrangler.jsonc` を作成し、Workers Builds で GitHub と連携する（本番ブランチの設定と、PR ごとのプレビュー URL
      の有効化を含む）
    - **「デフォルトの初期画面のまま」まずはインターネット上に公開する**
    - 独自ドメインの取得と紐付け、`astro.config.mjs` の `site` の設定
- **ポイント**:
    - 最初から本番環境の CI/CD パイプラインを通しておくことで、後々のデプロイの手間やトラブルを無くす。
    - OGP・canonical・サイトマップは絶対 URL を使うため、ドメインはこの時点で確定させる。後から変えると、シェア済みの URL
      や検索エンジンの評価が引き継がれない。

### Step 3: デザイン方針と情報設計 ✅ 完了

- **決めたこと**:
    - サイトの雰囲気は、親しみやすく落ち着いた可愛らしさを軸に、夜空のようなきらめきを取り入れる。
    - プロフィールには顔写真を載せず、アイコン画像を載せる。
    - プロフィールには表示名 `chihiro` を載せる。
    - プロフィールに短い自己紹介文を載せる。
    - プロフィールに X、mixi2、GitHub のアカウントリンクをこの順に載せる。
    - 活動拠点は独立した欄にせず、自己紹介文に含める。
    - 得意な領域は独立した欄にせず、自己紹介文に含める。
    - 経歴の年表や独立した欄は設けない。
    - 現在の仕事や役割はプロフィールに載せない。
    - 対応言語は日本語のみとする。
    - 初回公開はトップページだけで完結させる。
    - セクションはプロフィール、「日々のこと」、「お話ししたこと」、「コミュニティのこと」の順に並べる。
    - Articles と Activities
      は別々のコレクションで管理し、トップページでは「日々のこと」の一覧にまとめて表示する（[ADR 0009](../adr/0009-content-collections.md)）。
    - Communities は各項目に表示順の数字を設定し、その順に並べる（[ADR 0009](../adr/0009-content-collections.md)）。
    - Communities は各項目にアイコン画像を持たせ（[ADR 0009](../adr/0009-content-collections.md)）、一覧ではアイコンを主役として表示する。
    - Talks / Slides はトップページに一覧を載せ、外部のスライドへ直接リンクする。初回は個別ページを作らない。
    - 初回はトップページのみとし、将来のブログ用 URL（`/blog/`）は予約しない。
    - Articles、Talks / Slides、Communities、Activities
      は1件につき1ファイルで管理する（[ADR 0009](../adr/0009-content-collections.md)）。
    - プロフィールや各コンテンツのリンクは、それぞれの内容に含め、独立した Links
      一覧は設けない（[ADR 0009](../adr/0009-content-collections.md)）。
    - 「日々のこと」では Articles と Activities を日付の新しい順にまとめて表示する。
    - Articles には公開日と掲載サービス名、Activities には開始日と活動種別を表示する。複数日開催の Activities
      は開始日と終了日を表示する。
    - Articles の一覧に短い説明文は載せない。
    - Articles の掲載サービスは、はてなブログと「しずかな」を想定する。
    - 掲載サービスは固定リストにせず、必要になったら追加方法を検討する。
    - Talks / Slides は開催日の新しいものを上に表示する。
    - Talks / Slides の一覧に開催日と「登壇」タグを表示し、イベント名は載せない。
    - Talks / Slides の一覧にサムネイルは使わない。
    - Communities と Activities の説明文は任意項目とする。
    - 関連リンクは任意項目とし、8〜9割の項目に設定する想定。

### Step 4: コンテンツの準備

- **やること**:
    - 短い自己紹介文とプロフィールのアカウントリンクを用意する。
    - プロフィールと各コミュニティのアイコン画像など、必要な画像を用意する。写真を使う場合は EXIF の位置情報を削除する。
    - 記事へのリンク、登壇内容、コミュニティと活動の情報を整理する。
- **ポイント**: 実装より時間がかかりがちなので、Step 5 と並行して進めても良い。

### Step 5: コンポーネント実装 & スタイリング

- **やること**:
    - スタイリング手法の決定（Tailwind CSS / CSS Modules など）
    - Astro での各セクションのコーディング
    - スタイリングの適用とレスポンシブ対応
    - 404 ページの作成
    - 画像の最適化（`astro:assets`）

### Step 6: SEO・メタ情報・OGP の最適化

- **やること**:
    - タイトル、メタディスクリプション、canonical の設定
    - SNS シェア時の OGP（画像・説明文）の設定。OGP 画像は固定画像か自動生成かを決める
    - favicon の設定 ✅ 完了
    - サイトマップ（`@astrojs/sitemap`）と `robots.txt` の生成
    - 構造化データ（JSON-LD の `Person`）の追加

### Step 7: 品質チェック & リリース

- **やること**:
    - Lighthouse でパフォーマンス・アクセシビリティ・SEO を確認
    - 主要ブラウザとスマートフォンでの表示確認
    - アクセス解析の導入を検討（Cloudflare Web Analytics など）
    - SNS のプロフィール欄などにサイト URL を掲載する

### Step 8: 運用

- **やること**:
    - 依存パッケージの自動更新（Renovate / Dependabot）の設定
    - コンテンツ追加手順（登壇・活動の追加方法）を README に記載

## 将来の検討事項

- **外部ブログの RSS 自動取得**
    - SSG ではビルド時にしか取得されないため、定期的な再ビルドが必要（GitHub Actions の cron など。手段は実装時に確認する）。
    - フィード取得に失敗してもビルド全体が失敗しないようにする（タイムアウト、空配列へのフォールバック）。
- **自サイトでのブログ機能**
    - Content Collections に乗せて実装する。
    - 外部ブログから記事を移す場合は、canonical やリダイレクトの扱いを決める。
