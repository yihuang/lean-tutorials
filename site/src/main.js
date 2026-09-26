// App shell: hash router, engine status, topic and lesson pages, sandbox.
//
// Content comes from src/content (data only); this file knows nothing about
// specific lessons. It renders whatever the accessors hand it: topics, their
// lessons, and the two lesson kinds the content contract defines.

import { LeanEngine } from './lean/engine.js';
import { GoalProbe } from './lean/infoview.js';
import { checkLesson } from './lean/tutorial.js';
import { locate, parseOutput } from './lean/diagnostics.js';
import {
  LESSONS, SANDBOX, TOPICS, lessonById, lessonPositionInTopic, nextLesson, nextUnsolvedLesson,
  previousLesson, topicById, topicOfLesson, topicProgress, totalProgress,
} from './content/index.js';
import { createEditor } from './ui/editor.js';
import { createInfoviewPanel } from './ui/infoview-panel.js';
import { clear, h } from './ui/dom.js';
import { inlineProse, prose } from './ui/prose.js';

const STORAGE_KEY = 'lean-tutorials:v1';
const main = document.getElementById('main');
const chip = document.getElementById('engine-chip');
const chipDot = chip.querySelector('.dot');
const chipLabel = document.getElementById('engine-label');

const bootBar = h('div', { class: 'progress-track', id: 'boot-bar' }, h('i'));
bootBar.style.display = 'none';
document.querySelector('.topbar').after(bootBar);

const statusPanel = h('div', { class: 'card', id: 'engine-panel' });
statusPanel.style.display = 'none';

/** @type {{solved: Record<string, boolean>, drafts: Record<string, string>, sandbox: string}} */
const store = loadStore();

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      solved: parsed.solved && typeof parsed.solved === 'object' ? parsed.solved : {},
      drafts: parsed.drafts && typeof parsed.drafts === 'object' ? parsed.drafts : {},
      sandbox: typeof parsed.sandbox === 'string' ? parsed.sandbox : '',
      infoviewCollapsed: Boolean(parsed.infoviewCollapsed),
    };
  } catch {
    return { solved: {}, drafts: {}, sandbox: '', infoviewCollapsed: false };
  }
}

function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

const isSolved = (id) => Boolean(store.solved[id]);

const engine = new LeanEngine();
engine.start().catch(() => { /* surfaced through engine.state */ });

// Cursor-driven goals. One instance: its cache is keyed by lesson id, and the
// engine already serialises compiles.
const goalProbe = new GoalProbe(engine, { maxBackoff: 3, cacheSize: 32 });

const STATE_TEXT = {
  idle: 'Starting Lean…',
  booting: 'Starting Lean…',
  staging: 'Loading Lean core…',
  importing: 'Importing Lean core…',
  ready: 'Lean ready',
  error: 'Lean failed',
};

let syncUi = () => {};

engine.subscribe((current) => {
  chipDot.dataset.state = current.state;
  const percent = current.progress.percent;
  chipLabel.textContent = current.state === 'ready'
    ? 'Lean ready'
    : (current.progress.message || STATE_TEXT[current.state] || current.state);
  if (percent !== null && current.state !== 'ready' && current.state !== 'error') {
    bootBar.style.display = 'block';
    bootBar.firstChild.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  } else {
    bootBar.style.display = 'none';
  }
  syncUi();
});

