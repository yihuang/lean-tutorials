// A block program → ordinary Lean tactics.
//
// This is the mechanism half of the Blockly proof game. A *block program* is
// plain data: an array of nodes, each `{ type, fields, branches }`, where
// `branches` holds the statement stacks nested inside an induction or case
// split. The data is what content writes down, what the editor saves in
// localStorage, and what the Blockly workspace is converted to and from — one
// shape, three uses.
//
// Compiling is deliberately a text transformation and nothing more:
//
//   [{ type: 'induction', fields: { var: 'n' }, branches: {
//        zero: [{ type: 'rfl' }],
//        succ: [{ type: 'rw', fields: { lemma: 'Nat.add_succ' } }] } }]
//
// becomes
//
//   induction n with
//   | zero =>
//     rfl
//   | succ k ih =>
//     rw [Nat.add_succ]
//
// The output is *ordinary Lean source*, not a special proof format, so it goes
// through the same `buildSource` + two-pass kernel check as text typed into the
// editor. There is no second checker and no trusting of the block layer: if the
// generated Lean is wrong, Lean says so.
//
// No DOM, no Blockly and no content import here — the Blockly definitions in
// src/ui/blocks-editor.js are built from the same BLOCK_SPECS table, which is
// what keeps "what a block means" in one place.

/** A block program that cannot be compiled, with the block to blame when known. */
export class BlockProgramError extends Error {
  constructor(message, blockId = null) {
    super(message);
    this.name = 'BlockProgramError';
    this.blockId = blockId;
  }
}

/**
 * The tactics a learner can assemble. `template` is Lean with `%1`, `%2`, …
 * placeholders for `fields`; `branches` is what makes a block hold nested
 * stacks (both constructors of `Nat`, so far).
 *
 * `group` only groups the palette; the compiler never reads it.
 */
