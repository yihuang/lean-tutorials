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
  src/lean/infoview.js       cursor probe: the goals at the caret
  src/ui/infoview-panel.js   renders a probe result (cases, hypotheses, ⊢ goal)
  src/lean/unicode.js        Lean unicode abbreviations + symbol bar
  src/content/               the course: topics + lessons (data only)
  src/ui/                    editor, prose, DOM helpers
functions/lean-wasm/[[path]].js   Pages Function: streams lean.wasm from its chunks
scripts/fetch-runtime.mjs    download the pinned upstream runtime (verified)
scripts/pack-core-layer.mjs  pack the Init closure into 5 gzip packs
scripts/serve.mjs            local server (isolation headers + runtime, brotli)
scripts/build.mjs            site/ → dist/, split lean.wasm into <25 MB chunks
.env.example                 template for local Cloudflare credentials (.env)
tests/                       unit tests + headless-Chromium proof of life
```

## Quick start

```bash
npm run prepare:runtime   # once: download the pinned Lean WASM runtime (~280 MB) and pack it
npm run dev          # http://localhost:8788  (add ?mem=768 on low-memory machines)
npm test             # pure-function tests, no browser needed
npm run test:e2e     # boots the real runtime in headless Chromium and checks every lesson
npm run test:layout  # mobile geometry: no overflow, tap targets, sticky actions
npm run test:a11y    # WCAG contrast for every text style, light and dark
node tests/probe-lean.mjs   # authoring: does Lean accept this snippet?
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

The browser's HTTP cache holds all of it, including the 100 MB wasm: every
runtime URL is versioned (`?v=<release>`) and served `immutable`, and the body
arrives brotli-compressed (~16 MB), which is what makes it cacheable at all. A warm
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

- `scripts/serve.mjs` (local) and `site/_headers` + `functions/lean-wasm/[[path]].js`
  (Cloudflare Pages) serve and header the runtime from this origin.

