import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, link, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPublishContext, downloadPrevious, loadPublicationBundle, publishBundle, REPOSITORY, validateManifest } from '../scripts/publish.mjs';
import { verifyWorkflowText, verifyWorkflows } from '../scripts/verify-workflows.mjs';

const schoolSlugs = Array.from({ length: 16 }, (_, index) => `school-${String.fromCharCode(97 + index)}`);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const mainSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const commitSha = 'c'.repeat(40);
const parentSha = 'd'.repeat(40);
const publishEnv = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/maintainers.yml@refs/heads/main`,
  GITHUB_SHA: mainSha, GITHUB_TOKEN: 'test-placeholder-never-sent',
};

function fixture() {
  const texts = new Map(schoolSlugs.map((slug) => [slug, JSON.stringify({ school: slug, generatedAt: '2026-09-16T00:00:00.000Z' }) + '\n']));
  const manifest = {
    schemaVersion: 1, conference: 'big12', generatedAt: '2026-09-16T00:00:00.000Z',
    teams: schoolSlugs.map((school) => ({ school, path: `teams/${school}.json`, sha256: sha(texts.get(school)) })),
  };
  return { texts, manifest };
}

async function fixtureDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'big12-publication-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { texts, manifest } = fixture();
  await mkdir(path.join(root, 'v1', 'teams'), { recursive: true });
  await writeFile(path.join(root, 'v1', 'manifest.json'), JSON.stringify(manifest));
  for (const [school, text] of texts) await writeFile(path.join(root, 'v1', 'teams', `${school}.json`), text);
  return { root, texts, manifest };
}

const validator = (snapshot, expected) => assert.equal(snapshot.school, expected);

test('publication accepts only a complete checksummed collection and validates every school', async (t) => {
  const { root } = await fixtureDirectory(t);
  const validated = [];
  const bundle = await loadPublicationBundle(root, { schoolSlugs, validator: (snapshot, slug) => { validator(snapshot, slug); validated.push(slug); } });
  assert.deepEqual(validated, schoolSlugs);
  assert.equal(bundle.files.length, 17);
  assert.equal(bundle.files[0].path, 'v1/manifest.json');
});

test('manifest rejects traversal, duplicates, missing schools, and unknown fields', () => {
  for (const mutate of [
    (value) => { value.teams[0].path = '../secret.json'; },
    (value) => { value.teams[1] = { ...value.teams[0] }; },
    (value) => { value.teams.pop(); },
    (value) => { value.secret = 'unexpected'; },
  ]) {
    const { manifest } = fixture();
    mutate(manifest);
    assert.throws(() => validateManifest(manifest, schoolSlugs));
  }
});

test('publication rejects altered snapshots even when the JSON is valid', async (t) => {
  const { root } = await fixtureDirectory(t);
  await writeFile(path.join(root, 'v1', 'teams', 'school-a.json'), '{"school":"school-b"}');
  await assert.rejects(loadPublicationBundle(root, { schoolSlugs, validator }), /checksum/);
});

test('publication rejects a checksummed snapshot from a different collection run', async (t) => {
  const { root, texts, manifest } = await fixtureDirectory(t);
  const snapshot = JSON.parse(texts.get('school-a'));
  snapshot.generatedAt = '2026-09-15T00:00:00.000Z';
  const changed = JSON.stringify(snapshot);
  manifest.teams[0].sha256 = sha(changed);
  await writeFile(path.join(root, 'v1', 'teams', 'school-a.json'), changed);
  await writeFile(path.join(root, 'v1', 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadPublicationBundle(root, { schoolSlugs, validator }), /generation timestamp/);
});

test('publication rejects unexpected artifact files', async (t) => {
  const { root } = await fixtureDirectory(t);
  await writeFile(path.join(root, 'v1', '.env'), 'should never be published');
  await assert.rejects(loadPublicationBundle(root, { schoolSlugs, validator }), /unexpected publication files/);
});

test('publication rejects hardlinked snapshot files', async (t) => {
  const { root } = await fixtureDirectory(t);
  const target = path.join(root, 'v1', 'teams', 'school-a.json');
  const secondLink = path.join(os.tmpdir(), `big12-link-${path.basename(root)}.json`);
  t.after(() => rm(secondLink, { force: true }));
  await link(target, secondLink);
  await assert.rejects(loadPublicationBundle(root, { schoolSlugs, validator }), /never links/);
});

test('publisher rejects fork, branch, PR, and wrong-workflow execution contexts', () => {
  assert.doesNotThrow(() => assertPublishContext(publishEnv));
  for (const overrides of [
    { GITHUB_REPOSITORY: 'someone/fork' }, { GITHUB_REF: 'refs/heads/unreviewed' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_ACTIONS: 'false' },
    { GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/other.yml@refs/heads/main` },
  ]) assert.throws(() => assertPublishContext({ ...publishEnv, ...overrides }));
});

