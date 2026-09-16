import { load } from 'cheerio';
import { SCHOOL_SLUGS, SPORTS } from '../config.mjs';
import { cleanText, safeUrl, stableId } from '../normalize.mjs';
import { classifyNewsRelevance } from '../news-relevance.mjs';

const SI_SLUGS = Object.freeze({
  arizona: 'arizona', 'arizona-state': 'arizonastate', baylor: 'baylor', byu: 'byu',
  cincinnati: 'cincinnati', colorado: 'colorado', houston: 'houston', 'iowa-state': 'iowa-state',
  kansas: 'kansas', 'kansas-state': 'kstate', 'oklahoma-state': 'oklahomastate', tcu: 'tcu',
  'texas-tech': 'texas-tech', ucf: 'ucf', utah: 'utah', 'west-virginia': 'westvirginia',
});
const SI_MASCOTS = Object.freeze({ arizona: 'Wildcats', 'arizona-state': 'Sun Devils', baylor: 'Bears', byu: 'Cougars', cincinnati: 'Bearcats', colorado: 'Buffaloes', houston: 'Cougars', 'iowa-state': 'Cyclones', kansas: 'Jayhawks', 'kansas-state': 'Wildcats', 'oklahoma-state': 'Cowboys', tcu: 'Horned Frogs', 'texas-tech': 'Red Raiders', ucf: 'Knights', utah: 'Utes', 'west-virginia': 'Mountaineers' });
// These direct publisher feeds were verified, rather than assuming old school
// blog domains remain active. No search result redistribution or account is used.
const LOCAL = Object.freeze({
  arizona: ['az-desert-swarm', 'https://www.azdesertswarm.com/rss/current.xml', 'Arizona Desert Swarm'],
  baylor: ['baylor-lariat', 'https://baylorlariat.com/category/sports/feed/', 'The Baylor Lariat'],
  byu: ['vanquish-the-foe', 'https://www.vanquishthefoe.com/rss/current.xml', 'Vanquish The Foe'],
  houston: ['daily-cougar', 'https://thedailycougar.com/feed/', 'The Cougar'],
  'iowa-state': ['wide-right-natty-lite', 'https://www.widerightnattylite.com/rss/current.xml', 'Wide Right & Natty Lite'],
  kansas: ['rock-chalk-talk', 'https://www.rockchalktalk.com/rss/current.xml', 'Rock Chalk Talk'],
  'kansas-state': ['bring-on-the-cats', 'https://www.bringonthecats.com/rss/current.xml', 'Bring On The Cats'],
  tcu: ['frogs-o-war', 'https://www.frogsowar.com/rss/current.xml', "Frogs O' War"],
  utah: ['daily-utah-chronicle', 'https://dailyutahchronicle.com/category/sports/feed/', 'The Daily Utah Chronicle'],
  'west-virginia': ['smoking-musket', 'https://www.smokingmusket.com/rss/current.xml', 'The Smoking Musket'],
});
const hostVariants = host => [...new Set([host, host.replace(/^www\./, '')])];
function source(id, url, publisher, sport = null, schoolScoped = false, options = {}) {
  const host = new URL(url).hostname;
  return Object.freeze({ id, url, publisher, sport, schoolScoped, articleHosts: hostVariants(host),
    imageHosts: [...hostVariants(host), `platform.${host.replace(/^www\./, '')}`], feedTitle: publisher, ...options });
}
const NATIONAL = Object.freeze([
  source('espn-football', 'https://www.espn.com/espn/rss/ncf/news', 'ESPN', 'football', false, { feedTitle: 'www.espn.com - NCF', imageHosts: ['a.espncdn.com'] }),
  source('espn-basketball', 'https://www.espn.com/espn/rss/ncb/news', 'ESPN', 'basketball', false, { feedTitle: 'www.espn.com - NCB', imageHosts: ['a.espncdn.com'] }),
  source('espn-womens-basketball', 'https://www.espn.com/espn/rss/ncw/news', 'ESPN', 'womens-basketball', false, { feedTitle: 'www.espn.com - NCW', imageHosts: ['a.espncdn.com'] }),
  source('ncaa-football', 'https://www.ncaa.com/news/football/fbs/rss.xml', 'NCAA.com', 'football', false, { feedTitle: 'NCAA.com > football fbs articles and video' }),
  source('ncaa-basketball', 'https://www.ncaa.com/news/basketball-men/d1/rss.xml', 'NCAA.com', 'basketball', false, { feedTitle: 'NCAA.com > basketball-men d1 articles and video' }),
  source('ncaa-womens-basketball', 'https://www.ncaa.com/news/basketball-women/d1/rss.xml', 'NCAA.com', 'womens-basketball', false, { feedTitle: 'NCAA.com > basketball-women d1 articles and video' }),
  source('ncaa-baseball', 'https://www.ncaa.com/news/baseball/d1/rss.xml', 'NCAA.com', 'baseball', false, { feedTitle: 'NCAA.com > baseball d1 articles and video' }),
  source('cbs-football', 'https://www.cbssports.com/rss/headlines/college-football/', 'CBS Sports', 'football', false, { feedTitle: 'CBS Sports Headlines', imageHosts: ['sportshub.cbsistatic.com'] }),
  source('cbs-basketball', 'https://www.cbssports.com/rss/headlines/college-basketball/', 'CBS Sports', 'basketball', false, { feedTitle: 'CBS Sports Headlines', imageHosts: ['sportshub.cbsistatic.com'] }),
  source('heartland', 'https://www.heartlandcollegesports.com/feed/', 'Heartland College Sports', null, false, { feedTitle: 'Heartland College Sports – An Independent Big 12 Today Blog | College Football News | Big 12 Today' }),
]);

