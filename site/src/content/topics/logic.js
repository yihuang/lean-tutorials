// Topic: the connectives — and, or, not, iff, and where classical reasoning enters.
export const logic = {
  id: 'logic',
  title: 'Logic',
  summary: 'And, or, not, iff — and when you need classical reasoning',
  intro: `
\`∧\`, \`∨\`, \`¬\` and \`↔\` are not built-in magic: each is a definition you could
have written yourself. \`p ∧ q\` is a structure with two fields, \`p ∨ q\` is a
two-constructor datatype, \`¬p\` is the function \`p → False\`, and \`p ↔ q\` is a
pair of implications.

Because they are ordinary data, ordinary tools work on them: \`constructor\`,
\`rcases\`, \`exact\`, \`intro\`. The last lesson is the exception — proving
\`p ∨ ¬p\` needs classical logic, and Lean will tell you so.
`,
  lessons: [
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
      placeholder: 'combine the two proofs into one term',
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
      placeholder: 'split the disjunction, then handle both cases',
      hint: 'From `hp : p` you can prove `q ∨ p` with `Or.inr hp`; from `hq : q` use `Or.inl hq`.',
      solution: 'rcases h with hp | hq\n· exact Or.inr hp\n· exact Or.inl hq',
    },
    {
      id: 'iff',
      title: 'If and only if',
      focus: '↔',
      summary: 'Build an equivalence from two implications',
      intro: `
\`p ↔ q\` is a pair: a proof of \`p → q\` and a proof of \`q → p\`. As a
structure it has two fields, so \`constructor\` (or a pair \`⟨…, …⟩\`) is all you
need to build one.

Going the other way, \`h.mp\` and \`h.mpr\` are the two directions of an existing
\`h : p ↔ q\` — "modus ponens" and its reverse.
`,
      task: 'Build the equivalence from the two implications.',
      statement: 'example {p q : Prop} (hpq : p → q) (hqp : q → p) : p ↔ q',
      placeholder: 'a pair of implications',
      hint: '`exact ⟨hpq, hqp⟩`, or `constructor` and then prove each direction.',
      solution: 'exact ⟨hpq, hqp⟩',
    },
    {
      id: 'not',
      title: 'Negation is a function',
      focus: '¬',
      summary: 'Read `¬p` as `p → False`',
      intro: `
\`¬p\` is *defined* as \`p → False\`: a proof of \`¬p\` is a function that turns
any proof of \`p\` into a proof of the impossible.

That is why the goal here is provable by handing over \`h\` unchanged — the two
types are the same type, not merely related.
`,
      task: 'Prove `p → False` from `¬p`.',
      statement: 'example {p : Prop} (h : ¬p) : p → False',
      placeholder: '¬p and p → False are the same type',
      hint: '`exact h` is enough; nothing needs to be done to it.',
      solution: 'exact h',
    },
    {
      id: 'absurd',
      title: 'From a contradiction, anything',
      focus: 'absurd',
      summary: 'Use a hypothesis and its negation',
      intro: `
If your context contains both \`p\` and \`¬p\`, the goal is irrelevant: both
together are a proof of \`False\`, and \`False\` proves everything.

\`absurd hp hn\` packages exactly that argument, and \`False.elim\` (or
\`exfalso\`, which changes the goal to \`False\`) are the two other spellings you
will see.
`,
      task: 'Prove `q` even though the context is contradictory.',
      statement: 'example {p q : Prop} (hp : p) (hn : ¬p) : q',
      placeholder: 'combine the hypothesis and its negation',
      hint: '`exact absurd hp hn` — or `exfalso` and then `exact hn hp`.',
      solution: 'exact absurd hp hn',
    },
    {
      id: 'classical',
      title: 'Excluded middle needs an axiom',
      focus: 'by_cases',
      summary: 'Case split on a proposition, classically',
      intro: `
\`p ∨ ¬p\` is not provable constructively — you cannot decide an arbitrary
proposition by computation. Lean's core does include it, via
\`Classical.em\`, and \`by_cases hp : p\` is the tactic that uses it: it splits
the goal into \`p\` and \`¬p\` branches, with \`hp\` carrying the case.

You now have both worlds: constructive proofs when they exist, classical ones
when you ask for them.
`,
      task: 'Prove the excluded middle with a case split.',
      statement: 'example (p : Prop) : p ∨ ¬p',
      placeholder: 'split into the two cases',
      hint: '`by_cases hp : p`, then each branch is one `Or.inl`/`Or.inr` away.',
      solution: 'by_cases hp : p\n· exact Or.inl hp\n· exact Or.inr hp',
    },
  ],
};
