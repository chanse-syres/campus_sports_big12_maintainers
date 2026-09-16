import { readFile, appendFile } from 'node:fs/promises';
import { validateSnapshot, validateManifest } from '../src/validate.mjs';
const manifest = validateManifest(JSON.parse(await readFile('output/v2/manifest.json', 'utf8')));
const counts = { ok: 0, empty: 0, stale: 0, unavailable: 0, unsupported: 0 };
let unverifiedBaseballRosters = 0;
const lines = ['## Big 12 source coverage', '', '| School | Sport | News | Schedule | Roster | Commitments | Offers |', '| --- | --- | --- | --- | --- | --- | --- |'];
for (const { school } of manifest.teams) {
  const snapshot = validateSnapshot(JSON.parse(await readFile(`output/v2/teams/${school}.json`, 'utf8')), school);
  for (const [sport, entry] of Object.entries(snapshot.sports)) {
    const expectedRosterGap = entry.sponsored && sport === 'baseball' && entry.roster.status === 'unavailable'
      && entry.roster.reason === 'espn-baseball-roster-not-verified-current';
    if (expectedRosterGap) unverifiedBaseballRosters++;
    for (const kind of ['news', 'schedule', 'roster']) counts[entry[kind].status]++;
    counts[entry.recruitingBoard.status]++;
    if (['football', 'basketball', 'womens-basketball'].includes(sport)) counts[entry.recruitingOffers.status]++;
    lines.push(`| ${school} | ${sport} | ${entry.news.status} | ${entry.schedule.status} | ${entry.roster.status}${expectedRosterGap ? ' (current roster not verified)' : ''} | ${entry.recruitingBoard.status}${entry.recruitingBoard.reason === 'provider-has-no-commitment-records' ? ' (provider has no records)' : ''} | ${entry.recruitingOffers.reason === 'provider-does-not-cover-offers' ? 'not covered by provider' : entry.recruitingOffers.status} |`);
  }
}
lines.push('', 'Commitments: 247Sports for football/men\'s and women\'s basketball, Perfect Game for baseball. Source listings are provider-reported coverage, not a complete recruiting class. Women\'s coverage is incomplete even when records are listed. An empty provider list does not establish that a school has no recruits or offers. Offers are covered for football/men\'s and women\'s basketball; ratings are populated only when displayed by the provider. Degraded configured sources fail this health check after last-known valid data is preserved.');
lines.push('', `Baseball rosters: ${unverifiedBaseballRosters} unavailable because the ESPN athlete pools are not verified current rosters. This documented coverage gap does not fail collection health; other unavailable or stale configured sources still do.`);
console.log(JSON.stringify({ ...counts, unverifiedBaseballRosters }));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (counts.stale || counts.unavailable > unverifiedBaseballRosters) process.exitCode = 1;
