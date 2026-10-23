# Biome 2.6.2 の設定追加と移行評価

評価日: 2026-10-23。Biome 2.6.2 と現在のリポジトリ設定を対象とする。

## 今回の設定

- **必須要件**: Markdown の YAML frontmatter を認識し、`noLoopFunc`、`useArraySome`、`useRegexpTest` を error として検査する。
- **未採用候補**: Stylelint の置き換えと、以下の nursery ルール。推奨候補も採用決定までは有効化しない。
- **実装裁量**: 設定の配置と、検証用の一時 fixture の作り方。

適用設定は `biome.jsonc`、設計の背景は [安定版ルールによる検査の ADR](../adr/2026-10-23-detect-intent-with-stable-biome-rules.md)を参照する。

## Stylelint と Biome の比較

比較結果は **Stylelint の継続が適切**。現行の [CSS 検査方針](../adr/2026-09-26-native-css-nesting.md)と [無効化方針](../adr/2026-10-17-require-reasons-for-lint-suppressions.md)を維持する。

`stylelint.resolveConfig('src/components/Hero.astro')` で継承を解決すると81ルールが有効だった。
解決済みの rules を一時ディレクトリの Stylelint JSON 設定へ保存し、`biome migrate stylelint --include-inspired --include-nursery` を実行した。
移行ツールは24ルール（29%）を対応済み、57ルールを未対応と報告した。この割合は移行ツールの対応率であり、機能全体の同等性を示すものではない。

リポジトリの設定を直接渡した場合は、pnpm の間接依存 `stylelint-config-recommended` の解決に失敗した。
上記の比較はその影響を避けるため設定を解決してから実施し、依存関係は追加していない。

移行後の一時 Biome 設定は Astro 対応を有効にし、CSS Lint を実行できる状態で比較した。現在のリポジトリでは Astro 内の CSS Lint は Biome で無効になっている。

| 検査                       | 現行 Stylelint                                 | Biome の移行後設定                        |
| -------------------------- | ---------------------------------------------- | ----------------------------------------- |
| 未知の CSS プロパティ      | `property-no-unknown` で検出                   | `noUnknownProperty` で検出                |
| ネストできる隣接ルール     | `csstools/use-nesting` で検出                  | 検出しない                                |
| `:global()`                | `selector-pseudo-class-disallowed-list` で検出 | 検出しない                                |
| 理由のない無効化           | `reportDescriptionlessDisables` で検出         | Biome 独自の無効化構文で理由の欠落を検出  |
| ファイル全体の無効化       | `comment-word-disallowed-list` で検出          | 理由付き `biome-ignore-all` を受け入れる  |
| 対象ルールを省略した無効化 | `reportUnscopedDisables` で検出                | 理由付き `biome-ignore lint` を受け入れる |

未知のプロパティ、ネスト、`:global()` は一時 `.astro` ファイルの `<style>` 内で実行した。
ネストの比較例は `.card { color: red; }` に続く `.card:hover { color: blue; }`。
無効化は各ツール固有のコメント構文で比較した。Biome は Stylelint のコメントを無効化として扱わない。
Biome のファイル全体と対象ルール省略の比較には、一時 `.css` ファイルと `noUnknownProperty` を使用した。

未対応の57ルールにはネスト強制・無効化コメントの検査以外にも、`declaration-property-value-no-unknown`、`property-no-deprecated`、`media-query-no-invalid` が含まれる。
一部の表記ルールを formatter で代替できるとしても、これらの検査を維持した完全移行とはならない。

## 新規 nursery ルールの個別評価

2.6.2 の公式変更履歴で新規追加とされた46ルールを対象とする。既存 nursery の改善と、安定版へ昇格したルールは含めない。
各ルールを `mise exec -- pnpm exec biome lint --only=nursery/<rule> . --reporter=json --max-diagnostics=none` で個別に試行した。
対象外のフレームワークに関する指摘0件は、適用対象がないためであり、そのフレームワークでの動作確認を意味しない。
指摘数は設定追加後・本評価文書追加前の171ファイルに対する結果。

**推奨候補は `noAccidentalBitwiseOperators`、`noPromiseExecutorReturn`、`noUselessAssignment`、`noProcessExit`。今回は評価のみとし、設定は変更しない。**

