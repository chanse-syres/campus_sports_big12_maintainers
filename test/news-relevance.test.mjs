import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNewsRelevance, schoolNewsQueryAliases } from '../src/news-relevance.mjs';

function matches(title, school, sport, extra = {}) {
  return classifyNewsRelevance({ title, ...extra }, school, sport);
}

const schools = [
  ['arizona', 'Arizona'], ['arizona-state', 'Arizona State'], ['baylor', 'Baylor'],
  ['byu', 'BYU'], ['cincinnati', 'Cincinnati'], ['colorado', 'Colorado'],
  ['houston', 'Houston'], ['iowa-state', 'Iowa State'], ['kansas', 'Kansas'],
  ['kansas-state', 'Kansas State'], ['oklahoma-state', 'Oklahoma State'],
  ['tcu', 'TCU'], ['texas-tech', 'Texas Tech'], ['ucf', 'UCF'],
  ['utah', 'Utah'], ['west-virginia', 'West Virginia'],
];

test('recognizes independently named coverage for all 62 sponsored school-sport programs', () => {
  for (const [slug, label] of schools) {
    for (const [sport, headlineSport] of [
      ['football', 'football'], ['basketball', "men's basketball"],
      ['womens-basketball', "women's basketball"], ['baseball', 'baseball'],
    ]) {
      if (sport === 'baseball' && ['colorado', 'iowa-state'].includes(slug)) continue;
      const result = matches(`${label} ${headlineSport} announces its schedule`, slug, sport);
      assert.equal(result.accepted, true, `${slug}/${sport}: ${result.reason}`);
      assert.ok(result.schoolEvidence);
      assert.ok(result.sportEvidence);
    }
  }
});

test('rejects lookalike schools and geographic/professional names', () => {
  const cases = [
    ['Arizona State football announces its staff', 'arizona'],
    ['Northern Arizona football reaches playoffs', 'arizona'],
    ['Kansas State football wins opener', 'kansas'],
    ['Kansas City football facility opens', 'kansas'],
    ['Iowa football announces a quarterback', 'iowa-state'],
    ['Oklahoma football wins opener', 'oklahoma-state'],
    ['Oregon State football announces an OSU signing', 'oklahoma-state'],
    ['Ohio State football updates its roster', 'oklahoma-state'],
    ['Colorado State football coach extends contract', 'colorado'],
    ['Utah State football hires a coordinator', 'utah'],
    ['Sam Houston football holds practice', 'houston'],
    ['Houston Christian football sets record', 'houston'],
    ['App State Mountaineers football advances', 'west-virginia'],
    ['West Virginia State football announces signings', 'west-virginia'],
    ['BYU Idaho football club starts season', 'byu'],
  ];
  for (const [title, slug] of cases) assert.equal(matches(title, slug, 'football').accepted, false, `${slug}: ${title}`);
});

test('ambiguous abbreviations and shared mascots cannot establish school identity', () => {
  for (const [title, slug] of [
    ['OSU football reloads', 'oklahoma-state'], ['UH football updates its staff', 'houston'],
    ['ISU football prepares for opener', 'iowa-state'], ['ASU football adds staff', 'arizona-state'],
    ['TTU football opens camp', 'texas-tech'], ['Wildcats football opens camp', 'arizona'],
    ['Wildcats football opens camp', 'kansas-state'], ['Cougars football opens camp', 'houston'],
    ['Cougars football opens camp', 'byu'], ['Bears football opens camp', 'baylor'],
    ['Cowboys football opens camp', 'oklahoma-state'], ['Knights football opens camp', 'ucf'],
    ['Mountaineers football opens camp', 'west-virginia'], ['Bearcats football opens camp', 'cincinnati'],
  ]) assert.equal(matches(title, slug, 'football').accepted, false, title);
});