test('initial publication creates an independent data branch with only validated paths', async (t) => {
  const { root } = await fixtureDirectory(t);
  const bundle = await loadPublicationBundle(root, { schoolSlugs, validator });
  const calls = [];
  const request = async (method, endpoint, body, allowMissing) => {
    calls.push({ method, endpoint, body, allowMissing });
    if (endpoint === 'git/ref/heads/main') return { object: { sha: mainSha } };
    if (endpoint === 'git/ref/heads/data') { assert.equal(allowMissing, true); return null; }
    if (endpoint === 'git/trees') return { sha: treeSha };
    if (endpoint === 'git/commits') return { sha: commitSha };
    if (endpoint === 'git/refs') return { ref: 'refs/heads/data' };
    throw new Error(`Unexpected test request ${endpoint}`);
  };
  assert.deepEqual(await publishBundle(bundle, { env: publishEnv, request }), { changed: true, sha: commitSha });
  const tree = calls.find((call) => call.endpoint === 'git/trees').body;
  assert.equal(tree.tree.length, 17);
  assert.equal(Object.hasOwn(tree, 'base_tree'), false);
  assert.ok(tree.tree.every((file) => file.mode === '100644' && file.type === 'blob' && file.path.startsWith('v1/')));
  assert.deepEqual(calls.find((call) => call.endpoint === 'git/commits').body.parents, []);
  assert.deepEqual(calls.at(-1).body, { ref: 'refs/heads/data', sha: commitSha });
});

test('publisher refuses stale main before any write request', async () => {
  let calls = 0;
  await assert.rejects(publishBundle({}, { env: publishEnv, request: async (method) => { calls += 1; assert.equal(method, 'GET'); return { object: { sha: parentSha } }; } }), /main advanced/);
  assert.equal(calls, 1);
});

test('publisher updates existing branches without force and preserves concurrent-writer errors', async (t) => {
  const { root } = await fixtureDirectory(t);
  const bundle = await loadPublicationBundle(root, { schoolSlugs, validator });
  const request = async (method, endpoint, body) => {
    if (endpoint === 'git/ref/heads/main') return { object: { sha: mainSha } };
    if (endpoint === 'git/ref/heads/data') return { object: { sha: parentSha } };
    if (endpoint === 'git/trees') return { sha: treeSha };
    if (endpoint === `git/commits/${parentSha}`) return { tree: { sha: parentSha } };
    if (endpoint === 'git/commits') { assert.deepEqual(body.parents, [parentSha]); return { sha: commitSha }; }
    assert.equal(method, 'PATCH');
    assert.equal(endpoint, 'git/refs/heads/data');
    assert.deepEqual(body, { sha: commitSha, force: false });
    throw new Error('HTTP 422: concurrent writer');
  };
  await assert.rejects(publishBundle(bundle, { env: publishEnv, request }), /concurrent writer/);
});

test('publisher does not commit an unchanged tree', async (t) => {
  const { root } = await fixtureDirectory(t);
  const bundle = await loadPublicationBundle(root, { schoolSlugs, validator });
  const request = async (_method, endpoint) => {
    if (endpoint === 'git/ref/heads/main') return { object: { sha: mainSha } };
    if (endpoint === 'git/ref/heads/data') return { object: { sha: parentSha } };
    if (endpoint === 'git/trees') return { sha: treeSha };
    if (endpoint === `git/commits/${parentSha}`) return { tree: { sha: treeSha } };
    throw new Error('unchanged data must not create a commit or update a ref');
  };
  assert.deepEqual(await publishBundle(bundle, { env: publishEnv, request }), { changed: false, sha: parentSha });
});

test('previous snapshot download validates the whole bundle before writing anything', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'big12-previous-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'previous');
  const { texts, manifest } = fixture();
  await assert.rejects(downloadPrevious(directory, {
    schoolSlugs, validator, request: async () => ({ object: { sha: parentSha } }),
    fetchFile: async (filename) => filename === 'manifest.json' ? Buffer.from(JSON.stringify(manifest)) : Buffer.from(filename === 'teams/school-a.json' ? '{}' : texts.get(path.basename(filename, '.json'))),
  }), /checksum/);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('workflow policy validates the checked-in workflows and catches dangerous changes', async () => {
  assert.equal(await verifyWorkflows(), 3);
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const unsafe of [
    ci.replace(/actions\/checkout@[a-f0-9]{40}/, 'actions/checkout@main'),
    ci.replace('contents: read', 'contents: write'),
    ci.replace('pull_request:', 'pull_request_target:'),
    ci.replace('run: npm test', 'run: echo ${{ github.event.pull_request.title }}'),
    ci.replace('npm ci --ignore-scripts', 'npm ci'),
  ]) assert.throws(() => verifyWorkflowText(unsafe, 'ci.yml'));
});
