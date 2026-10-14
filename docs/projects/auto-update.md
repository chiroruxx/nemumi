# コンテンツ自動更新

**ステータス: 初回運用確認待ち**

## 決定済みの動作

3つの公開 RSS を毎日 JST 06:17 にサービス別で同期し、毎日 JST 07:17 に `main` の保存済み YAML を対象に prune する。同期 PR はサービスごと、prune PR は共通の固定 branch で作成・更新する。同期はRSSを読み、pruneはRSSを取得しない。`articles` は最大20件、`talks` は最大10件とし、手動管理データは件数枠を使うが自動削除しない。

コンテンツ同期、RSS取得、URL確認、YAML適用は [ADR 0025](../adr/0025-sync-external-content-from-rss.md)、保存済みデータの pruning は [ADR 0027](../adr/0027-prune-stored-content-without-rss.md)、通信期限は [ADR 0029](../adr/0029-bound-content-network-execution.md) を参照する。PRの停止・再開、branch保護、GitHub App token と自動マージは [ADR 0030](../adr/0030-guard-content-automation-lifecycle.md) に従う。

同期は空のRSS・不正なYAML・URL衝突・検証失敗で差分を適用しない。同期では既存ファイルの正式schema外フィールドは保持対象にしないため、更新時に消える。pruneは保存済み YAML の日付・URLだけで対象を選び、同一実行内で削除後の補充はしない。defer、review、未確認リンクは保持する。

## 初回運用チェックリスト

- [ ] GitHub App、Actions settings、repository permissions、Auto-merge と必須チェックを [README の設定手順](../../README.md#外部コンテンツの自動更新) に沿って確認する。
- [ ] 本番前に `workflow_dispatch` を main 以外の選択branchからも試し、checkout が `main` のコードを使うことを確認する。
- [ ] 各サービスの実際の feed・既存 PR が期待どおり処理されることを確認する。
- [ ] 差分のない PR が marker 付きで閉じること、bot が閉じた PR に新しい差分が戻ると再利用すること、人が閉じた PR は止まることを確認する。
- [ ] 手動 commit が automation branch にあると guard が停止し、通常のレビュー経路で修正できることを確認する。
- [ ] 必須 CI 成功後の auto-merge と、false/未設定での手動マージを確認する。既存 PR に設定済みの auto-merge は変数変更だけでは解除されない。
- [ ] マージ後の Workers Builds と本番ページを確認し、同じ入力の再実行で不要な差分・PR が生じないことを確認する。

## 停止・復旧

`CONTENT_AUTO_MERGE=false` または未設定では、新しく自動マージを要求せず、同期・prune・PR作成は続く。既存PRに設定済みの auto-merge は解除されないため、PR画面または `gh pr merge <番号> --disable-auto` で解除する。両workflowを無効化しても既存PRの自動マージは停止しない。自動処理全体を停止するときは両workflowを無効化し、必要な既存PRの auto-merge も解除する。

人が未マージPRを閉じると、そのPRは自動で再開されない。再開する場合は対象PRを手動で再 open する。automation branch に手動commitがあるとguardは停止するため、その変更を通常のレビュー経路で `main` に反映するか、意図した内容を退避してbranchを `main` から作り直す。詳細は [ADR 0030](../adr/0030-guard-content-automation-lifecycle.md) を参照。

feed/API/CI の失敗はActionsログとPRチェックを確認する。通信期限時に未確認のリンクは削除せず、次回のpruneで再確認する。HTTP 200 のサービス固有エラーページなど、公開状態を機械判定できないケースは手動確認する。
