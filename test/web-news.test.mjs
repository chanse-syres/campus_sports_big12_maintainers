import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchool, SCHOOL_SLUGS } from '../src/config.mjs';
import { parseWebNews, webNewsSources } from '../src/adapters/web-news.mjs';

const school = await getSchool('arizona');
const at = '2026-09-16T08:00:00.000Z';
const si = webNewsSources(school).find(value => value.id === 'si-arizona');
const local = webNewsSources(school).find(value => value.id === 'az-desert-swarm');
const rss = entries => `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Arizona Wildcats On SI Feed</title>${entries}</channel></rss>`;
const entry = ({ title = 'Arizona football prepares for conference opener', description = 'The Arizona Wildcats football team prepares for its next game.', url = 'https://www.si.com/college/arizona/football/conference-opener?utm_source=RSS', date = 'Tue, 15 Sep 2026 22:19:02 +0000', image = 'https://images2.minutemediacdn.com/arizona.jpg' } = {}) => `<item><title><![CDATA[${title}]]></title><link>${url.replaceAll('&', '&amp;')}</link><description><![CDATA[${description}]]></description><pubDate>${date}</pubDate><media:thumbnail url="${image.replaceAll('&', '&amp;')}" caption="Arizona football practice"/></item>`;
const parse = (text, sport = 'football', source = si) => parseWebNews(text, source, school, sport, at);

test('direct publisher feed headlines retain their source links, dates, supplied photos and attribution', () => {
  const record = parse(rss(entry())).records[0];
  assert.equal(record.title, 'Arizona football prepares for conference opener');
  assert.equal(record.url, 'https://www.si.com/college/arizona/football/conference-opener?utm_source=RSS');
  assert.equal(record.publisher, 'Sports Illustrated');
  assert.equal(record.discoverySourceUrl, si.url);
  assert.equal(record.publishedAt, '2026-09-15T22:19:02.000Z');
  assert.equal(record.publishedAtPrecision, 'instant');
  assert.equal(record.imageUrl, 'https://images2.minutemediacdn.com/arizona.jpg');
  assert.equal(record.imageAlt, 'Arizona football practice');
  assert.equal(Object.hasOwn(record, 'description'), false);
  assert.equal(Object.hasOwn(record, 'content'), false);
});

test('school and sport evidence routes womens basketball and excludes wrong-school, pro and betting stories', () => {
  const html = rss([
    entry({ title: "Arizona women's basketball announces new schedule", description: "The Wildcats women's basketball team revealed its schedule.", url: 'https://www.si.com/college/arizona/womens-basketball/schedule' }),
    entry({ title: 'Arizona State football opens season', url: 'https://www.si.com/college/arizonastate/football/opener' }),
    entry({ title: 'Arizona Cardinals football trade update' }),
    entry({ title: 'Arizona football betting odds and promo code' }),
  ].join(''));
  assert.equal(parse(html, 'football').records.length, 0);
  assert.equal(parse(html, 'basketball').records.length, 0);
  assert.equal(parse(html, 'womens-basketball').records.length, 1);
});

