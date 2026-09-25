# Lean tutorials

[![CI](https://github.com/yihuang/lean-tutorials/actions/workflows/ci.yml/badge.svg)](https://github.com/yihuang/lean-tutorials/actions/workflows/ci.yml)

**Live: <https://lean-tutorials.pages.dev>** — Cloudflare Pages project `lean-tutorials`.

Short, interactive Lean 4 tutorials where **the real Lean kernel checks your proof
on your own device**. No proof server, no account, nothing you type is sent
anywhere: Lean 4 is compiled to WebAssembly and runs in a Web Worker in the
browser, and the tutorial UI is a few plain ES modules with no framework.

Built mobile-first — big tap targets, a symbol bar, Lean's `\forall`-style
abbreviations, and a sticky Check button — because a phone keyboard cannot type
`∀` on its own.

```
site/
  index.html                 app shell (single page, hash router)
  lean-worker.worker.js      vendored Lean WASM host (see Attribution)
  _headers                   COOP/COEP — required for SharedArrayBuffer
  assets/app.css             mobile-first styles
  src/main.js                router, engine status, lesson pages, sandbox
  src/lean/config.js         pinned runtime release + asset base
  src/lean/engine.js         boot the worker, stage Init, compile
  src/lean/packs.js          the packed Init closure (5 gzip packs)
  src/lean/source.js         lesson + learner tactics → one Lean file
  src/lean/tutorial.js       the two-pass "Check" (errors + open goals)
  src/lean/diagnostics.js    JSON diagnostics → learner line numbers
  src/lean/goals.js          turn `trace_state` output into goal panels
  src/lean/unicode.js        Lean unicode abbreviations + symbol bar
  src/lessons/index.js       lesson content
  src/ui/                    editor, prose, DOM helpers
functions/lean-wasm/[[path]].js   Cloudflare Pages Function: same-origin runtime
scripts/serve.mjs            local server (isolation headers + same proxy)
scripts/build.mjs            copy site/ → dist/
tests/                       unit tests + headless-Chromium proof of life
```

## Quick start

```bash
npm run dev          # http://localhost:8788  (add ?mem=768 on low-memory machines)
npm test             # pure-function tests, no browser needed
npm run test:e2e     # boots the real runtime in headless Chromium and checks every lesson
npm run test:layout  # mobile geometry: no overflow, tap targets, sticky actions
npm run test:a11y    # WCAG contrast for every text style, light and dark
```

Every browser test accepts `--url <origin>` to run against a deployed origin
instead of localhost, e.g.
`node tests/browser-check.mjs --url https://lean-tutorials.pages.dev`.

All browser tests share one persistent Chromium profile
(`tests/.artifacts/chrome-profile`), so the runtime is downloaded once ever and
subsequent runs boot from the cache. Pass `--fresh` to wipe it (that is the only
time a test pays for the 47 MB again).

## What a repeat visit costs

`npm run test:cache` boots the page three times in the shared profile and reports
the bytes that actually crossed the wire (`transferSize`, plus the server's own
byte log when the test is also the server):

| | cold visit | every visit after |
|---|---|---|
| `lean.js` (glue) | 42 KB | 0 B |
| `lean.wasm` | 16.1 MB | 0 B |
| `core-layer.json` | 31 KB | 0 B |
| packed Lean core (5 packs) | 30.7 MB | 0 B |
| **total** | **~47 MB** | **0 B** |
| Lean start | ~25 s cold on a 2-vCPU box | ~17 s warm |

The browser's HTTP cache holds all of it, including the 100 MB wasm: the runtime
URLs are immutable and versioned (`?v=<release>`), the packs and manifest carry
`max-age=86400`, and the page never uses `cache: 'no-cache'` on them. A warm
start on this 2-vCPU container splits as ~14 s wasm compile/instantiate, ~1.7 s
inflating and staging the core library, ~1.5 s Init import — the compile is what
dominates here, and it is much faster on ordinary hardware.

The engine status panel (tap the chip in the header) reports the same thing from
the app's point of view: "This visit: 0 MB downloaded, 30.7 MB of Lean core
served from the browser cache."

The first page load downloads the runtime (about **47 MB brotli-compressed**:
~40 KB of JS glue, ~16 MB wasm, ~31 MB of packed Lean core) and imports the Init
environment (~1 s once staged). Everything after that is cached by the browser,
and a proof check takes tens of milliseconds.

## How it works

**Same origin is mandatory.** The upstream runtime is a pthread build: `lean.js`
spawns its own sub-workers and they `importScripts()` the glue, so the bytes can
never be loaded cross-origin. Cross-origin isolation (`COOP: same-origin` +
`COEP: require-corp`) is equally mandatory, because the wasm memory is shared
(`SharedArrayBuffer`). This is why GitHub Pages cannot host it and why the site
serves the runtime from its own origin:

- locally, `scripts/serve.mjs` proxies `/lean-wasm/*` and sets the headers,
- on Cloudflare Pages, `functions/lean-wasm/[[path]].js` does exactly the same,
  and `site/_headers` sets the isolation headers for the document and the worker.

**The runtime is pinned, not "latest".** Upstream serves two different Lean
builds under the same path; only the versioned "compact exports" release works
here and is 160× smaller in JS glue (see `src/lean/config.js`). The proxy forwards
`?v=` so the pinned build is immutable-cached.

**Init only.** The resident worker elaborates against Lean's `Init` environment
(`lean_wasm_compile`), which cannot `import` anything — so no Mathlib, but the
core tactics learners need are all there: `rfl`, `intro`, `exact`, `apply`,
`constructor`, `rcases`, `rw`, `simp`, `induction`, `omega`, `decide`, `#check`,
`#eval`.

**Checking a proof is two compiles** (`src/lean/tutorial.js`):

1. the lesson statement plus the learner's tactic block — any error here is a
   real error, mapped back to *their* line numbers;
2. the same file plus a wrapper that traces every remaining goal
   (`all_goals (trace "<marker>"; trace_state)`) and then closes them with a
   `private axiom`, so "proof finished" is distinguishable from "Lean stopped
   complaining". The first pass alone cannot tell you that.

A pass is accepted only if pass 1 has no errors **and** pass 2 reports zero
remaining goals, and `sorry` / `admit` / `native_decide` / `Lean.ofReduceBool`
are refused up front (comment- and string-aware).

## Continuous deployment

`.github/workflows/ci.yml` runs on every push and pull request:

| job | what it proves |
|---|---|
| `unit` | pure functions, lesson data shape, and that `dist/` has `_headers` + the worker |
| `browser` | mobile geometry, contrast in both schemes, **a real Lean WASM boot that kernel-checks every lesson**, and that a repeat visit re-downloads 0 bytes |
| `deploy` | on `main` only, after both pass: `wrangler pages deploy`, then a smoke test for HTTP 200, the COOP/COEP headers, the runtime proxy, and `?v=` validation |

Required repository secrets (Settings → Secrets and variables → Actions):

```
CLOUDFLARE_API_TOKEN   token with Pages:Edit
CLOUDFLARE_ACCOUNT_ID  the account that owns the lean-tutorials project
```

Set them with the CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo yihuang/lean-tutorials
gh secret set CLOUDFLARE_ACCOUNT_ID --repo yihuang/lean-tutorials
```

No secrets are needed for the test jobs, and the browser job hits the same public
upstream runtime the site uses. One caveat, learned the hard way: **Cloudflare
challenges datacenter IP ranges on lean.cau.li**, so a GitHub runner may be
refused the wasm. The job probes for this through its own proxy and, if the
runtime is not served, skips the Lean boot (with a warning and a job-summary
note) instead of failing on an unreadable wasm. To make that gate unconditional,
self-host the runtime (below) — then nothing external can skip it.

Alternatively, connect the Pages project to this
repository in the Cloudflare dashboard (build command `npm run build`, output
directory `dist`) and drop the deploy job — Cloudflare would then build each push
itself.

## Deploying by hand

The site is static (`dist/`) plus one Pages Function. `_headers` must ship, or
`SharedArrayBuffer` is unavailable and Lean cannot start.
```bash
export CLOUDFLARE_API_TOKEN=…       # a token with Pages:Edit, or `npx wrangler@4 login`
export CLOUDFLARE_ACCOUNT_ID=…
npx wrangler@4 pages project create lean-tutorials --production-branch main   # once
npm run deploy
```

`npm run deploy` builds `dist/` and uploads the assets, `_headers` and the
Functions bundle to the production branch. Project settings:

- **Build output directory**: `dist`
- **Functions directory**: `functions` (repo root, picked up automatically)
- No environment variables, no bindings, no database.

For CI later, point a Pages Git integration at this repo: build command
`npm run build`, output directory `dist`.

Run the browser checks against the deployed origin rather than localhost:

```bash
npm run test:e2e    -- --url https://lean-tutorials.pages.dev
npm run test:layout -- --url https://lean-tutorials.pages.dev
npm run test:a11y   -- --url https://lean-tutorials.pages.dev
```

To get an ephemeral public URL without any account (handy for a phone test),
serve locally and tunnel it:

```bash
npm run preview      # terminal 1
npm run tunnel       # terminal 2 → https://<random>.trycloudflare.com
```

Cloudflare terminates TLS and compresses the proxied runtime, so the numbers you
see are the production ones. Quick tunnels are short-lived: they drop after a
while and then need a restart.

## Updating the Lean runtime

The runtime comes from upstream's published release (see `src/lean/config.js`):

- binary: `https://lean.cau.li/lean-wasm/lean.{js,wasm}?v=<assetVersion>`
- packed core: `https://lean.cau.li/lean-wasm/core-layer.json` + `core-lib/*.pack`

To move to a new release, set `LEAN_ASSET_VERSION` to the new `assetVersion` from
upstream's `deploy/runtime-release.json` and re-run `npm run test:e2e`. If the old
release disappears, the app now fails with an explicit "pinned Lean runtime …
is not available" message instead of a blank worker.

### Self-hosting the runtime instead (no third-party dependency)

Everything the proxy does can be served from your own account:

1. Download `lean-runtime-fixture.tar.gz` from
   [upstream's runtime release](https://github.com/cauli/lean4-wasm-in-browser/releases)
   and take `runtime/lean.js` + `runtime/lean.wasm` (or the `slim/` pair).
2. `wrangler r2 bucket create lean-assets`, upload the two files, bind the bucket
   as `LEAN_ASSETS` in `wrangler.jsonc`, and serve them from the Function exactly
   as upstream's own `functions/lean-wasm/[[path]].js` does.
3. Copy `core-layer.json` and `core-lib/*.pack` into `site/lean-wasm/` and delete
   the proxy branch — each pack is ~6.6 MB, under Pages' 25 MB per-file limit.

Step 3 alone already removes most third-party traffic; the 100 MB wasm is the only
file that needs R2 (or chunking) because of Pages' per-file limit.

## Adding a lesson

Append an object to `src/lessons/index.js`. Lessons own the statement, learners
own one indented tactic block, so a learner can never redefine what they are
proving:

```js
{
  id: 'le', title: 'Order and arithmetic', focus: 'le_trans',
  summary: 'Chain two inequalities',
  intro: 'Prose with `code`, **bold** and [links](https://…).',
  task: 'Prove the goal using `h₁` and `h₂`.',
  statement: 'example (a b c : Nat) (h₁ : a ≤ b) (h₂ : b ≤ c) : a ≤ c',
  placeholder: 'one tactic is enough here',
  hint: '`exact Nat.le_trans h₁ h₂`',
  solution: 'exact Nat.le_trans h₁ h₂',
}
```

`placeholder` is a grey prompt inside an otherwise **empty** editor (the HTML
`placeholder` attribute), so a learner never has to select and delete filler
text before typing. `npm test` asserts that the placeholder is not the solution
and does not look like a comment to remove.

`npm test` asserts the shape of every lesson and `npm run test:e2e` proves that
each `solution` is kernel-checked while an untouched (empty) lesson is refused — add a lesson,
re-run both, and it is covered. `tests/browser-check.mjs` also asserts that open
goals are shown, that errors point at the learner's own lines, and that error
messages use the learner's (not the generated file's) numbering.

## Limits and notes

- **Memory.** The runtime needs a shared wasm memory; the page picks 2 GB on
  desktops and steps down (1 GB/768 MB/512 MB) on phones, and `?mem=<MB>`
  overrides it for testing. A tab needs roughly 300–500 MB of real memory to hold
  the wasm plus the packed Init library.
- **Re-downloads.** There are none after the first visit (see above). If a
  browser evicts the 100 MB wasm under storage pressure, it is fetched once more
  and cached again — the app reports what it downloaded in the status panel.
- **iOS** needs a recent Safari; the upstream project ships a separate "slim"
  build for phones, which this site does not use yet.
- **`?mem=`**, `window.leanTutorials` (engine + checker + lessons) and
  `tests/debug-boot.mjs` / `tests/debug-goals.mjs` exist for debugging a stuck or
  surprising proof.
- Progress is stored in `localStorage` (`lean-tutorials:v1`); there is no backend
  and no analytics.

## Attribution

The WebAssembly Lean build and the packed core library come from
[**cauli/lean4-wasm-in-browser**](https://github.com/cauli/lean4-wasm-in-browser)
(live at [lean.cau.li](https://lean.cau.li)), Apache-2.0. This project depends on
their published runtime release and vendors
`public/lean-worker-persistent.worker.js` as `site/lean-worker.worker.js` (the
boot sequence is delicate and proven; the only changes are an attribution header
and device-aware wasm memory sizing). The upstream licence is included as
`site/UPSTREAM-LICENSE-Apache-2.0.txt`; the live origin is credited in the site
footer. The lesson content here is original.
