// Deterministic, deliberately conservative metadata classification. Professional
// alumni-only stories, betting and non-recruiting prep coverage are excluded from
// current college-program feeds. Ambiguous headlines can be omitted. These aliases
// describe school identity, not permission to fetch an arbitrary source URL.
const DEFINITIONS = {
  arizona: { queries: ['Arizona Wildcats', 'University of Arizona'], names: ['arizona', 'university of arizona'], unique: [], weak: ['wildcats'], exclude: ['arizona state', 'northern arizona', 'western arizona', 'arizona christian', 'arizona cardinals', 'arizona diamondbacks'] },
  'arizona-state': { queries: ['Arizona State', 'Sun Devils'], names: ['arizona state', 'arizona st', 'asu sun devils'], unique: ['sun devils'], weak: [], exclude: [] },
  baylor: { queries: ['Baylor Bears', 'Baylor University'], names: ['baylor'], unique: [], weak: ['bears'], exclude: ['baylor school', 'baylor high school'] },
  byu: { queries: ['BYU Cougars', 'Brigham Young'], names: ['byu', 'brigham young'], unique: [], weak: ['cougars'], exclude: ['byu idaho', 'byu hawaii', 'brigham young idaho', 'brigham young hawaii'] },
  cincinnati: { queries: ['Cincinnati Bearcats', 'UC Bearcats'], names: ['cincinnati', 'uc bearcats'], unique: [], weak: ['bearcats'], exclude: ['cincinnati bengals', 'cincinnati reds', 'fc cincinnati'] },
  colorado: { queries: ['Colorado Buffaloes', 'Colorado Buffs'], names: ['colorado', 'cu buffs', 'cu buffaloes'], unique: ['buffs'], weak: ['buffaloes'], exclude: ['colorado state', 'northern colorado', 'colorado mesa', 'colorado school of mines', 'colorado mines', 'colorado college', 'colorado rockies', 'colorado avalanche', 'colorado rapids'] },
  houston: { queries: ['Houston Cougars', 'University of Houston'], names: ['houston', 'university of houston'], unique: [], weak: ['cougars'], exclude: ['houston christian', 'houston baptist', 'sam houston', 'houston astros', 'houston rockets', 'houston texans', 'houston dynamo', 'houston dash'] },
  'iowa-state': { queries: ['Iowa State Cyclones', 'Iowa State'], names: ['iowa state', 'iowa st', 'isu cyclones'], unique: ['cyclones'], weak: [], exclude: [] },
  kansas: { queries: ['Kansas Jayhawks', 'University of Kansas'], names: ['kansas', 'university of kansas', 'ku jayhawks'], unique: ['jayhawks'], weak: [], exclude: ['kansas state', 'kansas st', 'kansas city', 'kansas wesleyan', 'kansas christian', 'kansas high school'] },
  'kansas-state': { queries: ['Kansas State Wildcats', 'K-State'], names: ['kansas state', 'kansas st', 'k state', 'kstate'], unique: [], weak: ['wildcats'], exclude: [] },
  'oklahoma-state': { queries: ['Oklahoma State Cowboys', 'Oklahoma State'], names: ['oklahoma state', 'oklahoma st', 'okla state', 'ok state', 'okstate'], unique: [], weak: ['cowboys', 'cowgirls'], exclude: [] },
  tcu: { queries: ['TCU Horned Frogs', 'Texas Christian'], names: ['tcu', 'texas christian'], unique: ['horned frogs'], weak: [], exclude: [] },
  'texas-tech': { queries: ['Texas Tech Red Raiders', 'Texas Tech'], names: ['texas tech', 'texastech'], unique: ['red raiders'], weak: [], exclude: [] },
  ucf: { queries: ['UCF Knights', 'Central Florida Knights'], names: ['ucf', 'central florida'], unique: [], weak: ['knights'], exclude: [] },
  utah: { queries: ['Utah Utes', 'University of Utah'], names: ['utah', 'university of utah'], unique: ['utes'], weak: [], exclude: ['utah state', 'southern utah', 'utah valley', 'utah tech', 'utah jazz', 'utah hockey', 'utah mammoth'] },
  'west-virginia': { queries: ['West Virginia Mountaineers', 'WVU'], names: ['west virginia', 'wvu'], unique: [], weak: ['mountaineers'], exclude: ['west virginia state', 'west virginia wesleyan'] },
};