test('Atom published dates are preserved and article bodies are used only for supplied image metadata', () => {
  const html = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Arizona Desert Swarm</title><entry>
    <title type="html">Arizona football&#8217;s fall preview</title>
    <link rel="alternate" href="https://www.azdesertswarm.com/football/fall-preview"/>
    <published>2026-09-15T11:00:00-04:00</published><updated>2026-09-16T11:00:00-04:00</updated>
    <summary type="html">Arizona Wildcats football preview.</summary>
    <content type="html"><![CDATA[<p>This body must not be published.</p><img src="https://platform.azdesertswarm.com/photo.jpg" alt="Practice"/>]]></content>
  </entry></feed>`;
  const record = parse(html, 'football', local).records[0];
  assert.equal(record.title, 'Arizona football’s fall preview');
  assert.equal(record.publishedAt, '2026-09-15T15:00:00.000Z');
  assert.equal(record.imageUrl, 'https://platform.azdesertswarm.com/photo.jpg');
  assert.equal(record.imageAlt, 'Practice');
  assert.equal(JSON.stringify(record).includes('This body must not be published'), false);
  const undated = parse(html.replace('<published>2026-09-15T11:00:00-04:00</published>', ''), 'football', local).records[0];
  assert.equal(undated.publishedAt, null);
  assert.equal(undated.publishedAtPrecision, 'unknown');
});

test('missing and ambiguous dates remain unknown and implausible future items are excluded', () => {
  for (const date of ['', 'not a date', '2026-09-15T12:00:00']) {
    const record = parse(rss(entry({ date }))).records[0];
    assert.equal(record.publishedAt, null);
    assert.equal(record.publishedAtPrecision, 'unknown');
  }
  assert.equal(parse(rss(entry({ date: 'Tue, 15 Sep 2030 22:19:02 +0000' }))).records.length, 0);
});

test('only reviewed article/image hosts are accepted and source objects cannot expand their permissions', () => {
  assert.equal(parse(rss(entry({ url: 'https://attacker.example/arizona/football' }))).records.length, 0);
  assert.equal(parse(rss(entry({ url: 'https://www.si.com/college/arizona/football/a?token=private' }))).records.length, 0);
  assert.equal(parse(rss(entry({ image: 'https://attacker.example/photo.jpg' }))).records[0].imageUrl, null);
  assert.equal(parse(rss(entry({ image: 'https://images2.minutemediacdn.com/photo.jpg?signature=private' }))).records[0].imageUrl, null);
  assert.equal(parse(rss(entry({ image: 'https://attacker.example/photo.jpg' })), 'football', { ...si, imageHosts: ['attacker.example'] }).records[0].imageUrl, null);
  assert.throws(() => parse(rss(entry()), 'football', { ...si, url: 'https://attacker.example/feed' }), /scope/);
});

test('feed sanitization removes embedded HTML while rejecting entity and document declarations', () => {
  const record = parse(rss(entry({ title: '<b>Arizona football</b><script>steal()</script> updates', description: '<script>bad()</script> Wildcats football.' }))).records[0];
  assert.equal(record.title, 'Arizona football updates');
  for (const prefix of ['<!DOCTYPE rss SYSTEM "file:///secret">', '<!ENTITY secret SYSTEM "https://attacker.example/">']) assert.throws(() => parse(prefix + rss(entry())), /declarations/);
});

test('malformed structures, duplicate identity fields and resource budgets fail closed', () => {
  for (const html of [
    '<html><title>Server error</title></html>',
    '<rss version="2.0"><channel></channel></rss>',
    rss(entry()).replace('Arizona Wildcats On SI Feed', 'Another publisher feed'),
    rss(entry().replace('<title>', '<title>Duplicate</title><title>')),
    rss(entry().replace('<link>', '<link>https://www.si.com/duplicate</link><link>')),
    rss(entry().repeat(201)),
    'x'.repeat(2_000_001),
  ]) assert.throws(() => parse(html));
});

test('feed duplicate links collapse and scoped source selection covers every sponsored program', async () => {
  assert.equal(parse(rss(entry() + entry())).records.length, 1);
  assert.deepEqual(parse(rss('')).records, []);
  assert.throws(() => webNewsSources({ slug: 'unknown' }));
  let scopes = 0;
  for (const slug of SCHOOL_SLUGS) {
    const configuration = await getSchool(slug);
    const sources = webNewsSources(configuration);
    assert.ok(sources.length <= 20);
    assert.equal(new Set(sources.map(value => value.id)).size, sources.length);
    assert.ok(sources.some(value => value.schoolScoped));
    for (const sport of configuration.sports) {
      scopes++;
      assert.ok(sources.some(value => value.sport === sport || value.sport === null));
    }
  }
  assert.equal(scopes, 62);
});

test('every accepted story inside the reviewed feed budget reaches the archive merger', () => {
  const html = rss(Array.from({ length: 150 }, (_, index) => entry({ url: `https://www.si.com/college/arizona/football/story-${index}` })).join(''));
  assert.equal(parse(html).records.length, 150);
});

