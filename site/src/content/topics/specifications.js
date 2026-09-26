// Topic: specifications — pre- and postconditions as propositions, and the two
// ways of taking a conditional implementation apart.
export const specifications = {
  id: 'specifications',
  title: 'Specifications',
  summary: 'Pre- and postconditions as propositions you can prove',
  intro: `
A specification has two halves. The **precondition** is what the caller must
guarantee, written as hypotheses. The **postcondition** is what the
implementation must deliver, written as the goal.

There is no separate specification language here: both halves are ordinary
propositions, and the implementation is the expression they talk about. In this
topic it is written inline, as a conditional, so the code and its proof sit in
the same goal — which is also the honest size for a first specification.
`,
  lessons: [
    {
      id: 'precondition',
      title: 'The caller’s half',
      focus: 'omega',
      summary: 'A hypothesis is an obligation on the caller',
      intro: `
\`n - 1 + 1 = n\` is false at \`n = 0\`, so the implementation cannot promise it
for nothing. The hypothesis \`h : n > 0\` is the precondition: the caller
guarantees it, and inside the proof it is a fact you may use.

This is the everyday form of a precondition in Lean — a function takes the proof
as an argument, so calling it without one is not a runtime error, it is a type
error.
`,
      task: 'Prove the postcondition from the precondition.',
      statement: 'example (n : Nat) (h : n > 0) : n - 1 + 1 = n',
      placeholder: 'the hypothesis rules out the only bad case',
      hint: '`omega` uses `h` to discard `n = 0`.',
      solution: 'omega',
    },
    {
      id: 'postcondition',
      title: 'The implementation’s half',
      focus: 'split',
      summary: 'Bound the result of a conditional',
      intro: `
The implementation is \`if a ≤ b then b else a\` — the larger of the two numbers,
written out. The postcondition claims the result is at least \`a\` **and** at
least \`b\`, which is what "it computes the maximum" means once you spell it out.

\`split\` turns an \`if\` in the goal into its two cases, one per branch, with
the condition available as a hypothesis. That is all most specification proofs
need.
`,
      task: 'Prove the result is at least both inputs.',
      statement: 'example (a b : Nat) : a ≤ (if a ≤ b then b else a) ∧ b ≤ (if a ≤ b then b else a)',
      placeholder: 'split on the condition, then close each branch',
      hint: '`split <;> omega` — `<;>` runs `omega` in both branches.',
      solution: 'split <;> omega',
    },
    {
      id: 'case-split',
      title: 'Naming the condition',
      focus: 'by_cases',
      summary: 'Do the split yourself when you want the hypothesis',
      intro: `
\`split\` hands each branch the condition as an anonymous fact. \`by_cases h : a ≤ b\`
does the same but *names* it \`h\` in both branches — and in the negative branch
\`h : ¬ a ≤ b\` is exactly what \`omega\` needs to see the two cases.

Reach for \`split\` when the shape is all that matters, and \`by_cases\` when you
want to reason about the condition as a proposition.
`,
      task: 'Take the conditional apart yourself, then finish both cases.',
      statement: 'example (a b : Nat) : a ≤ (if a ≤ b then b else a) ∧ b ≤ (if a ≤ b then b else a)',
      placeholder: 'name the condition, simplify with it, then decide',
      hint: '`by_cases h : a ≤ b <;> simp [h] <;> omega`.',
      solution: 'by_cases h : a ≤ b <;> simp [h] <;> omega',
    },
    {
      id: 'spec-equation',
      title: 'A specification can be an equation',
      focus: 'by_cases',
      summary: 'Prove two implementations agree',
      intro: `
The absolute difference of \`a\` and \`b\` is symmetric. That is not a property
of one run — it is the statement that the two conditional expressions are
*equal*, for every pair of inputs.

Equations between programs are proved exactly like any other equation: case
analysis on the conditions, then arithmetic.
`,
      task: 'Prove the two implementations are equal.',
      statement: 'example (a b : Nat) : (if a ≤ b then b - a else a - b) = (if b ≤ a then a - b else b - a)',
      placeholder: 'case analysis on `a ≤ b`, then arithmetic',
      hint: '`by_cases h : a ≤ b <;> simp [h] <;> omega` — or let `grind` try.',
      solution: 'by_cases h : a ≤ b <;> simp [h] <;> omega',
    },
    {
      id: 'grind-a-spec',
      title: 'One tactic for a whole spec',
      focus: 'grind',
      summary: 'The searching tactic does the case analysis for you',
      intro: `
\`grind\`, from the Advanced tactics topic, also splits conditionals — so the
proof two lessons up collapses to one word.

It is worth still knowing the by-hand version. Automation is a *speed-up* of an
argument you could write out, not a replacement for understanding it, and
\`grind\` can be slow or give up where a named lemma would not.
`,
      task: 'Prove the bound again, with one tactic.',
      statement: 'example (a b : Nat) : a ≤ (if a ≤ b then b else a) ∧ b ≤ (if a ≤ b then b else a)',
      placeholder: 'let the automation do it',
      hint: '`grind`.',
      solution: 'grind',
    },
    {
      id: 'division-bound',
      title: 'A bound, not an equation',
      focus: 'omega',
      summary: 'Specifications are often inequalities',
      intro: `
Halving a natural number and doubling it again does not return the original:
\`n / 2\` throws away the remainder. The honest postcondition is therefore an
inequality — "twice the half is at most \`n\`" — and choosing the honest one is
half of writing a specification at all.

\`omega\` knows how \`/\` and \`%\` by a numeral interact with \`≤\`, so this is a
one-liner.
`,
      task: 'Prove the bound on halving.',
      statement: 'example (n : Nat) : 2 * (n / 2) ≤ n',
      placeholder: 'division truncates — state what is actually true',
      hint: '`omega`.',
      solution: 'omega',
    },
  ],
};
