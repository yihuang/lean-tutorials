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
    topicSummaries: [...document.querySelectorAll('.topic-desc')].map((node) => node.textContent),
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
check(!index.topicSummaries.some((text) => text.includes('`')), 'index: topic summaries render markup, not backticks',
  index.topicSummaries[0]?.slice(0, 60) ?? '');
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

// The lesson rows must actually be styled: a stylesheet block was once deleted
// while the markup stayed, so the topic pages rendered as bare text.
const rowStyle = await page.evaluate(() => {
  const row = document.querySelector('li.lesson-item a');
  const num = document.querySelector('li.lesson-item .lesson-num');
  const code = document.querySelector('li.lesson-item .lesson-sub code');
  const cs = getComputedStyle(row);
  return {
    display: cs.display,
    borderWidth: cs.borderTopWidth,
    radius: parseFloat(cs.borderRadius) || 0,
    height: Math.round(row.getBoundingClientRect().height),
    numWidth: num ? Math.round(num.getBoundingClientRect().width) : 0,
    codeFont: code ? getComputedStyle(code).fontFamily.slice(0, 10) : '',
    // Every row, not just the first: the literal-backtick bug was in row four.
    summaries: [...document.querySelectorAll('li.lesson-item .lesson-sub')].map((node) => node.textContent),
  };
});
check(rowStyle.display === 'flex' && rowStyle.borderWidth === '1px' && rowStyle.radius >= 8 && rowStyle.height >= 44,
  'topic page: lesson rows keep their card styling', JSON.stringify(rowStyle));
check(rowStyle.numWidth >= 24 && rowStyle.codeFont.length > 0, 'topic page: number badge and focus chip are styled',
  `${rowStyle.numWidth}px, ${rowStyle.codeFont}…`);
// Summaries carry markdown; it must render as markup, not as literal backticks.
const backticked = rowStyle.summaries.filter((text) => text.includes('`'));
check(backticked.length === 0, 'topic page: summaries render markup, not backticks',
  backticked.length ? backticked[0].slice(0, 70) : `${rowStyle.summaries.length} rows checked`);
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

// ---------------------------------------------------------------- focus mode
// The immersive editing mode, measured at 390x844 — the size where "it works on
// my laptop" stops being evidence. This is the layout half; browser-check.mjs
// runs the same mode against the real Lean runtime.
await page.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.editor');
// A same-fragment goto does not re-render, so start from a known scroll position.
await page.evaluate(() => window.scrollTo(0, 0));

const focusGeometry = () => page.evaluate(() => {
  const box = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height), width: Math.round(rect.width) };
  };
  const sheet = document.querySelector('main');
  const check = document.querySelector('.actions .btn.primary');
  const checkRect = check.getBoundingClientRect();
  const hit = document.elementFromPoint(checkRect.left + checkRect.width / 2, checkRect.top + checkRect.height / 2);
  return {
    focus: document.documentElement.dataset.focus ?? 'false',
    viewport: { height: window.innerHeight, width: window.innerWidth },
    sheet: box('main'),
    sheetOverflow: Math.round(sheet.scrollHeight - sheet.clientHeight),
    editor: box('textarea.editor'),
    infoview: box('.infoview'),
    check: box('.actions .btn.primary'),
    checkHit: String(hit?.className ?? hit?.tagName ?? ''),
    statement: box('.card > .statement'),
    topbar: getComputedStyle(document.querySelector('.topbar')).display,
    enginePanel: getComputedStyle(document.querySelector('#engine-panel')).display,
    nav: getComputedStyle(document.querySelector('.lesson-nav')).display,
    hint: getComputedStyle(document.querySelector('details.hint')).display,
    prose: getComputedStyle(document.querySelector('main > h1')).display,
    scrollY: Math.round(window.scrollY),
  };
});

const toggleButton = await page.evaluate(() => {
  const button = document.querySelector('.focus-toggle');
  const rect = button.getBoundingClientRect();
  return {
    width: Math.round(rect.width), height: Math.round(rect.height),
    pressed: button.getAttribute('aria-pressed'), glyph: button.textContent.trim(),
  };
});
check(toggleButton.width >= 44 && toggleButton.height >= 44 && toggleButton.pressed === 'false' && toggleButton.glyph.length > 0,
  'focus: the toggle is a 44px target with a glyph and aria-pressed', JSON.stringify(toggleButton));

const normal = await focusGeometry();
check(normal.focus === 'false' && normal.topbar === 'flex' && normal.editor.height > 120,
  'focus: off by default, with the normal chrome', `editor ${normal.editor.height}px, top bar ${normal.topbar}`);

