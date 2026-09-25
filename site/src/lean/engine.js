// Client for the vendored Lean WASM worker (site/lean-worker.worker.js).
//
// Boot order matters and mirrors upstream:
//   1. start the worker, hand it an empty library ("load_library" + "start_worker"),
//   2. once the runtime is up ("worker_ready"), stream the packed Init closure in
//      with "add_files" (olean + .ir + .ir.sig bytes written into MEMFS),
//   3. compile an empty file once. That first compile is what runs the Init
//      import, which then becomes the resident environment every later compile
//      reuses — so subsequent checks take milliseconds.
//
// Compile output arrives as "stdout"/"stderr" events; the fork emits one JSON
// diagnostic per line (see diagnostics.js).

import { corePackStream } from './packs.js';
import { LEAN_ASSET_VERSION, LEAN_WASM_BASE, workerQuery } from './config.js';

const WORKER_URL = '/lean-worker.worker.js';

/** @typedef {{severity: string, message: string, caption?: string, kind?: string, pos?: {line: number, column: number}, endPos?: {line: number, column: number}, raw?: string}} Diagnostic */
/** @typedef {{stream: 'stdout'|'stderr', data: string}} OutputChunk */
/** @typedef {{success: boolean, elapsed?: number, error?: string, output: OutputChunk[]}} CompileResult */

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export class LeanEngine {
  constructor() {
    /** @type {'idle'|'booting'|'staging'|'importing'|'ready'|'error'} */
    this.state = 'idle';
    /** @type {{message: string, percent: number|null, detail?: string}} */
    this.progress = { message: 'Starting Lean…', percent: null };
    /** @type {Error|null} */
    this.error = null;
    /** @type {Worker|null} */
    this.worker = null;
    /** @type {Set<(engine: LeanEngine) => void>} */
    this.listeners = new Set();
    /** @type {Map<string, ArrayBuffer>} */
    this.loadedPaths = new Map();
    // What this visit cost over the network: the packed core is fetched from the
    // page, so resource timing tells us cache hit vs download exactly.
    this.networkBytes = { downloaded: 0, cached: 0 };
    this.booted = false;
    this._booting = null;
    this._queue = Promise.resolve();
  }

  /** Subscribe to state/progress changes. Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    for (const listener of this.listeners) listener(this);
  }

  _setState(state, message) {
    this.state = state;
    if (message) this.progress = { message, percent: this.progress.percent };
    this._emit();
  }

  _setProgress(message, percent, detail) {
    this.progress = { message, percent, detail };
    this._emit();
  }

  /** Boot the runtime. Safe to call repeatedly; only the first call does work. */
  start() {
    if (!this._booting) this._booting = this._boot().catch((error) => {
      this.error = error;
      this._setState('error', `Lean could not start: ${error.message}`);
      throw error;
    });
    return this._booting;
  }

  async _boot() {
    this._setState('booting', 'Starting Lean runtime…');
    // Fail loudly if the pinned runtime release is gone from upstream, or if
    // something in between is serving HTML where wasm should be (captive
    // portals, corporate proxies, and CI runners whose IP upstream's bot
    // protection challenges). Without this, Emscripten reports "expected magic
    // word" and nobody can tell what happened.
    for (const [file, expected] of [['lean.js', 'javascript'], ['lean.wasm', 'application/wasm']]) {
      const url = `${LEAN_WASM_BASE}/${file}?v=${encodeURIComponent(LEAN_ASSET_VERSION)}`;
      let response;
      try {
        response = await fetch(url, { method: 'HEAD' });
      } catch (error) {
        throw new Error(`could not reach the Lean runtime: ${error.message}`);
      }
      if (!response.ok) {
        const upstream = response.headers.get('x-upstream-status');
        throw new Error(`pinned Lean runtime ${LEAN_ASSET_VERSION} is not available for ${file} ` +
          `(HTTP ${response.status}${upstream ? `, upstream ${upstream}` : ''}) — see site/src/lean/config.js`);
      }
      const type = response.headers.get('content-type') ?? '';
      if (type && !type.includes(expected)) {
        throw new Error(`${file} came back as "${type}", not ${expected}. ` +
          'Something between this browser and the runtime is rewriting the response ' +
          '(a network filter, or a block on this IP range).');
      }
    }
    // Pack downloads are the long pole; start them immediately and let them
    // overlap with the ~25 MB (`lean.js` + `lean.wasm`) runtime download.
    const packs = corePackStream(({ index, count, received, total, downloadedBytes, cachedBytes }) => {
      this.networkBytes = { downloaded: downloadedBytes, cached: cachedBytes };
      if (this.state === 'staging' || this.state === 'booting') {
        this._setProgress(
          `Downloading the Lean core library (${Math.round(received / 1048576)}/${Math.round(total / 1048576)} MB)`,
          8 + Math.round((received / total) * 52),
          `pack ${index + 1} of ${count}`,
        );
      }
    });
    const firstPack = packs.next();

    await this._startWorker();
    this._setState('staging', 'Loading the Lean core library…');

    for (let step = await firstPack; !step.done; step = await packs.next()) {
      await this._stagePack(step.value);
    }

    this._setState('importing', 'Importing Lean core (first run only)…');
    const warm = await this.compile('');
    if (!warm.success) {
      throw new Error(warm.error || 'the Lean runtime rejected the warm-up compile');
    }
    this._setState('ready', 'Lean ready');
    this._setProgress('Lean ready', 100, this.networkBytes.downloaded === 0
      ? 'The Lean core came from the browser cache this visit — no download.'
      : `${(this.networkBytes.downloaded / 1048576).toFixed(1)} MB of Lean core downloaded (cached for next time).`);
    return true;
  }

  _startWorker() {
    const ready = deferred();
    const mem = new URLSearchParams(location.search).get('mem');
    const query = workerQuery(mem ? { mem } : {});
    const worker = new Worker(`${WORKER_URL}?${query}`);
    this.worker = worker;

    worker.onmessage = (event) => {
      const message = event.data || {};
      switch (message.type) {
        case 'worker_boot':
          worker.postMessage({ type: 'load_library', files: [] });
          break;
        case 'library_received':
          worker.postMessage({ type: 'start_worker' });
          break;
        case 'worker_ready':
          this.booted = true;
          ready.resolve();
          break;
        case 'files_added':
          this._filesPending?.resolve();
          this._filesPending = null;
          break;
        case 'compile_result':
          this._compilePending?.watchdog && clearTimeout(this._compilePending.watchdog);
          this._compilePending?.resolve(message);
          this._compilePending = null;
          break;
        case 'stdout':
        case 'stderr':
          this._collector?.push({ stream: message.type, data: String(message.data ?? '') });
          if (this._compilePending) this._compilePending.lastActivity = Date.now();
          break;
        case 'progress':
          if (message.data) this._setProgress(String(message.data), this.progress.percent);
          break;
        case 'import_progress': {
          const loaded = Number(message.loaded) || 0;
          const total = Number(message.total) || 0;
          if (total > 0) {
            this._setProgress(`Importing Lean core: ${loaded} / ${total} modules`, 62 + Math.round((loaded / total) * 38));
          }
          if (this._compilePending) this._compilePending.lastActivity = Date.now();
          break;
        }
        case 'activity':
          if (this._compilePending) this._compilePending.lastActivity = Date.now();
          break;
        case 'error': {
          const error = new Error(String(message.error || message.data || 'Lean runtime error'));
          ready.reject(error);
          this._compilePending?.resolve({ success: false, error: error.message });
          this._compilePending = null;
          break;
        }
        default:
          break;
      }
    };

    worker.onerror = (event) => {
      const error = new Error(event.message || 'The Lean worker failed to start');
      ready.reject(error);
    };

    return ready.promise;
  }

  async _stagePack({ files }) {
    /** @type {{name: string, data: ArrayBuffer}[]} */
    const payload = [];
    /** @type {ArrayBuffer[]} */
    const transfer = [];
    for (const [name, bytes] of files) {
      if (this.loadedPaths.has(name)) continue;
      const buffer = bytes.buffer.byteLength === bytes.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
      payload.push({ name, data: buffer });
      transfer.push(buffer);
      this.loadedPaths.set(name, buffer);
    }
    if (payload.length === 0) return;
    const done = deferred();
    this._filesPending = done;
    this.worker.postMessage({ type: 'add_files', files: payload }, transfer);
    await done.promise;
  }

  /**
   * Compile one Lean source string. Calls are serialised: the worker handles a
   * single compile at a time, and the tutorial UI debounces anyway.
   *
   * @param {string} code
   * @param {string} [path]
   * @returns {Promise<CompileResult>}
   */
  compile(code, path = '/workspace/Tutorial.lean') {
    const run = () => this._compileOnce(code, path);
    const result = this._queue.then(run, run);
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }

  _compileOnce(code, path) {
    if (!this.worker) return Promise.resolve({ success: false, error: 'Lean is not running', output: [] });
    const pending = deferred();
    const output = [];
    this._collector = output;
    this._compilePending = {
      resolve: (message) => {
        this._collector = null;
        pending.resolve({
          success: Boolean(message.success),
          elapsed: message.elapsed,
          error: message.error,
          output: output.slice(),
        });
      },
      lastActivity: Date.now(),
      watchdog: null,
    };
    // The first compile imports Init; later ones are milliseconds. A stuck
    // worker (out-of-memory kill, corrupt artifact) must surface instead of
    // leaving the Check button spinning forever.
    this._compilePending.watchdog = setTimeout(() => {
      this._compilePending = null;
      this._collector = null;
      pending.resolve({ success: false, error: 'Lean stopped responding (timed out).', output: output.slice() });
    }, code === '' ? 300_000 : 120_000);

    this.worker.postMessage({ type: 'compile', code, path });
    return pending.promise;
  }
}
