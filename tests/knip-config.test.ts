import assert from 'node:assert/strict';
import test from 'node:test';
import knipConfig from '../knip.config.ts';

test('only production mode ignores Astro sitemap dependency detection', () => {
  const regularConfig = knipConfig({});
  const productionConfig = knipConfig({ production: true });

  assert.ok(!regularConfig.ignoreDependencies?.includes('@astrojs/sitemap'));
  assert.ok(productionConfig.ignoreDependencies?.includes('@astrojs/sitemap'));
});