const SPORTS = new Set(['football', 'basketball', 'womens-basketball', 'baseball']);
const OTHER_COLLEGES = [
  'oregon state', 'ohio state', 'oklahoma sooners', 'iowa hawkeyes', 'appalachian state',
  'app state', 'northwest missouri', 'kentucky wildcats', 'northwestern wildcats',
  'weber state', 'villanova', 'washington state', 'penn state', 'sam houston',
  'houston christian', 'houston baptist', 'colorado state', 'northern arizona',
  'northern colorado', 'utah state', 'utah valley', 'southern utah', 'utah tech',
  'alabama state', 'arkansas state', 'tennessee tech', 'west virginia state',
];
const OTHER_SPORT = /\b(?:softball|volleyball|soccer|lacrosse|hockey|wrestling|gymnastics|rowing|swimming|diving|tennis|golf|track(?: and)? field|track|cross country|beach volleyball|rugby|cricket|equestrian|acrobatics|tumbling|triathlon|fencing|skiing|sailing|water polo|flag football)\b/;
const BETTING = /\b(?:betting|sportsbook|sportsbooks|parlay|parlays|moneyline|point spread|over under|best bets|betting odds|picks and predictions|predictions and picks|promo code|bonus bets)\b/;
const PROFESSIONAL = /\b(?:nfl|nba|wnba|mlb|nhl|mls|nwsl|bengals|astros|rockets|texans|diamondbacks|kansas city chiefs|dallas cowboys|arizona cardinals|cincinnati reds|utah jazz|colorado rockies|colorado avalanche|houston dynamo|houston dash|fc cincinnati)\b/;
const RECRUITING = /\b(?:recruit(?:ing|s|ed)?|commit(?:ment|ments|s|ted)?|signing class|offers?|signs?|pledges?)\b/;
const PREP = /\b(?:high school|prep|youth|little league|junior varsity|varsity)\b/;
const WOMEN = /\b(?:women s|womens|women|wbb|wbkb|ncaaw|ladies|lady|girls)\b/;
const MEN = /\b(?:men s|mens|men|mbb|mbkb|ncaam|boys)\b/;
const FOOTBALL = /\b(?:football|quarterback|quarterbacks|gridiron|touchdown|touchdowns|offensive lineman|offensive linemen|offensive line|defensive lineman|defensive linemen|defensive line|linebacker|linebackers|wide receiver|wide receivers|running back|running backs|cornerback|cornerbacks|tight end|tight ends|ncaaf)\b/;
const BASKETBALL = /\b(?:basketball|hoops|hardwood|point guard|shooting guard|small forward|power forward|three pointer|three pointers|3 pointer|3 pointers|dunks?|triple double|wbb|wbkb|mbb|mbkb|ncaaw|ncaam)\b/;
const BASEBALL = /\b(?:baseball|pitcher|pitchers|pitching|dugout|bullpen|home run|home runs|shortstop|first baseman|second baseman|third baseman|college world series)\b/;

function normalize(value, max = 12_000) {
  return typeof value === 'string' ? value.slice(0, max)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:apos|#39|#x27|rsquo|lsquo);/gi, "'")
    .replace(/&[^;\s]{1,12};/g, ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function phrasePattern(phrase) {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'g');
}

function contains(text, phrase) { return phrasePattern(phrase).test(text); }
function withoutLookalikes(text, definition) {
  for (const phrase of [...definition.exclude].sort((a, b) => b.length - a.length)) text = text.replace(phrasePattern(phrase), ' ');
  return text;
}
function schoolEvidence(text, definition) {
  const scoped = withoutLookalikes(text, definition);
  return [...definition.names, ...definition.unique].find(alias => contains(scoped, alias)) ?? null;
}

function urlWords(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    // Query/search terms are not evidence that the linked article covers them.
    return normalize(decodeURIComponent(url.pathname));
  } catch { return ''; }
}

function detectedSports(text) {
  const sports = new Set();
  if (FOOTBALL.test(text)) sports.add('football');
  if (BASEBALL.test(text) && !/\bsoftball\b/.test(text)) sports.add('baseball');
  if (BASKETBALL.test(text)) {
    if (WOMEN.test(text)) sports.add('womens-basketball');
    if (MEN.test(text) || !WOMEN.test(text)) sports.add('basketball');
  }
  return sports;
}

function otherSchoolInTitle(title, slug) {
  return Object.entries(DEFINITIONS).some(([id, definition]) => id !== slug && schoolEvidence(title, definition)) ||
    OTHER_COLLEGES.some(alias => contains(title, alias));
}

export function schoolNewsQueryAliases(slug) {
  if (!Object.hasOwn(DEFINITIONS, slug)) throw new TypeError('Unknown Big 12 school slug');
  return Object.freeze([...DEFINITIONS[slug].queries]);
}

/**
 * item: { title, description?, url?, sourceSchool?, sourceSport? }.
 * sourceSchool/sourceSport are OPTIONAL TRUSTED CONFIGURATION from a reviewed
 * school/sport-specific feed, never values read from an RSS item or its query.
 * Explicit contradictory metadata overrides that configured context. Feed text
 * alone never establishes a recruit status or a fact beyond article relevance.
 */
