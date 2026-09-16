import { load } from 'cheerio';
import { SCHOOL_SLUGS } from '../config.mjs';
import { cleanText, safeUrl, stableId } from '../normalize.mjs';

export function recruitingSourceUrl(school, sport, year) {
  if (!SCHOOL_SLUGS.includes(school?.slug) || !['football', 'basketball'].includes(sport)
      || !Number.isSafeInteger(year) || year < 2000 || year > 2100) throw new Error('Unsupported recruiting scope');
  const providerSlug = school.slug === 'ucf' ? 'central-florida' : school.slug;
  return `https://247sports.com/college/${providerSlug}/season/${year}-${sport}/commits/`;
}

function exactSource(raw, expected) {
  const safe = safeUrl(raw);
  if (!safe) return false;
  const value = new URL(safe);
  return value.hostname === '247sports.com' && !value.search && !value.hash && value.href.toLowerCase() === expected;
}

/** Verified commitment listings only: no inferred offers, transfers, or grades. */
export function parseRecruiting(text, sourceUrl, school, sport, year, observedAt) {
  const expected = recruitingSourceUrl(school, sport, year);
  if (!exactSource(sourceUrl, expected)) throw new Error('Recruiting source scope mismatch');
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Invalid recruiting response size');
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid recruiting observation time');
  if (/Sorry, you have been blocked|Attention Required!|Just a moment\.\.\./i.test(text)) throw new Error('Recruiting source access challenge');
  const $ = load(text);
  if ($('link[rel="canonical"]').length !== 1 || !exactSource($('link[rel="canonical"]').attr('href'), expected)) throw new Error('Recruiting canonical scope mismatch');
  const heading = cleanText($('h1').first().text(), 300);
  const match = heading.match(/^(.*?) (\d{4}) (Football|Basketball) Commits \((\d+)\)(?: All-Time Commits)?$/);
  if (!match || match[1] !== school.name || Number(match[2]) !== year || match[3].toLowerCase() !== sport) throw new Error('Recruiting heading scope mismatch');
  const count = Number(match[4]);
  if (count > 400) throw new Error('Recruiting record count exceeds budget');
  const list = $('ul.ri-page__list');
  if (list.length !== 1) throw new Error('Recruiting listing missing or ambiguous');
  if (list.find('a').filter((_, a) => /(?:load|show)\s+more/i.test($(a).text())).length) throw new Error('Recruiting listing is paginated; complete snapshot required');
  const records = new Map();
  let section = '';
  let hasExplicitEmpty = false;
  for (const element of list.children('li.ri-page__list-item').toArray()) {
    const row = $(element);
    if (row.hasClass('list-header')) { section = cleanText(row.find('.name').text(), 120); continue; }
    if (row.hasClass('ri-page__list-item--no-results')) {
      hasExplicitEmpty = cleanText(row.text()) === `No Results for ${year} ${match[3]}`;
      continue;
    }
    if (/transfers?|de-?commits?/i.test(section)) continue;
    let status;
    if (/^Hard Commits? \(\d+\)$/.test(section)) status = 'committed';
    else if (/^Signed(?: Letter of Intent)? \(\d+\)$/.test(section)) status = 'signed';
    else if (/^(?:Enrolled|Enrollees) \(\d+\)$/.test(section)) status = 'enrolled';
    else throw new Error('Unknown recruiting commitment section');
    const link = row.find('a.ri-page__name-link');
    const profile = safeUrl(link.attr('href'), expected);
    const identity = profile && new URL(profile).hostname === '247sports.com'
      ? new URL(profile).pathname.match(/^\/player\/[a-z0-9-]+-(\d+)\/?$/i)?.[1] : null;
    const name = cleanText(link.text(), 160);
    const position = cleanText(row.find('.position').text(), 30);
    if (link.length !== 1 || !identity || !name || !position) throw new Error('Incomplete recruiting identity');
    const destination = cleanText(row.find('.status img').first().attr('alt'), 160);
    if (destination && destination !== school.name) throw new Error('Recruiting commitment destination mismatch');
    for (const a of row.find('a[href]').toArray()) {
      const href = $(a).attr('href');
      const rowClass = href?.match(/\/season\/(\d{4})-(football|basketball)\//i);
      if (rowClass && (Number(rowClass[1]) !== year || rowClass[2].toLowerCase() !== sport)) throw new Error('Recruiting row class or sport mismatch');
    }
    const id = stableId(school.slug, sport, String(year), '247sports', identity);
    if (records.has(id)) throw new Error('Duplicate recruiting provider identity');
    records.set(id, { id, name, classYear: year, position, status, schoolId: school.slug, sport, sourceUrl: expected, updatedAt: new Date(observedAt).toISOString() });
  }
  if (records.size !== count || (count === 0 && !hasExplicitEmpty)) throw new Error('Recruiting count mismatch or unconfirmed empty result');
  return [...records.values()];
}