function renderStatusPanel() {
  clear(statusPanel);
  const progress = engine.progress;
  statusPanel.append(
    h('p', { class: 'eyebrow', text: 'Lean runtime' }),
    h('p', { text: progress.message || STATE_TEXT[engine.state] }),
  );
  if (typeof SharedArrayBuffer === 'undefined') {
    statusPanel.append(h('p', { class: 'banner err', text:
      'This page is not cross-origin isolated, so the Lean runtime cannot use shared memory. ' +
      'That happens when the site is opened from a file:// URL or a host that does not send the COOP/COEP headers.' }));
  }
  if (engine.state === 'error') {
    statusPanel.append(h('p', { class: 'banner err', text: engine.error?.message ?? 'Unknown error.' }));
  }
  if (progress.detail) statusPanel.append(h('p', { class: 'small muted', text: progress.detail }));
  if (engine.state === 'ready') {
    const { downloaded, cached } = engine.networkBytes;
    const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
    statusPanel.append(h('p', { class: 'small muted', text: downloaded === 0
      ? `This visit: 0 MB downloaded, ${mb(cached)} of Lean core served from the browser cache.`
      : `This visit: ${mb(downloaded)} downloaded, ${mb(cached)} from cache. The next visit downloads nothing.` }));
  }
  statusPanel.append(h('p', { class: 'small muted', text:
    'First visit downloads the runtime (~47 MB compressed) and the Lean core library; both are cached by the browser, ' +
    'so reloads and later visits transfer nothing but a few KB of revalidation. Nothing you type leaves the device.' }));
}

chip.addEventListener('click', () => {
  if (engine.state === 'error') { location.reload(); return; }
  statusPanel.style.display = statusPanel.style.display === 'none' ? 'block' : 'none';
  renderStatusPanel();
});

// ------------------------------------------------------------------ router

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [section, param] = hash.split('/');
  clear(main);
  goalProbe.cancel();
  statusPanel.style.display = 'none';
  syncUi = () => {};
  if (section === 'topic' && topicById(param)) renderTopic(topicById(param));
  else if (section === 'lesson' && lessonById(param)) renderLesson(lessonById(param));
  else if (section === 'sandbox') renderSandbox();
  else renderHome();
  // The status panel belongs to the header chip, so it must exist on every view.
  main.prepend(statusPanel);
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', route);

// -------------------------------------------------------------------- parts

const lessonHref = (id) => `#/lesson/${id}`;
const topicHref = (id) => `#/topic/${id}`;

const pips = (topic) => h('span', { class: 'pips', 'aria-hidden': 'true' },
  topic.lessons.map((lesson) => h('i', {
    class: 'pip',
    dataset: { state: isSolved(lesson.id) ? 'solved' : lesson === nextUnsolvedLesson(isSolved, [topic]) ? 'next' : 'todo' },
  })));

function lessonRow(lesson, number, nextId) {
  return h('li', {
    class: 'lesson-item',
    dataset: {
      solved: isSolved(lesson.id) ? 'true' : 'false',
      next: lesson.id === nextId ? 'true' : 'false',
    },
  }, h('a', { href: lessonHref(lesson.id) },
    h('span', { class: 'lesson-num', text: String(number) }),
    h('span', { class: 'lesson-meta' },
      h('span', { class: 'lesson-title', text: lesson.title }),
      h('span', { class: 'lesson-sub' }, h('code', { text: lesson.focus }), ` — ${lesson.summary}`)),
    isSolved(lesson.id)
      ? h('span', { class: 'lesson-tick', text: '✓' })
      : (lesson.id === nextId ? h('span', { class: 'next-chip', text: 'next' }) : null)));
}

// -------------------------------------------------------------------- home

