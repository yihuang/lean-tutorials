// Authoring probe for the cursor-driven goal probe: does the *real* Lean runtime
// agree with what GoalProbe claims at a cursor?
//
//   node tests/probe-infoview.mjs [--port 8799] [--mem 768]
//
// Boots the browser runtime once and runs GoalProbe against lessons built here
// (the module never imports content, so neither does this script — the lessons
// are plain { id, kind, statement } objects). Prints one line per case and exits
// non-zero if an expectation fails. This is the evidence that truncation,
// back-off and the preview wrapper work against Lean, not just against the fake
// engine in tests/infoview.test.mjs.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchProfile, isolateStorage, waitForEngine } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8799));
const mem = argValue('mem', '768');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = existsSync(join(root, 'site', 'lean-wasm')) ? 'site' : 'dist';

const AND_INTRO = {
  id: 'probe-and-intro',
  kind: 'tactic',
  statement: 'example {p q : Prop} (hp : p) (hq : q) : p ∧ q',
};

const ADD_ZERO = {
  id: 'probe-add-zero',
  kind: 'tactic',
  statement: 'example (n : Nat) : 0 + n = n',
};

const CASES = [
  {
    name: 'constructor at cursor 0',
    lesson: AND_INTRO,
    input: 'constructor',
    cursor: 0,
    // Two cases are open; neither is closed, so both must come back.
    check: (r) => r.status === 'goals' && r.goals.length === 2,
    describe: (r) => `${r.status}, line ${r.line}, ${r.goals.length} goals`,
  },
  {
    name: 'statement state before any input',
    lesson: AND_INTRO,
    input: '',
    cursor: -1,
    // Nothing typed yet: the panel shows the statement's own goal.
    check: (r) => r.status === 'goals' && r.goals.length === 1,
    describe: (r) => `${r.status}, line ${r.line}, ${r.goals.length} goals`,
  },
  {
    name: 'incomplete induction at its last line',
    lesson: ADD_ZERO,
    input: 'induction n with\n| zero => rfl\n| succ k ih =>',
    cursor: 2,
    // Against this runtime an empty alternative body (the `=>` and then the
    // wrapper's `all_goals`) elaborates and leaves the `succ` goal open, so
    // there is nothing to back off from: line 2 is the state at the cursor.
    check: (r) => r.status === 'goals' && r.requestedLine === 2 && r.line === 2 && r.goals.length === 1,
    describe: (r) => `${r.status}, requested ${r.requestedLine}, reported ${r.line}, ${r.goals.length} goal(s)`,
    note: 'Lean accepts an empty branch body, so no back-off happens here.',
  },
  {
    name: 'bullet truncation backs off',
    lesson: AND_INTRO,
    input: 'constructor\n· exact hp\n·',
    cursor: 2,
    // An empty `·` bullet does leave the file invalid. This is the truncation
    // back-off exists for: the answer is the state before the bullet.
    check: (r) => r.status === 'goals' && r.requestedLine === 2
      && typeof r.line === 'number' && r.line <= 1 && r.goals.length === 1,
    describe: (r) => `${r.status}, requested ${r.requestedLine}, reported ${r.line}, ${r.goals.length} goal(s)`,
  },
];

const server = spawn(process.execPath, ['scripts/serve.mjs', '--dir', dir, '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
await new Promise((resolve) => setTimeout(resolve, 800));

const context = await launchProfile(chromium, { viewport: { width: 900, height: 900 } });
await isolateStorage(context);
const page = context.pages()[0] ?? await context.newPage();
await page.goto(`http://localhost:${port}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });
const state = await waitForEngine(page);
if (state.state !== 'ready') {
  console.error(`Lean did not start: ${state.error ?? state.message}`);
  process.exit(1);
}

// The page already has window.leanTutorials.engine (main.js); GoalProbe is
// imported here rather than exposed there, so this probe works against the
// module alone and does not depend on the UI half of the task.
const results = await page.evaluate(async (cases) => {
  const { GoalProbe } = await import('/src/lean/infoview.js');
  const { engine } = window.leanTutorials;
  const probe = new GoalProbe(engine);
  const out = [];
  for (const item of cases) {
    const result = await probe.goalsAt(item.lesson, item.input, item.cursor);
    out.push({ name: item.name, result });
  }
  return out;
}, CASES.map(({ name, lesson, input, cursor }) => ({ name, lesson, input, cursor })));

let failed = 0;
results.forEach((row, index) => {
  const expectation = CASES[index];
  const ok = expectation.check(row.result);
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${row.name}`);
  console.log(`    ${expectation.describe(row.result)}`);
  if (expectation.note) console.log(`    note: ${expectation.note}`);
  for (const goal of row.result.goals) {
    const [first = '', second = ''] = goal.split('\n');
    console.log(`      ${first}${second ? ` / ${second}` : ''}`);
  }
});
console.log(`\n${results.length - failed}/${results.length} expectations met`);

await context.close();
server.kill('SIGTERM');
process.exit(failed === 0 ? 0 : 1);
