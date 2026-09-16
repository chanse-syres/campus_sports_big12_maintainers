import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** A small additional policy gate; GitHub and CodeQL perform full YAML/action analysis. */
export function verifyWorkflowText(text, name) {
  assert.match(text, /^permissions: \{\}$/m, `${name}: deny token permissions by default`);
  assert.doesNotMatch(text, /\b(?:pull_request_target|workflow_run|repository_dispatch|self-hosted)\b/, `${name}: privileged triggers/runners are forbidden`);
  assert.doesNotMatch(text, /\b(?:write-all|secrets:\s*inherit|id-token:\s*write)\b/, `${name}: excessive permissions are forbidden`);
  const actions = [...text.matchAll(/^\s*- uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(actions.length > 0, `${name}: expected action steps`);
  for (const action of actions) {
    assert.match(action, /^(?:actions\/[a-z-]+|github\/codeql-action\/(?:init|analyze))@[a-f0-9]{40}$/, `${name}: actions must be official and pinned to a commit`);
  }
  const checkouts = actions.filter((action) => action.startsWith('actions/checkout@')).length;
  assert.equal([...text.matchAll(/^\s+persist-credentials: false$/gm)].length, checkouts, `${name}: checkouts must not retain credentials`);
  assert.doesNotMatch(text, /^\s+(?:persist-credentials: true|fetch-depth: 0)$/m, `${name}: unnecessary credentials/history`);
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s+(?:- )?run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = lines[index].indexOf('run:');
    const command = [match[1]];
    for (let continuation = index + 1; continuation < lines.length; continuation += 1) {
      if (!lines[continuation].trim()) continue;
      if (lines[continuation].search(/\S/) <= indent) break;
      command.push(lines[continuation]);
    }
    assert.ok(!command.join('\n').includes('${{'), `${name}: never interpolate event data into a shell command`);
  }
  assert.doesNotMatch(text, /\b(?:npm (?:ci|install)(?! --ignore-scripts))\b/, `${name}: dependency installation must disable lifecycle scripts`);
  if (name === 'maintainers.yml') {
    assert.equal([...text.matchAll(/^\s+contents: write$/gm)].length, 1, 'only the isolated publisher can write repository contents');
    assert.ok(text.includes("github.ref == 'refs/heads/main'"), 'publication must be restricted to main');
    assert.ok(text.includes("github.repository == 'chanse-syres/campus_sports_big12_maintainers'"), 'publication must be restricted to the intended repository');
    assert.ok(text.includes('node scripts/publish.mjs --dry-run'), 'validate before uploading artifacts');
    assert.ok(text.includes('cancel-in-progress: false'), 'publication cannot cancel an in-progress update');
  } else {
    assert.doesNotMatch(text, /^\s+contents: write$/m, `${name}: nonpublication workflows must not write repository contents`);
  }
}

export async function verifyWorkflows(directory = new URL('../.github/workflows/', import.meta.url)) {
  const files = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length >= 3, 'expected CI, maintainers, and CodeQL workflows');
  for (const name of files) {
    const filename = directory instanceof URL ? new URL(name, directory) : path.join(directory, name);
    verifyWorkflowText(await readFile(filename, 'utf8'), name);
  }
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyWorkflows().then((count) => console.log(`Workflow policy checks passed (${count} workflows).`)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
