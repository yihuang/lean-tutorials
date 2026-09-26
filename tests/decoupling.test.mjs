// The content/mechanism boundary, enforced instead of promised.
//
// Content is data: it must not import the compiler, the checker or the UI, and
// the mechanism must not reach into a topic module or special-case a lesson id.
// If either side of that leaks, this test fails — which is what keeps "add a
// topic" a content-only change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LESSONS, THEMES, validateContent } from '../site/src/content/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'site', 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
const rel = (file) => relative(root, file);

test('content never imports the mechanism', () => {
  for (const file of walk(join(src, 'content'))) {
    const bad = importsOf(file).filter((spec) => /(^|\/)\.\.?\/(lean|ui)\//.test(spec) || /main\.js$/.test(spec));
    assert.deepEqual(bad, [], `${rel(file)} must stay data-only, but imports ${bad.join(', ')}`);
  }
});

test('the mechanism reaches content only through content/index.js', () => {
  const mechanism = ['lean/engine.js', 'lean/tutorial.js', 'lean/source.js', 'lean/packs.js', 'lean/diagnostics.js', 'lean/goals.js', 'lean/infoview.js', 'ui/editor.js', 'ui/dom.js', 'ui/prose.js', 'ui/infoview-panel.js', 'main.js'];
  for (const name of mechanism) {
    const file = join(src, name);
    const bad = importsOf(file).filter((spec) => /content\/topics\//.test(spec) || /content\/themes\//.test(spec) || /content\/sandbox/.test(spec));
    assert.deepEqual(bad, [], `${name} must not import topic modules directly (${bad.join(', ')})`);
  }
});

test('the mechanism never branches on a lesson id', () => {
  // A quoted word that happens to match an id (a CSS class, say) is fine; what
  // would break the boundary is comparing against one.
  const ids = LESSONS.map((lesson) => lesson.id);
  const mechanism = ['lean/tutorial.js', 'lean/source.js', 'lean/infoview.js', 'ui/infoview-panel.js', 'main.js'];
  for (const name of mechanism) {
    const text = readFileSync(join(src, name), 'utf8');
    const comparisons = ids.flatMap((id) => {
      const quoted = `['"\`]${id}['"\`]`;
      return new RegExp(`(===|!==|==|!=)\\s*${quoted}|${quoted}\\s*(===|!==|==|!=)`).test(text) ? [id] : [];
    });
    assert.deepEqual(comparisons, [], `${name} special-cases lesson ids: ${comparisons.join(', ')}`);
  }
});

test('every topic module exports exactly one topic of lessons', async () => {
  const files = readdirSync(join(src, 'content', 'topics')).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 5, 'expected several topic modules');
  for (const name of files) {
    const module = await import(`../site/src/content/topics/${name}`);
    const topics = Object.values(module).filter((value) => value && typeof value === 'object' && Array.isArray(value.lessons));
    assert.equal(topics.length, 1, `${name} should export one topic`);
    const topic = topics[0];
    assert.ok(topic.id && topic.title && topic.intro, `${name} topic needs id/title/intro`);
    assert.match(name, new RegExp(`^${topic.id}\\.js$`), `${name} should be named after its topic id`);
    assert.ok(topic.lessons.length >= 3, `${name} should carry at least three lessons`);
  }
});

test('theme modules export well-formed themes', async () => {
  const files = readdirSync(join(src, 'content', 'themes')).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 2, 'expected several theme modules');
  let count = 0;
  for (const name of files) {
    const module = await import(`../site/src/content/themes/${name}`);
    const themes = Object.values(module).filter((value) => value && typeof value === 'object'
      && Array.isArray(value.topics) && typeof value.status === 'string');
    assert.ok(themes.length >= 1, `${name} should export at least one theme`);
    for (const theme of themes) {
      count += 1;
      assert.ok(theme.id && theme.title && theme.intro && theme.summary, `${name}: ${theme.id} is incomplete`);
      assert.ok(['available', 'planned'].includes(theme.status), `${name}: ${theme.id} has status ${theme.status}`);
      if (theme.status === 'planned') assert.equal(theme.topics.length, 0, `${name}: planned themes own no topics`);
    }
  }
  assert.equal(count, THEMES.length, 'every theme comes from a themes/ module');
});

test('the contract validates the real content', () => {
  assert.deepEqual(validateContent(), []);
});
