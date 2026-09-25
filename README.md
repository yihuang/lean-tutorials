# Lean tutorials

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

## Deploying to Cloudflare Pages

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
  starter: '-- one tactic is enough',
  hint: '`exact Nat.le_trans h₁ h₂`',
  solution: 'exact Nat.le_trans h₁ h₂',
}
```

`npm test` asserts the shape of every lesson and `npm run test:e2e` proves that
each `solution` is kernel-checked while each `starter` is rejected — add a lesson,
re-run both, and it is covered. `tests/browser-check.mjs` also asserts that open
goals are shown, that errors point at the learner's own lines, and that error
messages use the learner's (not the generated file's) numbering.

## Limits and notes

- **Memory.** The runtime needs a shared wasm memory; the page picks 2 GB on
  desktops and steps down (1 GB/768 MB/512 MB) on phones, and `?mem=<MB>`
  overrides it for testing. A tab needs roughly 300–500 MB of real memory to hold
  the wasm plus the packed Init library.
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
