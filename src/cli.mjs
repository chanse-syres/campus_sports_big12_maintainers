import { readFile, writeFile, rename, mkdir, open, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getSchool, SCHOOL_SLUGS } from './config.mjs';
import { maintainSchool } from './maintainer.mjs';
import { validateSnapshot, validateManifest } from './validate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function readPrevious(directory, slug) {
  if (!directory) return null;
  const target = path.join(directory, 'v1', 'teams', `${slug}.json`);
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('Invalid previous snapshot file');
    return validateSnapshot(JSON.parse(await readFile(target, 'utf8')), slug);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(target, text) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, text, { flag: 'wx' });
  await rename(temporary, target);
}
export async function runCli(args = process.argv.slice(2), fixedSchool) {
  let school = fixedSchool, all = false, previousDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all' && !fixedSchool) all = true;
    else if (args[i] === '--school' && !fixedSchool && !school) school = args[++i];
    else if (args[i] === '--previous' && !previousDir && args[i + 1]) previousDir = path.resolve(args[++i]);
    else if (args[i] === '--help') { console.log('node src/cli.mjs --all | --school <slug> [--previous <directory>]'); return; }
    else throw new Error('Invalid argument; use --help');
  }
  if ((all && school) || (!all && !school) || (school && !SCHOOL_SLUGS.includes(school))) throw new Error('Select --all or a valid --school');
  const selected = all ? SCHOOL_SLUGS : [school];
  const out = path.join(root, 'output');
  await mkdir(out, { recursive: true });
  const lockPath = path.join(out, '.maintainer.lock');
  const lock = await open(lockPath, 'wx');
  try {
    const generatedAt = new Date().toISOString(), entries = [];
    let cursor = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (cursor < selected.length) {
        const slug = selected[cursor++];
        const previous = await readPrevious(previousDir, slug);
        const snapshot = await maintainSchool(await getSchool(slug), { now: generatedAt, previous });
        const text = `${JSON.stringify(snapshot, null, 2)}\n`;
        await atomicWrite(path.join(out, 'v1', 'teams', `${slug}.json`), text);
        entries.push({ school: slug, path: `teams/${slug}.json`, sha256: createHash('sha256').update(text).digest('hex') });
        const counts = {};
        for (const sport of Object.values(snapshot.sports)) for (const [name, dataset] of Object.entries(sport)) if (name !== 'sponsored') counts[dataset.status] = (counts[dataset.status] || 0) + 1;
        console.log(JSON.stringify({ school: slug, collections: counts }));
      }
    }));
    const failed = workers.find(worker => worker.status === 'rejected');
    if (failed) throw failed.reason;
    const manifest = validateManifest({ schemaVersion: 1, conference: 'big12', generatedAt, teams: entries.sort((a, b) => a.school.localeCompare(b.school)) });
    await atomicWrite(path.join(out, 'v1', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ schools: selected.length, output: 'output/v1/manifest.json' }));
  } finally { await lock.close(); await unlink(lockPath); }
}
export async function runSchoolCli(slug) {
  try { await runCli(process.argv.slice(2), slug); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runCli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
