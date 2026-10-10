# SEO 運用

**ステータス: 未着手**

## 目的

`nemumi.dev` が検索エンジンに正しくクロール・登録されているかを確認し、検索経由の表示状況と技術的な問題を定期的に把握する。

## 初回設定

Step 6 の変更を本番へデプロイした後に実施する（[個人サイト作成 Step 6・7](./create-site.md)）。

- [ ] Google Search Console にドメイン プロパティ `nemumi.dev` を追加する。
- [ ] Search Console が提示する DNS TXT レコードを Cloudflare DNS に登録して、所有権を確認する。
- [ ] Search Console のサイトマップ レポートから `https://nemumi.dev/sitemap-index.xml` を送信する。
- [ ] URL 検査で `https://nemumi.dev/` を確認し、公開 URL のクロールとインデックス状況を確認する。必要な場合だけインデックス登録をリクエストする。
- [ ] サイトマップの取得エラーやページのインデックス登録エラーがあれば、原因を確認して修正する。

## 継続して確認すること

- 新しいページを公開した後、Search Console の URL 検査とページのインデックス登録状況を確認する。
- Search Console の検索パフォーマンスで、表示回数・クリック数・検索クエリの推移を確認する。
- Search Console のページ エクスペリエンスや Core Web Vitals に問題が出た場合、PageSpeed Insights で対象 URL を調査する。
- サイト構成や構造化データを変更した場合、公開 URL でサイトマップ、canonical、robots 指示、JSON-LD を確認する。

小規模な個人サイトのため、定期確認は四半期ごとを目安とし、公開・大きな変更の後は必要な項目を都度確認する。

## ツール

| ツール                                                                  | 用途                                                                                                                    | 使うタイミング                                        |
|-------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| [Google Search Console](https://search.google.com/search-console/about) | Google のクロール・インデックス状況、サイトマップ、検索パフォーマンス、URL 検査                                         | 初回登録後、公開・変更後、定期確認                    |
| [Bing Webmaster Tools](https://www.bing.com/webmasters)                 | Bing のクロール・インデックス状況、サイトマップ、検索パフォーマンス                                                     | Google 以外の検索エンジンでの登録状況も確認したい場合 |
| [PageSpeed Insights](https://pagespeed.web.dev/)                        | モバイル・デスクトップの性能診断。Lighthouse のラボデータと、利用可能な場合は Chrome UX Report のフィールドデータを確認 | リリース時や、Core Web Vitals の問題が報告された場合  |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/)    | パフォーマンス、アクセシビリティ、SEO の監査                                                                            | リリース前や、ページに大きな変更を加えた場合          |
| [Schema.org Markup Validator](https://validator.schema.org/)            | Schema.org の JSON-LD の構文・語彙を検証                                                                                | 構造化データを追加・変更した場合                      |
| [Google Rich Results Test](https://search.google.com/test/rich-results) | Google が対応する検索結果機能の構造化データを検証                                                                       | 対応するリッチリザルト用の構造化データを追加した場合  |

## このサイトでの扱い

- 現在の内部ページはトップページのみで、記事や登壇資料は外部サイトへのリンクである。サイトマップにトップページだけが含まれる状態は意図どおり。
- `robots.txt` はサイト全体のクロールを許可し、サイトマップを案内する。存在しない URL は HTTP 404 を返し、404 ページは
  `noindex` とする。
- 新しい内部ページを追加する場合は、固有のタイトル・説明文・canonical・OGP を設定し、そのページに表示する内容と一致する構造化データを使う。
- Google 向けの `meta keywords` は設定しない。
