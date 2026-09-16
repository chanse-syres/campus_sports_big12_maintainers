import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSnapshot, validateManifest } from '../src/validate.mjs';
const root = path.resolve(process.argv[2] || 'output');
const manifest = validateManifest(JSON.parse(await readFile(path.join(root, 'v2/manifest.json'), 'utf8')));
for (const entry of manifest.teams) {
  const file = path.join(root, 'v2', entry.path);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Invalid snapshot file');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Snapshot checksum mismatch');
  const snapshot = validateSnapshot(JSON.parse(bytes), entry.school);
  if (snapshot.generatedAt !== manifest.generatedAt) throw new Error('Mixed snapshot generations');
}
console.log(`Validated ${manifest.teams.length} school snapshots and checksums.`);
