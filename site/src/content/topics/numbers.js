// Topic: Nat is an inductive type — zero and succ — and induction is how you
// use that fact.
export const numbers = {
  id: 'numbers',
  title: 'Numbers',
  summary: 'Nat is zero and succ, and nothing else',
  intro: `
\`Nat\` is an inductive type with two constructors, \`Nat.zero\` and
\`Nat.succ\`, and the numerals \`0, 1, 2, …\` are notation for nested \`succ\`s.
That is the whole type, so \`cases\` and \`induction\` are not tricks: they are
the only way to inspect a natural number.

This topic is where proofs stop *computing* and start *reasoning*: \`rfl\` no
longer finishes, and you need induction hypotheses, lemmas and rewriting.
`,
  lessons: [
    {
      id: 'nat-cases',
      title: 'Every Nat is zero or a successor',
      focus: 'cases',
      summary: 'Case split on a natural number',
      intro: `
Because \`Nat\` has exactly two constructors, any natural number is either
\`0\` or \`k + 1\` for some \`k\`. \`cases n with\` makes Lean spell that out for
you, and in the successor branch it gives you the predecessor as a hypothesis.

This is the first lesson where the proof is not pure computation: one branch is
\`Or.inl rfl\`, and the other has to *build* the witness \`k\`.
`,
      task: 'Split on `n` and finish both branches.',
      statement: 'example (n : Nat) : n = 0 ∨ ∃ k, n = k + 1',
      placeholder: 'case split on `n`',
      hint: '`cases n with | zero => … | succ k => …`; the right branch needs `⟨k, rfl⟩`.',
      solution: 'cases n with\n| zero => exact Or.inl rfl\n| succ k => exact Or.inr ⟨k, rfl⟩',
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
      placeholder: '`induction n with` — then both branches',
      hint: 'Base case: `rfl`. Step case: `rw [Nat.add_succ, ih]` — unfold `+` on `succ` and use `ih`.',
      solution: 'induction n with\n| zero => rfl\n| succ k ih => rw [Nat.add_succ, ih]',
    },
    {
      id: 'succ-ne-zero',
      title: 'No natural number is its own successor',
      focus: 'Nat.succ_ne_zero',
      summary: 'Constructors are disjoint',
      intro: `
Different constructors of an inductive type can never be equal — that is not an
extra axiom, it is what it means to be an inductive type.

\`Nat.succ_ne_zero n\` is the named version of this fact for \`succ n ≠ 0\`. When
a hypothesis *is* an impossible equality, \`Nat.noConfusion h\` (or \`cases h\`)
turns it into \`False\`.
`,
      task: 'Prove that `n + 1` is not `0`.',
      statement: 'example (n : Nat) : Nat.succ n ≠ 0',
      placeholder: 'name the disjointness lemma',
      hint: '`exact Nat.succ_ne_zero n` — read the `≠` as an implication to `False`.',
      solution: 'exact Nat.succ_ne_zero n',
    },
    {
      id: 'add-assoc',
      title: 'Naming an arithmetic fact',
      focus: 'simp',
      summary: 'Use a library lemma instead of proving it again',
      intro: `
You do not have to reprove arithmetic. Lean's core library already knows that
addition is associative, and the fastest proof is to say so: \`simp\` with the
lemma named explicitly.

Preferring the named lemma over a bare \`simp\` is a habit worth forming: it
documents *which* fact you relied on, and it keeps the proof fast.
`,
      task: 'Prove associativity from the library.',
      statement: 'example (a b c : Nat) : a + b + c = a + (b + c)',
      placeholder: 'name the lemma you need',
      hint: '`exact Nat.add_assoc a b c`, or `simp [Nat.add_assoc]`.',
      solution: 'exact Nat.add_assoc a b c',
    },
    {
      id: 'mul-comm',
      title: 'Commutativity is not definitional',
      focus: 'Nat.mul_comm',
      summary: 'Some equations need a theorem, not computation',
      intro: `
\`a * b = b * a\` is not true by computation: \`Nat.mul\` recurses on its second
argument, so \`2 * n\` and \`n * 2\` are different terms. You need the theorem.

This is the boundary to keep in mind: \`rfl\` proves what is *definitionally*
true, and everything else needs a proof — often one already in the library.
`,
      task: 'Prove commutativity of multiplication.',
      statement: 'example (a b : Nat) : a * b = b * a',
      placeholder: 'this one needs a theorem',
      hint: '`exact Nat.mul_comm a b`.',
      solution: 'exact Nat.mul_comm a b',
    },
  ],
};
