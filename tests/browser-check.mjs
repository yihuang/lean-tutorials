// End-to-end proof of life: boot the real Lean WASM runtime in headless
// Chromium, then run every lesson's solution (and starter) through the same
// checker the UI uses.
//
//   node tests/browser-check.mjs [--port 8799] [--mem 768] [--headed]
//
// The first run downloads ~56 MB and imports the Init environment, so give it a
// few minutes and at least ~1.5 GB of free RAM.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME, isolateStorage, launchProfile, resetProfile, waitForEngine } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(argValue('port', 8799));
const mem = argValue('mem', '768');
const externalUrl = argValue('url', '');
const headed = args.includes('--headed');
if (args.includes('--fresh')) resetProfile();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  const context = await launchProfile(chromium, {
    headless: !headed,
    viewport: { width: 900, height: 900 },
  });
  await isolateStorage(context);
  const page = context.pages()[0] ?? await context.newPage();
  const logs = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  const bootStart = Date.now();
  const base = externalUrl || `http://localhost:${port}`;
  await page.goto(`${base}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });

  const state = await waitForEngine(page);
  if (state.state !== 'ready') {
    failures += 1;
    console.error(`✗ engine ${state.state}: ${state.error || state.message}`);
    console.error(logs.slice(-40).join('\n'));
    await context.close();
    process.exit(1);
  }
  console.log(`✓ Lean ready in ${((Date.now() - bootStart) / 1000).toFixed(1)}s (mem=${mem}MB, chrome=${CHROME}) — ${state.detail ?? state.message}`);

  const matrix = await page.evaluate(async () => {
    const { content, checkLesson, engine } = window.leanTutorials;
    const out = [];
    for (const lesson of content.LESSONS) {
      const solution = await checkLesson(engine, lesson, lesson.solution);
      // An untouched lesson starts with an EMPTY editor (the prompt is a
      // placeholder attribute, not content), so that is what must be refused.
      const untouched = await checkLesson(engine, lesson, '');
      out.push({
        id: lesson.id,
        topic: lesson.topic,
        kind: lesson.kind,
        ok: solution.ok,
        kind: solution.kind,
        headline: solution.headline,
        detail: solution.detail,
        messages: (solution.messages || []).map((message) => message.message).slice(0, 3),
        untouchedRejected: !untouched.ok,
        untouchedKind: untouched.kind,
        ms: Math.round(solution.elapsed || 0),
      });
    }
    return out;
  });

  const byTopic = new Map();
  for (const row of matrix) {
    const mark = row.ok && row.untouchedRejected ? '✓' : '✗';
    if (mark === '✗') failures += 1;
    if (!byTopic.has(row.topic)) byTopic.set(row.topic, []);
    byTopic.get(row.topic).push(`${mark} ${row.id.padEnd(18)} ${row.ok ? 'ok' : `${row.kind}: ${row.headline}`}${row.untouchedRejected ? '' : ' · UNTOUCHED ACCEPTED'} ${row.ms}ms`);
  }
  for (const [topic, rows] of byTopic) {
    results.push(`  ${topic}:`);
    for (const row of rows) results.push(`  ${row}`);
  }
  for (const row of matrix) {
    if (row.ok) continue;
    results.push(`  !! ${row.id} (${row.kind}): ${row.detail}`);
    for (const message of row.messages) results.push(`     ${message.split('\n')[0]}`);
  }
  console.log(results.join('\n'));

  // Behavioural assertions beyond "the solution works": open goals must be
  // visible, errors must point at the learner's own lines, and the ways of
  // faking a proof must be refused.
  const scenarios = await page.evaluate(async () => {
    const { content, checkLesson, engine } = window.leanTutorials;
    const lesson = (id) => content.lessonById(id);
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
  // Terminal states only: the in-flight state is a .banner.info, and waiting for
  // any .banner would read the verdict while "Checking…" is still on screen.
  await page.waitForFunction(
    () => document.querySelector('.result.ok, .banner.err, .banner.warn'),
    null,
    { timeout: 120000 },
  );
  const success = await page.evaluate(() => {
    const result = document.querySelector('.result.ok');
    const check = document.querySelector('.actions .btn.primary');
    const next = document.querySelector('.actions .next-step');
    const nav = document.querySelector('.lesson-nav a.accent');
    return {
      headline: result?.querySelector('.result-title')?.textContent ?? '',
      checkLabel: check?.textContent ?? '',
      checkDone: check?.classList.contains('done') ?? false,
      nextVisible: Boolean(next) && !next.hidden,
      nextLabel: (next?.textContent ?? '').trim(),
      navAccented: Boolean(nav),
      titleSize: result ? parseFloat(getComputedStyle(result.querySelector('.result-title')).fontSize) : 0,
    };
  });
  const uiOk = success.headline === 'Proof verified' && success.checkDone && success.checkLabel.includes('✓')
    && success.nextVisible && /^Next:/.test(success.nextLabel) && success.navAccented && success.titleSize >= 16;
  if (!uiOk) failures += 1;
  console.log(`${uiOk ? '✓' : '✗'} UI check: ${JSON.stringify(success)}`);

  // The infoview must follow the caret: the goals at the cursor position, with
  // their hypotheses, without any Check press.
  const readInfoview = () => page.evaluate(() => {
    const panel = document.querySelector('.infoview');
    return {
      state: panel?.dataset.state ?? 'missing',
      title: panel?.querySelector('.infoview-title')?.textContent ?? '',
      badge: panel?.querySelector('.infoview-badge')?.textContent ?? '',
      goals: panel ? panel.querySelectorAll('.goal-card').length : 0,
      hypotheses: [...document.querySelectorAll('.infoview .goal-card .hyp')].map((node) => node.textContent.trim()),
      targets: [...document.querySelectorAll('.infoview .goal-target')].map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
  const caretTo = (line) => page.evaluate((wanted) => {
    const textarea = document.querySelector('textarea.editor');
    const lines = textarea.value.split('\n');
    let offset = 0;
    for (let index = 0; index < Math.min(wanted, lines.length); index += 1) offset += lines[index].length + 1;
    offset += Math.min(3, (lines[Math.min(wanted, lines.length - 1)] ?? '').length);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
  }, line);

  await page.evaluate(() => { location.hash = '#/lesson/and'; });
  await page.waitForSelector('textarea.editor');
  // Empty editor: the statement's own goal, so the panel is never blank.
  await page.fill('textarea.editor', '');
  await page.waitForFunction(() => document.querySelector('.infoview')?.dataset.state === 'goals', null, { timeout: 120000 });
  const initial = await readInfoview();
  const initialOk = initial.goals === 1 && /p ∧ q/.test(initial.targets[0] ?? '') && initial.hypotheses.some((h) => h.includes('hp : p'));
  if (!initialOk) failures += 1;
  console.log(`${initialOk ? '✓' : '✗'} infoview before typing: ${JSON.stringify(initial)}`);

  // After `constructor` the two subgoals must appear, with their context.
  await page.fill('textarea.editor', 'constructor');
  await caretTo(0);
  await page.waitForFunction(() => document.querySelector('.infoview')?.dataset.state === 'goals'
    && document.querySelectorAll('.infoview .goal-card').length === 2, null, { timeout: 120000 });
  const midProof = await readInfoview();
  const midOk = midProof.goals === 2
    && midProof.targets.some((t) => /⊢ p$/.test(t)) && midProof.targets.some((t) => /⊢ q$/.test(t))
    && midProof.hypotheses.filter((h) => h === 'hq : q').length === 2;
  if (!midOk) failures += 1;
  console.log(`${midOk ? '✓' : '✗'} infoview at the cursor: ${JSON.stringify(midProof)}`);

  // Finishing the proof must flip the same panel to "complete", no Check press.
  await page.fill('textarea.editor', 'exact ⟨hp, hq⟩');
  await caretTo(0);
  await page.waitForFunction(() => document.querySelector('.infoview')?.dataset.state === 'complete', null, { timeout: 120000 });
  const finished = await readInfoview();
  const finishedOk = finished.goals === 0 && /complete/i.test(finished.badge);
  if (!finishedOk) failures += 1;
  console.log(`${finishedOk ? '✓' : '✗'} infoview at the end of a finished proof: ${JSON.stringify(finished)}`);

  // A file lesson (kind 'file'): the output panel must show what Lean printed,
  // and the verdict must not claim a proof was verified.
  await page.evaluate(() => { location.hash = '#/lesson/check'; });
  await page.waitForSelector('textarea.editor');
  await page.fill('textarea.editor', '#check Nat.add_comm');
  await page.click('.actions .btn.primary');
  await page.waitForFunction(
    () => document.querySelector('.result.ok, .banner.err, .banner.warn'),
    null,
    { timeout: 120000 },
  );
  const fileLesson = await page.evaluate(() => {
    const result = document.querySelector('.result.ok');
    return {
      headline: result?.querySelector('.result-title')?.textContent ?? '',
      output: document.querySelector('.feedback pre.goal')?.textContent ?? '',
      hasEditor: Boolean(document.querySelector('textarea.editor')),
      told: document.body.textContent.includes('whole file'),
    };
  });
  const fileOk = fileLesson.headline === 'Ran clean' && /Nat\.add_comm/.test(fileLesson.output) && fileLesson.told;
  if (!fileOk) failures += 1;
  console.log(`${fileOk ? '✓' : '✗'} file lesson: ${JSON.stringify({ ...fileLesson, output: fileLesson.output.slice(0, 60) })}`);

  // A file lesson with a required *value*: `#eval 2 ^ 3` satisfies the `require`
  // rules (it uses #eval and ^) but prints the wrong number, so only `expects`
  // can refuse it.
  const wrongValue = await page.evaluate(async () => {
    const { content, checkLesson, engine } = window.leanTutorials;
    const lesson = content.lessonById('eval');
    const wrong = await checkLesson(engine, lesson, '#eval 2 ^ 3');
    const right = await checkLesson(engine, lesson, '#eval 2 ^ 10');
    return {
      wrongRefused: !wrong.ok,
      wrongKind: wrong.kind,
      wrongHeadline: wrong.headline,
      wrongOutput: wrong.output?.[0] ?? '',
      rightOk: right.ok,
      rightOutput: right.output?.[0] ?? '',
    };
  });
  const valueOk = wrongValue.wrongRefused && /output/i.test(wrongValue.wrongHeadline) && wrongValue.wrongOutput.includes('8')
    && wrongValue.rightOk && wrongValue.rightOutput.includes('1024');
  if (!valueOk) failures += 1;
  console.log(`${valueOk ? '✓' : '✗'} required output: '#eval 2 ^ 3' refused (${wrongValue.wrongHeadline} — output ${wrongValue.wrongOutput}), '#eval 2 ^ 10' accepted (${wrongValue.rightOutput})`);

  // The contract's `require` rule is enforced through the same policy path.
  const requireRule = await page.evaluate(async () => {
    const { content, checkLesson, engine } = window.leanTutorials;
    const lesson = content.lessonById('define');
    const wrong = await checkLesson(engine, lesson, '#eval 42');
    return { kind: wrong.kind, headline: wrong.headline, message: wrong.messages?.[0]?.message ?? '' };
  });
  const requireOk = requireRule.kind === 'policy' && /def double/.test(requireRule.message);
  if (!requireOk) failures += 1;
  console.log(`${requireOk ? '✓' : '✗'} required source: ${requireRule.headline} — ${requireRule.message}`);

  // The index must show the broad structure — themes, topic rows, and the
  // roadmap — since CI runs this suite against the deployed site too.
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.theme');
  const index = await page.evaluate(() => ({
    available: document.querySelectorAll('section.theme:not([data-status="planned"])').length,
    planned: document.querySelectorAll('section.theme[data-status="planned"]').length,
    topics: document.querySelectorAll('.topic-row a').length,
    lessonRows: document.querySelectorAll('li.lesson-item').length,
    plannedTopics: document.querySelectorAll('.planned-topic').length,
    plannedLinks: [...document.querySelectorAll('.planned-topic')].filter((node) => node.closest('a')).length,
    cta: document.querySelector('.cta-row a')?.textContent?.trim() ?? '',
    themes: [...document.querySelectorAll('section.theme:not([data-status="planned"]) .theme-title')].map((node) => node.textContent.replace(/^\d+/, '').trim()),
  }));
  const indexOk = index.available >= 1 && index.planned >= 2 && index.topics >= 5 && index.lessonRows === 0
    && index.plannedTopics >= 6 && index.plannedLinks === 0 && /^(Start|Continue):/.test(index.cta);
  if (!indexOk) failures += 1;
  console.log(`${indexOk ? '✓' : '✗'} index: ${JSON.stringify(index)}`);

  // A blocked or rewritten runtime must produce an actionable error, not a wasm
  // "expected magic word" crash. This is exactly what CI hit when Cloudflare
  // challenged the runner's datacenter IP for the pinned wasm.
  const blocked = await context.newPage();
  await blocked.route('**/lean-wasm/lean.wasm*', (route) => route.fulfill({
    status: route.request().method() === 'HEAD' ? 200 : 502,
    headers: { 'content-type': route.request().method() === 'HEAD' ? 'text/html' : 'text/plain' },
    body: route.request().method() === 'HEAD' ? '' : 'upstream 403',
  }));
  await blocked.goto(`${base}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });
  await blocked.waitForFunction(
    () => window.leanTutorials?.engine?.state === 'error',
    null,
    { timeout: 60000 },
  );
  const blockedMessage = await blocked.evaluate(() => window.leanTutorials.engine.error?.message ?? '');
  const blockedOk = /not application\/wasm/.test(blockedMessage) && !/magic word/.test(blockedMessage);
  if (!blockedOk) failures += 1;
  console.log(`${blockedOk ? '✓' : '✗'} blocked runtime reports why: ${blockedMessage.slice(0, 130)}`);
  await blocked.close();

  await context.close();
} catch (error) {
  failures += 1;
  console.error(`✗ ${error.stack || error}`);
} finally {
  shutdown();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
