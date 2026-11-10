/**
 * sonor-catalogue-picker.js — ONE categorised picker for every "add from the Library" menu (sonor-kit, B-504, 2026-09-30).
 * Bryn: "organise the available rack devices menu better, using only rack items not every device in library, categorised
 * lists, like we talked about — improved across the whole workspace."
 *
 *   <sonor-catalogue-picker></sonor-catalogue-picker>
 *   picker.items = [{ id, label, sub, manufacturer, model, service:'02', serviceName:'Audio', category:'Amplifiers',
 *                     kind:'device'|'accessory'|'vertical', heightU, colour }]   // the HOST filters (rack-only etc.)
 *   picker.tabs  = [{ id:'device', label:'Devices', hint:'…' }, { id:'accessory', label:'Accessories', hint:'…' }]
 *   attributes: placeholder="Search…"  group-by="service,category" (default)  open-first  compact
 *   events:  sonor:pick { item, tab }          click / Enter on an item
 *            sonor:pick-drag { item, tab, pointerEvent }   pointerdown on an item — host calls grid.beginExternalDrag
 *            sonor:pick-close
 *   API:     picker.focusSearch()  picker.setTab(id)  picker.expandAll(bool)
 *
 *   What it does: groups by service (01 Cinema … 10 Infrastructure, service colour bar) then by category (collapsible,
 *   counts, remembered per tab in sessionStorage), search across label/manufacturer/model/category with the groups
 *   auto-expanding on a hit, keyboard ↑↓ Enter Esc, U-size badge, service swatch, empty-state per tab. Light DOM
 *   (so the app's tokens and the kit CSS apply), no shadow root.
 */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = global.document;
  var Base = typeof HTMLElement !== 'undefined' ? HTMLElement : function () {};
  var SERVICE_NAMES = { '01': 'Cinema', '02': 'Audio', '03': 'Video', '04': 'Lighting', '05': 'Automation', '06': 'Climate', '07': 'Control', '08': 'Security', '09': 'Network', '10': 'Infrastructure', '20': 'Other' };
  var SERVICE_COLOURS = { '01': '#8058a1', '02': '#4bb9d3', '03': '#78ba57', '04': '#f5d05c', '05': '#e37c59', '06': '#ec6061', '07': '#e67eb1', '08': '#ad9978', '09': '#b7b1a7', '10': '#302f2e', '20': '#64748B' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function svcKey(it) { var s = String(it.service || it.service_nn || '').replace(/^s/, ''); if (/^\d$/.test(s)) s = '0' + s; return SERVICE_NAMES[s] ? s : '20'; }

  function Picker() { return Reflect.construct(Base, [], Picker); }
  Picker.prototype = Object.create(Base.prototype);
  Picker.prototype.constructor = Picker;
  Object.defineProperty(Picker, 'observedAttributes', { get: function () { return ['placeholder', 'group-by', 'compact']; } });

  Picker.prototype.connectedCallback = function () {
    this._items = this._items || []; this._tabs = this._tabs || [{ id: 'all', label: 'All' }]; this._tab = this._tab || this._tabs[0].id; this._q = ''; this._cursor = -1; this._open = {};
    this.classList.add('s-cat-picker'); this.setAttribute('role', 'dialog');
    this._render();
  };
  Picker.prototype.attributeChangedCallback = function () { if (this.isConnected) this._render(); };
  Object.defineProperty(Picker.prototype, 'items', { get: function () { return this._items; }, set: function (v) { this._items = Array.isArray(v) ? v : []; if (this.isConnected) this._render(); } });
  Object.defineProperty(Picker.prototype, 'tabs', { get: function () { return this._tabs; }, set: function (v) { this._tabs = (Array.isArray(v) && v.length) ? v : [{ id: 'all', label: 'All' }]; if (!this._tabs.some(function (t) { return t.id === this._tab; }, this)) this._tab = this._tabs[0].id; if (this.isConnected) this._render(); } });
  Picker.prototype.setTab = function (id) { this._tab = id; this._cursor = -1; this._render(); };
  Picker.prototype.focusSearch = function () { var i = this.querySelector('.s-cp-search'); if (i) { i.focus(); i.select(); } };
  Picker.prototype.expandAll = function (on) { var self = this; this._groups().forEach(function (g) { g.cats.forEach(function (c) { self._open[self._tab + '|' + g.key + '|' + c.key] = !!on; }); }); this._render(); };

  Picker.prototype._visible = function () {
    var tab = this._tab, q = this._q.trim().toLowerCase();
    return this._items.filter(function (it) {
      if (tab !== 'all' && (it.kind || 'device') !== tab) return false;
      if (!q) return true;
      var hay = [it.label, it.sub, it.manufacturer, it.model, it.category, it.serviceName].join(' ').toLowerCase();
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
    });
  };
  Picker.prototype._groups = function () {
    var by = (this.getAttribute('group-by') || 'service,category').split(',').map(function (s) { return s.trim(); });
    var out = new Map();
    this._visible().forEach(function (it) {
      var sk = by[0] === 'service' ? svcKey(it) : (it[by[0]] || '—'); var sname = by[0] === 'service' ? (sk + ' ' + (it.serviceName || SERVICE_NAMES[sk])) : sk;
      if (!out.has(sk)) out.set(sk, { key: sk, name: sname, colour: it.colour && by[0] !== 'service' ? it.colour : (SERVICE_COLOURS[sk] || '#64748B'), cats: new Map(), n: 0 });
      var g = out.get(sk); var ck = by[1] ? (it[by[1]] || it.sub || 'General') : 'General';
      if (!g.cats.has(ck)) g.cats.set(ck, { key: ck, items: [] });
      g.cats.get(ck).items.push(it); g.n++;
    });
    return Array.from(out.values()).sort(function (a, b) { return a.key.localeCompare(b.key); }).map(function (g) { g.cats = Array.from(g.cats.values()).sort(function (a, b) { return a.key.localeCompare(b.key); }); g.cats.forEach(function (c) { c.items.sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); }); }); return g; });
  };
  Picker.prototype._isOpen = function (g, c) { var k = this._tab + '|' + g.key + '|' + c.key; if (this._q.trim()) return true; if (k in this._open) return this._open[k]; try { var s = sessionStorage.getItem('s-cp:' + k); if (s != null) return s === '1'; } catch (_) {} return this.hasAttribute('open-first') ? false : true; };
  Picker.prototype._toggle = function (g, c) { var k = this._tab + '|' + g.key + '|' + c.key; this._open[k] = !this._isOpen(g, c); try { sessionStorage.setItem('s-cp:' + k, this._open[k] ? '1' : '0'); } catch (_) {} this._render(); };

  Picker.prototype._render = function () {
    var self = this, tabs = this._tabs, tab = this._tab, groups = this._groups(), total = this._visible().length;
    var counts = {}; this._items.forEach(function (it) { var k = it.kind || 'device'; counts[k] = (counts[k] || 0) + 1; counts.all = (counts.all || 0) + 1; });
    var hint = (tabs.find(function (t) { return t.id === tab; }) || {}).hint || '';
    var flat = []; // for keyboard cursor
    var body = groups.length ? groups.map(function (g) {
      return '<section class="s-cp-svc" style="--c:' + g.colour + '"><h4 class="s-cp-svc-h"><span class="s-cp-bar"></span>' + esc(g.name) + '<span class="s-cp-n">' + g.n + '</span></h4>' +
        g.cats.map(function (c) {
          var open = self._isOpen(g, c);
          return '<div class="s-cp-cat' + (open ? ' open' : '') + '"><button type="button" class="s-cp-cat-h" data-g="' + esc(g.key) + '" data-c="' + esc(c.key) + '" aria-expanded="' + open + '"><span class="s-cp-chev"></span>' + esc(c.key) + '<span class="s-cp-n">' + c.items.length + '</span></button>' +
            (open ? '<div class="s-cp-items">' + c.items.map(function (it) { var idx = flat.push(it) - 1; var u = it.kind === 'vertical' ? '0U' : (it.heightU != null ? it.heightU + 'U' : ''); return '<button type="button" class="s-cp-item' + (idx === self._cursor ? ' cur' : '') + '" data-i="' + idx + '" title="' + esc(it.label) + (u ? ' (' + u + ')' : '') + '"><span class="s-cp-sw" style="background:' + esc(it.colour || g.colour) + '"></span><span class="s-cp-info"><span class="s-cp-name">' + esc(it.label) + '</span><span class="s-cp-meta">' + esc([it.manufacturer, it.model].filter(Boolean).join(' · ') || it.sub || '') + '</span></span>' + (u ? '<span class="s-cp-u">' + u + '</span>' : '') + '</button>'; }).join('') + '</div>' : '') + '</div>';
        }).join('') + '</section>';
    }).join('') : '<div class="s-cp-empty">' + (this._items.length ? 'Nothing matches “' + esc(this._q) + '”.' : 'Library is still loading…') + '</div>';
    this._flat = flat;
    this.innerHTML = '<div class="s-cp-head">' + (tabs.length > 1 ? '<div class="s-cp-tabs">' + tabs.map(function (t) { return '<button type="button" class="s-cp-tab' + (t.id === tab ? ' active' : '') + '" data-tab="' + esc(t.id) + '"' + (t.hint ? ' title="' + esc(t.hint) + '"' : '') + '>' + esc(t.label) + '<span class="s-cp-n">' + (counts[t.id] || 0) + '</span></button>'; }).join('') + '</div>' : '') +
      '<input class="s-cp-search" type="search" placeholder="' + esc(this.getAttribute('placeholder') || 'Search…') + '" value="' + esc(this._q) + '" aria-label="Search"><button type="button" class="s-cp-x" title="Close (Esc)">×</button></div>' +
      (hint ? '<div class="s-cp-hint">' + esc(hint) + '</div>' : '') +
      '<div class="s-cp-body">' + body + '</div>' +
      '<div class="s-cp-foot">' + total + ' of ' + this._items.length + ' · <button type="button" class="s-cp-link" data-act="expand">expand all</button> · <button type="button" class="s-cp-link" data-act="collapse">collapse all</button></div>';
    this._wire();
  };
  Picker.prototype._wire = function () {
    var self = this; var search = this.querySelector('.s-cp-search');
    search.addEventListener('input', function () { self._q = search.value; self._cursor = -1; var pos = search.selectionStart; self._render(); var s2 = self.querySelector('.s-cp-search'); s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (_) {} });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); self._cursor = Math.min(self._flat.length - 1, self._cursor + 1); self._paintCursor(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self._cursor = Math.max(0, self._cursor - 1); self._paintCursor(); }
      else if (e.key === 'Enter') { var it = self._flat[self._cursor] || self._flat[0]; if (it) self._pick(it); }
      else if (e.key === 'Escape') { self.dispatchEvent(new CustomEvent('sonor:pick-close')); }
    });
    this.querySelectorAll('.s-cp-tab').forEach(function (b) { b.addEventListener('click', function () { self.setTab(b.dataset.tab); self.focusSearch(); }); });
    this.querySelector('.s-cp-x').addEventListener('click', function () { self.dispatchEvent(new CustomEvent('sonor:pick-close')); });
    this.querySelectorAll('.s-cp-cat-h').forEach(function (b) { b.addEventListener('click', function () { var g = self._groups().find(function (x) { return x.key === b.dataset.g; }); var c = g && g.cats.find(function (x) { return x.key === b.dataset.c; }); if (c) self._toggle(g, c); }); });
    this.querySelectorAll('.s-cp-item').forEach(function (b) {
      b.addEventListener('click', function () { self._pick(self._flat[+b.dataset.i]); });
      b.addEventListener('pointerdown', function (ev) { if (ev.button !== 0) return; self.dispatchEvent(new CustomEvent('sonor:pick-drag', { detail: { item: self._flat[+b.dataset.i], tab: self._tab, pointerEvent: ev } })); });
    });
    this.querySelectorAll('.s-cp-link').forEach(function (b) { b.addEventListener('click', function () { self.expandAll(b.dataset.act === 'expand'); }); });
  };
  Picker.prototype._paintCursor = function () { var self = this; this.querySelectorAll('.s-cp-item').forEach(function (b) { var on = +b.dataset.i === self._cursor; b.classList.toggle('cur', on); if (on) b.scrollIntoView({ block: 'nearest' }); }); };
  Picker.prototype._pick = function (it) { if (!it) return; this.dispatchEvent(new CustomEvent('sonor:pick', { detail: { item: it, tab: this._tab } })); };

  if (typeof customElements !== 'undefined' && !customElements.get('sonor-catalogue-picker')) customElements.define('sonor-catalogue-picker', Picker);
  global.SonorCataloguePicker = { VERSION: VERSION, SERVICE_NAMES: SERVICE_NAMES, SERVICE_COLOURS: SERVICE_COLOURS, svcKey: svcKey };
})(typeof window !== 'undefined' ? window : globalThis);
