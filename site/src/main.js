// App shell: hash router, engine status UI, lesson pages, sandbox.

import { LeanEngine } from './lean/engine.js';
import { checkLesson } from './lean/tutorial.js';
import { parseOutput } from './lean/diagnostics.js';
import { LESSONS, lessonById, lessonIndex, SANDBOX_STARTER } from './lessons/index.js';
import { createEditor } from './ui/editor.js';
import { clear, h } from './ui/dom.js';
import { inlineProse, prose } from './ui/prose.js';

const STORAGE_KEY = 'lean-tutorials:v1';
const main = document.getElementById('main');
const chip = document.getElementById('engine-chip');
const chipDot = chip.querySelector('.dot');
const chipLabel = document.getElementById('engine-label');

const bootBar = h('div', { class: 'progress-track', id: 'boot-bar', hidden: 'until-found' }, h('i'));
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
    };
  } catch {
    return { solved: {}, drafts: {}, sandbox: '' };
  }
}

function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

const engine = new LeanEngine();
engine.start().catch(() => { /* surfaced through engine.state */ });

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
  const p = engine.progress;
  statusPanel.append(
    h('p', { class: 'eyebrow', text: 'Lean runtime' }),
    h('p', { text: p.message || STATE_TEXT[engine.state] }),
  );
  if (typeof SharedArrayBuffer === 'undefined') {
    statusPanel.append(h('p', { class: 'banner err', text:
      'This page is not cross-origin isolated, so the Lean runtime cannot use shared memory. ' +
      'That happens when the site is opened from a file:// URL or a host that does not send the COOP/COEP headers.' }));
  }
  if (engine.state === 'error') {
    statusPanel.append(h('p', { class: 'banner err', text: engine.error?.message ?? 'Unknown error.' }));
  }
  if (p.detail) statusPanel.append(h('p', { class: 'small muted', text: p.detail }));
  statusPanel.append(h('p', { class: 'small muted', text:
    'First visit downloads the runtime (~47 MB compressed) and the Lean core library; both are cached, ' +
    'so a reload and every later proof check are fast. Nothing you type leaves the device.' }));
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
  statusPanel.style.display = 'none';
  syncUi = () => {};
  if (section === 'lesson' && lessonById(param)) renderLesson(lessonById(param));
  else if (section === 'sandbox') renderSandbox();
  else renderHome();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', route);

// -------------------------------------------------------------------- home

function lessonHref(id) { return `#/lesson/${id}`; }

function renderHome() {
  const solved = LESSONS.filter((lesson) => store.solved[lesson.id]).length;

  main.append(
    h('h1', { text: 'Proofs, checked on your own device' }),
    h('p', {}, inlineProse(
      'These are short Lean 4 tutorials. The real Lean compiler runs locally in WebAssembly — ' +
      'your browser checks every proof, nothing is sent to a server, and it works on a phone.')),
    h('p', { class: 'small muted', text:
      `${solved} of ${LESSONS.length} lessons done. ` +
      `${engine.state === 'ready' ? 'Lean is ready — checks are instant.' : 'Lean is still warming up in the background.'}` }),
  );

  const list = h('ol', { class: 'lesson-list' });
  LESSONS.forEach((lesson, index) => {
    list.append(h('li', {
      class: 'lesson-item',
      dataset: { solved: store.solved[lesson.id] ? 'true' : 'false' },
    }, h('a', { href: lessonHref(lesson.id) },
      h('span', { class: 'lesson-num', text: String(index + 1) }),
      h('span', { class: 'lesson-meta' },
        h('span', { class: 'lesson-title', text: lesson.title }),
        h('span', { class: 'lesson-sub' }, h('code', { text: lesson.focus }), ` — ${lesson.summary}`)),
      h('span', { class: 'lesson-tick', text: store.solved[lesson.id] ? '✓' : '' }),
    )));
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
        'The runtime and the packed Lean core library come from [lean.cau.li](https://lean.cau.li) ' +
        '([source](https://github.com/cauli/lean4-wasm-in-browser), Apache-2.0), served from this site so the ' +
        'worker stays same-origin.')),
      h('p', { class: 'small muted' }, inlineProse(
        'Requirements: a browser with WebAssembly threads (SharedArrayBuffer), i.e. a cross-origin isolated page. ' +
        'On iOS the runtime needs a recent Safari; on low-memory devices it may take a couple of attempts.')))));

  main.append(statusPanel);
}

// ------------------------------------------------------------------ lesson

