// Unit tests for the cursor-driven goal probe: no browser, no Lean, no network.
//   node --test tests/infoview.test.mjs
//
// A fake engine stands in for Lean. It returns canned diagnostic JSON lines —
// exactly the shape parseOutput() expects — so these tests pin down the probe's
// *decisions* (what prefix it sends, which line it reports, when it backs off,
// when it refuses to compile at all), not Lean's elaboration.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GoalProbe } from '../site/src/lean/infoview.js';
import { GOAL_TRACE_MARKER } from '../site/src/lean/source.js';

const LESSON = {
  id: 'and-intro',
  kind: 'tactic',
  statement: 'example {p q : Prop} (hp : p) (hq : q) : p ∧ q',
};

/** One JSON diagnostic line, as the worker prints it. */
const diagnostic = (fields) => ({ stream: 'stdout', data: `${JSON.stringify(fields)}\n` });

/** A clean compile whose goal-trace handshake reported these states. */
const traced = (...states) => ({
  success: true,
  output: [diagnostic({ severity: 'information', kind: 'trace', data: `${GOAL_TRACE_MARKER}\n${states.join('\n')}` })],
});

/** A compile Lean refused, with a real error position. */
const rejected = (message, line = 1) => ({
  success: false,
  output: [diagnostic({ severity: 'error', kind: 'unexpectedEnd', data: message, pos: { line, column: 1 } })],
});

/** Engine whose every compile is answered by handler(code, index). */
function scriptedEngine(handler) {
  const calls = [];
  return {
    calls,
    compile(code) {
      calls.push(code);
      return Promise.resolve(handler(code, calls.length - 1));
    },
  };
}

const GOAL_P = 'case left\np q : Prop\nhp : p\nhq : q\n⊢ p';

test('kind defaults to tactic, and stats start empty', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);
  assert.deepEqual(probe.stats, { probes: 0, cacheHits: 0, stale: 0 });

  const result = await probe.goalsAt({ id: 'no-kind', statement: 'example : True' }, 'trivial', 0);
  assert.equal(result.status, 'goals');
  assert.equal(engine.calls.length, 1);
});

test('a probe sends only the learner lines up to the cursor', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const first = await probe.goalsAt(LESSON, 'constructor\nexact h', 0);
  assert.equal(first.status, 'goals');
  assert.equal(first.requestedLine, 0);
  assert.equal(first.line, 0);
  assert.equal(engine.calls.length, 1);
  assert.match(engine.calls[0], /^  constructor$/m);
  assert.doesNotMatch(engine.calls[0], /exact h/);

  const second = await probe.goalsAt(LESSON, 'constructor\nexact h', 1);
  assert.equal(second.line, 1);
  assert.equal(engine.calls.length, 2);
  assert.match(engine.calls[1], /^  exact h$/m);
});

test('a cursor past the last line clamps to the last line', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'constructor', 9);
  assert.equal(result.requestedLine, 9);
  assert.equal(result.line, 0);
  assert.equal(engine.calls.length, 1);
  assert.match(engine.calls[0], /^  constructor$/m);
});

test('a cursor on a blank line reports the previous line', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'constructor\n', 1);
  assert.equal(result.line, 0);
  assert.match(engine.calls[0], /^  constructor$/m);
});

test('a blank line in the middle keeps the lines before it', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'constructor\n\nexact h', 1);
  assert.equal(result.line, 0);
  assert.match(engine.calls[0], /^  constructor$/m);
  assert.doesNotMatch(engine.calls[0], /exact h/);
});

test('cursor -1 probes the statement with no learner lines', async () => {
  const engine = scriptedEngine(() => traced('p q : Prop\nhp : p\nhq : q\n⊢ p ∧ q'));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'constructor', -1);
  assert.equal(result.status, 'goals');
  assert.equal(result.requestedLine, -1);
  assert.equal(result.line, null);
  assert.equal(result.goals.length, 1);
  assert.doesNotMatch(engine.calls[0], /constructor/);
});

test('empty input probes the statement whatever the cursor says', async () => {
  const engine = scriptedEngine(() => traced('p q : Prop\nhp : p\nhq : q\n⊢ p ∧ q'));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, '', 0);
  assert.equal(result.status, 'goals');
  assert.equal(result.line, null);
  assert.equal(result.requestedLine, 0);
});

test('a clean compile with no traced goals is complete', async () => {
  const engine = scriptedEngine(() => ({ success: true, output: [] }));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'exact ⟨hp, hq⟩', 0);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.goals, []);
  assert.equal(result.line, 0);
  assert.equal(result.cached, false);
});

test('merged per-goal traces are all reported', async () => {
  // Lean's message log merges traces that share a source position: two open
  // goals arrive as `marker\nmarker` followed by one message with both cases.
  const engine = scriptedEngine(() => ({
    success: true,
    output: [
      diagnostic({ severity: 'information', kind: 'trace', data: `${GOAL_TRACE_MARKER}\n${GOAL_TRACE_MARKER}` }),
      diagnostic({ severity: 'information', kind: 'trace', data: 'case left\n⊢ p\ncase right\n⊢ q' }),
    ],
  }));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'constructor', 0);
  assert.equal(result.status, 'goals');
  assert.equal(result.goals.length, 2);
});