// Entering from a scrolled page must not disturb the page behind the sheet.
await page.evaluate(() => window.scrollTo(0, 260));
// Clicked in-page: Playwright's own click would scroll the button into view
// first (the editor header can sit below the fold once the goals panel grows),
// which is a test artefact, not what a reader does.
await page.evaluate(() => document.querySelector('.focus-toggle').click());
await page.waitForFunction(() => document.documentElement.dataset.focus === 'true');
await overflow('focus mode');
const focused = await focusGeometry();

// The numbers the brief asks for, printed rather than only asserted.
console.log(`  focus mode @390x844: sheet ${focused.sheet.height}px of ${focused.viewport.height}px ` +
  `(top ${focused.sheet.top}px), editor ${normal.editor.height}px → ${focused.editor.height}px, ` +
  `goals ${focused.infoview.height}px, statement strip ${focused.statement.height}px, Check ${focused.check.height}px`);

check(focused.focus === 'true' && focused.topbar === 'none' && focused.nav === 'none' && focused.hint === 'none'
  && focused.prose === 'none' && focused.enginePanel === 'none',
  'focus: the mode hides the top bar, the prose, the hints, the lesson nav and the engine panel', JSON.stringify({
    topbar: focused.topbar, prose: focused.prose, hint: focused.hint, nav: focused.nav, enginePanel: focused.enginePanel,
  }));
check(focused.sheet.height >= focused.viewport.height - 1 && focused.sheet.top === 0,
  'focus: the mode fills the viewport', `${focused.sheet.height}px of ${focused.viewport.height}px from y=${focused.sheet.top}`);
check(focused.editor.height > normal.editor.height + 100,
  'focus: the editor gets the space', `${normal.editor.height}px → ${focused.editor.height}px`);
check(focused.infoview !== null && focused.infoview.height >= 44 && focused.infoview.bottom <= focused.viewport.height,
  'focus: the goals panel is still on screen', focused.infoview ? `${focused.infoview.height}px, ends at ${focused.infoview.bottom}px` : 'missing');
check(focused.statement !== null && focused.statement.height <= 44 && focused.statement.top < focused.viewport.height / 3,
  'focus: the statement is a compact strip that stays at the top', focused.statement ? `${focused.statement.height}px at y=${focused.statement.top}` : 'missing');
check(focused.check.height >= 44 && focused.check.bottom <= focused.viewport.height + 1 && focused.checkHit.includes('btn'),
  'focus: Check is ≥ 44px, on screen and topmost', `${focused.check.height}px, bottom ${focused.check.bottom}px, hit ${focused.checkHit}`);

// The page behind the sheet must not scroll: only the panels inside it may.
const scrollLock = await page.evaluate(() => {
  window.scrollBy(0, 600);
  const sheet = document.querySelector('main');
  const scroller = document.scrollingElement;
  return {
    y: Math.round(window.scrollY),
    documentOverflow: Math.round(scroller.scrollHeight - scroller.clientHeight),
    contentFits: sheet.scrollHeight - sheet.clientHeight <= 1,
  };
});
check(scrollLock.y === 0 && scrollLock.documentOverflow === 0 && scrollLock.contentFits,
  'focus: the page body does not scroll in the mode (and nothing is clipped)',
  `scrollY ${scrollLock.y}px after scrollBy(0,600), document overflow ${scrollLock.documentOverflow}px, sheet overflow ${scrollLock.contentFits ? 0 : 'yes'}`);

// The sheet is driven by the measured viewport, not only by dvh: this is the
// hook the soft keyboard uses (iOS shrinks the visual viewport, not the layout
// one), so a short viewport must keep the editor and Check on screen.
await page.setViewportSize({ width: 390, height: 430 });
await page.waitForTimeout(120);
const keyboard = await focusGeometry();
console.log(`  focus mode @390x430 (soft-keyboard-ish): sheet ${keyboard.sheet.height}px, ` +
  `editor ${keyboard.editor.height}px, goals ${keyboard.infoview.height}px, Check bottom ${keyboard.check.bottom}px`);
check(keyboard.sheet.height <= keyboard.viewport.height + 1 && keyboard.check.bottom <= keyboard.viewport.height + 1
  && keyboard.editor.height >= 44 && keyboard.sheetOverflow <= 1,
  'focus: a short viewport keeps the editor usable and Check on screen', JSON.stringify({
    sheet: keyboard.sheet.height, viewport: keyboard.viewport.height, editor: keyboard.editor.height,
    checkBottom: keyboard.check.bottom, clipped: keyboard.sheetOverflow,
  }));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(120);

await page.click('.focus-exit');
await page.waitForFunction(() => document.documentElement.dataset.focus === 'false');
const restored = await focusGeometry();
const focusReturned = await page.evaluate(() => String(document.activeElement?.className ?? ''));
const toggleInView = await page.evaluate(() => {
  const rect = document.querySelector('.focus-toggle').getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
});
check(restored.focus === 'false' && restored.topbar === 'flex' && Math.abs(restored.editor.height - normal.editor.height) <= 2,
  'focus: exiting restores the normal page', `editor ${focused.editor.height}px → ${restored.editor.height}px, top bar ${restored.topbar}`);
