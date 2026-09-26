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
    // The current phase, and a ticking clock for it: a page load that spends ~15 s
    // compiling WebAssembly must look alive, or it reads as a hang.
    this._phase = null;
    this._phaseMessage = '';
    this._phaseStarted = 0;
    this._ticker = null;
    this._packProgress = null;
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
    // Phase timeline, so the slow part of a page load is measurable instead of
    // guessed. Entries are { phase, at } with `at` in ms since the engine started.
    this.timeline = [];
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

  _mark(phase) {
    if (!this._t0) this._t0 = performance.now();
    this.timeline.push({ phase, at: Math.round(performance.now() - this._t0) });
  }

  _setState(state, message) {
    this.state = state;
    if (message) this.progress = { message, percent: this.progress.percent };
    this._emit();
  }

  _setProgress(message, percent, detail) {
    this._phaseMessage = message;
    this.progress = { message: this._withElapsed(message), percent, detail: detail ?? this.progress.detail };
    this._emit();
  }

  _withElapsed(message) {
    if (!this._phaseStarted || this.state === 'ready' || this.state === 'error') return message;
    const seconds = Math.floor((performance.now() - this._phaseStarted) / 1000);
    return seconds >= 1 ? `${message} · ${seconds}s` : message;
  }

  _setPhase(phase, message) {
    this._phase = phase;
    this._phaseStarted = performance.now();
    this._setProgress(message, this.progress.percent);
    if (this._ticker) return;
    this._ticker = setInterval(() => {
      if (!this._phase) return;
      this.progress = { ...this.progress, message: this._withElapsed(this._phaseMessage) };
      this._emit();
    }, 1000);
  }

  _stopTicker() {
    if (this._ticker) clearInterval(this._ticker);
    this._ticker = null;
    this._phase = null;
  }

  /** Human summary of where the cold start went, using the phase timeline. */
  _startupDetail() {
    const at = Object.fromEntries(this.timeline.map((mark) => [mark.phase, mark.at]));
    const seconds = (from, to) => (from !== undefined && to !== undefined ? ((to - from) / 1000).toFixed(1) : null);
    const wasm = seconds(at['worker-script'], at['wasm-ready']);
    const staging = seconds(at['wasm-ready'], at['packs-staged']);
    const importing = seconds(at['packs-staged'], at.ready);
    const { downloaded } = this.networkBytes;
    const parts = [
      wasm && `WebAssembly compile ${wasm}s`,
      staging && `core library ${staging}s`,
      importing && `Init import ${importing}s`,
    ].filter(Boolean);
    return [
      `Started in ${((at.ready ?? 0) / 1000).toFixed(1)}s: ${parts.join(', ')}.`,
      downloaded === 0
        ? 'Nothing was downloaded this visit — the runtime came from the browser cache.'
        : `${(downloaded / 1048576).toFixed(1)} MB downloaded, cached for next time.`,
      'The WebAssembly compile itself happens on every page load.',
    ].join(' ');
  }

  /** While staging owns the message, say honestly whether bytes are moving. */
  _reportPackProgress() {
    const pack = this._packProgress;
    if (!pack) return;
    const mb = (bytes) => (bytes / 1048576).toFixed(1);
    const cached = (pack.downloadedBytes ?? 0) === 0;
    this._setProgress(
      cached
        ? `Unpacking the cached Lean core (pack ${pack.index + 1} of ${pack.count})`
        : `Downloading the Lean core library (${mb(pack.received)}/${mb(pack.total)} MB)`,
      8 + Math.round((pack.received / pack.total) * 52),
      `pack ${pack.index + 1} of ${pack.count}, ${cached ? 'from the browser cache' : 'from the network'}`,
    );
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
    this._mark('boot');
    this.state = 'booting';
    this._setPhase('booting', 'Starting the Lean runtime (compiling WebAssembly)');
    // Fail loudly if a runtime file is missing, or if something in between is
    // serving HTML where wasm should be (captive portals, corporate proxies,
    // aggressive filters). Without this, Emscripten reports "expected magic
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
        throw new Error(`the built-in Lean runtime is missing ${file} (HTTP ${response.status}). ` +
          'Run `npm run prepare:runtime` and rebuild (see site/src/lean/config.js).');
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
      this._packProgress = { index, count, received, total, downloadedBytes };
      // Only staging reports pack numbers: during the compile that text would sit
      // frozen and read as a stalled download.
      if (this.state === 'staging') this._reportPackProgress();
    });
    const firstPack = packs.next();

    await this._startWorker();
    this.state = 'staging';
    this._setPhase('staging', 'Loading the Lean core library');
    this._reportPackProgress();

    for (let step = await firstPack; !step.done; step = await packs.next()) {
      await this._stagePack(step.value);
      this._mark(`pack ${step.value.file}`);
    }

    this._mark('packs-staged');
    this.state = 'importing';
    this._setPhase('importing', 'Importing the Lean core modules');
    const warm = await this.compile('');
    if (!warm.success) {
      throw new Error(warm.error || 'the Lean runtime rejected the warm-up compile');
    }
    this._mark('ready');
    this._stopTicker();
    this.state = 'ready';
    this._setProgress('Lean ready', 100, this._startupDetail());
    this._emit();
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
          this._mark('worker-script');
          worker.postMessage({ type: 'load_library', files: [] });
          break;
        case 'library_received':
          worker.postMessage({ type: 'start_worker' });
          break;
        case 'worker_ready':
          this._mark('wasm-ready');
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
          // Emscripten's setStatus ("Downloading data…", "Running…") describes the
          // wasm phase. Keep it as detail: it must not replace the ticking phase
          // message, which is what tells the reader the page is alive.
          if (message.data) {
            this.progress = { ...this.progress, detail: String(message.data) };
            this._emit();
          }
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
