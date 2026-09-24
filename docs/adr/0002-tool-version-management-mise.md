# 0002. ツールのバージョン管理に mise を採用し、mise.toml で固定する

- **ステータス**: 承認
- **日付**: 2026-09-24

## 背景

開発に使う Node.js などのツールのバージョンをプロジェクトごとに固定し、ディレクトリに入ったときに自動で切り替えたい。
開発環境のシェルは fish のため、fish で動作するツールである必要がある。

また、Node.js 25 以降は corepack が同梱されなくなったため、pnpm などのパッケージマネージャも別の手段で用意する必要がある。

## 決定

ツールのバージョン管理には mise を採用する。
プロジェクトで使うツールのバージョンは、以下のファイルで固定する。

- Node.js: リポジトリ直下の `.node-version`。mise には `mise.toml` の `idiomatic_version_file_enable_tools` で読ませる。
- Node.js 以外（pnpm など）: リポジトリ直下の `mise.toml`。

あわせて、`package.json` の `engines` にも Node.js のバージョン要件を記載する。

### 変更履歴

- 2026-09-24: 当初は Node.js も `mise.toml` で固定していたが、Cloudflare Workers Builds が `mise.toml` を読まず
  `.node-version` / `.nvmrc` / 環境変数 `NODE_VERSION` のみを読むことが分かったため、Node.js の指定を `.node-version`
  に移した。

## 検討した選択肢

### バージョン管理ツール

| 選択肢   | 評価                                                                         |
|----------|------------------------------------------------------------------------------|
| **mise** | Node.js 以外のツールも管理でき、fish に対応している                          |
| Volta    | Node.js 専用で fish に対応しているが、開発がメンテナンスモードに入っている   |
| fnm      | Node.js 専用で軽量、fish に対応しているが、pnpm などは別に管理する必要がある |
| Homebrew | 手軽だが、プロジェクトごとにバージョンを切り替えられない                     |

### バージョンを固定するファイル

| 選択肢                                         | 評価                                                                                        |
|------------------------------------------------|---------------------------------------------------------------------------------------------|
| mise.toml のみ                                 | mise がそのまま読めるが、Cloudflare Workers Builds が読まず、ビルド環境で別途指定が必要     |
| **Node.js は `.node-version`、他は mise.toml** | Node.js の指定をローカルとビルド環境で 1 か所にまとめられる。mise に読ませる設定が 1 行必要 |
| `.nvmrc`                                       | `.node-version` と同様                                                                      |

## 結果

- **良い点**
    - Node.js のバージョンを、ローカルと Cloudflare Workers Builds で同じファイルから指定できる。
    - 将来、Node.js 以外のツールが必要になっても同じ仕組みで管理できる。
- **注意点**
    - 開発者ごとに mise のインストールと有効化が必要になる。
    - Cloudflare Workers Builds は pnpm のバージョンを環境変数 `PNPM_VERSION` でしか指定できないため、`mise.toml` の pnpm
      のバージョンを変えるときは、ダッシュボードの `PNPM_VERSION` もあわせて変更する。

## 参考

- [mise](https://mise.jdx.dev/)
