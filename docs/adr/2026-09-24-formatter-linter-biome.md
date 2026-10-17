# Formatter / Linter に Biome を採用する

- **ステータス**: 承認
- **日付**: 2026-09-24

## 背景

コードの整形と静的解析に使うツールを決める必要がある。
対象には Astro のコンポーネント（`.astro`）が含まれる。

Biome の Astro 対応は実験的機能の扱いで、`.astro` のテンプレート部分（HTML）を整形・Lint するには明示的な有効化が必要となる。
有効化しない場合、フロントマターで import した変数を未使用と誤検知することがある。

## 決定

Biome を Formatter と CSS 以外の Linter に採用し、設定は `biome.jsonc` に記載する。Astro 内の CSS の Lint には Stylelint
を使う（[Astro のスコープ付き CSS でネイティブ CSS Nesting を使う](2026-09-26-native-css-nesting.md)）。

- `html.experimentalFullSupportEnabled` を有効にし、`.astro` のテンプレート部分も整形・Lint の対象とする。CSS の Lint は
  Biome で無効にする。
- インデントはスペース 2 つとする。
- 実行には `mise run lint`（チェック）と `mise run format`（整形）を使う。

Markdown ファイルは Biome の対象外とし、JetBrains IDE の整形を使う。

## 検討した選択肢

### ツール

| 選択肢            | 評価                                                                        |
|-------------------|-----------------------------------------------------------------------------|
| Prettier + ESLint | `.astro` の対応が最も成熟しているが、導入するパッケージと設定ファイルが多い |
| **Biome**         | 1 つのツールで整形と Lint ができ、速い。`.astro` の対応は実験的             |
| 導入しない        | 当面は IDE の整形のみで進める                                               |

### `.astro` の扱い

| 選択肢                     | 評価                                                                        |
|----------------------------|-----------------------------------------------------------------------------|
| **実験的機能を有効にする** | テンプレート部分も含めて整形・Lint できる。問題が出たらルールを調整する     |
| フロントマターだけ扱う     | 誤検知しやすいルールを `.astro` で無効にし、テンプレート部分は IDE に任せる |

### インデント

| 選択肢            | 評価                                                               |
|-------------------|--------------------------------------------------------------------|
| タブ              | Biome の既定。表示幅を人ごとに変えられる                           |
| **スペース 2 つ** | Astro のテンプレートや Prettier の既定と同じで、JS / TS では多数派 |

## 結果

- **良い点**
    - JavaScript / TypeScript と Astro のテンプレートを、Biome で整形・Lint できる。
- **注意点**
    - Astro 対応は実験的なため、誤検知や整形の崩れが起きる可能性がある。発生した場合は `biome.jsonc` の `overrides`
      などで調整する。
    - `public/` の SVG は favicon などの画像として使うため、`a11y/noSvgWithoutTitle` を無効にしている。

## 参考

- [Language support · Biome](https://biomejs.dev/internals/language-support/)