test('a learner trace_state before the marker is not mistaken for the cursor state', async () => {
  const engine = scriptedEngine(() => ({
    success: true,
    output: [
      diagnostic({ severity: 'information', kind: 'trace', data: 'case left\np q : Prop\n⊢ p' }),
      diagnostic({ severity: 'information', kind: 'trace', data: `${GOAL_TRACE_MARKER}\n${GOAL_TRACE_MARKER}` }),
      diagnostic({ severity: 'information', kind: 'trace', data: 'case left\n⊢ p\ncase right\n⊢ q' }),
    ],
  }));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'trace_state\nconstructor', 1);
  assert.equal(result.status, 'goals');
  assert.equal(result.goals.length, 2);
});

test('error back-off reports the last line that elaborates', async () => {
  // The generated file carries one learner line per input line, so "does the
  // hypothesis `d` appear" is a readable stand-in for "is the prefix complete".
  const engine = scriptedEngine((code) => (/^  d$/m.test(code) ? rejected('unexpected end of input') : traced(GOAL_P)));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'a\nb\nc\nd', 3);
  assert.equal(result.status, 'goals');
  assert.equal(result.requestedLine, 3);
  assert.equal(result.line, 2);
  assert.equal(engine.calls.length, 2);
  assert.match(engine.calls[0], /^  d$/m);
  assert.doesNotMatch(engine.calls[1], /^  d$/m);
});

test('back-off is bounded and exhausted back-off is an error', async () => {
  const engine = scriptedEngine(() => rejected('type mismatch\n  expected Nat'));
  const probe = new GoalProbe(engine, { maxBackoff: 2 });

  const result = await probe.goalsAt(LESSON, 'a\nb\nc', 2);
  assert.equal(result.status, 'error');
  assert.equal(result.line, null);
  assert.equal(result.message, 'type mismatch');
  // Initial attempt at line 2, then the two retries it is allowed: lines 1 and 0.
  assert.equal(engine.calls.length, 3);
});

test('back-off can reach the state before the first line', async () => {
  const engine = scriptedEngine((code) => (/^  x$/m.test(code) ? rejected('unexpected token') : traced('p q : Prop\n⊢ p ∧ q')));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'x', 0);
  assert.equal(result.status, 'goals');
  assert.equal(result.requestedLine, 0);
  assert.equal(result.line, null);
  assert.equal(result.goals.length, 1);
  assert.equal(engine.calls.length, 2);
});

test('a runtime failure is reported without backing off', async () => {
  const engine = scriptedEngine(() => ({ success: false, error: 'Lean is not running', output: [] }));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt(LESSON, 'a\nb', 1);
  assert.equal(result.status, 'error');
  assert.equal(result.message, 'Lean is not running');
  assert.equal(engine.calls.length, 1);
});

test('an identical repeat is served from cache without compiling', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const first = await probe.goalsAt(LESSON, 'constructor', 0);
  const second = await probe.goalsAt(LESSON, 'constructor', 0);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.elapsedMs, 0);
  assert.equal(second.status, 'goals');
  assert.equal(engine.calls.length, 1);
  assert.deepEqual(probe.stats, { probes: 2, cacheHits: 1, stale: 0 });
});

test('the cache is bounded and evicts the oldest entry', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine, { cacheSize: 2 });

  await probe.goalsAt(LESSON, 'a', 0);
  await probe.goalsAt(LESSON, 'b', 0);
  await probe.goalsAt(LESSON, 'c', 0); // evicts 'a'
  const filled = engine.calls.length;

  const recent = await probe.goalsAt(LESSON, 'c', 0);
  assert.equal(recent.cached, true);
  assert.equal(engine.calls.length, filled);

  const evicted = await probe.goalsAt(LESSON, 'a', 0);
  assert.equal(evicted.cached, false);
  assert.equal(engine.calls.length, filled + 1);
});

test('a file lesson is unsupported and never compiled', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const result = await probe.goalsAt({ id: 'check', kind: 'file', context: '' }, '#check Nat.add_comm', 0);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.line, null);
  assert.equal(result.cached, false);
  assert.match(result.message, /whole-file/i);
  assert.equal(engine.calls.length, 0);
});

test('cancel() makes an in-flight probe stale and stops further compiles', async () => {
  const engine = scriptedEngine(() => rejected('unexpected end of input'));
  const probe = new GoalProbe(engine);

  const pending = probe.goalsAt(LESSON, 'a\nb\nc', 2);
  probe.cancel();
  const result = await pending;

  assert.equal(result.status, 'stale');
  assert.equal(result.line, null);
  assert.deepEqual(result.goals, []);
  // Let anything a buggy implementation queued run before counting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(engine.calls.length, 1);
  assert.deepEqual(probe.stats, { probes: 1, cacheHits: 0, stale: 1 });
});

test('a newer probe supersedes an older in-flight one', async () => {
  const engine = scriptedEngine(() => traced(GOAL_P));
  const probe = new GoalProbe(engine);

  const first = probe.goalsAt(LESSON, 'constructor', 0);
  const second = probe.goalsAt(LESSON, 'exact ⟨hp, hq⟩', 0);
  const [older, newer] = await Promise.all([first, second]);

  assert.equal(older.status, 'stale');
  assert.equal(newer.status, 'goals');
  assert.equal(engine.calls.length, 2);
  assert.equal(probe.stats.probes, 2);
  assert.equal(probe.stats.stale, 1);
});
