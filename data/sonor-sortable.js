/**
 * sonor-sortable.js — ONE way to order things, workspace-wide (sonor-kit, B-491, 2026-09-29).
 * Bryn: "sorting like this should never have to be done anywhere by typing numbers, there should be proper auto sort
 * or a better method through everything… a system wide proper method even though different aspects have slightly
 * different requirements."
 *
 *   What it does
 *   • Drag-to-reorder for ANY list: table rows, cards, list items, DIN modules, rules — Pointer Events, a styled ghost,
 *     an insertion line, auto-scroll near the edges, touch-safe (long-press not needed: the HANDLE is the drag surface).
 *   • Keyboard on the handle: ⌥↑ / ⌥↓ move one step, ⌥⇧↑ / ⌥⇧↓ to top / bottom, Enter/Space picks up & drops.
 *   • Auto-renumbering: the stored `sort` field becomes a gap sequence (10, 20, 30 …) so inserts never collide and
 *     nobody ever types a number. `onReorder(changes, order)` gets ONLY the rows whose number changed.
 *   • Groups: `group` (a function item → key) keeps drags inside the same group (e.g. pass=device vs pass=rack) and
 *     renumbers per group. Derived order (`auto: fn`) means no handles — the list sorts itself and a drag is refused.
 *   • Hides any legacy number input inside the item marked `data-sort-input` (keeps the code path, retires the UI).
 *
 *   API
 *   SonorSortable.attach(container, {
 *     item:      'tr[data-id]',          // selector for one orderable element (default '[data-id]')
 *     handle:    '.s-drag',              // selector inside the item; created automatically when `mountHandle` is set
 *     mountHandle: 'td:first-child',     // where to inject a ⋮⋮ handle if the item has none (prepend into this)
 *     key:       (el) => el.dataset.id,  // stable id of an item
 *     group:     (el) => el.dataset.group || '',   // optional — drags only within the same group
 *     step:      10,                     // gap sequence step
 *     axis:      'y' | 'x' | 'grid',     // insertion geometry (grid = cards wrapping in rows)
 *     onReorder: (changes, order) => {}, // changes: [{key, sort, el}], order: [key…]  → persist (async ok)
 *     getSort:   (el) => Number(el.dataset.sort), // optional — current stored number, used for gap renumbering
 *     auto:      null | (a, b) => n      // DERIVED order: sorts the DOM itself, no handles, drags refused
 *   }) → { destroy(), renumber(), refresh(), order() }
 *
 *   Helpers: SonorSortable.renumber(keys, step) → Map key→sort ;  SonorSortable.gapAfter(prev, next, step)
 *   Events on the container: 'sonor:reorder' { changes, order }, 'sonor:sort-refused' { why }
 *   Styles: .s-drag (handle) · .s-dragging (item) · .s-drop-line · .s-drag-ghost — all on the brand tokens (kit.css).
 */
