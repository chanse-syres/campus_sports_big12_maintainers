import assert from 'node:assert/strict';
import test from 'node:test';
import { additionalRecruitingSourceUrl, parseAdditionalRecruiting } from '../src/adapters/additional-recruiting.mjs';

const school = { slug: 'arizona', name: 'Arizona', espnId: '12' };
const at = '2026-09-16T00:00:00Z';
const womenUrl = additionalRecruitingSourceUrl(school, 'womens-basketball', 2027);
const baseballUrl = additionalRecruitingSourceUrl(school, 'baseball', 2027);
const womenRow = '<li class="item"><div class="player"><span class="name"><a href="https://www.espn.com/high-school/girls-basketball/recruiting/player/_/id/12345">Example Player</a>, G</span><ul class="player-info"><li>Private unrelated text</li></ul></div><div class="commit-status">Verbal</div></li>';
const womenDocument = `<title>2027 High School Girls' Basketball Recruits - Arizona - ESPN</title>
<link rel="canonical" href="${womenUrl.replace('https:', 'http:')}">
<div class="stats-col-2"><h4>2027 Player Commits</h4><table><thead><tr><td>Commits</td><td>ESPN 100 Commits</td></tr></thead><tbody><tr><td>1</td><td>—</td></tr></tbody></table></div>
<ul id="tabs"><li class="active"><a class="commits" href="${womenUrl}">Commits</a></li></ul>
<div id="filter-commits"><ul>${womenRow}</ul></div>`;
const headers = '<thead><tr><th>Rank</th><th>Player</th><th>Pos</th><th>Ht</th><th>Wt</th><th>BT</th><th>HS</th><th>Hometown</th><th>St</th><th>College</th><th>Draft</th></tr></thead>';
const baseballRow = '<tr class="rgRow"><td>Subscribe</td><td><a id="test_hlPlayerName" href="../Players/PlayerProfile.aspx?ID=12345">Example Player</a></td><td>RHP</td><td>6-1</td><td>180</td><td>R-R</td><td>Example High</td><td>Example Town</td><td>AZ</td><td>Arizona</td><td>Signed</td></tr>';
const baseballDocument = `<title>Arizona - Perfect Game Baseball Player College Commitments</title>
<select id="test_ddlColleges"><option selected value="1757">Arizona</option></select>
<select id="test_ddlYear"><option selected value="2027">2027</option></select>
<table id="test_radgCommitment_ctl00">${headers}<tbody>${baseballRow}</tbody></table>`;
const parseWomen = html => parseAdditionalRecruiting(html, womenUrl, school, 'womens-basketball', 2027, at);
const parseBaseball = html => parseAdditionalRecruiting(html, baseballUrl, school, 'baseball', 2027, at);

test('women commitments retain only scoped public sports fields and provenance', () => {
  const result = parseWomen(womenDocument);
  assert.equal(result.season, '2027');
  assert.equal(result.emptyConfirmed, true);
  assert.equal(result.reason, 'provider-reported-commitments-only-offers-not-covered');
  assert.deepEqual(result.records[0], {
    id: result.records[0].id, name: 'Example Player', classYear: 2027, position: 'G',
    profileUrl: 'https://www.espn.com/high-school/girls-basketball/recruiting/player/_/id/12345',
    status: 'committed', schoolId: 'arizona', sport: 'womens-basketball', sourceUrl: womenUrl,
    updatedAt: '2026-09-16T00:00:00.000Z',
  });
  assert.equal(result.records[0].id, parseWomen(womenDocument).records[0].id);
  assert.equal(parseWomen(womenDocument.replace('>Verbal<', '>Signed<')).records[0].status, 'signed');
});

test('women explicitly unavailable provider listings are distinct from malformed responses and zero classes', () => {
  const empty = womenDocument.replace('<td>1</td>', '<td>—</td>').replace(`<ul>${womenRow}</ul>`, '<div>Committed recruits are not available.</div>');
  assert.deepEqual(parseWomen(empty), { records: [], season: '2027', emptyConfirmed: false, reason: 'provider-has-no-commitment-records' });
  assert.throws(() => parseWomen(empty.replace('Committed recruits are not available.', 'Temporary server error')));
  assert.throws(() => parseWomen(empty.replace('>—</td>', '>0</td>')));
});

