import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_BASE_URL, MAX_AGE_MS, loadTeamSnapshot, toFrontendTeam, toSiteNews } from '../examples/frontend-adapter.mjs';

const timestamp = '2026-09-16T00:00:00.000Z';
const now = Date.parse(timestamp);
const datasetNames = ['news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard', 'recruitingOffers'];

function snapshot() {
  return {
    schemaVersion: 2,
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
        ...(name === 'news' ? { sources: [] } : {}),
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
    discoverySourceUrl: 'https://arizonawildcats.com/sports/football/archives',
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
    sources: [{ status, lastAttemptAt: timestamp, lastSuccessAt: timestamp, sourceUrl: 'https://arizonawildcats.com/sports/football/archives', reason: null, recordCount: records.length }],
  };
}

function addDataset(value, sport, collection, records, overrides = {}) {
  value.sports[sport][collection] = {
    status: records.length ? 'ok' : 'empty',
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    sourceUrl: 'https://247sports.com/college/arizona/season/2027-football/commits/',
    season: '2027',
    reason: null,
    records,
    ...overrides,
  };
}

function recruit(overrides = {}) {
  return {
    id: 'arizona-recruit-1', name: 'Test Athlete', classYear: 2027, position: 'QB',
    status: 'committed', schoolId: 'arizona', sport: 'football',
    sourceUrl: 'https://247sports.com/college/arizona/season/2027-football/commits/',
    updatedAt: timestamp, profileUrl: 'https://247sports.com/player/test-athlete-123456/',
    imageUrl: null, schoolName: null, hometown: null, rating: null, ratingSystem: null,
    stars: null, nationalRank: null, positionRank: null, stateRank: null,
    rankingState: null, rankingGroup: null,
    ...overrides,
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

test('all collection mappings retain scope and provenance without inventing recruit ratings', () => {
  const value = snapshot();
  addDataset(value, 'football', 'recruitingBoard', [recruit()]);
  addDataset(value, 'football', 'recruitingOffers', [recruit({ status: 'offered' })]);
  addDataset(value, 'football', 'schedule', [{
    id: 'game-1', date: timestamp, name: 'Arizona at Example', status: 'scheduled', venue: null,
    homeAway: 'away', opponent: 'Example', teamScore: null, opponentScore: null, url: null,
  }]);
  addDataset(value, 'football', 'roster', [{
    id: 'athlete-1', name: 'Current Athlete', position: 'QB', jersey: '1', year: null, imageUrl: null, url: null,
  }]);
  addDataset(value, 'football', 'recruitingAnnouncements', [newsRecord()]);
  const original = JSON.stringify(value);
  const team = toFrontendTeam(value, { expectedSlug: 'arizona', now });
  const program = team.sports.football;
  for (const collection of datasetNames) {
    assert.equal(program[collection].health.status, value.sports.football[collection].status);
    assert.equal(program[collection].health.sourceUrl, value.sports.football[collection].sourceUrl);
    for (const record of program[collection].records) {
      assert.equal(record.schoolId, 'arizona');
      assert.equal(record.sport, 'football');
    }
  }
  const committed = program.recruitingBoard.records[0];
  const offered = program.recruitingOffers.records[0];
  assert.equal(committed.status, 'committed');
  assert.equal(committed.statusLabel, 'Committed');
  assert.equal(committed.lastUpdated, timestamp);
  assert.deepEqual(committed.scope, { schoolId: 'arizona', sport: 'football' });
  assert.deepEqual(committed.sources, [{ label: '247Sports', url: recruit().sourceUrl }]);
  assert.equal(committed.rating, null);
  assert.equal(committed.stars, null);
  assert.equal(committed.nationalRank, null);
  assert.equal(offered.status, 'offered');
  assert.equal(offered.statusLabel, 'Historical offer');
  assert.equal(program.schedule.records[0].teamScore, null);
  assert.equal(program.roster.records[0].year, null);
  assert.equal(JSON.stringify(value), original);
});

test('women and baseball boards map provider identity while missing provider records stay unavailable', () => {
  const value = snapshot();
  addDataset(value, 'womens-basketball', 'recruitingBoard', [recruit({
    sport: 'womens-basketball', sourceUrl: 'https://www.espn.com/high-school/girls-basketball/recruiting/school/_/id/12/class/2027',
    profileUrl: null,
  })], { sourceUrl: 'https://www.espn.com/high-school/girls-basketball/recruiting/school/_/id/12/class/2027' });
  addDataset(value, 'baseball', 'recruitingBoard', [recruit({
    sport: 'baseball', sourceUrl: 'https://www.perfectgame.org/College/CollegeCommitments.aspx?college=1739',
    profileUrl: null,
  })], { sourceUrl: 'https://www.perfectgame.org/College/CollegeCommitments.aspx?college=1739' });
  value.sports['womens-basketball'].recruitingOffers.reason = 'provider-does-not-cover-offers';
  const team = toFrontendTeam(value, { now });
  const women = team.sports.womensBasketball;
  assert.equal(women.recruitingBoard.records[0].sport, 'womensBasketball');
  assert.equal(women.recruitingBoard.records[0].sportSlug, 'womens-basketball');
  assert.equal(women.recruitingBoard.records[0].sources[0].label, 'ESPN HoopGurlz');
  assert.equal(team.sports.baseball.recruitingBoard.records[0].sources[0].label, 'Perfect Game');
  assert.equal(women.recruitingOffers.health.status, 'unavailable');
  assert.equal(women.recruitingOffers.health.reason, 'provider-does-not-cover-offers');
  assert.deepEqual(women.recruitingOffers.records, []);

  value.sports['womens-basketball'].recruitingBoard = {
    ...value.sports['womens-basketball'].recruitingOffers,
    reason: 'source-unavailable',
  };
  const missing = toFrontendTeam(value, { now }).sports.womensBasketball.recruitingBoard;
  assert.equal(missing.health.status, 'unavailable');
  assert.equal(missing.health.lastSuccessAt, null);
  assert.equal(missing.health.reason, 'source-unavailable');
});

test('a single stale collection remains visible without marking successful siblings stale', () => {
  const value = snapshot();
  addDataset(value, 'football', 'recruitingBoard', [recruit()], { status: 'stale', reason: 'source-blocked' });
  addDataset(value, 'football', 'recruitingOffers', [recruit({ status: 'offered' })]);
  let team = toFrontendTeam(value, { now });
  assert.equal(team.sports.football.recruitingBoard.health.stale, true);
  assert.equal(team.sports.football.recruitingOffers.health.stale, false);
  team = toFrontendTeam(value, { now, transportStale: true });
  for (const collection of datasetNames) assert.equal(team.sports.football[collection].health.stale, true);
});

test('ESPN explicit empty listing retains provider coverage reason and a clear class-size label', () => {
  const value = snapshot();
  addDataset(value, 'womens-basketball', 'recruitingBoard', [], {
    sourceUrl: 'https://www.espn.com/high-school/girls-basketball/recruiting/school/_/id/12/class/2027',
    reason: 'provider-has-no-commitment-records',
  });
  const board = toFrontendTeam(value, { now }).sports.womensBasketball.recruitingBoard;
  assert.equal(board.health.status, 'empty');
  assert.equal(board.health.reason, 'provider-has-no-commitment-records');
  assert.equal(board.health.lastSuccessAt, timestamp);
  assert.equal(board.health.stale, false);
  assert.equal(board.health.coverageLabel, 'No commitment records listed by provider; class size unknown');
  assert.deepEqual(board.records, []);
});

test('mapper rejects school or recruit scope mismatches before returning UI data', () => {
  assert.throws(() => toFrontendTeam(snapshot(), { expectedSlug: 'baylor', now }), /school mismatch/);
  for (const collection of ['recruitingBoard', 'recruitingOffers']) {
    const value = snapshot();
    addDataset(value, 'football', collection, [recruit({
      schoolId: 'baylor', status: collection === 'recruitingOffers' ? 'offered' : 'committed',
    })]);
    assert.throws(() => toFrontendTeam(value, { now }), /scope mismatch/);
  }
});

test('unsupported baseball program preserves coverage rather than claiming empty teams', () => {
  const value = snapshot();
  value.school = { slug: 'colorado', name: 'Colorado', athleticsUrl: 'https://cubuffs.com' };
  value.sports.baseball.sponsored = false;
  for (const collection of datasetNames) {
    value.sports.baseball[collection].status = 'unsupported';
    value.sports.baseball[collection].reason = 'school-does-not-sponsor-baseball';
  }
  const baseball = toFrontendTeam(value, { expectedSlug: 'colorado', now }).sports.baseball;
  assert.equal(baseball.sponsored, false);
  for (const collection of datasetNames) {
    assert.equal(baseball[collection].health.status, 'unsupported');
    assert.equal(baseball[collection].health.lastSuccessAt, null);
    assert.deepEqual(baseball[collection].records, []);
  }
});
