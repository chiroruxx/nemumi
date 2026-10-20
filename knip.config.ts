import type { KnipConfig } from 'knip';

export default (args: { production?: boolean }): KnipConfig => ({
  entry: ['scripts/cli/*.ts!', 'src/pages/**/*.{astro,mdx,js,ts}!'],
  project: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,astro}!', '!tests/**!'],
  ignoreDependencies: [
    // Cloudflare Workers Builds invokes Wrangler from its deployment environment.
    'wrangler',
    ...(args.production
      ? [
          // Knip 6.41.0 production omits imports from Astro config modules.
          '@astrojs/sitemap',
        ]
      : []),
  ],
});
