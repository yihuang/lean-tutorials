// Planned themes: placeholders that show the shape of the course without
// pretending the material exists. `planned` entries are topics-to-be: id, title,
// summary. They are data for later, and they render as a compact roadmap line —
// never as links, never as progress.
export const programVerification = {
  id: 'program-verification',
  status: 'planned',
  title: 'Program verification',
  summary: 'Specifications, invariants and refinement for real code',
  intro: `
Proving things *about programs* rather than about arithmetic: write down what a
function must do, then show the implementation does exactly that — including
termination and the parts a test suite would only sample.
`,
  topics: [],
  planned: [
    { id: 'specifications', title: 'Specifications', summary: 'Pre- and postconditions as types you can prove things about' },
    { id: 'loop-invariants', title: 'Loop invariants', summary: 'The property that holds before, during and after every iteration' },
    { id: 'termination', title: 'Termination', summary: 'Proving a recursion actually stops, and why Lean requires it' },
    { id: 'refinement', title: 'Executable specs', summary: 'Keeping a fast implementation provably equal to a clear one' },
  ],
};

export const functionalProgramming = {
  id: 'functional-programming',
  status: 'planned',
  title: 'Functional programming',
  summary: 'Datatypes, recursion, folds and the type class machinery',
  intro: `
Lean is also a general-purpose functional language. This theme is about writing
programs in it — and about the fact that the same definitions are what your proofs
reason about.
`,
  topics: [],
  planned: [
    { id: 'datatypes', title: 'Datatypes and pattern matching', summary: 'Defining your own inductive types and teaching Lean to compute with them' },
    { id: 'folds', title: 'Recursion and folds', summary: 'Structural recursion, accumulators, and the fold that generalises them' },
    { id: 'traits', title: 'Type classes', summary: 'Ad-hoc polymorphism: instances, resolution, and how `+` is looked up' },
    { id: 'monads', title: 'Monads and `do`', summary: 'Sequencing computations, and what `IO` is really made of' },
  ],
};

export const dataStructures = {
  id: 'data-structures',
  status: 'planned',
  title: 'Data structures and algorithms',
  summary: 'Containers, their invariants, and proofs that algorithms sort',
  intro: `
Where the interesting work usually starts: invariants that are not just about
numbers, operations that must preserve them, and algorithm correctness stated
precisely enough to be checked.
`,
  topics: [],
  planned: [
    { id: 'lists-vectors', title: 'Lists and vectors', summary: 'From `List` to length-indexed `Vector`, and what the index buys you' },
    { id: 'trees', title: 'Trees and balancing', summary: 'Invariants on shapes, insertion, and why balance is a theorem' },
    { id: 'sorting', title: 'Sorting and correctness', summary: 'Sortedness and permutation as specifications a sort must satisfy' },
  ],
};

export const maths = {
  id: 'maths',
  status: 'planned',
  title: 'Doing maths in Lean',
  summary: 'Sets, structures and the Mathlib library at scale',
  intro: `
The path from core Lean to the mathematical library: the vocabulary of sets and
orders, the algebraic hierarchy, and how to find your way around thousands of
definitions you did not write.
`,
  topics: [],
  planned: [
    { id: 'sets-orders', title: 'Sets, functions, orders', summary: 'The basic language, and how it differs from informal notation' },
    { id: 'algebraic-structures', title: 'Algebraic structures', summary: 'Groups, rings, fields as type classes and how proofs are shared' },
    { id: 'mathlib-search', title: 'Navigating Mathlib', summary: '`exact?`, `apply?`, naming conventions, and reading the docs' },
  ],
};

export const metaprogramming = {
  id: 'metaprogramming',
  status: 'planned',
  title: 'Tactics and metaprogramming',
  summary: 'Lean programs that write proofs',
  intro: `
The last layer: Lean is written in Lean, so you can inspect goals, build terms and
write your own tactics — the same machinery \`simp\` and \`omega\` are built on.
`,
  topics: [],
  planned: [
    { id: 'elaboration', title: 'Elaboration and the info tree', summary: 'What Lean knows at each position, and how tactics see it' },
    { id: 'custom-tactics', title: 'Writing a tactic', summary: 'From `elab` to a reusable automation step' },
    { id: 'simproc', title: 'Simplifier extensions', summary: 'Teaching `simp` a new rule that fires automatically' },
  ],
};
