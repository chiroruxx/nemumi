export default {
  extends: ['stylelint-config-standard', 'stylelint-config-astro'],
  plugins: ['stylelint-use-nesting'],
  rules: {
    'csstools/use-nesting': 'always',
    // コンポーネントのスコープ外へ影響を広げる指定は、理由付きの行単位の例外にする。
    'selector-pseudo-class-disallowed-list': ['global'],
    // ファイル全体・範囲・同じ行の無効化を禁止し、理由付きの次行指定だけを許可する。
    // この制約自体を無効化して回避できないようにする。
    'comment-word-disallowed-list': [
      ['/^stylelint-disable(?:-line)?(?:\\s|$)/'],
      { reportDisables: true },
    ],
    // Biome が整形を担当するため、空行の形式ルールは重複・競合を避けて無効にする。
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'at-rule-empty-line-before': null,
    // Astro のスコープ付き CSS で使う :global() を未知の擬似クラス扱いしない。
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['global'] },
    ],
  },
  // 例外の `stylelint-disable` には理由の記載を必須にする。
  reportDescriptionlessDisables: true,
  // 無関係なルールまで無効化しないよう、対象ルールを明示させる。
  reportUnscopedDisables: true,
};
