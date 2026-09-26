// Objective stand-in for "looking at it": WCAG contrast of every text/style
// combination that matters, plus a reading-order dump, for light and dark mode.
//
//   node tests/a11y-contrast.mjs [--url https://lean-tutorials.pages.dev]
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchProfile } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8794));
const externalUrl = argValue('url', '');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = externalUrl ? null : spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server?.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));

// Shared persistent profile, so the background Lean start is not re-downloaded.
const context = await launchProfile(chromium, { viewport: { width: 390, height: 844 } });
const page = context.pages()[0] ?? await context.newPage();
const base = externalUrl || `http://localhost:${port}`;
const failures = [];

const CONTRAST = `
(() => {
  const parse = (color) => {
    const parts = String(color).match(/[\\d.]+/g) || [];
    return parts.length >= 3 ? parts.slice(0, 3).map(Number) : [255, 255, 255];
  };
  const luminance = ([r, g, b]) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (front, back) => {
    const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  const background = (element) => {
    let node = element;
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      const parts = String(color).match(/[\\d.]+/g) || [];
      if (parts.length >= 3 && !(parts.length === 4 && Number(parts[3]) === 0)) return parse(color);
      node = node.parentElement;
    }
    return [255, 255, 255];
  };
  const rows = [];
  // Feedback states (goals, messages, banners) only exist after a proof check,
  // which would need the whole Lean runtime. For a colour audit the CSS is all
  // that matters, so the same classes are instantiated for the measurement.
  const injected = document.createElement('div');
  injected.style.cssText = 'position:absolute;left:-9999px;top:0';
  injected.innerHTML = [
    '<p class="banner ok">ok</p>', '<p class="banner err">err</p>', '<p class="banner info">info</p>',
    '<pre class="goal">goal</pre>', '<pre class="msg-body">body</pre>',
    '<div class="msg-head"><span>head</span></div>',
    '<div class="lesson-title">title</div>', '<div class="lesson-sub">sub</div>',
    '<div class="result ok"><span class="check">✓</span><span><strong class="result-title">Proof verified</strong>' +
      '<span class="result-detail">kernel-checked</span></span></div>',
    '<span class="next-chip">next</span>',
    '<section class="infoview" data-state="goals"><div class="infoview-head">' +
      '<span class="infoview-state"><span class="infoview-title">Goals at line 3</span>' +
      '<span class="infoview-badge">2 open</span></span></div><div class="infoview-body">' +
      '<div class="goal-card"><div class="goal-head"><span class="goal-name">left</span>' +
      '<span class="goal-index">1/2</span></div><div class="goal-hyps"><span class="hyp">hp : p</span></div>' +
      '<div class="goal-target"><span class="turnstile">⊢</span> p</div></div>' +
      '<p class="infoview-note">showing the last complete step</p></div></section>',
    '<div class="topic-card"><a class="topic-head" href="#/"><span class="topic-meta">' +
      '<span class="topic-title">Topic title</span><span class="topic-sub">topic summary</span></span>' +
      '<span class="topic-count">2/5</span></a><p class="topic-next small muted">Next: <a href="#/">lesson</a></p></div>',
  ].join('');
  document.body.append(injected);
  for (const raw of ${JSON.stringify([
    'p', '.lesson-title', '.lesson-sub', '.eyebrow', '.statement', '.goal', '.msg-body',
    '.btn.primary', '.banner.ok', '.banner.err', '.banner.info', '.footer p', '.chip',
    '.symbols button', '.msg-head span', 'textarea.editor::placeholder',
    '.result.ok .result-title', '.result.ok .result-detail', '.next-chip',
    '.topic-title', '.topic-sub', '.topic-count', '.topic-next a',
    '.infoview-title', '.infoview-badge', '.goal-hyps .hyp', '.goal-target', '.goal-name', '.infoview-note',
  ])}) {
    const [selector, pseudo] = raw.split('::');
    const element = document.querySelector(selector);
    if (!element) { rows.push({ selector: raw, missing: true }); continue; }
    const style = getComputedStyle(element, pseudo ? '::' + pseudo : undefined);
    rows.push({
      selector: raw,
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      bold: Number(style.fontWeight) >= 600,
      ratio: Number(ratio(parse(style.color), background(element)).toFixed(2)),
      color: style.color,
      background: background(element).join(','),
    });
  }
  injected.remove();
  return rows;
})()
`;

async function audit(label, colorScheme) {
  await page.emulateMedia({ colorScheme });
  await page.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.editor');
  const rows = await page.evaluate(CONTRAST);
  console.log(`\n--- ${label} (${colorScheme}) ---`);
  for (const row of rows) {
    if (row.missing) { console.log(`?  ${row.selector} (not on this page)`); continue; }
    const large = row.fontSize >= 24 || (row.bold && row.fontSize >= 18.66);
    const minimum = large ? 3 : 4.5;
    const ok = row.ratio >= minimum;
    if (!ok) failures.push(`${label}/${row.selector} contrast ${row.ratio}`);
    console.log(`${ok ? '✓' : '✗'} ${row.selector.padEnd(30)} ${String(row.ratio).padStart(6)}:1  ${row.fontSize}px${row.bold ? ' bold' : ''}  (min ${minimum})`);
  }
}

await audit('lesson', 'light');
await audit('lesson', 'dark');

// Reading order: what a screen reader (and, roughly, an eye) encounters.
await page.goto(`${base}/#/lesson/and`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.editor');
const snapshot = await page.locator('body').ariaSnapshot();
console.log('\n--- reading order (aria snapshot, lesson page) ---');
console.log(snapshot.split('\n').slice(0, 40).join('\n'));

// The sticky action row must stay clickable: nothing may sit on top of it.
const overlap = await page.evaluate(() => {
  const button = document.querySelector('.actions .btn.primary');
  button.scrollIntoView({ block: 'end' });
  const rect = button.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { hit: top?.className || top?.tagName, withinViewport: rect.bottom <= window.innerHeight + 1, top: Math.round(rect.top) };
});
const hitOk = String(overlap.hit).includes('btn');
if (!hitOk || !overlap.withinViewport) failures.push('sticky actions not clickable');
console.log(`\n${hitOk ? '✓' : '✗'} sticky Check button is the topmost element at its centre (hit ${overlap.hit}, top ${overlap.top}px)`);

await context.close();
server?.kill('SIGTERM');
console.log(failures.length === 0 ? '\nContrast and reading-order checks passed.' : `\n${failures.length} issue(s): ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
