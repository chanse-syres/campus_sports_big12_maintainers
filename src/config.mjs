import { readFile } from 'node:fs/promises';
import { safeUrl } from './normalize.mjs';

export const SPORTS = Object.freeze(['football', 'basketball', 'womens-basketball', 'baseball']);
export const SCHOOL_SLUGS = Object.freeze(['arizona', 'arizona-state', 'baylor', 'byu', 'cincinnati', 'colorado', 'houston', 'iowa-state', 'kansas', 'kansas-state', 'oklahoma-state', 'tcu', 'texas-tech', 'ucf', 'utah', 'west-virginia']);
export async function getSchool(slug) {
  if (!SCHOOL_SLUGS.includes(slug)) throw new Error('Unknown school');
  const school = JSON.parse(await readFile(new URL(`../teams/${slug}/config.json`, import.meta.url), 'utf8'));
  if (school.slug !== slug || !safeUrl(school.athleticsUrl) || !/^\d+$/.test(school.espnId)) throw new Error('Invalid school config');
  if (!Array.isArray(school.sports) || school.sports.some(s => !SPORTS.includes(s))) throw new Error('Invalid sports');
  const officialHost = new URL(school.athleticsUrl).hostname.replace(/^www\./, '');
  for (const sport of school.sports) {
    const source = school.news[sport];
    if (!safeUrl(source?.url) || new URL(source.url).hostname.replace(/^www\./, '') !== officialHost) throw new Error('News source must be on the official school host');
  }
  return school;
}
export async function listSchools() { return Promise.all(SCHOOL_SLUGS.map(getSchool)); }
export function sourceHosts(school) {
  return [...new Set(['site.api.espn.com', '247sports.com', 'www.espn.com', 'www.perfectgame.org', new URL(school.athleticsUrl).hostname, ...Object.values(school.news).map(s => new URL(s.url).hostname)])];
}
