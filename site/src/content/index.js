// Content contract — the boundary between course material and mechanism.
//
// Everything under content/ is *data*: no imports from ../lean or ../ui, no
// knowledge of how a proof is compiled, checked or rendered. The mechanism
// (src/lean/*, src/ui/*, src/main.js) reads it only through this module's
// accessors and switches on declared fields, never on lesson ids.
//
// A lesson is one of two shapes:
//
//   kind: 'tactic' (default)      the lesson owns the statement, the learner owns
//                                 the tactic block:
//       statement  'example (n : Nat) : n + 0 = n'   (the `:= by` is added)
//       solution   'simp'
//
//   kind: 'file'                  the learner owns the whole file (commands like
//                                 `#check`, `#eval`, `def`, so they can be
//                                 exercises too):
//       solution   'def double (n : Nat) := 2 * n\n#eval double 21'
//
// Fields common to both: id, title, focus, summary, intro, task, placeholder,
// hint, and optionally context (fixed preamble), require / forbid (source
// constraints), expects (kind 'file': substrings the output must contain).
//
// Topics are grouped into *themes*, which are the broad areas of the course. A
// theme that exists declares the topic ids it owns; a theme that does not exist
// yet declares `planned` topics instead, so the roadmap is data too and the index
// can show it without pretending the lessons are there.
//
// validateContent() below is the executable version of this comment; tests/unit
// runs it, so content that breaks the contract cannot be committed.

import { foundations } from './topics/foundations.js';
import { logic } from './topics/logic.js';
import { quantifiers } from './topics/quantifiers.js';
import { numbers } from './topics/numbers.js';
import { rewriting } from './topics/rewriting.js';
import { automation } from './topics/automation.js';
import { tools } from './topics/tools.js';
import { proofBasics } from './themes/proof-basics.js';
import {
  dataStructures, functionalProgramming, maths, metaprogramming, programVerification,
} from './themes/planned.js';

/** Order matters: it is the reading order and the "next lesson" order. */
export const TOPICS = [foundations, logic, quantifiers, numbers, rewriting, automation, tools];

/** Themes in reading order: the one that exists first, then the roadmap. */
export const THEMES = [proofBasics, programVerification, functionalProgramming, dataStructures, maths, metaprogramming];

const byLessonId = new Map();
const byTopicId = new Map();
const themeByTopicId = new Map();
const order = [];

for (const topic of TOPICS) {
  byTopicId.set(topic.id, topic);
  for (const lesson of topic.lessons) {
    lesson.topic = topic.id;
    lesson.kind = lesson.kind ?? 'tactic';
    byLessonId.set(lesson.id, lesson);
    order.push(lesson.id);
  }
}

export const LESSONS = order.map((id) => byLessonId.get(id));

for (const theme of THEMES) {
  theme.topics = theme.topics ?? [];
  theme.planned = theme.planned ?? [];
  for (const topicId of theme.topics) themeByTopicId.set(topicId, theme);
}

export const THEMES_AVAILABLE = THEMES.filter((theme) => theme.status === 'available');
export const THEMES_PLANNED = THEMES.filter((theme) => theme.status === 'planned');

export const SANDBOX = {
  title: 'A blank Lean file',
  intro:
    'Everything is elaborated against Lean’s Init environment: definitions, `#check`, `#eval`, theorems. ' +
    'Imports are unavailable — there is no Mathlib in the browser build.',
  placeholder: '-- write Lean here: definitions, #check, #eval',
  starter: [
    "-- A free-form file, elaborated against Lean's Init environment.",
    '-- Imports are not available here (there is no Mathlib in the browser build).',
    '#check Nat.add_comm',
    '#eval 2 ^ 10',
    '',
    'theorem my_first (p : Prop) : p → p := by',
    '  intro hp',
    '  exact hp',
    '',
  ].join('\n'),
};

export function lessonById(id) {
  return byLessonId.get(id) ?? null;
}

export function lessonIndex(id) {
  return order.indexOf(id);
}

export function topicById(id) {
  return byTopicId.get(id) ?? null;
}

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) ?? null;
}

/** The theme that owns a topic (null for unknown topics). */
export function themeOfTopic(id) {
  return themeByTopicId.get(id) ?? null;
}