/** Fixed, reviewed URLs. No browser/request parameter can create a fetch target. */
export function webNewsSources(school) {
  if (!SCHOOL_SLUGS.includes(school?.slug)) throw new Error('Unknown news school');
  const siSlug = SI_SLUGS[school.slug];
  const sources = [...NATIONAL,
    source(`si-${school.slug}`, `https://www.si.com/college/${siSlug}/feed`, 'Sports Illustrated', null, true,
      { feedTitle: `${school.name} ${SI_MASCOTS[school.slug]} On SI Feed`, articlePathPrefix: `/college/${siSlug}/`, imageHosts: ['images2.minutemediacdn.com', 'images.minutemediacdn.com'] }),
  ];
  const local = LOCAL[school.slug];
  if (local) sources.push(source(local[0], local[1], local[2], null, true, {
    feedTitle: school.slug === 'baylor' ? 'Sports - The Baylor Lariat' : school.slug === 'utah' ? 'Sports Archives – The Daily Utah Chronicle' : local[2],
  }));
  return sources;
}

function plain(value, maximum) {
  if (typeof value !== 'string' || value.length > 200_000) throw new Error('Feed field exceeds budget');
  const fragment = load(value);
  fragment('script,style,noscript,iframe').remove();
  return cleanText(fragment.root().text(), maximum);
}

function imageFromItem($, item, definition, fragments) {
  const candidates = [];
  for (const node of item.children().toArray()) {
    const element = $(node);
    if (['media:thumbnail', 'media:content'].includes(node.tagName) && (!element.attr('medium') || element.attr('medium') === 'image')) {
      candidates.push({ url: element.attr('url'), alt: element.attr('caption') || null });
    } else if (node.tagName === 'enclosure' && (!element.attr('type') || element.attr('type').startsWith('image/'))) {
      candidates.push({ url: element.attr('url') || element.text().trim(), alt: null });
    }
  }
  for (const html of fragments) {
    if (typeof html !== 'string' || html.length > 200_000) throw new Error('Feed HTML exceeds budget');
    const fragment = load(html);
    for (const element of fragment('img').toArray().slice(0, 3)) candidates.push({ url: fragment(element).attr('src'), alt: fragment(element).attr('alt') || null });
  }
  for (const candidate of candidates) {
    const url = safeUrl(candidate.url);
    if (url && definition.imageHosts.includes(new URL(url).hostname)) {
      return { imageUrl: url, imageAlt: candidate.alt ? plain(candidate.alt, 300) || null : null };
    }
  }
  return { imageUrl: null, imageAlt: null };
}

