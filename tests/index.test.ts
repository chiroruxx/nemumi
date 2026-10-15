import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile('dist-test/index.html', 'utf8');

function getSection(id: string): string {
  const idIndex = html.indexOf(`id="${id}"`);
  assert.notEqual(idIndex, -1, `Expected section #${id} in generated HTML`);

  const sectionStart = html.lastIndexOf('<section', idIndex);
  const sectionEnd = html.indexOf('</section>', idIndex);
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);

  return html.slice(sectionStart, sectionEnd);
}

function getRecordTitles(sectionId: string): string[] {
  const section = getSection(sectionId);
  return [
    ...section.matchAll(/<span class="record-title"[^>]*>([^<]*)<\/span>/g),
  ].map(([, title]) => title);
}

test('daily records combine articles and activities, sort newest first, and show ten', () => {
  assert.deepEqual(getRecordTitles('records'), [
    'Article 11',
    'Activity 10',
    'Article 09',
    'Activity 08',
    'Article 07',
    'Activity 06',
    'Article 05',
    'Activity 04',
    'Article 03',
    'Activity 02',
  ]);
});

test('talks sort newest first and show five', () => {
  assert.deepEqual(getRecordTitles('talks'), [
    'Talk 06',
    'Talk 05',
    'Talk 04',
    'Talk 03',
    'Talk 02',
  ]);
});

test('communities follow their configured order', () => {
  const section = getSection('communities');
  const names = [...section.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(
    ([, name]) => name,
  );

  assert.deepEqual(names, ['First', 'Second', 'Third']);
});

test('an item without types renders without a tag', () => {
  const section = getSection('records');
  const titleIndex = section.indexOf('>Article 07</span>');
  assert.notEqual(titleIndex, -1);

  const itemStart = section.lastIndexOf('<li', titleIndex);
  const itemEnd = section.indexOf('</li>', titleIndex);
  assert.notEqual(itemStart, -1);
  assert.notEqual(itemEnd, -1);

  assert.doesNotMatch(section.slice(itemStart, itemEnd), /class="record-tag"/);
});

test('content links preserve query parameters and fragments in every collection', () => {
  for (const [section, url] of [
    ['records', 'https://example.com/article?ref=fixture#section'],
    ['records', 'https://example.com/activity?ref=fixture#section'],
    ['talks', 'https://example.com/talk?ref=fixture#section'],
    ['communities', 'https://example.com/first?ref=fixture#section'],
  ]) {
    assert.ok(getSection(section).includes(`href="${url}"`));
  }
});

test('a record without a URL renders without an anchor', () => {
  const section = getSection('records');
  const titleIndex = section.indexOf('>Article 07</span>');
  assert.notEqual(titleIndex, -1);
  const itemStart = section.lastIndexOf('<li', titleIndex);
  const itemEnd = section.indexOf('</li>', titleIndex);
  assert.doesNotMatch(section.slice(itemStart, itemEnd), /<a\b/);
});
