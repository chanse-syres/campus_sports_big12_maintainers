// Server-side example. Keep snapshot loading out of browser-rendered components.
import { validateSnapshot } from '../src/validate.mjs';

export const DATA_BASE_URL = 'https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v1';
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

/** Return existing Campus Sports HQ article fields plus explicit source health. */
export function toSiteNews(snapshot, { now = Date.now(), transportStale = false } = {}) {
  validateSnapshot(snapshot);
  assertSchool(snapshot.school.slug);
  const articles = [];
  const health = {};
  for (const [sportSlug, [sport, sportLabel]] of Object.entries(SPORT_MAP)) {
    const program = snapshot.sports[sportSlug];
    const dataset = program.news;
    health[sport] = {
      sponsored: program.sponsored,
      status: dataset.status,
      lastAttemptAt: dataset.lastAttemptAt,
      lastSuccessAt: dataset.lastSuccessAt,
      reason: dataset.reason,
      stale: transportStale || dataset.status === 'stale' ||
        isExpired(snapshot.generatedAt, now) ||
        (dataset.lastSuccessAt !== null && isExpired(dataset.lastSuccessAt, now)),
      omittedUndatedCount: dataset.records.filter(record => record.publishedAt === null).length,
    };
    if (!program.sponsored) continue;
    for (const record of dataset.records) {
      // A fetch time is not evidence of when the publisher released a story.
      if (record.publishedAt === null) continue;
      articles.push({
        id: record.id,
        schoolId: snapshot.school.slug,
        schoolLabel: snapshot.school.name,
        sport,
        sportLabel,
        title: record.title,
        summary: '',
        publisher: record.publisher,
        publishedAt: record.publishedAt,
        publishedAtPrecision: record.publishedAtPrecision,
        url: record.url,
        href: record.url,
        ...(record.imageUrl ? { imageUrl: record.imageUrl } : {}),
        ...(record.imageAlt ? { imageAlt: record.imageAlt } : {}),
      });
    }
  }
  articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
    `${a.schoolId}:${a.sport}:${a.id}`.localeCompare(`${b.schoolId}:${b.sport}:${b.id}`, 'en'));
  return { articles, health };
}
