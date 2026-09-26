// Pure-function tests: no browser, no network.
//   node --test tests/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LESSONS, SANDBOX, THEMES, THEMES_AVAILABLE, THEMES_PLANNED, TOPICS, lessonById, lessonIndex,
  lessonPositionInTopic, nextLesson, nextUnsolvedLesson, previousLesson, themeById, themeOfLesson,
  themeOfTopic, themeProgress, topicById, topicOfLesson, topicProgress, totalProgress,
  validateContent,
} from '../site/src/content/index.js';
import {
  buildSource, codeOnly, forbiddenUsed, FORBIDDEN_HELP, GOAL_TRACE_MARKER, missingRequirements,
  PREVIEW_AXIOM,
} from '../site/src/lean/source.js';
import { locate, parseOutput, relevant } from '../site/src/lean/diagnostics.js';
import { formatGoal, goalsFromDiagnostics, goalsFromText } from '../site/src/lean/goals.js';
import { ABBREVIATIONS, expandAbbreviation, suggestAbbreviation } from '../site/src/lean/unicode.js';
import { coreLayerBytes } from '../site/src/lean/packs.js';

const tacticLesson = {
  kind: 'tactic',
  statement: 'example (n : Nat) : n = n',
  context: 'def double (n : Nat) := 2 * n',
};

// Regression guard: a stylesheet block was once deleted while the markup that
// used it stayed, and topic pages silently lost their lesson-row cards. Every
// class the app renders must therefore exist in the stylesheet, unless it is a
// deliberate hook with no visual role.
const STYLE_HOOKS = new Set(['next-step', 'theme']);

test('every class the app renders is styled, or a documented hook', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const site = join(root, 'site');
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) sources.push(readFileSync(full, 'utf8'));
    }
  };
  walk(join(site, 'src'));
  for (const page of ['index.html', '404.html']) sources.push(readFileSync(join(site, page), 'utf8'));

  const used = new Set();
  for (const text of sources) {
    for (const match of text.matchAll(/class(?:Name)?[:=]\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      for (const token of raw.split(/\s+/)) if (token) used.add(token);
    }
  }
  const css = readFileSync(join(site, 'assets', 'app.css'), 'utf8');
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const missing = [...used].filter((token) => !defined.has(token) && !STYLE_HOOKS.has(token)).sort();
  assert.deepEqual(missing, [], `these classes are rendered but never styled: ${missing.join(', ')}`);
  assert.ok(used.size > 60, 'the scan should find the app’s classes');
});

test('the content satisfies its own contract', () => {
  assert.deepEqual(validateContent(), []);
  assert.ok(TOPICS.length >= 5, 'at least five topics');
  assert.ok(LESSONS.length >= 20, 'a course-sized set of lessons');
});

test('validateContent actually catches broken content', () => {
  const problems = validateContent({
    topics: [{
      id: 'Broken Topic',
      title: 'T',
      summary: 's',
      intro: 'i',
      lessons: [
        { id: 'dup', title: 'a', focus: 'f', summary: 's', intro: 'i', task: 't', placeholder: 'p', hint: 'h', solution: 'sorry', statement: 'example : True := by skip' },
        { id: 'dup', title: 'b', focus: 'f', summary: 's', intro: 'i', task: 't', placeholder: 'p', hint: 'h', solution: 'x', statement: 'def nope := 1' },
        { id: 'file-with-statement', kind: 'file', title: 'c', focus: 'f', summary: 's', intro: 'i', task: 't', placeholder: 'p', hint: 'h', solution: 'x', statement: 'example : True' },
        { id: 'wrong-kind', kind: 'weird', title: 'd', focus: 'f', summary: 's', intro: 'i', task: 't', placeholder: 'p', hint: 'h', solution: 'x' },
      ],
    }],
  });
  const joined = problems.join('\n');
  assert.match(joined, /topic id "Broken Topic" must be kebab-case/);
  assert.match(joined, /duplicate lesson id/);
  assert.match(joined, /solution uses sorry/);
  assert.match(joined, /must not contain ':=\s*by'/);
  assert.match(joined, /needs a statement starting with example\/theorem/);
  assert.match(joined, /file lesson must not have a statement/);
  assert.match(joined, /unknown kind "weird"/);
});

