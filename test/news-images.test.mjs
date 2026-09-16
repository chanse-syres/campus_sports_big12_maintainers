import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichNewsImages, extractNewsImage } from '../src/news-images.mjs';

const articleUrl = 'https://publisher.example/sports/arizona-football-news';
const imageUrl = 'https://images.publisher-cdn.example/photos/football-practice.jpg?width=1200';
const imageMeta = (url = imageUrl, alt = 'Football practice') => `<meta property="og:image" content="${url}"><meta property="og:image:alt" content="${alt}">`;
const page = (metadata = imageMeta(), canonical = articleUrl, body = '') => `<html><head><link rel="canonical" href="${canonical}">${metadata}</head><body>${body}</body></html>`;
const article = (overrides = {}) => ({ id: 'news-1', title: 'Arizona football news', url: articleUrl, publisher: 'Example Publisher', publishedAt: '2026-09-16T00:00:00.000Z', publishedAtPrecision: 'instant', imageUrl: null, imageAlt: null, ...overrides });

test('article metadata yields a canonical-scoped photo and bounded plain-text alt', () => {
  assert.deepEqual(extractNewsImage(page(), articleUrl), { imageUrl, imageAlt: 'Football practice' });
  assert.equal(extractNewsImage(page(imageMeta(imageUrl, '&lt;b&gt;Practice&lt;/b&gt;')), articleUrl).imageAlt, 'Practice');
  const twitter = '<meta name="twitter:image" content="/photos/article.jpg"><meta name="twitter:image:alt" content="Article photograph">';
  assert.deepEqual(extractNewsImage(page(twitter), articleUrl), { imageUrl: 'https://publisher.example/photos/article.jpg', imageAlt: 'Article photograph' });
  assert.equal(extractNewsImage(page(imageMeta(), '/sports/arizona-football-news'), articleUrl).imageUrl, imageUrl);
});

test('canonical identity rejects foreign hosts, paths, meaningful queries, missing and ambiguous links', () => {
  for (const canonical of [
    'https://foreign.example/sports/arizona-football-news',
    'https://www.publisher.example/sports/arizona-football-news',
    'https://publisher.example/sports/baylor-football-news',
    `${articleUrl}?article=other`,
    'https://publisher.example/',
    `https://user:password@publisher.example/sports/arizona-football-news`,
  ]) assert.equal(extractNewsImage(page(imageMeta(), canonical), articleUrl), null);
  assert.equal(extractNewsImage(page().replace(/<link[^>]*>/, ''), articleUrl), null);
  assert.equal(extractNewsImage(page().replace('</head>', `<link rel="canonical" href="${articleUrl}"></head>`), articleUrl), null);
  assert.equal(extractNewsImage(page('', articleUrl, imageMeta()), articleUrl), null, 'body metadata is not article head metadata');
});

test('tracking removal preserves article identity without dropping meaningful query parameters', () => {
  assert.equal(extractNewsImage(page(), `${articleUrl}?utm_source=feed&fbclid=example#headline`).imageUrl, imageUrl);
  assert.equal(extractNewsImage(page(imageMeta(), `${articleUrl}?id=42`), `${articleUrl}?utm_medium=rss&id=42`).imageUrl, imageUrl);
  assert.equal(extractNewsImage(page(imageMeta(), `${articleUrl}?id=42`), `${articleUrl}?id=43`), null);
});

test('hostile image URLs, signed access grants and generic publisher logos remain absent', () => {
  for (const candidate of [
    'javascript:alert(1)', 'data:image/png;base64,abc', 'http://images.publisher-cdn.example/photo.jpg',
    'https://user:password@images.publisher-cdn.example/photo.jpg',
    'https://127.0.0.1/photo.jpg', 'https://[::1]/photo.jpg', 'https://169.254.169.254/photo.jpg', 'https://2130706433/photo.jpg',
    'https://intranet.internal/photo.jpg', `${imageUrl}&X-Amz-Signature=redacted`, `${imageUrl}&token=redacted`,
    'https://images.publisher-cdn.example/assets/publisher-social-logo.png',
    'https://images.publisher-cdn.example/assets/default-social.jpg',
    'https://images.publisher-cdn.example/assets/placeholder.jpg',
    'https://images.publisher-cdn.example/assets/%6cogo.png',
    'https://images.publisher-cdn.example/assets/brand.svg',
  ]) assert.equal(extractNewsImage(page(imageMeta(candidate)), articleUrl), null);
  const fallback = `${imageMeta('https://images.publisher-cdn.example/site-logo.png')}<meta name="twitter:image" content="${imageUrl}">`;
  assert.deepEqual(extractNewsImage(page(fallback), articleUrl), { imageUrl, imageAlt: null });
});