check(focusReturned.includes('focus-toggle') && toggleInView,
  'focus: focus returns to the toggle on exit, and it is on screen', `${focusReturned || '(body)'}, in view ${toggleInView}`);

// The remembered choice: seeded before the app boots, so no proof has to run.
const focusPage = await context.newPage();
await focusPage.addInitScript(() => {
  try {
    localStorage.setItem('lean-tutorials:v1', JSON.stringify({ solved: {}, drafts: {}, sandbox: '', focusMode: true }));
  } catch { /* ignore */ }
});
await focusPage.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
await focusPage.waitForSelector('textarea.editor');
const remembered = await focusPage.evaluate(() => ({
  focus: document.documentElement.dataset.focus,
  topbar: getComputedStyle(document.querySelector('.topbar')).display,
  bar: document.querySelector('.focus-bar')?.getAttribute('aria-label') ?? '',
  title: document.querySelector('.focus-title')?.textContent ?? '',
  pressed: document.querySelector('.focus-toggle').getAttribute('aria-pressed'),
  active: String(document.activeElement?.tagName ?? ''),
}));
check(remembered.focus === 'true' && remembered.topbar === 'none' && remembered.pressed === 'true'
  && remembered.bar === 'Focus mode' && remembered.title.length > 0 && remembered.active === 'TEXTAREA',
  'focus: a remembered mode is applied when the lesson renders, focus in the editor', JSON.stringify(remembered));

await focusPage.keyboard.press('Escape');
await focusPage.waitForFunction(() => document.documentElement.dataset.focus === 'false');
const escaped = await focusPage.evaluate(() => ({
  focus: document.documentElement.dataset.focus,
  active: String(document.activeElement?.className ?? ''),
  stored: JSON.parse(localStorage.getItem('lean-tutorials:v1')).focusMode,
}));
check(escaped.focus === 'false' && escaped.stored === false && escaped.active.includes('focus-toggle'),
  'focus: Esc leaves the mode, remembers it, and hands focus back', JSON.stringify(escaped));

await focusPage.keyboard.press('Control+Shift+I');
await focusPage.waitForFunction(() => document.documentElement.dataset.focus === 'true');
const shortcut = await focusPage.evaluate(() => ({
  pressed: document.querySelector('.focus-toggle').getAttribute('aria-pressed'),
  stored: JSON.parse(localStorage.getItem('lean-tutorials:v1')).focusMode,
  active: String(document.activeElement?.className ?? ''),
}));
check(shortcut.pressed === 'true' && shortcut.stored === true && shortcut.active === 'editor',
  'focus: Ctrl/Cmd+Shift+I enters (same result as the button)', JSON.stringify(shortcut));

// The choice survives a lesson change, which is the point of remembering it.
await focusPage.evaluate(() => { location.hash = '#/lesson/rfl'; });
await focusPage.waitForFunction(() => document.documentElement.dataset.focus === 'true' && document.querySelector('.focus-title')?.textContent === 'A proof is a value');
const nextLesson = await focusPage.evaluate(() => ({
  focus: document.documentElement.dataset.focus,
  title: document.querySelector('.focus-title').textContent,
  top: Math.round(document.querySelector('main').getBoundingClientRect().top),
}));
check(nextLesson.focus === 'true' && nextLesson.top === 0, 'focus: moving to the next lesson keeps the mode', JSON.stringify(nextLesson));

// Entering from a scrolled page freezes the document behind the sheet: the
// root's overflow:hidden clamps the scroll back to 0 (invisibly — the sheet is
// opaque), so nothing behind the mode can move while it is up.
await focusPage.click('.focus-exit');
await focusPage.evaluate(() => window.scrollTo(0, 320));
const scrollBefore = await focusPage.evaluate(() => Math.round(window.scrollY));
await focusPage.evaluate(() => document.querySelector('.focus-toggle').click());
await focusPage.waitForFunction(() => document.documentElement.dataset.focus === 'true');
const scrolled = await focusPage.evaluate(() => ({
  sheet: Math.round(document.querySelector('main').getBoundingClientRect().top),
  page: Math.round(window.scrollY),
}));
await focusPage.click('.focus-exit');
await focusPage.waitForFunction(() => document.documentElement.dataset.focus === 'false');
check(scrolled.sheet === 0 && scrolled.page === 0 && scrollBefore > 0,
  'focus: the mode freezes the page behind it',
  `page was at ${scrollBefore}px; sheet top ${scrolled.sheet}px, document scroll clamped to ${scrolled.page}px`);
await focusPage.close();

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
