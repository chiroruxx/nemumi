# 個人サイト作成

## 概要

### 主な目的やターゲット

自身が発信している情報をまとめる。
ブログ機能も実装したいが、最初は別サイトにあるブログへのリンクで良い。

- **想定する訪問者**: 知り合いや採用担当者など
- **訪問者に取ってほしい行動**: 各リンクに飛んで、読みたい情報にアクセスしてほしい。

### 載せたいコンテンツのイメージ

Articles・Talks は個々のコンテンツ（記事・スライド）へのリンク、Links はアカウント（プロフィールページ）へのリンクとして役割を分ける。

- Profile（プロフィール）
    - 経歴や得意な領域、現在の活動拠点（東京・長野など）の紹介。
- Articles / Blog（外部ブログの記事）
    - Zenn、Qiita、note など、普段書いている外部媒体の記事へのリンク。
    - 新着記事の RSS 自動取得は将来の検討事項とする（[将来の検討事項](#将来の検討事項)を参照）。
- Talks / Slides（登壇・発表履歴）
    - Speaker Deck や Docswell のスライド、これまで登壇したイベント名の一覧。
    - 一覧ではサムネイルとリンクのみ表示する。詳細ページを作る場合、スライドの埋め込み（iframe）は詳細ページに限定する。
- Communities / Activities（コミュニティ運営・活動）
    - 主催している勉強会やコミュニティの紹介や、これまでの実績のまとめ。
- Links
    - GitHub、X（旧Twitter）、Speaker Deck などの SNS・サービスのアカウントへのリンク集。

### MVP（最初の公開範囲）

- Step 3 の情報設計で決める。

### 作り方・技術スタック

- フレームワーク: Astro（SSG）
- コンテンツ管理: Astro Content Collections（YAML / Markdown + スキーマ）
- ホスティング: Cloudflare Workers（Static Assets）（[ADR 0001](../adr/0001-hosting-cloudflare-workers.md)）
- スタイリング: Step 5 で決める（Tailwind CSS / CSS Modules など）
- ツールのバージョン管理: mise（`mise.toml`）（[ADR 0002](../adr/0002-tool-version-management-mise.md)）
- ランタイム: Node.js 26（[ADR 0003](../adr/0003-nodejs-26.md)）
- パッケージマネージャ: pnpm（[ADR 0004](../adr/0004-package-manager-pnpm.md)）
- Formatter / Linter: Biome（[ADR 0005](../adr/0005-formatter-linter-biome.md)）

## ロードマップ

### Step 1: 環境構築とプロジェクトの初期化

- **やること**:
    - Node.js 環境の確認と、バージョンの固定（mise の `mise.toml`、`package.json` の `engines`）
    - パッケージマネージャの決定（npm / pnpm など）
    - 決定したパッケージマネージャで `create astro` を実行し、プロジェクトを作成（TypeScript を有効化）
    - Formatter / Linter の導入（Prettier + ESLint、または Biome）
    - `.gitignore` の整備（`.idea/` などの IDE 設定ファイルを含める）
    - ローカルでの動作確認

### Step 2: リポジトリ作成 & デプロイ

- **やること**:
    - GitHub へコードをプッシュする（デフォルトブランチ名を `main` に統一）
    - `wrangler.jsonc` を作成し、Workers Builds で GitHub と連携する（本番ブランチの設定と、PR ごとのプレビュー URL
      の有効化を含む）
    - **「デフォルトの初期画面のまま」まずはインターネット上に公開する**
    - 独自ドメインの取得と紐付け、`astro.config.mjs` の `site` の設定
- **ポイント**:
    - 最初から本番環境の CI/CD パイプラインを通しておくことで、後々のデプロイの手間やトラブルを無くす。
    - OGP・canonical・サイトマップは絶対 URL を使うため、ドメインはこの時点で確定させる。後から変えると、シェア済みの URL
      や検索エンジンの評価が引き継がれない。

### Step 3: デザイン方針と情報設計

- **やること**:
    - サイトのトーン＆マナー（ミニマル、テック系など）の決定
    - 対応言語の決定（日本語のみ / 日英併記）。i18n はルーティングに影響するため、ここで決める
    - MVP（最初の公開範囲）に含めるコンテンツの決定
    - ページ構成と URL 設計（将来のブログ用に `/blog/` などのパスを確保しておく。Talks などの詳細ページの有無もここで決める）
    - Content Collections のスキーマ設計（登壇履歴、コミュニティ活動、リンクなど。1件 = 1ファイルで管理する）

### Step 4: コンテンツの準備

- **やること**:
    - プロフィール文、経歴の執筆
    - プロフィール写真などの画像の用意（EXIF の位置情報を削除する）
    - 登壇履歴、コミュニティ活動のデータ化
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
    - favicon の設定
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