test('accepts local coverage using distinctive names and sport-specific vocabulary', () => {
  for (const [title, slug, sport] of [
    ['Sun Devils quarterback makes his case', 'arizona-state', 'football'],
    ['Cyclones defensive line impresses in practice', 'iowa-state', 'football'],
    ['Jayhawks add depth at tight end', 'kansas', 'football'],
    ['Horned Frogs bolster the bullpen', 'tcu', 'baseball'],
    ['Red Raiders announce hoops schedule', 'texas-tech', 'basketball'],
    ['Utes welcome a new point guard', 'utah', 'basketball'],
    ['K-State basketball finds its rhythm', 'kansas-state', 'basketball'],
    ['Baylor offers high school quarterback', 'baylor', 'football'],
    ['Houston football recruits local high school standout', 'houston', 'football'],
    ['Baylor football walk-on overcomes the odds', 'baylor', 'football'],
    ['Kansas basketball picks up a commitment', 'kansas', 'basketball'],
    ["Baylor basketball recruits NBA legend's son", 'baylor', 'basketball'],
  ]) assert.equal(matches(title, slug, sport).accepted, true, title);
});

test('women take precedence over broad basketball while explicitly shared coverage reaches both', () => {
  for (const title of [
    "Arizona women's basketball adds guard", 'Arizona women’s hoops adds guard',
    'Arizona WBB adds guard', 'Arizona women&#39;s basketball adds guard',
  ]) {
    assert.equal(matches(title, 'arizona', 'womens-basketball').accepted, true, title);
    assert.equal(matches(title, 'arizona', 'basketball').accepted, false, title);
  }
  assert.equal(matches('Arizona basketball announces schedule', 'arizona', 'basketball').accepted, true);
  assert.equal(matches('Arizona basketball announces schedule', 'arizona', 'womens-basketball').accepted, false);
  assert.equal(matches("Arizona men's and women's basketball announce schedules", 'arizona', 'basketball').accepted, true);
  assert.equal(matches("Arizona men's and women's basketball announce schedules", 'arizona', 'womens-basketball').accepted, true);
  assert.equal(matches('Arizona basketball adds a coach', 'arizona', 'basketball', {
    description: "The women's team announced the appointment.",
  }).accepted, false);
  assert.equal(matches('Arizona basketball adds a coach', 'arizona', 'womens-basketball', {
    description: "The women's team announced the appointment.",
  }).accepted, true);
});

test('other sports, professional teams, youth-only coverage and betting do not enter feeds', () => {
  for (const [title, slug, sport] of [
    ['Arizona softball pitcher wins award', 'arizona', 'baseball'],
    ['TCU volleyball reaches Final Four', 'tcu', 'basketball'],
    ['Utah gymnastics announces schedule', 'utah', 'basketball'],
    ['Utah track & field announces schedule', 'utah', 'basketball'],
    ['Baylor acrobatics and tumbling wins title', 'baylor', 'basketball'],
    ['Arizona flag football tournament returns', 'arizona', 'football'],
    ['Baylor soccer scores late winner', 'baylor', 'football'],
    ['Houston Rockets basketball wins again', 'houston', 'basketball'],
    ['Dallas Cowboys football updates its depth chart', 'oklahoma-state', 'football'],
    ['Cincinnati Bengals football wins opener', 'cincinnati', 'football'],
    ['Arizona basketball alum signs NBA deal', 'arizona', 'basketball'],
    ['Kansas City Chiefs football predictions', 'kansas', 'football'],
    ['Houston high school football scores', 'houston', 'football'],
    ['Central Florida youth football registration opens', 'ucf', 'football'],
    ['Baylor football odds and best bets', 'baylor', 'football'],
    ['Arizona basketball picks and predictions', 'arizona', 'basketball'],
    ['BYU football sportsbook bonus bets', 'byu', 'football'],
    ['TCU baseball moneyline preview', 'tcu', 'baseball'],
  ]) assert.equal(matches(title, slug, sport).accepted, false, title);
});

