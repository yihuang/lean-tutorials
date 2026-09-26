// Topic: the two general-purpose tactics that carry most real proofs — `grind`,
// which searches, and `simp`, which normalises under your control. Both build a
// term that the kernel checks, exactly like `rfl` does.
export const advancedTactics = {
  id: 'advanced-tactics',
  title: 'Advanced tactics',
  summary: '`grind` and controlled `simp`: automation you can steer',
  intro: `
\`simp\` and \`omega\` arrived in the last two topics. This one adds the two
tactics that do most of the work in real developments:

* \`grind\` **searches** — it chains hypotheses, tracks equalities and splits
  cases until the goal closes or it runs out of ideas;
* \`simp only [...]\` is \`simp\` with a fixed budget, which is what turns a
  proof that "worked today" into one that keeps working.

Neither is magic and neither is trusted: each produces a proof term, and the
kernel re-checks it on your device.
`,
  lessons: [
    {
      id: 'grind',
      title: 'Let Lean search',
      focus: 'grind',
      summary: 'Chain hypotheses and close the goal in one tactic',
      intro: `
Three facts are in the context: \`hp : p\`, \`h1 : p → q\` and \`h2 : q → r\`.
By hand the proof is \`exact h2 (h1 hp)\` — a term you have to find. \`grind\`
finds the same term for you.

It works by *congruence closure*: it records which terms are equal and which
facts hold, closes those facts under the hypotheses, and splits disjunctions and
branches when it has to. It is not a decision procedure — it fails on goals
\`omega\` would decide, and vice versa — so the useful skill is knowing the
one-line proof you *could* have written.
`,
      task: 'Close the goal with a single tactic.',
      statement: 'example {p q r : Prop} (h1 : p → q) (h2 : q → r) (hp : p) : r',
      placeholder: 'one tactic is enough here',
      hint: '`grind`. It uses every hypothesis in the context.',
      solution: 'grind',
    },
    {
      id: 'grind-equalities',
      title: 'Equality, for free',
      focus: 'grind',
      summary: 'Congruence: equal arguments give equal results',
      intro: `
\`h1 : a = b\` says the two numbers are the same, so \`f a\` and \`f b\` are the
same too. That step is called *congruence*, and automating it is the core of
what \`grind\` does.

\`rw [h1]\` would also finish this goal. The point is that \`grind\` chose the
equality on its own, which matters once a proof has five of them.
`,
      task: 'Prove `f b = 3` from the two hypotheses.',
      statement: 'example (f : Nat → Nat) (a b : Nat) (h1 : a = b) (h2 : f a = 3) : f b = 3',
      placeholder: 'the two hypotheses already contain the answer',
      hint: '`grind` uses `h1` to identify `b` with `a` inside `f b`.',
      solution: 'grind',
    },
    {
      id: 'grind-cases',
      title: 'Case splits, without bullets',
      focus: 'grind',
      summary: 'A disjunction is two cases grind handles itself',
      intro: `
\`h1 : p ∨ q\` gives you two cases, and \`h2\` and \`h3\` dispose of one each.
Written by hand that is \`rcases\` plus two bullets; \`grind\` does the split
and produces a single proof term.

The price of that convenience is search: on arithmetic goals \`omega\` is usually
faster, and on a goal you want to unfold, \`simp only [...]\` gives you control
\`grind\` does not have.
`,
      task: 'Close the goal from the disjunction.',
      statement: 'example {p q r : Prop} (h1 : p ∨ q) (h2 : p → r) (h3 : q → r) : r',
      placeholder: 'one tactic handles both branches',
      hint: '`grind`.',
      solution: 'grind',
    },
    {
      id: 'simp-control',
      title: 'Simplification with a budget',
      focus: 'simp only',
      summary: 'Name exactly which lemmas may fire',
      intro: `
Rewriting introduced \`simp\`, which normalises the goal with a large library of
\`@[simp]\` lemmas. That library is convenient and unpredictable: a bare \`simp\`
keeps working only while nobody retags a lemma, and it can be slow because it
tries everything it knows.

\`simp only [Nat.add_assoc]\` says *use this lemma and nothing else*. The proof
becomes reproducible, and it documents which fact the argument actually turns on.
`,
      task: 'Close the goal using associativity only.',
      statement: 'example (a b c : Nat) : a + (b + c) = a + b + c',
      placeholder: 'restrict the simplifier to one lemma',
      hint: '`simp only [Nat.add_assoc]` — the right-hand side is already the nested form.',
      solution: 'simp only [Nat.add_assoc]',
    },
    {
      id: 'simp-hypotheses',
      title: 'Use the hypotheses too',
      focus: 'simp_all',
      summary: 'Normalise the goal and the context together',
      intro: `
Plain \`simp\` only looks at the goal. \`simp_all\` simplifies the goal *and*
every hypothesis, then tries to close what is left — it is the tactic for goals
whose content is sitting in the context, unassembled.

It is deliberately aggressive. When it closes too much, \`simp_all only [...]\`
puts the budget back.
`,
      task: 'Let the simplifier combine the two equalities.',
      statement: 'example (n m : Nat) (h1 : n = m) (h2 : m = 5) : n = 5',
      placeholder: 'the equalities already contain the answer',
      hint: '`simp_all` rewrites `n` to `m` and `m` to `5`, in the goal and in the hypotheses.',
      solution: 'simp_all',
    },
    {
      id: 'simp-a-hypothesis',
      title: 'Simplifying one hypothesis',
      focus: 'simp at',
      summary: 'Rewrite a hypothesis in place, then hand it over',
      intro: `
\`simp at h\` simplifies a single hypothesis instead of the goal, and
\`simp at *\` does the goal and the whole context. Here \`h : n + 0 = 3\` becomes
\`h : n = 3\` — the goal, written in the context.

Reading the goal and the hypotheses as two expressions to be brought together is
most of the craft of Lean, and this tactic is the smallest tool for it.
`,
      task: 'Simplify `h` until it is the goal, then use it.',
      statement: 'example (n : Nat) (h : n + 0 = 3) : n = 3',
      placeholder: 'simplify the hypothesis first',
      hint: '`simp at h` leaves `h : n = 3`; then `exact h`.',
      solution: 'simp at h\nexact h',
    },
  ],
};
