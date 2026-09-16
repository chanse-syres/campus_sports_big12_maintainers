import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPrevious } from '../scripts/publish.mjs';
import { SCHOOL_SLUGS } from '../src/config.mjs';

test('first v2 run recognizes a bounded valid v1 manifest without pretending v1 is a compatible fallback', async () => {
  const legacy = { schemaVersion: 1, conference: 'big12', generatedAt: '2026-09-16T00:00:00.000Z', teams: SCHOOL_SLUGS.map(school => ({school,path:`teams/${school}.json`,sha256:'a'.repeat(64)})) };
  const calls=[];
  const result = await downloadPrevious('unused-directory', { schoolSlugs:SCHOOL_SLUGS, request:async()=>({object:{sha:'b'.repeat(40)}}), fetchFile:async(filename,limit,version='v2')=>{
    calls.push([filename,version]); return version==='v1'? Buffer.from(JSON.stringify(legacy)):null;
  }});
  assert.deepEqual(result,{downloaded:false,reason:'schema-version-upgrade'});
  assert.deepEqual(calls,[['manifest.json','v2'],['manifest.json','v1']]);
});

test('missing or unrecognized previous manifests stop collection instead of discarding fallback silently', async()=>{
  await assert.rejects(downloadPrevious('unused-directory',{schoolSlugs:SCHOOL_SLUGS, request:async()=>({object:{sha:'b'.repeat(40)}}), fetchFile:async()=>null}),/no recognized/);
});
