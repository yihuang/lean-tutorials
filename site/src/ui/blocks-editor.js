// The Blockly proof editor.
//
// Blockly is loaded lazily, and only on a lesson whose content declares
// `blocks`: the 640 KB editor must not be on the critical path of a text lesson.
// The workspace is converted to the block program defined in ../lean/blocks.js
// (one tree shape for content, storage and the compiler), so this module never
// knows how a block becomes Lean — it only builds the blocks and hands the tree
// over.
//
// No content import: the lesson arrives as data (`lesson.blocks`), and the
// palette is read from that declaration.

import { h } from './dom.js';
import { BLOCK_GROUPS, BLOCK_SPECS, compileBlocks } from '../lean/blocks.js';

/** Keep in sync with the `blockly` dependency (tests/unit asserts it). */
export const BLOCKLY_VERSION = '13.4.0';
const BLOCKLY_BASE = '/vendor/blockly';

let blocklyPromise = null;
let darkTheme = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(script);
  });
}

/** Load Blockly once, in order: core first, then the English messages. */
export function loadBlockly() {
  if (globalThis.Blockly) return Promise.resolve(globalThis.Blockly);
  if (!blocklyPromise) {
    blocklyPromise = loadScript(`${BLOCKLY_BASE}/blockly_compressed.js?v=${BLOCKLY_VERSION}`)
      .then(() => loadScript(`${BLOCKLY_BASE}/msg/en.js?v=${BLOCKLY_VERSION}`))
      .then(() => {
        if (!globalThis.Blockly) throw new Error('Blockly loaded but did not install its global');
        return globalThis.Blockly;
      })
      .catch((error) => {
        blocklyPromise = null; // a later attempt may succeed (a stale cache, a flaky proxy)
        throw error;
      });
  }
  return blocklyPromise;
}

const isDark = () => Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
const isNarrow = () => Boolean(globalThis.matchMedia?.('(max-width: 599px)').matches);

function themeFor(Blockly) {
  if (!isDark()) return Blockly.Themes.Zelos;
  if (darkTheme) return darkTheme;
  darkTheme = Blockly.Theme.defineTheme('lean-dark', {
    base: Blockly.Themes.Zelos,
    componentStyles: {
      workspaceBackgroundColour: '#0f1115',
      flyoutBackgroundColour: '#1b2029',
      flyoutForegroundColour: '#e7e4df',
      flyoutOpacity: 0.97,
      scrollbarColour: '#3a4150',
      insertionMarkerColour: '#7aa2f7',
      insertionMarkerOpacity: 0.45,
    },
  });
  return darkTheme;
}

function fieldArg(field, config) {
  const name = field.name.toUpperCase();
  const options = config[field.source] ?? [];
  if (options.length === 0) {
    return { type: 'field_input', name, text: field.default ?? '' };
  }
  return {
    type: 'field_dropdown',
    name,
    options: options.map((value) => [value, value]),
  };
}

const binderArg = (binder) => ({
  type: 'field_input',
  name: binder.name.toUpperCase(),
  text: binder.default ?? '',
});

const valueArg = (input) => ({
  type: 'input_value',
  name: input.name.toUpperCase(),
  check: 'LeanTerm',
});

/** Build the Blockly JSON definition for one palette entry. */
function definitionFor(type, config) {
  const spec = BLOCK_SPECS[type];
  if (!spec) return null;
  const args = [
    ...(spec.fields ?? []).map((field) => fieldArg(field, config)),
    ...(spec.inputs ?? []).map(valueArg),
  ];
  const definition = {
    type: `lean_${type}`,
    colour: BLOCK_GROUPS[spec.group]?.colour ?? BLOCK_GROUPS.tactics.colour,
    tooltip: spec.tooltip,
  };
  // Term blocks are expressions: they have an output plug and no statement
  // connection, so they only make sense nested in an `exact`/`refine` value input.
  if (spec.kind === 'term') {
    definition.output = 'LeanTerm';
    definition.message0 = spec.message ?? spec.template;
    definition.args0 = args;
    return definition;
  }
  definition.previousStatement = null;
  definition.nextStatement = null;
  if (spec.branches) {
    const [zero, succ] = spec.branches;
    // Compact rows on purpose: a phone-width workspace is ~300 px, and a block
    // with a sentence in it is a block the learner cannot see or drag.
    definition.message0 = `${spec.label} %1`;
    definition.args0 = (spec.fields ?? []).map((field) => fieldArg(field, config));
    definition.message1 = `${zero.label} %1`;
    definition.args1 = [{ type: 'input_statement', name: zero.key.toUpperCase() }];
    // `succ k ih [stack]` — the field inputs are the names, the last notch is
    // the branch body. Two rows, no prose.
    definition.message2 = `${succ.label} ${succ.binders.map((_, index) => `%${index + 1}`).join(' ')} %${succ.binders.length + 1}`;
    definition.args2 = [...succ.binders.map(binderArg), { type: 'input_statement', name: succ.key.toUpperCase() }];
    return definition;
  }
  definition.message0 = spec.message ?? spec.template;
  definition.args0 = args;
  return definition;
}


