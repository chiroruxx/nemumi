# コンテンツ自動 PR の管理を create-pull-request に委譲する

- **ステータス**: 承認
- **日付**: 2026-10-14

## 背景

従来の実装は、手動で閉じた PR と手動コミットを含む automation branch
を検出して自動処理を停止するため、独自の guard を導入した。PR 一覧、close イベント、比較コミットの取得・検証とページング、no-diff
marker の管理が必要になり、その実装とテストの保守がコンテンツ更新の目的に対して大きくなっている。

PR の手動クローズを停止の意思として扱わず、automation branch を生成結果で更新してよい運用にすると、この guard は不要になる。既存の
`create-pull-request` が持つ固定ブランチへの更新と PR 管理を利用する。

## 決定

- 従来の PR lifecycle guard と手動コミットの確認を廃止する。独自の PR 一覧・close イベント・比較コミットの取得、no-diff
  marker とその判定も廃止する。
- コンテンツ処理が成功したら `create-pull-request` を実行し、PR の作成・更新と差分消失時のクローズを委譲する。PR
  を手動で閉じた場合も、次回以降の差分で PR 作成・更新を続ける。同じ PR 番号の再利用は保証しない。
- automation branch は自動処理専用とする。手動コミットがあっても停止せず、生成結果による上書きを許容する。手動変更は通常の
  PR で `main` に反映する。
- サービス別・prune 共通の固定ブランチ、`main` の明示的 checkout、GitHub App による認証、YAML に限定した生成対象、PR branch
  を自動削除しない設定は継続する。
- 自動マージは `CONTENT_AUTO_MERGE` が文字列 `true` で、action が PR 番号を返し、その実行で PR を閉じていない場合に要求する。既存
  PR の自動マージは変数変更だけでは解除しない。
- 自動処理全体の停止は同期・prune の両 workflow の無効化で行い、必要に応じて既存 PR の自動マージも解除する。
- guard 専用のスクリプト、テスト、GitHub output writer と Octokit 依存を削除する。共通 action のテストで PR
  管理の実行と自動マージ条件を検証する。

## 結果

- PR 履歴とコミットを検証する独自コードを保守せず、コンテンツ更新と既存 action の連携に処理を絞れる。
- PR のクローズや automation branch への手動コミットは自動処理の停止手段にならない。
- PR の具体的な作成・更新・クローズ動作は、固定バージョンの `create-pull-request` に従う。実環境での確認は初回運用チェックリストで行う。

## 参照

- [create-pull-request v8.1.1 の動作](https://github.com/peter-evans/create-pull-request/blob/v8.1.1/README.md#action-behaviour)
