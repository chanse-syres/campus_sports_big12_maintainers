import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSchools } from '../src/config.mjs';
import { validateSnapshot } from '../src/validate.mjs';

export const REPOSITORY = 'chanse-syres/campus_sports_big12_maintainers';
const DATA_BRANCH = 'data';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected or missing fields`);
}

export function validateManifest(manifest, schoolSlugs) {
  assert.equal(new Set(schoolSlugs).size, 16, 'exactly 16 unique configured Big 12 schools are required');
  for (const slug of schoolSlugs) assert.match(slug, /^[a-z]+(?:-[a-z]+)*$/);
  exactKeys(manifest, ['schemaVersion', 'conference', 'generatedAt', 'teams'], 'manifest');
  assert.equal(manifest.schemaVersion, 1, 'unsupported manifest version');
  assert.equal(manifest.conference, 'big12', 'unexpected conference');
  assert.ok(typeof manifest.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.generatedAt) && Number.isFinite(Date.parse(manifest.generatedAt)), 'invalid manifest generation timestamp');
  assert.ok(Array.isArray(manifest.teams), 'manifest teams must be an array');
  assert.equal(manifest.teams.length, schoolSlugs.length, 'manifest must contain every school exactly once');
  const seen = new Set();
  for (const team of manifest.teams) {
    exactKeys(team, ['school', 'path', 'sha256'], 'manifest team');
    assert.ok(schoolSlugs.includes(team.school) && !seen.has(team.school), 'unknown or duplicate manifest school');
    seen.add(team.school);
    assert.equal(team.path, `teams/${team.school}.json`, 'manifest paths must match their configured school');
    assert.match(team.sha256, SHA256, 'invalid snapshot checksum');
  }
  return manifest;
}

async function checkedDirectory(directory) {
  const metadata = await lstat(directory);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), 'publication directories must be real directories');
  return realpath(directory);
}

async function readRegularFile(directory, filename, limit) {
  const target = path.join(directory, filename);
  const metadata = await lstat(target);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1, 'publication files must be ordinary files, never links');
  assert.ok(metadata.size > 0 && metadata.size <= limit, 'publication file exceeds size limits');
  assert.equal(path.dirname(await realpath(target)), directory, 'publication file escapes its directory');
  const bytes = await readFile(target);
  assert.ok(bytes.length <= limit, 'publication file exceeds size limits');
  return bytes;
}

async function validateFiles(manifestBytes, teamBytes, schoolSlugs, validator) {
  assert.ok(manifestBytes.length <= MAX_MANIFEST_BYTES, 'manifest exceeds size limits');
  const manifest = validateManifest(JSON.parse(decode(manifestBytes)), schoolSlugs);
  let total = manifestBytes.length;
  const files = [{ path: 'v1/manifest.json', content: decode(manifestBytes) }];
  for (const entry of manifest.teams) {
    const bytes = teamBytes.get(entry.school);
    assert.ok(bytes && bytes.length > 0 && bytes.length <= MAX_FILE_BYTES, 'missing or oversized school snapshot');
    total += bytes.length;
    assert.ok(total <= MAX_BUNDLE_BYTES, 'publication bundle exceeds total size limit');
    assert.equal(digest(bytes), entry.sha256, 'school snapshot checksum does not match the manifest');
    const content = decode(bytes);
    const snapshot = JSON.parse(content);
    await validator(snapshot, entry.school);
    assert.equal(snapshot.generatedAt, manifest.generatedAt, 'school snapshot generation timestamp does not match the manifest');
    files.push({ path: `v1/${entry.path}`, content });
  }
  return { manifest, files };
}

export async function loadPublicationBundle(directory = 'output', options = {}) {
  const schoolSlugs = options.schoolSlugs ?? (await listSchools()).map((school) => school.slug);
  const validator = options.validator ?? validateSnapshot;
  const root = await checkedDirectory(directory);
  assert.deepEqual((await readdir(root)).sort(), ['v1'], 'only the v1 publication directory is allowed');
  const version = await checkedDirectory(path.join(root, 'v1'));
  assert.equal(path.dirname(version), root, 'version directory escapes publication root');
  assert.deepEqual((await readdir(version)).sort(), ['manifest.json', 'teams'], 'unexpected publication files');
  const teams = await checkedDirectory(path.join(version, 'teams'));
  assert.equal(path.dirname(teams), version, 'team directory escapes publication root');
  assert.deepEqual((await readdir(teams)).sort(), schoolSlugs.map((slug) => `${slug}.json`).sort(), 'unexpected or missing school files');
  const manifestBytes = await readRegularFile(version, 'manifest.json', MAX_MANIFEST_BYTES);
  const teamBytes = new Map();
  for (const slug of schoolSlugs) teamBytes.set(slug, await readRegularFile(teams, `${slug}.json`, MAX_FILE_BYTES));
  return validateFiles(manifestBytes, teamBytes, schoolSlugs, validator);
}

async function limitedResponse(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null) assert.ok(Number(length) <= limit, 'remote response exceeds size limits');
  let total = 0;
  const parts = [];
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    if (total > limit) throw new Error('remote response exceeds size limits');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

function githubRequest(token) {
  return async (method, endpoint, body, allowMissing = false) => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'big12-maintainers' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub ${method} request failed (HTTP ${response.status}); no response body is logged`);
    }
    return JSON.parse(decode(await limitedResponse(response, 1024 * 1024)));
  };
}

