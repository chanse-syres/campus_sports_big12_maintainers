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