/** The theme a lesson belongs to, via its topic. */
export function themeOfLesson(id) {
  const topic = topicOfLesson(id);
  return topic ? themeOfTopic(topic.id) : null;
}

/** { solved, total, topicsSolved, topics, complete } for one theme. */
export function themeProgress(theme, isSolved = () => false) {
  const lessons = theme.topics.flatMap((topicId) => byTopicId.get(topicId)?.lessons ?? []);
  const solved = lessons.filter((lesson) => isSolved(lesson.id)).length;
  const topicsSolved = theme.topics.filter((topicId) => {
    const lessons = byTopicId.get(topicId)?.lessons ?? [];
    return lessons.length > 0 && lessons.every((lesson) => isSolved(lesson.id));
  }).length;
  return {
    solved,
    total: lessons.length,
    topicsSolved,
    topics: theme.topics.length,
    complete: lessons.length > 0 && solved === lessons.length,
  };
}

export function topicOfLesson(id) {
  const lesson = lessonById(id);
  return lesson ? byTopicId.get(lesson.topic) : null;
}

/** Position of a lesson inside its topic, as { index, count }. */
export function lessonPositionInTopic(id) {
  const topic = topicOfLesson(id);
  if (!topic) return null;
  const index = topic.lessons.findIndex((lesson) => lesson.id === id);
  return { index, count: topic.lessons.length };
}

export function nextLesson(id) {
  const index = lessonIndex(id);
  return index >= 0 && index + 1 < LESSONS.length ? LESSONS[index + 1] : null;
}

export function previousLesson(id) {
  const index = lessonIndex(id);
  return index > 0 ? LESSONS[index - 1] : null;
}

/** { solved, total, complete } for one topic given a solved-set lookup. */
export function topicProgress(topic, isSolved = () => false) {
  const solved = topic.lessons.filter((lesson) => isSolved(lesson.id)).length;
  return { solved, total: topic.lessons.length, complete: solved === topic.lessons.length && topic.lessons.length > 0 };
}

export function totalProgress(isSolved = () => false) {
  const solved = LESSONS.filter((lesson) => isSolved(lesson.id)).length;
  return { solved, total: LESSONS.length };
}

