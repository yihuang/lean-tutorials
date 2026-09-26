// Topic: asking Lean questions. These lessons are whole-file exercises (kind
// 'file'), because `#check` and `#eval` are commands, not tactics.
export const tools = {
  id: 'tools',
  title: 'Asking Lean',
  summary: 'Hands-on with #check, #eval and your own definitions',
  intro: `
The fastest way to learn Lean is to interrogate it. These three lessons are not
about proving anything: you write a whole file, run it, and read what Lean says
back.

There is no statement to fill in here, so the editor is yours — and so is the
output panel.
`,
  lessons: [
    {
      id: 'check',
      title: 'What does Lean know?',
      focus: '#check',
      summary: 'Ask for the type of any name',
      intro: `
\`#check\` prints the type of a term — a lemma, a definition, a function. It costs
nothing and answers the question you will have a hundred times a day: *what is
this thing called, and what does it say?*

Write a \`#check\` for \`Nat.add_comm\` and look at the output panel.
`,
      kind: 'file',
      task: 'Ask Lean for the type of `Nat.add_comm`.',
      placeholder: '#check …',
      hint: 'A file containing just `#check Nat.add_comm` is enough.',
      require: ['#check Nat.add_comm'],
      expects: ['Nat.add_comm'],
      solution: '#check Nat.add_comm',
    },
    {
      id: 'eval',
      title: 'Making Lean compute',
      focus: '#eval',
      summary: 'Evaluate an expression and print it',
      intro: `
\`#eval\` runs an expression and prints the result. Unlike a proof, this is not
about truth: it is a calculator, and it is how you check what a definition
actually does.

The task: raise 2 to the tenth power and let Lean show you the number.
`,
      kind: 'file',
      task: 'Make Lean print `1024` by raising `2` to a power.',
      placeholder: '#eval …',
      hint: 'Powers use `^`, as in `#eval 2 ^ 10`.',
      require: ['#eval', '^'],
      expects: ['1024'],
      solution: '#eval 2 ^ 10',
    },
    {
      id: 'define',
      title: 'Your own definition',
      focus: 'def',
      summary: 'Define a function, then use it',
      intro: `
A \`def\` names a value or function. Nothing here is exotic: \`def double (n : Nat) := 2 * n\`
binds the name \`double\`, and after that it behaves like any library function —
you can \`#eval\` it, \`#check\` it, and use it in proofs.

Define \`double\` and make Lean print \`42\` by applying it.
`,
      kind: 'file',
      task: 'Define `double` and use it to print `42`.',
      placeholder: 'def … then #eval …',
      hint: '`def double (n : Nat) := 2 * n` and then `#eval double 21`.',
      require: ['def double', 'double 21'],
      expects: ['42'],
      solution: 'def double (n : Nat) := 2 * n\n\n#eval double 21',
    },
  ],
};