test('missing, oversized and excessive metadata do not invent a photograph', () => {
  assert.equal(extractNewsImage(page(''), articleUrl), null);
  assert.equal(extractNewsImage(`<head>${' '.repeat(256001)}${imageMeta()}</head>`, articleUrl), null);
  assert.equal(extractNewsImage(page(imageMeta(), articleUrl, 'x'.repeat(2_000_001)), articleUrl), null);
  assert.equal(extractNewsImage(page(`${'<meta name="unused" content="x">'.repeat(129)}${imageMeta()}`), articleUrl), null);
  assert.equal(extractNewsImage(page(imageMeta('https://images.publisher-cdn.example/photo.jpg?signature=redacted')), articleUrl), null);
});

test('enrichment preserves previous photos, immutable records and failed metadata', async () => {
  const previous = Object.freeze(article({ id: 'previous', imageUrl: 'https://cdn.example/existing-photo.jpg', imageAlt: 'Existing photo' }));
  const missing = Object.freeze(article());
  const broken = Object.freeze(article({ id: 'broken', url: `${articleUrl}-unavailable` }));
  const records = Object.freeze([previous, missing, broken]);
  const calls = [];
  const enriched = await enrichNewsImages(records, {
    allowedHosts: ['publisher.example'],
    get: async (url, options) => { calls.push({ url, options }); if (url.endsWith('-unavailable')) throw new Error('http-403'); return page(); },
  });
  assert.equal(enriched[0], previous);
  assert.equal(enriched[1].imageUrl, imageUrl);
  assert.equal(missing.imageUrl, null);
  assert.equal(enriched[2], broken);
  assert.notEqual(enriched, records);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, { allowedHosts: ['publisher.example'], maxBytes: 2_000_000, timeoutMs: 15_000, redirects: 0 });
});

test('only exact allowlisted article hosts are fetched and CDN bytes are never fetched', async () => {
  const calls = [];
  const records = [article(), article({ url: 'https://publisher.example.attacker.example/article' }), article({ url: 'https://www.publisher.example/article' }), article({ url: 'https://127.0.0.1/article' }), article({ url: `${articleUrl}?token=redacted` })];
  const result = await enrichNewsImages(records, { allowedHosts: ['publisher.example'], get: async url => { calls.push(url); return page(); } });
  assert.deepEqual(calls, [articleUrl]);
  assert.equal(result[0].imageUrl, imageUrl);
  assert.ok(result.slice(1).every(record => record.imageUrl === null));
});

test('the budget counts distinct fetch attempts, including failures, and shares same-article metadata', async () => {
  const calls = [];
  const records = [article(), article({ id: 'same', url: `${articleUrl}?utm_source=other` }), article({ id: 'second', url: `${articleUrl}-two` }), article({ id: 'third', url: `${articleUrl}-three` })];
  const result = await enrichNewsImages(records, { allowedHosts: ['publisher.example'], maxFetches: 1, get: async url => { calls.push(url); return page(); } });
  assert.deepEqual(calls, [articleUrl]);
  assert.equal(result[0].imageUrl, imageUrl);
  assert.equal(result[1].imageUrl, imageUrl);
  assert.equal(result[2].imageUrl, null);
  const failedCalls = [];
  await enrichNewsImages(records, { allowedHosts: ['publisher.example'], maxFetches: 1, get: async url => { failedCalls.push(url); throw new Error('timeout'); } });
  assert.deepEqual(failedCalls, [articleUrl]);
  assert.deepEqual(await enrichNewsImages(records, { allowedHosts: ['publisher.example'], maxFetches: 0, get: async () => assert.fail('zero budget must not fetch') }), records);
  await assert.rejects(enrichNewsImages(records, { allowedHosts: ['publisher.example'], maxFetches: 33, get: async () => '' }), /budget/);
});
