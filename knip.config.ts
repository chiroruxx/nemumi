import type { KnipConfiguration } from 'knip';

export default (args: { production?: boolean }): KnipConfiguration => ({
  // Astro plugin が標準の入口を検出するため、独自 CLI の入口だけ追加する。
  entry: ['scripts/cli/*.ts!', '.codex/hooks/*.mjs!'],
  ignoreBinaries: [
    // The Codex edit hook uses mise to run the repository-pinned Biome CLI.
    'mise',
  ],
  project: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,astro}!', '!tests/**!'],
  ignoreDependencies: [
    // Cloudflare Workers Builds invokes Wrangler from its deployment environment.
    'wrangler',
    // The setup script invokes Lefthook through pnpm exec after dependencies are installed.
    'lefthook',
    ...(args.production
      ? [
          // Knip 6.41.0 production omits imports from Astro config modules.
          '@astrojs/sitemap',
        ]
      : []),
  ],
});
