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
// Two variants ship in the same release, verified against the SHA-256 from
// upstream's deploy/runtime-release.json:
//
//   full (default)  ~96 MB wasm. Measured on a 2-vCPU container: 13.8 s to
//                   compile and instantiate, then a 1.5 s Init import.
//   slim            ~70 MB wasm, Init-only, all core tactics — for devices where
//                   the *compile* is what fails (upstream built it for iOS).
//                   Measured: compile 4.1 s but the Init import 12.0 s, because
//                   without the boxed wrappers library code is interpreted. Same
//                   cold start, slower checks, so it is opt-in: `--variant slim`.
//
// Extracted into:
//
//   site/lean-wasm/lean.js            the glue
//   site/lean-wasm/lean.wasm          the binary (split at build time: Pages
//                                     caps a single file at 25 MB)
//   site/lean-wasm/lib/lean/**        the Init .olean/.ir/.ir.sig closure, which
//                                     scripts/pack-core-layer.mjs packs up
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAN_ASSET_VERSION } from '../site/src/lean/config.js';

const RELEASE_TAG = 'runtime-62b6a22-compact1';
const ASSET = 'lean-runtime-fixture.tar.gz';
const ASSET_BYTES = 290396150;
const ASSET_SHA256 = '8dce3ed8a078046b5251ddf55917080fdf69227b3e4597c94e91ebb7f0b06521';
const RELEASE = `https://github.com/cauli/lean4-wasm-in-browser/releases/download/${RELEASE_TAG}`;

// Upstream's deploy/runtime-release.json, both variants.
const FILES = {
  full: {
    'lean.js': { bytes: 148402, sha256: '63aa7b004435f3d90cf19d7c3b3e3284726701ea06da8bc70b015125e1a38b24' },
    'lean.wasm': { bytes: 100838905, sha256: '08d3ae8ee5dec8bae165ad5102e604eca016d74d2303e0b5748690df679a764e' },
  },
  slim: {
    'lean.js': { bytes: 3430113, sha256: 'cfb1e66db50309d2f4409c8c90fca10b6470036941d5e3479b9504eb63c22120' },
    'lean.wasm': { bytes: 70444966, sha256: 'e3499ffc9414d178b1735fe82254284163d8f57046c977d74f04c0c8fc23a8f4' },
  },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, 'site', 'lean-wasm');
const cacheDir = join(root, '.runtime-cache');
const archive = join(cacheDir, ASSET);
const force = process.argv.includes('--force');
const variantIndex = process.argv.indexOf('--variant');
const variant = variantIndex >= 0 ? process.argv[variantIndex + 1] : 'full';
if (!FILES[variant]) {
  console.error(`unknown variant "${variant}": expected slim or full`);
  process.exit(1);
}

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
// --force re-extracts; it must not throw away the cached archive (277 MB).
if (force) rmSync(runtimeDir, { recursive: true, force: true });

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
const members = variant === 'slim'
  ? ['runtime/slim/lean.js', 'runtime/slim/lean.wasm']
  : ['runtime/lean.js', 'runtime/lean.wasm'];
console.log(`extracting ${variant} lean.{js,wasm} and lib/lean/** …`);
execFileSync('tar', [
  '-xzf', archive, '-C', runtimeDir, `--strip-components=${variant === 'slim' ? 2 : 1}`,
  ...members,
], { stdio: 'inherit' });
execFileSync('tar', ['-xzf', archive, '-C', runtimeDir, 'lib/lean'], { stdio: 'inherit' });
writeFileSync(join(runtimeDir, 'VARIANT'), `${variant}\n`);

for (const [name, expected] of Object.entries(FILES[variant])) {
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

console.log(`\n${variant} runtime ready. Next: node scripts/pack-core-layer.mjs && npm run build`);
