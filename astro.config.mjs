// @ts-check

import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://nemumi.dev',
  integrations: [
    sitemap({
      // The 404 page is for error handling and should not appear in search results.
      filter: (page) => new URL(page).pathname !== '/404.html',
    }),
  ],
});
