// Mobile layout assertions. No runtime needed: the shell renders before Lean is
// ready, so this is fast and independent of the wasm download.
//
//   node tests/layout.mjs [--port 8795] [--url http://localhost:8788]
//
// Checks the things that actually break a code editor on a phone: horizontal
// overflow, tap-target sizes, the 16px focus-zoom threshold, and that the
// actions row is where a thumb can reach it.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8795));
const externalUrl = argValue('url', '');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(homedir(), '.cache', 'ms-playwright');
const chrome = readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()
  .map((entry) => join(cache, entry, 'chrome-linux64/chrome')).find(existsSync);

const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const base = externalUrl || `http://localhost:${port}`;

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await phone.newPage();
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });

const overflow = async (label) => {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 4),
  }));
  check(metrics.scrollWidth <= metrics.clientWidth + 1, `${label}: no horizontal overflow`,
    metrics.wide.length ? `wide: ${metrics.wide.join(', ')}` : `${metrics.scrollWidth}px of ${metrics.clientWidth}px`);
};

await overflow('home');
check((await page.$$('li.lesson-item')).length >= 5, 'home: lesson list rendered');
const homeTap = await page.evaluate(() => {
  const link = document.querySelector('li.lesson-item a');
  const rect = link.getBoundingClientRect();
  return { height: rect.height, width: rect.width };
});
check(homeTap.height >= 44, 'home: lesson rows are tappable', `${Math.round(homeTap.height)}px tall`);

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
    checkHeight: check.getBoundingClientRect().height,
    symbolHeights: symbols.map((button) => button.getBoundingClientRect().height),
    symbolsScrollable: document.querySelector('.symbols').scrollWidth > document.querySelector('.symbols').clientWidth,
    actionsPosition: getComputedStyle(actions).position,
  };
});
check(lessonMetrics.editorFont >= 16, 'lesson: editor font ≥ 16px (no iOS focus zoom)', `${lessonMetrics.editorFont}px`);
check(lessonMetrics.editorWidth > 300, 'lesson: editor fills the width', `${Math.round(lessonMetrics.editorWidth)}px`);
check(lessonMetrics.checkHeight >= 44, 'lesson: Check button ≥ 44px', `${Math.round(lessonMetrics.checkHeight)}px`);
check(lessonMetrics.symbolHeights.every((height) => height >= 32), 'lesson: symbol buttons ≥ 32px', `${lessonMetrics.symbolHeights.length} buttons`);
check(lessonMetrics.symbolsScrollable, 'lesson: symbol bar scrolls horizontally');
check(lessonMetrics.actionsPosition === 'sticky', 'lesson: actions stick to the bottom on phones', lessonMetrics.actionsPosition);

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
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const wide = await desktop.newPage();
await wide.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
await wide.waitForSelector('textarea.editor');
const desktopPosition = await wide.evaluate(() => getComputedStyle(document.querySelector('.actions')).position);
check(desktopPosition === 'static', 'desktop: actions stay inline', desktopPosition);

// Dark mode renders and keeps contrast (spot check on the body background).
const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const darkPage = await dark.newPage();
await darkPage.goto(`${base}/#/lesson/rfl`, { waitUntil: 'domcontentloaded' });
const darkBg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(darkBg !== 'rgb(251, 250, 247)', 'dark mode: background switches', darkBg);

await browser.close();
server?.kill('SIGTERM');
console.log(failures.length === 0 ? '\nLayout checks passed.' : `\n${failures.length} layout check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
