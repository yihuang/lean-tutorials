// Pure-function tests: no browser, no network.
//   node --test tests/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSource, codeOnly, forbiddenUsed, FORBIDDEN_HELP, GOAL_TRACE_MARKER, PREVIEW_AXIOM,
} from '../site/src/lean/source.js';
import { locate, parseOutput, relevant } from '../site/src/lean/diagnostics.js';
import { formatGoal, goalsFromDiagnostics, goalsFromText } from '../site/src/lean/goals.js';
import { ABBREVIATIONS, expandAbbreviation, suggestAbbreviation } from '../site/src/lean/unicode.js';
import { coreLayerBytes } from '../site/src/lean/packs.js';
import { LESSONS, SANDBOX_STARTER, lessonById, lessonIndex } from '../site/src/lessons/index.js';

const lesson = {
  statement: 'example (n : Nat) : n = n',
  context: 'def double (n : Nat) := 2 * n',
};

test('buildSource maps the learner block onto generated lines', () => {
  const source = buildSource(lesson, 'rw [h]\nexact hp');
  const lines = source.code.split('\n');
  assert.equal(lines[source.userStartLine - 1], '  rw [h]');
  assert.equal(lines[source.userStartLine], '  exact hp');
  assert.equal(source.userLineCount, 2);
  assert.match(source.code, /set_option autoImplicit false/);
  assert.match(source.code, /example \(n : Nat\) : n = n := by/);
  assert.ok(!source.code.includes(PREVIEW_AXIOM), 'plain compile must not include the preview axiom');
});

test('buildSource preview mode appends the goal wrapper after the learner block', () => {
  const source = buildSource(lesson, 'rfl', { preview: true });
  const lines = source.code.split('\n');
  assert.equal(lines[source.wrapperStartLine - 1], '  all_goals');
  assert.ok(source.code.includes(GOAL_TRACE_MARKER));
  assert.ok(source.code.includes(`private axiom ${PREVIEW_AXIOM} {α : Sort _} : α`));
});

test('buildSource flags comment-only blocks as empty', () => {
  const source = buildSource(lesson, '-- nothing yet\n\n');
  assert.equal(source.empty, true);
  assert.equal(source.userLineCount, 1);
});

test('codeOnly strips comments and strings but keeps a line count', () => {
  const code = 'rw [h] -- sorry\n  exact "sorry"\n/- sorry -/\nexact hp';
  const stripped = codeOnly(code);
  assert.equal(stripped.split('\n').length, code.split('\n').length);
  assert.ok(!/sorry/.test(stripped));
  assert.match(stripped, /exact hp/);
});

test('forbiddenUsed sees real uses only', () => {
  assert.deepEqual(forbiddenUsed('exact hp'), []);
  assert.deepEqual(forbiddenUsed('-- sorry is not used here'), []);
  assert.deepEqual(forbiddenUsed('exact "sorry"'), []);
  assert.deepEqual(forbiddenUsed('sorry'), ['sorry']);
  assert.deepEqual(forbiddenUsed('native_decide'), ['native_decide']);
  assert.deepEqual(forbiddenUsed('sorry_placeholder'), []);
  assert.ok(FORBIDDEN_HELP.sorry.includes('not a proof'));
});

test('parseOutput understands the fork JSON diagnostics and raw text', () => {
  const diagnostics = parseOutput([
    { stream: 'stdout', data: '{"severity":"error","data":"Type mismatch","kind":"typeMismatch","pos":{"line":7,"column":2},"endPos":{"line":7,"column":9}}' },
    { stream: 'stdout', data: 'plain output\n{"severity":"information","data":"4"}' },
    { stream: 'stderr', data: 'boom' },
  ]);
  assert.equal(diagnostics.length, 4);
  assert.equal(diagnostics[0].severity, 'error');
  assert.equal(diagnostics[0].message, 'Type mismatch');
  assert.equal(diagnostics[1].raw, true);
  assert.equal(diagnostics[1].message, 'plain output');
  assert.equal(diagnostics[2].message, '4');
  assert.equal(diagnostics[3].severity, 'error');
  assert.equal(diagnostics[3].message, 'boom');
});

test('locate maps diagnostics onto learner lines and hides generated ones', () => {
  const source = buildSource(lesson, 'rw [h]\nexact hp');
  const diagnostics = locate(parseOutput([
    { stream: 'stdout', data: '{"severity":"error","data":"context problem","pos":{"line":2,"column":0}}' },
    { stream: 'stdout', data: `{"severity":"error","data":"learner problem","pos":{"line":${source.userStartLine + 1},"column":2}}` },
  ]), source);
  assert.equal(diagnostics[0].component, 'context');
  assert.equal(diagnostics[0].userLine, null);
  assert.equal(diagnostics[1].component, 'learner');
  assert.equal(diagnostics[1].userLine, 2);
  assert.equal(relevant(diagnostics).length, 2);
});

