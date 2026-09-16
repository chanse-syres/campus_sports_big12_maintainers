// Server-side example. Keep snapshot loading out of browser-rendered components.
import { validateSnapshot } from '../src/validate.mjs';

export const DATA_BASE_URL = 'https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v2';
export const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;
const SCHOOL_SLUGS = new Set([
  'arizona', 'arizona-state', 'baylor', 'byu', 'cincinnati', 'colorado',
  'houston', 'iowa-state', 'kansas', 'kansas-state', 'oklahoma-state',
  'tcu', 'texas-tech', 'ucf', 'utah', 'west-virginia',
]);
const SPORT_MAP = Object.freeze({
  football: ['football', 'Football'],
  basketball: ['basketball', "Men's Basketball"],
  'womens-basketball': ['womensBasketball', "Women's Basketball"],
  baseball: ['baseball', 'Baseball'],
});
const COLLECTIONS = Object.freeze([
  'news', 'schedule', 'roster', 'recruitingAnnouncements', 'recruitingBoard', 'recruitingOffers',
]);
const STATUS_LABELS = Object.freeze({
  offered: 'Historical offer', committed: 'Committed', signed: 'Signed', enrolled: 'Enrolled', unknown: 'Unknown',
});

function assertSchool(slug) {
  if (!SCHOOL_SLUGS.has(slug)) throw new TypeError('Unknown Big 12 school slug');
}

function isExpired(timestamp, now) {
  const value = Date.parse(timestamp);
  return !Number.isFinite(value) || now - value > MAX_AGE_MS || value > now + 5 * 60 * 1000;
}

async function readBoundedJson(response) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BYTES) throw new Error('Snapshot exceeds size limit');
  if (!response.body) throw new Error('Snapshot body is missing');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Snapshot exceeds size limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/**
 * Fetch a fixed public data URL. An optional previously validated snapshot can
 * preserve the last usable data if transport or validation fails. Store that
 * snapshot in your own server cache; this module never writes private services.
 */
