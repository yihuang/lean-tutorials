// Fetch the pinned browser runtime into site/lean-wasm/.
//
//   node scripts/fetch-runtime.mjs [--force]
//
// The Lean WASM build comes from the upstream project's published release
// (github.com/cauli/lean4-wasm-in-browser, Apache-2.0). We serve it from our own
// origin on purpose: the runtime is a pthread build, so it must be same-origin,
// and proxying it through Cloudflare's edge is not dependable — upstream's bot
// protection answers 403 to Cloudflare worker egress from some colos (SJC), which
// breaks the site for real users in those regions, not just for CI.
//
// The download is verified against the SHA-256 pinned in upstream's
// deploy/runtime-release.json, and extracted into:
//
//   site/lean-wasm/lean.js            the glue
//   site/lean-wasm/lean.wasm          the binary (split at build time: Pages
//                                     caps a single file at 25 MB)
//   site/lean-wasm/lib/lean/**        the Init .olean/.ir/.ir.sig closure, which
//                                     scripts/pack-core-layer.mjs packs up
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAN_ASSET_VERSION } from '../site/src/lean/config.js';

const RELEASE_TAG = 'runtime-62b6a22-compact1';
const ASSET = 'lean-runtime-fixture.tar.gz';
const ASSET_BYTES = 290396150;
const ASSET_SHA256 = '8dce3ed8a078046b5251ddf55917080fdf69227b3e4597c94e91ebb7f0b06521';
const RELEASE = `https://github.com/cauli/lean4-wasm-in-browser/releases/download/${RELEASE_TAG}`;

// Upstream's deploy/runtime-release.json: the browser (compact-exports) pair.
const FILES = {
  'lean.js': { bytes: 148402, sha256: '63aa7b004435f3d90cf19d7c3b3e3284726701ea06da8bc70b015125e1a38b24' },
  'lean.wasm': { bytes: 100838905, sha256: '08d3ae8ee5dec8bae165ad5102e604eca016d74d2303e0b5748690df679a764e' },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, 'site', 'lean-wasm');
const cacheDir = join(root, '.runtime-cache');
const archive = join(cacheDir, ASSET);
const force = process.argv.includes('--force');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status} ${url}`);
  const out = createWriteStream(destination);
  for await (const chunk of response.body) {
    if (!out.write(chunk)) await new Promise((done) => out.once('drain', done));
  }
  await new Promise((done, fail) => out.end((error) => (error ? fail(error) : done())));
}

mkdirSync(cacheDir, { recursive: true });
if (force) rmSync(archive, { force: true });

if (!existsSync(archive) || statSync(archive).size !== ASSET_BYTES) {
  console.log(`downloading ${ASSET} (${(ASSET_BYTES / 1048576).toFixed(0)} MB) from ${RELEASE_TAG}…`);
  await download(`${RELEASE}/${ASSET}`, archive);
} else {
  console.log(`using cached ${archive}`);
}

const archiveSha = sha256(archive);
if (archiveSha !== ASSET_SHA256) {
  rmSync(archive, { force: true });
  throw new Error(`fixture SHA-256 mismatch: got ${archiveSha}, expected ${ASSET_SHA256} (deleted; retry)`);
}

mkdirSync(runtimeDir, { recursive: true });
console.log('extracting runtime/lean.{js,wasm} and lib/lean/** …');
execFileSync('tar', [
  '-xzf', archive, '-C', runtimeDir, '--strip-components=1',
  'runtime/lean.js', 'runtime/lean.wasm',
], { stdio: 'inherit' });
execFileSync('tar', ['-xzf', archive, '-C', runtimeDir, 'lib/lean'], { stdio: 'inherit' });

for (const [name, expected] of Object.entries(FILES)) {
  const path = join(runtimeDir, name);
  if (!existsSync(path)) throw new Error(`missing ${name} after extraction`);
  const size = statSync(path).size;
  const digest = sha256(path);
  if (size !== expected.bytes || digest !== expected.sha256) {
    rmSync(path, { force: true });
    throw new Error(`${name} does not match the pinned release (${size} bytes, ${digest})`);
  }
  console.log(`✓ ${name}  ${(size / 1048576).toFixed(1)} MB  ${digest.slice(0, 16)}…`);
}

if (!LEAN_ASSET_VERSION.startsWith('62b6a22913')) {
  throw new Error(`site/src/lean/config.js pins ${LEAN_ASSET_VERSION}, but this script fetches runtime-62b6a22-compact1`);
}

console.log('\nruntime ready. Next: node scripts/pack-core-layer.mjs && npm run build');
