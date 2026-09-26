// Topic: ∀ and ∃ — the quantifiers, and how they behave as functions and data.
export const quantifiers = {
  id: 'quantifiers',
  title: 'For all and there exists',
  summary: 'Quantifiers are functions and data',
  intro: `
\`∀\` is the dependent function type and \`∃\` is a datatype, so the tools you
already know keep working: \`intro\` *uses* a universal statement, \`apply\`
*proves* one, and \`⟨witness, proof⟩\` is how you hand over an existence proof.

The last lesson puts the two together, which is the shape of a great many real
theorems.
`,
  lessons: [
    {
      id: 'forall',
      title: 'For all',
      focus: 'intro',
      summary: 'Prove a universal statement by fixing an arbitrary value',
      intro: `
To prove \`∀ p : Prop, p → p\` you do what a mathematician does: "let \`p\` be an
arbitrary proposition, and let \`hp\` be a proof of it". \`intro\` is that
sentence, spelled as a tactic.

Nothing else is needed here, because the statement is deliberately the simplest
one: the point is that \`∀\` behaves exactly like the arrow you met in
Foundations.
`,
      task: 'Prove the universal statement.',
      statement: 'example : ∀ p : Prop, p → p',
      placeholder: 'introduce the variable, then the assumption',
      hint: '`intro p hp` then `exact hp`.',
      solution: 'intro p hp\nexact hp',
    },
    {
      id: 'forall-apply',
      title: 'Using a universal hypothesis',
      focus: 'apply',
      summary: 'A ∀ hypothesis is a function you can apply',
      intro: `
A hypothesis \`h : ∀ n, f n = n\` is a function: give it an \`n\` and it hands
back a proof about that \`n\`. \`apply h\` works backwards from the goal and lets
Lean pick the argument, so \`f 7 = 7\` is closed by applying \`h\`.

Equivalently, \`exact h 7\` writes the application out in full.
`,
      task: 'Close the goal with the universal hypothesis.',
      statement: 'example (f : Nat → Nat) (h : ∀ n, f n = n) : f 7 = 7',
      placeholder: 'apply the hypothesis to the right value',
      hint: '`apply h` — or `exact h 7` to be explicit.',
      solution: 'apply h',
    },
    {
      id: 'exists',
      title: 'There exists',
      focus: '∃',
      summary: 'Prove an existence claim by giving a witness',
      intro: `
\`∃ n : Nat, n * 2 = 8\` is a pair: an element of \`Nat\` and a proof about that
element. So an existence proof is written \`⟨witness, proof⟩\` — you choose the
value and you still have to prove the claim about it.

Here the witness is \`4\`, and \`4 * 2 = 8\` is true by computation.
`,
      task: 'Prove the existence claim.',
      statement: 'example : ∃ n : Nat, n * 2 = 8',
      placeholder: 'give a witness and a proof',
      hint: '`exact ⟨4, rfl⟩` — the second component is checked like any other goal.',
      solution: 'exact ⟨4, rfl⟩',
    },
    {
      id: 'exists-elim',
      title: 'Using an existential',
      focus: 'rcases',
      summary: 'Unpack a witness and its proof',
      intro: `
To *use* a hypothesis \`h : ∃ n, p n\`, you give the witness a name and keep the
proof about it: \`rcases h with ⟨n, hn⟩\`. You do not get to choose \`n\` — it is
whatever the hypothesis says exists — which is exactly why the argument has to
work for an arbitrary one.

This lesson combines it with a \`∀\` hypothesis, turning \`p\` into \`q\`.
`,
      task: 'Turn the existential into one about `q`.',
      statement: 'example {p q : Nat → Prop} (h : ∃ n, p n) (hpq : ∀ n, p n → q n) : ∃ n, q n',
      placeholder: 'unpack the witness, then rebuild the claim',
      hint: '`rcases h with ⟨n, hn⟩` then `exact ⟨n, hpq n hn⟩`.',
      solution: 'rcases h with ⟨n, hn⟩\nexact ⟨n, hpq n hn⟩',
    },
  ],
};
