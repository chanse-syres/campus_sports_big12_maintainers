import { readFile, appendFile } from 'node:fs/promises';
import { validateSnapshot, validateManifest } from '../src/validate.mjs';
const manifest = validateManifest(JSON.parse(await readFile('output/v1/manifest.json', 'utf8')));
const counts = { ok: 0, empty: 0, stale: 0, unavailable: 0, unsupported: 0 };
const lines = ['## Big 12 source coverage', '', '| School | Sport | News | Schedule | Roster | Commitments |', '| --- | --- | --- | --- | --- | --- |'];
for (const { school } of manifest.teams) {
  const snapshot = validateSnapshot(JSON.parse(await readFile(`output/v1/teams/${school}.json`, 'utf8')), school);
  for (const [sport, entry] of Object.entries(snapshot.sports)) {
    for (const kind of ['news', 'schedule', 'roster']) counts[entry[kind].status]++;
    if (['football', 'basketball'].includes(sport)) counts[entry.recruitingBoard.status]++;
    lines.push(`| ${school} | ${sport} | ${entry.news.status} | ${entry.schedule.status} | ${entry.roster.status} | ${entry.recruitingBoard.status} |`);
  }
}
lines.push('', 'Recruiting announcements are headline-selected official news. Football and men\'s basketball boards contain verified commitments only. Women\'s basketball and baseball player boards have no configured provider and are explicitly unavailable.');
console.log(JSON.stringify(counts));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (counts.stale || counts.unavailable) process.exitCode = 1;
