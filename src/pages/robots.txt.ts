import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error('The site URL must be configured to generate robots.txt.');
  }

  const sitemapURL = new URL('sitemap-index.xml', site);
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${sitemapURL.href}\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
