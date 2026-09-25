// Fetch the packed Init closure the tutorial runtime needs.
//
// Upstream ships the whole Init environment as five ~6.6 MB gzip packs
// (`core-layer.json` + `core-lib/artifacts-NNN.pack`) instead of ~3,800
// individual `.olean`/`.ir` requests. Each pack is self-describing: an ordered
// list of {path, offset, bytes} entries into the inflated blob.

const MANIFEST_URL = '/lean-wasm/core-layer.json';
const PACK_ROOT = '/lean-wasm/core-lib';

const OLEAN_MAGIC = [0x6f, 0x6c, 0x65, 0x61]; // "olea"

function looksLikeOlean(bytes) {
  if (bytes.length < 32) return false;
  return OLEAN_MAGIC.every((byte, index) => bytes[index] === byte);
}

async function inflateGzip(buffer) {
  const stream = new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Total compressed size of the core layer, for progress UI. */
export function coreLayerBytes(manifest) {
  return (manifest.packs || []).reduce((sum, pack) => sum + (pack.compressedBytes || 0), 0);
}

/**
 * How many bytes actually crossed the wire for a URL, vs how many the browser
 * had already stored. `transferSize` is 0 for a (memory or disk) cache hit and
 * the compressed size otherwise, which is exactly "did we re-download Lean?".
 * Resource timing can lag the promise by a tick, hence the retry.
 */
async function transferredBytes(url) {
  // Resource timing entries are keyed by absolute URL.
  const absolute = new URL(url, location.href).href;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const entry = performance.getEntriesByName(absolute, 'resource')[0];
    if (entry) return { transfer: entry.transferSize, decoded: entry.decodedBodySize };
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

/**
 * Yield the core layer one pack at a time, already split back into files.
 * Sequential on purpose: peak memory stays at one pack (~16 MB in, ~16 MB out)
 * instead of the whole 76 MB closure.
 *
 * @param {(progress: {file: string, index: number, count: number, received: number, total: number, downloadedBytes: number, cachedBytes: number}) => void} [onProgress]
 */
export async function* corePackStream(onProgress) {
  // Default cache mode on purpose: the manifest is pinned to the same runtime
  // release as the binary, is served with `max-age=86400`, and `no-cache` here
  // meant re-downloading 313 KB on every single visit.
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Lean core layer manifest unavailable (${response.status} ${MANIFEST_URL})`);
  }
  const manifest = await response.json();
  const packs = manifest.packs || [];
  if (packs.length === 0) throw new Error('Lean core layer manifest lists no packs');

  const total = coreLayerBytes(manifest);
  let received = 0;
  let downloadedBytes = 0;
  let cachedBytes = 0;

  for (const [index, pack] of packs.entries()) {
    const url = `${PACK_ROOT}/${pack.file}`;
    const packResponse = await fetch(url);
    if (!packResponse.ok) throw new Error(`Lean core pack ${pack.file} unavailable (${packResponse.status})`);
    const compressed = await packResponse.arrayBuffer();
    const measured = await transferredBytes(url);
    if (measured && measured.transfer === 0) cachedBytes += compressed.byteLength;
    else downloadedBytes += measured?.transfer ?? compressed.byteLength;    const blob = await inflateGzip(compressed);
    if (blob.byteLength !== pack.bytes) {
      throw new Error(`Lean core pack ${pack.file} inflated to ${blob.byteLength} bytes, expected ${pack.bytes}`);
    }

    /** @type {Map<string, Uint8Array>} */
    const files = new Map();
    for (const entry of pack.entries) {
      const end = entry.offset + entry.bytes;
      if (entry.offset < 0 || end > blob.byteLength) {
        throw new Error(`Lean core entry ${entry.path} is outside ${pack.file}`);
      }
      const bytes = blob.slice(entry.offset, end);
      if (!looksLikeOlean(bytes)) throw new Error(`Lean core entry ${entry.path} is not an olean`);
      files.set(entry.path, bytes);
    }

    received += pack.compressedBytes || compressed.byteLength || 0;
    onProgress?.({ file: pack.file, index, count: packs.length, received, total, downloadedBytes, cachedBytes });
    yield { file: pack.file, files };
  }
}
