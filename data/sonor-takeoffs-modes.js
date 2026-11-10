// @ts-check
/**
 * Sonor Takeoffs — Modes module (v3.5.0 skeleton)
 * =================================================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-takeoffs-modes.js by
 * sync-everything.sh; never hand-edit the per-app copy.
 *
 * @version 0.1.0 (skeleton — v3.5.0 will populate the 14 modes)
 * @license proprietary — Sonor Smart Homes
 *
 * THE PROBLEM
 *
 * Pre-v3.5.0, sonor-takeoffs.html has 14 canvas modes (cctv, network,
 * lighting, audio, video, cinema, automation, climate, control,
 * infrastructure, plus drawing modes: place, select, scale, length,
 * led, area, shade, tv, pj, dim, pen, quickmeasure, pinSnag, cloud,
 * leader, text). Each is wired by hand across 7+ separate sites:
 *   - setMode() if-else chain (~150 LOC)
 *   - _enterXMode + _clearXMode functions (scattered)
 *   - _isModeEphemeral hard-coded tag list (18+ tags)
 *   - cursor map
 *   - keyboard shortcut table
 *   - toolbar button HTML + onclick wiring
 *   - status bar text
 *
 * Forgetting any one site breaks the framework. Pattern caused the
 * v3.0.5 mode-overlay-leak bug, the v2.6.0 → v3.0.4 mode-doesn't-exit
 * bug, and is part of the persistence-bug architecture per the audit.
 *
 * THE FIX
 *
 * One MODES registry. Adding a new mode = ONE row.
 *
 *   MODES.register('cctv', {
 *     enter:   () => { ... paint overlays ... },
 *     exit:    () => { ... remove overlays ... },
 *     ephemeralTags: ['_sonorCctvCoverageHeatmap', '_sonorViewCone', ...],
 *     cursor:  'crosshair',
 *     shortcut: 'C',
 *     icon: '🔒',
 *     label: 'CCTV',
 *     tooltip: 'Camera coverage + cone painting',
 *   });
 *
 * setMode(key) iterates the registry: previous mode's exit fires,
 * target mode's enter fires, status bar updates.
 *
 * isEphemeral(obj) auto-derives the tag union from
 * Object.values(MODES).flatMap(m => m.ephemeralTags). No hand-coded
 * list. Adding a new tag is impossible to forget.
 *
 * v3.5.0 — module ships, all 14 modes registered, _isModeEphemeral
 *   delegates to MODES.isEphemeral, setMode() iterates the registry.
 *
 * v3.5.x — toolbar buttons + keyboard shortcuts auto-wired from
 *   registry on init. Adding a mode = ONE row, full stop.
 *
 * Until v3.5.0 lands, this module is the contract definition + a
 * read-only registry that future code populates. Host pages that
 * load this module pre-v3.5.0 see an empty registry; setMode is a
 * no-op. No behaviour change.
 *
 * PUBLIC API (v0.1.0 skeleton)
 *
 *   register(key, def)              -- add a mode (host fills in)
 *   unregister(key)
 *   get(key)                        -- → mode def or null
 *   list()                          -- → array of [key, def]
 *   activeKey                       -- → current mode key (string)
 *   isEphemeral(canvasObj)          -- auto-derived from registered ephemeralTags
 *   setActiveKey(key)               -- transitions mode (calls exit/enter)
 *   subscribe(fn)                   -- (newKey, oldKey) => void; returns unsub
 *   __version
 *
 * DEFINITION SHAPE
 *
 *   {
 *     key:           string (matches registry key)
 *     enter?:        () => void       called when mode activates
 *     exit?:         () => void       called when mode deactivates
 *     onObjectModified?: (obj, evt) => void   subscriber to canvas event
 *     ephemeralTags: string[]         ['_sonorXxxOverlay', ...]
 *     cursor?:       string           'crosshair' | 'pointer' | 'default' | ...
 *     shortcut?:     string           single-letter keyboard shortcut
 *     icon?:         string           emoji or font-icon identifier
 *     label?:        string           toolbar label
 *     tooltip?:      string           hover text
 *     statusOnEnter?: string          setStatus text on activation
 *   }
 *
 * Both ES module exports and a window.SonorModes pin are emitted.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorModes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  const __version = '0.1.0';

  /** Map: key → mode definition. */
  const _modes = new Map();

  /** Active mode key. Default: 'place' (matches sonor-takeoffs.html boot). */
  let _activeKey = 'place';

  /** Subscribers for mode-change events. */
  const _listeners = new Set();

  function register(key, def) {
    if (typeof key !== 'string' || !key) {
      console.warn('[SonorModes] register: key must be a non-empty string');
      return;
    }
    if (!def || typeof def !== 'object') {
      console.warn('[SonorModes] register: def must be an object');
      return;
    }
    _modes.set(key, Object.assign({ key }, def));
  }

  function unregister(key) { _modes.delete(key); }

  function get(key) { return _modes.get(key) || null; }

  function list() { return Array.from(_modes.entries()); }

  function setActiveKey(key) {
    if (key === _activeKey) return;
    const prevKey = _activeKey;
    const prev = _modes.get(_activeKey);
    const next = _modes.get(key);

    if (prev && typeof prev.exit === 'function') {
      try { prev.exit(); }
      catch (e) { console.warn('[SonorModes] exit threw on ' + _activeKey + ':', e && e.message); }
    }
    _activeKey = key;
    if (next && typeof next.enter === 'function') {
      try { next.enter(); }
      catch (e) { console.warn('[SonorModes] enter threw on ' + key + ':', e && e.message); }
    }
    for (const fn of _listeners) {
      try { fn(key, prevKey); }
      catch (e) { console.warn('[SonorModes] subscriber threw on transition ' + prevKey + '→' + key + ':', e && e.message); }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  /**
   * Auto-derive the ephemeral-tag union from every registered mode.
   * `isEphemeral(canvasObj)` returns true if the object carries any
   * tag from any mode's ephemeralTags list.
   *
   * In v3.5.0 the host page replaces the inline `_isModeEphemeral`
   * function with a delegate to this method. Until then the module
   * stands as the contract; the inline function works as today.
   */
  function isEphemeral(obj) {
    if (!obj) return false;
    for (const def of _modes.values()) {
      if (!def.ephemeralTags || !def.ephemeralTags.length) continue;
      for (const tag of def.ephemeralTags) {
        if (obj[tag] === true) return true;
      }
    }
    return false;
  }

  /** Returns true if a key is registered. */
  function has(key) { return _modes.has(key); }

  /** Test/diagnostic: clear all registrations. */
  function _testReset() {
    _modes.clear();
    _activeKey = 'place';
    _listeners.clear();
  }

  return {
    __version,
    register,
    unregister,
    get,
    has,
    list,
    setActiveKey,
    subscribe,
    isEphemeral,
    _testReset,
    get activeKey() { return _activeKey; },
  };
});