/**
 * The palette is a real Blockly toolbox with one category. With
 * `horizontalLayout: true` Blockly lays the category bar and its flyout across
 * the top of the canvas, so the blocks keep their shapes, are draggable, and do
 * not eat the horizontal space of a side flyout.
 */
function toolboxFor(config) {
  const types = config.palette.filter((type) => BLOCK_SPECS[type]);
  return {
    kind: 'categoryToolbox',
    contents: [{
      kind: 'category',
      name: 'Blocks',
      colour: BLOCK_GROUPS.tactics.colour,
      contents: types.map((type) => ({ kind: 'block', type: `lean_${type}` })),
    }],
  };
}

/** Blockly workspace JSON → the compact block program content writes. */
function readFields(block, spec) {
  const fields = {};
  for (const field of spec.fields ?? []) {
    fields[field.name] = String(block.getFieldValue(field.name.toUpperCase()) ?? '').trim();
  }
  return fields;
}

function readTerm(block) {
  if (!block) return null;
  const type = String(block.type).replace(/^lean_/, '');
  const spec = BLOCK_SPECS[type];
  if (!spec || spec.kind !== 'term') {
    throw new Error(`"${type}" is not a term block`);
  }
  const node = { type, id: block.id, fields: readFields(block, spec) };
  if (spec.inputs) {
    node.inputs = spec.inputs.map((input) => readTerm(block.getInputTargetBlock(input.name.toUpperCase())));
  }
  return node;
}

function readStack(first) {
  const stack = [];
  for (let block = first; block; block = block.getNextBlock()) {
    const type = String(block.type).replace(/^lean_/, '');
    const spec = BLOCK_SPECS[type];
    if (!spec || spec.kind === 'term') throw new Error(`"${type}" cannot join a tactic stack`);
    const fields = readFields(block, spec);
    const node = { type, id: block.id, fields };
    if (spec.inputs) {
      node.inputs = spec.inputs.map((input) => readTerm(block.getInputTargetBlock(input.name.toUpperCase())));
    }
    if (spec.branches) {
      node.branches = {};
      for (const branch of spec.branches) {
        for (const binder of branch.binders ?? []) {
          fields[binder.name] = String(block.getFieldValue(binder.name.toUpperCase()) ?? '').trim();
        }
        node.branches[branch.key] = readStack(block.getInputTargetBlock(branch.key.toUpperCase()));
      }
    }
    stack.push(node);
  }
  return stack;
}

function jsonFields(node, spec) {
  const fields = {};
  for (const field of spec.fields ?? []) {
    fields[field.name.toUpperCase()] = node.fields?.[field.name] ?? field.default ?? '';
  }
  return fields;
}

function termToJson(node) {
  if (!node) return null;
  const spec = BLOCK_SPECS[node.type];
  if (!spec || spec.kind !== 'term') throw new Error(`"${node.type}" is not a term block`);
  const json = { type: `lean_${node.type}`, fields: jsonFields(node, spec) };
  if (spec.inputs) {
    json.inputs = {};
    spec.inputs.forEach((input, index) => {
      const child = termToJson(node.inputs?.[index]);
      if (child) json.inputs[input.name.toUpperCase()] = { block: child };
    });
  }
  return json;
}