function renderHome() {
  const overall = totalProgress(isSolved);
  const nextUp = nextUnsolvedLesson(isSolved);

  main.append(
    h('h1', { text: 'Proofs, checked on your own device' }),
    h('p', {}, inlineProse(
      'Short Lean 4 tutorials in seven topics. The real Lean compiler runs locally in WebAssembly — ' +
      'your browser checks every proof, nothing is sent to a server, and it works on a phone.')),
    h('p', { class: 'small muted', text:
      `${overall.solved} of ${overall.total} lessons done · ` +
      `${TOPICS.filter((topic) => topicProgress(topic, isSolved).complete).length} of ${TOPICS.length} topics finished · ` +
      `${engine.state === 'ready' ? 'Lean is ready, checks are instant' : 'Lean is still warming up in the background'}` }),
    nextUp
      ? h('p', {}, inlineProse(`Next up: **${nextUp.title}** — `), h('a', { href: lessonHref(nextUp.id), text: 'continue →' }))
      : h('p', {}, inlineProse('All lessons done. Try the [sandbox](#/sandbox) with your own statements.')),
  );

  const list = h('ol', { class: 'topic-list' });
  TOPICS.forEach((topic, index) => {
    const progress = topicProgress(topic, isSolved);
    const next = topic.lessons.find((lesson) => !isSolved(lesson.id));
    list.append(h('li', { class: 'topic-card', dataset: { complete: progress.complete ? 'true' : 'false' } },
      h('a', { class: 'topic-head', href: topicHref(topic.id) },
        h('span', { class: 'lesson-num', text: String(index + 1) }),
        h('span', { class: 'topic-meta' },
          h('span', { class: 'topic-title', text: topic.title }),
          h('span', { class: 'topic-sub', text: topic.summary })),
        h('span', { class: 'topic-side' },
          pips(topic),
          h('span', { class: 'topic-count', text: `${progress.solved}/${progress.total}` }))),
      h('p', { class: 'topic-next small muted' },
        next
          ? [inlineProse('Next: '), h('a', { href: lessonHref(next.id), text: next.title })]
          : inlineProse(`All ${progress.total} lessons done.`))));
  });
  main.append(list);

  main.append(h('div', { class: 'card', style: 'margin-top:16px' },
    h('p', { class: 'eyebrow', text: 'Free play' }),
    h('p', {}, inlineProse('A blank Lean file with `#check`, `#eval` and definitions — the same engine, no task.')),
    h('a', { class: 'btn', href: '#/sandbox', style: 'display:inline-block;text-decoration:none;line-height:44px', text: 'Open the sandbox' })));

  main.append(h('details', { class: 'hint', style: 'margin-top:16px' },
    h('summary', { text: 'How does this work, and why does it need 47 MB?' }),
    h('div', { class: 'body' },
      h('p', {}, inlineProse(
        'Lean 4 is compiled to WebAssembly, including a build of its core library, and it runs in a Web Worker ' +
        'on your device. The first visit downloads that runtime (about 47 MB brotli-compressed), then stores it in ' +
        'the browser cache. Afterwards, checking a proof takes milliseconds.')),
      h('p', {}, inlineProse(
        'The runtime and the packed Lean core library are redistributed from ' +
        '[lean.cau.li](https://lean.cau.li) ([source](https://github.com/cauli/lean4-wasm-in-browser), Apache-2.0), ' +
        'served from this origin because the worker has to be same-origin.')),
      h('p', { class: 'small muted' }, inlineProse(
        'Requirements: a browser with WebAssembly threads (SharedArrayBuffer), i.e. a cross-origin isolated page. ' +
        'On iOS the runtime needs a recent Safari; on low-memory devices it may take a couple of attempts.')))));
}

// ------------------------------------------------------------------- topic

function renderTopic(topic) {
  const index = TOPICS.indexOf(topic);
  const progress = topicProgress(topic, isSolved);
  const next = topic.lessons.find((lesson) => !isSolved(lesson.id)) ?? topic.lessons[0];
  const remaining = topic.lessons.length - progress.solved;

  main.append(
    h('p', { class: 'eyebrow' }, h('a', { href: '#/', text: 'All topics' }), ` · topic ${index + 1} of ${TOPICS.length}`),
    h('h1', { text: topic.title }),
  );
  main.append(prose(topic.intro));
  main.append(h('p', { class: 'small muted' }, `${progress.solved} of ${progress.total} lessons done` +
    (progress.complete ? ' — topic finished.' : ` · ${remaining} to go`)));
  main.append(h('p', {}, h('a', {
    class: 'btn primary', href: lessonHref(next.id), style: 'display:inline-block',
    text: progress.solved === 0 ? `Start: ${next.title} →` : `Continue: ${next.title} →`,
  })));

  const list = h('ol', { class: 'lesson-list' });
  const nextId = nextUnsolvedLesson(isSolved)?.id ?? null;
  topic.lessons.forEach((lesson, position) => list.append(lessonRow(lesson, position + 1, nextId)));
  main.append(list);
}

// ------------------------------------------------------------------ lesson

