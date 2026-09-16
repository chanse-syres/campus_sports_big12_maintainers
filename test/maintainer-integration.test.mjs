import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getSchool } from '../src/config.mjs';
import { maintainSchool } from '../src/maintainer.mjs';
import { SourceError } from '../src/network.mjs';
import { recruitingSourceUrl } from '../src/adapters/recruiting.mjs';

const school = await getSchool('arizona');
const previousAt = '2026-09-15T08:00:00.000Z';
const now = '2026-09-16T08:00:00.000Z';
const commitmentUrl = recruitingSourceUrl(school, 'football', 2027);
const offersUrl = recruitingSourceUrl(school, 'football', 2027, 'offers');
const womenUrl = recruitingSourceUrl(school, 'womens-basketball', 2027);
const womenOffersUrl = recruitingSourceUrl(school, 'womens-basketball', 2027, 'offers');
const commitmentDocument = await readFile(new URL('./fixtures/recruiting-commits.html', import.meta.url), 'utf8');
const offerDocument = commitmentDocument
  .replaceAll('/commits/', '/offers/')
  .replace('Football Commits (1)', 'Football Offers (1)')
  .replace('Hard Commits (1)', 'Quarterback (1)')
  .replace('Example Player', 'Example Offered Player');

function sourceGet(documents = {}, calls = []) {
  return async url => {
    calls.push(url);
    if (Object.hasOwn(documents, url)) return documents[url];
    // Every other source is deliberately unavailable. There is no live network.
    throw new SourceError('http-503');
  };
}

function womenDocument(hasRecords) {
  const html = commitmentDocument.replaceAll('2027-football', '2027-womens-basketball').replaceAll('Football', "Women's Basketball").replace('>QB<', '>PG<');
  return hasRecords ? html : html.replace('Commits (1)', 'Commits (0)').replace(/<ul[\s\S]*<\/ul>/,
    '<ul class="ri-page__list"><li class="ri-page__list-item ri-page__list-item--no-results">No Results for 2027 Women\'s Basketball</li></ul>');
}

test('women commitments and offers refresh independently through the public 247Sports source', async () => {
  const calls = [];
  const womenOffer = offerDocument.replaceAll('2027-football', '2027-womens-basketball').replaceAll('Football', "Women's Basketball").replace('Quarterback', 'Point Guard').replace('>QB<', '>PG<');
  const result = await maintainSchool(school, { now, get: sourceGet({ [womenUrl]: womenDocument(true), [womenOffersUrl]: womenOffer }, calls) });
  const program = result.sports['womens-basketball'];
  assert.equal(program.recruitingBoard.status, 'ok');
  assert.equal(program.recruitingOffers.status, 'ok');
  assert.equal(program.recruitingOffers.records[0].status, 'offered');
  assert.equal(program.recruitingBoard.records[0].sourceUrl, womenUrl);
  assert.equal(program.recruitingOffers.reason, 'provider-reported-records-coverage-incomplete');
  assert.equal(calls.some(url => new URL(url).hostname === 'www.espn.com'), false);
});

test('maintainer retains women commitments and their verified age when the provider stops reporting records', async () => {
  const previous = await maintainSchool(school, { now: previousAt, get: sourceGet({ [womenUrl]: womenDocument(true) }) });
  assert.equal(previous.sports['womens-basketball'].recruitingBoard.status, 'ok');
  const before = structuredClone(previous);
  const result = await maintainSchool(school, { now, previous, get: sourceGet({ [womenUrl]: womenDocument(false) }) });
  const board = result.sports['womens-basketball'].recruitingBoard;
  assert.equal(board.status, 'stale');
  assert.equal(board.reason, 'unexpected-empty-source');
  assert.equal(board.lastSuccessAt, previousAt);
  assert.equal(board.lastAttemptAt, now);
  assert.deepEqual(board.records, before.sports['womens-basketball'].recruitingBoard.records);
  assert.deepEqual(previous, before, 'refresh must not mutate the caller\'s last valid snapshot');
});

test('an offer source failure cannot erase or stale independently refreshed football commitments', async () => {
  const previous = await maintainSchool(school, {
    now: previousAt, get: sourceGet({ [commitmentUrl]: commitmentDocument, [offersUrl]: offerDocument }),
  });
  assert.equal(previous.sports.football.recruitingOffers.status, 'ok');
  assert.equal(previous.sports.football.recruitingOffers.records[0].status, 'offered');
  const updatedDocument = commitmentDocument.replace('Example Player', 'Updated Example Player');
  const result = await maintainSchool(school, { now, previous, get: sourceGet({ [commitmentUrl]: updatedDocument }) });
  const { recruitingBoard: board, recruitingOffers: offers } = result.sports.football;
  assert.equal(board.status, 'ok');
  assert.equal(board.lastSuccessAt, now);
  assert.equal(board.records[0].name, 'Updated Example Player');
  assert.equal(board.records[0].status, 'committed');
  assert.equal(offers.status, 'stale');
  assert.equal(offers.reason, 'http-503');
  assert.equal(offers.lastSuccessAt, previousAt);
  assert.equal(offers.lastAttemptAt, now);
  assert.deepEqual(offers.records, previous.sports.football.recruitingOffers.records);
});

test('a new recruiting cycle never reuses another class after its source fails', async () => {
  const previous = await maintainSchool(school, { now: previousAt, get: sourceGet({ [commitmentUrl]: commitmentDocument }) });
  const result = await maintainSchool(school, { now: '2027-03-01T08:00:00.000Z', previous, get: sourceGet() });
  const board = result.sports.football.recruitingBoard;
  assert.equal(board.status, 'unavailable');
  assert.equal(board.reason, 'http-503');
  assert.equal(board.lastSuccessAt, null);
  assert.deepEqual(board.records, []);
  assert.equal(board.sourceUrl, recruitingSourceUrl(school, 'football', 2028));
});

test('another school snapshot is rejected before fetching or reusing any prior data', async () => {
  const previous = await maintainSchool(school, { now: previousAt, get: sourceGet({ [commitmentUrl]: commitmentDocument }) });
  const calls = [];
  await assert.rejects(maintainSchool(await getSchool('baylor'), { now, previous, get: sourceGet({}, calls) }), /Snapshot school mismatch/);
  assert.deepEqual(calls, []);
});

test('credential-like upstream sports text fails final snapshot validation and cannot become publishable output', async () => {
  const syntheticCredential = 'ghp_' + 'x'.repeat(36);
  const document = commitmentDocument.replace('Example Player', syntheticCredential);
  await assert.rejects(maintainSchool(school, { now, get: sourceGet({ [commitmentUrl]: document }) }), /Credential-like value rejected/);
});
