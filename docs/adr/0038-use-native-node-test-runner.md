# 0038. Node.js の native glob test runner を使う

- **ステータス**: 承認
- **日付**: 2026-10-15

## 背景

Node.js 26 はコマンドラインから glob pattern を使ってテストを実行できる。独自の wrapper と再帰的なファイル列挙 helper
は、Node.js がすでに提供する実行・列挙処理を重複していた。

## 決定

- Astro の test build 後、`node --test "tests/**/*.test.ts"` でテストを実行する。引用符で glob を Node.js に渡し、shell
  による展開を防ぐ。
- export 関数チェッカーは同じ glob pattern を `node:fs/promises` の `glob` で列挙し、絶対パスに変換してソートする。
- `.test.ts` を対象に含め、`.test.tsx` は含めない。Node.js の glob runner は一致するテストが0件でも終了コード0を返す。この簡素化では旧
  wrapper の0件失敗を維持しない。
- この決定は [ADR 0031](0031-align-test-runner-and-static-check.md) のファイル列挙処理を共有する決定を置き換える。

## 結果

- テスト実行は Node.js 標準の glob 対応に委ね、wrapper と共有ファイル列挙 helper を削除する。
- 静的チェッカーは Node.js の glob API を用い、テストファイルをソート済み絶対パスで確認する。
