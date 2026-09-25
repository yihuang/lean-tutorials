// Local preview server: static files + cross-origin isolation + the same
// /lean-wasm/* proxy the Pages Function performs.
//
//   node scripts/serve.mjs [--dir site] [--port 8788]
//
// Used for `npm run dev` and for the public preview tunnel
// (`npx cloudflared tunnel --url http://localhost:8788`), so the bytes a phone
// downloads are the same shape as production (Cloudflare compresses the proxied
// responses at the edge).
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = resolve(argValue('dir', 'site'));
const port = Number(argValue('port', process.env.PORT || 8788));
const upstream = 'https://lean.cau.li';

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

const RUNTIME = /^\/lean-wasm\/(lean\.(js|wasm)|core-layer\.json|core-lib\/artifacts-\d{3}\.pack)$/;

function isolate(headers) {
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-embedder-policy', 'require-corp');
  return headers;
}

async function proxyRuntime(pathname, search, method, res) {
  const key = pathname.replace(/^\/lean-wasm\//, '');
  const version = new URLSearchParams(search).get('v');
  if (version && !/^[0-9A-Za-z._-]+$/.test(version)) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid asset version');
    return;
  }
  // Ask upstream for identity bytes, exactly like the Pages Function, so no
  // encoding layer is handed through twice.
  const upstreamRes = await fetch(`${upstream}/lean-wasm/${key}${version ? `?v=${encodeURIComponent(version)}` : ''}`, {
    headers: { 'accept-encoding': 'identity' },
  });
  if (!upstreamRes.ok || !upstreamRes.body) {
    res.writeHead(502, { 'content-type': 'text/plain' }).end(`upstream ${upstreamRes.status}`);
    return;
  }
  const ext = extname(key);
  const headers = isolate(new Headers({
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': version ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    'cross-origin-resource-policy': 'same-origin',
  }));
  res.writeHead(200, Object.fromEntries(headers));
  if (method === 'HEAD') { res.end(); return; }
  for await (const chunk of upstreamRes.body) res.write(chunk);
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (RUNTIME.test(pathname)) return await proxyRuntime(pathname, url.search, req.method, res);
    // Any other runtime-looking path is a mistake, not the app shell.
    if (pathname.startsWith('/lean-wasm/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not a runtime asset: ${pathname}`);
      return;
    }
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain' }).end(`proxy failed: ${error.message}`);
    return;
  }

  let filePath = resolve(join(root, normalize(pathname)));
  if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
  if (!existsSync(filePath)) {
    // Hash router: extensionless paths are the app shell, missing files are 404.
    if (extname(pathname)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    filePath = join(root, 'index.html');
  }
  if (!existsSync(filePath)) { res.writeHead(404).end('not found'); return; }

  const headers = isolate(new Headers({
    'content-type': TYPES[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
  }));
  res.writeHead(200, Object.fromEntries(headers));
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`lean-tutorials dev server: http://localhost:${port} (root ${root})`);
  console.log('cross-origin isolation: on   /lean-wasm/*: proxied to ' + upstream);
});
