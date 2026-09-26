export default {
  extends: ['stylelint-config-standard', 'stylelint-config-astro'],
  plugins: ['stylelint-use-nesting'],
  rules: {
    'csstools/use-nesting': 'always',
    'selector-pseudo-class-disallowed-list': ['global'],
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
};
