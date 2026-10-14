# 0030. コンテンツ自動 PR のライフサイクルを保護する

- **ステータス**: 承認
- **日付**: 2026-10-13

PR lifecycle guard と手動コミットの確認、および no-diff marker
による再開判定は [ADR 0034](0034-delegate-content-pr-management.md) で廃止した。認証・共通 action・自動マージ・実行制限の決定は継続する。

## 背景

RSS 同期と保存済みデータの整理は、同じ固定ブランチの PR を再利用する。差分が消えた PR をそのまま残さず、手動で閉じた PR や
automation branch に入った手動コミットを自動処理が無視・上書きしないようにする必要がある。さらに、PR 操作に使う
installation token と、checkout に残る認証情報を分けて管理する。

## 決定

- 同期と削除の workflow は `main` を明示して checkout し、checkout に Git 認証情報を残さない。両方から共通の composite
  action を呼び、mise のセットアップ、依存関係の固定インストール、コンテンツ処理、PR lifecycle guard、PR
  作成・更新、自動マージを同じ順序で実行する。
- 各 workflow は `contents: read` のみを `GITHUB_TOKEN` に許可する。PR 操作は対象 repository にインストールした GitHub
  App の installation token を使い、App の Contents と Pull requests の権限は Read and write とする。token をログや PR
  本文に出力しない。
- 同期ブランチはサービス別、削除ブランチは共通の固定名を使う。PR は `main` 向けとし、生成対象は `articles`・`talks` の YAML
  に限定する。PR branch は自動削除しない。
- guard は PR 一覧と比較 commit の全ページを確認し、最新 PR を選ぶ。automation branch の base 以降の commit は、committer が
  `github-actions[bot]` と API で確認できる場合だけ処理を続ける。commit author は手動 dispatch の実行者になる場合があるため、信頼判定には使わない。
- branch に手動 committer の commit がある場合、API 情報が欠落・不正な場合、または手動で閉じられた未マージ PR の場合は、PR
  を変更せず workflow を失敗させる。
- open PR の差分がなくなった場合は、現在の本文を保って no-diff marker を付け、PR を閉じる。閉じた PR の最新 close がこの
  App によるもので、marker があり、新しい差分ができた場合は marker を外して再 open する。人が再 open した PR は運用再開として扱う。
- `CONTENT_AUTO_MERGE` が文字列 `true` のときだけ PR 本文に自動マージの案内を記し、必須 CI 成功後に
  `gh pr merge --auto --squash` を要求する。それ以外は手動確認用の本文にして、新しい自動マージを要求しない。すでに PR
  に設定された自動マージは解除しない。branch protection や必須チェックは回避しない。
- workflow の各 job は10分で終了する。共通 concurrency で同期・削除の PR 操作を直列化し、サービス matrix 内は
  `fail-fast: false` で独立して実行する。

## 結果

- 差分が消えた PR は marker とともに閉じ、後で新しい差分ができた場合に限り、automation が閉じた PR を再利用できる。
- 人が閉じた PR と手動 committer の branch は自動再開・上書きされない。再開する場合は PR を再 open し、branch の手動
  commit を `main` に反映するか、automation branch を `main` から作り直してから処理する。
- `CONTENT_AUTO_MERGE` を false にしても PR の作成・更新は続き、新しい自動マージだけを要求しない。既存 PR の auto-merge は
  PR 画面または `gh pr merge <番号> --disable-auto` で個別に解除する。両 workflow を無効化しても、既存 PR の auto-merge
  は解除されない。自動処理全体を止める場合は両 workflow を無効化し、必要な既存 PR の auto-merge も解除する。
- guard は GitHub API が返す PR、close event、commit identity を前提に安全側へ停止する。外部設定、branch protection、App
  installation、実際の CI 起動・本番公開は repository owner が初回運用で確認する。

## 参照

- [GitHub Actions の workflow command と step output](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions)
- [GitHub App token を workflow で使う](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow)
- [`create-pull-request` action の入力](https://github.com/peter-evans/create-pull-request#action-inputs)
- [外部コンテンツ同期と削除の方針](0025-sync-external-content-from-rss.md)
- [保存済みコンテンツだけを prune する方針](0027-prune-stored-content-without-rss.md)
- [通信実行の時間上限](0029-bound-content-network-execution.md)
