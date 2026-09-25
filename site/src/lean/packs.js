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
 * Yield the core layer one pack at a time, already split back into files.
 * Sequential on purpose: peak memory stays at one pack (~16 MB in, ~16 MB out)
 * instead of the whole 76 MB closure.
 *
 * @param {(progress: {file: string, index: number, count: number, received: number, total: number}) => void} [onProgress]
 */
export async function* corePackStream(onProgress) {
  const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Lean core layer manifest unavailable (${response.status} ${MANIFEST_URL})`);
  }
  const manifest = await response.json();
  const packs = manifest.packs || [];
  if (packs.length === 0) throw new Error('Lean core layer manifest lists no packs');

  const total = coreLayerBytes(manifest);
  let received = 0;

  for (const [index, pack] of packs.entries()) {
    const packResponse = await fetch(`${PACK_ROOT}/${pack.file}`);
    if (!packResponse.ok) throw new Error(`Lean core pack ${pack.file} unavailable (${packResponse.status})`);
    const compressed = await packResponse.arrayBuffer();
    const blob = await inflateGzip(compressed);
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
    onProgress?.({ file: pack.file, index, count: packs.length, received, total });
    yield { file: pack.file, files };
  }
}
