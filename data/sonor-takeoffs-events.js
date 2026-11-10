// @ts-check
/**
 * Sonor Takeoffs — Events module
 * ===============================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-takeoffs-events.js by
 * sync-everything.sh; never hand-edit the per-app copy.
 *
 * @version 1.0.0   (introduced in Sonor Takeoffs v3.4.0)
 * @license proprietary — Sonor Smart Homes
 *
 * THE PROBLEM
 *
 * Pre-v3.4.0, sonor-takeoffs.html had FOURTEEN separate
 * `canvas.on('object:modified', ...)` registrations across 31k lines
 * (lines 3849, 10981, 14374, 19504, 19932, 20180, 20459, 20609, 20760,
 * 20907, 21053, 23528, 23893, 24063). Plus 3+ for `object:moving`.
 * Plus 3+ for `mouse:move`. Plus more.
 *
 * Fabric calls every handler in registration order. Hidden coupling: the
 * canonical save-bearing handler at line 24063 had to be source-order LAST
 * so that earlier handlers' mutations (relabel, cone-resync, view-cone-
 * angle-sync) reached saveState. Future feature work that adds a new
 * handler AFTER line 24063 would silently break persistence — exactly
 * the failure mode the v3.0.x patches kept chasing.
 *
 * THE FIX
 *
 * One dispatcher per canvas event. Features `register(eventName, fn)` to
 * hook in. Dispatcher invokes subscribers in registration order, with
 * three guaranteed positions: PRE (before), MID (default), and POST
 * (after — saveStateThrottled lives here). Errors in one subscriber
 * never crash the rest.
 *
 * The host wires ONE `canvas.on('object:modified', SonorEvents.dispatch)`
 * instead of 14. Existing call sites refactor to
 * `SonorEvents.register('object:modified', fn, 'mid')`. Migration is
 * incremental — non-migrated handlers stay registered directly until
 * v3.5.0+; the dispatcher coexists with them.
 *
 * PUBLIC API
 *
 *   register(eventName, fn, position?)   -- 'pre'|'mid'|'post' (default 'mid')
 *   unregister(eventName, fn)
 *   dispatch(eventName, eventArg)        -- pass through to registered subs
 *   wireOnce(canvas, ...eventNames)      -- attach the dispatcher to canvas
 *   list(eventName)                      -- introspection
 *   clear(eventName?)                    -- testing utility
 *   __version
 *
 * Both ES module exports and a window.SonorEvents pin are emitted.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorEvents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  const __version = '1.0.0';

  // event name -> { pre: [], mid: [], post: [] }
  const _registry = new Map();

  function _bucket(eventName) {
    if (!_registry.has(eventName)) {
      _registry.set(eventName, { pre: [], mid: [], post: [] });
    }
    return _registry.get(eventName);
  }

  /**
   * Register a subscriber for an event.
   *
   * @param {string} eventName
   * @param {Function} fn
   * @param {'pre'|'mid'|'post'} [position='mid']
   * @returns {Function} unregister function for convenience
   */
  function register(eventName, fn, position) {
    if (typeof fn !== 'function') {
      console.warn('[SonorEvents] register: fn must be a function');
      return () => {};
    }
    const pos = (position === 'pre' || position === 'post') ? position : 'mid';
    const bucket = _bucket(eventName);
    if (!bucket[pos].includes(fn)) bucket[pos].push(fn);
    return () => unregister(eventName, fn);
  }

  function unregister(eventName, fn) {
    const bucket = _registry.get(eventName);
    if (!bucket) return;
    for (const pos of ['pre', 'mid', 'post']) {
      const idx = bucket[pos].indexOf(fn);
      if (idx !== -1) bucket[pos].splice(idx, 1);
    }
  }

  /**
   * Invoke every registered subscriber for an event, in pre→mid→post order.
   * Errors are isolated — a thrown subscriber does not block the rest.
   * Returns the count of subscribers invoked + the count that errored.
   */
  function dispatch(eventName, eventArg) {
    const bucket = _registry.get(eventName);
    if (!bucket) return { invoked: 0, errored: 0 };
    let invoked = 0;
    let errored = 0;
    for (const pos of ['pre', 'mid', 'post']) {
      const subs = bucket[pos];
      // Snapshot to allow safe unregister-during-dispatch
      const snap = subs.slice();
      for (const fn of snap) {
        invoked++;
        try { fn(eventArg); }
        catch (e) {
          errored++;
          console.warn('[SonorEvents] subscriber threw on ' + eventName + ' (' + pos + '):', e && e.message);
        }
      }
    }
    return { invoked, errored };
  }

  /**
   * Wire the dispatcher to a canvas-like object for one or more events.
   * The host calls this once at boot, e.g.:
   *   SonorEvents.wireOnce(canvas, 'object:modified', 'object:moving',
   *                        'mouse:move', 'mouse:down', 'mouse:up');
   *
   * Each event gets ONE `canvas.on(name, dispatcher)` attachment. All
   * future feature work adds subscribers via SonorEvents.register, never
   * a new direct `canvas.on(name, ...)`.
   */
  function wireOnce(canvas, ...eventNames) {
    if (!canvas || typeof canvas.on !== 'function') {
      console.warn('[SonorEvents] wireOnce: canvas.on missing');
      return;
    }
    for (const name of eventNames) {
      const dispatcher = (e) => dispatch(name, e);
      // Tag the dispatcher so duplicate wireOnce calls can be detected
      dispatcher._sonorEventsDispatcher = name;
      canvas.on(name, dispatcher);
    }
  }

  /** Read-only introspection — useful for debugging + tests. */
  function list(eventName) {
    if (eventName) {
      const b = _registry.get(eventName);
      if (!b) return { pre: [], mid: [], post: [] };
      return { pre: b.pre.slice(), mid: b.mid.slice(), post: b.post.slice() };
    }
    const out = {};
    for (const [name, b] of _registry.entries()) {
      out[name] = { pre: b.pre.length, mid: b.mid.length, post: b.post.length };
    }
    return out;
  }

  /** Test utility — clear all subscribers for an event (or all events). */
  function clear(eventName) {
    if (eventName) {
      _registry.delete(eventName);
    } else {
      _registry.clear();
    }
  }

  return {
    __version,
    register,
    unregister,
    dispatch,
    wireOnce,
    list,
    clear,
  };
});
