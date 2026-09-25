// Pinned browser runtime.
//
// The upstream origin serves two different Lean WebAssembly builds under the
// same `/lean-wasm/lean.js` path:
//
//   * unversioned  — the old export-everything build (137 MB wasm, 201k exports,
//                    89 MB of JS glue), which declares a 2 GiB maximum memory,
//   * `?v=<id>`    — the pinned "compact exports" release (100.8 MB wasm, 104k
//                    exports, ~148 KB of JS glue, 4 GiB maximum memory).
//
// Only the second one is usable here: it declares min 64 MB / max 4 GiB shared
// memory, keeps the worker's pthread pool compatible, and turns the JS download
// from ~6.5 MB into ~40 KB. The id is the `assetVersion` from upstream's
// deploy/runtime-release.json; the olean packs are content-pinned separately and
// stay on unversioned URLs (upstream serves them the same way).
//
// Updating the runtime = bumping this string (and re-running tests/browser-check.mjs).
export const LEAN_ASSET_VERSION = '62b6a2291302d4bbeace37642a066b7510d0145c-dlsym1-compact1';

/** Same-origin base for the heavy runtime, served by functions/lean-wasm/. */
export const LEAN_WASM_BASE = '/lean-wasm';

/** Query string handed to the worker: it builds `lean.js?v=…` from this. */
export function workerQuery(extra = {}) {
  const params = new URLSearchParams({ assetBase: LEAN_WASM_BASE, v: LEAN_ASSET_VERSION, ...extra });
  return params.toString();
}
