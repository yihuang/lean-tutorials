// Topic: what a proof is, and the three moves every Lean proof starts from.
export const foundations = {
  id: 'foundations',
  title: 'How proofs work',
  summary: 'Proofs are values, assumptions are functions',
  intro: `
Lean's whole idea fits in one sentence: **a proof is a value, and a proposition is
its type**. Everything in this topic follows from that.

You will meet the three moves that most Lean proofs are built from — close a goal by
computation, hand the goal a value you already have, and turn an assumption into
something usable — plus the habit of reasoning backwards from the goal.
`,
  lessons: [
    {
      id: 'rfl',
      title: 'A proof is a value',
      focus: 'rfl',
      summary: 'Prove a goal that is true by computation',
      intro: `
In Lean a proof is a term, exactly like a number or a function: to prove
\`1 + 1 = 2\` you write down something whose *type* is \`1 + 1 = 2\`.

The tactic \`rfl\` says: **both sides of the goal are the same after
computation**. Lean evaluates \`1 + 1\` down to \`2\` and accepts.

Notice what is missing: there is no "trust me". The kernel re-checks the term
\`rfl\` produces, on your machine, in your browser.
`,
      task: 'Close the goal with a single tactic.',
      statement: 'example : 1 + 1 = 2',
      placeholder: 'write the tactic that closes this goal',
      hint: 'The tactic is called `rfl` (short for *reflexivity*). Type it and press **Check**.',
      solution: 'rfl',
    },
    {
      id: 'exact',
      title: 'Use what you already have',
      focus: 'exact',
      summary: 'Hand a hypothesis to the goal',
      intro: `
Every goal comes with a context: the things you already know. In the panel
below the editor, everything above the turnstile \`⊢\` is available, and
everything to its right is what you must produce.

Here \`hp\` *is* a proof of \`p\`, so the goal is already solved — you just have
to pass it along.
`,
      task: 'Use the hypothesis `hp` to close the goal.',
      statement: 'example (p : Prop) (hp : p) : p',
      placeholder: 'use the hypothesis `hp`',
      hint: '`exact hp` — `exact` wants a term whose type is exactly the goal.',
      solution: 'exact hp',
    },
    {
      id: 'intro',
      title: 'Implications are functions',
      focus: 'intro',
      summary: 'Assume the left side of an arrow',
      intro: `
\`p → q\` is not a statement about truth tables: it is the **function type**
from proofs of \`p\` to proofs of \`q\`. To prove one you take an arbitrary
proof of the left side and build a proof of the right side.

\`intro\` does exactly that, moving the assumption into your context.

The goal here is \`p → q → p\`, which is the type of the function that throws
away its second argument.
`,
      task: 'Introduce both assumptions, then produce `p`.',
      statement: 'example {p q : Prop} : p → q → p',
      placeholder: 'introduce the assumptions, then produce `p`',
      hint: '`intro hp hq` puts both assumptions in the context; `exact hp` finishes.',
      solution: 'intro hp hq\nexact hp',
    },
    {
      id: 'apply',
      title: 'Reason backwards',
      focus: 'apply',
      summary: 'Match a hypothesis conclusion against the goal',
      intro: `
Forward reasoning chains facts together. Lean proofs are usually written the
other way round: look at the goal, find a lemma whose *conclusion* matches it,
and turn the goal into that lemma's assumptions.

You have \`h : p → q\` and the goal is \`q\`. \`apply h\` matches the conclusion
of \`h\` with the goal and leaves you with \`p\` to prove.
`,
      task: 'Prove `q` using `h`.',
      statement: 'example {p q : Prop} (hp : p) (h : p → q) : q',
      placeholder: 'apply a hypothesis, then prove what is left',
      hint: '`apply h` changes the goal to `p`, and `hp` proves it.',
      solution: 'apply h\nexact hp',
    },
  ],
};
