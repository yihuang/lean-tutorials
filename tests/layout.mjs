// Mobile layout assertions. No runtime needed: the shell renders before Lean is
// ready, so this is fast and independent of the wasm download.
//
//   node tests/layout.mjs [--port 8795] [--url http://localhost:8788]
//
// Checks the things that actually break a code editor on a phone: horizontal
// overflow, tap-target sizes, the 16px focus-zoom threshold, and that the
// actions row is where a thumb can reach it.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { isolateStorage, launchProfile } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8795));
const externalUrl = argValue('url', '');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));

const base = externalUrl || `http://localhost:${port}`;

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// The shared persistent profile: this test does not need Lean, but the page
// starts it in the background, so a cold profile would still download 47 MB.
const context = await launchProfile(chromium, { viewport: { width: 390, height: 844 } });
await isolateStorage(context);
const page = context.pages()[0] ?? await context.newPage();
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });

const overflow = async (label, target = page) => {
  const metrics = await target.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 4),
  }));
  check(metrics.scrollWidth <= metrics.clientWidth + 1, `${label}: no horizontal overflow`,
    metrics.wide.length ? `wide: ${metrics.wide.join(', ')}` : `${metrics.scrollWidth}px of ${metrics.clientWidth}px`);
};

await overflow('home');
const index = await page.evaluate(() => {
  const themes = [...document.querySelectorAll('section.theme')];
  const available = themes.filter((theme) => theme.dataset.status !== 'planned');
  const planned = themes.filter((theme) => theme.dataset.status === 'planned');
  const rows = [...document.querySelectorAll('.topic-row a')];
  return {
    themes: themes.length,
    available: available.length,
    planned: planned.length,
    availableTitles: available.map((theme) => theme.querySelector('.theme-title')?.textContent?.replace(/^\d+/, '').trim() ?? ''),
    topics: rows.length,
    lessonRows: document.querySelectorAll('li.lesson-item').length,
    withProgress: rows.filter((row) => /^\d+\/\d+$/.test(row.querySelector('.topic-count')?.textContent ?? '')).length,
    withBar: rows.filter((row) => row.querySelector('.topic-bar > i') !== null).length,
    tapHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
    cta: document.querySelector('.cta-row a')?.textContent?.trim() ?? '',
    plannedTopics: document.querySelectorAll('.planned-topic').length,
    plannedLinks: [...document.querySelectorAll('.planned-topic')].filter((node) => node.closest('a')).length,
    plannedChips: document.querySelectorAll('.planned-chip').length,
  };
});
check(index.themes >= 2 && index.available >= 1 && index.planned >= 2, 'index: themes, with the roadmap separate',
  `${index.available} available + ${index.planned} planned (${index.availableTitles.join(', ')})`);
check(index.topics >= 5 && index.withProgress === index.topics && index.withBar === index.topics,
  'index: every topic row shows progress', `${index.topics} rows`);
// The whole point of the redesign: topics, not lessons, on the index.
check(index.lessonRows === 0, 'index: no lesson rows (lessons live on the topic page)', `${index.lessonRows} found`);
check(index.tapHeight >= 44, 'index: topic rows are tappable', `${index.tapHeight}px`);
check(/^(Start|Continue):/.test(index.cta), 'index: a single next-step call to action', index.cta);
check(index.plannedTopics >= 6 && index.plannedLinks === 0 && index.plannedChips >= 2,
  'index: roadmap entries are announced but not clickable',
  `${index.plannedTopics} planned topics, ${index.plannedLinks} inside links, ${index.plannedChips} chips`);

// Topic page: the topic's own lessons, and the way back to all topics.
await page.evaluate(() => { location.hash = '#/topic/logic'; });
await page.waitForSelector('li.lesson-item');
await overflow('topic');
const topicPage = await page.evaluate(() => ({
  rows: document.querySelectorAll('li.lesson-item').length,
  heading: document.querySelector('h1')?.textContent ?? '',
  back: document.querySelector('.eyebrow a')?.getAttribute('href') ?? '',
  cta: document.querySelector('a.btn.primary')?.textContent?.trim() ?? '',
}));
check(topicPage.rows >= 3 && topicPage.heading === 'Logic', 'topic page lists its lessons', `${topicPage.heading}: ${topicPage.rows} lessons`);
check(topicPage.back === '#/', 'topic page links back to all topics', topicPage.back);
check(/→$/.test(topicPage.cta), 'topic page offers a start/continue button', topicPage.cta);

