// Authoring probe: does Lean (Init-only, in the browser build) accept this?
//
//   node tests/probe-lean.mjs            # probe the built-in candidate list
//   node tests/probe-lean.mjs --file candidates.json
//
// Accepts a JSON array of { name, statement, context?, tactics } and reports, for
// each one, whether the two passes accept it — plus the first message when they
// do not. This is the tool to reach for while writing lessons: run it before
// adding content, so a lesson never ships a solution Lean rejects.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchProfile, isolateStorage, waitForEngine } from './browser-profile.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(argValue('port', 8798));
const mem = argValue('mem', '768');
const file = argValue('file', '');
const dir = existsSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'site', 'lean-wasm'))
  ? 'site' : 'dist';

const CANDIDATES = [
  { name: 'iff.mp', statement: 'example {p q : Prop} (h : p ↔ q) (hp : p) : q', tactics: 'exact h.mp hp' },
  { name: 'iff swap', statement: 'example {p q : Prop} (h : p ↔ q) : q ↔ p', tactics: 'exact ⟨h.mpr, h.mp⟩' },
  { name: 'iff build', statement: 'example {p q : Prop} (hpq : p → q) (hqp : q → p) : p ↔ q', tactics: 'exact ⟨hpq, hqp⟩' },
  { name: 'iff constructor', statement: 'example {p q : Prop} (hpq : p → q) (hqp : q → p) : p ↔ q', tactics: 'constructor\n· intro hp\n  exact hpq hp\n· intro hq\n  exact hqp hq' },
  { name: 'not apply', statement: 'example {p : Prop} (hp : p) (hn : ¬p) : False', tactics: 'exact hn hp' },
  { name: 'absurd', statement: 'example {p q : Prop} (hp : p) (hn : ¬p) : q', tactics: 'exact absurd hp hn' },
  { name: 'exfalso', statement: 'example {p q : Prop} (hn : ¬p) (hp : p) : q', tactics: 'exfalso\nexact hn hp' },
  { name: 'False.elim', statement: 'example {p : Prop} (h : False) : p', tactics: 'exact False.elim h' },
  { name: 'by_contra', statement: 'example {p : Prop} : ¬¬p → p', tactics: 'intro h\nby_contra hn\nexact h hn' },
  { name: 'no contradiction', statement: 'example {p : Prop} : ¬(p ∧ ¬p)', tactics: 'intro h\nrcases h with ⟨hp, hnp⟩\nexact hnp hp' },
  { name: 'calc', statement: 'example (a b c : Nat) (h1 : a = b) (h2 : b = c) : a = c', tactics: 'calc a = b := h1\n  _ = c := h2' },
  { name: 'congrArg', statement: 'example (f : Nat → Nat) (a b : Nat) (h : a = b) : f a = f b', tactics: 'exact congrArg f h' },
  { name: 'rw backwards', statement: 'example (a b : Nat) (h : a = b) : b + 1 = a + 1', tactics: 'rw [← h]' },
  { name: 'rw lemma', statement: 'example (a b c : Nat) : a + b + c = a + (b + c)', tactics: 'rw [Nat.add_assoc]' },
  { name: 'rw twice', statement: 'example (a b : Nat) (h1 : a = b) (h2 : b = 3) : a = 3', tactics: 'rw [h1, h2]' },
  { name: 'simpa using', statement: 'example (n : Nat) : n + 0 = n', tactics: 'simpa using Nat.add_zero n' },
  { name: 'simp at', statement: 'example (n : Nat) (h : n + 0 = 3) : n = 3', tactics: 'simpa using h' },
  { name: 'simp list', statement: 'example (n : Nat) : n * 1 = n', tactics: 'simp' },
  { name: 'cases hyp', statement: 'example (n : Nat) (h : n = 0) : n + 0 = 0', tactics: 'cases h\nrfl' },
  { name: 'cases nat', statement: 'example (n : Nat) : n = 0 ∨ ∃ k, n = k + 1', tactics: 'cases n with\n| zero => exact Or.inl rfl\n| succ k => exact Or.inr ⟨k, rfl⟩' },
  { name: 'succ_ne_zero', statement: 'example (n : Nat) : Nat.succ n ≠ 0', tactics: 'exact Nat.succ_ne_zero n' },
  { name: 'decide', statement: 'example : (2 + 2) * 3 = 12', tactics: 'decide' },
  { name: 'decide list', statement: 'example : (List.range 4).length = 4', tactics: 'decide' },
  { name: 'omega lt', statement: 'example (a b : Nat) (h1 : a ≤ b) (h2 : b < 5) : a < 5', tactics: 'omega' },
  { name: 'omega mul', statement: 'example (n : Nat) : 2 * n = n + n', tactics: 'omega' },
  { name: 'forall intro', statement: 'example : ∀ n : Nat, 0 + n = n', tactics: 'intro n\ninduction n with\n| zero => rfl\n| succ k ih => rw [Nat.add_succ, ih]' },
  { name: 'forall apply', statement: 'example {p : Nat → Prop} (h : ∀ n, p n) : p 3', tactics: 'apply h' },
  { name: 'exists intro', statement: 'example : ∃ n : Nat, n + 1 = 3', tactics: 'exact ⟨2, rfl⟩' },
  { name: 'exists rcases', statement: 'example {p : Nat → Prop} (h : ∃ n, p n) : ∃ m, p m', tactics: 'rcases h with ⟨n, hn⟩\nexact ⟨n, hn⟩' },
  { name: 'exists use', statement: 'example : ∃ n : Nat, n * 2 = 8', tactics: 'use 4' },
  { name: 'induction add_assoc', statement: 'example (a b c : Nat) : a + b + c = a + (b + c)', tactics: 'induction c with\n| zero => rfl\n| succ k ih => rw [Nat.add_succ, Nat.add_succ, ih]' },
  { name: 'mul_comm', statement: 'example (a b : Nat) : a * b = b * a', tactics: 'exact Nat.mul_comm a b' },
  { name: 'calc rw mix', statement: 'example (a b : Nat) (h : a = b) : 2 * a = b + b', tactics: 'rw [h]\nomega' },
];

