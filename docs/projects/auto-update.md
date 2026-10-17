# コンテンツ自動更新

**ステータス: 初回運用確認待ち**

## 決定済みの動作

3つの公開 RSS を毎日 JST 06:17 に順番に同期し、毎日 JST 07:17 に `main` の保存済み YAML を対象に prune する。同期と prune
はそれぞれ1つの PR を作成・更新する。同期はRSSを読み、pruneはRSSを取得しない。`articles` は最大20件、
`talks` は最大10件とし、手動管理データは件数枠を使うが自動削除しない。

コンテンツ同期の構成は [外部コンテンツを RSS から同期する](../adr/2026-10-13-sync-external-content-from-rss.md)、PR 管理と automation branch
の運用は [コンテンツ自動 PR の管理を create-pull-request に委譲する](../adr/2026-10-14-delegate-content-pr-management.md) に従う。

同期は空のRSS・不正なYAML・URL衝突・検証失敗で差分を適用しない。同期では既存ファイルの正式schema外フィールドは保持対象にしないため、更新時に消える。pruneは保存済み
YAML の日付・URLだけで対象を選び、同一実行内で削除後の補充はしない。defer、review、未確認リンクは保持する。

リンク確認はサービスを問わず最大5件ずつ並列実行し、次のバッチまで1秒待機する。個々の HTTP リクエスト間隔は制御しない。

## 設定

PR 作成には、この repository にインストールした GitHub App を使います。`APP_CLIENT_ID` を
`Settings > Secrets and variables > Actions > Variables` に、`APP_PRIVATE_KEY` を同じ画面の `Secrets` に登録してください。App
をこの repository にインストールし、`Contents: Read and write` と `Pull requests: Read and write` を付与します。branch
protection の bypass 権限は不要です。workflow の `GITHUB_TOKEN` は read-only のままです。

`CONTENT_AUTO_MERGE` が文字列 `true` のとき、必須 CI 成功後に auto-merge を要求します。それ以外（未設定を含む）は新たな自動マージを要求せず、PR
の確認・マージは手動です。自動マージを使う場合は repository 設定で Auto-merge と必須チェックも有効にしてください。初回は自動マージを無効にして差分と
CI を確認し、手動マージします。

## 初回運用チェックリスト

- [ ] GitHub App、Actions settings、repository permissions、Auto-merge
  と必須チェックを [設定手順](#設定) に沿って確認する。
- [ ] 本番前に `workflow_dispatch` を main 以外の選択branchからも試し、checkout が `main` のコードを使うことを確認する。
- [ ] 各サービスの実際の feed・既存 PR が期待どおり処理されることを確認する。
- [ ] 差分のない PR が閉じ、手動クローズ後も次回の差分で PR が作成・更新されることを確認する。
- [ ] 必須 CI 成功後の auto-merge と、false/未設定での手動マージを確認する。既存 PR に設定済みの auto-merge
  は変数変更だけでは解除されない。
- [ ] マージ後の Workers Builds と本番ページを確認し、同じ入力の再実行で不要な差分・PR が生じないことを確認する。

## 停止・復旧

`CONTENT_AUTO_MERGE=false` または未設定では、新しく自動マージを要求せず、同期・prune・PR作成は続く。既存PRに設定済みの
auto-merge は解除されないため、PR画面または `gh pr merge <番号> --disable-auto`
で解除する。両workflowを無効化しても既存PRの自動マージは停止しない。自動処理全体を停止するときは両workflowを無効化し、必要な既存PRの
auto-merge も解除する。

PR の手動クローズや automation branch への手動コミットでは自動処理は停止しない。automation branch は自動処理専用とし、手動変更は通常の
PR で `main` に反映する。詳細は [コンテンツ自動 PR の管理を create-pull-request に委譲する](../adr/2026-10-14-delegate-content-pr-management.md) を参照。

feed/API/CI の失敗はActionsログとPRチェックを確認する。通信期限時に未確認のリンクは削除せず、次回のpruneで再確認する。HTTP
200 のサービス固有エラーページなど、公開状態を機械判定できないケースは手動確認する。