export function classifyNewsRelevance(item, school, sport) {
  const slug = typeof school === 'string' ? school : school?.slug;
  if (!Object.hasOwn(DEFINITIONS, slug) || !SPORTS.has(sport)) throw new TypeError('Unknown school or sport');
  const result = (accepted, reason, schoolMatch = null, sportMatch = null) => ({
    accepted, reason, schoolEvidence: schoolMatch, sportEvidence: sportMatch,
  });
  if (sport === 'baseball' && ['colorado', 'iowa-state'].includes(slug)) return result(false, 'unsupported-program');
  if (!item || typeof item.title !== 'string' || !item.title.trim()) return result(false, 'missing-title');
  if (item.sourceSchool != null && item.sourceSchool !== slug) return result(false, 'configured-school-mismatch');
  if (item.sourceSport != null && item.sourceSport !== sport) return result(false, 'configured-sport-mismatch');
  const title = normalize(item.title);
  const description = normalize(item.description);
  const text = `${title} ${description}`;
  const path = urlWords(item.url);
  if (BETTING.test(text) || (/\bodds\b/.test(text) &&
    !/\b(?:against|overcome|overcomes|overcoming|beat|beats|beating|defy|defies|defying) (?:the |all )?odds\b/.test(text))) return result(false, 'betting-content');
  if (PROFESSIONAL.test(text) && !/\brecruit(?:ing|s|ed)?\b/.test(title)) return result(false, 'professional-sports-content');
  if (PREP.test(text) && !RECRUITING.test(text)) return result(false, 'school-or-youth-sports-content');

  const definition = DEFINITIONS[slug];
  const titleMatch = schoolEvidence(title, definition);
  const textMatch = titleMatch ?? schoolEvidence(description, definition);
  const weakInTitle = definition.weak.some(alias => contains(title, alias));
  const scopedMatchup = weakInTitle && item.sourceSchool === slug &&
    /\b(?:vs|versus|hosts?|visits?|at|against|defeat(?:s|ed)?|beat(?:s)?|face(?:s)?|play(?:s)?)\b/.test(title);
  if (!titleMatch && otherSchoolInTitle(title, slug) && !scopedMatchup) return result(false, 'different-school-in-title');
  const schoolMatch = textMatch ?? schoolEvidence(path, definition) ??
    (item.sourceSchool === slug ? `configured:${slug}` : null);
  if (!schoolMatch) return result(false, 'school-not-established');

  // An explicit sport in the title outranks incidental body/feed metadata.
  const titleSports = detectedSports(title);
  const allSports = detectedSports(text);
  const candidates = new Set(titleSports.size ? titleSports : allSports);
  const womenOverride = candidates.has('basketball') && !MEN.test(title) &&
    (WOMEN.test(text) || (item.sourceSport === 'womens-basketball' && !MEN.test(text)));
  if (womenOverride) { candidates.delete('basketball'); candidates.add('womens-basketball'); }
  if (OTHER_SPORT.test(title)) return result(false, 'different-sport-in-title', schoolMatch);
  if (!titleSports.size && OTHER_SPORT.test(text)) return result(false, 'other-sport-content', schoolMatch);
  // Women's context always wins over an unqualified basketball default.
  if (sport === 'basketball' && WOMEN.test(text) && !MEN.test(title)) return result(false, 'womens-basketball-content', schoolMatch);
  if (sport === 'womens-basketball' && MEN.test(title) && !WOMEN.test(title)) return result(false, 'mens-basketball-content', schoolMatch);
  if (candidates.size) {
    if (!candidates.has(sport)) return result(false, 'different-sport', schoolMatch);
    return result(true, 'matched', schoolMatch, womenOverride
      ? `${WOMEN.test(text) ? 'metadata' : 'configured'}:${sport}`
      : titleSports.size ? `title:${sport}` : `metadata:${sport}`);
  }
  if (item.sourceSport === sport) {
    if (sport === 'basketball' && WOMEN.test(text)) return result(false, 'womens-basketball-content', schoolMatch);
    if (sport === 'womens-basketball' && MEN.test(text) && !WOMEN.test(text)) return result(false, 'mens-basketball-content', schoolMatch);
    return result(true, 'matched', schoolMatch, `configured:${sport}`);
  }
  const pathSports = detectedSports(path);
  if (pathSports.has(sport) && !OTHER_SPORT.test(text)) return result(true, 'matched', schoolMatch, `url:${sport}`);
  return result(false, 'sport-not-established', schoolMatch);
}