export const BLOCK_SPECS = {
  rfl: {
    group: 'tactics',
    label: 'rfl',
    tooltip: 'Close the goal because both sides are definitionally equal.',
    template: 'rfl',
    fields: [],
  },
  simp: {
    group: 'tactics',
    label: 'simp',
    tooltip: 'Simplify the goal using the lemmas Lean already knows.',
    template: 'simp',
    fields: [],
  },
  constructor: {
    group: 'tactics',
    label: 'constructor',
    tooltip: 'Split a goal whose type is a conjunction, iff, or existential pair.',
    template: 'constructor',
    fields: [],
  },
  apply: {
    group: 'tactics',
    label: 'apply',
    tooltip: 'Apply a constructor or lemma to the goal; its premises become new goals.',
    template: 'apply %1',
    fields: [{ name: 'lemma', source: 'lemmas', label: 'lemma', default: '' }],
  },
  refine: {
    group: 'tactics',
    label: 'refine',
    tooltip: 'Refine the goal with a term; holes in the term become new goals.',
    template: 'refine %1',
    fields: [],
    inputs: [{ name: 'term', label: 'term' }],
  },
  intro: {
    group: 'tactics',
    label: 'intro',
    tooltip: 'Move a forall-bound variable or an implication premise into the context.',
    template: 'intro %1',
    fields: [{ name: 'name', source: 'binders', label: 'name', default: 'h' }],
  },
  exact: {
    group: 'terms',
    label: 'exact',
    tooltip: 'Close the goal with a proof term, built from the term blocks.',
    template: 'exact %1',
    fields: [],
    inputs: [{ name: 'term', label: 'proof term' }],
  },
  rw: {
    group: 'rewriting',
    label: 'rewrite',
    tooltip: 'Rewrite the goal left-to-right with this lemma or hypothesis.',
    template: 'rw [%1]',
    fields: [{ name: 'lemma', source: 'lemmas', label: 'lemma', default: '' }],
  },
  rw_back: {
    group: 'rewriting',
    label: 'rewrite ←',
    tooltip: 'Rewrite the goal right-to-left with this lemma or hypothesis.',
    template: 'rw [\u2190 %1]',
    fields: [{ name: 'lemma', source: 'lemmas', label: 'lemma', default: '' }],
  },
  induction: {
    group: 'induction',
    label: 'induction',
    tooltip: 'Prove the goal for zero and for a successor, with an induction hypothesis.',
    template: 'induction %1 with',
    fields: [{ name: 'var', source: 'vars', label: 'variable', default: '' }],
    branches: [
      { key: 'zero', label: 'zero', binders: [] },
      {
        key: 'succ',
        label: 'succ',
        binders: [
          { name: 'succ', default: 'k', label: 'predecessor' },
          { name: 'ih', default: 'ih', label: 'induction hypothesis' },
        ],
      },
    ],
  },
  cases: {
    group: 'induction',
    label: 'cases',
    tooltip: 'Split a natural number into zero and a successor.',
    template: 'cases %1 with',
    fields: [{ name: 'var', source: 'vars', label: 'variable', default: '' }],
    branches: [
      { key: 'zero', label: 'zero', binders: [] },
      {
        key: 'succ',
        label: 'succ',
        binders: [{ name: 'succ', default: 'k', label: 'predecessor' }],
      },
    ],
  },

  // Term blocks compose through value inputs. `exact`/`refine` take one of these;
  // the constructors take terms, so `Or.inr ⟨k, rfl⟩` is built from four small
  // blocks rather than picked as one canned string.
  term_rfl: {
    kind: 'term',
    group: 'terms',
    label: 'rfl term',
    tooltip: 'The reflexivity proof term.',
    template: 'rfl',
    fields: [],
  },
  term_hole: {
    kind: 'term',
    group: 'terms',
    label: '?_',
    tooltip: 'A hole: the goal this hole must prove becomes a new subgoal.',
    template: '?_',
    fields: [],
  },
  term_var: {
    kind: 'term',
    group: 'terms',
    label: 'name',
    tooltip: 'A variable or hypothesis from the context.',
    template: '%1',
    fields: [{ name: 'name', source: 'names', label: 'name', default: '' }],
  },
  term_or_inl: {
    kind: 'term',
    group: 'terms',
    label: 'Or.inl',
    tooltip: 'The left disjunct: a proof of the left side.',
    template: 'Or.inl (%1)',
    inputs: [{ name: 'term', label: 'proof' }],
  },
  term_or_inr: {
    kind: 'term',
    group: 'terms',
    label: 'Or.inr',
    tooltip: 'The right disjunct: a proof of the right side.',
    template: 'Or.inr (%1)',
    inputs: [{ name: 'term', label: 'proof' }],
  },
  term_pair: {
    kind: 'term',
    group: 'terms',
    label: '⟨ , ⟩',
    tooltip: 'An anonymous constructor pair, for and/exists goals.',
    template: '⟨%1, %2⟩',
    inputs: [{ name: 'left', label: 'first' }, { name: 'right', label: 'second' }],
  },
};

/** Palette grouping: label and colour, used only by the editor. */
export const BLOCK_GROUPS = {
  tactics: { label: 'Tactics', colour: '#3f6a92' },
  rewriting: { label: 'Rewriting', colour: '#6f4f9b' },
  induction: { label: 'Induction', colour: '#8a5a2e' },
  terms: { label: 'Terms', colour: '#2f6f52' },
};

const fill = (template, values, node) => {
  let text = template;
  values.forEach((value, index) => {
    text = text.split(`%${index + 1}`).join(value);
  });
  if (/%\d/.test(text)) {
    throw new BlockProgramError(`block "${node.type}" is missing a field`, node.id ?? null);
  }
  return text;
};

const fieldValue = (node, field, { soft = false } = {}) => {
  const raw = node.fields?.[field.name];
  const value = String(raw ?? field.default ?? '').trim();
  if (value === '' && !soft) {
    throw new BlockProgramError(
      `the "${node.type}" block needs a ${field.label ?? field.name}`,
      node.id ?? null,
    );
  }
  return value;
};

