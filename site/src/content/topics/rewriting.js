// Topic: rewriting and simplification — how proofs move a goal towards `rfl`.
export const rewriting = {
  id: 'rewriting',
  title: 'Rewriting',
  summary: 'Turn the goal into one you can close',
  intro: `
Most Lean proofs are not clever. They are a sequence of small, honest steps that
replace one expression by an equal one until the goal is \`rfl\` — or until the
simplifier recognises it.

This topic is the toolkit for that: \`rw\` in both directions, \`simp\` with
control over which lemmas it may use, \`simpa using\` to reshape a hypothesis,
and \`calc\` to write a chain of equalities the way it would be written on paper.
`,
  lessons: [
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
      placeholder: 'rewrite the goal with `h`',
      hint: '`rw [h]` rewrites every `a` into `b`, giving `b + 1 = b + 1`.',
      solution: 'rw [h]',
    },
    {
      id: 'rw-backwards',
      title: 'Rewriting backwards',
      focus: 'rw [← h]',
      summary: 'Use an equation in the other direction',
      intro: `
An equation is symmetric, but \`rw\` is not: it only replaces the left-hand side
by the right-hand side. Writing \`rw [← h]\` uses \`h\` backwards.

Here the hypothesis says \`a = b\` and the goal mentions \`a\`, so the arrow points
the wrong way and the \`←\` is what makes the step possible. Type it as
\`\\l\` on most setups, or copy it from the symbol bar.
`,
      task: 'Rewrite `a` into `b` using the equation backwards.',
      statement: 'example (a b : Nat) (h : a = b) : b + 1 = a + 1',
      placeholder: 'the goal has `a`, the equation gives `a = b`',
      hint: '`rw [← h]` turns the goal into `a + 1 = a + 1`.',
      solution: 'rw [← h]',
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
      placeholder: 'one tactic is enough here',
      hint: 'Plain `simp` knows `Nat.add_zero`.',
      solution: 'simp',
    },
    {
      id: 'simpa',
      title: 'Reshape a hypothesis',
      focus: 'simpa',
      summary: 'Simplify a value before using it',
      intro: `
A hypothesis is rarely written in the shape the goal wants. \`simpa using h\`
simplifies both \`h\` and the goal, and then closes the goal with the simplified
hypothesis — "make these two match, then hand it over".

It is one of the highest-value tactics in day-to-day Lean, because it removes the
\`have\`-and-\`rw\` dance that would otherwise be needed.
`,
      task: 'Close the goal using `Nat.add_zero`.',
      statement: 'example (n : Nat) : n + 0 = n',
      placeholder: 'hand over the lemma, let `simpa` reshape it',
      hint: '`simpa using Nat.add_zero n`.',
      solution: 'simpa using Nat.add_zero n',
    },
    {
      id: 'calc',
      title: 'Calculations',
      focus: 'calc',
      summary: 'Write a chain of equalities',
      intro: `
\`calc\` lets a proof read like the calculation in a textbook: a chain of steps,
each justified by its own reason, with \`_\` standing for the expression on the
line above.

Each step is checked on its own, so when a proof fails you can see *which* step
is wrong — why \`calc\` is worth reaching for as soon as two rewrites are involved.
`,
      task: 'Chain the three equations.',
      statement: 'example (a b c d : Nat) (h1 : a = b) (h2 : b = c) (h3 : c = d) : a = d',
      placeholder: 'a chain of steps, each with a reason',
      hint: '`calc a = b := h1` then `_ = c := h2` and `_ = d := h3`.',
      solution: 'calc a = b := h1\n  _ = c := h2\n  _ = d := h3',
    },
  ],
};
