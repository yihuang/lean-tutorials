// Assemble the Cloudflare Pages build output in dist/.
//
//   node scripts/build.mjs
//
// Two jobs:
//   1. copy the static site (scene: plain ES modules, no bundler),
//   2. stage the self-hosted Lean runtime: lean.js, the generated packed core
//      layer, and lean.wasm split into chunks under Pages' 25 MB per-file cap.
//      functions/lean-wasm/ concatenates the chunks back into one lean.wasm.
//
// Run `node scripts/fetch-runtime.mjs && node scripts/pack-core-layer.mjs` first
// (npm run prepare:runtime).
import {
  cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAN_ASSET_VERSION } from '../site/src/lean/config.js';

const CHUNK_BYTES = 20 * 1024 * 1024; // Pages rejects files over 25 MB, so 20 MB + headroom
const RELEASE_TAG = 'runtime-62b6a22-compact1';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'site');
const to = join(root, 'dist');
const runtimeSrc = join(from, 'lean-wasm');
const runtimeOut = join(to, 'lean-wasm');

function fail(message) {
  console.error(`\nbuild failed: ${message}`);
  console.error('Fix: npm run prepare:runtime   (downloads the pinned runtime and packs the core layer)\n');
  process.exit(1);
}

for (const required of ['lean.js', 'lean.wasm', 'core-layer.json', 'core-lib']) {
  if (!existsSync(join(runtimeSrc, required))) fail(`site/lean-wasm/${required} is missing`);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

// 1. The app itself. `filter` keeps the multi-hundred-MB runtime tree out of the
//    copy; the pieces Pages should host are staged below.
cpSync(from, to, {
  recursive: true,
  filter: (src) => src !== runtimeSrc && !src.startsWith(runtimeSrc + '/'),
});

// 2. Runtime pieces that are small enough to be static assets.
mkdirSync(runtimeOut, { recursive: true });
cpSync(join(runtimeSrc, 'lean.js'), join(runtimeOut, 'lean.js'));
cpSync(join(runtimeSrc, 'core-layer.json'), join(runtimeOut, 'core-layer.json'));
cpSync(join(runtimeSrc, 'core-lib'), join(runtimeOut, 'core-lib'), { recursive: true });

// 3. lean.wasm, split deterministically into chunks.
const wasm = readFileSync(join(runtimeSrc, 'lean.wasm'));
const chunks = [];
for (let offset = 0, index = 0; offset < wasm.length; offset += CHUNK_BYTES, index += 1) {
  const name = `lean.wasm.part-${String(index).padStart(3, '0')}`;
  const slice = wasm.subarray(offset, Math.min(offset + CHUNK_BYTES, wasm.length));
  writeFileSync(join(runtimeOut, name), slice);
  chunks.push(name);
}

const core = JSON.parse(readFileSync(join(runtimeSrc, 'core-layer.json'), 'utf8'));
const variant = existsSync(join(runtimeSrc, 'VARIANT')) ? readFileSync(join(runtimeSrc, 'VARIANT'), 'utf8').trim() : 'full';
const runtime = {
  release: RELEASE_TAG,
  variant,
  assetVersion: LEAN_ASSET_VERSION,
  wasm: {
    bytes: wasm.length,
    sha256: createHash('sha256').update(wasm).digest('hex'),
    chunkBytes: CHUNK_BYTES,
    chunks,
  },
  core: {
    files: core.fileCount ?? (core.files ?? []).length,
    packs: core.packs.length,
    bytes: core.bytes,
    compressedBytes: core.compressedBytes,
    sha256: core.sha256,
  },
};
writeFileSync(join(runtimeOut, 'runtime.json'), `${JSON.stringify(runtime, null, 1)}\n`);

const total = readdirSync(runtimeOut).reduce((sum, name) => {
  const stat = statSync(join(runtimeOut, name));
  return sum + (stat.isDirectory() ? 0 : stat.size);
}, 0) + readdirSync(join(runtimeOut, 'core-lib'))
  .reduce((sum, name) => sum + statSync(join(runtimeOut, 'core-lib', name)).size, 0);

console.log(`built ${to}`);
console.log(`runtime: lean.js + core-layer.json (${runtime.core.files} files, ${runtime.core.packs} packs, ` +
  `${(runtime.core.compressedBytes / 1048576).toFixed(1)} MB gzip) + lean.wasm in ${chunks.length} chunks ` +
  `(${(runtime.wasm.bytes / 1048576).toFixed(1)} MB) — ${(total / 1048576).toFixed(1)} MB of runtime assets`);
