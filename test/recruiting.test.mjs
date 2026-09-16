import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectRecruiting, parseRecruiting, recruitingSourceUrl } from '../src/adapters/recruiting.mjs';

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

const offersUrl = recruitingSourceUrl(school, 'football', 2027, 'offers');
const viewPath = '~/Views/SkyNet/RecruitInterest/_SimpleDetailedSetForSeason.ascx';
const continuation = `${offersUrl}?ViewPath=${encodeURIComponent(viewPath)}&Position=68`;
const rankUrl = 'https://247sports.com/college/arizona/season/2027-football/recruitrankings/';
const observedAt = '2026-09-16T00:00:00.000Z';

// Sanitized synthetic metadata reproducing inspected public 247Sports markup;
// no raw third-party response or article body is retained in fixtures.
function rowHtml(id, position = 'QB', extra = '') {
  return `<li class="ri-page__list-item"><div class="wrapper">
    <div class="recruit"><a class="ri-page__name-link" href="//247sports.com/Player/example-${id}/">Example ${id}</a>
      <span class="meta">Example High (Example City, AZ)<a href="#">Video</a></span></div>
    <div class="position">${position}</div><div class="status"><img alt="Other School"></div>${extra}
  </div></li>`;
}
function offerPage({ count = 2, rows = rowHtml(46100001), next = continuation } = {}) {
  return `<html><head><link rel="canonical" href="${offersUrl}"></head><body>
    <h1>Arizona 2027 Football Offers (${count})</h1><a class="yr_plldwn">247Sports</a>
    <ul class="ri-page__list"><li class="ri-page__list-item list-header"><b class="name">Quarterback (1)</b></li>${rows}
    <li class="ri-page__list-item list-header"><b class="name">Tight End (1)</b></li>
    <li class="ri-page__list-item showmore_blk"><a data-js="showmore" href="${next.replaceAll('&', '&amp;')}">Load More</a></li></ul></body></html>`;
}
function sectionPage(rows = rowHtml(46100002, 'TE')) {
  return `<html><head><title>Arizona 2027 Tight End Offers</title><link rel="canonical" href="${continuation.replaceAll('&', '&amp;')}"></head>
    <body><section id="page-content">${rows}</section></body></html>`;
}
function collect(get, kind = 'offers') {
  return collectRecruiting({ school, sport: 'football', year: 2027, observedAt, get, kind });
}

test('actual displayed ratings and rank groups are preserved without inventing missing fields', () => {
  const rating = `<div class="rating"><div class="ri-page__star-and-score">
    ${'<span class="icon-starsolid yellow"></span>'.repeat(4)}<span class="icon-starsolid lightgrey"></span><span class="score">90</span></div>
    <div class="rank"><a class="natrank" href="${rankUrl}?InstitutionGroup=HighSchool">NA</a>
    <a class="posrank" href="${rankUrl}?InstitutionGroup=HighSchool&amp;Position=QB">12</a>
    <a class="sttrank" href="${rankUrl}?InstitutionGroup=HighSchool&amp;State=AZ">5</a></div></div>`;
  const html = document.replace('<ul ', '<a class="yr_plldwn">247Sports</a><ul ').replace('<div class="position">', `${rating}<div class="position">`);
  const [record] = parse(html);
  assert.equal(record.rating, 90);
  assert.equal(record.ratingSystem, '247sports');
  assert.equal(record.stars, 4);
  assert.equal(record.nationalRank, null);
  assert.equal(record.positionRank, 12);
  assert.equal(record.stateRank, 5);
  assert.equal(record.rankingState, 'AZ');
  assert.equal(record.rankingGroup, 'HighSchool');
  assert.equal(record.profileUrl, 'https://247sports.com/Player/example-player-46199999/');
  assert.equal(record.imageUrl, null);
  assert.equal(record.schoolName, null);
  for (const field of ['rating', 'ratingSystem', 'stars', 'nationalRank', 'positionRank', 'stateRank', 'rankingState', 'rankingGroup']) assert.equal(parse(document)[0][field], null);
  assert.throws(() => parse(html.replace('>247Sports<', '>Composite<')), /rating system/);
  assert.throws(() => parse(html.replace('>90<', '>1000<')), /bounds/);
  assert.throws(() => parse(html.replace('InstitutionGroup=HighSchool&amp;Position', 'InstitutionGroup=JuniorCollege&amp;Position')), /ranking groups/);
  assert.throws(() => parse(html.replace('/college/arizona/season/2027-football/recruitrankings/?InstitutionGroup=HighSchool">NA', '/college/baylor/season/2027-football/recruitrankings/?InstitutionGroup=HighSchool">NA')), /rank scope/);
});

