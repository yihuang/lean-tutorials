// Verification. Content declares *what kind* of answer it wants; this module
// decides how to check that kind. There are no lesson-specific cases here.
//
// kind 'tactic' — two compiles:
//   1. the plain file: any error here is a real error in the learner's block,
//   2. the same file plus a wrapper that traces every remaining goal and closes
//      them with an axiom — so "proof finished" is distinguishable from "Lean
//      stopped complaining". Pass 1 alone cannot tell you that.
//
// kind 'file' — one compile of the learner's whole file, plus the content's
// declared `expects`: substrings the output must contain (so a #eval exercise can
// require the right *value*, not just a file that parses).

import { buildSource, codeOnly, forbiddenUsed, GOAL_TRACE_MARKER, missingRequirements } from './source.js';
import { locate, parseOutput, relevant } from './diagnostics.js';
import { formatGoal, goalsFromDiagnostics, goalsFromText } from './goals.js';

/**
 * @typedef {Object} CheckMessage
 * @property {'error'|'warning'|'information'} severity
 * @property {string} message
 * @property {string} [caption]
 * @property {number|null} line learner line number, when it points at their input
 *
 * @typedef {Object} CheckResult
 * @property {boolean} ok
 * @property {'verified'|'errors'|'open-goals'|'policy'|'runtime'} kind
 * @property {string} headline
 * @property {string} detail
 * @property {CheckMessage[]} messages
 * @property {string[]} goals
 * @property {string[]} output informational lines (#eval, #check) — file lessons
 * @property {number} elapsed
 */

/** @returns {CheckResult} */
function fail(kind, headline, detail, extra = {}) {
  return {
    ok: false, kind, headline, detail,
    messages: [], goals: [], output: [], elapsed: 0, ...extra,
  };
}

const asMessages = (diagnostics) => diagnostics.map((diagnostic) => ({
  severity: diagnostic.severity,
  message: diagnostic.message,
  caption: diagnostic.caption,
  line: diagnostic.userLine,
}));

