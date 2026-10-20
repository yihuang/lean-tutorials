// Topic: the natural number game.
//
// Every lesson here is a *block* lesson: it declares a palette, the names that
// palette may mention (`lemmas`, `terms`, `vars`), an optional starter stack, and
// a solution stack. The mechanism compiles the stack to Lean text and checks it
// exactly like a typed tactic block, so the content never mentions Blockly.
export const numberGame = {
  id: 'number-game',
  title: 'Proofs from blocks',
  summary: 'Seven levels: build each proof from tactic blocks',
  intro: `
Start at the top. Each level gives you a Lean goal and a small palette of
tactics; drag a tactic into the proof and connect it where it belongs, until the
goal panel says nothing is left, then press **Check proof**.

The blocks are not a toy language. The panel under the workspace shows the Lean
they produce, and that text is what the kernel checks — the same two-pass check
the typing lessons use.
`,
  lessons: [
    {
      id: 'nng-refl',
      title: 'Level 1: computation',
      focus: 'rfl',
      summary: 'Two plus two is four, by definition',
      intro: `
\`2 + 2 = 4\` is true by *computation*: numerals are nested constructors, and
addition is defined by recursion on its second argument, so Lean can reduce both
sides to the same number.

\`rfl\` is the tactic that closes a goal when the two sides are definitionally
equal. It is not a check for "obviously true" — it is the kernel unfolding
definitions until the terms match.
`,
      task: 'Close the goal with the `rfl` block.',
      statement: 'example : 2 + 2 = 4',
      placeholder: 'drag the rfl block into the workspace',
      hint: 'One block is enough: `rfl`.',
      solution: 'rfl',
      blocks: {
        palette: ['rfl'],
        solution: [{ type: 'rfl' }],
      },
    },
    {
      id: 'nng-add-zero',
      title: 'Level 2: n + 0',
      focus: 'Nat.add',
      summary: 'A variable can still reduce',
      intro: `
\`n + 0 = n\` holds for every \`n\` because \`Nat.add\` is defined by recursion on
its **second** argument: \`n + 0\` reduces to \`n\` without knowing what \`n\` is.

That is why \`rfl\` still works here, even though \`n\` is a variable. Compare the
next level, where the interesting variable is on the other side.
`,
      task: 'Prove `n + 0 = n` with one block.',
      statement: 'example (n : Nat) : n + 0 = n',
      placeholder: 'drag the rfl block into the workspace',
      hint: '`rfl` — `n + 0` is definitionally `n`.',
      solution: 'rfl',
      blocks: {
        palette: ['rfl'],
        solution: [{ type: 'rfl' }],
      },
    },
    {
      id: 'nng-zero-add',
      title: 'Level 3: induction',
      focus: 'induction',
      summary: 'Zero plus n needs a proof, not computation',
      intro: `
\`0 + n = n\` does **not** reduce: \`Nat.add\` recurses on the second argument, and
\`n\` is unknown. The way in is induction on \`n\`, which gives two goals:

* \`0 + 0 = 0\`, closed by computation (\`rfl\`);
* \`0 + succ k = succ k\`, where you may assume \`ih : 0 + k = k\`.

In the successor case, \`Nat.add_succ\` unfolds \`0 + succ k\` to \`succ (0 + k)\`,
and then \`ih\` turns \`0 + k\` into \`k\`. Two rewrites, one per block.
`,
      task: 'Induct on `n`, then finish both branches.',
      statement: 'example (n : Nat) : 0 + n = n',
      placeholder: 'drag the induction block, then fill both branches',
      hint: 'The starter already splits on `n`. Base case `rfl`; successor case `rw [Nat.add_succ]` then `rw [ih]`.',
      solution: [
        'induction n with',
        '| zero =>',
        '  rfl',
        '| succ k ih =>',
        '  rw [Nat.add_succ]',
        '  rw [ih]',
      ].join('\n'),
      blocks: {
        palette: ['induction', 'rfl', 'rw'],
        lemmas: ['Nat.add_succ', 'ih'],
        vars: ['n'],
        starter: [{
          type: 'induction',
          fields: { var: 'n' },
          branches: { zero: [], succ: [] },
        }],
        solution: [{
          type: 'induction',
          fields: { var: 'n' },
          branches: {
            zero: [{ type: 'rfl' }],
            succ: [
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
              { type: 'rw', fields: { lemma: 'ih' } },
            ],
          },
        }],
      },
    },
    {
      id: 'nng-succ-add',
      title: 'Level 4: successor on the left',
      focus: 'Nat.add_succ',
      summary: 'Induct on the variable being recursed over',
      intro: `
\`Nat.succ a + b = Nat.succ (a + b)\` is \`succ a + b\` on the left, so the
recursion of \`Nat.add\` runs on \`b\`. Induct on \`b\`:

* \`succ a + 0 = succ (a + 0)\` is definitional;
* in the successor case, \`Nat.add_succ\` moves the \`succ\` outside on both sides,
  and the induction hypothesis finishes the job.

Inducting on the *right* variable is the point of this level.
`,
      task: 'Induct on `b` and rewrite with the successor rule.',
      statement: 'example (a b : Nat) : Nat.succ a + b = Nat.succ (a + b)',
      placeholder: 'the starter inducts on b; fill both branches',
      hint: 'Base case `rfl`. Successor case: `rw [Nat.add_succ]`, `rw [ih]`, then `rw [Nat.add_succ]` again for the right-hand side.',
      solution: [
        'induction b with',
        '| zero =>',
        '  rfl',
        '| succ k ih =>',
        '  rw [Nat.add_succ]',
        '  rw [ih]',
        '  rw [Nat.add_succ]',
      ].join('\n'),
      blocks: {
        palette: ['induction', 'rfl', 'rw'],
        lemmas: ['Nat.add_succ', 'ih'],
        vars: ['b'],
        starter: [{
          type: 'induction',
          fields: { var: 'b' },
          branches: { zero: [], succ: [] },
        }],
        solution: [{
          type: 'induction',
          fields: { var: 'b' },
          branches: {
            zero: [{ type: 'rfl' }],
            succ: [
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
              { type: 'rw', fields: { lemma: 'ih' } },
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
            ],
          },
        }],
      },
    },
    {
      id: 'nng-cases',
      title: 'Level 5: cases',
      focus: 'cases',
      summary: 'Split a number into its two constructors',
      intro: `
Sometimes you do not need an induction hypothesis, only the two shapes a
constructor can have: every natural number is \`0\` or \`succ k\`.

\`cases n with\` gives you those branches. In the zero branch, \`apply Or.inl\`
turns the disjunction into \`n = 0\`, and \`rfl\` closes it. In the successor
branch, \`apply Or.inr\` leaves \`∃ k, ...\`; **refine** with \`⟨k, ?_⟩\`
introduces the predecessor and leaves the equation as the next goal — one step at
a time, no two-hole pair to fill at once.
`,
      task: 'Split on `n`, then build each disjunct one step at a time.',
      statement: 'example (n : Nat) : n = 0 ∨ ∃ k, n = k + 1',
      placeholder: 'drag the cases block, then build each branch step by step',
      hint: 'Zero branch: `apply Or.inl`, then `rfl`. Successor branch: `apply Or.inr`, then `refine` with `⟨ , ⟩`, `name k` and the `?_` hole; the equation becomes the goal, and `rfl` closes it.',
      solution: [
        'cases n with',
        '| zero =>',
        '  apply Or.inl',
        '  rfl',
        '| succ k =>',
        '  apply Or.inr',
        '  refine ⟨k, ?_⟩',
        '  rfl',
      ].join('\n'),
      blocks: {
        palette: ['cases', 'apply', 'refine', 'term_pair', 'term_var', 'term_hole', 'rfl'],
        lemmas: ['Or.inl', 'Or.inr'],
        names: ['k'],
        vars: ['n'],
        starter: [],
        solution: [{
          type: 'cases',
          fields: { var: 'n' },
          branches: {
            zero: [
              { type: 'apply', fields: { lemma: 'Or.inl' } },
              { type: 'rfl' },
            ],
            succ: [
              { type: 'apply', fields: { lemma: 'Or.inr' } },
              {
                type: 'refine',
                inputs: [{
                  type: 'term_pair',
                  inputs: [
                    { type: 'term_var', fields: { name: 'k' } },
                    { type: 'term_hole' },
                  ],
                }],
              },
              { type: 'rfl' },
            ],
          },
        }],
      },
    },
    {
      id: 'nng-add-comm',
      title: 'Level 6: commutativity',
      focus: 'Nat.succ_add',
      summary: 'Chain three rewrites in the successor case',
      intro: `
\`a + b = b + a\` needs induction **and** both directions of the successor rule:
\`Nat.add_succ\` (on the second argument) and \`Nat.succ_add\` (on the first).

Induct on \`a\`. The base case moves \`0\` out of the way with \`Nat.zero_add\` and
\`Nat.add_zero\`. The successor case pulls \`succ\` out of \`succ k + b\`, applies the
induction hypothesis, and pushes it back into \`b + succ k\`.
`,
      task: 'Induct on `a`; the successor case needs three rewrites.',
      statement: 'example (a b : Nat) : a + b = b + a',
      placeholder: 'the starter inducts on a; fill both branches',
      hint: 'Base: `rw [Nat.zero_add]`, `rw [Nat.add_zero]`. Successor: `rw [Nat.succ_add]`, `rw [ih]`, `rw [Nat.add_succ]`.',
      solution: [
        'induction a with',
        '| zero =>',
        '  rw [Nat.zero_add]',
        '  rw [Nat.add_zero]',
        '| succ k ih =>',
        '  rw [Nat.succ_add]',
        '  rw [ih]',
        '  rw [Nat.add_succ]',
      ].join('\n'),
      blocks: {
        palette: ['induction', 'rw'],
        lemmas: ['Nat.zero_add', 'Nat.add_zero', 'Nat.succ_add', 'Nat.add_succ', 'ih'],
        vars: ['a'],
        starter: [{
          type: 'induction',
          fields: { var: 'a' },
          branches: { zero: [], succ: [] },
        }],
        solution: [{
          type: 'induction',
          fields: { var: 'a' },
          branches: {
            zero: [
              { type: 'rw', fields: { lemma: 'Nat.zero_add' } },
              { type: 'rw', fields: { lemma: 'Nat.add_zero' } },
            ],
            succ: [
              { type: 'rw', fields: { lemma: 'Nat.succ_add' } },
              { type: 'rw', fields: { lemma: 'ih' } },
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
            ],
          },
        }],
      },
    },
    {
      id: 'nng-add-assoc',
      title: 'Level 7: associativity',
      focus: 'Nat.add_zero',
      summary: 'The same rewrite, twice',
      intro: `
\`a + b + c = a + (b + c)\` is the last level, and the one where you have to
look at the whole goal: a \`rw\` block rewrites **one** occurrence at a time.
When the same shape appears on both sides — a \`+ 0\` in the base case, a
\`+ succ\` in the successor case — you reach for the same block twice.

Induct on \`c\`. The base case needs \`rw [Nat.add_zero]\` twice, once for each
\`+ 0\`; the successor case pulls \`succ\` out with \`rw [Nat.add_succ]\`, uses
the induction hypothesis, and then pushes it out again on the right.
`,
      task: 'Induct on `c`; the same lemma is needed on each side.',
      statement: 'example (a b c : Nat) : a + b + c = a + (b + c)',
      placeholder: 'the starter inducts on c; fill both branches',
      hint: 'Base: `rw [Nat.add_zero]` twice. Successor: `rw [Nat.add_succ]`, `rw [ih]`, then `rw [Nat.add_succ]` twice on the right.',
      solution: [
        'induction c with',
        '| zero =>',
        '  rw [Nat.add_zero]',
        '  rw [Nat.add_zero]',
        '| succ k ih =>',
        '  rw [Nat.add_succ]',
        '  rw [ih]',
        '  rw [Nat.add_succ]',
        '  rw [Nat.add_succ]',
      ].join('\n'),
      blocks: {
        palette: ['induction', 'rw'],
        lemmas: ['Nat.add_zero', 'Nat.add_succ', 'ih'],
        vars: ['c'],
        starter: [{
          type: 'induction',
          fields: { var: 'c' },
          branches: { zero: [], succ: [] },
        }],
        solution: [{
          type: 'induction',
          fields: { var: 'c' },
          branches: {
            zero: [
              { type: 'rw', fields: { lemma: 'Nat.add_zero' } },
              { type: 'rw', fields: { lemma: 'Nat.add_zero' } },
            ],
            succ: [
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
              { type: 'rw', fields: { lemma: 'ih' } },
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
              { type: 'rw', fields: { lemma: 'Nat.add_succ' } },
            ],
          },
        }],
      },
    },
  ],
};
