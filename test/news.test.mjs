import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseNews } from '../src/adapters/news.mjs';

test('shared oversized Nuxt scalars and excessive article nodes are rejected before amplification', () => {
  const school = { slug: 'baylor', name: 'Baylor', athleticsUrl: 'https://baylorbears.com' };
  const source = 'https://baylorbears.com/sports/football/news';
  const html = data => `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const data = [{ published_at: 1, permalink: 2, sports: 3, visibility: 5, title: 6 }, '2026-09-15T12:00:00Z', '/news/example', [4], { slug: 7 }, 'public', 'Example', 'x'.repeat(4097)];
  assert.throws(() => parseNews(html(data), source, school, 'football'), /scalar exceeds/);
  const many = Array.from({ length: 201 }, () => ({ storyHeadline: 202, storyPath: 203, sportTitle: 204 }));
  many.push(null, 'Example', '/news/example', 'Football');
  assert.throws(() => parseNews(html(many), source, school, 'football'), /candidate budget/);
});

const sidearmSchool = { slug: 'arizona', name: 'Arizona', athleticsUrl: 'https://arizonawildcats.com' };
const wmtSchool = { slug: 'byu', name: 'BYU', athleticsUrl: 'https://byucougars.com' };
const sidearm = await readFile(new URL('./fixtures/sidearm-news.html', import.meta.url), 'utf8');
const wmt = await readFile(new URL('./fixtures/wmt-news.html', import.meta.url), 'utf8');

test('official archive preserves photos and rejects foreign school/sport metadata', () => {
  const rows = parseNews(sidearm, `${sidearmSchool.athleticsUrl}/sports/mens-basketball/archives`, sidearmSchool, 'basketball');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].imageUrl, 'https://arizonawildcats.com/images/2026/9/1/basketball.jpg');
  assert.equal(rows[0].publishedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(rows[0].publishedAtPrecision, 'day', 'a source clock without a zone must not become an invented exact instant');
  assert.equal(rows[1].imageUrl, null);
  assert.ok(rows.every(row => !row.title.includes('Women') && !row.title.includes('Foreign')));
  assert.equal(rows[0].id, parseNews(sidearm, `${sidearmSchool.athleticsUrl}/sports/mens-basketball/archives`, sidearmSchool, 'basketball')[0].id);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'title', 'url', 'publishedAt', 'publishedAtPrecision', 'imageUrl', 'imageAlt', 'publisher'].sort());
});

test('WMT metadata handles image objects, exact timestamps and publication visibility', () => {
  const rows = parseNews(wmt, `${wmtSchool.athleticsUrl}/sports/football/news`, wmtSchool, 'football');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].publishedAt, '2026-09-02T15:00:00.000Z');
  assert.equal(rows[0].publishedAtPrecision, 'instant');
  assert.equal(rows[0].imageUrl, 'https://byucougars.com/imgproxy/photo.jpg');
  assert.equal(rows[0].imageAlt, 'Practice photo');
});

test('empty200, changed page formats and malformed JSON fail closed', () => {
  for (const document of ['', '<html><h1>Please enable JavaScript</h1></html>', '<script id="__NUXT_DATA__" type="application/json">not json</script>', '<script id="__NUXT_DATA__" type="application/json">{}</script>']) {
    assert.throws(() => parseNews(document, sidearmSchool.athleticsUrl, sidearmSchool, 'basketball'));
  }
  assert.throws(() => parseNews(sidearm, 'https://unrelated.example', sidearmSchool, 'basketball'), /scope/);
  assert.throws(() => parseNews(sidearm, sidearmSchool.athleticsUrl, sidearmSchool, 'baseball'), /No recognizable/);
});

test('serialized hostile graph references are not recursively revived or executed', () => {
  const document = '<script id="__NUXT_DATA__" type="application/json">[{"__proto__":0,"storyHeadline":0,"storyPath":0,"sportsCats":1},"Football"]</script>';
  assert.throws(() => parseNews(document, sidearmSchool.athleticsUrl, sidearmSchool, 'football'));
  assert.equal({}.storyHeadline, undefined);
});
