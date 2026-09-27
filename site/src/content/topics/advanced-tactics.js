// Topic: the general-purpose tactics that carry real proofs — and the habit that
// makes them educational rather than mysterious: asking them to report what the
// search found (`grind?`, `simp?`). Both build a term the kernel checks; the `?`
// only asks Lean to name it.
export const advancedTactics = {
  id: 'advanced-tactics',
  title: 'Advanced tactics',
  summary: '`grind?` and controlled `simp`: automation you can read',
  intro: `
\`simp\` and \`omega\` arrived in the last two topics. This one adds the tactic
that searches, and the habit that keeps all of them honest: **put a \`?\` after
the tactic name**.

* \`grind?\` runs \`grind\`, and when the search succeeds it reports the
  invocation that reproduces the proof, including the lemmas it had to use;
* \`simp?\` does the same for the simplifier, naming the lemmas it fired in
  exactly the \`simp only [...]\` form you would write by hand.

Neither is a way around the kernel: the tactic still runs, and the term it
produces is still checked on your device. The \`?\` only asks Lean to say what it
found — and a one-line proof you cannot read is worth less than a two-line proof
you can.
`,
  lessons: [
    {
      id: 'grind',
      title: 'Let Lean search',
      focus: 'grind?',
      summary: 'Chain hypotheses, then read what the search found',
      intro: `
Three facts are in the context: \`hp : p\`, \`h1 : p → q\` and \`h2 : q → r\`.
By hand the proof is \`exact h2 (h1 hp)\`; \`grind\` finds that same term by
*congruence closure* — recording which terms are equal and which facts hold,
closing those facts under the hypotheses, and splitting cases when it must.

\`grind?\` does all of that and then says what it found. Here the report is
\`grind only\` with an empty list, which is Lean telling you the hypotheses were
the whole proof and no library lemma was needed. That one line is often the
entire explanation of a proof that looks like magic.
`,
      task: 'Close the goal, then read the report under the verdict.',
      statement: 'example {p q r : Prop} (h1 : p → q) (h2 : q → r) (hp : p) : r',
      placeholder: 'one tactic — then look below the verdict',
      hint: '`grind?`. The report is shown under “Proof verified”.',
      solution: 'grind?',
    },
    {
      id: 'grind-equalities',
      title: 'Equality, for free',
      focus: 'grind?',
      summary: 'Congruence: equal arguments give equal results',
      intro: `
\`h1 : a = b\` says the two numbers are the same, so \`f a\` and \`f b\` are the
same too. That step is called *congruence*, and automating it is the core of what
\`grind\` does: it never has to be told which equality to use, or which function
to push it through.

Run it and read the report — an empty \`only\` list again means the equalities in
the context were all it needed. \`rw [h1]\` would also finish this goal; the
difference is that you did not have to find \`h1\`.
`,
      task: 'Prove `f b = 3`, then read what the search used.',
      statement: 'example (f : Nat → Nat) (a b : Nat) (h1 : a = b) (h2 : f a = 3) : f b = 3',
      placeholder: 'the two hypotheses already contain the answer',
      hint: '`grind?` — the report will confirm it needed nothing beyond the context.',
      solution: 'grind?',
    },
    {
      id: 'grind-cases',
      title: 'Case splits, without bullets',
      focus: 'grind?',
      summary: 'A disjunction is two cases, and grind takes them itself',
      intro: `
\`h1 : p ∨ q\` gives you two cases, with \`h2\` and \`h3\` disposing of one each.
Written by hand that is \`rcases\` plus two bullets; \`grind\` does the split on
its own and produces a single proof term.

The report is the shortest there is, but it is worth seeing that the case
analysis came from the search rather than from you. The price of that convenience
is search: on arithmetic goals \`omega\` is usually faster, and on a goal you want
to unfold, \`simp only [...]\` gives you control \`grind\` does not have.
`,
      task: 'Close the goal from the disjunction.',
      statement: 'example {p q r : Prop} (h1 : p ∨ q) (h2 : p → r) (h3 : q → r) : r',
      placeholder: 'one tactic handles both branches',
      hint: '`grind?`; no bullets needed.',
      solution: 'grind?',
    },
    {
      id: 'grind-lemmas',
      title: 'Learning which lemma it used',
      focus: 'grind only',
      summary: 'Read the lemma out of the report, then name it yourself',
      intro: `
Not every goal falls to the hypotheses alone. This one needs a fact relating
\`List.length\` to \`++\`, and the search has to find it: run \`grind?\` and the
report names it — \`grind only [= List.length_append]\`.

The \`=\` marks an equation, and \`only [...]\` restricts the search to the lemmas
you list. That is the report's real use: it turns “grind did something” into
“this proof rests on \`List.length_append\`”, which is a sentence you can check
yourself. In a bigger goal Lean may report several invocations it verified; take
the one you can read, and put it in the editor.
`,
      task: 'Ask which lemma this needs, then prove it with that lemma named explicitly.',
      statement: 'example (xs ys : List Nat) : (xs ++ ys).length = xs.length + ys.length',
      placeholder: 'ask first: run `grind?` and read the report',
      hint: '`grind?` reports `grind only [= List.length_append]`; type that invocation (brackets included) and it proves the goal on its own.',
      solution: 'grind only [= List.length_append]',
    },
    {
      id: 'simp-ask',
      title: 'Ask which lemmas fire',
      focus: 'simp?',
      summary: 'Turn a silent `simp` into a readable list',
      intro: `
\`simp\` normalises a goal with a large library of \`@[simp]\` lemmas and, by
default, does not tell you which ones it used. That is convenient and opaque: the
proof works today and you cannot say what it depends on.

\`simp?\` closes the same goal and reports the budget it used — here
\`simp only [List.append_nil]\` — which is exactly what you would write by hand
to make the proof reproducible.
`,
      task: 'Prove it, then read off the lemmas Lean used.',
      statement: 'example (xs : List Nat) : xs ++ [] = xs',
      placeholder: 'let the simplifier work, then read the report',
      hint: '`simp?` — the report is a `simp only [...]` invocation you can copy into the editor.',
      solution: 'simp?',
    },
    {
      id: 'simp-control',
      title: 'Simplification with a budget',
      focus: 'simp only',
      summary: 'Name exactly which lemmas may fire',
      intro: `
\`simp?\` hands you a budget when plain \`simp\` can close the goal. This goal is
the other case: associativity of \`+\` is not in the default \`@[simp]\` set, so a
bare \`simp\` reports “\`simp\` made no progress” rather than quietly failing.

You supply the missing fact instead. \`simp only [Nat.add_assoc]\` says *use this
lemma and nothing else* — reproducible, fast, and it documents which fact the
argument turns on.
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

It is deliberately aggressive, and it has a \`?\` too: \`simp_all?\` reports the
lemmas and hypotheses it used, the same way the other two do. When it closes too
much, \`simp_all only [...]\` puts the budget back.
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
most of the craft of Lean, and this is the smallest tool for it.
`,
      task: 'Simplify `h` until it is the goal, then use it.',
      statement: 'example (n : Nat) (h : n + 0 = 3) : n = 3',
      placeholder: 'simplify the hypothesis first',
      hint: '`simp at h` leaves `h : n = 3`; then `exact h`.',
      solution: 'simp at h\nexact h',
    },
  ],
};
