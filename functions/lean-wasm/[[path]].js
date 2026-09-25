// Serve the Lean WASM runtime from our own origin.
//
// The runtime is a pthread build: `lean.js` spawns its own sub-workers and they
// `importScripts()` the glue, so the bytes must be same-origin. lean.js, the
// packed core layer and runtime.json are plain static assets; lean.wasm is split
// into <25 MB chunks at build time (Cloudflare Pages' per-file limit) and stitched
// back together here with a stream, so the browser still sees one fetch.
//
// Deliberately no upstream proxy: lean.cau.li answers 403 to Cloudflare worker
// egress from some colos, which used to break the site for whole regions. The
// artifacts are fetched at build time instead (scripts/fetch-runtime.mjs).

export async function onRequest(context) {
  const { request, env, params, next } = context;
  const key = Array.isArray(params.path) ? params.path.join('/') : params.path;

  // Everything else (/lean-wasm/lean.js, core-layer.json, core-lib/*.pack,
  // lean.wasm.part-NNN) is a static asset Pages already knows how to serve.
  if (key !== 'lean.wasm') return next();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const asset = async (path) => {
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(new Request(new URL(path, url.origin), { method: 'GET' }));
    return next(new Request(new URL(path, url.origin), { method: 'GET' }));
  };

  let runtime;
  try {
    const manifest = await asset('/lean-wasm/runtime.json');
    if (!manifest.ok) throw new Error(`runtime.json: ${manifest.status}`);
    runtime = await manifest.json();
  } catch (error) {
    return new Response(`Runtime manifest unavailable (${error.message})`, {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const versions = url.searchParams.getAll('v');
  if (versions.length > 1 || (versions.length === 1 && (!versions[0] || !/^[0-9A-Za-z._-]+$/.test(versions[0])))) {
    return new Response('Invalid asset version', { status: 400 });
  }
  const versioned = versions.length === 1;

  const headers = new Headers({
    'content-type': 'application/wasm',
    'content-length': String(runtime.wasm.bytes),
    'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    'cross-origin-resource-policy': 'same-origin',
    // The pthread pool only joins the cross-origin-isolated agent cluster (and
    // therefore only gets SharedArrayBuffer) if the worker's own response carries
    // COEP; `_headers` does not apply to Function responses.
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin',
  });

  if (request.method === 'HEAD') return new Response(null, { headers });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const name of runtime.wasm.chunks) {
          const response = await asset(`/lean-wasm/${name}`);
          if (!response.ok || !response.body) {
            throw new Error(`chunk ${name}: ${response.status}`);
          }
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, { headers });
}