test('the theme layer groups every topic exactly once', () => {
  assert.deepEqual(validateContent(), []);
  assert.ok(THEMES_AVAILABLE.length >= 1, 'at least one theme with material');
  assert.ok(THEMES_PLANNED.length >= 2, 'a roadmap of planned themes');
  assert.equal(THEMES.length, THEMES_AVAILABLE.length + THEMES_PLANNED.length);
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);

  for (const theme of THEMES) {
    if (theme.status === 'available') {
      assert.ok(theme.topics.length > 0, `${theme.id} needs topics`);
      for (const id of theme.topics) assert.ok(topicById(id), `${theme.id} references unknown topic ${id}`);
    } else {
      assert.equal(theme.topics.length, 0, `${theme.id} is planned, so it must not own topics`);
      assert.ok(theme.planned.length > 0, `${theme.id} needs planned topics`);
    }
    for (const entry of theme.planned) {
      assert.ok(entry.title && entry.summary, `${theme.id}/${entry.id} needs a title and summary`);
    }
  }

  // No orphan topics: everything is reachable from exactly one available theme.
  for (const topic of TOPICS) {
    const owners = THEMES.filter((theme) => theme.topics.includes(topic.id));
    assert.equal(owners.length, 1, `${topic.id} must be owned by exactly one theme`);
    assert.equal(owners[0].status, 'available');
  }
});

test('theme accessors and progress', () => {
  const theme = THEMES_AVAILABLE[0];
  assert.equal(themeById(theme.id), theme);
  assert.equal(themeOfTopic(TOPICS[0].id).id, theme.id);
  assert.equal(themeOfLesson(LESSONS[0].id).id, theme.id);
  assert.equal(themeOfTopic('nope'), null);
  assert.equal(themeOfLesson('nope'), null);

  const nothing = () => false;
  const none = themeProgress(theme, nothing);
  // Scoped to the theme: with more than one available theme the global totals are
  // larger than any single theme's.
  const ownLessons = theme.topics.flatMap((id) => topicById(id).lessons);
  assert.deepEqual(none, { solved: 0, total: ownLessons.length, topicsSolved: 0, topics: theme.topics.length, complete: false });
  const everything = (id) => Boolean(lessonById(id));
  const all = themeProgress(theme, everything);
  assert.equal(all.complete, true);
  assert.equal(all.topicsSolved, theme.topics.length);

  // Theme → topic → lesson order drives "what next".
  assert.equal(nextUnsolvedLesson(nothing).id, LESSONS[0].id);
  assert.equal(nextUnsolvedLesson(everything), null);
  const onlyFirstTopicDone = (id) => TOPICS[0].lessons.some((lesson) => lesson.id === id);
  assert.equal(nextUnsolvedLesson(onlyFirstTopicDone).id, TOPICS[1].lessons[0].id);
  assert.equal(themeProgress(theme, onlyFirstTopicDone).topicsSolved, 1);
});

test('validateContent catches a broken theme layer', () => {
  const problems = validateContent({
    themes: [
      { id: 'Bad Theme', status: 'available', title: 't', summary: 's', intro: 'i', topics: ['foundations', 'missing-topic'], planned: [] },
      { id: 'no-topics', status: 'available', title: 't', summary: 's', intro: 'i', topics: [], planned: [] },
      { id: 'also-claims', status: 'available', title: 't', summary: 's', intro: 'i', topics: ['foundations'], planned: [] },
      { id: 'dup', status: 'planned', title: 't', summary: 's', intro: 'i', topics: [], planned: [] },
      { id: 'dup', status: 'planned', title: 't', summary: 's', intro: 'i', topics: ['foundations'], planned: [{ id: 'x', title: 'x', summary: 's' }] },
    ],
  });
  const joined = problems.join('\n');
  assert.match(joined, /theme Bad Theme: id must be kebab-case/);
  assert.match(joined, /references unknown topic "missing-topic"/);
  assert.match(joined, /an available theme needs at least one topic/);
  assert.match(joined, /duplicate theme id/);
  assert.match(joined, /a planned theme must not own topics yet/);
  assert.match(joined, /a planned theme needs at least one planned topic/);
  assert.match(joined, /claimed by both/);
  // The real topics are not claimed by this fixture, so they must be reported.
  assert.match(joined, /topic "logic" is not listed by any theme/);
});