const espn = webNewsSources(school).find(value => value.id === 'espn-football');
const espnArticle = (overrides = {}) => ({
  headline: 'Arizona football prepares for conference opener',
  description: 'The Arizona Wildcats football team prepares for its next game.',
  published: '2026-09-15T22:19:02Z',
  categories: [{ type: 'league', leagueId: 23, league: { id: 23 } }],
  links: { web: { href: 'https://www.espn.com/college-football/story/_/id/123/arizona-preview' } },
  images: [{ url: 'https://a.espncdn.com/photo/arizona.jpg', caption: 'Arizona football practice' }],
  ...overrides,
});
const espnFeed = (articles, definition = espn, overrides = {}) => JSON.stringify({
  header: definition.feedTitle, link: { href: definition.leagueIndexUrl }, articles, ...overrides,
});

test('ESPN public JSON feed preserves attributed metadata and never publishes descriptions or bodies', () => {
  const record = parse(espnFeed([espnArticle({ body: '<p>Do not republish this body.</p>' })]), 'football', espn).records[0];
  assert.equal(record.title, 'Arizona football prepares for conference opener');
  assert.equal(record.publisher, 'ESPN');
  assert.equal(record.discoverySourceUrl, espn.url);
  assert.equal(record.publishedAt, '2026-09-15T22:19:02.000Z');
  assert.equal(record.imageUrl, 'https://a.espncdn.com/photo/arizona.jpg');
  assert.equal(record.imageAlt, 'Arizona football practice');
  assert.deepEqual(Object.keys(record).sort(), ['discoverySourceUrl', 'id', 'imageAlt', 'imageUrl', 'publishedAt', 'publishedAtPrecision', 'publisher', 'title', 'url']);
  assert.deepEqual(parse(espnFeed([]), 'football', espn), {
    records: [], emptyConfirmed: true, reason: 'publisher-feed-filtered-school-and-sport',
  });
  const duplicates = parse(espnFeed([espnArticle(), espnArticle()]), 'football', espn);
  assert.equal(duplicates.records.length, 1);
});

test('ESPN JSON identity and league evidence are fixed for each configured sport', () => {
  for (const sport of ['football', 'basketball', 'womens-basketball']) {
    const definition = webNewsSources(school).find(value => value.id === `espn-${sport}`);
    const title = sport === 'football' ? 'Arizona football prepares for opener' :
      sport === 'basketball' ? "Arizona men's basketball prepares for opener" : "Arizona women's basketball prepares for opener";
    const record = espnArticle({ headline: title, description: title,
      categories: [{ type: 'league', leagueId: definition.leagueId, league: { id: definition.leagueId } }],
      links: { web: { href: `${definition.leagueIndexUrl}story/_/id/123/arizona-preview` } } });
    assert.equal(parse(espnFeed([record], definition), sport, definition).records.length, 1);
    assert.throws(() => parse(espnFeed([record], definition, { header: 'Wrong News' }), sport, definition), /identity/);
    assert.throws(() => parse(espnFeed([record], definition, { link: { href: `${definition.leagueIndexUrl}?unreviewed=1` } }), sport, definition), /identity/);
    assert.equal(parse(espnFeed([{ ...record, categories: [{ type: 'league', leagueId: 46, league: { id: 46 } }] }], definition), sport, definition).records.length, 0);
  }
  assert.throws(() => parse(espnFeed([]), 'basketball', espn), /scope/);
  assert.throws(() => parse(espnFeed([]), 'football', { ...espn, url: `${espn.url}&teams=12` }), /scope/);
});

test('ESPN descriptions support classification without trusting unrelated team tags or sport context', () => {
  const womens = webNewsSources(school).find(value => value.id === 'espn-womens-basketball');
  const womenRecord = espnArticle({ headline: 'Arizona announces new schedule', description: "The Arizona women's basketball team has a new schedule.",
    categories: [{ type: 'league', leagueId: 54, league: { id: 54 } }] });
  assert.equal(parse(espnFeed([womenRecord], womens), 'womens-basketball', womens).records.length, 1);
  const rejected = [
    espnArticle({ headline: 'Arizona State football preview', description: 'The Sun Devils open their season.' }),
    espnArticle({ headline: 'Arizona Cardinals football preview', description: 'Arizona Cardinals announce their NFL lineup.' }),
    espnArticle({ headline: 'Arizona basketball schedule', description: 'The Wildcats basketball team releases its schedule.' }),
    espnArticle({ headline: 'Arizona football betting odds', description: 'Arizona football odds.' }),
    espnArticle({ headline: 'Conference schedules released', description: 'The complete league schedule.',
      links: { web: { href: 'https://www.espn.com/college-football/story/_/id/123/conference-schedules' } }, categories: [
      { type: 'league', leagueId: 23, league: { id: 23 } }, { type: 'team', description: 'Arizona Wildcats', teamId: 12 },
    ] }),
  ];
  assert.equal(parse(espnFeed(rejected), 'football', espn).records.length, 0);
  assert.equal(parse(espnFeed([espnArticle({ categories: [{ type: 'league', leagueId: 54, league: { id: 54 } }] })], womens), 'womens-basketball', womens).records.length, 0);
});

