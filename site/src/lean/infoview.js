// Cursor-driven goal probe: "what is true at the line my cursor is on?".
//
// That is a language-server question, and a language server answers it by
// elaborating a prefix of the file. There is no incremental server here, so a
// probe rebuilds the learner's lines 0..cursor with buildSource(…, { preview })
// and compiles. That is affordable only because the file is tiny and the Lean
// runtime keeps Init resident — and it is still work worth not wasting, which is
// what the cache and the staleness token below are for: a newer cursor position
// supersedes an older probe, and a superseded probe stops before asking the
// engine for another compile (the engine queues compiles, so a request that will
// be thrown away must never join that queue).
//
// The preview wrapper is what lets a half-finished proof compile at all: it
// traces every open goal and then closes the remaining ones with a private
// axiom. So "goals at the cursor" is the traced state, and 'complete' is a clean
// compile that traced nothing. A cursor inside a multi-line tactic
// (`induction … with`, `calc`, a `·` bullet) truncates the tactic itself and Lean
// rejects the file; the probe then backs off one line at a time until something
// elaborates, and reports the line the shown state really belongs to.
//
// Mechanism only: no DOM, no content import, no dependencies.

import { buildSource, GOAL_TRACE_MARKER } from './source.js';
import { locate, parseOutput } from './diagnostics.js';
import { formatGoal, goalsFromDiagnostics } from './goals.js';

/**
 * @typedef {Object} ProbeEngine
 * @property {(code: string, path?: string) => Promise<{success: boolean, output?: {stream: string, data: string}[], error?: string}>} compile
 *
 * @typedef {Object} ProbeLesson
 * @property {string} [id]        cache identity; two lessons must not share one
 * @property {'tactic'|'file'} [kind]  defaults to 'tactic'
 * @property {string} [statement]
 * @property {string} [context]
 *
 * @typedef {'goals'|'complete'|'error'|'unsupported'|'stale'} ProbeStatus
 *
 * @typedef {Object} ProbeResult
 * @property {ProbeStatus} status
 * @property {number} requestedLine   the cursor line the caller asked about
 * @property {number|null} line       the learner line the state belongs to; null when
 *                                    there is none (before the first line) or nothing was shown
 * @property {string[]} goals         formatted goal states in Lean's layout, one per goal
 * @property {string|null} message    short user-facing note for 'error' / 'unsupported'
 * @property {boolean} cached
 * @property {number} elapsedMs
 */

const now = () => performance.now();

