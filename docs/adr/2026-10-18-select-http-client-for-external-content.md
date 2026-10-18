# 外部コンテンツ取得の HTTP クライアントを選定する

- **ステータス**: 承認
- **日付**: 2026-10-18

## 背景

[外部コンテンツを RSS から同期する](2026-10-13-sync-external-content-from-rss.md)処理は、Node.js 26 の標準 Fetch API と
`rss-parser` を利用して GitHub Actions で実行している。
`scripts/lib/external-content-http.ts` には、通信そのものの制御と、サイト固有の公開状態の判定が同居している。
汎用的な再試行・待機・応答サイズ制限をライブラリへ任せ、保守するコードを減らせるか検討する。

現行実装で維持する通信要件は次のとおり。

- RSS は通信失敗・429・5xx を最大2回再試行する。通常の待機は1秒・2秒で、`Retry-After` の秒数・小数秒・HTTP
  日付を扱い、最大10秒に抑える。
- 1リクエストは応答ボディの読み取りを含めて30秒、同期・リンク確認それぞれの実行全体は8分を上限とする。全体の中断は通信と待機に伝える。
- RSS は5 MiBまでとし、読み取り途中で失敗した応答や不正・空のフィードを部分的に取り込まない。
- RSS のリダイレクトには追従せず、応答ボディを解放して設定 URL の更新を促すエラーにする。
- リンク確認は再試行せず、リダイレクト先ごとに許可する HTTPS ホスト・アカウントのパスを検証する。最大5回の転送とループ検出を維持する。
- リンク確認は5件のバッチ完了後に1秒待ち、最終バッチ後は待たない。期限内の結果と未確認 URL を分けて返す。

ライブラリの調査は2026-10-18時点の公式ドキュメント・公開ソースを対象とする。
Ky は公開済みの v2.2.0、ofetch は v2 alpha の開発ブランチではなく v1 の資料を参照した。
Got・Undici は公式リポジトリの main、Axios は v1.x の資料を参照したため、採用時には実際に導入するリリースでも機能を確認する。
Ky v2.2.0 を導入し、ネットワークを使わない HTTP・同期・CLI のテストで確認した。性能測定は行っていない。

## 決定

- RSS 取得に **Ky v2.2.0** を採用し、再試行の制御と `maxResponseSize` による応答ボディの読み取りを任せる。
- `Retry-After` の解釈と待機は既存の関数を継続し、Ky の `beforeRetry` から実行する。
- XML 解析は既存の `rss-parser` を継続する。URL の許可範囲、日付変換、公開状態の分類、バッチ間隔、実行全体の期限はアプリケーション側の責務として残す。
- リンク確認は標準 Fetch API を継続する。自動リダイレクトや自動再試行で現在の判定を変えない。

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

### Ky を選ぶ理由と互換性の維持

現行の構成は Fetch の差し替えでネットワークなしのテストを行っている。
Ky は Fetch の入出力を保ちながら通信制御をまとめられるため、Got や Axios に応答モデルを変えるより変更範囲を限定しやすい。
応答サイズ制限は [v2.2.0 のリリース](https://github.com/sindresorhus/ky/releases/tag/v2.2.0)で公開されている。

Ky の既定値と現行仕様には差異があるため、次の構成とする。

- 再試行は最大2回とし、429・すべての5xx・応答取得前の通信失敗を対象にする。Fetch が投げたエラーを `NetworkError` にまとめ、Ky
  の再試行対象にする。
  リダイレクト拒否・サイズ超過・ボディ読み取り失敗・XML 解析失敗は再試行しない。
- Ky の標準待機とレート制限ヘッダーの解釈を無効にし、`beforeRetry` で既存の待機処理を実行する。
  Ky v2.2.0 は小数秒の `Retry-After` を待機秒数として解釈しないため、既存の計算を残す。
  1秒・2秒の待機、小数秒・HTTP 日付、10秒上限、無効値・ゼロ・過去の日付では通常待機に戻る仕様を維持する。
- Ky の `timeout` は応答取得とボディ読み取りに別々に適用されるため無効にし、各 Fetch に30秒の `AbortSignal` を渡す。
  応答ボディも同じ signal で中断される。実行全体の8分の signal は Ky と待機にも渡す。
- `maxResponseSize` に5 MiBを指定し、展開後のボディの読み取りを制限する。`Content-Length` による事前拒否も残す。
  サイズ超過は従来の5 MiB制限のエラーに変換する。
- RSS は `redirect: 'manual'` を指定し、リダイレクト応答はボディを解放して設定 URL の更新を促すエラーにする。
  その他の失敗応答も先にボディを解放し、Ky にはステータスとヘッダーだけを渡す。エラーボディの読み取りで再試行を遅らせない。

既存のテストで各サービスの RSS 解析、再試行回数・待機、リダイレクト拒否、応答解放、サイズ超過、ボディ読み取り失敗を確認する。
不足していた `Retry-After` の境界値、`Content-Length` による拒否、ボディ読み取り期限、再試行待機中の実行期限はテストで補い、変更前の実装でも成功することを確認した。
実行全体の中断、同期の保存結果、CLI の動作も関連テストで確認する。

## 結果

- 独自の再試行ループとストリーム読み取り処理を削除する。待機時間の計算と Fetch の応答検査は互換性のために残す。
- 依存パッケージとその更新への対応が増える。ライブラリ側の既定値やエラー型の変更も確認対象となる。
- バッチ処理用のキューライブラリは追加しない。現在の「5件が終了してから1秒待つ」処理は維持する。