const candidates = file ? JSON.parse(readFileSync(file, 'utf8')) : CANDIDATES;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, ['scripts/serve.mjs', '--dir', dir, '--port', String(port)], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
await new Promise((r) => setTimeout(r, 800));

const context = await launchProfile(chromium, { viewport: { width: 900, height: 900 } });
await isolateStorage(context);
const page = context.pages()[0] ?? await context.newPage();
await page.goto(`http://localhost:${port}/?mem=${mem}`, { waitUntil: 'domcontentloaded' });
const state = await waitForEngine(page);
if (state.state !== 'ready') {
  console.error(`Lean did not start: ${state.error ?? state.message}`);
  process.exit(1);
}

const results = await page.evaluate(async (list) => {
  const { engine, checkLesson } = window.leanTutorials;
  const out = [];
  for (const candidate of list) {
    const lesson = { id: candidate.name, statement: candidate.statement, context: candidate.context };
    const result = await checkLesson(engine, lesson, candidate.tactics);
    out.push({
      name: candidate.name,
      ok: result.ok,
      kind: result.kind,
      first: result.messages?.[0]?.message?.split('\n').slice(0, 2).join(' / ') ?? result.headline,
    });
  }
  return out;
}, candidates);

let failed = 0;
for (const row of results) {
  if (!row.ok) failed += 1;
  console.log(`${row.ok ? '✓' : '✗'} ${row.name.padEnd(22)} ${row.ok ? '' : `${row.kind}: ${String(row.first).slice(0, 100)}`}`);
}
console.log(`\n${results.length - failed}/${results.length} accepted`);
await context.close();
server.kill('SIGTERM');
process.exit(0);
