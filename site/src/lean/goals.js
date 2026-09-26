// Read the open-goal snapshot out of the goal-inspection compile.
//
// The generated wrapper runs
//     all_goals
//       trace "<marker>"
//       trace_state
//     all_goals exact <preview axiom>
// so every open goal is logged. Lean's message log does not always keep the
// marker and its state apart: two traces at the same source range can arrive as
// one message ("<marker>\ncase … ⊢ …"), and a learner who types `trace_state`
// themselves adds their own copies. Both shapes are handled here.

const TURNSTILE = '\u22a2'; // ⊢

/** Pull every `case …` block that contains a turnstile out of one message. */
export function goalsFromText(text) {
  const state = String(text)
    .split('\n')
    .filter((line, index) => !(index === 0 && line.trim() === 'unsolved goals'))
    .join('\n')
    .trim();
  if (!state.includes(TURNSTILE)) return [];
  const caseStarts = [...state.matchAll(/^case .+$/gm)].map((match) => match.index ?? 0);
  if (caseStarts.length <= 1) return [state];
  const goals = [];
  for (let index = 0; index < caseStarts.length; index += 1) {
    const slice = state.slice(caseStarts[index], caseStarts[index + 1]).trim();
    if (slice.includes(TURNSTILE)) goals.push(slice);
  }
  return goals;
}

const isTrace = (diagnostic) =>
  diagnostic.severity === 'information' || (diagnostic.kind || '').includes('trace');

/**
 * @param {import('./diagnostics.js').RawDiagnostic[]} diagnostics
 * @param {string} marker
 * @returns {string[]}
 */
export function goalsFromDiagnostics(diagnostics, marker) {
  /** @type {string[]} */
  const goals = [];
  let armed = false;
  for (const diagnostic of diagnostics) {
    if (diagnostic.raw || !isTrace(diagnostic)) continue;
    const message = diagnostic.message.trim();
    let payload = null;
    // Use the LAST marker in the message. Lean merges traces that share a source
    // position, so two open goals arrive as `"<marker>\n<marker>"` followed by a
    // single message holding both `case …` blocks — splitting on the first marker
    // would leave the marker itself as the "state" and lose every goal, and the
    // trace pass would report a still-open proof as complete.
    const markerIndex = message.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const rest = message.slice(markerIndex + marker.length).trim();
      if (!rest) { armed = true; continue; }
      payload = rest; // marker and state arrived as one message
    } else if (armed) {
      payload = message;
      armed = false;
    } else {
      continue;
    }
    for (const goal of goalsFromText(payload)) goals.push(goal);
  }
  return [...new Set(goals)];
}

/** Pretty-print one goal state with the turnstile spaced for the UI. */
export function formatGoal(goal) {
  return goal
    .split('\n')
    .map((line) => line.split(TURNSTILE).join(' \u22a2 '))
    .join('\n');
}
