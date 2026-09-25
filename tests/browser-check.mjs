// End-to-end proof of life: boot the real Lean WASM runtime in headless
// Chromium, then run every lesson's solution (and starter) through the same
// checker the UI uses.
//
//   node tests/browser-check.mjs [--port 8799] [--mem 768] [--headed]
//
// The first run downloads ~56 MB and imports the Init environment, so give it a
// few minutes and at least ~1.5 GB of free RAM.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(argValue('port', 8799));
const mem = argValue('mem', '768');
const externalUrl = argValue('url', '');
const headed = args.includes('--headed');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache).filter((name) => name.startsWith('chromium-')).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = join(cache, entry, sub);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error('No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium');
  process.exit(2);
}

const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'site', '--port', String(port)], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
server?.stdout.on('data', (chunk) => process.stdout.write(`[serve] ${chunk}`));
server?.stderr.on('data', (chunk) => process.stderr.write(`[serve] ${chunk}`));

const shutdown = () => { if (server && !server.killed) server.kill('SIGTERM'); };
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

let failures = 0;
const results = [];

try {
  await wait(700);
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: !headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  const bootStart = Date.now();
  const base = externalUrl || `http://localhost:${port}`;
  await page.goto(`${base}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => window.leanTutorials && ['ready', 'error'].includes(window.leanTutorials.engine.state),
    null,
    { timeout: 15 * 60 * 1000 },
  );

  const state = await page.evaluate(() => ({
    state: window.leanTutorials.engine.state,
    message: window.leanTutorials.engine.progress.message,
    error: window.leanTutorials.engine.error?.message ?? null,
  }));
  if (state.state !== 'ready') {
    failures += 1;
    console.error(`✗ engine ${state.state}: ${state.error || state.message}`);
    console.error(logs.slice(-40).join('\n'));
    await browser.close();
    process.exit(1);
  }
  console.log(`✓ Lean ready in ${((Date.now() - bootStart) / 1000).toFixed(1)}s (mem=${mem}MB, chrome=${chrome})`);

  const matrix = await page.evaluate(async () => {
    const { LESSONS, checkLesson, engine } = window.leanTutorials;
    const out = [];
    for (const lesson of LESSONS) {
      const solution = await checkLesson(engine, lesson, lesson.solution);
      const starter = await checkLesson(engine, lesson, lesson.starter);
      out.push({
        id: lesson.id,
        ok: solution.ok,
        kind: solution.kind,
        headline: solution.headline,
        detail: solution.detail,
        messages: (solution.messages || []).map((message) => message.message).slice(0, 3),
        starterRejected: !starter.ok,
        starterKind: starter.kind,
        ms: Math.round(solution.elapsed || 0),
      });
    }
    return out;
  });

  for (const row of matrix) {
    const mark = row.ok && row.starterRejected ? '✓' : '✗';
    if (mark === '✗') failures += 1;
    results.push(`${mark} ${row.id.padEnd(10)} ${row.ok ? 'solution ok' : `${row.kind}: ${row.headline}`} · starter ${row.starterRejected ? 'rejected' : 'ACCEPTED'} · ${row.ms}ms`);
    if (!row.ok) results.push(`    detail: ${row.detail}`);
    for (const message of row.messages) results.push(`    ${message.split('\n')[0]}`);
  }
  console.log(results.join('\n'));

  // Behavioural assertions beyond "the solution works": open goals must be
  // visible, errors must point at the learner's own lines, and the ways of
  // faking a proof must be refused.
  const scenarios = await page.evaluate(async () => {
    const { LESSONS, checkLesson, engine } = window.leanTutorials;
    const lesson = (id) => LESSONS.find((entry) => entry.id === id);
    const cases = [
      {
        name: 'incomplete proof shows the open goals',
        lesson: lesson('and'), tactics: 'constructor',
        expect: (r) => !r.ok && r.goals.length === 2 && r.headline === 'The proof is not finished',
      },
      {
        name: 'error is located on the learner line',
        lesson: lesson('and'), tactics: 'exact hq',
        expect: (r) => !r.ok && r.messages.some((m) => m.severity === 'error' && m.line === 1),
      },
      {
        name: 'sorry is refused',
        lesson: lesson('and'), tactics: 'sorry',
        expect: (r) => !r.ok && r.kind === 'policy',
      },
      {
        name: 'empty block is refused',
        lesson: lesson('and'), tactics: '-- nothing yet',
        expect: (r) => !r.ok && !r.goals.length,
      },
      {
        name: 'induction step goal keeps the hypothesis',
        lesson: lesson('induction'), tactics: 'induction n with\n| zero => rfl\n| succ k ih => trace_state',
        expect: (r) => !r.ok && r.goals.length === 1 && /0 \+ k = k/.test(r.goals[0]),
      },
      {
        name: 'multi-line proof keeps line numbers aligned',
        lesson: lesson('intro'), tactics: 'intro hp hq\nexact hq',
        expect: (r) => !r.ok && r.messages.some((m) => m.line === 2),
      },
    ];
    const results = [];
    for (const entry of cases) {
      const result = await checkLesson(engine, entry.lesson, entry.tactics);
      let pass = false;
      let why = '';
      try { pass = entry.expect(result); } catch (error) { why = String(error.message); }
      results.push({
        name: entry.name, pass, why,
        detail: `${result.kind}: ${result.headline}`,
        goals: result.goals,
        messages: (result.messages || []).slice(0, 2).map((m) => `${m.severity}${m.line ? ` line ${m.line}` : ''}: ${String(m.message).split('\n')[0].slice(0, 90)}`),
      });
    }
    return results;
  });

  for (const row of scenarios) {
    if (!row.pass) failures += 1;
    console.log(`${row.pass ? '✓' : '✗'} ${row.name} — ${row.detail}${row.why ? ` (${row.why})` : ''}`);
    for (const goal of row.goals) console.log(`    goal: ${goal.split('\n').join(' | ').slice(0, 120)}`);
    for (const message of row.messages) console.log(`    ${message}`);
  }

  // The sandbox path: raw output from #eval must reach the reader.
  const sandbox = await page.evaluate(async () => {
    const { engine } = window.leanTutorials;
    const run = await engine.compile('#eval 2 + 2\n#check Nat.add_comm\ntheorem ok : True := trivial');
    const info = run.output
      .flatMap((chunk) => String(chunk.data).split('\n'))
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry && entry.severity === 'information')
      .map((entry) => String(entry.data));
    return { success: run.success, hasFour: info.includes('4'), hasCheck: info.some((line) => line.includes('Nat.add_comm')), sample: info.slice(0, 3) };
  });
  const sandboxOk = sandbox.success && sandbox.hasFour && sandbox.hasCheck;
  if (!sandboxOk) failures += 1;
  console.log(`${sandboxOk ? '✓' : '✗'} sandbox #eval/#check output: ${JSON.stringify(sandbox.sample)}`);

  // One pass through the real UI, so the wiring (editor → Check → banner) is
  // covered too.
  await page.evaluate(() => { location.hash = '#/lesson/rfl'; });
  await page.waitForSelector('textarea.editor');
  await page.fill('textarea.editor', 'rfl');
  await page.click('button.btn.primary');
  await page.waitForFunction(() => document.querySelector('.banner.ok, .banner.err'), null, { timeout: 120000 });
  const banner = await page.textContent('.banner');
  const uiOk = /Proof verified/.test(banner);
  if (!uiOk) failures += 1;
  console.log(`${uiOk ? '✓' : '✗'} UI check: ${banner.trim().split('\n')[0]}`);

  await browser.close();
} catch (error) {
  failures += 1;
  console.error(`✗ ${error.stack || error}`);
} finally {
  shutdown();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
