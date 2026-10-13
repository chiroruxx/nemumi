import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const outputDirectory = 'dist-test';

async function findHtmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findHtmlFiles(entryPath);
      }
      return entry.isFile() && path.extname(entry.name) === '.html'
        ? [entryPath]
        : [];
    }),
  );

  return nestedFiles.flat().sort();
}

const pageFiles = await findHtmlFiles(outputDirectory);
const pages = new Map<string, string>(
  await Promise.all(
    pageFiles.map(
      async (filePath): Promise<[string, string]> => [
        path.relative(outputDirectory, filePath).split(path.sep).join('/'),
        await readFile(filePath, 'utf8'),
      ],
    ),
  ),
);
const homePage = pages.get('index.html');
const notFoundPage = pages.get('404.html');

assert.ok(homePage, 'Expected index.html in generated output');
assert.ok(notFoundPage, 'Expected 404.html in generated output');

test('all generated pages include Japanese document metadata', () => {
  assert.ok(pageFiles.length > 0, 'Expected generated HTML pages');

  for (const [filePath, page] of pages) {
    assert.match(
      page,
      /<html lang="ja"/,
      `${filePath} should declare Japanese`,
    );
    assert.match(
      page,
      /<title>[^<]+<\/title>/,
      `${filePath} should have a title`,
    );
    assert.match(
      page,
      /<meta name="description" content="[^"]+"/,
      `${filePath} should have a description`,
    );
  }
});

test('home page includes the main sections', () => {
  assert.match(homePage, /<main\b[^>]*id="top"/);

  for (const sectionId of ['records', 'talks', 'communities']) {
    assert.ok(homePage.includes(`id="${sectionId}"`));
  }
});

test('404 page includes an error heading and a link home', () => {
  assert.match(notFoundPage, /<h1\b[^>]*>[^<]+/);
  assert.match(notFoundPage, /<a\b[^>]*href="\/"/);
});

test('links opened in a new tab have safe rel attributes on every page', () => {
  for (const [filePath, page] of pages) {
    const externalLinks = [...page.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)];

    for (const [anchor] of externalLinks) {
      const rel = anchor.match(/\brel="([^"]+)"/)?.[1].split(/\s+/) ?? [];
      assert.ok(
        rel.includes('noopener'),
        `${filePath}: ${anchor} should include noopener`,
      );
      assert.ok(
        rel.includes('noreferrer'),
        `${filePath}: ${anchor} should include noreferrer`,
      );
    }
  }
});