/** The first lesson that is not solved yet, following theme then topic order. */
export function nextUnsolvedLesson(isSolved = () => false, topics = null) {
  const ordered = topics ?? THEMES_AVAILABLE.flatMap((theme) => theme.topics).map((id) => byTopicId.get(id));
  for (const topic of ordered) {
    for (const lesson of topic?.lessons ?? []) {
      if (!isSolved(lesson.id)) return lesson;
    }
  }
  return null;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Contract check. Returns a list of human-readable problems (empty = valid).
 * @param {{topics?: typeof TOPICS}} [options]
 */
export function validateContent(options = {}) {
  const topics = options.topics ?? TOPICS;
  const themesInput = options.themes ?? THEMES;
  const problems = [];
  const seenTopics = new Set();
  const seenTopicIds = seenTopics;
  const seenLessons = new Set();

  for (const topic of topics) {
    if (!ID_PATTERN.test(topic.id)) problems.push(`topic id "${topic.id}" must be kebab-case`);
    if (seenTopics.has(topic.id)) problems.push(`duplicate topic id "${topic.id}"`);
    seenTopics.add(topic.id);
    for (const field of ['title', 'summary', 'intro']) {
      if (typeof topic[field] !== 'string' || topic[field].trim() === '') problems.push(`topic ${topic.id} is missing ${field}`);
    }
    if (!Array.isArray(topic.lessons) || topic.lessons.length === 0) {
      problems.push(`topic ${topic.id} has no lessons`);
      continue;
    }

    for (const lesson of topic.lessons) {
      const where = `${topic.id}/${lesson.id}`;
      // 'tactic' is the documented default, so validation must apply it too.
      const kind = lesson.kind ?? 'tactic';
      if (typeof lesson.id !== 'string' || !ID_PATTERN.test(lesson.id)) problems.push(`${where}: id must be kebab-case`);
      if (seenLessons.has(lesson.id)) problems.push(`${where}: duplicate lesson id at this scope`);
      seenLessons.add(lesson.id);

      for (const field of ['title', 'focus', 'summary', 'intro', 'task', 'placeholder', 'hint', 'solution']) {
        if (typeof lesson[field] !== 'string' || lesson[field].trim() === '') problems.push(`${where}: missing ${field}`);
      }
      if (kind === 'tactic') {
        if (typeof lesson.statement !== 'string' || !/^(example|theorem)\b/.test(lesson.statement.trim())) {
          problems.push(`${where}: a tactic lesson needs a statement starting with example/theorem`);
        }
        if (typeof lesson.statement === 'string' && lesson.statement.includes(':= by')) {
          problems.push(`${where}: statement must not contain ':= by' (the mechanism adds it)`);
        }
        if (lesson.expects) problems.push(`${where}: 'expects' only applies to file lessons`);
      } else if (kind === 'file') {
        if (lesson.statement) problems.push(`${where}: a file lesson must not have a statement`);
        if (lesson.expects && !Array.isArray(lesson.expects)) problems.push(`${where}: expects must be an array`);
      } else {
        problems.push(`${where}: unknown kind "${kind}"`);
      }
      if (lesson.forbid && !Array.isArray(lesson.forbid)) problems.push(`${where}: forbid must be an array`);
      if (lesson.require && !Array.isArray(lesson.require)) problems.push(`${where}: require must be an array`);
      if (/\bsorry\b/.test(lesson.solution)) problems.push(`${where}: solution uses sorry`);
      if (lesson.placeholder.trim() === lesson.solution.trim()) problems.push(`${where}: placeholder must not be the solution`);
      if (lesson.placeholder.trimStart().startsWith('--')) problems.push(`${where}: placeholder must not look like a comment to delete`);
    }
  }
  // Themes: the broad areas, and the roadmap.
  const seenThemes = new Set();
  const ownedTopics = new Map();
  const plannedIds = new Set();
  for (const theme of themesInput) {
    const where = `theme ${theme.id}`;
    if (typeof theme.id !== 'string' || !ID_PATTERN.test(theme.id)) problems.push(`${where}: id must be kebab-case`);
    if (seenThemes.has(theme.id)) problems.push(`${where}: duplicate theme id`);
    seenThemes.add(theme.id);
    for (const field of ['title', 'summary', 'intro']) {
      if (typeof theme[field] !== 'string' || theme[field].trim() === '') problems.push(`${where}: missing ${field}`);
    }
    if (theme.status !== 'available' && theme.status !== 'planned') problems.push(`${where}: status must be 'available' or 'planned'`);

    const topics = Array.isArray(theme.topics) ? theme.topics : [];
    const planned = Array.isArray(theme.planned) ? theme.planned : [];
    if (theme.status === 'available' && topics.length === 0) problems.push(`${where}: an available theme needs at least one topic`);
    if (theme.status === 'planned' && topics.length > 0) problems.push(`${where}: a planned theme must not own topics yet`);

    for (const topicId of topics) {
      if (!seenTopicIds.has(topicId)) problems.push(`${where}: references unknown topic "${topicId}"`);
      if (ownedTopics.has(topicId)) problems.push(`topic "${topicId}" is claimed by both ${ownedTopics.get(topicId)} and ${theme.id}`);
      ownedTopics.set(topicId, theme.id);
    }
    for (const entry of planned) {
      if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) problems.push(`${where}: planned topic id "${entry.id}" must be kebab-case`);
      if (seenTopicIds.has(entry.id) || plannedIds.has(entry.id)) problems.push(`${where}: planned topic "${entry.id}" collides with another id`);
      plannedIds.add(entry.id);
      for (const field of ['title', 'summary']) {
        if (typeof entry[field] !== 'string' || entry[field].trim() === '') problems.push(`${where}: planned topic ${entry.id} is missing ${field}`);
      }
    }
    if (theme.status === 'planned' && planned.length === 0) problems.push(`${where}: a planned theme needs at least one planned topic`);
  }
  for (const topicId of seenTopicIds) {
    if (!ownedTopics.has(topicId)) problems.push(`topic "${topicId}" is not listed by any theme (it would be unreachable)`);
  }

  return problems;
}
