// One "Check" = two compiles.
//
//   1. the plain file: any error here is a real error in the learner's block,
//   2. the goal-inspection file: same block, plus a wrapper that traces every
//      remaining goal and then closes them with an axiom — so we can tell the
//      difference between "proof finished" and "Lean stopped complaining".
//
// Two passes because the wrapper's axiom would otherwise hide open goals.

import {
  buildSource, codeOnly, forbiddenUsed, FORBIDDEN_HELP, GOAL_TRACE_MARKER,
} from './source.js';
import { locate, parseOutput, relevant } from './diagnostics.js';
import { formatGoal, goalsFromDiagnostics, goalsFromText } from './goals.js';

/**
 * @typedef {Object} CheckMessage
 * @property {'error'|'warning'|'information'} severity
 * @property {string} message
 * @property {string} [caption]
 * @property {number|null} line learner line number, when it points at their block
 *
 * @typedef {Object} CheckResult
 * @property {boolean} ok
 * @property {'verified'|'errors'|'open-goals'|'policy'|'runtime'} kind
 * @property {string} headline
 * @property {string} detail
 * @property {CheckMessage[]} messages
 * @property {string[]} goals
 * @property {number} elapsed
 */

/** @returns {CheckResult} */
function fail(kind, headline, detail, extra = {}) {
  return { ok: false, kind, headline, detail, messages: [], goals: [], elapsed: 0, ...extra };
}

/**
 * @param {import('./engine.js').LeanEngine} engine
 * @param {import('../lessons/index.js').Lesson} lesson
 * @param {string} tactics
 * @returns {Promise<CheckResult>}
 */
export async function checkLesson(engine, lesson, tactics) {
  const forbidden = forbiddenUsed(tactics);
  if (forbidden.length > 0) {
    const notes = forbidden.map((word) => FORBIDDEN_HELP[word] || `\`${word}\` is not allowed in a solution.`);
    return fail('policy', 'That proof is not allowed here', notes.join(' '), {
      messages: notes.map((message) => ({ severity: 'error', message })),
    });
  }
  if (codeOnly(tactics).trim() === '') {
    return fail('runtime', 'Nothing to check yet', 'Write at least one tactic, then press Check.');
  }

  const started = performance.now();
  const plain = buildSource(lesson, tactics);
  const checkRun = await engine.compile(plain.code);
  const checkDiagnostics = locate(parseOutput(checkRun.output), plain);

  // Always run the inspection pass too: it is what shows the learner the goal
  // they are stuck on, and it is cheap once Init is resident.
  const preview = buildSource(lesson, tactics, { preview: true });
  const goalRun = await engine.compile(preview.code);
  const goalDiagnostics = locate(parseOutput(goalRun.output), preview);
  const traced = goalsFromDiagnostics(goalDiagnostics, GOAL_TRACE_MARKER);
  // Lean's own "unsolved goals" error carries the same goal state; use it when
  // the trace handshake came back empty, so the panel is never blank while a
  // goal is visibly open.
  const fallback = checkDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'error' && ((diagnostic.kind || '').includes('unsolvedGoals') || /unsolved goals/i.test(diagnostic.message)))
    .flatMap((diagnostic) => goalsFromText(diagnostic.message));
  const goals = [...new Set(traced.length > 0 ? traced : fallback)].map(formatGoal);

  const errors = checkDiagnostics.filter((diagnostic) => diagnostic.severity === 'error' && diagnostic.component !== 'generated');
  // Lean reports "unsolved goals" as an error whose message is the goal state
  // itself; the goal panel already shows that, so keep it out of the list.
  const unsolved = errors.filter((error) => (error.kind || '').includes('unsolvedGoals') || /unsolved goals/i.test(error.message));
  const visible = relevant(checkDiagnostics)
    .filter((diagnostic) => !unsolved.includes(diagnostic) || goals.length === 0)
    .map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.message,
      caption: diagnostic.caption,
      line: diagnostic.userLine,
    }));

  const elapsed = performance.now() - started;

  if (!checkRun.success && errors.length === 0) {
    return fail('runtime', 'Lean could not finish', checkRun.error || 'Unknown runtime error.', { messages: visible, elapsed });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      kind: 'errors',
      headline: unsolved.length > 0 ? 'The proof is not finished' : 'Lean rejected part of the proof',
      detail: unsolved.length > 0
        ? (goals.length > 0
          ? 'At least one goal is still open — the goal panel shows what is left to prove.'
          : 'Lean is still waiting for a proof of the goal.')
        : 'Fix the messages below; line numbers refer to your tactic block.',
      messages: visible,
      goals,
      elapsed,
    };
  }

  const wrapperErrors = goalDiagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!goalRun.success || wrapperErrors.length > 0) {
    return {
      ok: false,
      kind: 'errors',
      headline: 'The proof could not be inspected',
      detail: wrapperErrors[0]?.message || goalRun.error || 'Lean reported an error while inspecting the goals.',
      messages: visible.concat(wrapperErrors.map((diagnostic) => ({
        severity: 'error', message: diagnostic.message, caption: diagnostic.caption, line: diagnostic.userLine,
      }))),
      goals: [],
      elapsed,
    };
  }

  if (goals.length > 0) {
    return {
      ok: false,
      kind: 'open-goals',
      headline: goals.length === 1 ? 'One goal remains' : `${goals.length} goals remain`,
      detail: 'Your tactics ran without errors but did not close the goal.',
      messages: visible,
      goals,
      elapsed,
    };
  }

  return {
    ok: true,
    kind: 'verified',
    headline: 'Proof verified',
    detail: 'The Lean kernel checked it on your device. No goals remain.',
    messages: visible.filter((message) => message.severity !== 'information'),
    goals: [],
    elapsed,
  };
}
