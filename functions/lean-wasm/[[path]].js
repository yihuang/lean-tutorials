// Same-origin /lean-wasm/* for the Lean WASM runtime.
//
// The runtime is a pthread build: `lean.js` spawns its own sub-workers and the
// worker `importScripts()` the glue, so every byte must be same-origin. It also
// needs the cross-origin-isolation headers (COOP/COEP, see site/_headers) for
// SharedArrayBuffer.
//
// Upstream (https://lean.cau.li, Apache-2.0) publishes the runtime and the
// packed Init library closure. This Function re-serves them under our own
// origin. Nothing here is invented: `/lean-wasm/lean.js`, `/lean-wasm/lean.wasm`,
// `/lean-wasm/core-layer.json` and `/lean-wasm/core-lib/*.pack` all exist on the
// upstream origin.
//
// UPGRADE PATH (no upstream dependency): download the runtime from
// https://github.com/cauli/lean4-wasm-in-browser/releases and serve
// `lean.js` / `lean.wasm` from an R2 binding (`env.LEAN_ASSETS`) like upstream
// does, and copy `core-layer.json` + `core-lib/` into the static build
// (each pack is ~6.6 MB, under Pages' 25 MB per-file limit).

const UPSTREAM = 'https://lean.cau.li';

/** Upstream's edge occasionally hiccups; one cheap retry beats a broken boot. */
async function fetchWithRetry(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        // Identity body + let Cloudflare re-compress: forwarding a
        // content-encoding risks mismatched layers at the edge.
        headers: { 'accept-encoding': 'identity' },
        cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 * 30 },
      });
      if (response.ok) return response;
      last = response;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 400 * (attempt + 1)));
  }
  return last;
}

const TYPES = {
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  pack: 'application/octet-stream',
};

export async function onRequest(context) {
  const { request, params } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const key = Array.isArray(params.path) ? params.path.join('/') : params.path;
  // only the known runtime surface — no open proxy
  const allowed =
    typeof key === 'string' &&
    (/^lean\.(js|wasm)$/.test(key) ||
      key === 'core-layer.json' ||
      /^core-lib\/artifacts-\d{3}\.pack$/.test(key));
  if (!allowed) return new Response('Not found', { status: 404 });

  // Pinned runtime release id (`?v=`). Explicit versions never fall back to
  // the unversioned objects, which are a different, much larger Lean build.
  const url = new URL(request.url);
  const versions = url.searchParams.getAll('v');
  if (versions.length > 1 || (versions.length === 1 && (!versions[0] || !/^[0-9A-Za-z._-]+$/.test(versions[0])))) {
    return new Response('Invalid asset version', { status: 400 });
  }
  const version = versions[0];

  // Ask upstream for an identity body and let Cloudflare re-compress whatever
  // the browser asked for. Forwarding the client's `accept-encoding` and then
  // passing a content-encoding through risks mismatched encoding layers, and
  // upstream documents that trap for their own R2 path.
  const upstream = await fetchWithRetry(`${UPSTREAM}/lean-wasm/${key}${version ? `?v=${encodeURIComponent(version)}` : ''}`);
  if (!(upstream instanceof Response) || !upstream.ok || !upstream.body) {
    const status = upstream instanceof Response ? upstream.status : 0;
    return new Response(`Upstream runtime unavailable (${status || 'unreachable'})`, {
      status: 502,
      headers: { 'cache-control': 'no-store', 'x-upstream-status': String(status) },
    });
  }

  const headers = new Headers();
  const ext = key.slice(key.lastIndexOf('.') + 1);
  headers.set('content-type', TYPES[ext] || 'application/octet-stream');
  // No content-encoding of our own: brotli here is what makes the ~89 MB
  // `lean.js` a ~6.5 MB download and the ~101 MB `lean.wasm` ~19 MB. `.pack`
  // entries are gzip payloads the app inflates itself; if the edge adds a
  // second (brotli/gzip) layer the browser strips that one and the original
  // gzip body is what `inflateGzip` sees, so both cases stay correct.
  headers.set('cache-control', version ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('cross-origin-embedder-policy', 'require-corp');
  headers.set('cross-origin-opener-policy', 'same-origin');

  return new Response(request.method === 'HEAD' ? null : upstream.body, { headers });
}
