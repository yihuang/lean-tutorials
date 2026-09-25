// Turning lesson prose into nodes. Supports paragraphs, "- " lists, and inline
// `code`, **bold**, *italic*. Deliberately tiny — the content is ours, not
// learner input, but it still never touches innerHTML.

import { h } from './dom.js';

const INLINE = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

function inline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      const external = /^https?:/.test(href);
      nodes.push(h('a', { href, text: label, ...(external ? { rel: 'noopener', target: '_blank' } : {}) }));
    } else if (token.startsWith('`')) nodes.push(h('code', { text: token.slice(1, -1) }));
    else if (token.startsWith('**')) nodes.push(h('strong', { text: token.slice(2, -2) }));
    else nodes.push(h('em', { text: token.slice(1, -1) }));
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function prose(source) {
  const fragment = document.createDocumentFragment();
  const blocks = String(source).trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      fragment.append(h('ul', {}, lines.map((line) => h('li', {}, inline(line.replace(/^\s*[-*]\s+/, ''))))));
    } else {
      fragment.append(h('p', {}, inline(lines.join(' '))));
    }
  }
  return fragment;
}

/** Render text with the backtick spans as <code>, used for tasks/steps. */
export function inlineProse(text) {
  return h('span', {}, inline(String(text)));
}
