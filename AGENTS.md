# AGENTS.md — operating manual for this repo

For coding agents working in `lean-tutorials`. `README.md` explains what the product
is and how it works; **this file is the manual**: what to run, what CI enforces, how a
change reaches production, and the traps that have already cost time here. Read it
before changing anything that touches the runtime, the deploy, or CI.

## What this is

Interactive Lean 4 tutorials. The real Lean compiler runs in the browser as
WebAssembly; the runtime is a pinned upstream build, self-hosted from our own origin.
The course is themes → topics → lessons.

- `site/src/content/**` — course material, **data only** (themes, topics, lessons)
- `site/src/lean/**` — mechanism: compile, verify, infoview probe, runtime loading
- `site/src/ui/**`, `site/src/main.js` — rendering, routing, focus mode
- `scripts/**` — runtime fetch/pack, build, local server
- `tests/**` — unit/contract, layout, contrast, browser (real kernel), cache, probes

Tests enforce the boundary: content must not import `lean/` or `ui/`, the mechanism may
import content only through `content/index.js`, and it must never branch on a lesson id.
If you find yourself special-casing a lesson, a class name, or a platform quirk in the
mechanism, stop and put it in the content or in the data.

## Commands

```bash
npm run prepare:runtime   # once per checkout: fetch the pinned runtime + pack the core layer
npm run dev               # http://localhost:8788  (?mem=768 on low-memory machines)
npm run build             # site/ → dist/, and split lean.wasm into <25 MB chunks

npm test                  # unit + content contract + decoupling + infoview (fast, no browser)
npm run test:layout      # mobile geometry (builds dist first)
npm run test:a11y        # WCAG contrast, light + dark (builds dist first)
npm run test:e2e         # boots the real Lean runtime in Chromium; ~2 min
npm run test:cache       # proves a repeat visit transfers 0 bytes
npm run test:shots       # screenshots into /tmp/shots

node tests/probe-lean.mjs          # authoring: does Lean accept this snippet?
node tests/probe-infoview.mjs      # authoring: does the cursor probe see these goals?
node tests/debug-boot.mjs          # why is the runtime slow / stuck?
node tests/debug-goals.mjs         # raw diagnostics of the goal-inspection pass
```

Browser tests accept flags worth knowing:

| flag | effect |
|---|---|
| `--url <origin>` | run against a **deployed** site instead of a local server |
| `--fresh` | wipe `tests/.artifacts/chrome-profile` first (a cold cache) |
| `--mem <MB>` | override the wasm memory size (CI uses 2048, this box needs 768) |
| `--visits N`, `--dir site\|dist` | cache-check: how many visits, and which tree to serve |

All browser tests share one persistent profile (`tests/.artifacts/chrome-profile`), so
runs after the first do not re-download the ~47 MB runtime. Use `--fresh` when the
question involves caching, and never assume a warm profile when measuring a cold start.

## The release workflow

Every push to any branch runs `unit` → `browser` → `deploy`, and the deploy job maps the
branch to a target:

| branch | target | URL |
|---|---|---|
| `main` | **production** | `https://lean-tutorials.pages.dev` |
| `staging` | preview, stable | `https://staging.lean-tutorials.pages.dev` |
| anything else | preview, stable | `https://<branch>.lean-tutorials.pages.dev` (slashes become dashes) |

Preview deployments never touch production. Both non-main branches and main run the
*same* unit, browser, and post-deploy verification; only the branch differs.

### Step by step

1. **Implement + commit on a branch.** Run the suites that cover your change
   (`npm test`, and for UI also `test:layout`/`test:a11y`, for runtime/verify also
   `test:e2e`/`test:cache`). Do not `git add -A` inside a worktree (see Traps).
2. **Push the branch.** CI deploys a preview and prints the deployment hostname in the
   job summary (`https://<hash>.lean-tutorials.pages.dev`).
