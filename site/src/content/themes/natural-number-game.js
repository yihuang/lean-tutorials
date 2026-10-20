// Theme: the natural number game, played with blocks.
//
// The material is the on-ramp to the course: each level is a small Lean goal,
// and instead of typing tactics the learner drags blocks into a stack. The page
// compiles those blocks to ordinary Lean and the same WebAssembly kernel checks
// the result, so the game teaches the real thing rather than a simulation of it.
//
// Inspired by Kevin Buzzard's Natural Number Game; the levels and prose here are
// written for this course.
export const naturalNumberGame = {
  id: 'natural-number-game',
  status: 'available',
  title: 'The natural number game',
  summary: 'Prove with blocks, from `rfl` to induction',
  intro: `
Seven short levels on the natural numbers. You build each proof by dragging
blocks from the palette into the workspace; the page turns that stack into
ordinary Lean 4 and checks it with the real kernel in your browser.

Nothing is hidden behind the blocks: the generated Lean is shown under the
workspace, and "Check proof" compiles exactly that text. Once the blocks feel
familiar, every one of these levels can also be solved by typing the same tactics
in the text editor.
`,
  topics: ['number-game'],
};
