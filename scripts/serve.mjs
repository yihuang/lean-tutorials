// Local dev/preview server: static files, cross-origin isolation, and the
// self-hosted Lean runtime.
//
//   node scripts/serve.mjs [--dir site|dist] [--port 8788] [--log-bytes]
//
// Mirrors what Cloudflare Pages does in production: the runtime is served from
// our own origin (same-origin is mandatory for the pthread build), `?v=` URLs are
// immutable, and lean.wasm is assembled from its <25 MB chunks when only the
// split build exists (dist/). Nothing here talks to lean.cau.li.
//
// The wasm is served brotli-compressed, like Cloudflare's edge does. That is not
// a nicety: Chromium refuses to cache a ~96 MB uncompressed response, so an
// identity body would mean re-downloading the binary on every visit.
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { once } from 'node:events';
import { constants, createBrotliCompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = resolve(argValue('dir', 'site'));
const port = Number(argValue('port', process.env.PORT || 8788));
const logBytes = args.includes('--log-bytes');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.pack': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function runtimeHeaders(extra = {}) {
  return {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
    ...extra,
  };
}

const cacheable = (search) => (new URLSearchParams(search).has('v')
  ? 'public, max-age=31536000, immutable'
  : 'public, max-age=86400');

/** Write chunk-000, chunk-001, … into one file (what the Pages Function streams). */
async function assembleWasmToFile(destination) {
  const manifest = JSON.parse(readFileSync(join(root, 'lean-wasm', 'runtime.json'), 'utf8'));
  const out = createWriteStream(destination);
  try {
    for (const name of manifest.wasm.chunks) {
      const chunk = await new Promise((done, fail) => {
        const parts = [];
        createReadStream(join(root, 'lean-wasm', name))
          .on('data', (part) => parts.push(part))
          .on('end', () => done(Buffer.concat(parts)))
          .on('error', fail);
      });
      if (!out.write(chunk)) await once(out, 'drain');
    }
  } finally {
    out.end();
    await once(out, 'finish');
  }
  return manifest;
}

/** The whole lean.wasm, assembled into a temp file when only chunks are shipped. */
async function ensureWasm() {
  const full = join(root, 'lean-wasm', 'lean.wasm');
  if (existsSync(full) && statSync(full).size > 0) {
    const size = statSync(full).size;
    return { source: full, size, identity: String(size) };
  }
  if (!existsSync(join(root, 'lean-wasm', 'runtime.json'))) {
    throw new Error('neither lean.wasm nor runtime.json is present — run: npm run prepare:runtime');
  }
  const manifest = JSON.parse(readFileSync(join(root, 'lean-wasm', 'runtime.json'), 'utf8'));
  const identity = manifest.wasm.sha256 ?? String(manifest.wasm.bytes);
  const source = join(tmpdir(), `lean-tutorials-${identity.slice(0, 16)}.wasm`);
  if (!existsSync(source) || statSync(source).size !== manifest.wasm.bytes) {
    await assembleWasmToFile(`${source}.part`);
    renameSync(`${source}.part`, source);
  }
  return { source, size: manifest.wasm.bytes, identity };
}

async function ensureBrotli(source, identity) {
  const compressed = join(tmpdir(), `lean-tutorials-${identity.slice(0, 16)}.wasm.br`);
  if (!existsSync(compressed) || statSync(compressed).size === 0) {
    await pipeline(
      createReadStream(source),
      createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
      createWriteStream(`${compressed}.part`),
    );
    renameSync(`${compressed}.part`, compressed);
  }
  return compressed;
}

function serveWasm(pathname, search, method, res) {
  const wantsBrotli = /\bbr\b/.test(res.req.headers['accept-encoding'] ?? '');
  ensureWasm()
    .then(async ({ source, size, identity }) => {
      const compressed = wantsBrotli ? await ensureBrotli(source, identity) : null;
      const file = compressed ?? source;
      res.writeHead(200, runtimeHeaders({
        'content-type': 'application/wasm',
        'content-length': String(statSync(file).size),
        'cache-control': cacheable(search),
        ...(compressed ? { 'content-encoding': 'br', vary: 'accept-encoding' } : {}),
      }));
      if (method === 'HEAD') { res.end(); return; }
      let sent = 0;
      const stream = createReadStream(file);
      stream.on('data', (part) => { sent += part.length; });
      stream.on('end', () => {
        if (logBytes) console.log(`[bytes] ${method} ${pathname} ${sent}${compressed ? ' br' : ''} of ${size}`);
      });
      stream.pipe(res);
    })
    .catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        .end(`runtime unavailable: ${error.message}\n`);
    });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  const isRuntime = pathname.startsWith('/lean-wasm/');

  if (pathname === '/lean-wasm/lean.wasm') {
    // Same guard as the Pages Function, so local behaviour matches production.
    const versions = url.searchParams.getAll('v');
    if (versions.length > 1 || (versions.length === 1 && (!versions[0] || !/^[0-9A-Za-z._-]+$/.test(versions[0])))) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid asset version');
      return;
    }
    serveWasm(pathname, url.search, method, res);
    return;
  }

  let filePath = resolve(join(root, normalize(pathname)));
  if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');

  if (!existsSync(filePath)) {
    if (isRuntime) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not a runtime asset: ${pathname}`);
      return;
    }
    // Hash router: extensionless paths are the app shell, missing files are 404.
    // Pages serves 404.html for the latter (with a 404 status), so match it —
    // otherwise a typo'd asset URL answers 200 with HTML, which is exactly how
    // "HTML where wasm should be" becomes baffling.
    if (extname(pathname)) {
      const notFound = join(root, '404.html');
      if (existsSync(notFound)) {
        res.writeHead(404, { 'content-type': TYPES['.html'], 'content-length': String(statSync(notFound).size) });
        if (method === 'HEAD') { res.end(); return; }
        createReadStream(notFound).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    filePath = join(root, 'index.html');
  }
  if (!existsSync(filePath)) { res.writeHead(404).end('not found'); return; }

  const type = TYPES[extname(filePath)] || 'application/octet-stream';
  const headers = isRuntime
    ? runtimeHeaders({ 'content-type': type, 'cache-control': cacheable(url.search), 'content-length': String(statSync(filePath).size) })
    : runtimeHeaders({ 'content-type': type, 'cache-control': 'no-store' });
  res.writeHead(200, headers);
  if (method === 'HEAD') { res.end(); return; }

  let sent = 0;
  const stream = createReadStream(filePath);
  stream.on('data', (part) => { sent += part.length; });
  stream.on('end', () => { if (logBytes && isRuntime) console.log(`[bytes] ${method} ${pathname} ${sent}`); });
  stream.pipe(res);
});

server.listen(port, () => {
  const ready = existsSync(join(root, 'lean-wasm', 'lean.wasm')) || existsSync(join(root, 'lean-wasm', 'runtime.json'));
  console.log(`lean-tutorials dev server: http://localhost:${port} (root ${root})`);
  console.log(`cross-origin isolation: on   runtime: ${ready ? 'self-hosted' : 'MISSING'}${logBytes ? '   byte logging: on' : ''}`);
  if (!ready) console.warn('warning: no runtime in this root — run `npm run prepare:runtime` first');
});