3. **Verify on the deployment hostname, not the alias.** The branch alias can keep
   serving the *previous* deployment for minutes after a push, so a check against it can
   validate the wrong artifact — that is how a broken production deploy once passed.
   Either read the CI deploy job (it targets the deployment hostname) or run
   `node tests/browser-check.mjs --url https://<hash>.lean-tutorials.pages.dev --mem 768`.
4. **Promote to staging** for hands-on testing by fast-forwarding it:
   `git push origin <branch>:staging` (CI redeploys `staging.lean-tutorials.pages.dev`).
5. **Promote to production** by landing on `main` (`git push origin <branch>:main`, or a
   merge). The deploy job then: deploys, smoke-tests the deployment's own hostname
   (COOP/COEP, runtime manifest parses, a chunk is served and is not HTML, an unknown
   runtime path is a 404), checks the chunks arrive brotli-compressed, runs the full
   browser suite against that deployment, and re-runs the cache test.
6. **Report what CI actually verified.** Quote the deploy job's lines (e.g.
   `deployment smoke test passed for …`, `✓ Lean ready in …`, `✓ repeat visits: 0 bytes`).
   A local run is not evidence about production.

### Credentials

- CI needs repository secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and
  `CLOUDFLARE_ACCOUNT_ID`.
- Locally, wrangler reads the gitignored `.env` (see `.env.example`); nothing needs to
  be exported. `npm run deploy` targets **production** from your machine — prefer CI for
  `main`, and use `npx wrangler@4 pages deploy dist --branch <name> --commit-dirty=true`
  for a preview when you need one fast.

## What CI enforces (do not fight these)

- **The deployment, not the alias.** Smoke tests and the deployed browser suite run
  against the per-deployment hostname. The alias lag is reported as a warning, not a
  failure.
- **The runtime is asserted, not assumed**: `runtime.json` parses with
  `variant: "full"` and a chunk list, the first chunk is served and is not HTML, an
  unknown `/lean-wasm/*` path is a 404, and chunks arrive with `content-encoding: br`.
- **Chunks reassemble to the pinned hash** and no file exceeds Pages' 25 MB limit.
- **0 bytes on a repeat visit** (`tests/cache-check.mjs`), which is why compression and
  cache headers are load-bearing rather than cosmetic.
- **The progress text never claims a download** on a visit that transferred nothing; the
  browser suite reloads and asserts the warm wording, and the status panel reports the
  real phase breakdown (WebAssembly compile / core library / Init import).
- **Content/mechanism decoupling**, the lesson/topic/theme contract, and that every
  class the app renders is styled (a deleted stylesheet block once left topic pages bare).

## The runtime: pinned, chunked, assembled in the browser

`site/src/lean/config.js` pins `LEAN_ASSET_VERSION`; `scripts/fetch-runtime.mjs` pins the
upstream release tag plus byte counts and SHA-256 for **both** variants.

```
site/lean-wasm/            dev tree (gitignored), one chunk + manifest
  lean.js  lean.wasm.chunk-000  runtime.json  core-layer.json  core-lib/*.pack
dist/lean-wasm/            production: lean.wasm split into lean.wasm.part-NNN
```

- The worker fetches the chunks, concatenates them, and hands the bytes to Emscripten
  through a narrow `fetch` shim. There is **no `functions/`** and there must not be one:
  Cloudflare Pages Functions were never invoked for this project (verified with a trivial
  `functions/diag.js` that returned the app shell), which is what made production unable
  to start Lean at all.
- `/lean-wasm/lean.wasm` must never exist. Emscripten falls back to fetching that name,
  and while it existed in the dev tree the local suite passed while production could not
  work.
- Chunks are typed `application/wasm` in `site/_headers` **because Cloudflare does not
  compress `application/octet-stream`**: that is 2.98 MB instead of 20.97 MB per chunk on
  the wire, which is what makes them cacheable.
- `variant: slim` (~70 MB, Init-only) is an opt-in alternative via
  `npm run prepare:runtime -- --variant slim`; it trades the compile for a much slower
  Init import, so `full` stays the default and CI asserts which one is staged.

### Upgrading the runtime

