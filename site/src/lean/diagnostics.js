// The Lean WASM fork prints one JSON diagnostic per line on stdout/stderr:
//
//   {"severity":"error","data":"unsolved goals\n…","kind":"unsolvedGoals",
//    "pos":{"line":7,"column":2},"endPos":{"line":7,"column":9}}
//
// Anything that is not JSON is raw program output (`#eval`, `#print`), which we
// keep verbatim for the sandbox. Line numbers refer to the generated file, so
// they are remapped onto the learner's tactic block here.

/**
 * @typedef {Object} RawDiagnostic
 * @property {'error'|'warning'|'information'} severity
 * @property {string} message
 * @property {string} [caption]
 * @property {string} [kind]
 * @property {{line: number, column: number}} [pos]
 * @property {{line: number, column: number}} [endPos]
 * @property {boolean} [raw]
 */

/**
 * @param {{stream: string, data: string}[]} output
 * @returns {RawDiagnostic[]}
 */
export function parseOutput(output) {
  /** @type {RawDiagnostic[]} */
  const diagnostics = [];
  for (const chunk of output) {
    for (const line of String(chunk.data ?? '').split('\n')) {
      if (!line.trim()) continue;
      let parsed = null;
      if (line.trimStart().startsWith('{')) {
        try { parsed = JSON.parse(line); } catch { parsed = null; }
      }
      if (parsed && typeof parsed === 'object' && 'data' in parsed) {
        const severity = parsed.severity === 'error' || parsed.severity === 'warning'
          ? parsed.severity
          : 'information';
        diagnostics.push({
          severity,
          message: String(parsed.data ?? ''),
          caption: parsed.caption,
          kind: parsed.kind,
          pos: parsed.pos,
          endPos: parsed.endPos,
        });
      } else {
        diagnostics.push({
          severity: chunk.stream === 'stderr' ? 'error' : 'information',
          message: line.trimEnd(),
          raw: true,
        });
      }
    }
  }
  return diagnostics;
}

/**
 * Attach learner-relative line numbers.
 *
 * @param {RawDiagnostic[]} diagnostics
 * @param {{userStartLine: number, userLineCount: number, wrapperStartLine: number}} mapping
 */
export function locate(diagnostics, mapping) {
  const userEnd = mapping.userStartLine + mapping.userLineCount; // exclusive
  return diagnostics.map((diagnostic) => {
    const line = diagnostic.pos?.line;
    let userLine = null;
    let component = 'context';
    if (typeof line === 'number') {
      if (line >= mapping.userStartLine && line < userEnd) {
        userLine = line - mapping.userStartLine + 1;
        component = 'learner';
      } else if (line >= mapping.wrapperStartLine) {
        component = 'generated';
      }
    }
    return { ...diagnostic, userLine, component };
  });
}

/** Only what the learner should read: their own lines plus anything serious. */
export function relevant(diagnostics) {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.raw) return true;
    if (diagnostic.component === 'learner') return true;
    return diagnostic.severity === 'error';
  });
}

/**
 * `grind?`, `simp?` and the other `?` variants report what their search found as
 * an information diagnostic that starts with "Try this:" — a proof, not a
 * problem to fix. Editors render the tag on each suggestion line (`[apply]`) as
 * a clickable code action; there is no editor here, so it is dropped and the
 * learner reads the tactic itself.
 */
const SUGGESTION_HEADER = /^\s*Try (?:this|these):/;
const CODE_ACTION_TAG = /^\s*\[apply\]\s*/;

/** Is this diagnostic a reported search result rather than something to fix? */
export function isSuggestion(diagnostic) {
  return diagnostic?.severity === 'information' && SUGGESTION_HEADER.test(diagnostic.message ?? '');
}

/**
 * The reported suggestions, one entry per message, without the editor-only tag:
 *
 *   Try this:
 *     [apply] grind only [= List.length_append]
 *
 * becomes `Try this:\n  grind only [= List.length_append]`.
 *
 * @param {RawDiagnostic[]} diagnostics
 * @returns {string[]}
 */
export function suggestionsFrom(diagnostics) {
  return diagnostics.filter(isSuggestion).map((diagnostic) => String(diagnostic.message)
    .split('\n')
    .map((line) => line.replace(CODE_ACTION_TAG, ''))
    .join('\n')
    .trimEnd());
}

export function countBySeverity(diagnostics, severity) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
}