function renderLesson(lesson) {
  const topic = topicOfLesson(lesson.id);
  const position = lessonPositionInTopic(lesson.id);
  const previous = previousLesson(lesson.id);
  const next = nextLesson(lesson.id);
  const isFile = (lesson.kind ?? 'tactic') === 'file';

  let input = store.drafts[lesson.id] ?? '';
  let checking = false;
  // Set when the *current* editor contents were the ones Lean accepted.
  let verified = false;

  main.append(
    h('p', { class: 'eyebrow' },
      h('a', { href: topicHref(topic.id), text: topic.title }),
      ` · lesson ${position.index + 1} of ${position.count} · `,
      h('code', { text: lesson.focus })),
    h('h1', { text: lesson.title }),
  );
  main.append(prose(lesson.intro));

  const feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const infoview = createInfoviewPanel({
    collapsed: store.infoviewCollapsed,
    label: isFile ? 'Output' : 'Goals and assumptions at the cursor',
    onToggle: (collapsed) => { store.infoviewCollapsed = collapsed; saveStore(); },
  });

  // Probes are debounced and token-checked: a stale answer must not paint over a
  // newer one, and typing must not queue a compile per keystroke.
  let probeToken = 0;
  let probeTimer = null;
  const scheduleProbe = ({ immediate = false } = {}) => {
    window.clearTimeout(probeTimer);
    const token = ++probeToken;
    const run = async () => {
      if (token !== probeToken) return;
      if (engine.state !== 'ready') return; // the engine subscription re-probes on ready
      infoview.update(null, { busy: true });
      const result = await goalProbe.goalsAt(lesson, input, editor.cursor().line);
      if (token !== probeToken) return;
      infoview.update(result, { busy: false });
    };
    if (immediate) run();
    else probeTimer = window.setTimeout(run, 320);
  };

  const editor = createEditor({
    value: input,
    placeholder: lesson.placeholder,
    rows: isFile ? 10 : 6,
    label: isFile ? 'Your Lean file' : 'Your tactic block',
    onCursor: () => scheduleProbe(),
    onInput: (value) => {
      input = value;
      if (value) store.drafts[lesson.id] = value;
      else delete store.drafts[lesson.id];
      saveStore();
      // Editing after a success means the verified answer is no longer on screen;
      // the solved lesson and its way onward stay marked.
      if (verified) { verified = false; clear(feedback); syncButtons(); }
      scheduleProbe();
    },
  });

  const checkButton = h('button', {
    class: 'btn primary', type: 'button', text: isFile ? 'Run file' : 'Check proof',
    onclick: () => runCheck(),
  });
  const clearButton = h('button', {
    class: 'btn ghost', type: 'button', text: 'Clear',
    onclick: () => {
      editor.setValue('');
      input = '';
      delete store.drafts[lesson.id];
      saveStore();
      verified = false;
      clear(feedback);
      syncButtons();
      editor.focus();
    },
  });
  // The path onward, in the thumb-reachable action row rather than only at the
  // bottom of the page. Hidden until the lesson is solved.
  const nextButton = h('button', {
    class: 'btn primary next-step', type: 'button',
    text: next ? `Next: ${next.focus} →` : 'Sandbox →',
    onclick: () => { location.hash = next ? lessonHref(next.id) : '#/sandbox'; },
  });
  nextButton.hidden = true;
  const actions = h('div', { class: 'actions' }, checkButton, clearButton, h('span', { class: 'spacer' }), nextButton);

  const card = h('div', { class: 'card', style: 'margin-top:14px' },
    h('p', { class: 'eyebrow', text: 'Your turn' }),
    h('p', {}, inlineProse(lesson.task)),
    isFile
      ? h('p', { class: 'small muted' }, inlineProse(
        'This one is a whole file: commands like `#check`, `#eval` and `def` are allowed, and the output appears below.'))
      : h('pre', { class: 'statement' }, h('span', { class: 'lbl', text: '⊢ ' }), lesson.statement),
    h('div', { class: 'workbench' },
      infoview.element,
      h('div', { class: 'workbench-main' }, editor.element, actions)));
  main.append(card);

  main.append(h('details', { class: 'hint', style: 'margin-top:12px' },
    h('summary', { text: 'Hint' }),
    h('div', { class: 'body' }, prose(lesson.hint))));

  main.append(h('details', { class: 'solution', style: 'margin-top:10px' },
    h('summary', { text: 'One solution' }),
    h('div', { class: 'body' },
      h('pre', { class: 'statement', text: lesson.solution }),
      h('button', {
        class: 'btn', type: 'button', text: 'Put it in the editor',
        onclick: () => {
          editor.setValue(lesson.solution);
          input = lesson.solution;
          store.drafts[lesson.id] = input;
          saveStore();
          editor.focus();
        },
      }))));

  main.append(feedback);

  const nextLink = h('a', {
    href: next ? lessonHref(next.id) : '#/sandbox',
    text: next ? `${next.title} →` : 'Sandbox →',
  });
  main.append(h('nav', { class: 'lesson-nav' },
    previous
      ? h('a', { href: lessonHref(previous.id), text: `← ${previous.title}` })
      : h('a', { href: topicHref(topic.id), text: `← ${topic.title}` }),
    nextLink));

  function syncButtons() {
    checkButton.disabled = checking || engine.state !== 'ready';
    checkButton.textContent = checking
      ? (isFile ? 'Running…' : 'Checking…')
      : verified ? '✓ Verified'
        : engine.state === 'ready' ? (isFile ? 'Run file' : 'Check proof') : 'Preparing Lean…';
    checkButton.classList.toggle('done', verified);
    nextButton.hidden = !verified && !isSolved(lesson.id);
    nextLink.classList.toggle('accent', isSolved(lesson.id) || verified);
  }

  function setChecking(value) {
    checking = value;
    syncButtons();
  }

  syncUi = () => setChecking(checking);
  setChecking(false);
  editor.focus();

  async function runCheck() {
    if (checking) return;
    if (engine.state !== 'ready') {
      clear(feedback);
      feedback.append(h('p', { class: 'banner info', text: engine.progress.message || 'Lean is still starting.' }));
      return;
    }
    setChecking(true);
    clear(feedback);
    feedback.append(h('p', { class: 'banner info', text: isFile ? 'Lean is running your file…' : 'Lean is checking your proof…' }));
    let result;
    try {
      result = await checkLesson(engine, lesson, input);
    } catch (error) {
      result = {
        ok: false, kind: 'runtime', headline: 'Something went wrong',
        detail: String(error?.message ?? error), messages: [], goals: [], output: [],
      };
    }
    setChecking(false);
    if (result.ok) {
      verified = true;
      store.solved[lesson.id] = true;
      saveStore();
    }
    renderFeedback(feedback, result, lesson);
    syncButtons();
  }

  main.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runCheck(); }
  });
}

