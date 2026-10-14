# 0037. コンテンツ API は定義元から import する

- **ステータス**: 承認
- **日付**: 2026-10-15

## 背景

`external-content.ts` は計画、ファイル操作、HTTP の関数と型を再 export する facade として、内部利用者へ複数モジュールの API
を中継していた。
利用者は実際の定義元を意識せずに済む一方、モジュール境界と import 先が一致しなかった。

## 決定

- `external-content.ts` は同期・削除の処理を組み立てる関数と、その関数の options/result 型を公開する。
- 計画、HTTP、ファイル操作の関数・型は各定義元から直接 import し、`external-content.ts` から互換性目的で再 export しない。
- この決定は [ADR 0028](0028-separate-content-planning-and-application.md) の facade による互換性維持の決定を置き換える。
- CLI 向けの変更・削除 DTO を返す決定は [ADR 0036](0036-report-unverified-content-urls.md) によりすでに置き換えられている。

## 結果

- import 文から利用する機能の定義元を確認できる。
- orchestration module の export とテストを、計画・通信・ファイル処理の API から分けられる。