await page.evaluate(() => { location.hash = '#/lesson/and'; });
await page.waitForSelector('textarea.editor');
await overflow('lesson');

const lessonMetrics = await page.evaluate(() => {
  const editor = document.querySelector('textarea.editor');
  const check = document.querySelector('.actions .btn.primary');
  const symbols = [...document.querySelectorAll('.symbols button')];
  const actions = document.querySelector('.actions');
  return {
    editorFont: parseFloat(getComputedStyle(editor).fontSize),
    editorWidth: editor.getBoundingClientRect().width,
    editorValue: editor.value,
    placeholder: editor.getAttribute('placeholder') ?? '',
    checkHeight: check.getBoundingClientRect().height,
    symbolHeights: symbols.map((button) => button.getBoundingClientRect().height),
    symbolsScrollable: document.querySelector('.symbols').scrollWidth > document.querySelector('.symbols').clientWidth,
    actionsPosition: getComputedStyle(actions).position,
  };
});
// The prompt must be a placeholder: an empty editor means there is nothing to
// select and delete before starting to type.
check(lessonMetrics.editorValue === '', 'lesson: editor starts empty', JSON.stringify(lessonMetrics.editorValue));
check(lessonMetrics.placeholder.length > 8, 'lesson: empty editor shows a placeholder prompt', lessonMetrics.placeholder);
check(lessonMetrics.editorFont >= 16, 'lesson: editor font ≥ 16px (no iOS focus zoom)', `${lessonMetrics.editorFont}px`);
check(lessonMetrics.editorWidth > 300, 'lesson: editor fills the width', `${Math.round(lessonMetrics.editorWidth)}px`);
check(lessonMetrics.checkHeight >= 44, 'lesson: Check button ≥ 44px', `${Math.round(lessonMetrics.checkHeight)}px`);
check(lessonMetrics.symbolHeights.every((height) => height >= 32), 'lesson: symbol buttons ≥ 32px', `${lessonMetrics.symbolHeights.length} buttons`);
check(lessonMetrics.symbolsScrollable, 'lesson: symbol bar scrolls horizontally');
check(lessonMetrics.actionsPosition === 'sticky', 'lesson: actions stick to the bottom on phones', lessonMetrics.actionsPosition);

// The header chip must work on every view, not just the home page.
await page.click('#engine-chip');
const panel = await page.evaluate(() => {
  const node = document.querySelector('#engine-panel');
  return { visible: node ? getComputedStyle(node).display !== 'none' : false, text: (node?.textContent ?? '').replace(/\s+/g, ' ').trim() };
});
check(panel.visible && panel.text.length > 30, 'lesson: engine chip opens the status panel', panel.text.slice(0, 70));

// The infoview: above the editor on a phone, height-capped, collapsible, and it
// must not introduce horizontal overflow however long a hypothesis is.
const infoview = await page.evaluate(() => {
  const panel = document.querySelector('.infoview');
  const editor = document.querySelector('textarea.editor');
  const body = document.querySelector('.infoview-body');
  return {
    present: Boolean(panel),
    aboveEditor: Boolean(panel) && panel.getBoundingClientRect().bottom <= editor.getBoundingClientRect().top + 1,
    role: panel?.getAttribute('role') ?? '',
    label: panel?.getAttribute('aria-label') ?? '',
    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
    viewport: window.innerHeight,
    collapsed: panel?.dataset.collapsed ?? '',
    toggleLabel: document.querySelector('.infoview-toggle')?.getAttribute('aria-expanded') ?? '',
  };
});
check(infoview.present && infoview.aboveEditor, 'infoview sits directly above the editor on a phone');
check(infoview.role === 'region' && infoview.label.length > 5, 'infoview is a labelled region', infoview.label);
check(infoview.bodyHeight > 0 && infoview.bodyHeight <= infoview.viewport * 0.4, 'infoview is height-capped', `${infoview.bodyHeight}px of ${infoview.viewport}px`);

