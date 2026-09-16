import { cleanText, safeUrl, isoDate, uniqueById } from '../normalize.mjs';
import { SourceError } from '../network.mjs';

export const ESPN_PATHS = Object.freeze({ football: 'football/college-football', basketball: 'basketball/mens-college-basketball', 'womens-basketball': 'basketball/womens-college-basketball', baseball: 'baseball/college-baseball' });
const MAX_ROSTER_RECORDS = 300;
export const teamId = (school, sport) => sport === 'baseball' ? school.baseballEspnId : school.espnId;
export function espnUrl(school, sport, collection) {
  const id = teamId(school, sport);
  if (!/^\d+$/.test(id) || !['roster', 'schedule'].includes(collection) || !ESPN_PATHS[sport]) throw new Error('Invalid ESPN scope');
  const limit = sport === 'football' && collection === 'roster' ? `?limit=${MAX_ROSTER_RECORDS}` : '';
  return `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATHS[sport]}/teams/${id}/${collection}${limit}`;
}
function parse(text, expectedId) {
  const value = JSON.parse(text);
  if (String(value.team?.id) !== String(expectedId)) throw new Error('Source team mismatch');
  return value;
}
const externalLink = links => safeUrl(links?.find(l => l.rel?.includes('desktop') && l.href?.startsWith('https://www.espn.com/'))?.href);
const score = value => { const n = Number(value?.value ?? value); return value != null && value !== '' && Number.isFinite(n) && n >= 0 && n < 1000 ? n : null; };
export function parseSchedule(text, expectedId) {
  const data = parse(text, expectedId);
  if (!Array.isArray(data.events) || data.events.length > 400) throw new Error('Invalid schedule');
  const records = data.events.map(event => {
    const competition = event.competitions?.[0];
    const own = competition?.competitors?.find(c => String(c.team?.id) === String(expectedId));
    const other = competition?.competitors?.find(c => String(c.team?.id) !== String(expectedId));
    const id = cleanText(event.id, 80), date = isoDate(event.date), name = cleanText(event.name), opponent = cleanText(other?.team?.displayName);
    if (!own || !id || !date || !name || !opponent) throw new Error('Invalid event scope');
    return { id, date, name, status: cleanText(competition.status?.type?.description || event.status?.type?.description || 'Scheduled', 80), venue: cleanText(competition.venue?.fullName) || null, homeAway: competition.neutralSite ? 'neutral' : own.homeAway === 'home' ? 'home' : 'away', opponent, teamScore: score(own.score), opponentScore: score(other.score), url: externalLink(event.links) };
  });
  return { season: cleanText(data.season?.displayName || data.season?.year, 40) || null, records: uniqueById(records).sort((a, b) => a.date.localeCompare(b.date)) };
}
export function parseRoster(text, expectedId) {
  const data = parse(text, expectedId);
  if (!Array.isArray(data.athletes)) throw new Error('Invalid roster');
  const athletes = data.athletes.flatMap(group => Array.isArray(group.items) ? group.items : [group]);
  if (athletes.length > MAX_ROSTER_RECORDS) throw new Error('Roster too large');
  const records = athletes.map(player => {
    const id = cleanText(player.id, 80), name = cleanText(player.displayName || player.fullName, 160);
    if (!id || !name) throw new Error('Invalid athlete');
    return { id, name, position: cleanText(player.position?.abbreviation, 30) || null, jersey: cleanText(player.jersey, 10) || null, year: cleanText(player.experience?.displayValue, 40) || null, imageUrl: safeUrl(player.headshot?.href), url: externalLink(player.links) };
  });
  const uniqueRecords = uniqueById(records);
  assertCompleteRoster(data, uniqueRecords.length);
  for (const group of data.athletes) {
    if (Array.isArray(group.items)) assertCompleteRoster(group, new Set(group.items.map(player => cleanText(player.id, 80))).size);
  }
  return { season: cleanText(data.season?.displayName || data.season?.year, 40) || null, records: uniqueRecords };
}

function assertCompleteRoster(source, actualCount) {
  for (const field of ['count', 'total', 'totalCount']) {
    if (source[field] == null) continue;
    const total = typeof source[field] === 'number' ? source[field]
      : typeof source[field] === 'string' && /^\d+$/.test(source[field]) ? Number(source[field]) : NaN;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid roster total');
    if (total > actualCount) throw new SourceError('incomplete-roster');
  }
}
