import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_BASE_URL, MAX_AGE_MS, loadTeamSnapshot, toSiteNews } from '../examples/frontend-adapter.mjs';

const timestamp = '2026-09-16T00:00:00.000Z';
const now = Date.parse(timestamp);
const datasetNames = ['news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard'];

function snapshot() {
  return {
    schemaVersion: 1,
    conference: 'big12',
    school: { slug: 'arizona', name: 'Arizona', athleticsUrl: 'https://arizonawildcats.com' },
    generatedAt: timestamp,
    sports: Object.fromEntries(['football', 'basketball', 'womens-basketball', 'baseball'].map(sport => [sport, {
      sponsored: true,
      ...Object.fromEntries(datasetNames.map(name => [name, {
        status: 'unavailable',
        lastAttemptAt: timestamp,
        lastSuccessAt: null,
        sourceUrl: null,
        season: null,
        reason: 'no-approved-source',
        records: [],
      }])),
    }])),
  };
}

function newsRecord(overrides = {}) {
  return {
    id: 'arizona-news-1',
    title: 'Wildcats announce schedule',
    url: 'https://arizonawildcats.com/news/2026/9/16/schedule',
    publishedAt: timestamp,
    publishedAtPrecision: 'instant',
    imageUrl: null,
    imageAlt: null,
    publisher: 'Arizona Athletics',
    ...overrides,
  };
}

function addNews(value, sport, records, status = 'ok') {
  value.sports[sport].news = {
    status,
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    sourceUrl: 'https://arizonawildcats.com/sports/football/archives',
    season: null,
    reason: status === 'stale' ? 'source-unavailable' : null,
    records,
  };
}

test('reader constructs an allowlisted URL and refuses redirects without credentials', async () => {
  const value = snapshot();
  let requested;
  const result = await loadTeamSnapshot('arizona', {
    now,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return Response.json(value);
    },
  });
  assert.equal(requested.url, `${DATA_BASE_URL}/teams/arizona.json`);
  assert.equal(requested.options.redirect, 'error');
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(requested.options.credentials, 'omit');
  assert.deepEqual(requested.options.headers, { Accept: 'application/json' });
  assert.equal(result.transportStatus, 'fetched');
  assert.equal(result.stale, false);
});

test('unknown school and path traversal are rejected before network access', async () => {
  for (const slug of ['../arizona', 'https://example.com', 'oregon-state', 'constructor']) {
    await assert.rejects(loadTeamSnapshot(slug, {
      fetchImpl: () => assert.fail('Unknown slug must not trigger a request'),
    }), /Unknown Big 12 school/);
  }
});

test('an oversized or invalid response retains only a validated scoped fallback', async () => {
  const previous = snapshot();
  for (const response of [
    new Response('{}', { headers: { 'Content-Length': String(20 * 1024 * 1024) } }),
    Response.json({ ...snapshot(), schemaVersion: 999 }),
    new Response('not json'),
    new Response('unavailable', { status: 503 }),
  ]) {
    const result = await loadTeamSnapshot('arizona', {
      now, previousSnapshot: previous, fetchImpl: async () => response,
    });
    assert.equal(result.snapshot, previous);
    assert.equal(result.transportStatus, 'fallback');
    assert.equal(result.stale, true);
    assert.equal(result.snapshot.generatedAt, timestamp);
  }
  await assert.rejects(loadTeamSnapshot('arizona', {
    now, fetchImpl: async () => Response.json({ ...snapshot(), schemaVersion: 999 }),
  }), /No validated team snapshot/);
});

test('wrong-school fallback cannot become an alternate data source', async () => {
  await assert.rejects(loadTeamSnapshot('baylor', {
    now,
    previousSnapshot: snapshot(),
    fetchImpl: () => assert.fail('Invalid fallback must fail before network'),
  }));
});

test('old snapshots are flagged even if transport succeeds', async () => {
  const result = await loadTeamSnapshot('arizona', {
    now: now + MAX_AGE_MS + 1,
    fetchImpl: async () => Response.json(snapshot()),
  });
  assert.equal(result.transportStatus, 'fetched');
  assert.equal(result.stale, true);
});

test('news mapping preserves scope, omits unknown dates, and never invents photos or summaries', () => {
  const value = snapshot();
  addNews(value, 'womens-basketball', [
    newsRecord({ id: 'dated' }),
    newsRecord({ id: 'undated', publishedAt: null, publishedAtPrecision: 'unknown' }),
  ]);
  const result = toSiteNews(value, { now });
  assert.equal(result.articles.length, 1);
  const article = result.articles[0];
  assert.equal(article.id, 'dated');
  assert.equal(article.schoolId, 'arizona');
  assert.equal(article.sport, 'womensBasketball');
  assert.equal(article.sportLabel, "Women's Basketball");
  assert.equal(article.summary, '');
  assert.equal(article.href, article.url);
  assert.equal('imageUrl' in article, false);
  assert.equal(article.publishedAt, timestamp);
  assert.equal(article.publishedAtPrecision, 'instant');
  assert.equal(result.health.womensBasketball.omittedUndatedCount, 1);
});

test('source and transport stale conditions remain visible beside retained stories', () => {
  const value = snapshot();
  addNews(value, 'football', [newsRecord()], 'stale');
  const original = JSON.stringify(value);
  const result = toSiteNews(value, { now });
  assert.equal(result.articles.length, 1);
  assert.equal(result.health.football.status, 'stale');
  assert.equal(result.health.football.stale, true);
  assert.equal(result.health.football.lastSuccessAt, timestamp);
  assert.equal(JSON.stringify(value), original, 'Adapter must not rewrite freshness evidence');

  addNews(value, 'football', [newsRecord()]);
  assert.equal(toSiteNews(value, { now, transportStale: true }).health.football.stale, true);
  assert.equal(toSiteNews(value, { now: now + MAX_AGE_MS + 1 }).health.football.stale, true);
});
