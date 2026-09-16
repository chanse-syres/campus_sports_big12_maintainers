import { load } from 'cheerio';
import { assertPublicValue, cleanText, safeUrl } from './normalize.mjs';

const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_HEAD_BYTES = 256_000;
const MAX_METADATA = 128;
const MAX_FETCHES = 32;
const TRACKING_KEY = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
const GENERIC_IMAGE = /(?:logo|favicon|placeholder|no[-_]?image|default[-_](?:image|social|share|og)|(?:social|share|og)[-_]default|site[-_]share|social[-_]share[-_](?:image|card)|brand[-_](?:card|image)|masthead)/i;

function publicUrl(raw, base) {
  const safe = safeUrl(raw, base);
  if (!safe) return null;
  try { assertPublicValue(safe); return safe; } catch { return null; }
}

function articleIdentity(raw, base) {
  const safe = publicUrl(raw, base);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_KEY.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  // Do not normalize hosts, encoded paths, or meaningful query parameters:
  // a canonical must identify this exact article, not a nearby publisher page.
  return url.href;
}

function validImage(raw, articleUrl) {
  const safe = publicUrl(raw, articleUrl);
  if (!safe) return null;
  const url = new URL(safe);
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return null; }
  if (GENERIC_IMAGE.test(path) || /\.svg$/i.test(path)) return null;
  return safe;
}

/** Read only bounded head metadata. No body, script, or image bytes are retained. */
export function extractNewsImage(html, articleUrl) {
  const expected = articleIdentity(articleUrl);
  if (!expected || typeof html !== 'string' || Buffer.byteLength(html) > MAX_DOCUMENT_BYTES) return null;
  const head = html.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head\s*>/i)?.[1];
  if (!head || Buffer.byteLength(head) > MAX_HEAD_BYTES) return null;
  const $ = load(`<head>${head}</head>`);
  const canonical = $('head link[rel]').filter((_, element) => ($(element).attr('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonical.length !== 1 || articleIdentity(canonical.attr('href'), articleUrl) !== expected) return null;
  const meta = $('head meta[property], head meta[name]');
  if (meta.length > MAX_METADATA) return null;
  const og = [], twitter = [];
  let currentOg = null, twitterAlt = null;
  for (const element of meta.toArray()) {
    const node = $(element);
    const key = (node.attr('property') || node.attr('name') || '').toLowerCase();
    const value = node.attr('content');
    if (typeof value !== 'string' || value.length > 2048) continue;
    if (key === 'og:image' || key === 'og:image:url') {
      currentOg = { url: value, alt: null };
      og.push(currentOg);
    } else if (key === 'og:image:secure_url' && currentOg) {
      if (validImage(value, articleUrl)) currentOg.url = value;
    } else if (key === 'og:image:alt' && currentOg) currentOg.alt = value;
    else if (key === 'twitter:image' || key === 'twitter:image:src') twitter.push({ url: value, alt: null });
    else if (key === 'twitter:image:alt') twitterAlt = value;
  }
  for (const candidate of [...og, ...twitter.map(image => ({ ...image, alt: twitter.length === 1 ? twitterAlt : null }))]) {
    const imageUrl = validImage(candidate.url, articleUrl);
    if (!imageUrl) continue;
    const imageAlt = cleanText(candidate.alt, 300) || null;
    try { if (imageAlt) assertPublicValue(imageAlt); } catch { continue; }
    return { imageUrl, imageAlt };
  }
  return null;
}

/**
 * Enrich only missing photos from exact allowlisted publisher hosts. The supplied
 * get must enforce the network module's HTTPS/DNS/redirect/time/byte policy; its
 * optional second argument narrows that policy for this metadata-only request.
 * Image CDN URLs are output metadata, never additional fetch destinations.
 */
export async function enrichNewsImages(records, { get, allowedHosts, maxFetches = 12 } = {}) {
  if (!Array.isArray(records) || records.length > 400) throw new TypeError('News image records exceed the supported bounds');
  if (typeof get !== 'function' || !Array.isArray(allowedHosts) || !allowedHosts.every(host => typeof host === 'string')) throw new TypeError('News image fetching requires an explicit getter and publisher hosts');
  if (!Number.isSafeInteger(maxFetches) || maxFetches < 0 || maxFetches > MAX_FETCHES) throw new TypeError('News image fetch budget must be between 0 and 32');
  const allowed = new Set(allowedHosts);
  const images = new Map();
  const result = [];
  let fetches = 0;
  for (const record of records) {
    // Validated existing photos and other article fields remain untouched.
    if (!record || typeof record !== 'object' || record.imageUrl) { result.push(record); continue; }
    const articleUrl = articleIdentity(record.url);
    if (!articleUrl || !allowed.has(new URL(articleUrl).hostname)) { result.push(record); continue; }
    if (!images.has(articleUrl)) {
      if (fetches >= maxFetches) { result.push(record); continue; }
      fetches++;
      try {
        const html = await get(articleUrl, { allowedHosts: [new URL(articleUrl).hostname], maxBytes: MAX_DOCUMENT_BYTES, timeoutMs: 15_000, redirects: 0 });
        images.set(articleUrl, extractNewsImage(html, articleUrl));
      } catch { images.set(articleUrl, null); }
    }
    const image = images.get(articleUrl);
    result.push(image ? { ...record, ...image } : record);
  }
  return result;
}
