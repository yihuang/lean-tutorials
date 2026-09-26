// Local dev/preview server: static files and cross-origin isolation.
//
//   node scripts/serve.mjs [--dir site|dist] [--port 8788] [--log-bytes]
//
// The runtime is entirely static (the browser assembles lean.wasm from its chunks
// itself), so this is a plain file server that mirrors Cloudflare Pages: the same
// content types, immutable caching for `?v=` runtime URLs, `404.html` for misses
// with a 404 status, and the app shell for extensionless paths.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

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

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  const isRuntime = pathname.startsWith('/lean-wasm/');

  let filePath = resolve(join(root, normalize(pathname)));
  if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');

  if (!existsSync(filePath)) {
    const notFound = join(root, '404.html');
    if (!extname(pathname)) {
      // Hash router: extensionless paths are the app shell.
      filePath = join(root, 'index.html');
    } else if (existsSync(notFound)) {
      res.writeHead(404, { 'content-type': TYPES['.html'], 'content-length': String(statSync(notFound).size) });
      if (method === 'HEAD') { res.end(); return; }
      createReadStream(notFound).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${pathname}`);
      return;
    }
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
  const ready = existsSync(join(root, 'lean-wasm', 'runtime.json'));
  console.log(`lean-tutorials dev server: http://localhost:${port} (root ${root})`);
  console.log(`cross-origin isolation: on   runtime: ${ready ? 'self-hosted' : 'MISSING'}${logBytes ? '   byte logging: on' : ''}`);
  if (!ready) console.warn('warning: no runtime in this root — run `npm run prepare:runtime` first');
});
