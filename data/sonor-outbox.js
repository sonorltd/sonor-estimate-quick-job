/* sonor-outbox.js — SHARED OFFLINE OUTBOX (canonical master at workspace root, synced to every app's data/)
 * v1.0.0 (2026-11-07) — extracted from APP - Survey's store (v0.11) when Site became its own app (Bryn: "survey and site are diff
 * apps … very similar but different levels of info"). HARMONY §3: the moment of duplication is the moment of extraction — both
 * field apps queue writes the same way, so the queue lives here once.
 *
 * Every write goes to IndexedDB first (outbox), then replays IN ORDER when there is signal. An app gives one `apply(op)` that
 * returns true (done / drop) or 'retry' (network — stop and keep order). Plus a small cache (last good reads) and a blob store
 * (photos, rendered plans) so a field app works with no signal and survives a refresh.
 *
 *   var OB = SonorOutbox.create({ name: 'sonor-site', apply: async function (op) { … return true | 'retry'; }, isNet?, label? })
 *   OB.setClient(supa)                    — flush needs a client; call at boot
 *   OB.add(op) · OB.all() · OB.del(k)     — op is any JSON object; `k` (auto key) and `ts` are added
 *   OB.flush() (debounced) · OB.flushNow()
 *   OB.cacheGet(k) / OB.cacheSet(k, v) · OB.blobGet(k) / OB.blobSet(k, v) / OB.blobDel(k)
 *   OB.status() → { online, pending, flushing, last }  (the SAME object, kept live) · OB.onStatus(fn) · OB.emit()
 * IndexedDB layout (v1): stores outbox (keyPath k, autoIncrement) · cache · blobs — identical to Survey's pre-1.0 store, so queued
 * work on an iPad survives the switch. Edit THIS master; `bash sync-everything.sh --only sonor-outbox.js`.
 */
(function (root) {
  'use strict';
  var VERSION = '1.0.0';
  function defaultIsNet(e) { var m = String((e && e.message) || e || ''); return /fetch|network|Failed|load failed|timeout|abort/i.test(m) || !navigator.onLine; }

  function create(o) {
    o = o || {}; var NAME = o.name || 'sonor-outbox', label = o.label || NAME, apply = o.apply, isNet = o.isNet || defaultIsNet;
    var db = null, client = null, listeners = [], status = { online: navigator.onLine, pending: 0, flushing: false, last: null }, timer = null;
    function emit() { listeners.forEach(function (f) { try { f(status); } catch (e) { } }); }
    function openDb() {
      if (db) return Promise.resolve(db);
      return new Promise(function (res, rej) {
        var r = indexedDB.open(NAME, 1);
        r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'k', autoIncrement: true }); if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache'); if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); };
        r.onsuccess = function () { db = r.result; res(db); }; r.onerror = function () { rej(r.error); };
      });
    }
    function tx(store, mode, fn) {
      return openDb().then(function (d) { return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res((out && typeof out === 'object' && 'result' in out) ? out.result : out); }; t.onerror = function () { rej(t.error); };
      }); });
    }
    function cacheGet(k) { return tx('cache', 'readonly', function (s) { return s.get(k); }); }
    function cacheSet(k, v) { return tx('cache', 'readwrite', function (s) { s.put(v, k); }); }
    function blobGet(k) { return tx('blobs', 'readonly', function (s) { return s.get(k); }); }
    function blobSet(k, v) { return tx('blobs', 'readwrite', function (s) { s.put(v, k); }); }
    function blobDel(k) { return tx('blobs', 'readwrite', function (s) { s.delete(k); }); }
    function all() { return tx('outbox', 'readonly', function (s) { return s.getAll(); }); }
    function count() { return all().then(function (a) { status.pending = a.length; emit(); return a.length; }); }
    function add(op) { op.ts = Date.now(); return tx('outbox', 'readwrite', function (s) { s.add(op); }).then(count); }
    function del(k) { return tx('outbox', 'readwrite', function (s) { s.delete(k); }); }
    function flush() { clearTimeout(timer); timer = setTimeout(flushNow, 300); }
    async function flushNow() {
      if (status.flushing || !navigator.onLine || !client || typeof apply !== 'function') { count(); return; }
      status.flushing = true; emit();
      try {
        var ops = await all();
        for (var i = 0; i < ops.length; i++) {
          var r; try { r = await apply(ops[i]); } catch (e) { r = isNet(e) ? 'retry' : true; if (r === true) console.warn('[' + label + '] op dropped', ops[i].op, e && e.message); }
          if (r === 'retry') break;          // network — stop, keep order
          await del(ops[i].k);
        }
        status.last = Date.now();
      } catch (e) { console.warn('[' + label + '] flush', e && e.message); }
      status.flushing = false; await count();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', function () { status.online = true; emit(); flush(); });
      window.addEventListener('offline', function () { status.online = false; emit(); });
      setInterval(function () { if (status.pending) flush(); }, 30000);
    }
    return { VERSION: VERSION, setClient: function (c) { client = c; count(); flush(); }, client: function () { return client; },
      add: add, all: all, del: del, count: count, flush: flush, flushNow: flushNow, cacheGet: cacheGet, cacheSet: cacheSet,
      blobGet: blobGet, blobSet: blobSet, blobDel: blobDel, status: function () { return status; }, emit: emit,
      onStatus: function (f) { listeners.push(f); try { f(status); } catch (e) { } }, isNet: isNet };
  }
  root.SonorOutbox = { VERSION: VERSION, create: create };
})(typeof self !== 'undefined' ? self : this);
