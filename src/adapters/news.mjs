import { load } from 'cheerio';
import { cleanText, safeUrl, stableId } from '../normalize.mjs';

const SPORT_LABELS = {
  football: ['football', 'cowboy football'],
  basketball: ["men's basketball", 'mens-basketball', 'cowboy basketball'],
  'womens-basketball': ["women's basketball", 'womens-basketball', 'cowgirl basketball'],
  baseball: ['baseball', 'cowboy baseball'],
};

function canonicalHost(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function scopedUrl(value, sourceUrl) {
  const url = safeUrl(value, sourceUrl);
  return url && canonicalHost(url) === canonicalHost(sourceUrl) ? url : null;
}

function dateValue(value) {
  if (typeof value !== 'string') return { publishedAt: null, publishedAtPrecision: 'unknown' };
  // Sidearm's clock has no zone: expose its calendar date with explicit day
  // precision. Midnight UTC is a storage convention, not the publication hour.
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) {
    const day = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
    const ms = day ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
    const valid = Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
    return { publishedAt: valid ? new Date(ms).toISOString() : null, publishedAtPrecision: valid ? 'day' : 'unknown' };
  }
  const ms = Date.parse(value);
  return { publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null, publishedAtPrecision: Number.isFinite(ms) ? 'instant' : 'unknown' };
}

function sportMatches(labels, sport) {
  const expected = SPORT_LABELS[sport];
  return expected && labels.some(label => typeof label === 'string' && label.length <= 100 && expected.includes(label.trim().toLowerCase().replaceAll('’', "'")));
}

/** Read metadata from the site's own serialized public archive, never executable JS. */
export function parseNews(text, sourceUrl, school, sport) {
  if (!Object.hasOwn(SPORT_LABELS, sport)) throw new Error('Unsupported news sport');
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Invalid news document size');
  if (canonicalHost(sourceUrl) !== canonicalHost(school.athleticsUrl)) throw new Error('News source is outside the school scope');
  const $ = load(text);
  const payload = $('script#__NUXT_DATA__[type="application/json"]').first().text();
  if (!payload) throw new Error('Official archive data missing');
  let table;
  try { table = JSON.parse(payload); } catch { throw new Error('Official archive data is malformed'); }
  if (!Array.isArray(table) || table.length > 100_000) throw new Error('Official archive data shape changed');
  // Nuxt serializes object fields as indices into an array. Dereference only
  // explicit scalar fields; never recursively revive arbitrary graph objects.
  const ref = index => Number.isSafeInteger(index) && index >= 0 && index < table.length ? table[index] : undefined;
  const scalar = (object, key) => {
    const value = ref(object?.[key]);
    // Shared Nuxt references must not amplify a large string across many rows.
    if (typeof value === 'string' && value.length > 4096) throw new Error('Official archive scalar exceeds budget');
    return typeof value === 'string' ? value : null;
  };
  const rows = new Map();
  let candidates = 0;
  for (const node of table) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    let title, path, date, image, alt, labels;
    if (Object.hasOwn(node, 'storyHeadline') && Object.hasOwn(node, 'storyPath')) {
      if (++candidates > 200) throw new Error('Official archive candidate budget exceeded');
      title = scalar(node, 'storyHeadline');
      path = scalar(node, 'storyPath');
      date = scalar(node, 'storyPostdate');
      image = scalar(node, 'storyImage');
      labels = (scalar(node, 'sportsCats') ?? scalar(node, 'sportTitle') ?? '').split(',');
    } else if (Object.hasOwn(node, 'published_at') && Object.hasOwn(node, 'permalink')) {
      if (++candidates > 200) throw new Error('Official archive candidate budget exceeded');
      // WMT can embed navigation and other sport articles on the same page.
      const sportRefs = ref(node.sports) ?? ref(node.orderedSports);
      if (!Array.isArray(sportRefs) || sportRefs.length > 100) continue;
      labels = sportRefs.map(index => scalar(ref(index), 'slug') ?? scalar(ref(index), 'name'));
      if (scalar(node, 'visibility') !== 'public') continue;
      title = scalar(node, 'title');
      path = scalar(node, 'permalink');
      date = scalar(node, 'published_at');
      const media = ref(node.image);
      image = scalar(media, 'url');
      alt = scalar(media, 'alt');
    } else continue;
    if (!sportMatches(labels, sport)) continue;
    const url = scopedUrl(path, sourceUrl);
    const plainTitle = cleanText(title, 300);
    if (!url || !new URL(url).pathname.startsWith('/news/') || !plainTitle) continue;
    const imageUrl = image ? scopedUrl(image, sourceUrl) : null;
    rows.set(url, {
      id: stableId(school.slug, sport, url),
      title: plainTitle,
      url,
      ...dateValue(date),
      imageUrl,
      imageAlt: imageUrl ? cleanText(alt, 300) || null : null,
      publisher: `${cleanText(school.name, 100)} Athletics`,
    });
  }
  if (!rows.size) throw new Error('No recognizable news metadata for the requested sport');
  return [...rows.values()].slice(0, 30);
}
