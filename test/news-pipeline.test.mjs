import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshNews, mergeNewsRecords } from '../src/news-pipeline.mjs';
import { getSchool } from '../src/config.mjs';
import { webNewsSources } from '../src/adapters/web-news.mjs';
import { SourceError } from '../src/network.mjs';

const school = await getSchool('arizona');
const at = '2026-09-16T12:00:00.000Z', priorAt = '2026-09-15T12:00:00.000Z';
const source = webNewsSources(school).find(source => source.id === 'espn-football');
const item = (id, title = 'Arizona Wildcats football wins opener') => `<item><title>${title}</title><link>https://www.espn.com/college-football/story/_/id/${id}/arizona-football</link><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>`;
const feed = items => `<rss version="2.0"><channel><title><![CDATA[${source.feedTitle}]]></title><link>https://www.espn.com/college-football/</link>${items}</channel></rss>`;

test('independent publisher failures keep useful articles and original source success times', async () => {
  const first = await refreshNews({ school, sport: 'football', at: priorAt, sources: [source], get: async url => {
    if (url === source.url) return feed(item(12345)); throw new SourceError('http-503');
  } });
  assert.equal(first.combined.status, 'stale');
  assert.equal(first.combined.records.length, 1);
  const next = await refreshNews({ school, sport: 'football', at, sources: [source], previous: first.combined, get: async () => { throw new SourceError('http-503'); } });
  assert.equal(next.combined.records.length, 1);
  const health = next.combined.sources.find(value => value.sourceUrl === source.url);
  assert.equal(health.status, 'stale');
  assert.equal(health.lastSuccessAt, priorAt);
  assert.equal(health.lastAttemptAt, at);
  assert.equal(next.combined.records[0].discoverySourceUrl, source.url);
});

test('a rotating feed keeps captured articles and merges tracking links without erasing photos', async () => {
  const common = { school, sport: 'football', sources: [source] };
  const first = await refreshNews({ ...common, at: priorAt, get: async url => {
    if (url === source.url) return feed(item(12345)); throw new SourceError('http-503');
  } });
  const previous = structuredClone(first.combined);
  previous.records[0].imageUrl = 'https://a.espncdn.com/photo/athlete.jpg';
  const second = await refreshNews({ ...common, at, previous, get: async url => {
    if (url === source.url) return feed(item(67890, 'Arizona Wildcats quarterback prepares for next football game')); throw new SourceError('http-503');
  } });
  assert.equal(second.combined.records.length, 2);
  assert.equal(second.combined.records.find(record => record.url.includes('12345')).imageUrl, previous.records[0].imageUrl);
  const original = second.combined.records[0];
  const merged = mergeNewsRecords([original], [{ ...original, url: original.url + '?utm_source=tracking', imageUrl: null }], school, 'football');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, original.url);
  assert.equal(merged[0].imageUrl, original.imageUrl);
});