test('ESPN JSON strips markup and rejects hostile article and image destinations', () => {
  const record = espnArticle({ headline: '<b>Arizona football</b><script>steal()</script> updates',
    description: '<script>malicious()</script> Arizona Wildcats football.',
    images: [{ url: 'https://espnmedia-cdn.akamaized.net/espn/arizona.jpg', alt: '<b>Practice</b><script>steal()</script>' }],
    __proto__: { leaked: 'must not copy inherited fields' },
  });
  const result = parse(espnFeed([record]), 'football', espn).records[0];
  assert.equal(result.title, 'Arizona football updates');
  assert.equal(result.imageAlt, 'Practice');
  assert.equal(Object.hasOwn(result, 'leaked'), false);
  for (const href of ['https://www.espn.com.attacker.example/college-football/arizona', 'https://attacker.example/www.espn.com/arizona', 'https://www.espn.com/arizona?token=secret', 'javascript:alert(1)']) {
    assert.equal(parse(espnFeed([espnArticle({ links: { web: { href } } })]), 'football', espn).records.length, 0);
  }
  for (const url of ['https://a.espncdn.com.attacker.example/photo.jpg', 'https://a.espncdn.com/photo.jpg?signature=private', 'https://127.0.0.1/photo.jpg']) {
    const result = parse(espnFeed([espnArticle({ images: [{ url }] })]), 'football', { ...espn, imageHosts: ['127.0.0.1', 'a.espncdn.com.attacker.example'] }).records[0];
    assert.equal(result.imageUrl, null);
  }
});

test('ESPN JSON malformed shapes and record, nested array and scalar budgets fail closed', () => {
  for (const text of ['not JSON', 'null', '[]', '{}', espnFeed({}), espnFeed(Array.from({ length: 201 }, () => espnArticle()))]) {
    assert.throws(() => parse(text, 'football', espn));
  }
  for (const record of [
    null, [], espnArticle({ headline: {} }), espnArticle({ headline: 'x'.repeat(200_001) }),
    espnArticle({ description: 'x'.repeat(200_001) }), espnArticle({ published: [] }),
    espnArticle({ links: { web: { href: 'x'.repeat(2049) } } }),
    espnArticle({ categories: {} }), espnArticle({ categories: [null] }),
    espnArticle({ categories: Array.from({ length: 201 }, () => ({ type: 'topic' })) }),
    espnArticle({ categories: [{ type: 'league', leagueId: 23, league: { id: 54 } }] }),
    espnArticle({ images: Array.from({ length: 21 }, () => ({ url: 'https://a.espncdn.com/a.jpg' })) }),
    espnArticle({ images: [{ url: 'https://a.espncdn.com/a.jpg', caption: {} }] }),
  ]) assert.throws(() => parse(espnFeed([record]), 'football', espn));
});

test('catalog has exactly 33 RSS/Atom sources and three reviewed ESPN JSON feeds', async () => {
  const sources = new Map();
  for (const slug of SCHOOL_SLUGS) for (const definition of webNewsSources(await getSchool(slug))) sources.set(definition.url, definition);
  assert.equal(sources.size, 36);
  assert.equal([...sources.values()].filter(definition => definition.format === 'espn-json').length, 3);
  assert.equal([...sources.values()].filter(definition => !definition.format).length, 33);
  assert.ok([...sources.values()].filter(definition => definition.format === 'espn-json').every(definition => new URL(definition.url).hostname === 'site.api.espn.com'));
});
