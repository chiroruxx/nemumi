# コンテンツ自動更新

**ステータス: 初回運用確認待ち**

## 要件分類

- **必須要件**: 「決定済みの動作」「設定」「初回運用チェックリスト」「停止・復旧」に記載した内容は、この仕組みの受け入れ条件と運用条件である。
- **未採用候補**: 現在なし。今後の改善案は採用を決めるまで実装対象に含めない。
- **実装裁量**: 上記の動作を保つ内部構造や補助関数の選択。技術方針は [関連 ADR](../adr/2026-10-13-sync-external-content-from-rss.md) と [HTTP ライブラリ選定 ADR](../adr/2026-10-18-select-http-library.md) に従う。

## 決定済みの動作

毎日 JST 06:17 に `main` を取得し、3つの公開 RSS の同期、保存済みリンクの確認、件数上限による削除の順に実行して、
差分を1つの PR にまとめる。独立した削除ワークフローは設けない。同期は RSS を読み、prune は RSS を取得しない。
`articles` は最大20件、`talks` は最大10件とし、手動・自動管理を区別せず、古い YAML を上限件数まで削除する。

コンテンツ同期の構成は [外部コンテンツを RSS から同期する](../adr/2026-10-13-sync-external-content-from-rss.md) に従う。

同期は件数上限で絞り込まず RSS
の全項目を取り込み、空のRSS・不正なYAML・URL衝突・検証失敗で差分を適用しない。同期では既存ファイルの正式schema外フィールドは保持対象にしないため、更新時に消える。pruneは保存済み
YAML の日付・URL（URL がない項目はファイルパス）で対象を選び、同一実行内で削除後の補充はしない。unverified・unchecked
のリンクはリンク確認では削除しないが、保持件数の上限は適用する。

リンク確認では直接404・410を返した URL のみ削除する。リダイレクト応答は転送先を確認せず `public` として残す。

リンク確認はサービスを問わず最大5件ずつ並列実行し、次のバッチまで1秒待機する。個々の HTTP リクエスト間隔は制御しない。

RSS 取得とリンク確認には [Ky を採用する](../adr/2026-10-18-select-http-library.md)。

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
で解除する。更新ワークフローを無効化しても既存PRの自動マージは停止しない。自動処理全体を停止するときは更新ワークフローを無効化し、必要な既存PRの
auto-merge も解除する。

PR の手動クローズや automation branch への手動コミットでは自動処理は停止しない。automation branch は自動処理専用とし、手動変更は通常の
PR で `main`
に反映する。

feed/API/CI の失敗はActionsログとPRチェックを確認する。通信期限時に未確認のリンクは削除せず、次回の更新ワークフローで再確認する。HTTP
200 のサービス固有エラーページなど、公開状態を機械判定できないケースは手動確認する。