1. Update `RELEASE_TAG` and the pinned hashes/byte counts in `scripts/fetch-runtime.mjs`
   (from upstream's `deploy/runtime-release.json`).
2. Update `LEAN_ASSET_VERSION` in `site/src/lean/config.js`.
3. `npm run prepare:runtime -- --force && npm run build`.
4. Run the full suite, then push and verify on the preview before promoting.

## Traps

- **Alias lag.** A branch alias repoints minutes after a deploy. Verifying it right after
  a push validates the previous deployment. Always name the deployment hostname.
- **Masked local paths.** If a runtime file exists locally but not in production (or the
  reverse), the local suite proves nothing. Keep the dev tree structurally identical to
  `dist` (which is why the fetched binary is named `lean.wasm.chunk-000`).
- **`404.html` plus a Function.** With a `404.html` present, Pages' static layer answers
  requests that would otherwise reach a Function. Since there are no Functions, the
  404 page is safe and desirable (typos become honest 404s).
- **YAML duplicate keys.** PyYAML accepts them; GitHub rejects the whole workflow file
  ("This run likely failed because of a workflow file issue"). Validate with a
  duplicate-key check before pushing workflow edits.
- **Shell quoting in workflows.** A `node -e '…'` script is a single-quoted shell
  argument: use double quotes inside it, or the shell ends the string early
  (`ReferenceError: full is not defined`).
- **The npm lockfile registry.** `.npmrc` pins `registry.npmjs.org`; if a lockfile ever
  points at a mirror, `npm ci` fails on CI. Regenerate the entry instead of editing hosts.
- **Worktrees and symlinks.** Worktrees symlink `.runtime-cache`, `site/lean-wasm` and
  `.env`; they are ignored via `.git/info/exclude`. Never `git add -A` there — commit
  explicit paths.
- **Unfolding a lesson's own `context` definition poisons the runtime.** Every tactic
  lesson is compiled twice (the plain pass and the goal-tracing pass), and this runtime
  cannot unfold a `def` that the *same* compile declares: the second compile returns
  `lean_wasm_compile returned an IO error (tag != 0)` and every later compile in that
  worker fails the same way. So do not write `simp [d]`, `grind [d]`, `rw [d]` or (for a
  recursive `d`) `unfold d` against a name from `context`. Safe alternatives: prove by
  `rfl`/defeq, rewrite with the function's equational lemmas or `@[simp]` helper theorems
  declared in the same `context`, use `unfold d` only for a non-recursive `def`, or
  declare a non-recursive `context` helper as `abbrev` (then `simp [d]` is fine). The
  browser suite runs every lesson in one worker, so a lesson that triggers this is
  reported as a cascade of `runtime: Lean could not finish` failures after it.
- **The goal-trace protocol has one owner** (`site/src/lean/goals.js`): Lean merges traces
  that share a source position (`marker\nmarker` then one message holding both goal
  states), which once made an open proof report as complete. Do not re-implement the
  parse elsewhere; there is a regression test built from the runtime's actual output.
- **The wasm compile dominates a cold start** (seconds on a laptop, ~25 s on a 2-vCPU
  container) and cannot be cached across page loads. Say so in user-facing text; do not
  present it as a download.

## Triage: "the Lean runtime does not start"

1. `curl -sI https://<deployment>.pages.dev/lean-wasm/runtime.json` → 200
   `application/json`? Then
   `curl -sI https://<deployment>.pages.dev/lean-wasm/lean.wasm.part-000` → must be
   `application/wasm` with `content-encoding: br` and **not** `text/html`.
2. If HTML, something is rewriting or shadowing the path: check for a `404.html`
   interferer, a stray `functions/` directory, or a host/proxy that is not serving the
   deployment you think it is.
3. The engine's preflight fails with a precise message (missing manifest, missing chunk,
   HTML instead of a chunk) — that message names the cause; Emscripten's
   "expected magic word" means the bytes were HTML.
4. Tap the header chip for the phase breakdown and whether bytes were downloaded; a
   repeat visit should report "nothing was downloaded this visit".
5. `node tests/debug-boot.mjs` prints the boot timeline and the worker's console.
