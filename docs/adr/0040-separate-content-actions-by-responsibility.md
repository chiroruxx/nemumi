# 0040. コンテンツ workflow の共通 action を責務ごとに分ける

- **ステータス**: 承認
- **日付**: 2026-10-17

## 背景

Update content と Prune content は別の workflow で、実行する処理も異なる。mode を受け取る共通 action
にそれぞれの処理を集めると、workflow 上で実行順序と失敗時の停止位置を読み取りにくい。また、リンク確認と PR 管理は両
workflow に共通するが、独立した処理として再利用できる。

## 決定

- workflow に各処理の順序を記述する。Update content は選択された sync を順番に実行してからリンク確認し、Prune content
  は件数整理をしてから同じリンク確認を行う。
- sync は `sizu`、`hatena`、`speakerdeck` の順で実行する。サービス選択とその検証は Update content workflow
  に置く。通常の失敗時動作に従い、失敗後の処理を停止する。
- リンク確認は `check-content-links` composite action にまとめ、両 workflow から直接呼び出す。
- pull request と auto-merge の管理は `content-pull-request` composite action にまとめる。action は `mode` と `service`
  を受け取らず、処理結果の summary を入力で受け取る。
- mise のセットアップと依存パッケージのインストールは各 workflow に明示する。

## 結果

- workflow 定義から各処理の順序と失敗時に停止する範囲を確認できる。
- 複数 workflow に共通するリンク確認と PR 管理は、それぞれ専用 action で再利用できる。
- `content-automation` action を `content-pull-request` に改名し、旧 path は使用しない。