await page.click('.infoview-toggle');
const collapsedState = await page.evaluate(() => ({
  collapsed: document.querySelector('.infoview')?.dataset.collapsed,
  expanded: document.querySelector('.infoview-toggle')?.getAttribute('aria-expanded'),
  bodyHidden: getComputedStyle(document.querySelector('.infoview-body')).display === 'none',
  headerVisible: document.querySelector('.infoview-head').getBoundingClientRect().height > 0,
}));
check(collapsedState.collapsed === 'true' && collapsedState.bodyHidden && collapsedState.headerVisible,
  'infoview collapses to its header', JSON.stringify(collapsedState));

// A long hypothesis must wrap, not widen the page.
const longHyp = await page.evaluate(async () => {
  const panel = document.querySelector('.infoview');
  panel.dataset.collapsed = 'false';
  const body = panel.querySelector('.infoview-body');
  body.innerHTML = '<div class="goal-card"><div class="goal-hyps">' +
    '<span class="hyp">h : ' + 'x'.repeat(120) + '.repeat(6)</span></div>' +
    '<div class="goal-target"><span class="turnstile">⊢</span> ' + 'y'.repeat(120) + '</div></div>';
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
});
check(longHyp.scrollWidth <= longHyp.clientWidth + 1, 'infoview wraps long hypotheses instead of widening the page',
  `${longHyp.scrollWidth}px of ${longHyp.clientWidth}px`);
await page.click('.infoview-toggle');

// A lesson already in the solved set must show the way onward straight away
// (seeded before the app reads storage, so no proof has to run).
const solvedPage = await context.newPage();
await solvedPage.addInitScript(() => {
  try {
    localStorage.setItem('lean-tutorials:v1', JSON.stringify({ solved: { rfl: true }, drafts: {}, sandbox: '' }));
  } catch { /* ignore */ }
});
await solvedPage.goto(`${base}/#/lesson/rfl`, { waitUntil: 'domcontentloaded' });
await solvedPage.waitForSelector('textarea.editor');
const cta = await solvedPage.evaluate(() => {
  const next = document.querySelector('.actions .next-step');
  const tick = document.querySelector('.lesson-tick');
  return {
    visible: Boolean(next) && !next.hidden,
    text: (next?.textContent ?? '').trim(),
    height: next ? Math.round(next.getBoundingClientRect().height) : 0,
    homeTick: Boolean(tick),
  };
});
check(cta.visible && /^Next:/.test(cta.text), 'solved lesson offers the next step in the action row', cta.text);
check(cta.height >= 44, 'solved lesson: next step is thumb-sized', `${cta.height}px`);
// Three buttons in the sticky row must still fit a 390px phone.
await overflow('solved lesson', solvedPage);
await solvedPage.close();

// The unicode abbreviation path a phone user relies on.
await page.fill('textarea.editor', 'exact \\forall');
await page.dispatchEvent('textarea.editor', 'input');
const expanded = await page.inputValue('textarea.editor');
check(expanded === 'exact ∀', 'lesson: \\forall expands while typing', JSON.stringify(expanded));

await page.click('.symbols button:nth-child(4)');
const withSymbol = await page.inputValue('textarea.editor');
check(withSymbol.includes('∧'), 'lesson: symbol bar inserts into the editor', JSON.stringify(withSymbol.slice(-12)));

await page.evaluate(() => { location.hash = '#/sandbox'; });
await page.waitForSelector('textarea.editor');
await overflow('sandbox');

// Desktop should keep the actions inline rather than sticky.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.editor');
const desktopPosition = await page.evaluate(() => getComputedStyle(document.querySelector('.actions')).position);
check(desktopPosition === 'static', 'desktop: actions stay inline', desktopPosition);

// Dark mode renders and keeps contrast (spot check on the body background).
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(`${base}/#/lesson/rfl`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.editor');
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(darkBg !== 'rgb(251, 250, 247)', 'dark mode: background switches', darkBg);

await context.close();
server?.kill('SIGTERM');
console.log(failures.length === 0 ? '\nLayout checks passed.' : `\n${failures.length} layout check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
