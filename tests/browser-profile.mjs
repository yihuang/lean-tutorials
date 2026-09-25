// Shared Chromium profile for the browser tests.
//
// A fresh browser context pays for the whole runtime every run (~47 MB, ~20 s
// boot on a cold cache). The tests use ONE persistent profile instead, so the
// HTTP cache makes runs 2..n fast, and "does a repeat visit re-download Lean?"
// becomes checkable rather than a guess. Pass --fresh to start from scratch.

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const testsDir = dirname(fileURLToPath(import.meta.url));
export const artifactsDir = join(testsDir, '.artifacts');
export const profileDir = join(artifactsDir, 'chrome-profile');

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  return readdirSync(cache)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((entry) => join(cache, entry, 'chrome-linux64/chrome'))
    .find(existsSync) ?? null;
}

export const CHROME = findChrome();
if (!CHROME) {
  console.error('No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium');
  process.exit(2);
}

export const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

export function resetProfile() {
  rmSync(profileDir, { recursive: true, force: true });
}

/** Launch the shared persistent profile (returns a BrowserContext, not a Browser). */
export async function launchProfile(chromium, overrides = {}) {
  mkdirSync(artifactsDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME,
    args: LAUNCH_ARGS,
    headless: true,
    ...overrides,
  });
}

/** Wait until the tutorial page reports a ready (or failed) Lean engine. */
export async function waitForEngine(page, timeout = 15 * 60 * 1000) {
  await page.waitForFunction(
    () => window.leanTutorials && ['ready', 'error'].includes(window.leanTutorials.engine.state),
    null,
    { timeout },
  );
  return page.evaluate(() => ({
    state: window.leanTutorials.engine.state,
    message: window.leanTutorials.engine.progress.message,
    detail: window.leanTutorials.engine.progress.detail ?? null,
    network: window.leanTutorials.engine.networkBytes,
    error: window.leanTutorials.engine.error?.message ?? null,
  }));
}
