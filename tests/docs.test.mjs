// Documentation that must not rot.
//
// AGENTS.md is the operating manual future agents follow (release workflow, commands,
// traps). A stale instruction there is worse than none, so the commands it and the
// README name have to exist, and the essentials have to still be covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');
const scripts = Object.keys(JSON.parse(read('package.json')).scripts);

for (const doc of ['AGENTS.md', 'README.md']) {
  test(`${doc} only names commands that exist`, () => {
    const text = read(doc);

    const missingScripts = [...new Set([...text.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]))]
      .filter((name) => !scripts.includes(name));
    assert.deepEqual(missingScripts, [], `${doc} mentions missing npm scripts: ${missingScripts.join(', ')}`);

    const missingFiles = [...new Set([...text.matchAll(/node ((?:scripts|tests)\/[\w.-]+\.(?:mjs|js|cjs))/g)].map((match) => match[1]))]
      .filter((path) => !existsSync(join(root, path)));
    assert.deepEqual(missingFiles, [], `${doc} mentions missing files: ${missingFiles.join(', ')}`);
  });
}

test('AGENTS.md documents the release workflow', () => {
  const text = read('AGENTS.md');
  for (const needle of [
    'https://lean-tutorials.pages.dev', // production
    'staging.lean-tutorials.pages.dev', // the stable staging alias
    'deployment hostname', // the rule that a deploy is verified on its own host
    'CLOUDFLARE_API_TOKEN', // credentials
    'npm run prepare:runtime', // the runtime has to be fetched before a build
    '0 bytes', // the caching invariant
    'npm run test:e2e',
  ]) {
    assert.ok(text.includes(needle), `AGENTS.md no longer mentions: ${needle}`);
  }
});

test('AGENTS.md keeps the traps that have actually cost time here', () => {
  const text = read('AGENTS.md');
  for (const needle of [
    '404.html', // static fallback shadows Functions when one exists
    'git add -A', // symlinked runtime paths in worktrees
    'functions/', // why there are no Pages Functions
    'Alias lag', // verifying an alias validates the previous deployment
    'duplicate keys', // PyYAML tolerates what GitHub rejects
    'goal-trace', // one owner for the trace protocol
  ]) {
    assert.ok(text.includes(needle), `AGENTS.md no longer warns about: ${needle}`);
  }
});
