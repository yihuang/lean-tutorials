// Topic: tactics that do the reasoning for you — and what they cost.
export const automation = {
  id: 'automation',
  title: 'Automation',
  summary: 'omega and decide: when to let Lean search',
  intro: `
Two tactics close a surprising fraction of small goals without any guidance.
\`omega\` decides linear arithmetic over \`Nat\` and \`Int\`; \`decide\` evaluates a
decidable proposition by computation.

Both are *safe* in the sense that matters: whatever they produce is a proof term
that the kernel checks. That is worth contrasting with \`native_decide\`, which
trusts compiled code and is refused in this course.
`,
  lessons: [
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
      placeholder: 'one tactic decides this',
      hint: '`omega`. It uses every hypothesis in the context.',
      solution: 'omega',
    },
    {
      id: 'omega-cancel',
      title: 'Cancelling on both sides',
      focus: 'omega',
      summary: 'Remove the same term from both sides',
      intro: `
The hypothesis and the goal differ by a term that appears on both sides of the
equation, and \`omega\` cancels it. Doing this by hand means finding the right
\`Nat\` lemma and rewriting in the right direction; letting the tactic do it is
the same proof with none of the searching.

Remember that \`omega\` is a decision procedure with a *scope*: addition and
comparison, not multiplication by a variable.
`,
      task: 'Cancel the `+ 1` from both sides.',
      statement: 'example (a b : Nat) (h : a + 1 = b + 1) : a = b',
      placeholder: 'both sides grew by the same amount',
      hint: '`omega`.',
      solution: 'omega',
    },
    {
      id: 'decide',
      title: 'Deciding by computation',
      focus: 'decide',
      summary: 'Prove a closed decidable proposition',
      intro: `
\`decide\` evaluates a proposition that has a \`Decidable\` instance and, if the
answer is \`true\`, turns that evaluation into a proof.

It only works when the answer is knowable by computation — no variables, or
variables only in positions the kernel can reduce. It also fails on goals that
are *true* but not computable, which is precisely the line between \`decide\` and
\`simp\`.
`,
      task: 'Prove the arithmetic claim by computation.',
      statement: 'example : (2 + 2) * 3 = 12',
      placeholder: 'the answer is computable',
      hint: '`decide` — or `rfl`, since the two sides reduce to the same numeral.',
      solution: 'decide',
    },
    {
      id: 'decide-list',
      title: 'Deciding over data',
      focus: 'decide',
      summary: 'Computation is not limited to numbers',
      intro: `
\`decide\` is not arithmetic-specific: any type with a computational equality and
a \`Decidable\` instance works. Here it evaluates \`List.range 4\` — a real list,
built at kernel level — and then compares lengths.

This is the tactic to reach for when a concrete example is in doubt, before
looking for anything clever.
`,
      task: 'Prove that `List.range 4` has four elements.',
      statement: 'example : (List.range 4).length = 4',
      placeholder: 'a concrete list can be computed',
      hint: '`decide`.',
      solution: 'decide',
    },
  ],
};