function commitSha(value) {
  assert.ok(typeof value === 'string' && SHA.test(value), 'GitHub returned an invalid commit or tree identifier');
  return value;
}

export function assertPublishContext(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'live publication is only available in GitHub Actions');
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, 'unexpected publication repository');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'publication is restricted to main');
  assert.ok(['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'unexpected publication event');
  assert.equal(env.GITHUB_WORKFLOW_REF, `${REPOSITORY}/.github/workflows/maintainers.yml@refs/heads/main`, 'unexpected publication workflow');
  commitSha(env.GITHUB_SHA);
  assert.ok(typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length > 0, 'publication token is unavailable');
}

export async function publishBundle(bundle, { env = process.env, request } = {}) {
  assertPublishContext(env);
  const api = request ?? githubRequest(env.GITHUB_TOKEN);
  const main = await api('GET', 'git/ref/heads/main');
  assert.equal(commitSha(main.object?.sha), env.GITHUB_SHA, 'main advanced during collection; rerun the maintainer with current code');
  const previous = await api('GET', `git/ref/heads/${DATA_BRANCH}`, undefined, true);
  const parent = previous ? commitSha(previous.object?.sha) : null;
  // No base_tree: each publication consists exclusively of the 17 validated JSON files.
  const tree = await api('POST', 'git/trees', {
    tree: bundle.files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
  });
  const treeSha = commitSha(tree.sha);
  if (parent) {
    const previousCommit = await api('GET', `git/commits/${parent}`);
    if (commitSha(previousCommit.tree?.sha) === treeSha) return { changed: false, sha: parent };
  }
  const commit = await api('POST', 'git/commits', {
    message: `Refresh validated Big 12 public snapshots (${bundle.manifest.generatedAt})`,
    tree: treeSha,
    parents: parent ? [parent] : [],
  });
  const sha = commitSha(commit.sha);
  if (parent) {
    // A concurrent writer causes a non-fast-forward error instead of being overwritten.
    await api('PATCH', `git/refs/heads/${DATA_BRANCH}`, { sha, force: false });
  } else {
    await api('POST', 'git/refs', { ref: `refs/heads/${DATA_BRANCH}`, sha });
  }
  return { changed: true, sha };
}

export async function downloadPrevious(directory = 'previous', options = {}) {
  const schoolSlugs = options.schoolSlugs ?? (await listSchools()).map((school) => school.slug);
  const api = options.request ?? githubRequest();
  const previous = await api('GET', `git/ref/heads/${DATA_BRANCH}`, undefined, true);
  if (!previous) return { downloaded: false };
  const sha = commitSha(previous.object?.sha);
  const fetchFile = options.fetchFile ?? (async (filename, limit) => {
    const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${sha}/v1/${filename}`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Previous snapshot download failed (HTTP ${response.status})`);
    }
    return limitedResponse(response, limit);
  });
  const manifestBytes = await fetchFile('manifest.json', MAX_MANIFEST_BYTES);
  const manifest = validateManifest(JSON.parse(decode(manifestBytes)), schoolSlugs);
  const teamBytes = new Map();
  for (let offset = 0; offset < manifest.teams.length; offset += 4) {
    await Promise.all(manifest.teams.slice(offset, offset + 4).map(async (entry) => {
      teamBytes.set(entry.school, await fetchFile(entry.path, MAX_FILE_BYTES));
    }));
  }
  const bundle = await validateFiles(manifestBytes, teamBytes, schoolSlugs, options.validator ?? validateSnapshot);
  await mkdir(directory, { recursive: true });
  const root = await checkedDirectory(directory);
  assert.equal((await readdir(root)).length, 0, 'previous-snapshot directory must be empty');
  await mkdir(path.join(root, 'v1', 'teams'), { recursive: true });
  for (const file of bundle.files) await writeFile(path.join(root, file.path), file.content, { flag: 'wx', mode: 0o600 });
  return { downloaded: true, sha };
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ['--dry-run', '--download-previous'].includes(args[0])), 'usage: node scripts/publish.mjs [--dry-run|--download-previous]');
  if (args[0] === '--download-previous') {
    const result = await downloadPrevious();
    console.log(result.downloaded ? `Loaded prior snapshots from data commit ${result.sha}.` : 'No data branch exists yet; this is the initial collection.');
    return;
  }
  const bundle = await loadPublicationBundle();
  if (args[0] === '--dry-run') {
    console.log(`Validated ${bundle.manifest.teams.length} school snapshots and their manifest; no publication performed.`);
    return;
  }
  const result = await publishBundle(bundle);
  console.log(result.changed ? `Published validated snapshots to data commit ${result.sha}.` : `Snapshots are unchanged at data commit ${result.sha}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never print response bodies, tokens, environment objects, or scraped records.
    console.error(`Publication stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
