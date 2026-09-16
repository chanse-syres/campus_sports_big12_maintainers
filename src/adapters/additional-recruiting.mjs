import { load } from 'cheerio';
import { SCHOOL_SLUGS } from '../config.mjs';
import { cleanText, safeUrl, stableId } from '../normalize.mjs';

// Public college IDs and labels from Perfect Game's school selector. No login,
// hidden rankings, scouting reports, contact information, or athlete bios are read.
const BASEBALL_SCHOOLS = Object.freeze({
  arizona: ['1757', 'Arizona'], 'arizona-state': ['1564', 'Arizona State'],
  baylor: ['1569', 'Baylor'], byu: ['1575', 'Brigham Young'],
  cincinnati: ['1769', 'University of Cincinnati'], houston: ['1779', 'University of Houston'],
  kansas: ['1783', 'Kansas'], 'kansas-state': ['1645', 'Kansas State'],
  'oklahoma-state': ['1694', 'Oklahoma State'], tcu: ['1742', 'TCU'],
  'texas-tech': ['1745', 'Texas Tech'], ucf: ['1768', 'University of Central Florida'],
  utah: ['1835', 'Utah'], 'west-virginia': ['1850', 'West Virginia'],
});

export function additionalRecruitingSourceUrl(school, sport, year) {
  if (!SCHOOL_SLUGS.includes(school?.slug) || !Number.isSafeInteger(year) || year < 2000 || year > 2100) throw new Error('Unsupported recruiting scope');
  if (sport === 'womens-basketball' && /^\d+$/.test(school.espnId)) {
    return `https://www.espn.com/high-school/girls-basketball/recruiting/school/_/id/${school.espnId}/class/${year}`;
  }
  if (sport === 'baseball' && Object.hasOwn(BASEBALL_SCHOOLS, school.slug)) {
    return `https://www.perfectgame.org/College/CollegeCommitments.aspx?college=${BASEBALL_SCHOOLS[school.slug][0]}&grad=${year}`;
  }
  throw new Error('Unsupported recruiting sport');
}

function document(text, sourceUrl, expected, at) {
  if (safeUrl(sourceUrl) !== expected) throw new Error('Recruiting source scope mismatch');
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Invalid recruiting response size');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('Invalid recruiting observation time');
  if (/Sorry, you have been blocked|Attention Required!|Just a moment\.\.\./i.test(text)) throw new Error('Recruiting source access challenge');
  return load(text);
}

function record(school, sport, year, sourceUrl, at, provider, identity, name, position, profileUrl, status = 'committed') {
  return { id: stableId(school.slug, sport, String(year), provider, identity), name, classYear: year, position, profileUrl, status, schoolId: school.slug, sport, sourceUrl, updatedAt: new Date(at).toISOString() };
}

function insert(records, value) {
  if (records.has(value.id)) throw new Error('Duplicate recruiting provider identity');
  records.set(value.id, value);
}

/** Public provider-reported commitments, not a comprehensive class or offers board. */
export function parseAdditionalRecruiting(text, sourceUrl, school, sport, year, at) {
  const expected = additionalRecruitingSourceUrl(school, sport, year);
  const $ = document(text, sourceUrl, expected, at);
  const records = sport === 'womens-basketball'
    ? parseWomen($, expected, school, year, at)
    : parseBaseball($, expected, school, year, at);
  return { records, emptyConfirmed: sport === 'baseball' || records.length > 0, season: String(year), reason: records.length ? 'provider-reported-commitments-only-offers-not-covered' : 'provider-has-no-commitment-records' };
}

