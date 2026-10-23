# Lint の無効化には理由を記載する

- **ステータス**: 承認
- **決定日**: 2026-10-17

## 背景

Lint の例外が必要な場合、無効化した事実だけでは、その必要性や影響範囲を後から判断できない。
特定の CSS ルールに限らず、リポジトリで使用する Linter に共通の例外方針を設ける。
ファイル全体や範囲をまとめて無効化すると、後から追加したコードの問題も検出されなくなる。

## 決定

- Lint を無効化するときは、対象ルールと必要な理由を無効化コメントに記載する。
- コード内の例外は対象の直前に置き、次の行に対する無効化を使う。ファイル全体・範囲・同じ行の無効化は使わない。
- Stylelint は `stylelint-disable-next-line <rule> -- <理由>` を使う。`comment-word-disallowed-list` で他の無効化形式を禁止し、
  `reportDisables` でその制約自体の無効化も検出する。
- Stylelint の `reportDescriptionlessDisables` と `reportUnscopedDisables` で、理由と対象ルールの省略を検出する。
- Biome は `biome-ignore lint/<group>/<rule>: <理由>` を使う。理由の省略・空欄は Biome の標準の構文検査で検出する。
- Biome のファイル全体・範囲の無効化や対象ルールの省略を禁止する標準設定はないため、これらはレビューで確認する。
- 設定ファイルによる無効化や例外には、該当設定の近くに理由をコメントで記載する。コメントに対応しない形式の場合は、対応するドキュメントに記載する。

## 検討した選択肢

| 選択肢                               | 評価                                     |
| ------------------------------------ | ---------------------------------------- |
| **無効化の理由と対象範囲を明記する** | 例外の必要性と影響範囲を後から判断できる |

## 結果

- **良い点**
  - 例外の必要性と対象をコードや設定から確認できる。
- **注意点**
  - Linter が検査できる形式上の制約は `mise run lint` で確認する。
  - 理由の妥当性と、標準設定で検査できない制約はレビューで確認する。

## 参考

- [Stylelint のコメント検査](https://stylelint.io/user-guide/configure/#report)
- [Stylelint の comment-word-disallowed-list](https://stylelint.io/user-guide/rules/comment-word-disallowed-list/)
- [Biome の無効化コメント](https://biomejs.dev/analyzer/suppressions/)
