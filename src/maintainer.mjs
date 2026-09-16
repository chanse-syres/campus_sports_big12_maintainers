import { SPORTS, sourceHosts } from './config.mjs';
import { fetchText, SourceError } from './network.mjs';
import { parseNews } from './adapters/news.mjs';
import { espnUrl, teamId, parseRoster, parseSchedule } from './adapters/espn.mjs';
import { validateSnapshot } from './validate.mjs';
import { recruitingSourceUrl, parseRecruiting } from './adapters/recruiting.mjs';

// Keep the current signing class through February; start the next cycle in March.
export const recruitingCycle = date => date.getUTCFullYear() + (date.getUTCMonth() >= 2 ? 1 : 0);

export const emptyDataset = (at, status, reason, sourceUrl = null) => ({ status, lastAttemptAt: at, lastSuccessAt: null, sourceUrl, season: null, reason, records: [] });
export async function refreshDataset({ at, sourceUrl, prior, get, parse }) {
  try {
    const parsed = parse(await get(sourceUrl));
    if (!Array.isArray(parsed.records)) throw new Error('Invalid records');
    // An unexpectedly empty source must not erase a known collection.
    if (!parsed.records.length && prior?.records.length && parsed.emptyConfirmed !== true) throw new SourceError('unexpected-empty-source');
    return { status: parsed.records.length ? 'ok' : 'empty', lastAttemptAt: at, lastSuccessAt: at, sourceUrl, season: parsed.season ?? null, reason: null, records: parsed.records };
  } catch (error) {
    const reason = error instanceof SourceError ? error.code : 'source-format-changed';
    if (prior?.lastSuccessAt && prior.sourceUrl === sourceUrl) return { ...prior, status: 'stale', lastAttemptAt: at, reason };
    return emptyDataset(at, 'unavailable', reason, sourceUrl);
  }
}
export async function maintainSchool(school, { now = new Date().toISOString(), previous = null, get } = {}) {
  if (previous) validateSnapshot(previous, school.slug);
  const at = new Date(now).toISOString();
  const fetchSource = get ?? (url => fetchText(url, { allowedHosts: sourceHosts(school) }));
  const result = { schemaVersion: 1, conference: 'big12', school: { slug: school.slug, name: school.name, athleticsUrl: school.athleticsUrl }, generatedAt: at, sports: {} };
  // Sequential sport/source requests per school bound traffic and isolate each collection's failures.
  for (const sport of SPORTS) {
    const sponsored = school.sports.includes(sport);
    const entry = { sponsored };
    if (!sponsored) {
      for (const name of ['news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard']) entry[name] = emptyDataset(at, 'unsupported', 'school-does-not-sponsor-sport');
      result.sports[sport] = entry; continue;
    }
    const prior = previous?.sports[sport];
    entry.news = await refreshDataset({ at, sourceUrl: school.news[sport].url, prior: prior?.news, get: fetchSource, parse: text => ({ records: parseNews(text, school.news[sport].url, school, sport) }) });
    for (const [collection, parse] of [['schedule', parseSchedule], ['roster', parseRoster]]) {
      entry[collection] = await refreshDataset({ at, sourceUrl: espnUrl(school, sport, collection), prior: prior?.[collection], get: fetchSource, parse: text => parse(text, teamId(school, sport)) });
    }
    // These are article metadata, never inferred player identities, ratings, or offer histories.
    const announcements = entry.news.records.filter(r => /\b(signs?|signing|signees?|recruiting class|adds? .+ to (?:the )?roster|welcomes? .+ class)\b/i.test(r.title));
    entry.recruitingAnnouncements = { ...entry.news, status: ['ok', 'empty'].includes(entry.news.status) ? (announcements.length ? 'ok' : 'empty') : entry.news.status, records: announcements, reason: ['ok', 'empty'].includes(entry.news.status) ? 'headline-classification-announcements-only' : entry.news.reason };
    if (['football', 'basketball'].includes(sport)) {
      const year = recruitingCycle(new Date(at));
      const sourceUrl = recruitingSourceUrl(school, sport, year);
      entry.recruitingBoard = await refreshDataset({ at, sourceUrl, prior: prior?.recruitingBoard, get: fetchSource,
        parse: text => ({ season: String(year), records: parseRecruiting(text, sourceUrl, school, sport, year, at), emptyConfirmed: true }) });
      if (['ok', 'empty'].includes(entry.recruitingBoard.status)) entry.recruitingBoard.reason = 'verified-commitments-only-offers-not-covered';
    } else entry.recruitingBoard = emptyDataset(at, 'unavailable', 'player-board-provider-not-configured');
    result.sports[sport] = entry;
  }
  return validateSnapshot(result, school.slug);
}