**The runtime is self-hosted, fetched at build time.** `npm run prepare:runtime`
downloads the pinned release from
[cauli/lean4-wasm-in-browser](https://github.com/cauli/lean4-wasm-in-browser)
(Apache-2.0), verifies it against upstream's published SHA-256, and packs the Init
closure. Earlier versions of this project proxied `lean.cau.li` at runtime
instead, which does not work: upstream sits behind Cloudflare's bot protection,
and it answers **403 to Cloudflare worker egress from some colos** (SJC, for
example) while allowing others (HKG). That is not a CI nuisance — it silently
breaks the site for entire regions. Serving the bytes ourselves removes the
dependency, and it is also what makes caching predictable.

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

For local deploys the same two values go in `.env` (gitignored; `cp .env.example
.env`), which wrangler loads automatically.

Set them with the CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo yihuang/lean-tutorials
gh secret set CLOUDFLARE_ACCOUNT_ID --repo yihuang/lean-tutorials
```

No secrets are needed for the test jobs: they run against the self-hosted runtime,
so the same kernel check that runs locally runs on the runner (the release
download is cached between runs).

Alternatively, connect the Pages project to this
repository in the Cloudflare dashboard (build command `npm run build`, output
directory `dist`) and drop the deploy job — Cloudflare would then build each push
itself.

## Deploying by hand

The site is static (`dist/`) plus one Pages Function. `_headers` must ship, or
`SharedArrayBuffer` is unavailable and Lean cannot start.
```bash
cp .env.example .env      # then fill in the two values (wrangler reads .env itself)
npx wrangler@4 pages project create lean-tutorials --production-branch main   # once
npm run deploy
```

`.env` holds a token with **Pages: Edit** and the account id; it is gitignored
(`.env.example` is the committed template), and wrangler picks it up from the
project root without any exporting. CI does not use it — the same values live in
repository secrets there.

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

`scripts/fetch-runtime.mjs` pins one upstream release by tag, by byte length, and
by SHA-256 for both `lean.js` and `lean.wasm`; `scripts/pack-core-layer.mjs` is
deterministic, so an unchanged runtime produces byte-identical packs and Pages
re-uploads nothing.

To move to a new release:

1. update `RELEASE_TAG` and the pinned hashes in `scripts/fetch-runtime.mjs`
   (from upstream's `deploy/runtime-release.json`),
2. set `LEAN_ASSET_VERSION` in `src/lean/config.js` to that release's
   `assetVersion` — every runtime URL carries it as `?v=`, so caches cannot mix
   builds,
3. `npm run prepare:runtime -- --force && npm run build`,
4. `npm test && npm run test:e2e && npm run test:cache`.

### Why lean.wasm is chunked

Cloudflare Pages rejects any file over 25 MB, and the browser binary is ~96 MB, so
`scripts/build.mjs` splits it into 20 MB chunks inside `dist/` and
`functions/lean-wasm/[[path]].js` streams them back as one `application/wasm`
body. The assembled bytes are asserted against the pinned SHA-256 in CI.

Serving it compressed is load-bearing, not an optimisation: Chromium refuses to
cache an ~96 MB uncompressed response (its per-entry limit is a fraction of the
disk cache), so an identity body would mean re-downloading the binary on every
visit. Cloudflare's edge compresses the Function's streamed body to ~16 MB, and
`tests/cache-check.mjs` fails the build if a repeat visit transfers anything.

### Attribution

The Lean WASM build and the packed core library are redistributed here from
[cauli/lean4-wasm-in-browser](https://github.com/cauli/lean4-wasm-in-browser)
(Apache-2.0, live at [lean.cau.li](https://lean.cau.li)); the licence is included
as `site/UPSTREAM-LICENSE-Apache-2.0.txt` and the credit is in the site footer.
The binaries are not committed — `npm run prepare:runtime` fetches the pinned
release and verifies its hashes.

## The infoview: goals at the cursor

A language server answers "what is true at this position?" by elaborating a
prefix of the file and reading the goals out of the info tree. There is no server
here, but the same question can be answered with what the browser runtime gives
us: **elaborate the learner's lines 0..cursor with the goal-tracing wrapper and
parse the traces.**

```
cursor line 1 of:
    constructor          → probe compiles `… := by` + line 0 + wrapper
    exact ⟨hp, hq⟩         → traces every open goal, then closes them with an axiom
                          → parse `<marker>` + `trace_state` pairs → 2 goals (⊢ p, ⊢ q)
```

- `site/src/lean/infoview.js` — `new GoalProbe(engine).goalsAt(lesson, input, cursorLine)`.
  Mechanism only: no DOM, no content import. It reports
  `status: goals | complete | error | unsupported | stale`, the goals themselves,
  and `line` — the line the state really belongs to.
- **Back-off.** A cursor inside a multi-line tactic (`induction … with`, `calc`, a
  `·` bullet) truncates the tactic itself and Lean rejects the file, so the probe
  retries one line earlier until something elaborates and says so in the panel.
- **Empty editor or `cursorLine: -1`** probes with no tactics at all, which yields
  the statement's own goal — so the panel shows what must be proved before the
  learner has typed anything.
- **Cost control.** Results are cached by lesson + line + text, probes are
  debounced (~320 ms) and token-checked in the UI, and a newer cursor position
  makes an older probe resolve as `stale` *before* it queues another compile, so
  typing never builds a backlog.
- **File lessons** return `unsupported` (a `#check`/`#eval` file has no goals); the
  output panel is their infoview.

`site/src/ui/infoview-panel.js` renders a result as Lean prints it: the case name,
one line per hypothesis, and the `⊢` goal highlighted.

### Mobile-first placement

| | behaviour |
|---|---|
| phones (<900 px) | the panel sits **directly above the editor** — the only spot that stays visible with the soft keyboard up — capped at `34vh` with its own scroll, and collapsible to its header (the choice is remembered in `localStorage`) |
| wide screens (≥900 px) | the same element moves to a **sticky second column** beside the editor (`62vh` cap) — no duplicate DOM, just a grid `order` |

Long hypotheses wrap (`overflow-wrap: anywhere`) instead of widening the page,
which `tests/layout.mjs` asserts by injecting a 700-character hypothesis.

`npm run test:e2e` proves the whole loop against the real runtime: the panel shows
the statement's goal before any input, both subgoals with their context after
`constructor`, and flips to "complete" when the proof is finished — all without
pressing Check.

## Course structure: content vs mechanism

The course is **31 lessons in 7 topics**, and the split between material and
machinery is enforced rather than promised:

```
site/src/content/            data only — no imports from lean/ or ui/
  index.js                   contract, aggregation, accessors, validateContent()
  topics/foundations.js      one topic per module (id, title, intro, lessons)
  topics/logic.js
  topics/quantifiers.js
  topics/numbers.js
  topics/rewriting.js
  topics/automation.js
  topics/tools.js
site/src/lean/               the mechanism: compile, diagnose, verify
site/src/ui/, main.js        rendering, routing, progress
```

- **Content** declares everything: a lesson's `kind`, its statement or its
  freedom, what the answer must contain, what the output must show. It never
  knows how any of that is checked.
- **The mechanism** switches on those declared fields and never on a lesson id,
  and reaches content only through `content/index.js`. Adding a topic is then a
  content-only change — no engine, checker or UI edit.
- `tests/decoupling.test.mjs` fails if either side leaks: it greps the imports in
  both directions, rejects any `=== '<lesson-id>'` in the mechanism, and checks
  that each topic module exports exactly one topic named after its file.
- `validateContent()` is the executable version of the contract, and the unit
  tests run it (including against deliberately broken content, so the validator
  itself is tested).

### The two lesson kinds

```js
// kind: 'tactic' (default) — the lesson owns the statement, the learner owns the
// tactic block. The `:= by` and the goal-inspection wrapper are added for it.
{
  id: 'le', kind: 'tactic',
  title: 'Order and arithmetic', focus: 'le_trans',
  summary: 'Chain two inequalities',
  intro: 'Prose with `code`, **bold** and [links](https://…).',
  task: 'Prove the goal using `h₁` and `h₂`.',
  statement: 'example (a b c : Nat) (h₁ : a ≤ b) (h₂ : b ≤ c) : a ≤ c',
  placeholder: 'one tactic is enough here',
  hint: '`exact Nat.le_trans h₁ h₂`',
  solution: 'exact Nat.le_trans h₁ h₂',
}

// kind: 'file' — the learner owns the whole file, so commands (#check, #eval,
// def) can be exercises too. `require` constrains the source, `expects`
// constrains the output.
{
  id: 'double', kind: 'file',
  title: 'Your own definition', focus: 'def',
  summary: 'Define a function, then use it',
  intro: '…', task: 'Define `double` and use it to print `42`.',
  placeholder: 'def … then #eval …',
  hint: '`def double (n : Nat) := 2 * n` and then `#eval double 21`.',
  require: ['def double', 'double 21'],   // whitespace-insensitive
  expects: ['42'],                        // must appear in the output
  solution: 'def double (n : Nat) := 2 * n\n\n#eval double 21',
}
```

`placeholder` is a grey prompt inside an otherwise **empty** editor (the HTML
`placeholder` attribute), so a learner never has to select and delete filler text
before typing.

### Workflow for adding material

```bash
node tests/probe-lean.mjs                     # is this snippet accepted by the real runtime?
node tests/probe-lean.mjs --file my.json      # your own { name, statement, context, tactics }
npm test                                      # contract + decoupling + pure functions
npm run test:e2e                              # boots Lean and verifies every solution
```

`tests/probe-lean.mjs` is the important one: it boots the runtime once and runs a
list of candidate lessons through the real checker, so a lesson never ships a
solution Lean rejects. Every solution in this course was written after probing it
(and a few plausible-looking ones — `use`, `by_contra`, a three-step
`Nat.add_succ` rewrite — were dropped because Lean's Init environment refused
them).

`npm run test:e2e` then proves the contract holds end to end: each `solution` is
kernel-checked while an untouched lesson is refused, required substrings and
required output are enforced, and error messages use the *learner's* line
numbers.

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