test('content accessors follow topic order', () => {
  const first = LESSONS[0];
  assert.equal(first.topic, TOPICS[0].id);
  assert.equal(topicOfLesson(first.id).id, TOPICS[0].id);
  assert.equal(lessonById(first.id), first);
  assert.equal(lessonIndex(first.id), 0);
  assert.equal(previousLesson(first.id), null);
  assert.equal(nextLesson(first.id), LESSONS[1]);
  assert.equal(nextLesson(LESSONS[LESSONS.length - 1].id), null);
  assert.equal(lessonById('does-not-exist'), null);
  assert.equal(topicById('does-not-exist'), null);

  // "Next lesson" crosses a topic boundary rather than dead-ending.
  const lastOfFirstTopic = TOPICS[0].lessons.at(-1);
  assert.equal(nextLesson(lastOfFirstTopic.id).topic, TOPICS[1].id);
  assert.equal(previousLesson(nextLesson(lastOfFirstTopic.id).id).id, lastOfFirstTopic.id);

  // Position inside the topic.
  const position = lessonPositionInTopic(TOPICS[0].lessons[1].id);
  assert.deepEqual(position, { index: 1, count: TOPICS[0].lessons.length });
});

test('progress helpers count what is solved', () => {
  const topic = TOPICS[0];
  const solved = new Set([topic.lessons[0].id, topic.lessons[1].id]);
  const isSolved = (id) => solved.has(id);
  assert.deepEqual(topicProgress(topic, isSolved), { solved: 2, total: topic.lessons.length, complete: false });
  const everything = (id) => Boolean(lessonById(id));
  assert.deepEqual(topicProgress(topic, everything), { solved: topic.lessons.length, total: topic.lessons.length, complete: true });
  assert.deepEqual(totalProgress(isSolved), { solved: 2, total: LESSONS.length });

  assert.equal(nextUnsolvedLesson(isSolved).id, topic.lessons[2].id);
  assert.equal(nextUnsolvedLesson(everything), null);
  // A per-topic view ignores other topics.
  assert.equal(nextUnsolvedLesson(isSolved, [TOPICS[1]]).id, TOPICS[1].lessons[0].id);
});

test('every lesson has a unique id across the whole course', () => {
  const ids = LESSONS.map((lesson) => lesson.id);
  assert.equal(new Set(ids).size, ids.length, 'lesson ids must be globally unique (routes use them raw)');
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/, `${id} must be URL-safe`);
});

test('buildSource maps a tactic lesson onto generated lines', () => {
  const source = buildSource(tacticLesson, 'rw [h]\nexact hp');
  const lines = source.code.split('\n');
  assert.equal(lines[source.userStartLine - 1], '  rw [h]');
  assert.equal(lines[source.userStartLine], '  exact hp');
  assert.equal(source.userLineCount, 2);
  assert.match(source.code, /set_option autoImplicit false/);
  assert.match(source.code, /example \(n : Nat\) : n = n := by/);
  assert.ok(!source.code.includes(PREVIEW_AXIOM), 'plain compile must not include the preview axiom');
});

test('buildSource preview mode appends the goal wrapper after the learner block', () => {
  const source = buildSource(tacticLesson, 'rfl', { preview: true });
  const lines = source.code.split('\n');
  assert.equal(lines[source.wrapperStartLine - 1], '  all_goals');
  assert.ok(source.code.includes(GOAL_TRACE_MARKER));
  assert.ok(source.code.includes(`private axiom ${PREVIEW_AXIOM} {α : Sort _} : α`));
});

test('buildSource handles a file lesson: no statement, learner owns the lines', () => {
  const lesson = { kind: 'file', context: 'def double (n : Nat) := 2 * n' };
  const source = buildSource(lesson, '#check double\n#eval double 21');
  assert.ok(!source.code.includes(':= by'), 'file lessons must not inject a proof skeleton');
  assert.match(source.code, /def double \(n : Nat\) := 2 \* n/);
  const lines = source.code.split('\n');
  assert.equal(lines[source.userStartLine - 1], '#check double');
  assert.equal(lines[source.userStartLine], '#eval double 21');
  assert.equal(source.userLineCount, 2);
  assert.equal(source.empty, false);
});

