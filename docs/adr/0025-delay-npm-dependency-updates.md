# 0025. npm 依存の更新は公開から24時間待つ

- **ステータス**: 承認
- **日付**: 2026-10-13

## 背景

Renovate の PR #30 では、公開から約2時間の wrangler と miniflare が lockfile に入り、pnpm の24時間の公開後待機ポリシーにより CI の依存インストールが失敗した。

Renovate の `minimumReleaseAge` は `lockfileUpdate` に適用されない。npm の既定の `rangeStrategy: auto` は、既存のバージョン範囲内の更新を lockfile だけに反映するため、待機時間の指定だけでは今回の更新を抑止できない。

## 決定

- `renovate.json` の npm datasource に `minimumReleaseAge: "1 day"` を設定し、pnpm の24時間の待機時間に合わせる。
- `internalChecksFilter: "strict"` を明示し、待機中のバージョンではブランチと PR を作成しない。
- `rangeStrategy: "bump"` を設定し、バージョン範囲内の更新でも `package.json` の範囲の下限と lockfile を更新する。これにより通常の major・minor・patch 更新として公開後の待機時間を適用する。
- pnpm 側の公開後待機ポリシーは維持する。

## 検討した選択肢

| 選択肢 | 評価 |
|--------|------|
| **24時間の待機と範囲の下限更新を組み合わせる** | 通常の npm 更新について PR 作成前に公開後の待機時間を適用できる |
| 待機時間だけを設定する | lockfile だけの更新には適用されない |
| pnpm の待機ポリシーを緩和する | 公開直後のパッケージをインストールすることになる |

## 結果

- **良い点**
    - 通常の npm 更新は公開から24時間経過した後の Renovate 実行で提案される。
    - 公開直後の直接依存の更新による CI 失敗を減らせる。
- **注意点**
    - バージョン範囲内の更新でも `package.json` に差分が生じる。
    - 推移的依存の公開時刻まで Renovate が保証するわけではなく、pnpm のインストール時チェックは引き続き必要である。
    - lockfile maintenance やセキュリティ更新などは通常のバージョン更新と扱いが異なるため、すべての PR に24時間の待機を保証する設定ではない。
    - 作成済みの PR に対する CI の再実行は別途必要である。

## 参考

- [Renovate: Minimum Release Age](https://docs.renovatebot.com/key-concepts/minimum-release-age/)
- [Renovate: rangeStrategy](https://docs.renovatebot.com/configuration-options/#rangestrategy)
