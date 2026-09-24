# 0001. ホスティングに Cloudflare Workers（Static Assets）を採用する

- **ステータス**: 承認
- **日付**: 2026-09-24

## 背景

個人サイトは Astro（SSG）で構築し、React / Next.js は使用しない。
ホスティング先の候補として Vercel と Cloudflare を検討した。

Cloudflare には静的サイトの公開手段として Pages と Workers（Static Assets）の 2 つがある。

- Pages は今後もサポートされるが保守中心となり、新機能への投資は Workers に集中する方針が示されている。
- 2026 年 3 月時点で、Workers は静的配信・SSR・独自ドメインについて Pages と同等の機能を持つ。
- Cron Triggers、Durable Objects、Workflows などは Workers でのみ利用できる。
- 静的アセットへのリクエストはどちらも無料で、コスト構造は同等。

## 決定

ホスティングには Cloudflare Workers（Static Assets）を採用する。
GitHub との連携には Workers Builds を使用する。

## 検討した選択肢

| 選択肢                                  | 評価                                                                              |
|-----------------------------------------|-----------------------------------------------------------------------------------|
| Vercel                                  | Next.js との統合が主な強みで、React / Next.js を使わない本サイトでは利点が薄い    |
| Cloudflare Pages                        | SSG の配信には十分だが、保守中心となるため新規プロジェクトで選ぶ理由が薄い        |
| **Cloudflare Workers（Static Assets）** | Cloudflare が新規プロジェクトに推奨しており、将来の機能追加にもそのまま対応できる |

## 結果

- **良い点**
    - 将来、RSS 取得のための定期処理（Cron）、問い合わせフォーム、OGP 画像の動的生成などを追加する場合も、同じ Worker 上で拡張できる。
    - 今後の新機能・改善の恩恵を受けられる。
- **注意点**
    - `wrangler.jsonc` などの設定ファイルを用意する必要がある。
    - Pages と異なり `node_modules` や `.git` などが自動で除外されないため、必要に応じて `.assetsignore` を用意する。
    - ローカル開発のデフォルトポートが Pages（8788）と異なる（8787）。

## 参考

- [Static Assets · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/)
- [Migrate from Pages to Workers · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