(function (global) {
  'use strict';
  var VERSION = '0.2.0';
  var doc = global.document;
  var HANDLE_SVG = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="3" cy="3" r="1.3" fill="currentColor"/><circle cx="7" cy="3" r="1.3" fill="currentColor"/><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="7" cy="8" r="1.3" fill="currentColor"/><circle cx="3" cy="13" r="1.3" fill="currentColor"/><circle cx="7" cy="13" r="1.3" fill="currentColor"/></svg>';

  // ── pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  function renumber(keys, step) { step = step || 10; var m = new Map(); keys.forEach(function (k, i) { m.set(k, (i + 1) * step); }); return m; }
  function gapAfter(prev, next, step) { step = step || 10; if (prev == null && next == null) return step; if (prev == null) return Math.floor(next / 2) || (next - 1); if (next == null) return prev + step; var mid = Math.floor((prev + next) / 2); return mid > prev ? mid : null; }
  // Given the current numbers in DOM order, return the minimal set of {key, sort} changes that make the sequence
  // strictly increasing — preferring a single gap fill for the moved item, falling back to a full gap renumber.
  function diffNumbers(items, moved, step) {
    step = step || 10; var idx = items.findIndex(function (x) { return x.key === moved; });
    var prev = idx > 0 ? items[idx - 1].sort : null, next = idx < items.length - 1 ? items[idx + 1].sort : null;
    var ok = items.every(function (x, i) { return i === idx || x.sort != null; });
    if (ok) { var g = gapAfter(prev, next, step); if (g != null && (prev == null || g > prev) && (next == null || g < next)) return [{ key: moved, sort: g }]; }
    var full = renumber(items.map(function (x) { return x.key; }), step), out = [];
    items.forEach(function (x) { var n = full.get(x.key); if (x.sort !== n) out.push({ key: x.key, sort: n }); });
    return out;
  }

  function attach(container, opts) {
    container = typeof container === 'string' ? doc.querySelector(container) : container;
    if (!container) return null;
    opts = Object.assign({ item: '[data-id]', handle: '.s-drag', mountHandle: null, step: 10, axis: 'y', key: function (el) { return el.dataset.id; }, group: function () { return ''; }, getSort: function (el) { return el.dataset.sort == null || el.dataset.sort === '' ? null : Number(el.dataset.sort); }, onReorder: null, auto: null }, opts || {});
    var items = function () { return Array.prototype.slice.call(container.querySelectorAll(opts.item)); };
    var line = doc.createElement('div'); line.className = 's-drop-line'; line.hidden = true;
    var ghost = null, drag = null, raf = 0;

    function refresh() {
      items().forEach(function (el) {
        var legacy = el.querySelector('[data-sort-input]'); if (legacy) legacy.hidden = true;
        if (opts.auto) { var h0 = el.querySelector(opts.handle); if (h0) h0.remove(); return; }
        var h = el.querySelector(opts.handle);
        if (!h && opts.mountHandle) { var host = opts.mountHandle === 'self' ? el : el.querySelector(opts.mountHandle); if (host) { h = doc.createElement('button'); h.type = 'button'; h.className = opts.handle.replace(/^\./, ''); h.setAttribute('aria-label', 'Drag to reorder — ⌥↑ ⌥↓ move, ⌥⇧↑ ⌥⇧↓ top / bottom'); h.title = 'Drag to reorder (⌥↑ ⌥↓)'; h.innerHTML = HANDLE_SVG; host.insertBefore(h, host.firstChild); } }
        if (h) { h.draggable = false; h.tabIndex = 0; }
      });
      if (opts.auto) { var sorted = items().sort(opts.auto); sorted.forEach(function (el) { container.appendChild(el); }); }
    }
    function order() { return items().map(opts.key); }
    function commit(movedKey) {
      var list = items().map(function (el) { return { key: opts.key(el), sort: opts.getSort(el), el: el }; });
      var g = drag ? drag.group : null;
      var scope = g == null ? list : list.filter(function (x) { return opts.group(x.el) === g; });
      var changes = diffNumbers(scope, movedKey, opts.step).map(function (c) { var it = scope.find(function (x) { return x.key === c.key; }); if (it && it.el.dataset) it.el.dataset.sort = String(c.sort); return { key: c.key, sort: c.sort, el: it && it.el }; });
      var ord = order();
      container.dispatchEvent(new CustomEvent('sonor:reorder', { detail: { changes: changes, order: ord, moved: movedKey } }));
      if (opts.onReorder) { try { var p = opts.onReorder(changes, ord, movedKey); if (p && p.catch) p.catch(function (e) { console.warn('[SonorSortable] onReorder failed', e); }); } catch (e) { console.warn('[SonorSortable] onReorder threw', e); } }
      return changes;
    }
    function refuse(why) { container.dispatchEvent(new CustomEvent('sonor:sort-refused', { detail: { why: why } })); }

    // ── pointer drag ──
    function onDown(ev) {
      var h = ev.target.closest && ev.target.closest(opts.handle); if (!h || !container.contains(h)) return;
      if (opts.auto) { refuse('derived'); return; }
      var el = h.closest(opts.item); if (!el) return; ev.preventDefault();
      var r = el.getBoundingClientRect();
      drag = { el: el, key: opts.key(el), group: opts.group(el), startX: ev.clientX, startY: ev.clientY, dx: ev.clientX - r.left, dy: ev.clientY - r.top, w: r.width, h: r.height, moved: false, pointerId: ev.pointerId };
      try { h.setPointerCapture(ev.pointerId); } catch (_) {}
      doc.addEventListener('pointermove', onMove); doc.addEventListener('pointerup', onUp); doc.addEventListener('pointercancel', onUp);
    }
    function makeGhost() {
      ghost = drag.el.cloneNode(true); ghost.className += ' s-drag-ghost'; ghost.removeAttribute('id');
      if (drag.el.tagName === 'TR') { var t = doc.createElement('table'); t.className = 's-drag-ghost-table'; var tb = doc.createElement('tbody'); tb.appendChild(ghost); t.appendChild(tb); t.style.width = drag.w + 'px'; ghost = t; }
      ghost.style.cssText += ';position:fixed;left:0;top:0;width:' + drag.w + 'px;pointer-events:none;z-index:9999;opacity:.92;transform:translate(' + (drag.startX - drag.dx) + 'px,' + (drag.startY - drag.dy) + 'px) rotate(.4deg);box-shadow:0 12px 32px rgba(0,0,0,.35)';
      doc.body.appendChild(ghost); drag.el.classList.add('s-dragging'); doc.body.classList.add('s-sorting');
    }
    function targetAt(x, y) {
      var list = items().filter(function (el) { return el !== drag.el && opts.group(el) === drag.group; });
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (opts.axis === 'grid') { if (y < r.top || y > r.bottom) continue; best = { el: list[i], before: x < r.left + r.width / 2 }; if (x <= r.right) break; }
        else if (opts.axis === 'x') { if (x < r.left) { best = { el: list[i], before: true }; break; } best = { el: list[i], before: x < r.left + r.width / 2 }; }
        else { if (y < r.top) { best = { el: list[i], before: true }; break; } best = { el: list[i], before: y < r.top + r.height / 2 }; }
      }
      return best;
    }
    function onMove(ev) {
      if (!drag) return;
      if (!drag.moved) { if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4) return; drag.moved = true; makeGhost(); }
      ghost.style.transform = 'translate(' + (ev.clientX - drag.dx) + 'px,' + (ev.clientY - drag.dy) + 'px) rotate(.4deg)';
      var t = targetAt(ev.clientX, ev.clientY);
      if (t) { var same = t.before ? t.el.previousElementSibling === drag.el : t.el.nextElementSibling === drag.el; if (!same) { t.before ? t.el.parentNode.insertBefore(drag.el, t.el) : t.el.parentNode.insertBefore(drag.el, t.el.nextSibling); } }
      // auto-scroll the nearest scrollable ancestor
      var sc = scrollParent(container); if (sc) { var rr = sc === doc.scrollingElement ? { top: 0, bottom: global.innerHeight } : sc.getBoundingClientRect(); var edge = 40; if (ev.clientY < rr.top + edge) sc.scrollTop -= 12; else if (ev.clientY > rr.bottom - edge) sc.scrollTop += 12; }
    }
    function onUp() {
      doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onUp); doc.removeEventListener('pointercancel', onUp);
      if (!drag) return;
      if (ghost) { ghost.remove(); ghost = null; }
      drag.el.classList.remove('s-dragging'); doc.body.classList.remove('s-sorting');
      if (drag.moved) { drag.el.classList.add('s-dropped'); setTimeout(function (el) { el.classList.remove('s-dropped'); }, 600, drag.el); commit(drag.key); }
      drag = null;
    }
    function scrollParent(el) { for (var p = el; p && p !== doc.body; p = p.parentElement) { var o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return doc.scrollingElement; }

    // ── keyboard on the handle ──
    function onKey(ev) {
      var h = ev.target.closest && ev.target.closest(opts.handle); if (!h || !container.contains(h)) return;
      if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      if (opts.auto) { refuse('derived'); return; }
      ev.preventDefault(); var el = h.closest(opts.item), g = opts.group(el);
      var sib = items().filter(function (x) { return opts.group(x) === g; }); var i = sib.indexOf(el); if (i < 0) return;
      var j = ev.shiftKey ? (ev.key === 'ArrowUp' ? 0 : sib.length - 1) : (ev.key === 'ArrowUp' ? i - 1 : i + 1);
      if (j < 0 || j >= sib.length || j === i) return;
      if (j < i) sib[j].parentNode.insertBefore(el, sib[j]); else sib[j].parentNode.insertBefore(el, sib[j].nextSibling);
      drag = { group: g }; commit(opts.key(el)); drag = null; h.focus();
    }

    container.addEventListener('pointerdown', onDown); container.addEventListener('keydown', onKey);
    refresh();
    return { destroy: function () { container.removeEventListener('pointerdown', onDown); container.removeEventListener('keydown', onKey); }, refresh: refresh, order: order, renumber: function () { drag = { group: null }; var c = []; var groups = {}; items().forEach(function (el) { (groups[opts.group(el)] = groups[opts.group(el)] || []).push(el); }); Object.keys(groups).forEach(function (g) { var m = renumber(groups[g].map(opts.key), opts.step); groups[g].forEach(function (el) { var n = m.get(opts.key(el)); if (opts.getSort(el) !== n) { el.dataset.sort = String(n); c.push({ key: opts.key(el), sort: n, el: el }); } }); }); drag = null; if (c.length && opts.onReorder) opts.onReorder(c, order(), null); return c; } };
  }

  // ── DECLARATIVE MODE (v0.2.0, sonor-platform §10/§16): no JS in the app at all ─────────────────────────────────────
  //   <tbody data-sortable="wq_scaffold_lines" data-sort-col="sort" data-sort-id="id" data-sort-item="tr[data-id]"
  //          data-sort-group="data-group" data-sort-axis="y" data-sort-handle="td:first-child">
  //   Every [data-sortable] in the page (now or later — MutationObserver) is attached; rows carry data-id + data-sort.
  //   Persistence: SonorSortable.persist(table, idCol, sortCol, changes) → default = UPDATE per changed row through the
  //   first Supabase client it can find (SonorSortable.client() resolver — override per app if yours lives elsewhere).
  //   The container still gets 'sonor:reorder' so an app can refresh its own in-memory rows.
  function findClient() {
    var cands = [global.SonorSortable && global.SonorSortable._client, global.SonorDB && (global.SonorDB.current && global.SonorDB.current.client || global.SonorDB.client), global.sonorDb && global.sonorDb.client, global.db && global.db.client, global._supaDb && global._supaDb.client, global.supabaseClient, global.supa, global.S && global.S.db && global.S.db.client];
    for (var i = 0; i < cands.length; i++) if (cands[i] && typeof cands[i].from === 'function') return cands[i];
    try { if (global.supabase && global.supabase.createClient && typeof SONOR_SUPABASE_URL !== 'undefined') { var made = global.supabase.createClient(SONOR_SUPABASE_URL, SONOR_SUPABASE_ANON); return made; } } catch (_) {}
    return null;
  }
  async function persist(table, idCol, sortCol, changes) {
    var c = findClient(); if (!c) throw new Error('SonorSortable: no Supabase client found — set SonorSortable._client');
    var results = await Promise.all(changes.map(function (ch) { var patch = {}; patch[sortCol] = ch.sort; return c.from(table).update(patch).eq(idCol, ch.key); }));
    var bad = results.find(function (r) { return r && r.error; }); if (bad) throw bad.error;
    return changes.length;
  }
  var _declared = new WeakMap();
  function attachDeclared(el) {
    if (_declared.has(el)) { _declared.get(el).refresh(); return; }
    var d = el.dataset, table = d.sortable, idCol = d.sortId || 'id', sortCol = d.sortCol || 'sort', groupAttr = d.sortGroup;
    var inst = attach(el, {
      item: d.sortItem || '[data-id]', mountHandle: d.sortHandle || (el.tagName === 'TBODY' || el.tagName === 'TABLE' ? 'td:first-child' : 'self'), axis: d.sortAxis || (el.tagName === 'TBODY' ? 'y' : 'grid'), step: Number(d.sortStep) || 10,
      group: groupAttr ? function (it) { return it.getAttribute(groupAttr) || ''; } : function () { return ''; },
      onReorder: async function (changes) {
        try { await (global.SonorSortable.persist || persist)(table, idCol, sortCol, changes); el.dispatchEvent(new CustomEvent('sonor:reorder-saved', { detail: { table: table, changes: changes } })); if (global.SonorShell && global.SonorShell.toast) global.SonorShell.toast(changes.length === 1 ? 'Order saved' : 'Order saved · ' + changes.length + ' renumbered', { kind: 'ok' }); }
        catch (e) { console.warn('[SonorSortable] persist failed', e); el.dispatchEvent(new CustomEvent('sonor:reorder-failed', { detail: { table: table, error: e } })); if (global.SonorShell && global.SonorShell.toast) global.SonorShell.toast('Order not saved: ' + (e.message || e), { kind: 'error' }); }
      }
    });
    if (inst) _declared.set(el, inst);
  }
  function scan(root) { (root || doc).querySelectorAll('[data-sortable]').forEach(attachDeclared); }
  if (doc) {
    var boot = function () { scan(); try { new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; if (n.matches && n.matches('[data-sortable]')) attachDeclared(n); else if (n.querySelectorAll) scan(n); }); if (m.target && m.target.matches && m.target.matches('[data-sortable]')) attachDeclared(m.target); }); }).observe(doc.documentElement, { childList: true, subtree: true }); } catch (_) {} };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
  }

  global.SonorSortable = { VERSION: VERSION, attach: attach, renumber: renumber, gapAfter: gapAfter, diffNumbers: diffNumbers, HANDLE_SVG: HANDLE_SVG, persist: persist, client: findClient, scan: scan, _client: null };
})(typeof window !== 'undefined' ? window : globalThis);