test('women reject wrong school/class/canonical, considering tabs, unknown statuses, and incomplete counts', () => {
  for (const html of [
    womenDocument.replace('Recruits - Arizona - ESPN', 'Recruits - Baylor - ESPN'),
    womenDocument.replace('2027 Player Commits', '2026 Player Commits'),
    womenDocument.replace('/id/12/class/2027', '/id/239/class/2027'),
    womenDocument.replace('class="commits"', 'class="considering"'),
    womenDocument.replace('>Verbal<', '>Considering<'),
    womenDocument.replace('<td>1</td>', '<td>2</td>'),
    womenDocument.replace('www.espn.com/high-school/girls-basketball/recruiting/player', 'attacker.example/high-school/girls-basketball/recruiting/player'),
    womenDocument.replace('/player/_/id/12345', '/player/_/id/12345?token=secret'),
  ]) assert.throws(() => parseWomen(html));
});

test('baseball ignores rankings, measurements and pro draft signing status', () => {
  const result = parseBaseball(baseballDocument);
  assert.equal(result.records[0].name, 'Example Player');
  assert.equal(result.records[0].position, 'RHP');
  assert.equal(result.records[0].status, 'committed');
  assert.equal(result.records[0].profileUrl, 'https://www.perfectgame.org/Players/PlayerProfile.aspx?ID=12345');
  assert.equal(result.records[0].sourceUrl, baseballUrl);
  assert.equal(result.records[0].sport, 'baseball');
  assert.deepEqual(Object.keys(result.records[0]).sort(), ['id', 'name', 'classYear', 'position', 'profileUrl', 'status', 'schoolId', 'sport', 'sourceUrl', 'updatedAt'].sort());
});

test('baseball rejects another school/class, unexpected columns, external profiles and pagination', () => {
  for (const html of [
    baseballDocument.replace('value="1757"', 'value="1569"'),
    baseballDocument.replace('value="2027"', 'value="2026"'),
    baseballDocument.replace('<td>Arizona</td>', '<td>Baylor</td>'),
    baseballDocument.replace('<th>College</th>', '<th>College Interests</th>'),
    baseballDocument.replace('../Players/PlayerProfile.aspx?ID=12345', 'https://attacker.example/Players/PlayerProfile.aspx?ID=12345'),
    baseballDocument.replace('../Players/PlayerProfile.aspx?ID=12345', '../Players/PlayerProfile.aspx?ID=12345&token=secret'),
    baseballDocument.replace('</tbody>', '<tr class="rgPager"><td>Next</td></tr></tbody>'),
    baseballDocument.replace('class="rgRow"', 'class="unexpected"'),
    baseballDocument.replace('<td>Signed</td>', ''),
  ]) assert.throws(() => parseBaseball(html));
});

test('baseball empty requires the explicit source message and school/year evidence', () => {
  const empty = baseballDocument.replace(/<table[\s\S]*<\/table>/, '<span id="test_lblNoCommits">No Commitments</span>');
  assert.deepEqual(parseBaseball(empty), { records: [], season: '2027', emptyConfirmed: true, reason: 'provider-has-no-commitment-records' });
  assert.throws(() => parseBaseball(empty.replace('No Commitments', 'Loading')));
  assert.throws(() => parseBaseball(empty.replace('value="1757"', 'value="1569"')));
});

test('duplicate identities, oversized/challenged documents and invalid observation times fail closed', () => {
  assert.throws(() => parseWomen(womenDocument.replace('<td>1</td>', '<td>2</td>').replace(womenRow, womenRow + womenRow)), /Duplicate/);
  assert.throws(() => parseBaseball(baseballDocument.replace(baseballRow, baseballRow + baseballRow)), /Duplicate/);
  assert.throws(() => parseWomen('x'.repeat(2_000_001)), /size/);
  assert.throws(() => parseBaseball('Sorry, you have been blocked'), /challenge/);
  assert.throws(() => parseAdditionalRecruiting(womenDocument, womenUrl, school, 'womens-basketball', 2027, 'not-a-date'), /observation/);
});

test('URL construction has finite school/sport scopes and validated years', () => {
  for (const [s, sport, year] of [[school, 'football', 2027], [school, 'baseball', '2027'], [school, 'baseball', 2101], [{ slug: 'unknown' }, 'baseball', 2027], [{ slug: 'colorado' }, 'baseball', 2027], [{ ...school, espnId: '12/../239' }, 'womens-basketball', 2027]]) assert.throws(() => additionalRecruitingSourceUrl(s, sport, year));
  assert.throws(() => parseAdditionalRecruiting(baseballDocument, baseballUrl + '&extra=value', school, 'baseball', 2027, at), /scope/);
});
