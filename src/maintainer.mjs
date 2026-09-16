import { SPORTS, sourceHosts } from './config.mjs';
import { fetchSourceText } from './network.mjs';
import { emptyDataset, refreshDataset } from './dataset.mjs';
export { emptyDataset, refreshDataset } from './dataset.mjs';
import { refreshNews } from './news-pipeline.mjs';
import { webNewsSources } from './adapters/web-news.mjs';
import { enrichNewsImages } from './news-images.mjs';
import { espnUrl, teamId, parseRoster, parseSchedule } from './adapters/espn.mjs';
import { validateSnapshot } from './validate.mjs';
import { recruitingSourceUrl, collectRecruiting } from './adapters/recruiting.mjs';
import { additionalRecruitingSourceUrl, parseAdditionalRecruiting } from './adapters/additional-recruiting.mjs';

// Keep the current signing class through February; start the next cycle in March.
export const recruitingCycle = date => date.getUTCFullYear() + (date.getUTCMonth() >= 2 ? 1 : 0);

export async function maintainSchool(school, { now = new Date().toISOString(), previous = null, get, sourceCache = new Map() } = {}) {
  if (previous) validateSnapshot(previous, school.slug);
  const at = new Date(now).toISOString();
  const webSources = webNewsSources(school);
  const allowedHosts = [...new Set([...sourceHosts(school), ...webSources.flatMap(source => [new URL(source.url).hostname, ...(source.articleHosts ?? [])])])];
  const request = get ?? (url => fetchSourceText(url, { allowedHosts }));
  const requests = sourceCache;
  const cacheable = new Set([...webSources.map(source => source.url), ...Object.values(school.news).map(source => source.url)]);
  const fetchSource = url => {
    // Cache school-wide RSS responses once per run, including failed attempts.
    if (!cacheable.has(url)) return request(url);
    if (!requests.has(url)) requests.set(url, Promise.resolve().then(() => request(url)));
    return requests.get(url);
  };
  const result = { schemaVersion: 2, conference: 'big12', school: { slug: school.slug, name: school.name, athleticsUrl: school.athleticsUrl }, generatedAt: at, sports: {} };
  // Sequential sport/source requests per school bound traffic and isolate each collection's failures.
  for (const sport of SPORTS) {
    const sponsored = school.sports.includes(sport);
    const entry = { sponsored };
    if (!sponsored) {
      for (const name of ['news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard', 'recruitingOffers']) entry[name] = emptyDataset(at, 'unsupported', 'school-does-not-sponsor-sport');
      entry.news.sources = [];
      result.sports[sport] = entry; continue;
    }
    const prior = previous?.sports[sport];
    const news = await refreshNews({ school, sport, at, previous: prior?.news, get: fetchSource, sources: webSources });
    entry.news = news.combined;
    const images = await enrichNewsImages(entry.news.records.slice(0, 400), {
      allowedHosts, maxFetches: 3,
      get: (url, options) => get ? get(url) : fetchSourceText(url, {
        ...options, allowedHosts: options.allowedHosts.filter(host => allowedHosts.includes(host)),
        redirects: 0, maxBytes: 2_000_000, timeoutMs: 15_000,
      }),
    });
    entry.news.records = [...images, ...entry.news.records.slice(400)];
    for (const [collection, parse] of [['schedule', parseSchedule], ['roster', parseRoster]]) {
      entry[collection] = await refreshDataset({ at, sourceUrl: espnUrl(school, sport, collection), prior: prior?.[collection], get: fetchSource, parse: text => parse(text, teamId(school, sport)) });
    }
    // These are article metadata, never inferred player identities, ratings, or offer histories.
    const announcements = news.official.records.filter(r => /\b(signs?|signing|signees?|recruiting class|adds? .+ to (?:the )?roster|welcomes? .+ class)\b/i.test(r.title)).slice(0, 400);
    entry.recruitingAnnouncements = { ...news.official, status: ['ok', 'empty'].includes(news.official.status) ? (announcements.length ? 'ok' : 'empty') : news.official.status, records: announcements, reason: ['ok', 'empty'].includes(news.official.status) ? 'headline-classification-announcements-only' : news.official.reason };
    const year = recruitingCycle(new Date(at));
    if (['football', 'basketball', 'womens-basketball'].includes(sport)) {
      for (const [name, kind] of [['recruitingBoard', 'commits'], ['recruitingOffers', 'offers']]) {
        const sourceUrl = recruitingSourceUrl(school, sport, year, kind);
        entry[name] = await refreshDataset({ at, sourceUrl, prior: prior?.[name],
          collect: () => collectRecruiting({ school, sport, year, observedAt: at, get: fetchSource, kind }) });
      }
    } else {
      const sourceUrl = additionalRecruitingSourceUrl(school, sport, year);
      entry.recruitingBoard = await refreshDataset({ at, sourceUrl, prior: prior?.recruitingBoard, get: fetchSource,
        parse: text => parseAdditionalRecruiting(text, sourceUrl, school, sport, year, at) });
      entry.recruitingOffers = emptyDataset(at, 'unavailable', 'provider-does-not-cover-offers');
    }
    for (const kind of ['recruitingBoard', 'recruitingOffers']) entry[kind].records = entry[kind].records.map(record => ({
      profileUrl: null, imageUrl: null, schoolName: null, hometown: null, rating: null, ratingSystem: null,
      stars: null, nationalRank: null, positionRank: null, stateRank: null, rankingState: null, rankingGroup: null, ...record,
    }));
    result.sports[sport] = entry;
  }
  return validateSnapshot(result, school.slug);
}
