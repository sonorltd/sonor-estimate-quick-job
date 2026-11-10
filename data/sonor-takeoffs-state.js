// @ts-check
/**
 * Sonor Takeoffs — State module
 * ==============================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-takeoffs-state.js by
 * sync-everything.sh; never hand-edit the per-app copy.
 *
 * @version 1.0.0   (introduced in Sonor Takeoffs v3.4.0)
 * @license proprietary — Sonor Smart Homes
 *
 * THE PROBLEM
 *
 * Pre-v3.4.0, sonor-takeoffs.html had 4,200+ top-level `let`/`const`
 * declarations as plain bindings — `let floors = [];`, `let
 * activeFloorId = null;`, `let scalePxPerM = null;`, etc. No central
 * state. Mutations everywhere. The audit explicitly said: *"This IS
 * the persistence-bug architecture."*
 *
 * Symptoms:
 *   - Tests cannot read state without sandbox `eval()` tricks
 *   - History snapshots manually walk specific globals
 *   - No way to subscribe to "floors changed" without polling
 *   - Race conditions: feature A mutates `_restoring=true`, feature B
 *     reads it later, but ordering is implicit and fragile
 *   - Adding new state means another global, another save site, another
 *     restore branch
 *
 * THE FIX
 *
 * One Proxy-backed state object. Every mutation goes through `set`, which
 * notifies registered listeners synchronously. Subscribers can:
 *   - Listen to ALL changes
 *   - Listen to specific keys
 *   - Snapshot the entire state via structuredClone (native, fast)
 *   - Restore from a snapshot
 *
 * The Sonor Takeoffs host migrates incrementally:
 *   - v3.4.0: introduce module + register canonical keys (no behaviour change)
 *   - v3.4.1+: feature-by-feature migration of `let X` → `state.X`
 *   - v4.0.0: state proxy is the only source of truth
 *
 * Coexistence with existing globals is intentional — the proxy can mirror
 * a top-level `let` via `state.bind('floors', () => floors, (v) => floors = v)`
 * during the migration window. Listeners fire when the proxy is set; the
 * host also listens-and-mirrors so existing code reading `floors` keeps
 * working.
 *
 * PUBLIC API
 *
 *   state                     -- Proxy: read/write any key triggers listeners
 *   subscribe(fn)             -- (key, newVal, oldVal) => void; returns unsub
 *   subscribeKey(key, fn)     -- (newVal, oldVal) => void; returns unsub
 *   snapshot()                -- structuredClone of the raw object
 *   restore(snap)             -- replace state, fire listeners for changed keys
 *   patch(obj)                -- merge object; one notification per key changed
 *   reset()                   -- clear everything, fire listeners
 *   bind(key, getter, setter) -- mirror an external let to state.key
 *   unbind(key)
 *   __version
 *   __raw                     -- the underlying object (escape hatch)
 *
 * Both ES module exports and a window.SonorState pin are emitted.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  const __version = '1.0.0';

  /** Underlying data — the Proxy wraps this. */
  const _raw = {};

  /** Set of (key, newVal, oldVal) -> void listeners. */
  const _allListeners = new Set();

  /** Map: key -> Set of (newVal, oldVal) -> void listeners. */
  const _keyListeners = new Map();

  /** Map: key -> { getter, setter } for bound external lets. */
  const _bindings = new Map();

  function _notify(key, newVal, oldVal) {
    if (newVal === oldVal) return;
    for (const fn of _allListeners) {
      try { fn(key, newVal, oldVal); }
      catch (e) { console.warn('[SonorState] all-listener threw on ' + key + ':', e && e.message); }
    }
    const set = _keyListeners.get(key);
    if (set) {
      for (const fn of set) {
        try { fn(newVal, oldVal); }
        catch (e) { console.warn('[SonorState] key-listener threw on ' + key + ':', e && e.message); }
      }
    }
  }

  /** structuredClone fallback — Node 17+ + all evergreen browsers since 2022. */
  const _clone = (typeof structuredClone === 'function')
    ? structuredClone
    : (v) => JSON.parse(JSON.stringify(v));

  const handler = {
    get(target, key) {
      // Bound key — read from the external getter
      const b = _bindings.get(key);
      if (b && typeof b.getter === 'function') return b.getter();
      return target[key];
    },
    set(target, key, value) {
      const b = _bindings.get(key);
      if (b && typeof b.setter === 'function') {
        const oldVal = (typeof b.getter === 'function') ? b.getter() : undefined;
        b.setter(value);
        _notify(key, value, oldVal);
        return true;
      }
      const oldVal = target[key];
      target[key] = value;
      _notify(key, value, oldVal);
      return true;
    },
    deleteProperty(target, key) {
      const oldVal = target[key];
      const had = (key in target);
      delete target[key];
      if (had) _notify(key, undefined, oldVal);
      return true;
    },
    has(target, key) {
      if (_bindings.has(key)) return true;
      return key in target;
    },
    ownKeys(target) {
      const own = new Set(Object.keys(target));
      for (const k of _bindings.keys()) own.add(k);
      return Array.from(own);
    },
    getOwnPropertyDescriptor(target, key) {
      if (_bindings.has(key)) {
        return { enumerable: true, configurable: true, writable: true,
                 value: _bindings.get(key).getter() };
      }
      return Object.getOwnPropertyDescriptor(target, key);
    },
  };

  const state = new Proxy(_raw, handler);

  // ----------------------------------------------------------
  // Listeners

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _allListeners.add(fn);
    return () => _allListeners.delete(fn);
  }

  function subscribeKey(key, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!_keyListeners.has(key)) _keyListeners.set(key, new Set());
    _keyListeners.get(key).add(fn);
    return () => {
      const s = _keyListeners.get(key);
      if (s) s.delete(fn);
    };
  }

  // ----------------------------------------------------------
  // Snapshot / restore

  /** Returns a deep copy of the raw state — safe to mutate without affecting state. */
  function snapshot() {
    // Fold bound keys into the snapshot
    const out = _clone(_raw);
    for (const [key, b] of _bindings.entries()) {
      try { out[key] = _clone(b.getter()); } catch (_) {}
    }
    return out;
  }

  /**
   * Replace the entire state with a snapshot. Listeners fire for every
   * key whose value changed. Bound keys are written through their setters.
   */
  function restore(snap) {
    if (!snap || typeof snap !== 'object') return;
    const allKeys = new Set([...Object.keys(_raw), ...Object.keys(snap), ..._bindings.keys()]);
    for (const key of allKeys) {
      const oldVal = (key in _bindings) ? _bindings.get(key).getter() : _raw[key];
      const newVal = snap[key];
      if (oldVal === newVal) continue;
      // Going through the proxy so bindings + notify run uniformly
      state[key] = _clone(newVal);
    }
  }

  /** Apply a partial update. One listener call per key that changed. */
  function patch(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      state[key] = obj[key];
    }
  }

  /** Wipe all keys + fire listeners for each. */
  function reset() {
    const keys = Object.keys(_raw);
    for (const key of keys) delete state[key];
  }

  // ----------------------------------------------------------
  // Bindings — mirror an external let to a state key

  /**
   * Bind a state key to an external read/write pair. Useful during
   * migration: the host's existing `let floors = [];` stays as the source
   * of truth, and reads/writes to `state.floors` are forwarded.
   *
   * @param {string} key
   * @param {() => any} getter
   * @param {(v: any) => void} setter
   */
  function bind(key, getter, setter) {
    if (typeof getter !== 'function' || typeof setter !== 'function') {
      console.warn('[SonorState] bind: getter and setter required');
      return;
    }
    _bindings.set(key, { getter, setter });
  }

  function unbind(key) {
    _bindings.delete(key);
  }

  // ----------------------------------------------------------
  // Test utility — clear everything (used by beforeEach in tests)

  function _testReset() {
    reset();
    _allListeners.clear();
    _keyListeners.clear();
    _bindings.clear();
  }

  return {
    __version,
    state,
    subscribe,
    subscribeKey,
    snapshot,
    restore,
    patch,
    reset,
    bind,
    unbind,
    _testReset,
    get __raw() { return _raw; },
  };
});
