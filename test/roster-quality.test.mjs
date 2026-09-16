import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchool, SCHOOL_SLUGS } from '../src/config.mjs';
import { espnUrl, parseRoster } from '../src/adapters/espn.mjs';
import { maintainSchool } from '../src/maintainer.mjs';
import { SourceError } from '../src/network.mjs';

const now = '2026-09-16T08:00:00.000Z';
const previousAt = '2026-09-15T08:00:00.000Z';
const school = await getSchool('arizona');
const athletes = count => Array.from({ length: count }, (_, index) => ({
  id: String(index + 1), displayName: `Roster Player ${index + 1}`, position: { abbreviation: 'QB' },
}));
const document = (players, extra = {}) => JSON.stringify({ team: { id: school.espnId }, season: { year: 2026 }, athletes: players, ...extra });
const sourceGet = (documents = {}, calls = []) => async url => {
  calls.push(url);
  if (Object.hasOwn(documents, url)) return documents[url];
  throw new SourceError('http-503');
};

test('football maintainer requests an explicit bound and publishes all 109 grouped athletes', async () => {
  const calls = [];
  const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${school.espnId}/roster?limit=300`;
  const players = athletes(109);
  const result = await maintainSchool(school, { now, get: sourceGet({
    [rosterUrl]: document([{ items: players.slice(0, 50) }, { items: players.slice(50, 103) }, { items: players.slice(103) }], { total: 109 }),
  }, calls) });
  assert.equal(result.sports.football.roster.status, 'ok');
  assert.equal(result.sports.football.roster.records.length, 109);
  assert.equal(result.sports.football.roster.records.at(-1).id, '109');
  assert.equal(result.sports.football.roster.sourceUrl, rosterUrl);
  assert.equal(calls.filter(url => url.includes('/football/college-football/') && url.includes('/roster')).length, 1);
  assert.equal(calls.includes(rosterUrl), true);
  assert.equal(new URL(espnUrl(school, 'football', 'schedule')).search, '');
  assert.equal(new URL(espnUrl(school, 'basketball', 'roster')).search, '');
});

test('roster totals reject truncated overall and position-group responses', () => {
  for (const field of ['count', 'total', 'totalCount']) {
    assert.throws(() => parseRoster(document(athletes(100), { [field]: 109 }), school.espnId), /incomplete-roster/, field);
    assert.throws(() => parseRoster(document([{ items: athletes(100), [field]: 109 }]), school.espnId), /incomplete-roster/, field);
    assert.equal(parseRoster(document(athletes(109), { [field]: '109' }), school.espnId).records.length, 109);
  }
  const duplicates = [...athletes(100), ...athletes(9)];
  assert.throws(() => parseRoster(document(duplicates, { total: 109 }), school.espnId), /incomplete-roster/);
  assert.throws(() => parseRoster(document([{ items: duplicates, total: 109 }]), school.espnId), /incomplete-roster/);
});

test('roster validation retains its size bound and rejects malformed reported totals', () => {
  assert.equal(parseRoster(document(athletes(300), { total: 300 }), school.espnId).records.length, 300);
  assert.throws(() => parseRoster(document(athletes(301)), school.espnId), /Roster too large/);
  for (const total of [-1, 1.5, true, 'unknown', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseRoster(document(athletes(1), { total }), school.espnId), /Invalid roster total/);
  }
});

test('a truncated football response is unavailable, retaining only a prior complete same-source roster as stale', async () => {
  const rosterUrl = espnUrl(school, 'football', 'roster');
  const get = sourceGet({ [rosterUrl]: document(athletes(100), { total: 109 }) });
  const unavailable = await maintainSchool(school, { now, get });
  assert.equal(unavailable.sports.football.roster.status, 'unavailable');
  assert.equal(unavailable.sports.football.roster.reason, 'incomplete-roster');
  assert.deepEqual(unavailable.sports.football.roster.records, []);
  const previous = await maintainSchool(school, { now: previousAt, get: sourceGet({ [rosterUrl]: document(athletes(109)) }) });
  const result = await maintainSchool(school, { now, previous, get });
  assert.equal(result.sports.football.roster.status, 'stale');
  assert.equal(result.sports.football.roster.lastSuccessAt, previousAt);
  assert.deepEqual(result.sports.football.roster.records, previous.sports.football.roster.records);
  previous.sports.football.roster.sourceUrl = rosterUrl.replace('?limit=300', '');
  previous.sports.football.roster.records = previous.sports.football.roster.records.slice(0, 100);
  const legacy = await maintainSchool(school, { now, previous, get });
  assert.equal(legacy.sports.football.roster.status, 'unavailable');
  assert.equal(legacy.sports.football.roster.lastSuccessAt, null);
  assert.deepEqual(legacy.sports.football.roster.records, []);
});

test('all sponsored baseball programs clear historical athlete pools instead of preserving them as stale', async () => {
  let sponsored = 0;
  let unsupported = 0;
  for (const slug of SCHOOL_SLUGS) {
    const config = await getSchool(slug);
    const previous = await maintainSchool(config, { now: previousAt, get: sourceGet() });
    const calls = [];
    if (!config.sports.includes('baseball')) {
      const result = await maintainSchool(config, { now, previous, get: sourceGet({}, calls) });
      assert.equal(result.sports.baseball.roster.status, 'unsupported', slug);
      assert.deepEqual(result.sports.baseball.roster.records, [], slug);
      assert.equal(calls.some(url => url.includes('/baseball/')), false, slug);
      unsupported += 1;
      continue;
    }
    const rosterUrl = espnUrl(config, 'baseball', 'roster');
    const scheduleUrl = espnUrl(config, 'baseball', 'schedule');
    previous.sports.baseball.roster = {
      status: 'ok', lastAttemptAt: previousAt, lastSuccessAt: previousAt,
      sourceUrl: rosterUrl, season: '2025-26', reason: null,
      records: [{ id: 'historical-player', name: 'Historical Player', position: 'UN', jersey: '0', year: null, imageUrl: null, url: null }],
    };
    const before = structuredClone(previous);
    const result = await maintainSchool(config, { now, previous, get: sourceGet({
      [scheduleUrl]: JSON.stringify({ team: { id: config.baseballEspnId }, season: { year: 2026 }, events: [] }),
      // Even a successful response is not a verified current baseball roster.
      [rosterUrl]: JSON.stringify({ team: { id: config.baseballEspnId }, athletes: athletes(1) }),
    }, calls) });
    assert.deepEqual(result.sports.baseball.roster, {
      status: 'unavailable', lastAttemptAt: now, lastSuccessAt: null, sourceUrl: rosterUrl,
      season: null, reason: 'espn-baseball-roster-not-verified-current', records: [],
    }, slug);
    assert.equal(calls.includes(rosterUrl), false, slug);
    assert.equal(calls.includes(scheduleUrl), true, slug);
    assert.equal(result.sports.baseball.schedule.status, 'empty', slug);
    assert.equal(calls.includes(config.news.baseball.url), true, slug);
    assert.deepEqual(previous, before, `${slug}: the caller's previous snapshot must not be mutated`);
    sponsored += 1;
  }
  assert.equal(sponsored, 14);
  assert.equal(unsupported, 2);
});
