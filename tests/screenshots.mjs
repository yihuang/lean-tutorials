// Layout snapshots for eyeballing the mobile and desktop rendering.
//   node tests/screenshots.mjs [--url http://localhost:8788] [--out /tmp/shots]
//
// Uses the shared persistent profile, so the runtime is not re-downloaded.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { isolateStorage, launchProfile, waitForEngine } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8796));
const externalUrl = argValue('url', '');
const out = argValue('out', '/tmp/shots');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(out, { recursive: true });
const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));
const base = externalUrl || `http://localhost:${port}`;

// One page at a time: each booted page holds a shared wasm memory, and two of
// them do not fit in a small container.
const context = await launchProfile(chromium, { viewport: { width: 390, height: 844 } });
await isolateStorage(context);

async function boot(width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/?mem=768`, { waitUntil: 'domcontentloaded' });
  await waitForEngine(page);
  await page.waitForTimeout(300);
  return page;
}

const phone = await boot(390, 844);
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
await phone.waitForSelector('.result.ok');
await phone.waitForTimeout(200);
await phone.screenshot({ path: join(out, 'mobile-verified.png'), fullPage: true });

// The engine status panel, which reports what this visit downloaded.
await phone.evaluate(() => { location.hash = '#/'; });
await phone.waitForSelector('.lesson-list');
await phone.click('#engine-chip');
await phone.waitForTimeout(200);
await phone.screenshot({ path: join(out, 'mobile-engine-panel.png'), fullPage: true });
await phone.close();

const wide = await boot(1280, 900);
await wide.evaluate(() => { location.hash = '#/lesson/induction'; });
await wide.waitForSelector('textarea.editor');
await wide.waitForTimeout(300);
await wide.screenshot({ path: join(out, 'desktop-lesson.png'), fullPage: true });
await wide.close();

await context.close();
server?.kill('SIGTERM');
console.log(`wrote ${readdirSync(out).filter((name) => name.endsWith('.png')).join(', ')} to ${out}`);
