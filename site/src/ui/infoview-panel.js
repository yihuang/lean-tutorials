// The infoview: hypotheses and goals for the cursor position, in the shape Lean
// itself prints them. This is the presentation half of the pair — site/src/lean/
// infoview.js decides *what* the goals are, this module only renders a ProbeResult
// (and knows nothing about how it was produced).

import { clear, h } from './dom.js';

const TURNSTILE = '\u22a2'; // ⊢

/**
 * Split one goal state into its parts:
 *   case left
 *   p q : Prop
 *   hp : p
 *   ⊢ p
 */
export function parseGoal(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  let name = null;
  if (lines.length > 1 && /^case\s/.test(lines[0].trim())) name = lines.shift().trim().slice(5).trim();
  const turnstile = lines.findIndex((line) => line.includes(TURNSTILE));
  const hypotheses = (turnstile === -1 ? lines : lines.slice(0, turnstile)).map((line) => line.trim()).filter(Boolean);
  const target = turnstile === -1
    ? null
    : lines.slice(turnstile).join('\n').split(TURNSTILE).join(TURNSTILE).trim();
  return { name, hypotheses, target };
}

function goalNode(text, index, total) {
  const { name, hypotheses, target } = parseGoal(text);
  return h('div', { class: 'goal-card' },
    total > 1 || name
      ? h('div', { class: 'goal-head' },
        h('span', { class: 'goal-name', text: name ?? `goal ${index + 1}` }),
        h('span', { class: 'goal-index', text: total > 1 ? `${index + 1}/${total}` : '' }))
      : null,
    hypotheses.length > 0
      ? h('div', { class: 'goal-hyps' }, hypotheses.map((line) => h('span', { class: 'hyp', text: line })))
      : h('div', { class: 'goal-hyps empty', text: 'no assumptions' }),
    target ? h('div', { class: 'goal-target' }, h('span', { class: 'turnstile', text: TURNSTILE }), h('span', { text: ` ${target.replace(TURNSTILE, '').trim()}` })) : null);
}

/**
 * @param {{ collapsed?: boolean, onToggle?: (collapsed: boolean) => void, label?: string }} [options]
 */
export function createInfoviewPanel(options = {}) {
  let collapsed = Boolean(options.collapsed);
  let lastResult = null;

  const title = h('span', { class: 'infoview-title', text: 'Goals' });
  const badge = h('span', { class: 'infoview-badge', text: '' });
  const spinner = h('span', { class: 'infoview-spinner', text: '', 'aria-hidden': 'true' });
  const toggle = h('button', {
    class: 'infoview-toggle', type: 'button',
    'aria-label': 'Collapse or expand the goals panel',
    text: '▾',
  });
  const body = h('div', { class: 'infoview-body' });

  const header = h('div', { class: 'infoview-head' },
    h('span', { class: 'infoview-state' }, h('span', { class: 'dot', dataset: { state: 'idle' } }), title, badge),
    spinner,
    toggle);

  const element = h('section', {
    class: 'infoview',
    role: 'region',
    'aria-label': options.label ?? 'Goals and assumptions at the cursor',
  }, header, body);

  function render() {
    element.dataset.collapsed = collapsed ? 'true' : 'false';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    element.dataset.state = lastResult?.status ?? 'idle';
  }

  function paint() {
    clear(body);
    const result = lastResult;
    if (!result) {
      header.querySelector('.dot').dataset.state = 'idle';
      badge.textContent = '';
      body.append(h('p', { class: 'infoview-note', text: 'Move the cursor into your proof to see the goals there.' }));
      return;
    }

    const state = result.status;
    header.querySelector('.dot').dataset.state = state;
    if (state === 'goals') {
      title.textContent = result.line === null ? 'Goals' : `Goals at line ${result.line + 1}`;
      badge.textContent = `${result.goals.length} open`;
    } else if (state === 'complete') {
      title.textContent = 'No goals';
      badge.textContent = 'complete';
    } else if (state === 'stale') {
      return; // superseded: leave the previous paint alone
    } else {
      title.textContent = 'Goals';
      badge.textContent = '';
    }

    if (state === 'goals') {
      body.append(h('div', { class: 'goal-list' }, result.goals.map((goal, index) => goalNode(goal, index, result.goals.length))));
      if (result.line !== null && result.requestedLine !== -1 && result.line < result.requestedLine) {
        body.append(h('p', { class: 'infoview-note', text:
          `Showing the last complete step (line ${result.line + 1}); line ${result.requestedLine + 1} does not elaborate on its own yet.` }));
      }
      return;
    }
    if (state === 'complete') {
      body.append(h('p', { class: 'infoview-done' },
        h('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }),
        h('span', { text: 'Every goal is closed at this point.' })));
      return;
    }
    body.append(h('p', { class: 'infoview-note', text: result.message ?? 'No goal information here.' }));
  }

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    options.onToggle?.(collapsed);
    render();
  });

  render();
  paint();

  return {
    element,
    get collapsed() { return collapsed; },
    setCollapsed(value) {
      collapsed = Boolean(value);
      render();
    },
    /** @param {import('../lean/infoview.js').ProbeResult | null} result */
    update(result, { busy = false } = {}) {
      if (result && result.status !== 'stale') lastResult = result;
      spinner.textContent = busy ? '…' : '';
      element.dataset.busy = busy ? 'true' : 'false';
      paint();
      render();
    },
  };
}