/** Editor text as lines. Line indices are what the caller's cursor counts. */
function toLines(input) {
  return String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * The learner's lines 0..end, with trailing blanks dropped. A cursor on an empty
 * line should show what the previous tactic left behind, and Lean ignores those
 * blanks anyway; dropping them here is also what keeps the reported `line`
 * pointing at the tactic the state actually describes.
 *
 * @returns {{text: string, line: number}} line is -1 when nothing is left
 */
function prefixAt(lines, end) {
  const kept = lines.slice(0, Math.max(end + 1, 0));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return { text: kept.join('\n'), line: kept.length - 1 };
}

/** First non-empty line of a message, clipped so the panel stays one line. */
function oneLine(text) {
  const line = String(text ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  return line ? line.slice(0, 160) : null;
}

// The goal-trace handshake lives in goals.js. It used to be duplicated here as a
// local fallback, because Lean merges traces that share a source position (two
// open goals arrive as one message holding the marker twice, then one message
// holding both `case …` blocks) and the shared extractor originally lost that
// pair. That is fixed at the source and pinned by a regression test in
// tests/unit.test.mjs, so this module keeps a single owner for the protocol:
// goals.js.

/** @param {import('./diagnostics.js').RawDiagnostic[]} diagnostics */
function firstErrorMessage(diagnostics) {
  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  return oneLine(error?.message);
}

function makeResult(fields) {
  return {
    status: 'error',
    requestedLine: -1,
    line: null,
    goals: [],
    message: null,
    cached: false,
    elapsedMs: 0,
    ...fields,
  };
}

export class GoalProbe {
  /**
   * @param {ProbeEngine} engine
   * @param {{maxBackoff?: number, cacheSize?: number}} [options]
   *        maxBackoff: retries with one fewer line after a rejected compile.
   *        cacheSize: entries kept, oldest evicted first.
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this.maxBackoff = options.maxBackoff ?? 3;
    this.cacheSize = options.cacheSize ?? 24;
    /** @type {Map<string, ProbeResult>} insertion-ordered, oldest first */
    this._cache = new Map();
    // A request owns the newest token; bumping it is what makes every earlier
    // in-flight request stale. Only the owner is allowed to answer.
    this._token = 0;
    this._stats = { probes: 0, cacheHits: 0, stale: 0 };
  }

  /** Requests received, hits served from cache, and requests superseded. */
  get stats() {
    return { ...this._stats };
  }

  /** Supersede every in-flight probe: the cursor moved somewhere else. */
  cancel() {
    this._token += 1;
  }

  /**
   * @param {ProbeLesson} lesson
   * @param {string} input learner's editor text
   * @param {number} cursorLine 0-based; -1 means "before the first line"
   * @returns {Promise<ProbeResult>}
   */
  async goalsAt(lesson, input, cursorLine) {
    const token = ++this._token;
    const spec = lesson ?? {};
    const requestedLine = Number.isFinite(cursorLine) ? cursorLine : -1;
    const started = now();
    this._stats.probes += 1;

    if ((spec.kind ?? 'tactic') === 'file') {
      // A whole-file lesson has no statement to stand in front of: there is no
      // "state at this line" to report, and compiling would only cost time.
      return makeResult({
        status: 'unsupported',
        requestedLine,
        message: 'A whole-file lesson has no goal state to show.',
        elapsedMs: now() - started,
      });
    }

    const lines = toLines(input);
    const end = requestedLine < 0 ? -1 : Math.min(requestedLine, lines.length - 1);
    const key = `${spec.id ?? ''}\u0000${requestedLine}\u0000${prefixAt(lines, end).text}`;
    const hit = this._cache.get(key);
    if (hit) {
      // Re-asking the same question is the common case while a learner pauses;
      // answering it without touching Lean is the whole point of the cache.
      this._stats.cacheHits += 1;
      return { ...hit, cached: true, elapsedMs: 0 };
    }

    let firstError = null;
    const oldest = Math.max(end - this.maxBackoff, -1);
    for (let stop = end; stop >= oldest; stop -= 1) {
      // The engine serialises compiles, so a superseded request must not queue
      // one: check right before asking, and again right after Lean answers.
      if (this._superseded(token)) return this._stale(requestedLine, started);

      const { text, line } = prefixAt(lines, stop);
      const source = buildSource(spec, text, { preview: true });
      const run = await this.engine.compile(source.code);

      if (this._superseded(token)) return this._stale(requestedLine, started);

      const diagnostics = locate(parseOutput(run.output ?? []), source);
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (!run.success && errors.length === 0) {
        // Not a truncation problem: the runtime itself failed, and backing off
        // would only repeat that failure against a different prefix.
        return makeResult({
          status: 'error',
          requestedLine,
          message: oneLine(run.error) ?? 'Lean could not finish.',
          elapsedMs: now() - started,
        });
      }
      if (errors.length > 0) {
        // A rejected prefix is the expected consequence of cutting a multi-line
        // tactic in half; remember why in case nothing ever elaborates.
        firstError = firstError ?? firstErrorMessage(diagnostics);
        continue;
      }

      // The shared extractor first (it is what the checker uses); the armed walk
      // is the same handshake with the merged-trace shape handled.
      const goals = goalsFromDiagnostics(diagnostics, GOAL_TRACE_MARKER).map(formatGoal);
      const result = makeResult({
        status: goals.length > 0 ? 'goals' : 'complete',
        requestedLine,
        // line -1 means we fell back to the statement's own state.
        line: line < 0 ? null : line,
        goals,
        elapsedMs: now() - started,
      });
      this._remember(key, result);
      return result;
    }

    return makeResult({
      status: 'error',
      requestedLine,
      message: firstError ?? 'Lean rejected the proof up to this line.',
      elapsedMs: now() - started,
    });
  }

  _superseded(token) {
    return token !== this._token;
  }

  _stale(requestedLine, started) {
    this._stats.stale += 1;
    return makeResult({ status: 'stale', requestedLine, elapsedMs: now() - started });
  }

  _remember(key, result) {
    this._cache.set(key, result);
    while (this._cache.size > this.cacheSize) {
      // A Map iterates in insertion order, so the first key is the oldest.
      this._cache.delete(this._cache.keys().next().value);
    }
  }
}