test('trusted source context fills missing evidence but cannot override contradictory headlines', () => {
  const scoped = { sourceSchool: 'kansas-state', sourceSport: 'basketball' };
  assert.equal(matches('Wildcats announce schedule', 'kansas-state', 'basketball', scoped).accepted, true);
  assert.equal(matches('Wildcats basketball hosts Arizona', 'kansas-state', 'basketball', scoped).accepted, true);
  assert.equal(matches('Arizona Wildcats basketball announces schedule', 'kansas-state', 'basketball', scoped).accepted, false);
  assert.equal(matches("Wildcats women's basketball announces schedule", 'kansas-state', 'basketball', scoped).accepted, false);
  assert.equal(matches('Wildcats volleyball announces schedule', 'kansas-state', 'basketball', scoped).accepted, false);
  assert.equal(matches('Wildcats announce schedule', 'arizona', 'basketball', scoped).accepted, false);
  assert.equal(matches('Kansas State baseball announces schedule', 'kansas-state', 'baseball', scoped).accepted, false);
  assert.equal(matches('Utah basketball announces schedule', 'utah', 'womens-basketball', {
    sourceSport: 'womens-basketball',
  }).accepted, true);
  assert.equal(matches("Utah men's basketball announces schedule", 'utah', 'womens-basketball', {
    sourceSport: 'womens-basketball',
  }).accepted, false);
});

test('real matchup names are retained for both schools, rather than substring matching one opponent', () => {
  const title = 'Kansas football hosts Kansas State in conference showdown';
  assert.equal(matches(title, 'kansas', 'football').accepted, true);
  assert.equal(matches(title, 'kansas-state', 'football').accepted, true);
});

test('description and URL metadata can establish relevance but search query terms cannot', () => {
  assert.equal(matches('A new season begins', 'baylor', 'football', {
    description: '<p>Baylor football returns to the practice field.</p>',
  }).accepted, true);
  assert.equal(matches('Quarterback earns starting job', 'arizona-state', 'football', {
    url: 'https://sports.example.com/college/arizona-state/football/starter/',
  }).accepted, true);
  assert.equal(matches('Economy adds jobs', 'arizona-state', 'football', {
    url: 'https://sports.example.com/search?q=Arizona+State+football',
  }).accepted, false);
  assert.equal(matches('Kansas State football prepares', 'kansas', 'football', {
    url: 'https://sports.example.com/college/kansas/football/',
  }).accepted, false);
  assert.equal(matches('Economy adds jobs', 'baylor', 'football', {
    description: '<script>Baylor football</script>',
  }).accepted, false);
});

test('unsupported programs, missing titles and invalid scopes cannot produce accepted articles', () => {
  assert.equal(matches('Colorado baseball wins opener', 'colorado', 'baseball').accepted, false);
  assert.equal(matches('Iowa State baseball wins opener', 'iowa-state', 'baseball').accepted, false);
  assert.equal(matches('', 'baylor', 'football').accepted, false);
  assert.equal(matches('Baylor university budget increases', 'baylor', 'football').accepted, false);
  assert.throws(() => matches('Baylor football', 'constructor', 'football'), /Unknown school or sport/);
  assert.throws(() => matches('Baylor football', 'baylor', 'soccer'), /Unknown school or sport/);
});

test('collector query aliases are explicit, immutable, and exclude ambiguous bare abbreviations', () => {
  for (const [slug] of schools) {
    const aliases = schoolNewsQueryAliases(slug);
    assert.ok(aliases.length > 0);
    assert.equal(Object.isFrozen(aliases), true);
    assert.equal(aliases.some(alias => /^(?:OSU|UH|ASU|ISU|TTU|Wildcats|Cougars|Bears|Cowboys)$/i.test(alias)), false);
  }
  assert.throws(() => schoolNewsQueryAliases('../arizona'), /Unknown Big 12/);
});
