# HTTPライブラリを選定する

- **ステータス**: 承認
- **日付**: 2026-10-18

## 背景

HTTP 通信を標準 Fetch API で直接実装すると、再試行・待機・タイムアウト・応答サイズ制限を独自に保守する必要がある。
汎用的な通信制御をライブラリに任せ、アプリケーション固有の判定に集中できる構成にしたい。

既存のコードとテストは Fetch API の Request・Response を利用しているため、この構成を活かせることを重視する。
また、細かな挙動を独自に再現するとライブラリ導入による保守負担の削減につながらないため、標準動作を活用できるものを選ぶ。

## 決定

- HTTP ライブラリとして **Ky** を採用する。
- 汎用的な通信制御は Ky に任せ、アプリケーション固有の解析・検証・判定はアプリケーション側で扱う。

## 検討した選択肢

| 選択肢               | 判断                                                                                                                                       |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| **Ky**               | Fetch ベースで既存の Request・Response とテスト用 fetch を活かせる。再試行・タイムアウト・応答サイズ制限をまとめて任せられるため採用する。 |
| Got                  | Node.js 向けの通信機能は充実しているが、Fetch と異なる入出力への移行が必要になる。今回の保守負担削減では Ky を優先する。                   |
| Axios ＋ axios-retry | 応答サイズ制限を持つが、再試行には追加プラグインなどが必要で、Fetch と異なる応答・エラー型への対応も増える。                               |
| Undici               | 再試行や接続制御の機能を持つが、dispatcher の構成と終了処理など、通信基盤の管理が増える。詳細な接続制御は今回の選定目的ではない。          |
| ofetch               | Fetch ベースで既存構成と馴染むが、調査した v1 では専用の応答サイズ制限を確認できず、独自処理が残るため Ky を優先する。                     |
| 標準 Fetch API       | 追加依存は不要だが、汎用的な通信制御の独自実装が残る。                                                                                     |

比較は2026-10-18時点の公式ドキュメント・公開ソースに基づく。
Ky は応答サイズ制限が公開された v2.2.0、ofetch は v1、Axios は v1.x、Got・Undici は公式リポジトリの main を参照した。
Got の応答サイズ制限は追加設計が必要と判断したもので、対応不可能と断定するものではない。

## 結果

- 通信制御の独自実装を減らし、Fetch ベースのコードとテストを継続利用できる。
- ライブラリの標準動作への依存が増えるため、更新時には既定値やエラー型の変更を確認する必要がある。
- アプリケーション固有の仕様はコード・テストと対応するドキュメントで管理する。

## 参考

- [Ky の API](https://github.com/sindresorhus/ky/blob/v2.2.0/readme.md)・[応答サイズ制限のリリース](https://github.com/sindresorhus/ky/releases/tag/v2.2.0)
- [Got の再試行](https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md)・[タイムアウト](https://github.com/sindresorhus/got/blob/main/documentation/6-timeout.md)・[オプション](https://github.com/sindresorhus/got/blob/main/documentation/2-options.md)
- [Axios の設定](https://axios.rest/pages/advanced/request-config)・[axios-retry](https://github.com/softonic/axios-retry)
- [Undici RetryAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryAgent.md)・[Client](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)
- [ofetch v1 の API](https://github.com/unjs/ofetch/blob/v1/README.md)・[型定義](https://github.com/unjs/ofetch/blob/v1/src/types.ts)