test('offers fetch complete advertised position sections and retain school-specific offer meaning', async () => {
  const calls = [];
  const result = await collect(async target => { calls.push(target); return target === offersUrl ? offerPage() : sectionPage(); });
  assert.deepEqual(calls, [offersUrl, continuation]);
  assert.equal(result.records.length, 2);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.emptyConfirmed, true);
  assert.ok(result.records.every(record => record.status === 'offered' && record.schoolId === 'arizona' && record.sourceUrl === offersUrl));
  assert.equal(result.records[0].schoolName, 'Example High');
  assert.equal(result.records[0].hometown, 'Example City, AZ');
  assert.equal(recruitingSourceUrl({ slug: 'ucf' }, 'basketball', 2027, 'offers'), 'https://247sports.com/college/central-florida/season/2027-basketball/offers/');
});

test('provider continuations cannot introduce arbitrary destinations, query modes or duplicate keys', async () => {
  for (const next of [
    continuation.replace('247sports.com', 'attacker.example'),
    continuation.replace('/arizona/', '/baylor/'),
    continuation.replace('Position=68', 'Position=68&Position=69'),
    continuation.replace('Position=68', 'Position=68&Page=2'),
    continuation.replace(encodeURIComponent(viewPath), encodeURIComponent('/OtherTemplate')),
    `${continuation}#fragment`,
    continuation.replace('Position=68', 'Position=9999'),
  ]) {
    const calls = [];
    await assert.rejects(collect(async target => { calls.push(target); return offerPage({ next }); }), /continuation/);
    assert.deepEqual(calls, [offersUrl]);
  }
});

test('incomplete, cross-scope and duplicate offer sections never claim complete coverage', async () => {
  for (const partial of [
    sectionPage(''),
    sectionPage().replace('Arizona 2027 Tight End Offers', 'Baylor 2027 Tight End Offers'),
    sectionPage().replace('Position=68', 'Position=59'),
    sectionPage(rowHtml(46100002, 'QB')),
    sectionPage(rowHtml(46100001, 'TE')),
    sectionPage().replace('</section>', '<a data-js="showmore">Load More</a></section>'),
  ]) await assert.rejects(collect(async target => target === offersUrl ? offerPage() : partial));
  await assert.rejects(collect(async () => offerPage({ count: 3 })), /totals/);
  await assert.rejects(collect(async () => offerPage({ count: 1001 })), /budget/);
  let requests = 0;
  await assert.rejects(collect(async () => { requests++; if (requests > 1) throw new Error('http-403'); return offerPage(); }), /http-403/);
  assert.equal(requests, 2);
});

test('unpaginated offers and explicit zero are verified without auxiliary requests', async () => {
  const complete = offerPage().replace(/<li class="ri-page__list-item showmore_blk">[\s\S]*?<\/li>/, rowHtml(46100002, 'TE'));
  const result = await collect(async () => complete);
  assert.equal(result.records.length, 2);
  assert.equal(result.pagesFetched, 1);
  const zero = offerPage({ count: 0 }).replace(/<ul[\s\S]*<\/ul>/, '<ul class="ri-page__list"><li class="ri-page__list-item ri-page__list-item--no-results">No Results for 2027 Football</li></ul>');
  assert.deepEqual((await collect(async () => zero)).records, []);
  await assert.rejects(collect(async () => zero.replace('No Results for 2027 Football', 'Unavailable')));
  const commits = await collect(async () => document, 'commits');
  assert.equal(commits.records[0].status, 'committed');
  assert.equal(commits.pagesFetched, 1);
});

test('only exactly equal normalized offers deduplicate after all source row totals reconcile', async () => {
  const doubled = offerPage({ count: 3, rows: rowHtml(46100001).repeat(2) }).replace('Quarterback (1)', 'Quarterback (2)');
  const result = await collect(async target => target === offersUrl ? doubled : sectionPage());
  assert.equal(result.expectedCount, 3);
  assert.equal(result.sourceRecordCount, 3);
  assert.equal(result.records.length, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.reason, 'provider-duplicate-records-deduplicated:1');
  const conflicting = doubled.replace('>Example 46100001<', '>Conflicting Name<');
  await assert.rejects(collect(async target => target === offersUrl ? conflicting : sectionPage()), /Conflicting duplicate/);
  await assert.rejects(collect(async target => target === offersUrl ? doubled.replace('Offers (3)', 'Offers (2)') : sectionPage()), /totals/);
});