function renderLesson(lesson) {
  const index = lessonIndex(lesson.id);
  const previous = LESSONS[index - 1];
  const next = LESSONS[index + 1];
  let tactics = store.drafts[lesson.id] ?? lesson.starter;
  let checking = false;

  main.append(
    h('p', { class: 'eyebrow' }, `Lesson ${index + 1} of ${LESSONS.length} · `, h('code', { text: lesson.focus })),
    h('h1', { text: lesson.title }),
  );
  main.append(prose(lesson.intro));

  const feedback = h('div', { class: 'feedback' });
  const editor = createEditor({
    value: tactics,
    label: 'Your tactic block',
    onInput: (value) => { tactics = value; store.drafts[lesson.id] = value; saveStore(); },
  });

  const checkButton = h('button', { class: 'btn primary', type: 'button', text: 'Check proof', onclick: () => runCheck() });
  const actions = h('div', { class: 'actions' }, checkButton);
  actions.append(
    h('button', {
      class: 'btn ghost', type: 'button', text: 'Reset',
      onclick: () => { editor.setValue(lesson.starter); tactics = lesson.starter; store.drafts[lesson.id] = tactics; saveStore(); clear(feedback); },
    }),
  );

  const usedSolution = () => {
    editor.setValue(lesson.solution);
    tactics = lesson.solution;
    store.drafts[lesson.id] = tactics;
    saveStore();
    editor.focus();
  };

  main.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('p', { class: 'eyebrow', text: 'Your turn' }),
    h('p', {}, inlineProse(lesson.task)),
    h('pre', { class: 'statement' }, h('span', { class: 'lbl', text: '⊢ ' }), lesson.statement),
    editor.element,
    actions));

  main.append(h('details', { class: 'hint', style: 'margin-top:12px' },
    h('summary', { text: 'Hint' }),
    h('div', { class: 'body' }, prose(lesson.hint))));

  main.append(h('details', { class: 'solution', style: 'margin-top:10px' },
    h('summary', { text: 'One solution' }),
    h('div', { class: 'body' },
      h('pre', { class: 'statement', text: lesson.solution }),
      h('button', { class: 'btn', type: 'button', text: 'Put it in the editor', onclick: usedSolution }))));

  main.append(feedback);

  main.append(h('nav', { class: 'lesson-nav' },
    previous
      ? h('a', { href: lessonHref(previous.id), text: `← ${previous.title}` })
      : h('a', { href: '#/', text: '← All lessons' }),
    next
      ? h('a', { href: lessonHref(next.id), text: `${next.title} →` })
      : h('a', { href: '#/sandbox', text: 'Sandbox →' })));

  function setChecking(value) {
    checking = value;
    checkButton.disabled = value || engine.state !== 'ready';
    checkButton.textContent = value
      ? 'Checking…'
      : engine.state === 'ready' ? 'Check proof' : 'Preparing Lean…';
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
    feedback.append(h('p', { class: 'banner info', text: 'Lean is checking your proof…' }));
    let result;
    try {
      result = await checkLesson(engine, lesson, tactics);
    } catch (error) {
      result = { ok: false, kind: 'runtime', headline: 'Something went wrong', detail: String(error?.message ?? error), messages: [], goals: [] };
    }
    setChecking(false);
    renderFeedback(feedback, result, lesson);
    if (result.ok) {
      store.solved[lesson.id] = true;
      saveStore();
    }
  }

  main.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runCheck(); }
  });
}

function renderFeedback(container, result, lesson) {
  clear(container);
  const tone = result.ok ? 'ok' : result.kind === 'runtime' ? 'warn' : 'err';
  container.append(h('div', { class: `banner ${tone}` },
    h('span', { text: result.ok ? '✓' : '✕' }),
    h('span', {}, h('strong', { text: `${result.headline}. ` }), result.detail)));

  if (result.goals?.length) {
    container.append(h('p', { class: 'eyebrow', text: result.goals.length === 1 ? 'Open goal' : 'Open goals' }));
    container.append(h('div', { class: 'goals' }, result.goals.map((goal) => h('pre', { class: 'goal', text: goal }))));
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

  if (result.ok && result.elapsed) {
    container.append(h('p', { class: 'small muted', text: `Verified in ${Math.round(result.elapsed)} ms (second pass included).` }));
    container.append(h('p', { class: 'small muted' }, inlineProse(
      'Next lesson, or open the [sandbox](#/sandbox) and try your own statements.')));
  }
  if (!result.ok && lesson) {
    container.append(h('p', { class: 'small muted', text: 'Tip: press the Hint panel, or ⌘/Ctrl+Enter to check again.' }));
  }
}

// ----------------------------------------------------------------- sandbox

function renderSandbox() {
  let code = store.sandbox || SANDBOX_STARTER;
  const output = h('div', { class: 'feedback' });

  const editor = createEditor({
    value: code,
    label: 'Lean file',
    onInput: (value) => { code = value; store.sandbox = value; saveStore(); },
  });

  const runButton = h('button', { class: 'btn primary', type: 'button', text: 'Run', onclick: () => run() });

  main.append(
    h('p', { class: 'eyebrow', text: 'Sandbox' }),
    h('h1', { text: 'A blank Lean file' }),
    h('p', {}, inlineProse(
      'Everything is elaborated against Lean’s Init environment: definitions, `#check`, `#eval`, theorems. ' +
      'Imports are unavailable — there is no Mathlib in the browser build.')),
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
window.leanTutorials = { engine, checkLesson, LESSONS, store };
