import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { listSchools, SPORTS } from '../src/config.mjs';
import { validateSnapshot } from '../src/validate.mjs';

const at = '2026-09-16T08:00:00.000Z';
const collections = ['news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard', 'recruitingOffers'];
const gap = () => ({ status: 'unavailable', lastAttemptAt: at, lastSuccessAt: null, sourceUrl: null, season: null, reason: 'espn-baseball-roster-not-verified-current', records: [] });

async function report(t, mutate = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'big12-health-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('big12-health-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'output/v2/teams'), { recursive: true });
  const manifest = { schemaVersion: 2, conference: 'big12', generatedAt: at, teams: [] };
  for (const school of await listSchools()) {
    const snapshot = {
      schemaVersion: 2, conference: 'big12', generatedAt: at,
      school: { slug: school.slug, name: school.name, athleticsUrl: school.athleticsUrl },
      sports: Object.fromEntries(SPORTS.map(sport => {
        const sponsored = school.sports.includes(sport);
        return [sport, { sponsored, ...Object.fromEntries(collections.map(kind => [kind, {
          status: sponsored ? 'empty' : 'unsupported', lastAttemptAt: at, lastSuccessAt: sponsored ? at : null,
          sourceUrl: sponsored ? school.athleticsUrl : null, season: null, reason: null, records: [],
          ...(kind === 'news' ? { sources: [] } : {}),
        }])) }];
      })),
    };
    if (snapshot.sports.baseball.sponsored) snapshot.sports.baseball.roster = gap();
    mutate(snapshot);
    validateSnapshot(snapshot, school.slug);
    const bytes = JSON.stringify(snapshot);
    const relativePath = `teams/${school.slug}.json`;
    await writeFile(path.join(directory, 'output/v2', relativePath), bytes);
    manifest.teams.push({ school: school.slug, path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(path.join(directory, 'output/v2/manifest.json'), JSON.stringify(manifest));
  const summaryPath = path.join(directory, 'summary.md');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/report-health.mjs', import.meta.url))], {
    cwd: directory, encoding: 'utf8', timeout: 10_000, env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
  });
  assert.ifError(result.error);
  return { ...result, counts: JSON.parse(result.stdout), summary: await readFile(summaryPath, 'utf8') };
}

test('health report keeps all 14 intentional baseball gaps visible without failing healthy collection', async t => {
  const result = await report(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.counts.unavailable, 14);
  assert.equal(result.counts.unverifiedBaseballRosters, 14);
  assert.equal(result.summary.match(/unavailable \(current roster not verified\)/g)?.length, 14);
});

test('health report fails unexpected baseball roster unavailability', async t => {
  const result = await report(t, snapshot => {
    if (snapshot.school.slug === 'arizona') snapshot.sports.baseball.roster.reason = 'http-503';
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.counts.unavailable, 14);
  assert.equal(result.counts.unverifiedBaseballRosters, 13);
});

test('health report never exempts unavailable football rosters even with the baseball gap reason', async t => {
  const result = await report(t, snapshot => {
    if (snapshot.school.slug === 'arizona') snapshot.sports.football.roster = gap();
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.counts.unavailable, 15);
  assert.equal(result.counts.unverifiedBaseballRosters, 14);
});

test('health report still fails stale baseball rosters', async t => {
  const result = await report(t, snapshot => {
    if (snapshot.school.slug === 'arizona') Object.assign(snapshot.sports.baseball.roster, {
      status: 'stale', lastSuccessAt: at, sourceUrl: snapshot.school.athleticsUrl,
    });
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.counts.stale, 1);
  assert.equal(result.counts.unverifiedBaseballRosters, 13);
});