function renderFeedback(container, result, lesson) {
  clear(container);
  const tone = result.ok ? 'ok' : result.kind === 'runtime' ? 'warn' : 'err';
  if (result.ok) {
    container.append(h('div', { class: 'result ok' },
      h('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }),
      h('span', {},
        h('strong', { class: 'result-title', text: result.headline }),
        h('span', { class: 'result-detail', text: result.elapsed
          ? `The Lean kernel checked it here · ${Math.round(result.elapsed)} ms`
          : 'The Lean kernel checked it here' }))));
  } else {
    container.append(h('div', { class: `banner ${tone}` },
      h('span', { text: '✕' }),
      h('span', {}, h('strong', { text: `${result.headline}. ` }), result.detail)));
  }

  if (result.output?.length) {
    container.append(h('p', { class: 'eyebrow', text: 'Output' }));
    container.append(h('pre', { class: 'goal', text: result.output.join('\n') }));
  }

  if (result.goals?.length) {
    container.append(h('p', { class: 'small muted', text: result.goals.length === 1
      ? 'One goal is still open — see the goals panel for its hypotheses.'
      : `${result.goals.length} goals are still open — see the goals panel.` }));
  }

  const messages = (result.messages ?? []).filter((message) => message.severity !== 'information' || message.message.trim());
  if (messages.length > 0) {
    container.append(h('p', { class: 'eyebrow', text: 'Messages' }));
    container.append(h('ul', { class: 'msg-list' }, messages.map((message) => h('li', { class: `msg ${message.severity}` },
      h('div', { class: 'msg-head' },
        h('span', { text: message.severity }),
        message.line ? h('span', { text: `your line ${message.line}` }) : null,
        message.caption ? h('span', { text: message.caption }) : null),
      h('pre', { class: 'msg-body', text: message.message })))));
  }

  if (!result.ok && lesson) {
    container.append(h('p', { class: 'small muted', text: 'Tip: press the Hint panel, or ⌘/Ctrl+Enter to check again.' }));
  }
  // Bring the verdict into view without yanking the page around if it is already
  // on screen (nearest does nothing when part of it is visible).
  container.scrollIntoView({
    block: 'nearest',
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

// ----------------------------------------------------------------- sandbox

function renderSandbox() {
  let code = store.sandbox || SANDBOX.starter;
  const output = h('div', { class: 'feedback' });

  const editor = createEditor({
    value: code,
    placeholder: SANDBOX.placeholder,
    rows: 12,
    label: 'Lean file',
    onInput: (value) => { code = value; store.sandbox = value; saveStore(); },
  });

  const runButton = h('button', { class: 'btn primary', type: 'button', text: 'Run', onclick: () => run() });

  main.append(
    h('p', { class: 'eyebrow' }, h('a', { href: '#/', text: 'All topics' }), ' · free play'),
    h('h1', { text: SANDBOX.title }),
    h('p', {}, inlineProse(SANDBOX.intro)),
    h('div', { class: 'card' }, editor.element, h('div', { class: 'actions' }, runButton)),
    output,
  );

  function setRunning(running) {
    runButton.disabled = running || engine.state !== 'ready';
    runButton.textContent = running ? 'Running…' : engine.state === 'ready' ? 'Run' : 'Preparing Lean…';
  }
  syncUi = () => setRunning(false);
  setRunning(false);

  async function run() {
    if (engine.state !== 'ready') {
      clear(output);
      output.append(h('p', { class: 'banner info', text: engine.progress.message || 'Lean is still starting.' }));
      return;
    }
    setRunning(true);
    clear(output);
    const result = await engine.compile(code);
    setRunning(false);
    const diagnostics = parseOutput(result.output);
    // The fork reports everything as JSON diagnostics, including `#eval` and
    // `#check` results — those are informational, so they read as output.
    const outputLines = diagnostics
      .filter((diagnostic) => diagnostic.severity === 'information')
      .map((diagnostic) => diagnostic.message);
    const problems = diagnostics.filter((diagnostic) => diagnostic.severity !== 'information');

    if (outputLines.length > 0) {
      output.append(h('p', { class: 'eyebrow', text: 'Output' }));
      output.append(h('pre', { class: 'goal', text: outputLines.join('\n') }));
    }
    if (problems.length > 0) {
      output.append(h('p', { class: 'eyebrow', text: 'Diagnostics' }));
      output.append(h('ul', { class: 'msg-list' }, problems.map((diagnostic) => h('li', { class: `msg ${diagnostic.severity}` },
        h('div', { class: 'msg-head' },
          h('span', { text: diagnostic.severity }),
          diagnostic.pos ? h('span', { text: `line ${diagnostic.pos.line}` }) : null,
          diagnostic.caption ? h('span', { text: diagnostic.caption }) : null),
        h('pre', { class: 'msg-body', text: diagnostic.message })))));
    }
    if (!result.success && problems.length === 0) {
      output.append(h('p', { class: 'banner err', text: result.error || 'Lean reported a failure with no message.' }));
    }
    if (outputLines.length === 0 && problems.length === 0 && result.success) {
      output.append(h('p', { class: 'banner ok', text: 'Elaborated without messages.' }));
    }
    if (result.elapsed) {
      output.append(h('p', { class: 'small muted', text: `${Math.round(result.elapsed)} ms` }));
    }
  }
}

route();

// Debug/automation hook: reachable from the console (and from tests), which is
// what to use when a proof behaves unexpectedly.
window.leanTutorials = {
  engine, checkLesson, store,
  content: { TOPICS, LESSONS, SANDBOX, lessonById, topicById, nextLesson, previousLesson, topicProgress },
};
