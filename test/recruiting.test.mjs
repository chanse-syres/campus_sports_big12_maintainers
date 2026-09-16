import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseRecruiting, recruitingSourceUrl } from '../src/adapters/recruiting.mjs';

const school = { slug: 'arizona', name: 'Arizona' };
const url = recruitingSourceUrl(school, 'football', 2027);
const document = await readFile(new URL('./fixtures/recruiting-commits.html', import.meta.url), 'utf8');
const parse = html => parseRecruiting(html, url, school, 'football', 2027, '2026-09-16T00:00:00Z');

test('commitment records retain school, class, sport and collection provenance', () => {
  const [record] = parse(document);
  assert.equal(record.name, 'Example Player');
  assert.equal(record.schoolId, 'arizona');
  assert.equal(record.classYear, 2027);
  assert.equal(record.status, 'committed');
  assert.equal(record.sourceUrl, url);
  assert.equal(record.id, parse(document)[0].id);
  assert.equal(recruitingSourceUrl({ slug: 'ucf' }, 'basketball', 2027), 'https://247sports.com/college/central-florida/season/2027-basketball/commits/');
});

test('partial counts, pagination, provider challenges and incorrect scope fail closed', () => {
  for (const html of [
    document.replace('Commits (1)', 'Commits (2)'),
    document.replace('</ul>', '<li><a href="?Page=2">Load More</a></li></ul>'),
    document.replace('Arizona 2027', 'Arizona 2026'),
    document.replace('season/2027-football/commits/', 'season/2027-basketball/commits/'),
    document.replace('//247sports.com/Player/', '//attacker.example/Player/'),
    document.replace('Hard Commits (1)', 'Decommits (1)'),
    '<h1>Sorry, you have been blocked</h1>',
  ]) assert.throws(() => parse(html));
});

test('zero commits require explicit provider zero and no-results evidence', () => {
  const zero = document.replace('Commits (1)', 'Commits (0)').replace(/<ul[\s\S]*<\/ul>/, '<ul class="ri-page__list"><li class="ri-page__list-item ri-page__list-item--no-results">No Results for 2027 Football</li></ul>');
  assert.deepEqual(parse(zero), []);
  assert.throws(() => parse(zero.replace('No Results for 2027 Football', 'Temporarily unavailable')));
});

test('row destination/class and duplicate provider identities cannot silently cross boundaries', () => {
  assert.throws(() => parse(document.replace('<p>Commit', '<img alt="Baylor"><p>Commit')), /destination/);
  assert.throws(() => parse(document.replace('2027-football/recruitrankings', '2026-football/recruitrankings')), /row class/);
  const row = document.match(/<li class="ri-page__list-item"><div[\s\S]*?<\/li>/)[0];
  assert.throws(() => parse(document.replace('</ul>', `${row}</ul>`)), /Duplicate/);
});
