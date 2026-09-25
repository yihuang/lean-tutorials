// Inspect the raw diagnostics of the goal-inspection pass for one lesson.
//   node tests/debug-goals.mjs [--lesson induction] [--tactics '...']
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
const port = Number(argValue('port', 8797));
const lessonId = argValue('lesson', 'induction');
const tactics = argValue('tactics', 'induction n with\n| zero => rfl\n| succ k ih => trace_state');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(homedir(), '.cache', 'ms-playwright');
const chrome = readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()
  .map((entry) => join(cache, entry, 'chrome-linux64/chrome')).find(existsSync);

const server = spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'site', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/?mem=768`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.leanTutorials?.engine?.state === 'ready', null, { timeout: 900000 });

const dump = await page.evaluate(async ({ lessonId, tactics }) => {
  const { engine, LESSONS } = window.leanTutorials;
  const source = await import('/src/lean/source.js');
  const lesson = LESSONS.find((entry) => entry.id === lessonId);
  const preview = source.buildSource(lesson, tactics, { preview: true });
  const run = await engine.compile(preview.code);
  return {
    source: preview.code,
    lines: run.output.flatMap((chunk) => String(chunk.data).split('\n')).filter((line) => line.trim()),
  };
}, { lessonId, tactics });

console.log('--- generated source ---');
console.log(dump.source);
console.log('--- diagnostics ---');
for (const line of dump.lines) {
  try {
    const parsed = JSON.parse(line);
    console.log(JSON.stringify({ severity: parsed.severity, kind: parsed.kind, caption: parsed.caption, line: parsed.pos?.line, data: String(parsed.data).slice(0, 400) }, null, 1));
  } catch {
    console.log(`RAW: ${line.slice(0, 400)}`);
  }
}

await browser.close();
server.kill('SIGTERM');
