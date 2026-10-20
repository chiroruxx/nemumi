# ローカルレビュー skill の評価入力

各ケースは独立したレビュー入力として使う。レビュアーにはケースの仕様と差分だけを渡し、この評価資料の他ケースや期待結果は渡さない。擬似コードの `file.ts` の行番号は各コードブロックの先頭を1行目とする。

## ケース 1

`docs/feature.md`:

> 必須要件: 同期で確認できなかったリンクは削除しない。
> 未採用候補: なし。

差分:

```diff
- 必須要件: 同期で確認できなかったリンクは削除しない。
+ 未採用候補: 確認できなかったリンクを削除対象にする。
```

## ケース 2

要件: `sync` はRSSを同期し、`prune` は保存済み項目の上限を整理する。リンク有効性の報告は `checkLinks` の責務で、`sync` と `prune` はリンクを確認しない。

差分:

```ts
// sync.ts
export async function sync() {
  const changes = await fetchAndSync();
  return { changes, unverifiedLinks: [] };
}

// prune.ts
export async function prune() {
  const deleted = await pruneByLimit();
  return { deleted, unverifiedLinks: [] };
}

// check-links.ts
export async function checkLinks() {
  const unverifiedLinks = await fetchLinkResults();
  return { unverifiedLinks };
}

// report.ts
export function formatUnverifiedLinks(result: { unverifiedLinks: string[] }) {
  if (result.unverifiedLinks.length === 0) return "";
  return `Unverified: ${result.unverifiedLinks.join(", ")}`;
}

// cli.ts
const syncResult = await sync();
printChanges(syncResult.changes);
console.log(formatUnverifiedLinks(syncResult));

const pruneResult = await prune();
printDeleted(pruneResult.deleted);
console.log(formatUnverifiedLinks(pruneResult));

const linkResult = await checkLinks();
console.log(formatUnverifiedLinks(linkResult));
```

## ケース 3

要件: `sync` は変更を保存し、変更一覧を報告する。

差分:

```ts
// sync.ts
const operations = changes.map((change) => ({
  path: change.path,
  action: change.action,
  content: change.content,
}));
await applyOperations(operations);
```

`Operation` 型はこの呼び出し以外で使われず、変換では検証・分岐・形式変換を行わない。

## ケース 4

要件: `isChecked` は内部でリンク結果を分類するだけで、利用者向け API ではない。

差分:

```diff
 // link-results.ts
-function isChecked(result: LinkResult): boolean {
+export function isChecked(result: LinkResult): boolean {
   return result.kind === "checked";
 }
```

この変更で `tests/link-results.test.ts` から直接 import している。公開関数の直接テストを求めるリポジトリ規則がある。

## ケース 5

要件: 同一内容なら不要な書き込みを省く。

差分:

```ts
function sameContent(existing: string, incoming: string): boolean {
  return existing === incoming;
}

if (sameContent(current, fetched)) return;
```

他に関連する不具合や要件違反は示されていない。

## ケース 6

要件: バッチ間に1秒待機する。既存コードは `node:timers/promises` の `delay` を `sleep(ms, signal)` の呼出し形で包み、呼出し側から中断 signal を渡せるようにする。テストでは待機を決定的に進められる。

差分:

```ts
import { setTimeout as delay } from "node:timers/promises";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal });
}

await sleep(1000, signal);
```

この adapter がバッチ待機の唯一の境界であり、Node のテストはタイマーを mock して待機を進める。他に関連する不具合や要件違反は示されていない。
