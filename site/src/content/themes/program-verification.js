// Theme: proving things *about programs* — the roadmap entry that became real.
// A theme is a grouping of topics; the topics own the lessons (see ../index.js
// for the contract), and one module holds one theme.
export const programVerification = {
  id: 'program-verification',
  status: 'available',
  title: 'Program verification',
  summary: 'Specifications, invariants, termination and refinement for real code',
  intro: `
Everything before this theme is proving things in Lean. This theme is proving
things *about programs*: writing down what an implementation must do, and then
showing that it does — including the parts a test suite would only sample.

The spine is the one every verification project follows: a **specification**
(what must be true, and what the caller owes you), an **invariant** (what
survives each step of a loop), a **termination** proof (why the recursion stops),
and a **refinement** (why the fast implementation is the clear one).
`,
  // Topic ids this theme owns, in reading order.
  topics: [
    'specifications',
    'loop-invariants',
    'termination',
    'refinement',
  ],
};