test('goalsFromDiagnostics reads marker-then-state traces', () => {
  const diagnostics = [
    { severity: 'information', kind: 'trace', message: GOAL_TRACE_MARKER },
    { severity: 'information', kind: 'trace', message: 'case left\nhp : p\n⊢ p' },
    { severity: 'information', kind: 'trace', message: GOAL_TRACE_MARKER },
    { severity: 'information', kind: 'trace', message: 'case right\nhq : q\n⊢ q' },
  ];
  const goals = goalsFromDiagnostics(diagnostics, GOAL_TRACE_MARKER);
  assert.equal(goals.length, 2);
  assert.match(goals[0], /⊢ p$/);
});

test('goalsFromDiagnostics handles a marker merged into the state message', () => {
  const diagnostics = [
    { severity: 'information', kind: 'trace', message: `${GOAL_TRACE_MARKER}\ncase succ\nih : 0 + k = k\n⊢ 0 + (k + 1) = k + 1` },
  ];
  const goals = goalsFromDiagnostics(diagnostics, GOAL_TRACE_MARKER);
  assert.equal(goals.length, 1);
  assert.match(goals[0], /^case succ/);
  assert.ok(!goals[0].includes(GOAL_TRACE_MARKER));
});

test('goalsFromDiagnostics ignores unrelated trace messages and falls back safely', () => {
  const diagnostics = [
    { severity: 'information', kind: 'trace', message: 'just a note, no turnstile' },
    { severity: 'information', kind: 'trace', message: GOAL_TRACE_MARKER },
  ];
  assert.deepEqual(goalsFromDiagnostics(diagnostics, GOAL_TRACE_MARKER), []);
  assert.deepEqual(goalsFromDiagnostics([], GOAL_TRACE_MARKER), []);
});

test('goalsFromText strips Lean’s prefix and splits cases', () => {
  const goals = goalsFromText('unsolved goals\ncase left\n⊢ p\ncase right\n⊢ q');
  assert.equal(goals.length, 2);
  assert.match(goals[0], /^case left/);
  assert.deepEqual(goalsFromText('all goals solved'), []);
  assert.equal(formatGoal('case a\n⊢ p').includes(' ⊢ '), true);
});

test('unicode abbreviations expand and complete', () => {
  assert.equal(ABBREVIATIONS['\\forall'], '∀');
  assert.equal(suggestAbbreviation('\\for'), '\\forall');
  assert.equal(suggestAbbreviation('\\zzz'), null);
  const textarea = {
    value: 'exact \\forall',
    selectionStart: 'exact \\forall'.length,
    selectionEnd: 'exact \\forall'.length,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  assert.equal(expandAbbreviation(textarea), true);
  assert.equal(textarea.value, 'exact ∀');
  assert.equal(textarea.selectionStart, 'exact ∀'.length);
  const untouched = { value: 'rw [h]', selectionStart: 3, selectionEnd: 5, setSelectionRange() {} };
  assert.equal(expandAbbreviation(untouched), false);
  assert.equal(untouched.value, 'rw [h]');
});

test('coreLayerBytes sums the pack sizes', () => {
  assert.equal(coreLayerBytes({ packs: [{ compressedBytes: 100 }, { compressedBytes: 23 }] }), 123);
  assert.equal(coreLayerBytes({}), 0);
});

test('lesson data is complete, unique and free of placeholders', () => {
  const ids = new Set();
  for (const entry of LESSONS) {
    assert.ok(entry.id && !ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    for (const field of ['title', 'focus', 'summary', 'intro', 'task', 'statement', 'starter', 'hint', 'solution']) {
      assert.ok(typeof entry[field] === 'string' && entry[field].trim().length > 0, `${entry.id} is missing ${field}`);
    }
    assert.match(entry.statement, /example|theorem/, `${entry.id} statement should be a declaration`);
    assert.ok(!/\bsorry\b/.test(entry.solution), `${entry.id} solution must not use sorry`);
    assert.ok(!/\bsorry\b/.test(entry.starter), `${entry.id} starter must not suggest sorry`);
    assert.deepEqual(forbiddenUsed(entry.solution), [], `${entry.id} solution uses a forbidden tactic`);
  }
  assert.ok(LESSONS.length >= 5);
  assert.equal(lessonById('rfl').id, 'rfl');
  assert.equal(lessonById('nope'), null);
  assert.equal(lessonIndex('omega'), LESSONS.length - 1);
  assert.match(SANDBOX_STARTER, /#eval/);
});

test('every lesson context stays inside Lean core (no imports)', () => {
  for (const entry of LESSONS) {
    const context = entry.context ?? '';
    assert.ok(!/\bimport\b/.test(context), `${entry.id} must not import: the browser env is Init-only`);
  }
});
