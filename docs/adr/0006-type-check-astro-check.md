# 0006. 型チェックに astro check と TypeScript 6 を採用する

- **ステータス**: 承認
- **日付**: 2026-09-24

## 背景

Biome（[ADR 0005](0005-formatter-linter-biome.md)）は整形と Lint のみを行い、TypeScript の型エラーは検出しない。
コードの大半は `.astro` ファイルになるため、`.astro` を含めて型チェックできる仕組みが必要となる。

2026 年 9 月時点の状況は以下のとおり。

- Astro 公式の `astro check`（`@astrojs/check`）は TypeScript 6 までの JavaScript API を利用しており、TypeScript 7.0
  には対応していない。また、将来の Astro で非推奨となる予定。
- TypeScript 7 はコンパイラを Go で書き直したネイティブ版で、6 までの JavaScript API を持たない。
- 後継の `@astrojs/ts-content-mapper` は TypeScript 7.1 で追加される content mappers を利用し、`tsc` だけで `.astro`
  を型チェックできる。ただし TypeScript 7.1 は開発版のみで、mapper も実験的な段階にある。
- TypeScript 7.0 の `tsc` 単体では `.astro` を型チェックできない。

## 決定

型チェックには `astro check` を採用し、TypeScript は 6 系を使用する。
実行には `pnpm check` を使う。

## 検討した選択肢

| 選択肢                                    | 評価                                                                 |
|-------------------------------------------|----------------------------------------------------------------------|
| **TypeScript 6 + astro check**            | 現時点で確実に動作する。将来は非推奨となるため、いずれ移行が必要     |
| 導入しない                                | TypeScript 7.1 の正式版を待つ。それまでは IDE の型チェックのみとなる |
| TypeScript 7.1 開発版 + ts-content-mapper | 後継の仕組みを先取りできるが、開発版・実験的で動作が不安定な可能性   |

## 結果

- **良い点**
    - `.astro` を含めた型エラーをコマンドで検出できる。
- **注意点**
    - TypeScript を 7 系へ上げると `astro check` が動作しなくなるため、`package.json` では 6 系（`^6`）に固定している。
    - TypeScript 7.1 が正式にリリースされたら、`@astrojs/ts-content-mapper` への移行を検討し、本 ADR を更新または置き換える。

## 参考

- [@astrojs/ts-content-mapper](https://github.com/withastro/astro/tree/main/packages/language-tools/ts-content-mapper)
