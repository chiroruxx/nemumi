# 外部コンテンツ取得の HTTP クライアントを選定する

- **ステータス**: 承認
- **日付**: 2026-10-18

## 背景

[外部コンテンツを RSS から同期する](2026-10-13-sync-external-content-from-rss.md)処理は、Node.js 26 の標準 Fetch API と
`rss-parser` を利用して GitHub Actions で実行している。
`scripts/lib/external-content-http.ts` には、通信そのものの制御と、サイト固有の公開状態の判定が同居している。
汎用的な再試行・待機・応答サイズ制限をライブラリへ任せ、保守するコードを減らせるか検討する。

従来の通信要件を厳密に維持すると、Ky の既定値との差を埋めるために独自の待機計算・Fetch のラップ・エラー変換が残り、コードをほとんど減らせなかった。
定期的な RSS 取得では待機時間やエラー文言の一致は取り込み結果に影響しないため、通信制御を Ky に合わせる。
URL の許可範囲、不正・空の RSS の拒否、部分的な取り込みの防止は維持する。

ライブラリの調査は2026-10-18時点の公式ドキュメント・公開ソースを対象とする。
Ky は公開済みの v2.2.0、ofetch は v2 alpha の開発ブランチではなく v1 の資料を参照した。
Got・Undici は公式リポジトリの main、Axios は v1.x の資料を参照したため、採用時には実際に導入するリリースでも機能を確認する。
Ky v2.2.0 を導入し、ネットワークを使わない HTTP・同期・CLI のテストで確認した。性能測定は行っていない。

## 決定

- RSS 取得とリンク確認に **Ky v2.2.0** を採用する。RSS は再試行の制御と `maxResponseSize` による応答ボディの読み取りを任せる。
- RSS の再試行対象・回数・待機時間・`Retry-After` の解釈・エラー型・応答の後始末は Ky の標準動作に従う。サーバ指定の待機時間だけ
  `maxRetryAfter` で10秒に制限する。
- RSS 取得は `totalTimeout` で再試行・待機・ボディ読み取りを含めて30秒以内とし、試行ごとの期限は設けない。
- RSS は自動リダイレクトを無効にし、展開後のボディを `maxResponseSize` で5 MiBに制限する。`Content-Length` による事前拒否はしない。
- XML 解析は既存の `rss-parser` を継続する。URL の許可範囲、日付変換、公開状態の分類、バッチ間隔、実行全体の期限はアプリケーション側の責務として残す。
- リンク確認は `retry: 0` と `throwHttpErrors: false` を指定し、各応答のステータスをアプリケーションで分類する。
  リダイレクトは手動で検証し、各リクエストの応答取得期限は `timeout` で30秒とする。判定に使わない応答ボディは読み取らず解放する。

## 検討した選択肢

| 選択肢                | 任せられる処理                                                                   | この用途での判断                                                                                                                                                            |
|-----------------------|----------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Ky**                | Fetch ベースの再試行、`Retry-After`、タイムアウト、AbortSignal、応答サイズ制限   | 既存の Request・Response とテスト用 fetch を活かしやすい。v2.2.0 の `maxResponseSize` が RSS の制限付き読み取りを置き換える候補になるため、採用する。                       |
| Got                   | 再試行、`Retry-After`、通信段階ごとのタイムアウト、AbortSignal、リダイレクト制御 | Node.js 専用の通信機能は充実しているが、既存の Fetch ベースの応答・モックを変更する範囲が大きい。5 MiB の読み取り制限は別途設計が必要で、今回の縮小目的では Ky を優先する。 |
| Axios ＋ axios-retry  | Axios のタイムアウト・キャンセル・応答サイズ上限と、プラグインによる再試行       | Node.js HTTP adapter の `maxContentLength` を利用できる。一方、再試行は追加プラグインまたは interceptor が必要で、独自の応答・エラー型への対応も増える。                    |
| Undici                | `RetryAgent`、接続・応答待機の制御、Client の `maxResponseSize`                  | dispatcher の構成と終了処理、サイズ制限を適用する層の管理が必要になる。接続プールの詳細な制御は今回の目的ではなく、コードの短縮効果を見込みにくい。                         |
| ofetch v1             | Fetch ベースの再試行・待機間隔・タイムアウト・テキスト取得                       | Fetch を維持できるが、今回確認した v1 の文書・型では専用の応答サイズ上限は確認できない。`Retry-After` と5 MiB上限のための独自処理が残る可能性があり、Ky を優先する。        |
| 標準 Fetch API を継続 | 追加依存なしで現行の動作を維持                                                   | 通信方針を直接制御できる。再試行・サイズ制限の実装は残るが、互換性維持の追加処理が多い場合の代替案とする。                                                                  |

