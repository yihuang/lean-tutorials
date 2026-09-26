// Theme: the material that exists today. A theme is a *grouping* of topics;
// topics own the lessons. Themes are declared as data (see ../index.js for the
// contract) and one module holds one theme.
export const proofBasics = {
  id: 'proof-basics',
  status: 'available',
  title: 'Proof basics',
  summary: 'How Lean proofs work, from `rfl` to automation',
  intro: `
Every topic here is about the same question: *what is a proof, and how do I build
one?* You start by discovering that a proof is a value, meet the connectives and
quantifiers as ordinary data, learn to reason about the natural numbers, and end
up with the rewriting and automation tools that carry the rest of Lean.

This is the theme to finish first. Everything else builds on it.
`,
  // Topic ids this theme owns, in reading order.
  topics: [
    'foundations',
    'logic',
    'quantifiers',
    'numbers',
    'rewriting',
    'automation',
    'advanced-tactics',
    'tools',
  ],
};