function parseWomen($, sourceUrl, school, year, at) {
  // ESPN's legacy pages declare an HTTP canonical. Compare the exact HTTPS
  // equivalent; this is provenance validation and never causes an HTTP fetch.
  const canonical = $('link[rel="canonical"]');
  const canonicalUrl = canonical.attr('href')?.replace(/^http:\/\/www\.espn\.com\//, 'https://www.espn.com/');
  if (canonical.length !== 1 || safeUrl(canonicalUrl) !== sourceUrl) throw new Error('Recruiting canonical scope mismatch');
  if (cleanText($('title').text(), 300) !== `${year} High School Girls' Basketball Recruits - ${school.name} - ESPN`) throw new Error('Recruiting heading scope mismatch');
  const activeTab = $('#tabs > li.active > a.commits');
  if (activeTab.length !== 1 || safeUrl(activeTab.attr('href')) !== sourceUrl) throw new Error('Recruiting commitment tab missing');
  const summary = $('.stats-col-2');
  if (summary.length !== 1 || cleanText(summary.find('h4').text()) !== `${year} Player Commits`) throw new Error('Recruiting class summary missing');
  const headers = summary.find('table thead td').map((_, element) => cleanText($(element).text())).get();
  if (headers.join('|') !== 'Commits|ESPN 100 Commits') throw new Error('Recruiting count headers changed');
  const countText = cleanText(summary.find('table tbody tr td').first().text());
  const container = $('#filter-commits');
  if (container.length !== 1) throw new Error('Recruiting listing missing or ambiguous');
  if (countText === '—' && cleanText(container.text()) === 'Committed recruits are not available.') {
    // An empty provider listing is not evidence that the actual class has zero
    // recruits. The returned reason preserves that distinction for the UI.
    return [];
  }
  if (!/^\d+$/.test(countText)) throw new Error('Recruiting record count missing');
  const count = Number(countText);
  if (count > 400) throw new Error('Recruiting record count exceeds budget');
  const rows = container.find('.item');
  if (rows.length !== count || !count) throw new Error('Recruiting count mismatch or unconfirmed empty result');
  const records = new Map();
  for (const element of rows.toArray()) {
    const row = $(element);
    const link = row.find('.player .name > a');
    const profile = safeUrl(link.attr('href'));
    const identity = profile?.match(/^https:\/\/www\.espn\.com\/high-school\/girls-basketball\/recruiting\/player\/_\/id\/(\d+)$/)?.[1];
    const name = cleanText(link.text(), 160);
    const label = cleanText(row.find('.player .name').text(), 200);
    const position = label.startsWith(`${name}, `) ? label.slice(name.length + 2) : null;
    const statusText = cleanText(row.find('.commit-status').text(), 40);
    const status = { Verbal: 'committed', Signed: 'signed', Enrolled: 'enrolled' }[statusText];
    if (link.length !== 1 || !identity || !name || !position || !/^[A-Z/ -]{1,30}$/.test(position) || !status) throw new Error('Incomplete recruiting identity or unknown status');
    insert(records, record(school, 'womens-basketball', year, sourceUrl, at, 'espn-hoopgurlz', identity, name, position, profile, status));
  }
  return [...records.values()];
}

function parseBaseball($, sourceUrl, school, year, at) {
  const [collegeId, collegeLabel] = BASEBALL_SCHOOLS[school.slug];
  const college = $('select[id$="_ddlColleges"] option[selected]');
  const selectedYear = $('select[id$="_ddlYear"] option[selected]');
  if (college.length !== 1 || college.attr('value') !== collegeId || cleanText(college.text(), 160) !== collegeLabel
      || selectedYear.length !== 1 || selectedYear.attr('value') !== String(year) || cleanText(selectedYear.text()) !== String(year)
      || cleanText($('title').text(), 300) !== `${collegeLabel} - Perfect Game Baseball Player College Commitments`) throw new Error('Recruiting school or class scope mismatch');
  const table = $('table[id$="_radgCommitment_ctl00"]');
  const noCommits = $('span[id$="_lblNoCommits"]');
  if (!table.length && noCommits.length === 1 && cleanText(noCommits.text()) === 'No Commitments') return [];
  if (table.length !== 1) throw new Error('Recruiting listing missing or ambiguous');
  if ($('.rgPager,.rgNumPart,.rgPageNext,.rgPageLast').length) throw new Error('Recruiting listing is paginated; complete snapshot required');
  const headers = table.find('> thead > tr > th').map((_, element) => cleanText($(element).text())).get();
  if (headers.join('|') !== 'Rank|Player|Pos|Ht|Wt|BT|HS|Hometown|St|College|Draft') throw new Error('Recruiting table headers changed');
  const allRows = table.find('> tbody > tr');
  const rows = allRows.filter('.rgRow,.rgAltRow');
  if (rows.length !== allRows.length || !rows.length || rows.length > 400) throw new Error('Recruiting row count invalid or unconfirmed empty result');
  const records = new Map();
  for (const element of rows.toArray()) {
    const row = $(element);
    const cells = row.children('td');
    if (cells.length !== 11 || cleanText(cells.eq(9).text(), 160) !== collegeLabel) throw new Error('Recruiting row destination mismatch');
    const link = cells.eq(1).find('a[id$="_hlPlayerName"]');
    const profile = safeUrl(link.attr('href'), sourceUrl);
    const identity = profile?.match(/^https:\/\/www\.perfectgame\.org\/Players\/PlayerProfile\.aspx\?ID=(\d+)$/)?.[1];
    const name = cleanText(link.text(), 160);
    const position = cleanText(cells.eq(2).text(), 30);
    if (link.length !== 1 || !identity || !name || !/^[A-Z0-9/ -]{1,30}$/.test(position)) throw new Error('Incomplete recruiting identity');
    // PG describes its listing as reported verbal commitments. The Draft
    // column can refer to professional signing and is deliberately ignored.
    insert(records, record(school, 'baseball', year, sourceUrl, at, 'perfect-game', identity, name, position, profile));
  }
  return [...records.values()];
}
