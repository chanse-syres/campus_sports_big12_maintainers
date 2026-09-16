import Ajv from 'ajv';
import { snapshotSchema, manifestSchema } from './schema.mjs';
import { safeUrl } from './normalize.mjs';
import { SCHOOL_SLUGS, SPORTS } from './config.mjs';
const ajv = new Ajv({ allErrors: false, strict: true });
const validate = ajv.compile(snapshotSchema);
const validateIndex = ajv.compile(manifestSchema);
export function validateSnapshot(snapshot, expectedSlug) {
  if (!validate(snapshot)) throw new Error(`Invalid snapshot schema: ${validate.errors[0].instancePath} ${validate.errors[0].keyword}`);
  if (!SCHOOL_SLUGS.includes(snapshot.school.slug) || (expectedSlug && snapshot.school.slug !== expectedSlug)) throw new Error('Snapshot school mismatch');
  checkValues(snapshot);
  for (const sport of SPORTS) {
    const entry = snapshot.sports[sport];
    const sponsored = !(sport === 'baseball' && ['colorado', 'iowa-state'].includes(snapshot.school.slug));
    if (entry.sponsored !== sponsored) throw new Error('Sport sponsorship mismatch');
    for (const [kind, dataset] of Object.entries(entry)) {
      if (kind === 'sponsored') continue;
      if (!sponsored && dataset.status !== 'unsupported') throw new Error('Unsupported sport has data');
      if (sponsored && dataset.status === 'unsupported') throw new Error('Sponsored sport marked unsupported');
      if (['unsupported', 'unavailable'].includes(dataset.status) && (dataset.records.length || dataset.lastSuccessAt)) throw new Error('Unavailable data cannot claim success');
      if (['ok', 'empty', 'stale'].includes(dataset.status) && (!dataset.sourceUrl || !dataset.lastSuccessAt)) throw new Error('Successful data needs provenance');
      if (dataset.status === 'ok' && !dataset.records.length) throw new Error('Empty dataset marked ok');
      if (dataset.status === 'empty' && dataset.records.length) throw new Error('Empty dataset has records');
      if (Date.parse(dataset.lastAttemptAt) > Date.parse(snapshot.generatedAt) || (dataset.lastSuccessAt && Date.parse(dataset.lastSuccessAt) > Date.parse(dataset.lastAttemptAt))) throw new Error('Invalid freshness timestamps');
      if (new Set(dataset.records.map(r => r.id)).size !== dataset.records.length) throw new Error('Duplicate record IDs');
      for (const record of dataset.records) {
        if (kind === 'recruitingBoard' && (record.schoolId !== snapshot.school.slug || record.sport !== sport)) throw new Error('Recruiting record scope mismatch');
        if ('publishedAtPrecision' in record && ((record.publishedAt === null) !== (record.publishedAtPrecision === 'unknown'))) throw new Error('Publication precision mismatch');
      }
    }
  }
  return snapshot;
}
export function validateManifest(manifest) {
  if (!validateIndex(manifest)) throw new Error('Invalid manifest schema');
  if (new Set(manifest.teams.map(t => t.school)).size !== manifest.teams.length) throw new Error('Duplicate manifest school');
  for (const team of manifest.teams) if (!SCHOOL_SLUGS.includes(team.school) || team.path !== `teams/${team.school}.json`) throw new Error('Invalid manifest path');
  checkValues(manifest);
  return manifest;
}
function checkValues(value, key = '') {
  if (Array.isArray(value)) { for (const item of value) checkValues(item); return; }
  if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) checkValues(v, k); return; }
  if (typeof value !== 'string') return;
  if (/url$/i.test(key) && !safeUrl(value)) throw new Error('Unsafe output URL');
  if (/At$/.test(key) || key === 'date') {
    if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid timestamp');
  }
  if (/[<>\u0000-\u001f\u007f]/.test(value)) throw new Error('Unsafe text characters');
}
