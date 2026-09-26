// Topic: termination — why Lean refuses a definition whose recursion it cannot
// prove stops, and the two annotations you supply when structure is not enough.
//
// These lessons are whole-file exercises (kind 'file'): the point is the
// definition itself, and `termination_by` only makes sense attached to one.
export const termination = {
  id: 'termination',
  title: 'Termination',
  summary: 'Proving that a recursion stops — and why Lean insists',
  intro: `
Lean will not accept a definition unless it can see that the recursion stops.
This is not pedantry: a non-terminating "function" can be used to prove \`False\`,
so accepting one would make the logic unsound.

*Structural* recursion is caught for free: if the recursive call is on a
constructor subterm (\`count (n + 1)\` calls \`count n\`), Lean is done.
Everything else needs help — a **measure** (\`termination_by\`) and a proof that
the measure decreases (\`decreasing_by\`).

Each lesson here is a whole file: write the definition, then run it.
`,
  lessons: [
    {
      id: 'structural-recursion',
      title: 'Structural recursion comes free',
      focus: 'def',
      summary: 'Recursing on a constructor subterm is checked automatically',
      intro: `
\`Nat\` has two constructors, \`0\` and \`Nat.succ\`. A definition that matches on
them and calls itself on the *predecessor* is structurally recursive: the
argument of the recursive call is literally part of the argument the definition
was given, so it is smaller, and the recursion must stop.

Nothing extra to write — Lean's equation compiler sees the pattern and accepts
the definition.
`,
      kind: 'file',
      task: 'Define `count : Nat → Nat` with `count 0 = 0` and `count (n + 1) = 1 + count n`, and make `#eval count 5` print `5`.',
      placeholder: 'def count : Nat → Nat … then #eval count 5',
      hint: 'Match on the argument: `| 0 => 0` and `| n + 1 => 1 + count n`. The recursive call on `n` is the structural one.',
      require: ['def count', '#eval'],
      expects: ['5'],
      solution: 'def count : Nat → Nat\n  | 0 => 0\n  | n + 1 => 1 + count n\n\n#eval count 5',
    },
    {
      id: 'termination-measure',
      title: 'Halving, with a measure',
      focus: 'termination_by',
      summary: 'Tell Lean which expression decreases',
      intro: `
\`half n = if n < 2 then 0 else half (n / 2) + 1\` does terminate — every step
halves the number — but the recursive call is on \`n / 2\`, not on a subterm of
\`n\`. The equation compiler cannot see the decrease by itself.

\`termination_by n\` says *the measure is the number itself*; \`decreasing_by\`
is then asked to prove \`n / 2 < n\`, which \`Nat.div_lt_self\` supplies once the
two side conditions are discharged by \`omega\`.
`,
      kind: 'file',
      task: 'Define `half` as `if n < 2 then 0 else half (n / 2) + 1`, prove it terminates with `termination_by n`, and make `#eval half 9` print `3`.',
      placeholder: 'def half … termination_by … decreasing_by …',
      hint: 'After the body add `termination_by n` and `decreasing_by exact Nat.div_lt_self (by omega) (by omega)`.',
      require: ['termination_by', 'decreasing_by', '#eval'],
      expects: ['3'],
      solution: 'def half (n : Nat) : Nat :=\n  if n < 2 then 0 else half (n / 2) + 1\ntermination_by n\ndecreasing_by exact Nat.div_lt_self (by omega) (by omega)\n\n#eval half 9',
    },
    {
      id: 'decreasing-by-omega',
      title: 'A measure and `omega`',
      focus: 'decreasing_by',
      summary: 'Let automation discharge the decrease',
      intro: `
Once \`termination_by\` has named the measure, the goal is an ordinary
arithmetic inequality: prove that the argument of the recursive call is smaller
than the measure of the argument being defined.

For \`n - 1 < n\` that is exactly what \`omega\` is for, so \`decreasing_by omega\`
is the whole proof.
`,
      kind: 'file',
      task: 'Define `sumFrom n` as `0 + 1 + ⋯ + n` by recursion, prove termination with `termination_by n` and `decreasing_by omega`, and make `#eval sumFrom 4` print `10`.',
      placeholder: 'a recursion that steps down by one',
      hint: 'The body is `if n = 0 then 0 else n + sumFrom (n - 1)`; then `termination_by n` and `decreasing_by omega`.',
      require: ['termination_by', 'decreasing_by', '#eval'],
      expects: ['10'],
      solution: 'def sumFrom (n : Nat) : Nat :=\n  if n = 0 then 0 else n + sumFrom (n - 1)\ntermination_by n\ndecreasing_by omega\n\n#eval sumFrom 4',
    },
  ],
};
