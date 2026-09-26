// Topic: loop invariants — the equation an accumulator satisfies at the top of
// every iteration, and the two library lemmas that state it for `List.foldl`.
export const loopInvariants = {
  id: 'loop-invariants',
  title: 'Loop invariants',
  summary: 'The property an accumulator keeps true on every iteration',
  intro: `
Lean has no \`while\`. What it has instead is \`List.foldl\`: a function that
walks a list carrying an accumulator, one element at a time. That *is* the loop,
and its induction principle is the list's.

A loop invariant is what you claim about the accumulator just before each step —
for addition, "the accumulator is the initial value plus the sum so far". The
library already states that invariant once, as \`List.foldl_assoc\`, which is why
the first two lessons here are one line each: recognising an invariant someone
else proved is the same skill as finding one.
`,
  lessons: [
    {
      id: 'invariant',
      title: 'The accumulator invariant',
      focus: 'List.foldl_assoc',
      summary: 'What the accumulator means at every step',
      intro: `
Start with \`a + b\` in the accumulator and fold \`xs\` on top. At every step
the accumulator holds "the starting value plus what has been processed" — so
after the loop it is \`a + b + xs.sum\`, and that is the same as starting with
\`b\` and adding \`a\` at the end.

\`List.foldl_assoc\` is precisely this statement, proved once for **any**
associative operation. Rewriting with it is the whole proof.
`,
      task: 'Prove the invariant, using the library’s statement of it.',
      statement: 'example (xs : List Nat) (a b : Nat) : xs.foldl (· + ·) (a + b) = a + xs.foldl (· + ·) b',
      placeholder: 'the library proved this invariant already',
      hint: '`rw [List.foldl_assoc]` — the `+` of `Nat` is associative, so the instance is found.',
      solution: 'rw [List.foldl_assoc]',
    },
    {
      id: 'fold-append',
      title: 'Two loops in a row',
      focus: 'List.foldl_append',
      summary: 'A fold over `xs ++ ys` is a fold over `xs`, then over `ys`',
      intro: `
Folding the concatenation of two lists is the same as folding the first, and
then folding the second starting from the accumulator the first one produced.

This is what makes \`foldl\` compositional: you can reason about one list at a
time, which is exactly what a loop invariant buys you in a language with
\`while\`.
`,
      task: 'Split the fold over the concatenation.',
      statement: 'example (xs ys : List Nat) (acc : Nat) : (xs ++ ys).foldl (· + ·) acc = ys.foldl (· + ·) (xs.foldl (· + ·) acc)',
      placeholder: 'the two halves fold one after the other',
      hint: '`rw [List.foldl_append]`.',
      solution: 'rw [List.foldl_append]',
    },
    {
      id: 'count-invariant',
      title: 'An invariant the library does not have',
      focus: 'induction',
      summary: 'Prove the invariant when nothing is pre-proved',
      intro: `
Not every loop has a ready-made lemma. Counting elements has no
\`foldl_count\`, so the invariant is yours to prove — and the proof is the
invariant, one step at a time.

Induct on the list, generalising the accumulator so the induction hypothesis
covers *every* starting value — that is what an invariant is for. In the cons
case, \`List.foldl_cons\` takes one step of the loop and \`List.length_cons\`
takes one step of the count.
`,
      task: 'Prove that counting with an accumulator adds one per element.',
      statement: 'example {α : Type} (xs : List α) (acc : Nat) : xs.foldl (fun acc _ => acc + 1) acc = acc + xs.length',
      placeholder: 'induct on the list, generalising the accumulator',
      hint: '`induction xs generalizing acc with | nil => simp | cons x xs ih => …`; step with `simp only [List.foldl_cons, List.length_cons]`, `rw [ih (acc + 1)]`, then `omega`.',
      solution: 'induction xs generalizing acc with\n| nil => simp\n| cons x xs ih =>\n  simp only [List.foldl_cons, List.length_cons]\n  rw [ih (acc + 1)]\n  omega',
    },
  ],
};
