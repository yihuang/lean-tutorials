// Assemble the static site into dist/ (Cloudflare Pages' build output dir).
// No bundler: the app is a handful of plain ES modules.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const from = resolve(root, 'site');
const to = resolve(root, 'dist');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`built ${to} from ${from}`);
