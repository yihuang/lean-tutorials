// A deliberately plain code editor: a textarea plus the affordances a phone
// needs (symbol bar, no autocapitalise/autocorrect) and the two habits a
// desktop user expects (Tab indents, Enter keeps indentation).

import { h } from './dom.js';
import { expandAbbreviation, suggestAbbreviation, SYMBOL_BAR } from '../lean/unicode.js';

/**
 * @param {{value?: string, placeholder?: string, rows?: number, onInput?: (value: string) => void,
 *          onCursor?: (cursor: { line: number, column: number }) => void, label?: string}} options
 */
export function createEditor(options = {}) {
  const textarea = h('textarea', {
    class: 'editor',
    value: options.value ?? '',
    placeholder: options.placeholder ?? '',
    rows: options.rows ?? 6,
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    'aria-label': options.label ?? 'Lean tactics',
  });

  const emit = () => options.onInput?.(textarea.value);

  const caretLine = (value, offset) => {
    let line = 0;
    for (let index = 0; index < offset && index < value.length; index += 1) {
      if (value[index] === '\n') line += 1;
    }
    return line;
  };

  const cursor = () => ({
    line: caretLine(textarea.value, textarea.selectionStart),
    column: textarea.selectionStart - (textarea.value.lastIndexOf('\n', textarea.selectionStart - 1) + 1),
  });

  // The caret moves by typing, arrow keys, tapping, and selection changes — the
  // last one only arrives as a document event, and only for the focused field.
  const reportCursor = () => options.onCursor?.(cursor());
  const onSelectionChange = () => {
    if (document.activeElement === textarea) reportCursor();
  };
  document.addEventListener('selectionchange', onSelectionChange);
  for (const event of ['keyup', 'click', 'focus', 'select', 'mouseup', 'touchend']) {
    textarea.addEventListener(event, reportCursor);
  }

  const insert = (text) => {
    const { selectionStart, selectionEnd, value } = textarea;
    textarea.value = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
    const caret = selectionStart + text.length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
    emit();
  };

  const symbols = h('div', { class: 'symbols', role: 'group', 'aria-label': 'Insert a symbol' },
    SYMBOL_BAR.map((symbol) => h('button', {
      type: 'button',
      text: symbol,
      title: `Insert ${symbol}`,
      onclick: () => insert(` ${symbol} `),
    })));

  textarea.addEventListener('input', () => {
    expandAbbreviation(textarea);
    emit();
    reportCursor();
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const completion = suggestAbbreviation(textarea.value.slice(0, textarea.selectionStart));
      if (completion) return insert(completion);
      return insert('  ');
    }
    if (event.key === 'Enter') {
      const start = textarea.value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
      const indent = /^[ \t]*/.exec(textarea.value.slice(start, textarea.selectionStart))[0];
      // Keep the indentation of the current line, and add a level after `=>`.
      const before = textarea.value.slice(start, textarea.selectionStart);
      const extra = /(=>|\bwith)$/.test(before.trim()) ? '  ' : '';
      if (indent || extra) {
        event.preventDefault();
        insert(`\n${indent}${extra}`);
      }
      return;
    }
    if (event.key === ' ') {
      // Let the input event handle it, then expand `\forall ` style tokens.
      requestAnimationFrame(() => { if (expandAbbreviation(textarea)) emit(); });
    }
  });

  const element = h('div', { class: 'editor-wrap' }, symbols, textarea);

  return {
    element,
    focus: () => textarea.focus(),
    cursor,
    get value() { return textarea.value; },
    set value(next) { textarea.value = String(next ?? ''); emit(); },
    setValue(next, { silent = true } = {}) { textarea.value = String(next ?? ''); if (!silent) emit(); },
  };
}