const branchBinders = (node, branch) => (branch.binders ?? []).map((binder) => {
  const value = String(node.fields?.[binder.name] ?? binder.default ?? '').trim();
  if (value === '') {
    throw new BlockProgramError(
      `the ${branch.label} of this "${node.type}" block needs a name`,
      node.id ?? null,
    );
  }
  return value;
});

/**
 * Compile a block program into a Lean tactic block.
 *
 * @param {Array<{type: string, id?: string, fields?: Record<string, string>,
 *                inputs?: Array<object|null>, branches?: Record<string, Array<object>>}>} program
 * @returns {{code: string, lines: {text: string, blockId: string|null, depth: number}[]}}
 *          `lines` keeps the source line of every tactic, which is how a Lean
 *          error on line N becomes a warning on the block that produced it.
 */
export function compileBlocks(program) {
  if (!Array.isArray(program)) {
    throw new BlockProgramError('a block program must be an array of blocks');
  }

  /** @type {{text: string, blockId: string|null, depth: number}[]} */
  const lines = [];

  const emitStack = (stack, depth) => {
    if (stack === undefined || stack === null) return;
    if (!Array.isArray(stack)) throw new BlockProgramError('a branch must be a stack of blocks');
    for (const node of stack) emitNode(node, depth);
  };

  /** Compile the value-input children of a node, in the spec's input order. */
  function compileInputs(node, spec) {
    return (spec.inputs ?? []).map((input, index) => {
      const child = node.inputs?.[index];
      if (!child) {
        throw new BlockProgramError(
          `the "${node.type}" block needs its ${input.label ?? input.name} filled in`,
          node.id ?? null,
        );
      }
      return compileTerm(child);
    });
  }

  /** A term block is an expression, not a line: it nests through value inputs. */
  function compileTerm(node) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
      throw new BlockProgramError('a term is missing its block type');
    }
    const spec = BLOCK_SPECS[node.type];
    if (!spec) throw new BlockProgramError(`unknown block type "${node.type}"`, node.id ?? null);
    if (spec.kind !== 'term') {
      throw new BlockProgramError(`the "${node.type}" block is not a term`, node.id ?? null);
    }
    const fields = (spec.fields ?? []).map((field) => fieldValue(node, field));
    return fill(spec.template, [...fields, ...compileInputs(node, spec)], node);
  }

  const emitNode = (node, depth) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
      throw new BlockProgramError('a block is missing its type');
    }
    const spec = BLOCK_SPECS[node.type];
    if (!spec) throw new BlockProgramError(`unknown block type "${node.type}"`, node.id ?? null);
    if (spec.kind === 'term') {
      throw new BlockProgramError(`the "${node.type}" term cannot stand where a tactic is expected`, node.id ?? null);
    }

    const pad = '  '.repeat(depth);
    const blockId = node.id ?? null;
    const fields = (spec.fields ?? []).map((field) => fieldValue(node, field));
    lines.push({ text: `${pad}${fill(spec.template, [...fields, ...compileInputs(node, spec)], node)}`, blockId, depth });

    for (const branch of spec.branches ?? []) {
      const binders = branchBinders(node, branch);
      lines.push({ text: `${pad}| ${[branch.key, ...binders].join(' ')} =>`, blockId, depth });
      const body = node.branches?.[branch.key] ?? [];
      if (body.length === 0) {
        // An empty branch is not a Lean error, it is an unfinished proof: `skip`
        // keeps the generated file parseable so the goal panel can show what is
        // left (the tracer closes it with an axiom in the inspection pass).
        lines.push({ text: `${pad}  skip`, blockId, depth: depth + 1 });
      } else {
        emitStack(body, depth + 1);
      }
    }
  };

  emitStack(program, 0);
  return { code: lines.map((line) => line.text).join('\n'), lines };
}

/** The first source line a block produced, for mapping goals back to blocks. */
export function lineOfBlock(lines, blockId) {
  return lines.findIndex((line) => line.blockId === blockId);
}