export async function loadTeamSnapshot(slug, {
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  previousSnapshot = null,
} = {}) {
  assertSchool(slug);
  // Validate the fallback before any network I/O. Never accept another school.
  if (previousSnapshot) validateSnapshot(previousSnapshot, slug);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${DATA_BASE_URL}/teams/${slug}.json`, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const snapshot = await readBoundedJson(response);
    validateSnapshot(snapshot, slug);
    return {
      snapshot,
      transportStatus: 'fetched',
      stale: isExpired(snapshot.generatedAt, now),
      reason: isExpired(snapshot.generatedAt, now) ? 'snapshot-older-than-48h-or-invalid-clock' : null,
    };
  } catch {
    if (!previousSnapshot) throw new Error('No validated team snapshot is available');
    return {
      snapshot: previousSnapshot,
      transportStatus: 'fallback',
      stale: true,
      reason: 'snapshot-fetch-or-validation-failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceLabel(sourceUrl) {
  const hostname = new URL(sourceUrl).hostname;
  if (hostname === '247sports.com' || hostname.endsWith('.247sports.com')) return '247Sports';
  if (hostname === 'espn.com' || hostname.endsWith('.espn.com') || hostname.endsWith('.espncdn.com')) return 'ESPN HoopGurlz';
  if (hostname === 'perfectgame.org' || hostname.endsWith('.perfectgame.org')) return 'Perfect Game';
  return hostname;
}

function hasIncompleteWomenRecruitingCoverage(dataset, schoolSlug, sportSlug, collection) {
  if (sportSlug !== 'womens-basketball' || !['recruitingBoard', 'recruitingOffers'].includes(collection)) return false;
  const source = dataset.sourceUrl?.match(/^https:\/\/247sports\.com\/college\/([a-z-]+)\/season\/(20\d{2}|2100)-womens-basketball\/(commits|offers)\/$/);
  const providerSlug = schoolSlug === 'ucf' ? 'central-florida' : schoolSlug;
  return Boolean(source && source[1] === providerSlug && (dataset.season === null || source[2] === dataset.season)
    && source[3] === (collection === 'recruitingBoard' ? 'commits' : 'offers'));
}

function compareNews(left, right) {
  return Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
    `${left.schoolId}:${left.sport}:${left.id}`.localeCompare(`${right.schoolId}:${right.sport}:${right.id}`, 'en');
}

function toArticle(record, scope) {
  return {
    ...scope,
    id: record.id,
    title: record.title,
    summary: '',
    publisher: record.publisher,
    discoverySourceUrl: record.discoverySourceUrl,
    publishedAt: record.publishedAt,
    publishedAtPrecision: record.publishedAtPrecision,
    url: record.url,
    href: record.url,
    ...(record.imageUrl ? { imageUrl: record.imageUrl } : {}),
    ...(record.imageAlt ? { imageAlt: record.imageAlt } : {}),
  };
}

/**
 * Map every validated collection for server-rendered school/sport pages.
 * Dataset health remains beside its records; no status or missing value is
 * fabricated. Pass expectedSlug when mapping a snapshot outside the reader.
 */
export function toFrontendTeam(snapshot, {
  expectedSlug,
  now = Date.now(),
  transportStale = false,
} = {}) {
  validateSnapshot(snapshot, expectedSlug);
  assertSchool(snapshot.school.slug);
  const snapshotStale = transportStale || isExpired(snapshot.generatedAt, now);
  const sports = {};
  for (const [sportSlug, [sport, sportLabel]] of Object.entries(SPORT_MAP)) {
    const program = snapshot.sports[sportSlug];
    const scope = { schoolId: snapshot.school.slug, schoolLabel: snapshot.school.name, sport, sportSlug, sportLabel };
    const mapped = { ...scope, sponsored: program.sponsored };
    for (const collection of COLLECTIONS) {
      const dataset = program[collection];
      const isNews = collection === 'news' || collection === 'recruitingAnnouncements';
      let records;
      if (isNews) {
        // Unknown publication dates cannot be placed in a dated news feed.
        records = dataset.records.filter(record => record.publishedAt !== null)
          .map(record => toArticle(record, scope)).sort(compareNews);
      } else if (collection === 'recruitingBoard' || collection === 'recruitingOffers') {
        records = dataset.records.map(record => ({
          ...record,
          ...scope,
          scope: { schoolId: snapshot.school.slug, sport },
          statusLabel: STATUS_LABELS[record.status],
          lastUpdated: record.updatedAt,
          href: record.profileUrl ?? record.sourceUrl,
          sources: [{ label: sourceLabel(record.sourceUrl), url: record.sourceUrl }],
        }));
      } else {
        records = dataset.records.map(record => ({ ...record, ...scope }));
      }
      mapped[collection] = {
        health: {
          sponsored: program.sponsored,
          status: dataset.status,
          sourceUrl: dataset.sourceUrl,
          ...(collection === 'news' ? { sources: dataset.sources.map(source => ({ ...source })) } : {}),
          season: dataset.season,
          lastAttemptAt: dataset.lastAttemptAt,
          lastSuccessAt: dataset.lastSuccessAt,
          reason: dataset.reason,
          coverageLabel: dataset.reason === 'provider-has-no-commitment-records'
            ? 'No commitment records listed by provider; class size unknown'
            : dataset.reason === 'provider-has-no-offer-records' ? 'No offer records listed by provider; coverage incomplete'
            : hasIncompleteWomenRecruitingCoverage(dataset, snapshot.school.slug, sportSlug, collection)
              ? 'Provider-reported records; coverage incomplete' : null,
          stale: snapshotStale || dataset.status === 'stale' ||
            (dataset.lastSuccessAt !== null && isExpired(dataset.lastSuccessAt, now)),
          recordCount: dataset.records.length,
          displayedRecordCount: records.length,
          ...(isNews ? { omittedUndatedCount: dataset.records.length - records.length } : {}),
        },
        records,
      };
    }
    sports[sport] = mapped;
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    conference: snapshot.conference,
    school: { ...snapshot.school },
    generatedAt: snapshot.generatedAt,
    stale: snapshotStale,
    sports,
  };
}

/** Compatibility helper for the existing Campus Sports HQ news catalog. */
export function toSiteNews(snapshot, options = {}) {
  const team = toFrontendTeam(snapshot, options);
  const articles = [];
  const health = {};
  for (const [sport, program] of Object.entries(team.sports)) {
    health[sport] = program.news.health;
    articles.push(...program.news.records);
  }
  articles.sort(compareNews);
  return { articles, health };
}
