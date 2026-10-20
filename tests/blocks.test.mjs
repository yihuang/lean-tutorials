// The block layer's own contract: a block program is data, compiling it is a
// pure text transformation, and every shipped block lesson compiles to exactly
// the Lean solution its lesson declares.
//
// No browser, no Blockly: the editor's job is to produce the same tree this test
// feeds the compiler, so if the compiler is right and the shipped solutions
// agree with it, the only remaining risk is the generated Lean itself — which
// tests/browser-check.mjs puts in front of the real kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCK_SPECS, BlockProgramError, compileBlocks, lineOfBlock } from '../site/src/lean/blocks.js';
import { LESSONS } from '../site/src/content/index.js';

const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();

test('a single block compiles to its tactic', () => {
  assert.deepEqual(compileBlocks([{ type: 'rfl' }]).lines, [
    { text: 'rfl', blockId: null, depth: 0 },
  ]);
  assert.equal(compileBlocks([{ type: 'rw', fields: { lemma: 'Nat.add_succ' } }]).code, 'rw [Nat.add_succ]');
  assert.equal(compileBlocks([{ type: 'rw_back', fields: { lemma: 'Nat.add_comm' } }]).code, 'rw [← Nat.add_comm]');
  assert.equal(
    compileBlocks([{
      type: 'exact',
      inputs: [{ type: 'term_or_inl', inputs: [{ type: 'term_rfl' }] }],
    }]).code,
    'exact Or.inl (rfl)',
  );
  assert.equal(
    compileBlocks([{
      type: 'refine',
      inputs: [{
        type: 'term_pair',
        inputs: [
          { type: 'term_var', fields: { name: 'k' } },
          { type: 'term_hole' },
        ],
      }],
    }]).code,
    'refine ⟨k, ?_⟩',
  );
  assert.equal(
    compileBlocks([{
      type: 'exact',
      inputs: [{
        type: 'term_or_inr',
        inputs: [{
          type: 'term_pair',
          inputs: [
            { type: 'term_var', fields: { name: 'k' } },
            { type: 'term_rfl' },
          ],
        }],
      }],
    }]).code,
    'exact Or.inr (⟨k, rfl⟩)',
  );
});

test('induction nests both branches and keeps indentation', () => {
  const { code, lines } = compileBlocks([{
    type: 'induction',
    id: 'i1',
    fields: { var: 'n' },
    branches: {
      zero: [{ type: 'rfl', id: 'z1' }],
      succ: [
        { type: 'rw', id: 's1', fields: { lemma: 'Nat.add_succ' } },
        { type: 'rw', id: 's2', fields: { lemma: 'ih' } },
      ],
    },
  }]);
  assert.equal(code, [
    'induction n with',
    '| zero =>',
    '  rfl',
    '| succ k ih =>',
    '  rw [Nat.add_succ]',
    '  rw [ih]',
  ].join('\n'));
  assert.equal(lines[2].blockId, 'z1');
  assert.equal(lines[4].blockId, 's1');
  assert.equal(lineOfBlock(lines, 's2'), 5);
});

test('an empty branch becomes skip, so the file still parses', () => {
  const { code } = compileBlocks([{
    type: 'cases',
    id: 'c1',
    fields: { var: 'n' },
    branches: { zero: [], succ: [{ type: 'rfl' }] },
  }]);
  assert.match(code, /\| zero =>\n {2}skip/);
});

test('a malformed program names the block it cannot compile', () => {
  assert.throws(() => compileBlocks([{ type: 'nope', id: 'b1' }]), BlockProgramError);
  assert.throws(
    () => compileBlocks([{ type: 'rw', id: 'b2', fields: { lemma: '  ' } }]),
    (error) => error instanceof BlockProgramError && error.blockId === 'b2' && /needs a lemma/.test(error.message),
  );
  assert.throws(() => compileBlocks('nope'), BlockProgramError);
});

