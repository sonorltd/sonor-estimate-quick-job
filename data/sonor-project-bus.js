// sonor-project-bus.js — CANONICAL MASTER (Spine v1.2.6 §21, B-263)
//
// Workspace-wide active-project broadcast for every Sonor app.
// Headless data + event layer — NO DOM, NO rendering, NO styling.
// Companion: sonor-project-bar.js is the UI wrapper that consumes this bus.
//
// THE PROBLEM IT SOLVES
//   Today every app stores its own active project id in localStorage.
//   Open Cinema Design for "Caldy", jump to Takeoffs in another tab →
//   Takeoffs lands on whatever project it last had open. No coherence.
//   CD↔CT have a working bespoke `sonor:project-change` postMessage
//   (CT v0.21.1 + CD v4.18.0); this module promotes that pattern to a
//   workspace primitive that EVERY app can subscribe to.
//
// THREE TRANSPORTS (all opt-in, work standalone or together)
//   1) localStorage `sonor_active_project_id` + window `storage` event
//      → Same-origin cross-tab sync. Always on. Free.
//   2) postMessage to iframes / from parent
//      → For CD's inlined-CT Blob iframe + any future embedded surfaces.
//      → Sender broadcasts to every same-origin iframe in the page.
//      → Receivers (iframes) auto-listen for parent messages.
//      → Always on (no-op if no iframes / no parent).
//   3) Supabase Realtime broadcast channel `sonor:project`
//      → Cross-origin, cross-device sync (your laptop + your iPad).
//      → Lazy — only active after SonorProjectBus.connectSupabase(client).
//      → Optional. Apps without Supabase still get transports 1+2.
//
// API
//   SonorProjectBus.get()                       → current active id (string|null)
//   SonorProjectBus.set(id, opts?)              → set + broadcast on all transports
//     opts: { actor:'human|system', source:'<app-key>', silent:false }
//   SonorProjectBus.subscribe(fn)               → fn({previousId,currentId,source,actor,via})
//                                                 returns unsubscribe()
//   SonorProjectBus.connectSupabase(client)     → enable transport 3 (idempotent)
//   SonorProjectBus.version                     → semver string
//
// EVENT COMPATIBILITY
//   Also dispatches `sonor:project-changed` CustomEvent on `document`
//   (same shape as sonor-project-bar.js v1.0.0) — every existing consumer
//   that listens for that event continues to work without changes.
//
// ANTI-LOOP
//   Every broadcast carries `{source, instanceId}`. Receivers skip if
//   `source === this app key` AND `instanceId === own id`. Cross-tab
//   echoes (same source, different instance) are allowed through —
//   that's the whole point of multi-tab sync.
//
// IDEMPOTENT BOOT
//   Multiple `<script src>` includes are safe. Second load is a no-op.
//
// LOADING PATTERN
//   <script src="data/sonor-project-bus.js"></script>
//   <script>
//     SonorProjectBus.subscribe(({currentId, previousId, via}) => {
//       console.log('[app] project changed', previousId, '→', currentId, 'via', via);
//       // reload data, re-render, etc.
//     });
//     // Optional — opt into cross-origin sync once you have a Supabase client:
//     // SonorProjectBus.connectSupabase(db.supa);
//   </script>
//
// NAMESPACE: window.SonorProjectBus
//
// Version: 1.0.0 — initial promotion of CD↔CT pattern to workspace primitive (2026-05-17, B-263)
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.SonorProjectBus && window.SonorProjectBus.version) {
    return; // idempotent — second load is a no-op
  }

  const VERSION = '1.0.0';
  const LS_KEY = 'sonor_active_project_id';
  const PM_TYPE = 'sonor:project-change';        // postMessage type
  const RT_CHANNEL = 'sonor:project';            // Supabase Realtime channel
  const RT_EVENT = 'set';
  const INSTANCE_ID = 'pb-' + Math.random().toString(36).slice(2, 10);

  // ---- internal state ----
  let _activeId = _readLs();
  let _subscribers = new Set();
  let _supa = null;
  let _rtChannel = null;

  // ---- helpers ----
  function _readLs() {
    try { return localStorage.getItem(LS_KEY) || null; } catch (e) { return null; }
  }
  function _writeLs(id) {
    try {
      if (id) localStorage.setItem(LS_KEY, id);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* quota / private mode — ignore */ }
  }

  function _emit(detail) {
    // detail: { previousId, currentId, source, actor, via, instanceId }
    _subscribers.forEach(fn => {
      try { fn(detail); } catch (e) { console.warn('[ProjectBus] subscriber threw:', e); }
    });
    // Back-compat with sonor-project-bar.js v1.0.0 — dispatch same event on document
    try {
      document.dispatchEvent(new CustomEvent('sonor:project-changed', { detail }));
    } catch (e) { /* SSR / no DOM */ }
  }

  // ---- core state machine ----
  function _applyChange(newId, meta) {
    // meta: { source, actor, via, instanceId, skipLs?, skipBroadcast? }
    const previousId = _activeId;
    if (previousId === newId) return false;
    _activeId = newId;
    if (!meta.skipLs) _writeLs(newId);
    _emit({
      previousId,
      currentId: newId,
      source: meta.source || 'unknown',
      actor: meta.actor || 'system',
      via: meta.via || 'set',
      instanceId: meta.instanceId || INSTANCE_ID
    });
    return true;
  }

  // ---- public set ----
  function set(id, opts) {
    opts = opts || {};
    const changed = _applyChange(id, {
      source: opts.source || 'unknown',
      actor: opts.actor || 'human',
      via: 'set',
      instanceId: INSTANCE_ID
    });
    if (!changed || opts.silent) return changed;
    // Broadcast on transports 2 + 3 (transport 1 already done via _writeLs in _applyChange)
    _broadcastPostMessage(id, opts);
    _broadcastRealtime(id, opts);
    return true;
  }

  function get() { return _activeId; }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subscribers.add(fn);
    return function unsubscribe() { _subscribers.delete(fn); };
  }

  // ---- transport 1: localStorage storage event (cross-tab same-origin) ----
  function _bindStorageEvent() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (e) => {
      if (e.key !== LS_KEY) return;
      const newId = e.newValue || null;
      if (newId === _activeId) return;
      _applyChange(newId, {
        source: 'cross-tab',
        actor: 'system',
        via: 'storage-event',
        skipLs: true,         // already written by the other tab
        instanceId: 'other-tab'
      });
    });
  }

  // ---- transport 2: postMessage (parent ↔ iframe) ----
  function _broadcastPostMessage(id, opts) {
    if (typeof window === 'undefined') return;
    const payload = {
      type: PM_TYPE,
      projectId: id,
      source: opts.source || 'unknown',
      actor: opts.actor || 'human',
      instanceId: INSTANCE_ID,
      sentAt: Date.now()
    };
    // Down — every same-origin iframe
    try {
      const frames = document.querySelectorAll('iframe');
      frames.forEach(f => {
        try { f.contentWindow && f.contentWindow.postMessage(payload, '*'); } catch (e) {}
      });
    } catch (e) {}
    // Up — to parent if embedded
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(payload, '*'); } catch (e) {}
    }
  }

  function _bindPostMessage() {
    if (typeof window === 'undefined') return;
    window.addEventListener('message', (e) => {
      const msg = e && e.data;
      if (!msg || msg.type !== PM_TYPE) return;
      // Anti-loop — skip if we sent this ourselves
      if (msg.instanceId === INSTANCE_ID) return;
      _applyChange(msg.projectId || null, {
        source: msg.source || 'iframe',
        actor: msg.actor || 'system',
        via: 'postMessage',
        instanceId: msg.instanceId || 'remote'
      });
    });
  }

  // ---- transport 3: Supabase Realtime broadcast (cross-origin / cross-device) ----
  function connectSupabase(client) {
    if (!client || typeof client.channel !== 'function') {
      console.warn('[ProjectBus] connectSupabase needs a Supabase client');
      return false;
    }
    if (_supa === client && _rtChannel) return true; // idempotent
    // Tear down any previous channel
    if (_rtChannel) {
      try { _supa.removeChannel(_rtChannel); } catch (e) {}
      _rtChannel = null;
    }
    _supa = client;
    try {
      _rtChannel = client.channel(RT_CHANNEL, { config: { broadcast: { self: false } } });
      _rtChannel
        .on('broadcast', { event: RT_EVENT }, (payload) => {
          const msg = (payload && payload.payload) || payload || {};
          if (!msg || msg.instanceId === INSTANCE_ID) return; // anti-loop
          _applyChange(msg.projectId || null, {
            source: msg.source || 'realtime',
            actor: msg.actor || 'system',
            via: 'realtime',
            instanceId: msg.instanceId || 'remote'
          });
        })
        .subscribe();
      return true;
    } catch (e) {
      console.warn('[ProjectBus] Realtime subscribe failed:', e && e.message);
      return false;
    }
  }

  function _broadcastRealtime(id, opts) {
    if (!_rtChannel) return;
    try {
      _rtChannel.send({
        type: 'broadcast',
        event: RT_EVENT,
        payload: {
          projectId: id,
          source: opts.source || 'unknown',
          actor: opts.actor || 'human',
          instanceId: INSTANCE_ID,
          sentAt: Date.now()
        }
      });
    } catch (e) { /* channel not ready / quota — ignore */ }
  }

  // ---- boot ----
  _bindStorageEvent();
  _bindPostMessage();

  // ---- export ----
  const api = {
    version: VERSION,
    instanceId: INSTANCE_ID,
    get, set, subscribe, connectSupabase
  };
  if (typeof window !== 'undefined') window.SonorProjectBus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
