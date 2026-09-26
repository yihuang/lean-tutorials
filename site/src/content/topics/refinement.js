// Topic: refinement — two implementations of the same idea, and the theorem
// that says they agree. Sometimes the bridge is `rfl`; usually it is one `simp`
// with the library's lemmas.
export const refinement = {
  id: 'refinement',
  title: 'Executable specs',
  summary: 'Keeping an implementation equal to a clear specification',
  intro: `
Two implementations of the same idea should be provably equal. The clear one —
written with \`List.foldr\` or \`List.reverse\` — is the *specification*; the
one you would actually run is the *implementation*, and the theorem between them
is the refinement proof.

The pleasant cases are the ones where the bridge is definitional: \`List.sum\`
*is* a \`foldr\`, so the refinement is \`rfl\`. The rest of the time it is one
\`simp\` with the library lemma that was proved for exactly this purpose.
`,
  lessons: [
    {
      id: 'sum-is-foldr',
      title: 'When the spec is the implementation',
      focus: 'rfl',
      summary: 'The equality holds by definition',
      intro: `
\`List.sum\` is defined as \`List.foldr (· + ·) 0\`. The two sides of this goal
are the same term, so no lemma and no tactic is needed beyond \`rfl\` — the
kernel sees it by computation.

It is worth knowing this case exists. When a refinement proof is one line, the
two definitions were probably shaped to make it so.
`,
      task: 'Prove the equality of the two definitions.',
      statement: 'example (xs : List Nat) : xs.sum = xs.foldr (· + ·) 0',
      placeholder: 'the two sides are the same definition',
      hint: '`rfl` — `List.sum` unfolds to exactly this `foldr`.',
      solution: 'rfl',
    },
    {
      id: 'sum-append',
      title: 'The spec respects concatenation',
      focus: 'simp',
      summary: 'A sum over `xs ++ ys` is the sum of the sums',
      intro: `
Adding up \`xs ++ ys\` element by element gives the same number as adding up
\`xs\`, adding up \`ys\`, and adding the two totals — associativity of \`+\`,
applied inside a fold.

The library proves this as \`List.sum_append\`, and \`simp\` knows to use it. The
theorem is what lets you reason about the parts of a list separately, which is
how a refinement proof about a whole program is assembled from proofs about its
pieces.
`,
      task: 'Split the sum over the concatenation.',
      statement: 'example (xs ys : List Nat) : (xs ++ ys).sum = xs.sum + ys.sum',
      placeholder: 'the sum of a concatenation splits in two',
      hint: '`simp` uses `List.sum_append` (and the associativity instance for `+`).',
      solution: 'simp',
    },
    {
      id: 'map-length',
      title: 'Mapping cannot change the length',
      focus: 'simp',
      summary: 'The spec has one clause per list constructor',
      intro: `
Applying a function to every element of a list produces a list of the same
length, whatever the function is, because \`map\` never adds or drops an element.
That is a specification of \`List.map\`, written as an equation.

Reading a lemma name like \`List.length_map\` tells you the specification was
already stated for you — the work is then knowing it is the right one.
`,
      task: 'Prove that mapping preserves the length.',
      statement: 'example {α β : Type} (xs : List α) (f : α → β) : (xs.map f).length = xs.length',
      placeholder: 'mapping keeps the length',
      hint: '`simp` uses `List.length_map`.',
      solution: 'simp',
    },
    {
      id: 'reverse-involution',
      title: 'Reversing twice is the identity',
      focus: 'simp',
      summary: 'A refinement stated as an involution',
      intro: `
\`xs.reverse.reverse = xs\` says the two operations cancel: \`reverse\` is an
involution. Like any equation between programs it is a theorem, and for lists
the library proves it by induction on the list.

It is also the shape of a common refinement argument: an operation plus its
inverse is the identity, so a round trip through the implementation loses
nothing.
`,
      task: 'Prove that reversing twice is the identity.',
      statement: 'example {α : Type} (xs : List α) : xs.reverse.reverse = xs',
      placeholder: 'the two reversals cancel',
      hint: '`simp` uses `List.reverse_reverse`.',
      solution: 'simp',
    },
  ],
};