test('every block lesson compiles, and its blocks match the declared sources', () => {
  const lessons = LESSONS.filter((lesson) => lesson.blocks);
  assert.ok(lessons.length >= 5, 'the natural number game ships several levels');

  const walkTerm = (lesson, node) => {
    assert.equal(BLOCK_SPECS[node.type]?.kind, 'term', `${lesson.id}: ${node.type} is not a term block`);
    assert.ok(lesson.blocks.palette.includes(node.type), `${lesson.id}: ${node.type} is not in the palette`);
    for (const field of BLOCK_SPECS[node.type].fields ?? []) {
      const value = node.fields?.[field.name];
      if (field.source === 'names') assert.ok(lesson.blocks.names?.includes(value), `${lesson.id}: undeclared name ${value}`);
    }
    (BLOCK_SPECS[node.type].inputs ?? []).forEach((input, index) => {
      const child = node.inputs?.[index];
      assert.ok(child, `${lesson.id}: ${node.type} is missing its ${input.name}`);
      walkTerm(lesson, child);
    });
  };

  const walk = (lesson, stack) => {
    for (const node of stack) {
      assert.ok(BLOCK_SPECS[node.type], `${lesson.id}: unknown block type ${node.type}`);
      assert.ok(lesson.blocks.palette.includes(node.type), `${lesson.id}: ${node.type} is not in the palette`);
      for (const field of BLOCK_SPECS[node.type].fields ?? []) {
        const value = node.fields?.[field.name];
        if (field.source === 'lemmas') assert.ok(lesson.blocks.lemmas?.includes(value), `${lesson.id}: undeclared lemma ${value}`);
        if (field.source === 'names') assert.ok(lesson.blocks.names?.includes(value), `${lesson.id}: undeclared name ${value}`);
        if (field.source === 'vars') assert.ok(lesson.blocks.vars?.includes(value), `${lesson.id}: undeclared variable ${value}`);
      }
      (BLOCK_SPECS[node.type].inputs ?? []).forEach((input, index) => {
        const child = node.inputs?.[index];
        assert.ok(child, `${lesson.id}: ${node.type} is missing its ${input.name}`);
        walkTerm(lesson, child);
      });
      for (const branch of BLOCK_SPECS[node.type].branches ?? []) {
        walk(lesson, node.branches?.[branch.key] ?? []);
      }
    }
  };

  for (const lesson of lessons) {
    const compiled = compileBlocks(lesson.blocks.solution);
    assert.ok(compiled.code.trim() !== '', `${lesson.id}: the block solution is empty`);
    assert.equal(normalize(compiled.code), normalize(lesson.solution),
      `${lesson.id}: blocks compile to different Lean than the lesson's solution`);
    walk(lesson, lesson.blocks.solution);
    if (lesson.blocks.starter) {
      walk(lesson, lesson.blocks.starter);
    }
    assert.ok(!/sorry|admit/.test(compiled.code), `${lesson.id}: the solution must not use sorry`);
  }
});

test('the Blockly version the loader asks for is the dependency version', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const editor = readFileSync(join(root, 'site', 'src', 'ui', 'blocks-editor.js'), 'utf8');
  const version = /BLOCKLY_VERSION = '([^']+)'/.exec(editor)?.[1];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependency = pkg.devDependencies?.blockly ?? pkg.dependencies?.blockly;
  assert.ok(version, 'blocks-editor.js should export BLOCKLY_VERSION');
  assert.ok(dependency, 'package.json should pin blockly');
  assert.equal(dependency.replace(/^[^0-9]*/, ''), version);
});

test('a term block is an expression: it needs its input and cannot be a tactic', () => {
  assert.throws(
    () => compileBlocks([{ type: 'exact', inputs: [] }]),
    (error) => error instanceof BlockProgramError && /needs its proof term/.test(error.message),
  );
  assert.throws(
    () => compileBlocks([{ type: 'term_rfl' }]),
    (error) => error instanceof BlockProgramError && /cannot stand where a tactic/.test(error.message),
  );
});
