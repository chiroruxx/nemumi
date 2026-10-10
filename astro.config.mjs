// @ts-check

import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://nemumi.dev',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'DM Sans',
      cssVariable: '--font-dm-sans',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      // Keep Noto Sans JP next in the global font stack for Japanese glyphs.
      fallbacks: [],
    },
    {
      provider: fontProviders.google(),
      name: 'Noto Sans JP',
      cssVariable: '--font-noto-sans-jp',
      weights: ['400 600'],
      styles: ['normal'],
    },
  ],
  integrations: [
    sitemap({
      // The 404 page is for error handling and should not appear in search results.
      filter: (page) => new URL(page).pathname !== '/404.html',
    }),
  ],
});
