# 0031. 静的検査とテスト runner の対象を合わせる

- **ステータス**: 承認
- **日付**: 2026-10-13

## 背景

ADR 0026 は `*.test.tsx` も export 関数の静的検査対象としているが、プロジェクトの Node.js test runner は TypeScript のネイティブ実行を使い、TSX を実行できない。また、既存の `tests/*.test.ts` 指定はテスト用サブディレクトリを探索しない。そのため静的検査が直接呼び出しを認めても、対応するテストファイルが実行されない場合がある。

## 決定

- Node.js で実行するテストは `tests/` 以下の `*.test.ts` とし、サブディレクトリを再帰的に探索する。
- テスト実行 CLI と ADR 0026 の export 関数チェッカーは、同じファイル列挙処理を使用する。
- `*.test.tsx` はこの runner で実行できないため対象にしない。将来 TSX を使う場合は、実行可能な runner と両方の対象列挙を合わせてから追加する。
- `mise run check-exported-function-tests` で export 関数の静的検査を単独実行できる。`mise run lint` からも同じ検査を実行する。