| ルール                                                                                                       | 評価       | 指摘数 | 個別の確認結果                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| [`noDoubleComparison`](https://biomejs.dev/linter/rules/no-double-comparison/)                               | 任意候補   | 0      | 比較を単一の条件へ簡略化する。現コードに指摘なし。                                                                          |
| [`noNestedSwitch`](https://biomejs.dev/linter/rules/no-nested-switch/)                                       | 保留       | 0      | 既存の認知的複雑度の検査で必要性を確認し、追加の構造制約は今は設けない。                                                    |
| [`noNestedTemplateLiterals`](https://biomejs.dev/linter/rules/no-nested-template-literals/)                  | 保留       | 1      | URL 一覧の文字列生成に1件。短い内側のテンプレートまで分離する利点は小さい。                                                 |
| [`noObjectConstructor`](https://biomejs.dev/linter/rules/no-object-constructor/)                             | 任意候補   | 0      | 空の Object コンストラクターをリテラルへ統一する。現コードに指摘なし。                                                      |
| [`noSvelteClassDirective`](https://biomejs.dev/linter/rules/no-svelte-class-directive/)                      | 対象外     | —      | Svelte のclass: directiveを検査する。Svelte を使用していない。                                                              |
| [`noUselessDateGetTime`](https://biomejs.dev/linter/rules/no-useless-date-get-time/)                         | 任意候補   | 0      | Date のコピーを簡略化する。現コードに指摘なし。                                                                             |
| [`noVueLifecycleAfterAwait`](https://biomejs.dev/linter/rules/no-vue-lifecycle-after-await/)                 | 対象外     | —      | Vue のawait 後の lifecycle 登録を検査する。Vue を使用していない。                                                           |
| [`noVueRootVIf`](https://biomejs.dev/linter/rules/no-vue-root-v-if/)                                         | 対象外     | —      | Vue の単一ルートの v-ifを検査する。Vue を使用していない。                                                                   |
| [`noVueShadowNativeEvents`](https://biomejs.dev/linter/rules/no-vue-shadow-native-events/)                   | 対象外     | —      | Vue の標準イベント名との衝突を検査する。Vue を使用していない。                                                              |
| [`noVueVHtml`](https://biomejs.dev/linter/rules/no-vue-v-html/)                                              | 対象外     | —      | Vue のv-htmlを検査する。Vue を使用していない。                                                                              |
| [`noVueVText`](https://biomejs.dev/linter/rules/no-vue-v-text/)                                              | 対象外     | —      | Vue のv-textを検査する。Vue を使用していない。                                                                              |
| [`noZeroFractions`](https://biomejs.dev/linter/rules/no-zero-fractions/)                                     | 保留       | 0      | 数値リテラルの表記制約であり、検出したい不具合への寄与が小さい。                                                            |
| [`useConsistentJsonFileRead`](https://biomejs.dev/linter/rules/use-consistent-json-file-read/)               | 保留       | 0      | JSON 読み込みの文字コード指定に指摘なし。表記統一の必要が生じたときに再検討する。                                           |
| [`useMatchingFunctionName`](https://biomejs.dev/linter/rules/use-matching-function-name/)                    | 任意候補   | 0      | 変数名と名前付き関数式の不一致を防ぐ。現コードに指摘なし。                                                                  |
| [`useSimplifiedBooleanReturn`](https://biomejs.dev/linter/rules/use-simplified-boolean-return/)              | 任意候補   | 0      | 真偽値だけを返す分岐を簡略化する。現コードに指摘なし。                                                                      |
| [`useSvelteKitResolve`](https://biomejs.dev/linter/rules/use-svelte-kit-resolve/)                            | 対象外     | —      | Svelte のSvelteKit のパス解決を検査する。Svelte を使用していない。                                                          |
| [`useSvelteReactiveClasses`](https://biomejs.dev/linter/rules/use-svelte-reactive-classes/)                  | 対象外     | —      | Svelte の組み込みオブジェクトのリアクティビティを検査する。Svelte を使用していない。                                        |
| [`useSvelteShorthandDirective`](https://biomejs.dev/linter/rules/use-svelte-shorthand-directive/)            | 対象外     | —      | Svelte のdirective の短縮形を検査する。Svelte を使用していない。                                                            |
| [`useVueMatchingComponentFileName`](https://biomejs.dev/linter/rules/use-vue-matching-component-file-name/)  | 対象外     | —      | Vue のコンポーネント名とファイル名の一致を検査する。Vue を使用していない。                                                  |
| [`useCapitalizedConstructors`](https://biomejs.dev/linter/rules/use-capitalized-constructors/)               | 不採用候補 | 2      | Astro の GET を通常の関数として呼ぶ既存テスト2箇所を警告する。大文字名はコンストラクターとは限らない。                      |
| [`noExcessiveStatementsPerFunction`](https://biomejs.dev/linter/rules/no-excessive-statements-per-function/) | 不採用候補 | 37     | 既定の10文で37件。直線的なテストの準備・検証も対象となり、既存の認知的複雑度の検査と目的が異なる。                          |
| [`useVueConsistentEventHyphenation`](https://biomejs.dev/linter/rules/use-vue-consistent-event-hyphenation/) | 対象外     | —      | Vue のイベント名のハイフン表記を検査する。Vue を使用していない。                                                            |
| [`noOctal`](https://biomejs.dev/linter/rules/no-octal/)                                                      | 保留       | 0      | 旧式8進数を禁止する。ES modules と TypeScript の構文検査との重複が大きい。                                                  |
| [`noAccidentalBitwiseOperators`](https://biomejs.dev/linter/rules/no-accidental-bitwise-operators/)          | 推奨候補   | 0      | 論理演算子とビット演算子の取り違えを防ぐ。現コードに指摘なし。                                                              |
| [`noVueBooleanDefault`](https://biomejs.dev/linter/rules/no-vue-boolean-default/)                            | 対象外     | —      | Vue のBoolean props の既定値を検査する。Vue を使用していない。                                                              |
| [`noPromiseExecutorReturn`](https://biomejs.dev/linter/rules/no-promise-executor-return/)                    | 推奨候補   | 2      | Promise が利用しない戻り値を検出する。非同期テストの executor 2箇所に指摘あり。採用時は戻り値を返さないブロックへ変更する。 |
| [`noTailwindLegacyUtilities`](https://biomejs.dev/linter/rules/no-tailwind-legacy-utilities/)                | 対象外     | —      | Tailwind の旧 utilityを検査する。Tailwind を使用していない。                                                                |
| [`useLowercaseTestTitle`](https://biomejs.dev/linter/rules/use-lowercase-test-title/)                        | 不採用候補 | 9      | 9件。GitHub、GET、CLI などの固有名・識別子を先頭に置くタイトルまで制約する。                                                |
| [`useConsistentBlockLang`](https://biomejs.dev/linter/rules/use-consistent-block-lang/)                      | 対象外     | —      | Vue/Svelte のトップレベルブロックの言語を統一する。Astro には適用されない。                                                 |
| [`noArgumentsCallerOrCallee`](https://biomejs.dev/linter/rules/no-arguments-caller-or-callee/)               | 保留       | 0      | 旧式の arguments プロパティを禁止する。ES modules の strict mode との重複が大きい。                                         |
| [`noSvelteUselessDerivedBy`](https://biomejs.dev/linter/rules/no-svelte-useless-derived-by/)                 | 対象外     | —      | Svelte の不要な derived.byを検査する。Svelte を使用していない。                                                             |
| [`useNamedFunction`](https://biomejs.dev/linter/rules/use-named-function/)                                   | 保留       | 0      | 名前付き関数宣言を中心に使っており、現コードに指摘なし。匿名関数を一律に禁止する必要性は低い。                              |
| [`noUnsafeUnaryMinus`](https://biomejs.dev/linter/rules/no-unsafe-unary-minus/)                              | 保留       | 0      | 数値以外の単項マイナスを検査する。TypeScript の型チェックと重複し、現コードに指摘なし。                                     |
| [`noSvelteObjectInTextMustaches`](https://biomejs.dev/linter/rules/no-svelte-object-in-text-mustaches/)      | 対象外     | —      | Svelte のテキストへのオブジェクト挿入を検査する。Svelte を使用していない。                                                  |
| [`noUselessCall`](https://biomejs.dev/linter/rules/no-useless-call/)                                         | 任意候補   | 0      | 不要な call/apply を通常の呼び出しへ整理する。現コードに指摘なし。                                                          |
| [`noSvelteInspect`](https://biomejs.dev/linter/rules/no-svelte-inspect/)                                     | 対象外     | —      | Svelte のデバッグ用 inspectを検査する。Svelte を使用していない。                                                            |
| [`useUnaryMinus`](https://biomejs.dev/linter/rules/use-unary-minus/)                                         | 保留       | 0      | -1 の乗除算の表記制約。現コードに指摘なし。                                                                                 |
| [`noUselessAssignment`](https://biomejs.dev/linter/rules/no-useless-assignment/)                             | 推奨候補   | 0      | 読み取られる前に上書きされる値を検出する。未使用変数の検査を補完し、現コードに指摘なし。                                    |
| [`useTailwindStaticClassStrings`](https://biomejs.dev/linter/rules/use-tailwind-static-class-strings/)       | 対象外     | —      | Tailwind の動的に組み立てる classを検査する。Tailwind を使用していない。                                                    |
| [`noTailwindRestyledComponents`](https://biomejs.dev/linter/rules/no-tailwind-restyled-components/)          | 対象外     | —      | Tailwind のコンポーネントの見た目の上書きを検査する。Tailwind を使用していない。                                            |
| [`noProcessExit`](https://biomejs.dev/linter/rules/no-process-exit/)                                         | 推奨候補   | 0      | process.exit による標準出力や後処理の打ち切りを防ぐ。既存 CLI・hook の process.exitCode の使い方と整合し、指摘なし。        |
| [`noSvelteAddEventListener`](https://biomejs.dev/linter/rules/no-svelte-add-event-listener/)                 | 対象外     | —      | Svelte のイベント登録 APIを検査する。Svelte を使用していない。                                                              |
| [`noInvalidThis`](https://biomejs.dev/linter/rules/no-invalid-this/)                                         | 保留       | 0      | 不適切な this を検出する。現コードに指摘なし。まず TypeScript の型チェックを継続する。                                      |
| [`noJsRestrictedProperties`](https://biomejs.dev/linter/rules/no-js-restricted-properties/)                  | 保留       | 0      | 個別に禁止するプロパティの要件がない。設定なしでは検査対象を定義できない。                                                  |
| [`noVueRequiredPropWithDefault`](https://biomejs.dev/linter/rules/no-vue-required-prop-with-default/)        | 対象外     | —      | Vue のrequired と既定値の併用を検査する。Vue を使用していない。                                                             |
| [`useBigintLiterals`](https://biomejs.dev/linter/rules/use-bigint-literals/)                                 | 保留       | 0      | BigInt のリテラル表記を優先する。現コードでの使用がなく、導入効果が小さい。                                                 |

`noPromiseExecutorReturn` の指摘は `tests/external-content-http.test.ts` の `setImmediate(resolve)` と `pending.push(resolve)` を暗黙に返す executor。
戻り値は Promise に利用されない。現在の不具合と断定するものではなく、採用すると意図を明示する修正が必要になる。
`useCapitalizedConstructors` の2件は `tests/robots.test.ts` の `GET` 呼び出しで、Astro の公開契約に合った名前である。

## 検証

- 変更前の設定で3種類の違反 fixture が検出されず、変更後の設定で該当ルールの診断が出ることを確認した。
- frontmatter 有効化前には2つの `SKILL.md` の空行に整形エラーが出ることを確認し、適用後の整形・Lint が成功した。
- `mise run ci` で Lint、型チェック、105テスト、本番ビルドが成功した。
- 比較用の設定と fixture は一時ディレクトリだけで使用し、実際の Stylelint 設定や nursery 設定は変更していない。

## 参照

- [Biome 2.6.2 の公式変更履歴](https://github.com/biomejs/biome/blob/%40biomejs/biome%402.6.2/packages/%40biomejs/biome/CHANGELOG.md)
- [Biome の Stylelint 移行コマンド](https://biomejs.dev/reference/cli/#biome-migrate-stylelint)
- [Biome の無効化構文](https://biomejs.dev/analyzer/suppressions/)
