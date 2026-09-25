// Lean's own unicode abbreviations, so a phone keyboard can still write maths.
//
// Typing `\forall` + a delimiter becomes `∀`, exactly like the VS Code Lean
// extension. Only the common set is listed; `\`-prefixed names are matched
// longest-first and only at a word boundary.

export const ABBREVIATIONS = {
  '\\forall': '\u2200', '\\exists': '\u2203', '\\not': '\u00ac', '\\and': '\u2227',
  '\\or': '\u2228', '\\to': '\u2192', '\\r': '\u2192', '\\imp': '\u2192', '\\iff': '\u2194',
  '\\le': '\u2264', '\\ge': '\u2265', '\\ne': '\u2260', '\\lt': '<', '\\gt': '>',
  '\\in': '\u2208', '\\notin': '\u2209', '\\sub': '\u2286', '\\subseteq': '\u2286',
  '\\subset': '\u2282', '\\ssubset': '\u2282', '\\inter': '\u2229',
  '\\empty': '\u2205', '\\union': '\u222a', '\\N': '\u2115', '\\Z': '\u2124',
  '\\Q': '\u211a', '\\R': '\u211d', '\\C': '\u2102', '\\nat': '\u2115',
  '\\times': '\u00d7', '\\cdot': '\u22c5', '\\sum': '\u2211', '\\prod': '\u220f',
  '\\int': '\u222b', '\\inf': '\u221e', '\\partial': '\u2202', '\\alpha': '\u03b1',
  '\\beta': '\u03b2', '\\gamma': '\u03b3', '\\delta': '\u03b4', '\\epsilon': '\u03b5',
  '\\lambda': '\u03bb', '\\fun': '\u03bb', '\\mu': '\u03bc', '\\pi': '\u03c0',
  '\\sigma': '\u03c3', '\\phi': '\u03c6', '\\psi': '\u03c8', '\\omega': '\u03c9',
  '\\Gamma': '\u0393', '\\Delta': '\u0394', '\\Sigma': '\u03a3', '\\Omega': '\u03a9',
  '\\<': '\u27e8', '\\>': '\u27e9', '\\langle': '\u27e8', '\\rangle': '\u27e9',
  '\\mapsto': '\u21a6', '\\deg': '\u00b0', '\\sq': '\u00b2', '\\hbar': '\u210f',
  '\\tensor': '\u2297', '\\oplus': '\u2295', '\\equiv': '\u2261', '\\defeq': '\u2261',
  '\\comp': '\u2218', '\\circ': '\u2218', '\\bullet': '\u2022', '\\dots': '\u2026',
  '\\neg': '\u00ac', '\\forall': '\u2200', '\\leq': '\u2264', '\\geq': '\u2265',
};

const NAMES = Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length);

/** Symbols the on-screen bar offers, in tap order. */
export const SYMBOL_BAR = [
  '\u2200', '\u2192', '\u2194', '\u2227', '\u2228', '\u00ac', '\u2260', '\u2264', '\u2265',
  '\u2115', '\u2203', '\u27e8', '\u27e9', '\u21a6', '\u03bb', '\u2208', '\u2286', '\u222a',
];

/**
 * Expand a `\name` abbreviation immediately before the caret.
 *
 * @param {HTMLTextAreaElement} textarea
 * @returns {boolean} whether the text changed
 */
export function expandAbbreviation(textarea) {
  const { value, selectionStart, selectionEnd } = textarea;
  if (selectionStart !== selectionEnd) return false;
  const before = value.slice(0, selectionStart);
  const match = /\\([A-Za-z]+|<|>)$/.exec(before);
  if (!match) return false;
  const symbol = ABBREVIATIONS[`\\${match[1]}`];
  if (!symbol) return false;
  const start = selectionStart - match[0].length;
  textarea.value = `${value.slice(0, start)}${symbol}${value.slice(selectionEnd)}`;
  const caret = start + symbol.length;
  textarea.setSelectionRange(caret, caret);
  return true;
}

/** Longest-prefix completion used by Tab: `\for` → `\forall`. */
export function suggestAbbreviation(text) {
  const match = /\\([A-Za-z]*)$/.exec(text);
  if (!match) return null;
  const prefix = `\\${match[1]}`;
  if (prefix.length < 3) return null;
  const candidate = NAMES.find((name) => name !== prefix && name.startsWith(prefix));
  return candidate ?? null;
}
