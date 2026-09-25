// Layout snapshots for eyeballing the mobile and desktop rendering.
//   node tests/screenshots.mjs [--url http://localhost:8788] [--out /tmp/shots]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8796));
const externalUrl = argValue('url', '');
const out = argValue('out', '/tmp/shots');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(homedir(), '.cache', 'ms-playwright');
const chrome = readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()
  .map((entry) => join(cache, entry, 'chrome-linux64/chrome')).find(existsSync);

mkdirSync(out, { recursive: true });
const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const base = externalUrl || `http://localhost:${port}`;

async function boot(page) {
  await page.goto(`${base}/?mem=768`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.leanTutorials?.engine?.state === 'ready', null, { timeout: 900000 });
}

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone = await mobile.newPage();
await boot(phone);
await phone.waitForTimeout(300);
await phone.screenshot({ path: join(out, 'mobile-home.png'), fullPage: true });

// A stuck learner: two open goals with their context.
await phone.evaluate(() => { location.hash = '#/lesson/and'; });
await phone.waitForSelector('textarea.editor');
await phone.fill('textarea.editor', 'constructor');
await phone.click('button.btn.primary');
await phone.waitForSelector('.goals .goal');
await phone.waitForTimeout(300);
await phone.screenshot({ path: join(out, 'mobile-open-goals.png'), fullPage: true });

// A finished lesson.
await phone.evaluate(() => { location.hash = '#/lesson/rfl'; });
await phone.waitForSelector('textarea.editor');
await phone.fill('textarea.editor', 'rfl');
await phone.click('button.btn.primary');
await phone.waitForSelector('.banner.ok');
await phone.waitForTimeout(200);
await phone.screenshot({ path: join(out, 'mobile-verified.png'), fullPage: true });
await mobile.close();

const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await desktop.newPage();
await boot(page);await page.evaluate(() => { location.hash = '#/lesson/induction'; });
await page.waitForSelector('textarea.editor');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'desktop-lesson.png'), fullPage: true });

await browser.close();
server?.kill('SIGTERM');
console.log(`wrote ${readdirSync(out).join(', ')} to ${out}`);
