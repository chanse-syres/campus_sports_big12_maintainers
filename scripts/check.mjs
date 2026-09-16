import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { listSchools } from '../src/config.mjs';
import { snapshotSchema, manifestSchema } from '../src/schema.mjs';
for (const root of ['src', 'scripts', 'examples', 'teams', 'test']) {
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${root}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
}
await listSchools();
for (const [name, schema] of [['snapshot', snapshotSchema], ['manifest', manifestSchema]]) {
  if (JSON.stringify(JSON.parse(await readFile(`schemas/${name}.schema.json`, 'utf8'))) !== JSON.stringify(schema)) throw new Error('Generated JSON Schema differs from source');
}
const workflowCheck = spawnSync(process.execPath, ['scripts/verify-workflows.mjs'], { stdio: 'inherit' });
if (workflowCheck.status !== 0) process.exit(1);
console.log('Syntax, school configurations, JSON Schemas, and workflow controls verified.');