test('buildSource flags comment-only input as empty for both kinds', () => {
  for (const lesson of [tacticLesson, { kind: 'file' }]) {
    assert.equal(buildSource(lesson, '-- nothing yet\n\n').empty, true);
  }
  assert.equal(buildSource({ kind: 'file' }, '#eval 1').empty, false);
});

test('codeOnly strips comments and strings but keeps a line count', () => {
  const code = 'rw [h] -- sorry\n  exact "sorry"\n/- sorry -/\nexact hp';
  const stripped = codeOnly(code);
  assert.equal(stripped.split('\n').length, code.split('\n').length);
  assert.ok(!/sorry/.test(stripped));
  assert.match(stripped, /exact hp/);
});

test('forbiddenUsed sees real uses only, including per-lesson extras', () => {
  assert.deepEqual(forbiddenUsed('exact hp'), []);
  assert.deepEqual(forbiddenUsed('-- sorry is not used here'), []);
  assert.deepEqual(forbiddenUsed('exact "sorry"'), []);
  assert.deepEqual(forbiddenUsed('sorry').map((entry) => entry.word), ['sorry']);
  assert.deepEqual(forbiddenUsed('native_decide').map((entry) => entry.word), ['native_decide']);
  assert.deepEqual(forbiddenUsed('sorry_placeholder'), []);
  assert.deepEqual(forbiddenUsed('omega', ['omega']).map((entry) => entry.word), ['omega']);
  assert.ok(FORBIDDEN_HELP.sorry.includes('not a proof'));
});

test('missingRequirements is whitespace-insensitive', () => {
  assert.deepEqual(missingRequirements('#eval 2 ^ 10', ['#eval', '2^10']), []);
  assert.deepEqual(missingRequirements('#eval 2 ^ 10', ['2 ^ 10', '^']), []);
  assert.deepEqual(missingRequirements('#check Nat.add_comm', ['#eval']), ['#eval']);
  assert.deepEqual(missingRequirements('def double (n : Nat) := 2 * n\n#eval double 21', ['def double', 'double 21']), []);
  assert.deepEqual(missingRequirements('-- #eval in a comment', ['#eval']), ['#eval']);
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
  assert.equal(diagnostics[2].message, '4');
  assert.equal(diagnostics[3].severity, 'error');
});

test('locate maps diagnostics onto learner lines and hides generated ones', () => {
  const source = buildSource(tacticLesson, 'rw [h]\nexact hp');
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

test('goalsFromDiagnostics handles Lean merging traces that share a position', () => {
  // Exactly what the browser runtime emits for two open goals: the markers merge
  // into one message, and the states share the next one (no marker in it).
  const diagnostics = [
    { severity: 'information', kind: 'trace', message: `${GOAL_TRACE_MARKER}\n${GOAL_TRACE_MARKER}` },
    { severity: 'information', kind: 'trace', message: 'case left\np q : Prop\nhp : p\nhq : q\n⊢ p\ncase right\np q : Prop\nhp : p\nhq : q\n⊢ q' },
  ];
  const goals = goalsFromDiagnostics(diagnostics, GOAL_TRACE_MARKER);
  assert.equal(goals.length, 2);
  assert.match(goals[0], /^case left/);
  assert.match(goals[1], /^case right/);
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
  const untouched = { value: 'rw [h]', selectionStart: 3, selectionEnd: 5, setSelectionRange() {} };
  assert.equal(expandAbbreviation(untouched), false);
  assert.equal(untouched.value, 'rw [h]');
});

test('coreLayerBytes sums the pack sizes', () => {
  assert.equal(coreLayerBytes({ packs: [{ compressedBytes: 100 }, { compressedBytes: 23 }] }), 123);
  assert.equal(coreLayerBytes({}), 0);
});

test('sandbox content is present and self-consistent', () => {
  assert.match(SANDBOX.starter, /#eval/);
  assert.ok(SANDBOX.intro.length > 20);
  assert.notEqual(SANDBOX.placeholder.trim(), SANDBOX.starter.trim());
});

test('no lesson needs Mathlib-style imports (the browser env is Init-only)', () => {
  for (const lesson of LESSONS) {
    assert.ok(!/\bimport\b/.test(lesson.context ?? ''), `${lesson.id} must not import`);
    assert.ok(!/^import\b/m.test(lesson.solution), `${lesson.id} solution must not import`);
  }
});
