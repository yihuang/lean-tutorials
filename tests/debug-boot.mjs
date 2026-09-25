// Ad-hoc boot diagnostics: watch the engine state, console and runtime
// requests while the runtime comes up.
//   node tests/debug-boot.mjs [--port 8799] [--mem 768] [--seconds 600]
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
const port = Number(argValue('port', 8799));
const mem = argValue('mem', '768');
const seconds = Number(argValue('seconds', 600));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  return readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()
    .map((entry) => join(cache, entry, 'chrome-linux64/chrome'))
    .find(existsSync);
}

const server = spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'site', '--port', String(port)], { cwd: root, stdio: 'ignore' });
const shutdown = () => server.kill('SIGTERM');
process.on('exit', shutdown);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(700);

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`console.${m.type()}: ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => console.log(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', async (r) => {
  if (r.url().includes('/lean-wasm/')) {
    console.log(`response: ${r.status()} ${r.url().replace(`http://localhost:${port}`, '')}`);
  }
});

console.log('--- navigating');
await page.goto(`http://localhost:${port}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });

const deadline = Date.now() + seconds * 1000;
let last = '';
while (Date.now() < deadline) {
  const snapshot = await page.evaluate(() => {
    const engine = window.leanTutorials?.engine;
    if (!engine) return { missing: true, shared: typeof SharedArrayBuffer };
    return {
      state: engine.state,
      message: engine.progress.message,
      percent: engine.progress.percent,
      error: engine.error?.message ?? null,
      shared: typeof SharedArrayBuffer,
      isolated: window.crossOriginIsolated,
      loaded: engine.loadedPaths.size,
    };
  }).catch((error) => ({ evaluateError: String(error) }));
  const line = JSON.stringify(snapshot);
  if (line !== last) { console.log(`[t+${Math.round((Date.now() - (deadline - seconds * 1000)) / 1000)}s] ${line}`); last = line; }
  if (snapshot.state === 'ready' || snapshot.state === 'error') break;
  await wait(3000);
}

console.log('--- final');
console.log(JSON.stringify(await page.evaluate(() => {
  const engine = window.leanTutorials?.engine;
  return {
    state: engine?.state, message: engine?.progress?.message, loaded: engine?.loadedPaths?.size,
    error: engine?.error?.message ?? null,
    shared: typeof SharedArrayBuffer, isolated: window.crossOriginIsolated,
  };
}), null, 2));
await browser.close();
shutdown();
