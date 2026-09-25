// Pack the Init closure into the few gzip blobs the browser fetches at startup.
//
//   node scripts/pack-core-layer.mjs
//
// Upstream ships this layer as `core-layer.json` plus `core-lib/artifacts-NNN.pack`
// (5 packs, 1887 entries, ~31 MB compressed for ~76 MB of oleans). ~3,800
// individual requests at startup is not an option, so we generate the same shape
// from the `.olean`/`.ir`/`.ir.sig` tree extracted by scripts/fetch-runtime.mjs.
//
// Deterministic on purpose: sorted paths, fixed pack size, and gzip headers with
// a zeroed MTIME, so an unchanged runtime produces byte-identical packs and
// Cloudflare Pages re-uploads nothing.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const PACK_LIMIT = 16 * 1024 * 1024; // raw bytes per pack, like upstream's ~16 MB
const KEEP = /\.(olean|ir|ir\.sig)$/;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, 'site', 'lean-wasm');
const libDir = join(runtimeDir, 'lib', 'lean');
const outDir = join(runtimeDir, 'core-lib');
const manifestPath = join(runtimeDir, 'core-layer.json');

if (!existsSync(libDir)) {
  console.error('site/lean-wasm/lib/lean is missing — run: node scripts/fetch-runtime.mjs');
  process.exit(1);
}

/** @param {string} dir @returns {string[]} relative paths, sorted */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (KEEP.test(entry.name)) out.push(relative(base, full));
  }
  return out.sort();
}

function gzipDeterministic(buffer) {
  const compressed = gzipSync(buffer, { level: 6 });
  // Zero the gzip MTIME field so identical input gives identical bytes.
  compressed[4] = compressed[5] = compressed[6] = compressed[7] = 0;
  return compressed;
}

const paths = walk(libDir);
if (paths.length === 0) {
  console.error(`no olean/ir files under ${libDir}`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** @type {{file: string, bytes: number, compressedBytes: number, entries: {path: string, offset: number, bytes: number}[]}[]} */
const packs = [];
let current = { entries: [], parts: [], bytes: 0 };

function flush() {
  if (current.entries.length === 0) return;
  const raw = Buffer.concat(current.parts);
  const compressed = gzipDeterministic(raw);
  const file = `artifacts-${String(packs.length).padStart(3, '0')}.pack`;
  writeFileSync(join(outDir, file), compressed);
  packs.push({ file, bytes: raw.length, compressedBytes: compressed.length, entries: current.entries });
  current = { entries: [], parts: [], bytes: 0 };
}

for (const path of paths) {
  const full = join(libDir, path);
  const buffer = readFileSync(full);
  // A single oversized file would blow the pack budget; none exist today.
  if (buffer.length > PACK_LIMIT) throw new Error(`${path} is larger than one pack (${buffer.length} bytes)`);
  if (current.bytes + buffer.length > PACK_LIMIT) flush();
  current.entries.push({ path, offset: current.bytes, bytes: buffer.length });
  current.parts.push(buffer);
  current.bytes += buffer.length;
}
flush();

const bytes = packs.reduce((sum, pack) => sum + pack.bytes, 0);
const compressedBytes = packs.reduce((sum, pack) => sum + pack.compressedBytes, 0);
const digest = createHash('sha256');
for (const pack of packs) digest.update(readFileSync(join(outDir, pack.file)));

const manifest = {
  version: 'lean-core-self-hosted',
  source: 'cauli/lean4-wasm-in-browser runtime-62b6a22-compact1 (lib/lean)',
  baseModules: ['Init'],
  fileCount: paths.length,
  files: paths,
  packs,
  bytes,
  compressedBytes,
  sha256: digest.digest('hex'),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
console.log(`packed ${paths.length} files into ${packs.length} packs`);
for (const pack of packs) {
  console.log(`  ${pack.file}  ${(pack.bytes / 1048576).toFixed(1)} MB raw  ${(pack.compressedBytes / 1048576).toFixed(1)} MB gzip  ${pack.entries.length} entries`);
}
console.log(`  total ${(bytes / 1048576).toFixed(1)} MB raw / ${(compressedBytes / 1048576).toFixed(1)} MB gzip`);