function stackToJson(stack) {
  if (!stack || stack.length === 0) return null;
  const [head, ...rest] = stack;
  const spec = BLOCK_SPECS[head.type];
  if (!spec || spec.kind === 'term') throw new Error(`"${head.type}" cannot join a tactic stack`);
  const json = { type: `lean_${head.type}`, fields: jsonFields(head, spec) };
  if (spec.inputs) {
    json.inputs = {};
    spec.inputs.forEach((input, index) => {
      const child = termToJson(head.inputs?.[index]);
      if (child) json.inputs[input.name.toUpperCase()] = { block: child };
    });
  }
  if (spec.branches) {
    for (const branch of spec.branches) {
      for (const binder of branch.binders ?? []) {
        json.fields[binder.name.toUpperCase()] = head.fields?.[binder.name] ?? binder.default ?? '';
      }
      const body = stackToJson(head.branches?.[branch.key] ?? []);
      if (body) json.inputs = { ...(json.inputs ?? {}), [branch.key.toUpperCase()]: { block: body } };
    }
  }
  if (rest.length > 0) json.next = { block: stackToJson(rest) };
  return json;
}

/**
 * @param {{lesson: object, program?: object[], onChange?: (program: object[]) => void,
 *          onReady?: () => void}} options
 */
export function createBlocksEditor({ lesson, program = [], onChange = () => {}, onReady = () => {} }) {
  const config = lesson.blocks ?? { palette: [] };
  const workspaceDiv = h('div', { class: 'blockly-workspace', 'aria-label': 'Blockly proof editor' });
  const loading = h('p', { class: 'blocks-loading', text: 'Loading the block editor…' });
  const note = h('p', { class: 'blocks-note', hidden: true });
  const leanCode = h('pre', { class: 'lean-code', 'aria-label': 'The Lean generated by the blocks' });
  const problem = h('p', { class: 'block-problem', hidden: true });
  const leanOutput = h('details', { class: 'lean-output', open: true },
    h('summary', { text: 'The Lean these blocks produce' }), leanCode, problem);
  const element = h('div', { class: 'blocks-wrap' },
    h('div', { class: 'blocks-stage' }, loading, workspaceDiv), note, leanOutput);

  /** @type {any} */
  let Blockly = null;
  /** @type {any} */
  let workspace = null;
  let observer = null;
  let disposed = false;
  let muted = false;
  let ready = false;
  let queued = program;
  let explicitProgram = false;
  let lastCode = '';
  let lastLines = [];
  let lastProgram = [];

  function readProgram() {
    if (!workspace) return [];
    // A free term block is scratch material: it is not part of the proof until
    // it is plugged into an exact/use input, so it must not break the generated
    // Lean. Only tactic stacks are read.
    const roots = workspace.getTopBlocks(true).filter((root) => {
      const type = String(root.type).replace(/^lean_/, '');
      return BLOCK_SPECS[type]?.kind !== 'term';
    });
    note.hidden = roots.length <= 1;
    if (roots.length > 1) {
      note.textContent = `${roots.length} separate stacks: they run top to bottom. Connect a stack under another with its notch to make the order explicit.`;
    }
    return roots.flatMap((root) => readStack(root));
  }

  function paintCompiled(compiled) {
    lastCode = compiled.code;
    lastLines = compiled.lines;
    leanCode.textContent = compiled.code || '';
    leanCode.dataset.empty = compiled.code ? 'false' : 'true';
    problem.hidden = true;
    problem.textContent = '';
  }

  function refresh() {
    if (!workspace) return;
    // Editing invalidates the last check's per-block warnings; they describe a
    // program that no longer exists.
    for (const block of workspace.getAllBlocks(false)) block.setWarningText(null);
    let nextProgram;
    try {
      nextProgram = readProgram();
    } catch (error) {
      problem.hidden = false;
      problem.textContent = error.message;
      return;
    }
    lastProgram = nextProgram;
    try {
      paintCompiled(compileBlocks(nextProgram));
    } catch (error) {
      lastCode = '';
      lastLines = [];
      leanCode.textContent = '';
      leanCode.dataset.empty = 'true';
      problem.hidden = false;
      problem.textContent = error.message;
    }
    onChange(nextProgram);
  }

  function applyProgram(next) {
    if (!workspace) { queued = next ?? []; return; }
    muted = true;
    try {
      const roots = (next ?? []).length > 0 ? [{ ...stackToJson(next), x: 90, y: 24 }] : [];
      Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: roots } }, workspace);
    } catch (error) {
      // A saved draft can outlive a content change (a lemma renamed, a block
      // removed). Start clean and say so rather than leaving a half-loaded tree.
      problem.hidden = false;
      problem.textContent = `This saved workspace no longer matches the lesson (${error.message}). Starting from empty.`;
      Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [] } }, workspace);
    } finally {
      muted = false;
    }
    // A loaded program (starter or solution) is what the learner came to look
    // at; the palette can be reopened from its category bar.
    workspace.getFlyout?.()?.hide?.();
    // The program may be wider than a phone workspace; fit it once instead of
    // making the learner pan to find it.
    workspace.zoomToFit?.();
    refresh();
  }

  function clear() {
    applyProgram([]);
  }

  function markProblems(messages) {
    if (!workspace) return;
    for (const block of workspace.getAllBlocks(false)) block.setWarningText(null);
    const byBlock = new Map();
    for (const message of messages ?? []) {
      if (!message.line) continue;
      const blockId = lastLines[message.line - 1]?.blockId;
      if (!blockId) continue;
      if (!byBlock.has(blockId)) byBlock.set(blockId, []);
      byBlock.get(blockId).push(message.message);
    }
    for (const [blockId, texts] of byBlock) {
      workspace.getBlockById(blockId)?.setWarningText(texts.join('\n'));
    }
  }

  loadBlockly()
    .then((api) => {
      if (disposed) return;
      Blockly = api;
      for (const type of config.palette) {
        const definition = definitionFor(type, config);
        if (definition) Blockly.defineBlocksWithJsonArray([definition]);
      }
      workspace = Blockly.inject(workspaceDiv, {
        toolbox: toolboxFor(config),
        // A horizontal toolbox puts the palette (and its category bar) above
        // the canvas instead of taking a column from its width. The flyout is
        // opened automatically below.
        horizontalLayout: true,
        renderer: 'zelos',
        theme: themeFor(Blockly),
        media: `${BLOCKLY_BASE}/media/`,
        trashcan: true,
        sounds: false,
        grid: { spacing: 24, length: 3, colour: isDark() ? '#252b36' : '#e4e7ec', snap: true },
        // On a phone the zoom controls sit on top of the block tree; pinch is
        // still available, and the tree is fitted to the workspace anyway.
        zoom: {
          controls: Boolean(globalThis.matchMedia?.('(min-width: 600px)').matches),
          pinch: true,
          wheel: false,
          startScale: 0.78,
          maxScale: 1.0,
          minScale: 0.3,
        },
        move: { scrollbars: true, drag: true, wheel: false },
      });
      workspace.addChangeListener((event) => {
        if (muted || disposed) return;
        if (event.isUiEvent) return;
        if (event.type === Blockly.Events.BLOCK_DRAG) return;
        if (event.type === Blockly.Events.BLOCK_MOVE && isNarrow()) {
          // The horizontal flyout covers most of a phone-sized canvas; after a
          // drop get it out of the way.
          workspace.getFlyout?.()?.hide?.();
        }
        refresh();
      });
      // Blockly sizes itself from the div; a focus-mode switch or a rotation
      // changes that div without a window resize, so observe the element.
      observer = new globalThis.ResizeObserver(() => Blockly?.svgResize(workspace));
      observer.observe(workspaceDiv);
      loading.hidden = true;
      ready = true;
      applyProgram(queued);
      onReady();
      // First paint: a fresh level opens the palette; a saved or shipped proof
      // is fitted to the canvas instead, so the learner sees the whole tree
      // rather than a palette covering it. The palette stays one tap away in
      // its category bar either way.
      const initialBlocks = workspace.getAllBlocks(false).length;
      globalThis.requestAnimationFrame(() => {
        if (disposed || !workspace || explicitProgram) return;
        if (initialBlocks <= 2) {
          workspace.getToolbox?.()?.selectItemByPosition?.(0);
        } else {
          workspace.getFlyout?.()?.hide?.();
          workspace.zoomToFit?.();
        }
      });
    })
    .catch((error) => {
      loading.textContent = `The block editor could not load: ${error.message}. The lesson text below still explains the proof; reload to retry.`;
      loading.dataset.state = 'error';
    });

  return {
    element,
    getLean: () => lastCode,
    getProgram: () => lastProgram,
    hasCode: () => lastCode.trim() !== '',
    isReady: () => ready,
    setProgram: (next) => { explicitProgram = true; applyProgram(next); },
    clear,
    markProblems,
    // Blockly's toolbar and canvas own keyboard focus; the lesson calls focus()
    // when it renders, and stealing the page's scroll there would be rude.
    focus: () => {},
    dispose() {
      disposed = true;
      observer?.disconnect();
      workspace?.dispose();
      workspace = null;
    },
  };
}
