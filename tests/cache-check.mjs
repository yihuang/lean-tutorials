// How many bytes does a *repeat* visit transfer? A cold visit pays ~47 MB; every
// visit after that must cost nothing but a little revalidation.
//
//   node tests/cache-check.mjs [--url https://lean-tutorials.pages.dev] [--fresh]
//
// Uses the shared persistent profile (tests/.artifacts/chrome-profile), so this
// test is also what keeps local runs from re-downloading Lean every time.
// Evidence is layered, because the wasm is fetched inside the Web Worker:
//   1. the engine's own resource-timing numbers for the packed core,
//   2. Playwright's per-response sizes (it does report worker requests),
//   3. the server's byte log, when we are the server (--log-bytes).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { launchProfile, resetProfile, waitForEngine } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8793));
const dir = argValue('dir', 'dist');
const externalUrl = argValue('url', '');
const visits = Number(argValue('visits', 3));
if (args.includes('--fresh')) resetProfile();

let serverLog = '';
const server = externalUrl ? null : spawn(
  process.execPath,
  ['scripts/serve.mjs', '--dir', dir, '--port', String(port), '--log-bytes'],
  { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] },
);
server?.stdout.on('data', (chunk) => { serverLog += chunk; });
server?.stderr.on('data', (chunk) => process.stderr.write(`[serve] ${chunk}`));
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));
const base = externalUrl || `http://localhost:${port}`;

const RUNTIME = /\/lean-wasm\//;

async function visit(label) {
  serverLog = '';
  const context = await launchProfile(chromium, { viewport: { width: 900, height: 800 } });
  const page = context.pages()[0] ?? await context.newPage();

  const seen = new Map();
  page.on('response', (response) => {
    const url = response.url();
    if (!RUNTIME.test(url)) return;
    const key = url.replace(/^.*\/lean-wasm\//, '').replace(/\?.*$/, '');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });

  const started = Date.now();
  await page.goto(`${base}/?mem=768`, { waitUntil: 'domcontentloaded' });
  // Phase timeline: wasm compile/instantiate, then packed-core staging, then the
  // Init import — so "warm start" can be attributed rather than guessed.
  const phases = [];
  for (const state of ['staging', 'importing', 'ready']) {
    try {
      await page.waitForFunction(
        (expected) => window.leanTutorials?.engine?.state === expected,
        state,
        { timeout: 10 * 60 * 1000, polling: 100 },
      );
      phases.push(`${state} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch {
      phases.push(`${state} timeout`);
      break;
    }
  }
  const engine = await waitForEngine(page);
  const bootSeconds = (Date.now() - started) / 1000;
  await page.waitForTimeout(1500);

  // Playwright's per-request sizes: responseBodySize is the encoded body length,
  // i.e. 0 when the response came from the browser cache.
  const sizes = await page.evaluate(async () => {
    const entries = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/lean-wasm/'));
    // The engine HEAD-probes lean.wasm first, so one URL can have two entries:
    // keep the largest (the GET) or a 300-byte HEAD would masquerade as a fetch.
    const byName = new Map();
    for (const entry of entries) {
      const name = entry.name.replace(/^.*\/lean-wasm\//, '').replace(/\?.*$/, '');
      const previous = byName.get(name);
      if (!previous || entry.decodedBodySize > previous.decoded) {
        byName.set(name, { name, transfer: entry.transferSize, decoded: entry.decodedBodySize });
      }
    }
    return [...byName.values()];
  });

  const serverLines = serverLog.split('\n').filter((line) => line.startsWith('[bytes]'));
  const serverBytes = serverLines.reduce((sum, line) => sum + Number(line.split(' ')[3]), 0);

  await context.close();
  return { label, engine, bootSeconds, phases, sizes, serverLines, serverBytes, responses: seen };
}

const results = [];
for (let index = 1; index <= visits; index += 1) {
  results.push(await visit(index === 1 ? 'visit 1 (cold)' : `visit ${index}`));
}

console.log('');
for (const result of results) {
  const core = result.engine.network;
  console.log(`${result.label}: Lean ready in ${result.bootSeconds.toFixed(1)}s (${result.phases.join(' → ')})`);
  if (result.engine.timeline?.length) {
    const marks = result.engine.timeline;
    const step = (a, b) => `${b - a}ms`;
    const parts = [];
    for (let index = 1; index < marks.length; index += 1) {
      parts.push(`${marks[index].phase} +${step(marks[index - 1].at, marks[index].at)}`);
    }
    console.log(`   timeline: ${marks[0].phase}@${marks[0].at} ${parts.join('  ')}`);
  }
  console.log(`   engine:  ${(core.downloaded / 1048576).toFixed(2)} MB of Lean core downloaded, ${(core.cached / 1048576).toFixed(2)} MB from browser cache`);
  if (result.sizes.length > 0) {
    console.log(`   timing:  ${result.sizes.map((entry) => `${entry.name}=${entry.transfer}B`).join(' ')}`);
  }
  if (server) {
    console.log(`   server:  ${result.serverLines.length} runtime responses, ${(result.serverBytes / 1048576).toFixed(2)} MB served`);
  }
  console.log(`   worker:  Lean reported ${result.engine.state} — ${result.engine.detail ?? result.engine.message}`);
  const responses = [...result.responses.entries()];
  if (responses.length > 0) {
    console.log(`   requests: ${responses.map(([key, count]) => `${key}×${count}`).join(' ')}`);
  }
}

const warm = results.slice(1);
const worstCore = Math.max(...warm.map((result) => result.engine.network.downloaded));
const worstServer = server ? Math.max(...warm.map((result) => result.serverBytes)) : 0;
const failures = [];
if (worstCore > 0) failures.push(`core layer re-downloaded ${(worstCore / 1048576).toFixed(2)} MB on a repeat visit`);
if (worstServer > 0) failures.push(`server served ${(worstServer / 1048576).toFixed(2)} MB of runtime on a repeat visit`);
if (warm.some((result) => result.engine.state !== 'ready')) failures.push('Lean did not start on a repeat visit');

console.log('');
if (failures.length === 0) {
  console.log(`✓ repeat visits: 0 bytes of Lean downloaded (cold visit: ${(results[0].engine.network.downloaded / 1048576).toFixed(1)} MB of core` +
    `${server ? `, ${(results[0].serverBytes / 1048576).toFixed(1)} MB total served` : ''}), Lean still starts`);
} else {
  for (const failure of failures) console.log(`✗ ${failure}`);
}
server?.kill('SIGTERM');
process.exit(failures.length === 0 ? 0 : 1);