比較の根拠は [Ky の API](https://github.com/sindresorhus/ky/blob/v2.2.0/readme.md)、
[Got の再試行](https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md)・[タイムアウト](https://github.com/sindresorhus/got/blob/main/documentation/6-timeout.md)・[オプション](https://github.com/sindresorhus/got/blob/main/documentation/2-options.md)、
[Axios の設定](https://axios.rest/pages/advanced/request-config)・[再試行の実装例](https://axios.rest/pages/advanced/retry)、
[axios-retry](https://github.com/softonic/axios-retry)、
[Undici RetryAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryAgent.md)・[Client](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)、
[ofetch v1 の API](https://github.com/unjs/ofetch/blob/v1/README.md)・[型定義](https://github.com/unjs/ofetch/blob/v1/src/types.ts)
を参照する。
Got については確認した Options API に `maxResponseSize` 相当の設定は見当たらず、対応不可能という判断ではなく、追加の設計が必要な候補として評価した。
Undici の Client のサイズ上限が、Fetch の展開済みボディを制限する現行処理と同等かは未検証である。

### Ky を選ぶ理由と通信要件の整理

現行の構成は Fetch の差し替えでネットワークなしのテストを行っている。
Ky は Fetch の入出力を保ちながら通信制御をまとめられるため、Got や Axios に応答モデルを変えるより変更範囲を限定しやすい。
応答サイズ制限は [v2.2.0 のリリース](https://github.com/sindresorhus/ky/releases/tag/v2.2.0)で公開されている。

通信失敗時は次回の定期実行でも取得できるため、従来の細かな挙動を再現するより、Ky の通信方針に従うことを優先する。

- 再試行は Ky 標準の最大2回とし、対象は Ky が認識する通信エラーと HTTP 408・413・429・500・502・503・504 にする。
  413 は再試行用ヘッダーがある場合に限る。すべての5xxや任意の例外を再試行する要件は設けない。
- 通常の待機は Ky 標準の300ms・600msとする。`Retry-After` などの対応ヘッダーの解釈も任せる。
  小数秒の独自対応や、ゼロ・過去の日付を通常待機へ戻す処理は設けない。
- 30秒は1試行の制限から RSS 取得全体の制限へ変更する。`timeout: false` と `totalTimeout: 30000`
  を指定し、ボディ読み取りや再試行待機も同じ予算に含める。
  同期・リンク確認それぞれの実行全体の8分の signal は継続し、Ky にも渡す。
- 実際に読み取るボディの5 MiB制限で過大な応答を防ぐ。`Content-Length` による事前拒否や独自のサイズ超過エラーへの変換は不要とする。
- RSS の `redirect: 'manual'` は残す。リダイレクトを含む失敗応答は Ky の HTTP エラーで報告し、設定 URL
  の更新を促す独自文言やボディの即時解放は要件にしない。
  応答の読み取り・解放は Ky に任せ、RSS 取得全体の期限とサイズ上限を適用する。

リンク確認も Ky に統一し、タイムアウトと実行全体の中断を任せる。再試行と HTTP エラーの自動送出を無効にして、
リダイレクト先ごとの許可範囲の検証、最大5回の転送、ループ検出、公開状態の分類を維持する。
5件のバッチ完了後に1秒待ち、最終バッチ後は待たない。期限内の結果と未確認 URL を分けて返す。

## 結果

- 独自の再試行・待機計算・RSS 用 Fetch ラップ・エラー変換を削除し、Ky の設定と RSS 解析の呼び出しに集約する。
- RSS の再試行は以前より対象が限定され、取得全体の期限も厳しくなる。失敗時は差分を適用せず、次回の実行で再取得する。
- HTTP・同期・CLI のテストで取り込み結果を確認し、RSS の総期限が応答待ち・ボディ読み取り・再試行待機に適用されることを検証する。
- 依存パッケージとその更新への対応が増える。ライブラリ側の既定値やエラー型の変更も確認対象となる。
- バッチ処理用のキューライブラリは追加しない。
