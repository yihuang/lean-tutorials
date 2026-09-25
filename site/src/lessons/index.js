// Lesson content. Everything here must elaborate against Lean's Init
// environment only — the browser runtime ships the core library, not Mathlib.
//
// `statement` is owned by the lesson and typed by the learner's tactic block,
// so `starter`/`hint`/`solution` are just tactics (see lean/source.js).

/** @typedef {Object} Lesson
 * @property {string} id
 * @property {string} title
 * @property {string} focus short tactic chip shown in lists
 * @property {string} summary
 * @property {string} intro prose for the lesson page
 * @property {string} task what to do, one or two sentences
 * @property {string} statement Lean declaration ending in `:= by`
 * @property {string} [context] extra Lean preamble the lesson needs
 * @property {string} starter initial editor content
 * @property {string} hint
 * @property {string} solution
 */

/** @type {Lesson[]} */
export const LESSONS = [
  {
    id: 'rfl',
    title: 'A proof is a value',
    focus: 'rfl',
    summary: 'Prove a goal that is true by computation',
    intro: `
In Lean a proof is a term, exactly like a number or a function: to prove
\`1 + 1 = 2\` you write down something whose *type* is \`1 + 1 = 2\`.

The tactic \`rfl\` says: **both sides of the goal are the same after
computation**. Lean evaluates \`1 + 1\` down to \`2\` and accepts.

Notice what is missing: there is no "trust me". The kernel re-checks the term
\`rfl\` produces, on your machine, in your browser.
`,
    task: 'Close the goal with a single tactic.',
    statement: 'example : 1 + 1 = 2',
    starter: '-- replace this comment with a tactic',
    hint: 'The tactic is called `rfl` (short for *reflexivity*). Type it and press **Check**.',
    solution: 'rfl',
  },
  {
    id: 'exact',
    title: 'Use what you already have',
    focus: 'exact',
    summary: 'Hand a hypothesis to the goal',
    intro: `
Every goal comes with a context: the things you already know. In the panel
below the editor, everything above the turnstile \`⊢\` is available, and
everything to its right is what you must produce.

Here \`hp\` *is* a proof of \`p\`, so the goal is already solved — you just have
to pass it along.
`,
    task: 'Use the hypothesis `hp` to close the goal.',
    statement: 'example (p : Prop) (hp : p) : p',
    starter: '-- hp is a proof of p. Give it to the goal.',
    hint: '`exact hp` — `exact` wants a term whose type is exactly the goal.',
    solution: 'exact hp',
  },
  {
    id: 'intro',
    title: 'Implications are functions',
    focus: 'intro',
    summary: 'Assume the left side of an arrow',
    intro: `
\`p → q\` is not a statement about truth tables: it is the **function type**
from proofs of \`p\` to proofs of \`q\`. To prove one you take an arbitrary
proof of the left side and build a proof of the right side.

\`intro\` does exactly that, moving the assumption into your context.

The goal here is \`p → q → p\`, which is the type of the function that throws
away its second argument.
`,
    task: 'Introduce both assumptions, then produce `p`.',
    statement: 'example {p q : Prop} : p → q → p',
    starter: '-- intro the assumptions, then use the one you need',
    hint: '`intro hp hq` puts both assumptions in the context; `exact hp` finishes.',
    solution: 'intro hp hq\nexact hp',
  },
  {
    id: 'apply',
    title: 'Reason backwards',
    focus: 'apply',
    summary: 'Match a hypothesis conclusion against the goal',
    intro: `
Forward reasoning chains facts together. Lean proofs are usually written the
other way round: look at the goal, find a lemma whose *conclusion* matches it,
and turn the goal into that lemma's assumptions.

You have \`h : p → q\` and the goal is \`q\`. \`apply h\` matches the conclusion
of \`h\` with the goal and leaves you with \`p\` to prove.
`,
    task: 'Prove `q` using `h`.',
    statement: 'example {p q : Prop} (hp : p) (h : p → q) : q',
    starter: '-- apply a hypothesis, then discharge what is left',
    hint: '`apply h` changes the goal to `p`, and `hp` proves it.',
    solution: 'apply h\nexact hp',
  },
  {
    id: 'and',
    title: 'Both at once',
    focus: 'constructor',
    summary: 'Build a conjunction field by field',
    intro: `
\`p ∧ q\` is the structure \`And p q\` with one field for each side. So proving
it means proving both sides.

\`constructor\` splits a structure goal into one goal per field. The anonymous
constructor notation \`⟨hp, hq⟩\` builds the structure directly — type
\`\\langle\` or use the symbol bar above the editor.
`,
    task: 'Prove `p ∧ q` in one line.',
    statement: 'example {p q : Prop} (hp : p) (hq : q) : p ∧ q',
    starter: '-- combine the two proofs',
    hint: 'Either `constructor` then two `exact`s, or one line: `exact ⟨hp, hq⟩`.',
    solution: 'exact ⟨hp, hq⟩',
  },
  {
    id: 'or',
    title: 'Either way',
    focus: 'rcases',
    summary: 'Split a disjunction into its two cases',
    intro: `
A proof of \`p ∨ q\` tells you *one* of the two holds, but not which one — so
anything you prove from it must work in both cases.

\`rcases h with hp | hq\` replaces \`h\` with two goals: one where \`hp : p\`,
one where \`hq : q\`. Each case is finished with the matching constructor,
\`Or.inl\` or \`Or.inr\`.

Bullets (\`·\`) keep the cases tidy; the starter shows the shape.
`,
    task: 'Prove `q ∨ p`.',
    statement: 'example {p q : Prop} (h : p ∨ q) : q ∨ p',
    starter: '-- split the disjunction first, then prove q ∨ p in both cases',
    hint: 'From `hp : p` you can prove `q ∨ p`' + ' with `Or.inr hp`; from `hq : q` use `Or.inl hq`.',
    solution: 'rcases h with hp | hq\n· exact Or.inr hp\n· exact Or.inl hq',
  },
  {
    id: 'rw',
    title: 'Rewrite with an equation',
    focus: 'rw',
    summary: 'Replace equals by equals inside the goal',
    intro: `
\`rw\` takes a list of equations and rewrites the goal with them, left to right.
After rewriting it tries to close the goal by \`rfl\`, which is why a single
\`rw [h]\` often finishes the job.

Rewriting is the bread and butter of Lean proofs: it is how you move from the
statement you have to the statement you want.
`,
    task: 'Turn `a` into `b` in the goal.',
    statement: 'example (a b : Nat) (h : a = b) : a + 1 = b + 1',
    starter: '-- use h to rewrite the goal',
    hint: '`rw [h]` rewrites every `a` into `b`, giving `b + 1 = b + 1`.',
    solution: 'rw [h]',
  },
  {
    id: 'simp',
    title: 'Let the simplifier work',
    focus: 'simp',
    summary: 'Normalise a goal with @[simp] lemmas',
    intro: `
\`simp\` normalises the goal using a curated library of lemmas tagged
\`@[simp]\` — facts like \`n + 0 = n\` that are obviously true but tedious to
apply by hand.

It is still fully kernel-checked: \`simp\` *finds* a proof term, the kernel
still verifies it. That is the difference between \`simp\` and
\`native_decide\`, which trusts compiled code.
`,
    task: 'Close the goal without naming any lemma.',
    statement: 'example (n : Nat) : n + 0 = n',
    starter: '-- one tactic is enough',
    hint: 'Plain `simp` knows `Nat.add_zero`.',
    solution: 'simp',
  },
  {
    id: 'induction',
    title: 'Induction on the naturals',
    focus: 'induction',
    summary: 'Prove a statement for 0 and for succ',
    intro: `
\`Nat\` is built from \`Nat.zero\` and \`Nat.succ\`. Induction is therefore two
goals: the base case \`0\`, and the step case where you may assume the statement
for \`k\` (the induction hypothesis \`ih\`) while proving it for \`k + 1\`.

\`induction n with\` opens those two goals and gives you \`ih\` for free. The
indentation of the \`| zero => …\` branches matters — the starter is already
shaped correctly.
`,
    task: 'Prove `0 + n = n` by induction on `n`.',
    statement: 'example (n : Nat) : 0 + n = n',
    starter: '-- start with `induction n with`, then fill in both branches',
    hint: 'Base case: `rfl`. Step case: `rw [Nat.add_succ, ih]` — unfold `+` on `succ` and use `ih`.',
    solution: 'induction n with\n| zero => rfl\n| succ k ih => rw [Nat.add_succ, ih]',
  },
  {
    id: 'omega',
    title: 'Automation for arithmetic',
    focus: 'omega',
    summary: 'Decide linear arithmetic in one tactic',
    intro: `
\`omega\` implements Presburger arithmetic: statements built from \`+\`, \`-\`,
constants, \`=\`, \`<\`, \`≤\`, \`∧\`, \`∨\` and \`¬\` over \`Nat\` and \`Int\` are
decided automatically — it either finds a proof or reports a counterexample.

Unlike \`native_decide\`, the proof it produces is a real term the kernel checks.
`,
    task: 'Prove `a < b` from `h : a + 1 = b`.',
    statement: 'example (a b : Nat) (h : a + 1 = b) : a < b',
    starter: '-- one tactic',
    hint: '`omega`. It uses every hypothesis in the context.',
    solution: 'omega',
  },
];

export const SANDBOX_STARTER = `-- A free-form file, elaborated against Lean's Init environment.
-- Imports are not available here (there is no Mathlib in the browser build).
#check Nat.add_comm
#eval 2 ^ 10

theorem my_first (p : Prop) : p → p := by
  intro hp
  exact hp
`;

export function lessonById(id) {
  return LESSONS.find((lesson) => lesson.id === id) ?? null;
}

export function lessonIndex(id) {
  return LESSONS.findIndex((lesson) => lesson.id === id);
}