function publicationDate(raw) {
  if (!raw) return { publishedAt: null, publishedAtPrecision: 'unknown' };
  // Require a zone, rather than turning an ambiguous local time into an instant.
  const value = raw.trim();
  if (!/(?:Z|[+-]\d\d:?\d\d|\b(?:GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT))$/i.test(value)) return { publishedAt: null, publishedAtPrecision: 'unknown' };
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? { publishedAt: new Date(ms).toISOString(), publishedAtPrecision: 'instant' } : { publishedAt: null, publishedAtPrecision: 'unknown' };
}

/** Parse only a reviewed direct publisher RSS/Atom feed. Bodies remain transient. */
export function parseWebNews(text, requestedSource, school, sport, at) {
  if (!SPORTS.includes(sport) || !school?.sports?.includes(sport)) throw new Error('Unsupported news sport');
  const definition = webNewsSources(school).find(value => value.id === requestedSource?.id && value.url === requestedSource?.url);
  if (!definition || (definition.sport && definition.sport !== sport)) throw new Error('News source scope mismatch');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('Invalid news observation time');
  if (typeof text !== 'string' || !text.trim() || text.length > 2_000_000) throw new Error('Invalid feed document size');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML declarations are not allowed');
  const $ = load(text, { xmlMode: true });
  const roots = $.root().children();
  const rss = roots.length === 1 && roots.first().is('rss') && roots.attr('version') === '2.0';
  const atom = roots.length === 1 && roots.first().is('feed') && roots.attr('xmlns') === 'http://www.w3.org/2005/Atom';
  if (!rss && !atom) throw new Error('Unrecognized publisher feed');
  const container = rss ? roots.children('channel') : roots;
  if (container.length !== 1 || container.children('title').length !== 1) throw new Error('Publisher feed channel missing');
  if (plain(container.children('title').text(), 300) !== plain(definition.feedTitle, 300)) throw new Error('Publisher feed identity mismatch');
  const items = container.children(rss ? 'item' : 'entry');
  if (items.length > 200) throw new Error('Feed record budget exceeded');
  const records = new Map();
  for (const element of items.toArray()) {
    const item = $(element);
    const titles = item.children('title');
    const links = rss ? item.children('link') : item.children('link').filter((_, link) => $(link).attr('rel') === 'alternate');
    if (titles.length !== 1 || links.length !== 1) throw new Error('Ambiguous publisher headline or link');
    const title = plain(titles.text(), 300);
    const rawUrl = rss ? links.text().trim() : links.attr('href');
    const url = safeUrl(rawUrl);
    if (!title || !url) continue;
    const destination = new URL(url);
    if (!definition.articleHosts.includes(destination.hostname) || (definition.articlePathPrefix && !destination.pathname.startsWith(definition.articlePathPrefix))) continue;
    const descriptions = item.children().filter((_, node) => ['description', 'summary'].includes(node.tagName));
    const fragments = item.children().filter((_, node) => ['description', 'summary', 'content', 'content:encoded'].includes(node.tagName)).map((_, node) => $(node).text()).get();
    const categories = item.children('category').map((_, node) => $(node).attr('term') || $(node).text()).get().join(' ');
    // Category labels and bounded summaries provide evidence; never publish a
    // scraped article body or treat the feed's requested school as article text.
    const description = `${plain(descriptions.first().text(), 2000)} ${plain(categories, 500)}`.trim();
    const match = classifyNewsRelevance({ title, description, url,
      sourceSchool: definition.schoolScoped ? school.slug : null, sourceSport: definition.sport }, school, sport);
    if (!match.accepted) continue;
    const date = publicationDate(item.children(rss ? 'pubDate' : 'published').first().text());
    if (date.publishedAt && Date.parse(date.publishedAt) > Date.parse(at) + 86_400_000) continue;
    records.set(url, {
      id: stableId(school.slug, sport, url), title, url, ...date,
      ...imageFromItem($, item, definition, fragments), publisher: definition.publisher,
      discoverySourceUrl: definition.url,
    });
  }
  return { records: [...records.values()].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')),
    emptyConfirmed: true, reason: 'publisher-feed-filtered-school-and-sport' };
}
