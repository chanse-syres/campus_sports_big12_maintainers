import { emptyDataset, refreshDataset } from './dataset.mjs';
import { parseNews } from './adapters/news.mjs';
import { parseWebNews } from './adapters/web-news.mjs';
import { stableId, safeUrl } from './normalize.mjs';

export const MAX_NEWS_RECORDS = 1000;

export function canonicalArticleUrl(value) {
  const safe = safeUrl(value);
  if (!safe) throw new Error('Invalid article URL');
  const url = new URL(safe);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}

/** Rolling metadata archive: provider feed rotation must not erase articles. */
export function mergeNewsRecords(previous, current, school, sport) {
  const records = new Map();
  for (const record of [...previous, ...current]) {
    const url = canonicalArticleUrl(record.url), prior = records.get(url);
    records.set(url, { ...record, url, id: stableId(school.slug, sport, url),
      imageUrl: record.imageUrl ?? prior?.imageUrl ?? null,
      imageAlt: record.imageAlt ?? prior?.imageAlt ?? null,
    });
  }
  const titles = new Set();
  return [...records.values()].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || a.url.localeCompare(b.url))
    .filter(record => {
      const key = `${record.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${record.publishedAt?.slice(0, 10) ?? record.url}`;
      if (titles.has(key)) return false;
      titles.add(key); return true;
    }).slice(0, MAX_NEWS_RECORDS);
}

export async function refreshNews({ school, sport, at, previous, get, sources }) {
  const officialSource = { id: 'official', url: school.news[sport].url };
  const selected = [officialSource, ...sources.filter(source => !source.sport || source.sport === sport)];
  if (selected.length > 20 || new Set(selected.map(source => source.url)).size !== selected.length) throw new Error('Invalid news source configuration');
  const results = [];
  for (const source of selected) {
    const priorHealth = previous?.sources.find(item => item.sourceUrl === source.url);
    const priorRecords = previous?.records.filter(record => record.discoverySourceUrl === source.url) ?? [];
    const prior = priorHealth ? { ...priorHealth, season: null, records: priorRecords } : null;
    if (prior) delete prior.recordCount;
    const dataset = await refreshDataset({ at, sourceUrl: source.url, prior, get,
      parse: text => {
        const parsed = source.id === 'official'
          ? { records: parseNews(text, source.url, school, sport), emptyConfirmed: false }
          : parseWebNews(text, source, school, sport, at);
        const observed = parsed.records.map(record => ({ ...record, discoverySourceUrl: source.url }));
        // Retain previously captured stories when a valid RSS window rolls over.
        return { ...parsed, records: mergeNewsRecords(priorRecords, observed, school, sport) };
      },
    });
    results.push(dataset);
  }
  const successes = results.filter(item => item.lastSuccessAt);
  const degraded = results.some(item => ['stale', 'unavailable'].includes(item.status));
  const records = mergeNewsRecords([], results.flatMap(item => item.records), school, sport);
  const status = !successes.length ? 'unavailable' : degraded ? 'stale' : records.length ? 'ok' : 'empty';
  const combined = { ...emptyDataset(at, status, degraded ? 'one-or-more-news-sources-degraded' : null, officialSource.url),
    lastSuccessAt: successes.map(item => item.lastSuccessAt).sort()[0] ?? null,
    records,
    sources: results.map(({ records: items, season: _season, ...health }) => ({ ...health, recordCount: items.length })),
  };
  return { combined, official: results[0] };
}
