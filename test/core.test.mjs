import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchool, SCHOOL_SLUGS } from '../src/config.mjs';
import { isPublicAddress, assertAllowedUrl, SourceError } from '../src/network.mjs';
import { parseRoster, parseSchedule } from '../src/adapters/espn.mjs';
import { refreshDataset, maintainSchool, emptyDataset, recruitingCycle } from '../src/maintainer.mjs';
import { validateSnapshot } from '../src/validate.mjs';
import { safeUrl } from '../src/normalize.mjs';
const now = '2026-09-16T08:00:00.000Z';
test('SSRF policy rejects private, metadata, loopback, reserved and mapped addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  for (const url of ['http://site.api.espn.com/x', 'https://evil.test/x', 'https://site.api.espn.com.evil.com', 'https://user:secret@site.api.espn.com/', 'https://site.api.espn.com:8443/', 'https://127.0.0.1/', 'https://2130706433/']) assert.throws(() => assertAllowedUrl(url, ['site.api.espn.com']));
  assert.equal(safeUrl('javascript:alert(1)'), null);
});
test('source outages and unexpected empty collections preserve the last successful timestamp', async () => {
  const prior = { ...emptyDataset('2026-09-15T08:00:00.000Z', 'ok', null, 'https://example.com/news'), lastSuccessAt: '2026-09-15T08:00:00.000Z', records: [{ id: 'a' }] };
  for (const get of [async () => { throw new SourceError('http-429'); }, async () => '{}']) {
    const dataset = await refreshDataset({ at: now, sourceUrl: prior.sourceUrl, prior, get, parse: () => ({ records: [] }) });
    assert.equal(dataset.status, 'stale'); assert.equal(dataset.lastSuccessAt, prior.lastSuccessAt); assert.deepEqual(dataset.records, prior.records);
  }
});
test('new failed sources cannot reuse unrelated prior records', async () => {
  const prior = { ...emptyDataset(now, 'ok', null, 'https://example.com/old'), lastSuccessAt: now, records: [{ id: 'a' }] };
  const result = await refreshDataset({ at: now, sourceUrl: 'https://example.com/new', prior, get: async () => { throw new SourceError('http-403'); } });
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.records, []); assert.equal(result.lastSuccessAt, null);
});
test('a count-verified empty commitment list can clear an old class without appearing stale', async () => {
  const prior = { ...emptyDataset(now, 'ok', null, 'https://example.com/commits'), lastSuccessAt: now, records: [{ id: 'a' }] };
  const dataset = await refreshDataset({ at: now, sourceUrl: prior.sourceUrl, prior, get: async () => 'verified-zero', parse: () => ({ records: [], emptyConfirmed: true }) });
  assert.equal(dataset.status, 'empty'); assert.deepEqual(dataset.records, []);
});
test('ESPN parser validates school identity and rejects unrelated schedule games', () => {
  assert.throws(() => parseRoster(JSON.stringify({ team: { id: '9' }, athletes: [] }), '12'), /mismatch/);
  assert.throws(() => parseSchedule(JSON.stringify({ team: { id: '12' }, events: [{ id: 'x', date: now, competitions: [{ competitors: [{ team: { id: '9' } }] }] }] }), '12'), /scope/);
  const result = parseRoster(JSON.stringify({ team: { id: '12' }, athletes: [{ items: [{ id: '1', displayName: 'Sample Athlete', position: { abbreviation: 'QB' } }] }], season: { displayName: '2026' } }), '12');
  assert.equal(result.records[0].name, 'Sample Athlete'); assert.equal(result.records[0].imageUrl, null);
});
test('all16 schools have a single entry/config and sponsorship excludes exactly two baseball programs', async () => {
  const schools = await Promise.all(SCHOOL_SLUGS.map(getSchool));
  assert.equal(schools.length, 16);
  assert.deepEqual(schools.filter(s => !s.sports.includes('baseball')).map(s => s.slug), ['colorado', 'iowa-state']);
  assert.equal(schools.find(s => s.slug === 'arizona').baseballEspnId, '60');
});
test('unavailable sources produce explicit health, and unsupported sports make no requests', async () => {
  const calls = [];
  const result = await maintainSchool(await getSchool('colorado'), { now, get: async url => { calls.push(url); throw new SourceError('http-503'); } });
  assert.equal(calls.length, 11);
  assert.equal(result.sports.baseball.news.status, 'unsupported');
  assert.equal(result.sports.football.news.status, 'unavailable');
  assert.equal(result.sports.football.news.reason, 'http-503');
  assert.throws(() => validateSnapshot(result, 'baylor'), /mismatch/);
  const extra = structuredClone(result); extra.privateKey = 'should-never-publish'; assert.throws(() => validateSnapshot(extra));
  const falseFresh = structuredClone(result); falseFresh.sports.football.news.lastSuccessAt = now; assert.throws(() => validateSnapshot(falseFresh));
});
test('recruiting cycle retains the signing class through February', () => {
  assert.equal(recruitingCycle(new Date('2026-09-16T00:00:00Z')), 2027);
  assert.equal(recruitingCycle(new Date('2027-02-28T00:00:00Z')), 2027);
  assert.equal(recruitingCycle(new Date('2027-03-01T00:00:00Z')), 2028);
});