/** Compile the learner's whole file and require the declared output. */
async function checkFileLesson(engine, lesson, input) {
  const started = performance.now();
  const source = buildSource(lesson, input);
  const run = await engine.compile(source.code);
  const diagnostics = locate(parseOutput(run.output), source);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const output = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'information')
    .map((diagnostic) => diagnostic.message);
  // Information lines are the *output* here, so they do not repeat as messages.
  const messages = asMessages(relevant(diagnostics)).filter((message) => message.severity !== 'information');
  const elapsed = performance.now() - started;

  if (!run.success && errors.length === 0) {
    return fail('runtime', 'Lean could not finish', run.error || 'Unknown runtime error.', { messages, output, elapsed });
  }
  if (errors.length > 0) {
    return {
      ok: false, kind: 'errors',
      headline: 'Lean rejected the file',
      detail: 'Fix the messages below; line numbers refer to your own lines.',
      messages, goals: [], output, elapsed,
    };
  }

  // `expects`: the answer has to produce the right output, not merely compile.
  const expects = lesson.expects ?? [];
  if (expects.length > 0) {
    const flat = output.join('\n').replace(/\s+/g, ' ');
    const missing = expects.filter((needle) => !flat.includes(String(needle).replace(/\s+/g, ' ')));
    if (missing.length > 0) {
      return {
        ok: false, kind: 'errors',
        headline: missing.length === 1 ? 'The output is not what the task asks for' : 'Some required output is missing',
        detail: `Run the file and compare with the task. Looking for: ${missing.map((needle) => `\`${needle}\``).join(', ')}`,
        messages, goals: [], output, elapsed,
      };
    }
  }

  return {
    ok: true, kind: 'verified',
    headline: 'Ran clean',
    detail: 'Lean accepted the file in your browser.',
    messages, goals: [], output, elapsed,
  };
}

/** Compile the lesson statement plus the learner's tactic block. */
async function checkTacticLesson(engine, lesson, input) {
  const started = performance.now();
  const plain = buildSource(lesson, input);
  const checkRun = await engine.compile(plain.code);
  const checkDiagnostics = locate(parseOutput(checkRun.output), plain);

  // Always run the inspection pass too: it is what shows the learner the goal
  // they are stuck on, and it is cheap once Init is resident.
  const preview = buildSource(lesson, input, { preview: true });
  const goalRun = await engine.compile(preview.code);
  const goalDiagnostics = locate(parseOutput(goalRun.output), preview);
  const traced = goalsFromDiagnostics(goalDiagnostics, GOAL_TRACE_MARKER);
  // Lean's own "unsolved goals" error carries the same goal state; use it when
  // the trace handshake came back empty, so the panel is never blank while a
  // goal is visibly open.
  const fallback = checkDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'error'
      && ((diagnostic.kind || '').includes('unsolvedGoals') || /unsolved goals/i.test(diagnostic.message)))
    .flatMap((diagnostic) => goalsFromText(diagnostic.message));
  const goals = [...new Set(traced.length > 0 ? traced : fallback)].map(formatGoal);

  const errors = checkDiagnostics.filter((diagnostic) => diagnostic.severity === 'error' && diagnostic.component !== 'generated');
  // Lean reports "unsolved goals" as an error whose message is the goal state
  // itself; the goal panel already shows that, so keep it out of the list.
  const unsolved = errors.filter((error) => (error.kind || '').includes('unsolvedGoals') || /unsolved goals/i.test(error.message));
  const unsolvedMessages = new Set(unsolved.map((error) => error.message));
  const visible = asMessages(relevant(checkDiagnostics))
    .filter((message) => !unsolvedMessages.has(message.message) || goals.length === 0);
  const elapsed = performance.now() - started;

  if (!checkRun.success && errors.length === 0) {
    return fail('runtime', 'Lean could not finish', checkRun.error || 'Unknown runtime error.', { messages: visible, elapsed });
  }

  if (errors.length > 0) {
    return {
      ok: false, kind: 'errors',
      headline: unsolved.length > 0 ? 'The proof is not finished' : 'Lean rejected part of the proof',
      detail: unsolved.length > 0
        ? (goals.length > 0
          ? 'At least one goal is still open — the goal panel shows what is left to prove.'
          : 'Lean is still waiting for a proof of the goal.')
        : 'Fix the messages below; line numbers refer to your tactic block.',
      messages: visible, goals, output: [], elapsed,
    };
  }

  const wrapperErrors = goalDiagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!goalRun.success || wrapperErrors.length > 0) {
    return {
      ok: false, kind: 'errors',
      headline: 'The proof could not be inspected',
      detail: wrapperErrors[0]?.message || goalRun.error || 'Lean reported an error while inspecting the goals.',
      messages: visible.concat(asMessages(wrapperErrors)), goals: [], output: [], elapsed,
    };
  }

  if (goals.length > 0) {
    return {
      ok: false, kind: 'open-goals',
      headline: goals.length === 1 ? 'One goal remains' : `${goals.length} goals remain`,
      detail: 'Your tactics ran without errors but did not close the goal.',
      messages: visible, goals, output: [], elapsed,
    };
  }

  return {
    ok: true, kind: 'verified',
    headline: 'Proof verified',
    detail: 'The Lean kernel checked it on your device. No goals remain.',
    messages: visible.filter((message) => message.severity !== 'information'),
    goals: [], output: [], elapsed,
  };
}

/**
 * @param {import('./engine.js').LeanEngine} engine
 * @param {import('../content/index.js').Lesson} lesson
 * @param {string} input
 * @returns {Promise<CheckResult>}
 */
export async function checkLesson(engine, lesson, input) {
  // Policy first: it applies to every kind, and it is free.
  const forbidden = forbiddenUsed(input, lesson.forbid ?? []);
  if (forbidden.length > 0) {
    const notes = forbidden.map((entry) => entry.help);
    return fail('policy', 'That answer is not allowed here', notes.join(' '), {
      messages: notes.map((message) => ({ severity: 'error', message })),
    });
  }
  const missing = missingRequirements(input, lesson.require ?? []);
  if (missing.length > 0) {
    const notes = missing.map((needle) => `Your answer must contain \`${needle}\`.`);
    return fail('policy', 'Something required is missing', notes.join(' '), {
      messages: notes.map((message) => ({ severity: 'error', message })),
    });
  }
  if (codeOnly(input).trim() === '') {
    return fail('runtime', 'Nothing to check yet', 'Write something in the editor, then press Check.');
  }

  return (lesson.kind ?? 'tactic') === 'file'
    ? checkFileLesson(engine, lesson, input)
    : checkTacticLesson(engine, lesson, input);
}
