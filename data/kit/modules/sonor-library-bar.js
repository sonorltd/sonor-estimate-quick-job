/**
 * sonor-library-bar.js — THE library bar: a grouped service palette for any list of library items (sonor-kit v0.8.0, 2026-10-18).
 * Owner 2026-10-18: "the styling of library bar is nice, this could be applied elsewhere? … each app shows it slightly
 * different but the look is good" + "takeoffs has extras like counts etc so dont lose those".
 * Reference look: Engineering's LIBRARY panel (PaletteSidebar.jsx v0.41.2). Feature superset: Takeoffs block palette
 * (usage-count badges floor/project, S-4.17 NN.sub tiers, shape glyphs, Recent, "Used in this project", WQ filter, mode lock).
 *
 *   const bar = SonorLibraryBar.mount(hostEl, {
 *     items,                                   // any objects — the HOST filters (rack-only, no luminaires …)
 *     getId, getLabel, getMeta, getService,    // getService → '01' | 1 | 'cinema' | '04.2' | '01 Cinema' (sonorServiceRank when loaded)
 *     getSubgroup,                             // item → null | 'Speakers' | { key, label, order, colour }   (SonorLibraryBar.subgroups.*)
 *     getColour,                               // item → CSS colour override (Takeoffs colour_override); default var(--sNN)
 *     getSearchText, compareItems, filter,     // search haystack · in-group order (default label A→Z) · extra predicate
 *     renderIcon, renderItem,                  // (item, ctx) → html string | Node — glyph slot / whole row body override
 *     getItemBadges, getGroupBadges, getSubgroupBadges,  // → [{ label?, count?, tone, title, corner }] — patched live by refreshBadges()
 *     getItemAttrs,                            // item → { 'data-sizeable': 'true', title: '…' } extra attributes on the row
 *     sections,                                // pinned groups above the services: [{ id, label, getItems() | items, summary(items), defaultOpen, layout, getItemBadges }]
 *     recent: { max: 8 },                      // built-in Recent section, fed by bar.pushRecent(id)
 *     tools, headerExtra,                      // tool-row buttons [{ id, label, title, pressed, onClick(bar, tool) }] · Node|html beside the search
 *     title, status, onRefresh,                // "LIBRARY · 12 live" + ↻ (async ok) · status { tier, count, title, message }
 *     layout: 'list' | 'grid', gridColumns,    // Engineering rows · Takeoffs 3-up tiles
 *     collapsed, storageKey,                   // rail-collapse default (remembered per storageKey) · namespace for remembered state
 *     defaultOpen: true, persistSearch, showEmptyServices, chips: true, services,   // services: { '20': { name, short, colour } } overrides / extras
 *     pickOn: 'click' | 'dblclick', drag: 'html5' | 'pointer' | false, dragType,
 *     onPick(item, ev, via), onActivate(item, ev), onDragStart(item, ev), onRail(collapsed), onFilter({ service, q })
 *   });
 *   bar.setItems(items) · bar.update(opts) · bar.refreshBadges() · bar.setActive(id) · bar.setService(nn, { lock, hideSections })
 *   bar.setSearch(q) · bar.expandAll(bool) · bar.setCollapsed(bool) · bar.setStatus(s) · bar.pushRecent(id) · bar.focusSearch()
 *   events on the element: sonor:library-pick · sonor:library-activate · sonor:library-drag · sonor:library-rail · sonor:library-filter
 *
 *   Light DOM (app tokens + kit CSS apply), styles in sonor-library-bar.css (kit.css, sonor-kit layer). Tree semantics:
 *   role=tree / treeitem / group, roving tabindex, ↑↓ ←→ Home End Enter Space, "/" jumps to search, ↓ from search enters the tree.
 */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = global.document;

  // ── services (labels only — ORDER comes from sonorServiceRank when the app has loaded sonor-app.js) ──
  var SERVICES = [
    { nn: '01', key: 'cinema', name: 'Cinema', short: 'CIN' },
    { nn: '02', key: 'audio', name: 'Audio', short: 'AUD' },
    { nn: '03', key: 'video', name: 'Video', short: 'VID' },
    { nn: '04', key: 'lighting', name: 'Lighting', short: 'LIGHT' },
    { nn: '05', key: 'automation', name: 'Automation', short: 'AUTO' },
    { nn: '06', key: 'climate', name: 'Climate', short: 'CLIM' },
    { nn: '07', key: 'control', name: 'Control', short: 'CTRL' },
    { nn: '08', key: 'security', name: 'Security', short: 'SEC' },
    { nn: '09', key: 'network', name: 'Network', short: 'NET' },
    { nn: '10', key: 'structure', name: 'Infrastructure', short: 'STR' }
  ];
  var ALIAS = { tv: '03', hvac: '06', cctv: '08', wifi: '09', data: '09', infrastructure: '10', infra: '10', cabling: '10', design: '10', media: '01', multiroom: '02', heating: '06', access: '08' };
  SERVICES.forEach(function (s) { ALIAS[s.key] = s.nn; ALIAS[s.name.toLowerCase()] = s.nn; ALIAS[s.short.toLowerCase()] = s.nn; });
  var OTHER = '99';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  /** Any service spelling → 'NN' ('01'…'10', app extras like '20', or '99' = Other). */
  function serviceNN(v, extras) {
    if (v == null || v === '') return OTHER;
    if (typeof v === 'object') v = v.service_nn || v.nn || v.service || v.service_key || v.key || '';
    if (typeof v === 'number' && isFinite(v)) v = String(Math.floor(v));
    var s = lc(v).replace(/^s(?=\d)/, '');
    var m = s.match(/^(\d{1,2})(?:[.\s·_-]|$)/);
    if (m) { var nn = m[1].length === 1 ? '0' + m[1] : m[1]; return (+nn >= 1 && +nn <= 10) || (extras && extras[nn]) ? nn : OTHER; }
    var word = s.split(/[\s·_-]+/)[0];
    if (ALIAS[s]) return ALIAS[s]; if (ALIAS[word]) return ALIAS[word];
    if (typeof global.sonorServiceRank === 'function') { var r = global.sonorServiceRank(v); if (r >= 1 && r <= 10) return (r < 10 ? '0' : '') + r; }
    return OTHER;
  }
  function serviceRank(nn) { return nn === OTHER ? 9999 : (+nn || 9998); }
  function serviceMeta(nn, extras) {
    var base = SERVICES[+nn - 1] && SERVICES[+nn - 1].nn === nn ? SERVICES[+nn - 1] : null;
    var x = (extras && extras[nn]) || {};
    var name = x.name || (base ? base.name : (nn === OTHER ? 'Other' : 'Service ' + nn));
    return { nn: nn, key: x.key || (base ? base.key : 'svc' + nn), name: name, short: x.short || (base ? base.short : name.slice(0, 4).toUpperCase()),
      colour: x.colour || (base ? 'var(--slb-s' + nn + ', var(--s' + nn + '))' : 'var(--text-muted)') };
  }

  // ── subgroup helpers (pass as getSubgroup) ──
  var subgroups = {
    /** S-4.17 decimal tiers: rows carry service_sub ('1', '2', '20') + sub_name. Label "04.2 · Keypads"; numeric order; none → "NN · Other" last. */
    byTier: function (o) {
      o = o || {}; var subF = o.sub || 'service_sub', nameF = o.name || 'sub_name', svcF = o.service || null;
      return function (it, nn) {
        var sub = String(it[subF] == null ? '' : it[subF]).trim(); var name = String(it[nameF] == null ? '' : it[nameF]).trim();
        if (!sub) return name ? { key: 'name:' + lc(name), label: nn + ' · ' + name, order: 5000, nameOrder: lc(name) } : null;
        var f = parseFloat(sub); return { key: 'sub:' + sub, label: nn + '.' + sub + (name ? ' · ' + name : ''), order: isFinite(f) ? f : 4000, nameOrder: lc(sub), named: name };
      };
    },
    /** One field (category, kind…), humanised. */
    byField: function (field, o) {
      o = o || {};
      return function (it, nn) {
        var v = String(it[field] == null ? '' : it[field]).trim(); if (!v) return null;
        var h = v.replace(/[_-]+/g, ' '); h = /^(hdbt|hdmi|hvac|ups|pdu|nvr|wap|tv|io|poe|av)\b/i.test(h) ? h.replace(/^\w+/, function (w) { return w.toUpperCase(); }) : h.charAt(0).toUpperCase() + h.slice(1);
        return { key: field + ':' + lc(v), label: (o.prefix === false ? '' : nn + ' · ') + h, order: o.order ? o.order(it) : 5000, nameOrder: lc(h) };
      };
    }
  };

  // ── the pure model (unit-tested in tests/library-bar.test.mjs) ──
  var defaults = {
    getId: function (it) { return it.id != null ? it.id : (it.block_code || it.code || it.model_id || it.sku || it.label); },
    getLabel: function (it) { return it.label != null ? it.label : (it.name || it.model || ''); },
    getMeta: function (it) { return [it.manufacturer, it.model || it.modelNumber].filter(Boolean).join(' · ') || it.sub || ''; },
    getService: function (it) { return it.service_nn != null ? it.service_nn : (it.service != null ? it.service : it.nn); },
    getSearchText: null, compareItems: null
  };
  function opt(o, k) { return (o && typeof o[k] === 'function') ? o[k] : defaults[k]; }
  function labelSort(o) { var gl = opt(o, 'getLabel'), gi = opt(o, 'getId'); return function (a, b) { return lc(gl(a)).localeCompare(lc(gl(b))) || String(gi(a)).localeCompare(String(gi(b))); }; }
  function haystack(o, it) {
    if (o && typeof o.getSearchText === 'function') return lc(o.getSearchText(it));
    return lc([opt(o, 'getLabel')(it), opt(o, 'getMeta')(it), it.manufacturer, it.model, it.modelNumber, it.code, it.block_code, it.short_code, it.category, it.serviceName].filter(Boolean).join(' '));
  }
  function matches(o, it, q) { if (!q) return true; var h = haystack(o, it); return q.split(/\s+/).every(function (w) { return h.indexOf(w) >= 0; }); }
  function sortSubs(a, b) {
    var ao = !a.key || a.key === '__other__', bo = !b.key || b.key === '__other__';
    if (ao !== bo) return ao ? 1 : -1;
    return (a.order - b.order) || String(a.nameOrder || a.label).localeCompare(String(b.nameOrder || b.label));
  }
  /** items + opts + { service, q } → { total, shown, counts, groups[] } — groups 01→10 (then extras, Other last), subgroups, items sorted. */
  function buildModel(items, o, st) {
    o = o || {}; st = st || {}; var extras = o.services || null;
    var gs = opt(o, 'getService'), q = lc(st.q), svc = st.service || null, extra = typeof o.filter === 'function' ? o.filter : null;
    var counts = { all: 0 }, by = new Map(), shown = 0, cmp = typeof o.compareItems === 'function' ? o.compareItems : labelSort(o);
    (items || []).forEach(function (it) {
      if (extra && !extra(it)) return;
      var nn = serviceNN(gs(it), extras); counts[nn] = (counts[nn] || 0) + 1; counts.all++;
      if (svc && nn !== svc) return; if (!matches(o, it, q)) return;
      if (!by.has(nn)) by.set(nn, []); by.get(nn).push(it); shown++;
    });
    if (o.showEmptyServices && !q) SERVICES.forEach(function (s) { if ((!svc || svc === s.nn) && !by.has(s.nn)) by.set(s.nn, []); });
    var groups = Array.from(by.keys()).sort(function (a, b) { return serviceRank(a) - serviceRank(b); }).map(function (nn) {
      var meta = serviceMeta(nn, extras), rows = by.get(nn), g = { kind: 'service', key: 'svc:' + nn, nn: nn, name: meta.name, short: meta.short, colour: meta.colour, count: rows.length, items: rows, subgroups: null };
      if (typeof o.getSubgroup === 'function') {
        var subs = new Map();
        rows.forEach(function (it) {
          var r = o.getSubgroup(it, nn); if (typeof r === 'string') r = r.trim() ? { key: lc(r), label: r } : null;
          var k = r && r.key != null ? String(r.key) : '__other__';
          if (!subs.has(k)) subs.set(k, { key: k === '__other__' ? '__other__' : k, gkey: g.key + '|' + k, label: r ? r.label : (o.otherLabel ? o.otherLabel(nn) : nn + ' · Other'), order: r && r.order != null ? r.order : 5000, nameOrder: r ? r.nameOrder : null, colour: r ? r.colour : null, items: [] });
          var s = subs.get(k); if (r && !s.colour && r.colour) s.colour = r.colour; if (r && r.named && s.label.indexOf(' · ') < 0) s.label += ' · ' + r.named;
          s.items.push(it);
        });
        g.subgroups = Array.from(subs.values()).sort(sortSubs); g.subgroups.forEach(function (s) { s.items.sort(cmp); });
      } else rows.sort(cmp);
      return g;
    });
    return { total: counts.all, shown: shown, counts: counts, groups: groups };
  }

  // ── storage (every access wrapped — private windows / previews throw) ──
  function lsGet(k, d) { try { var v = global.localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (_) {} }
  function ssGet(k, d) { try { var v = global.sessionStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
  function ssSet(k, v) { try { global.sessionStorage.setItem(k, v); } catch (_) {} }

  function badgeHtml(b) {
    if (!b) return ''; var txt = b.label != null ? String(b.label) : (b.count != null ? (b.count > 99 ? '99+' : String(b.count)) : '');
    if (!txt || (b.count === 0 && !b.showZero && b.label == null)) return '';
    return '<span class="slb-badge slb-tone-' + esc(b.tone || 'muted') + (b.corner ? ' slb-corner' : '') + '"' + (b.title ? ' title="' + esc(b.title) + '"' : '') + '>' + esc(txt) + '</span>';
  }
  function badgesHtml(list) { return (Array.isArray(list) ? list : list ? [list] : []).map(badgeHtml).join(''); }
  function toHtml(v) { return v == null ? '' : (typeof v === 'string' ? v : ''); }

  // ── the element ──
  var Base = typeof HTMLElement !== 'undefined' ? HTMLElement : function () {};
  function Bar() { return Reflect.construct(Base, [], Bar); }
  Bar.prototype = Object.create(Base.prototype);
  Bar.prototype.constructor = Bar;

  Bar.prototype.connectedCallback = function () {
    if (!this._o) this.configure({});
    else if (!this._built) this._build();
  };
  Bar.prototype.configure = function (o) {
    this._o = Object.assign({}, this._o || {}, o || {});
    var key = this._o.storageKey || 'sonor-library-bar';
    // state is (re)read when the storage namespace is first known — an element upgraded before mount() must not keep the default key's state
    if (this._st && this._stKey !== key && !this._st.touched) this._st = null;
    if (this._st && o && 'collapsed' in o && !this._st.touched && lsGet(key + ':rail', null) == null) this._st.rail = !!o.collapsed;
    if (!this._st) {
      this._stKey = key;
      var openRaw = lsGet(key + ':closed', null), closed = new Set(); try { var arr = JSON.parse(openRaw || '[]'); if (Array.isArray(arr)) arr.forEach(function (k) { closed.add(k); }); } catch (_) {}
      var opened = new Set(); try { var arr2 = JSON.parse(lsGet(key + ':opened', '[]')); if (Array.isArray(arr2)) arr2.forEach(function (k) { opened.add(k); }); } catch (_) {}
      var rail = lsGet(key + ':rail', null);
      this._st = { q: this._o.persistSearch ? ssGet(key + ':q', '') : '', service: null, lock: false, hideSections: false, closed: closed, opened: opened,
        rail: rail == null ? !!this._o.collapsed : rail === '1', active: null, focusKey: null, reloading: false };
    }
    this._items = Array.isArray(this._o.items) ? this._o.items : (this._items || []);
    if (this.isConnected) this._build();
    return this;
  };
  Bar.prototype.update = function (o) { return this.configure(o); };
  Object.defineProperty(Bar.prototype, 'items', { get: function () { return this._items || []; }, set: function (v) { this.setItems(v); } });
  Bar.prototype.setItems = function (items) { this._items = Array.isArray(items) ? items : []; if (this._o) this._o.items = this._items; if (this._built) { this._renderChips(); this._renderBody(); this._renderHead(); } return this; };
  Bar.prototype.setStatus = function (s) { this._o.status = s; if (this._built) this._renderHead(); return this; };
  Bar.prototype.setSearch = function (q) { this._st.q = String(q || ''); var i = this.querySelector('.slb-search'); if (i && i.value !== this._st.q) i.value = this._st.q; this._persistQ(); this._renderBody(); this._emitFilter(); return this; };
  Bar.prototype.setService = function (nn, o) {
    o = o || {}; this._st.service = nn ? serviceNN(nn, this._o.services) : null; this._st.lock = !!(nn && o.lock); this._st.hideSections = !!(nn && (o.hideSections != null ? o.hideSections : o.lock));
    if (this._built) { this._renderChips(); this._renderBody(); } this._emitFilter(); return this;
  };
  Bar.prototype.setActive = function (id) { this._st.active = id == null ? null : String(id); this.querySelectorAll('.slb-item').forEach(function (el) { var on = el.dataset.id === this._st.active; el.classList.toggle('slb-active', on); el.setAttribute('aria-selected', on ? 'true' : 'false'); }, this); return this; };
  Bar.prototype.focusSearch = function () { if (this._st.rail) this.setCollapsed(false); var i = this.querySelector('.slb-search'); if (i) { i.focus(); i.select(); } };
  Bar.prototype.setCollapsed = function (on) {
    this._st.rail = !!on; this._st.touched = true; lsSet((this._o.storageKey || 'sonor-library-bar') + ':rail', on ? '1' : '0'); this._build();
    if (typeof this._o.onRail === 'function') this._o.onRail(!!on);
    this.dispatchEvent(new CustomEvent('sonor:library-rail', { bubbles: true, detail: { collapsed: !!on } })); return this;
  };
  Bar.prototype.expandAll = function (on) {
    var self = this; this._groupsAll().forEach(function (g) { self._setOpen(g.key, !!on, true); (g.subgroups || []).forEach(function (s) { self._setOpen(s.gkey, !!on, true); }); });
    this._saveOpen(); this._renderBody(); return this;
  };
  Bar.prototype.pushRecent = function (id) {
    if (id == null) return this; var k = (this._o.storageKey || 'sonor-library-bar') + ':recent', max = (this._o.recent && this._o.recent.max) || 8;
    var list = []; try { list = JSON.parse(lsGet(k, '[]')) || []; } catch (_) {} id = String(id);
    list = [id].concat(list.filter(function (x) { return x !== id; })).slice(0, max); lsSet(k, JSON.stringify(list)); if (this._built) this._renderBody(); return this;
  };
  Bar.prototype.getModel = function () { return buildModel(this._items, this._o, this._st); };

  // open state: services/sections default open (defaultOpen), remembered as exceptions
  Bar.prototype._defaultOpen = function (key) { var d = this._o.defaultOpen; if (typeof d === 'function') return !!d(key); var sec = (this._o.sections || []).find(function (s) { return 'sec:' + s.id === key; }); if (sec && sec.defaultOpen != null) return !!sec.defaultOpen; return d == null ? true : !!d; };
  Bar.prototype._isOpen = function (key) { if (this._st.q.trim()) return true; if (this._st.closed.has(key)) return false; if (this._st.opened.has(key)) return true; return this._defaultOpen(key); };
  Bar.prototype._setOpen = function (key, on, noSave) { var d = this._defaultOpen(key); this._st.closed.delete(key); this._st.opened.delete(key); if (on !== d) (on ? this._st.opened : this._st.closed).add(key); if (!noSave) this._saveOpen(); };
  Bar.prototype._saveOpen = function () { var k = this._o.storageKey || 'sonor-library-bar'; lsSet(k + ':closed', JSON.stringify(Array.from(this._st.closed))); lsSet(k + ':opened', JSON.stringify(Array.from(this._st.opened))); };
  Bar.prototype._persistQ = function () { if (this._o.persistSearch) ssSet((this._o.storageKey || 'sonor-library-bar') + ':q', this._st.q); };
  Bar.prototype._emitFilter = function () { var d = { service: this._st.service, q: this._st.q }; if (typeof this._o.onFilter === 'function') this._o.onFilter(d); this.dispatchEvent(new CustomEvent('sonor:library-filter', { bubbles: true, detail: d })); };

  Bar.prototype._sections = function () {
    var o = this._o, self = this, out = [], gi = opt(o, 'getId');
    if (this._st.hideSections) return out;
    var defs = (o.sections || []).slice();
    if (o.recent) {
      var ids = []; try { ids = JSON.parse(lsGet((o.storageKey || 'sonor-library-bar') + ':recent', '[]')) || []; } catch (_) {}
      var byId = new Map(); this._items.forEach(function (it) { byId.set(String(gi(it)), it); });
      defs.unshift(Object.assign({ id: 'recent', label: 'Recent', layout: o.recent.layout }, o.recent, { items: ids.map(function (i) { return byId.get(i); }).filter(Boolean) }));
    }
    defs.forEach(function (s) {
      var items = typeof s.getItems === 'function' ? (s.getItems(self) || []) : (s.items || []);
      if (!items.length && s.hideWhenEmpty !== false) return;
      out.push({ kind: 'section', key: 'sec:' + s.id, id: s.id, name: s.label || s.id, def: s, items: items, count: items.length, colour: s.colour || 'var(--accent)', summary: typeof s.summary === 'function' ? s.summary(items) : null, subgroups: null });
    });
    return out;
  };
  Bar.prototype._groupsAll = function () { return this._sections().concat(this.getModel().groups); };

  // ── build (shell) ──
  Bar.prototype._build = function () {
    var o = this._o, st = this._st, self = this;
    this.classList.add('slb'); this.classList.toggle('slb-rail', st.rail); this.classList.toggle('slb-grid', o.layout === 'grid');
    if (o.gridColumns) this.style.setProperty('--slb-cols', String(o.gridColumns));
    this._built = true;
    if (st.rail) {
      this.innerHTML = '<button type="button" class="slb-rail-btn" aria-expanded="false" aria-label="Open ' + esc(o.title || 'Library') + '" title="Open ' + esc(o.title || 'library') + '"><span class="slb-chev slb-chev-r" aria-hidden="true"></span><span class="slb-rail-title">' + esc(o.title || 'Library') + '</span><span class="slb-rail-n">' + this.getModel().total + '</span></button>';
      this.querySelector('.slb-rail-btn').addEventListener('click', function () { self.setCollapsed(false); });
      return;
    }
    this.innerHTML =
      '<div class="slb-head">' +
        '<div class="slb-head-row"><span class="slb-title"></span><span class="slb-status"></span>' +
          (o.onRefresh ? '<button type="button" class="slb-ibtn slb-reload" title="Reload library" aria-label="Reload library"><span aria-hidden="true">↻</span></button>' : '') +
          (o.collapsible === false ? '' : '<button type="button" class="slb-ibtn slb-collapse" aria-expanded="true" title="Collapse library" aria-label="Collapse library"><span class="slb-chev slb-chev-l" aria-hidden="true"></span></button>') +
        '</div>' +
        '<div class="slb-banner" hidden></div>' +
        '<div class="slb-search-row"><input class="slb-search" type="search" autocomplete="off" spellcheck="false" aria-label="Search the library" placeholder="' + esc(o.placeholder || 'Search by name, manufacturer, model…') + '"><span class="slb-extra"></span></div>' +
        (o.chips === false ? '' : '<div class="slb-chips" role="toolbar" aria-label="Filter by service"></div>') +
      '</div>' +
      '<div class="slb-tools"><button type="button" class="slb-tool" data-act="expand" title="Expand every group"><span aria-hidden="true">⊞</span> Expand all</button><button type="button" class="slb-tool" data-act="collapse" title="Collapse every group"><span aria-hidden="true">⊟</span> Collapse all</button></div>' +
      '<div class="slb-hint" aria-live="polite"></div>' +
      '<div class="slb-body" role="tree" aria-label="' + esc(o.title || 'Library') + '"></div>';
    var search = this.querySelector('.slb-search'); search.value = st.q;
    var extra = this.querySelector('.slb-extra'); var hx = typeof o.headerExtra === 'function' ? o.headerExtra(this) : o.headerExtra;
    if (hx && typeof hx === 'object' && hx.nodeType) extra.appendChild(hx); else if (hx) extra.innerHTML = String(hx); else extra.remove();
    var tools = this.querySelector('.slb-tools');
    (o.tools || []).forEach(function (t) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'slb-tool slb-tool-x'; b.dataset.tool = t.id; if (t.title) b.title = t.title;
      if (typeof t.pressed === 'boolean') b.setAttribute('aria-pressed', String(t.pressed));
      if (t.label && t.label.nodeType) b.appendChild(t.label); else b.innerHTML = String(t.label || t.id);
      b.addEventListener('click', function (ev) { if (typeof t.onClick === 'function') t.onClick(self, t, ev); if (typeof t.pressed === 'boolean') b.setAttribute('aria-pressed', String(!!t.pressed)); });
      tools.appendChild(b);
    });
    if (o.toolsNote) { var n = doc.createElement('span'); n.className = 'slb-note'; n.textContent = o.toolsNote; tools.appendChild(n); }
    search.addEventListener('input', function () { st.q = search.value; self._persistQ(); self._renderBody(); self._emitFilter(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); var f = self.querySelector('.slb-body [role="treeitem"]'); if (f) self._focus(f); }
      else if (e.key === 'Enter') { var first = self.querySelector('.slb-body .slb-item'); if (first && st.q.trim()) { e.preventDefault(); self._pick(first.dataset.id, e, 'keyboard'); } }
      else if (e.key === 'Escape' && search.value) { e.preventDefault(); self.setSearch(''); }
    });
    tools.querySelectorAll('.slb-tool[data-act]').forEach(function (b) { b.addEventListener('click', function () { self.expandAll(b.dataset.act === 'expand'); }); });
    var col = this.querySelector('.slb-collapse'); if (col) col.addEventListener('click', function () { self.setCollapsed(true); });
    var rl = this.querySelector('.slb-reload'); if (rl) rl.addEventListener('click', function () {
      if (st.reloading) return; st.reloading = true; rl.classList.add('slb-spin'); rl.disabled = true;
      Promise.resolve().then(function () { return o.onRefresh(self); }).catch(function () {}).then(function () { st.reloading = false; var r2 = self.querySelector('.slb-reload'); if (r2) { r2.classList.remove('slb-spin'); r2.disabled = false; } });
    });
    this._wireBody();
    this._renderHead(); this._renderChips(); this._renderBody();
  };

  Bar.prototype._renderHead = function () {
    if (this._st.rail) { var n = this.querySelector('.slb-rail-n'); if (n) n.textContent = this.getModel().total; return; }
    var o = this._o, s = o.status || null, total = this.getModel().total;
    this.querySelector('.slb-title').textContent = o.title || 'Library';
    var el = this.querySelector('.slb-status'), tier = s && s.tier ? s.tier : (s ? 'live' : null);
    if (!s) { el.innerHTML = '<span class="slb-n">' + total + '</span>'; el.removeAttribute('title'); el.className = 'slb-status'; }
    else {
      var live = tier === 'live'; el.className = 'slb-status slb-tier-' + esc(tier);
      el.innerHTML = '<span class="slb-dot" aria-hidden="true"></span>' + esc((s.count != null ? s.count : total) + ' ' + (s.label || (live ? 'live' : (tier === 'inline' ? 'inline only' : tier)))) + (live ? '' : ' <span aria-hidden="true">⚠</span>');
      if (s.title) el.title = s.title; else el.removeAttribute('title');
    }
    var ban = this.querySelector('.slb-banner'); if (s && s.message) { ban.hidden = false; ban.textContent = s.message; } else ban.hidden = true;
  };

  Bar.prototype._renderChips = function () {
    var box = this.querySelector('.slb-chips'); if (!box) return;
    var self = this, st = this._st, m = buildModel(this._items, this._o, { q: '' });
    var svcs = Object.keys(m.counts).filter(function (k) { return k !== 'all' && m.counts[k] > 0; }).sort(function (a, b) { return serviceRank(a) - serviceRank(b); });
    var chip = function (nn, label, n, colour) {
      var on = (st.service || null) === nn, dis = st.lock && !on;
      return '<button type="button" class="slb-chip' + (nn ? '' : ' slb-chip-all') + '" data-svc="' + esc(nn || '') + '" aria-pressed="' + on + '"' + (dis ? ' disabled' : '') + (colour ? ' style="--svc:' + esc(colour) + '"' : '') + ' title="' + esc(label) + '">' +
        (nn ? '<span class="slb-cdot" aria-hidden="true"></span>' : '') + esc(nn ? serviceMeta(nn, self._o.services).short : label) + ' <span class="slb-cn">' + n + '</span></button>';
    };
    box.innerHTML = chip(null, 'All', m.counts.all || 0) + svcs.map(function (nn) { var mm = serviceMeta(nn, self._o.services); return chip(nn, mm.nn + ' ' + mm.name, m.counts[nn], mm.colour); }).join('');
    box.querySelectorAll('.slb-chip').forEach(function (b) { b.addEventListener('click', function () { if (st.lock) return; self.setService(b.dataset.svc || null); }); });
    if (box._slbWired) return; box._slbWired = true;
    box.addEventListener('keydown', function (e) { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; var list = Array.from(box.querySelectorAll('.slb-chip:not([disabled])')); var i = list.indexOf(doc.activeElement); if (i < 0) return; e.preventDefault(); list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].focus(); });
  };

  Bar.prototype._itemHtml = function (it, g, sub, level, sectionDef) {
    var o = this._o, gi = opt(o, 'getId'), gl = opt(o, 'getLabel'), gm = opt(o, 'getMeta'), id = String(gi(it));
    var nn = serviceNN(opt(o, 'getService')(it), o.services);
    var colour = (typeof o.getColour === 'function' && o.getColour(it, sub, g)) || (sub && sub.colour) || serviceMeta(nn, o.services).colour;
    var ctx = { group: g, subgroup: sub, section: sectionDef || null, colour: colour, nn: nn, bar: this, esc: esc };
    var attrs = typeof o.getItemAttrs === 'function' ? (o.getItemAttrs(it, ctx) || {}) : {};
    var extra = Object.keys(attrs).map(function (k) { return /^[a-z][a-z0-9-]*$/i.test(k) && attrs[k] != null && attrs[k] !== false ? ' ' + k + '="' + esc(attrs[k]) + '"' : ''; }).join('');
    var badgeFn = (sectionDef && sectionDef.getItemBadges) || o.getItemBadges;
    var badges = typeof badgeFn === 'function' ? badgesHtml(badgeFn(it, ctx)) : '';
    var body;
    if (typeof o.renderItem === 'function') { var r = o.renderItem(it, ctx); body = typeof r === 'string' ? r : ''; if (r && r.nodeType) { this._nodes = this._nodes || []; this._nodes.push([id + '|' + g.key, r]); } }
    else {
      var icon = typeof o.renderIcon === 'function' ? toHtml(o.renderIcon(it, ctx)) : '';
      var meta = gm(it);
      body = (icon ? '<span class="slb-icon" aria-hidden="true">' + icon + '</span>' : '<span class="slb-sw" aria-hidden="true"></span>') +
        '<span class="slb-info"><span class="slb-name">' + esc(gl(it)) + '</span>' + (meta ? '<span class="slb-meta">' + esc(meta) + '</span>' : '') + '</span>';
    }
    var draggable = o.drag === 'html5' || (o.drag == null && typeof o.onDragStart === 'function');
    var on = this._st.active === id;
    return '<div class="slb-item' + (on ? ' slb-active' : '') + '" role="treeitem" aria-level="' + level + '" aria-selected="' + on + '" tabindex="-1" data-id="' + esc(id) + '" data-gkey="' + esc(g.key) + '" data-service-nn="' + esc(nn) + '" style="--svc:' + esc(colour) + '"' + (draggable ? ' draggable="true"' : '') + (attrs.title ? '' : ' title="' + esc(gl(it)) + '"') + extra + '>' +
      body + '<span class="slb-badges">' + badges + '</span></div>';
  };

  Bar.prototype._renderBody = function () {
    var body = this.querySelector('.slb-body'); if (!body) return;
    var self = this, o = this._o, st = this._st, model = this.getModel(), sections = this._sections(), groups = sections.concat(model.groups);
    var focusKey = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement.dataset.key || null : null;
    this._byKey = new Map(); this._nodes = [];
    var gi = opt(o, 'getId');
    var html = groups.map(function (g) {
      var open = self._isOpen(g.key), isSec = g.kind === 'section';
      var gb = isSec ? '' : (typeof o.getGroupBadges === 'function' ? badgesHtml(o.getGroupBadges(g)) : '');
      var layout = isSec && g.def.layout ? ' slb-layout-' + g.def.layout : '';
      var head = '<div class="slb-ghead" role="treeitem" aria-level="1" aria-expanded="' + open + '" tabindex="-1" data-key="' + esc(g.key) + '" data-gkey="' + esc(g.key) + '"' + (isSec ? '' : ' data-service-nn="' + esc(g.nn) + '"') + '>' +
        (isSec ? '<span class="slb-gname">' + esc(g.name) + '</span>' + (g.summary ? '<span class="slb-gsum">' + esc(g.summary) + '</span>' : '<span class="slb-gsum"></span>')
               : '<span class="slb-gdot" aria-hidden="true"></span><span class="slb-gnn">' + esc(g.nn === OTHER ? '··' : g.nn) + '</span><span class="slb-gname">' + esc(g.name) + '</span>') +
        '<span class="slb-badges slb-gbadges">' + gb + '</span><span class="slb-gcount">' + g.count + '</span><span class="slb-caret" aria-hidden="true"></span></div>';
      var inner = '';
      if (open) {
        if (!g.count) inner = '<div class="slb-gempty">' + esc(o.emptyGroupText || 'No items') + '</div>';
        else if (g.subgroups) inner = g.subgroups.map(function (s) {
          var so = self._isOpen(s.gkey);
          var sb = typeof o.getSubgroupBadges === 'function' ? badgesHtml(o.getSubgroupBadges(s, g)) : '';
          return '<div class="slb-sub" role="none"' + (s.colour ? ' style="--svc:' + esc(s.colour) + '"' : '') + '><div class="slb-shead" role="treeitem" aria-level="2" aria-expanded="' + so + '" tabindex="-1" data-key="' + esc(s.gkey) + '" data-gkey="' + esc(g.key) + '"><span class="slb-sname">' + esc(s.label) + '</span><span class="slb-badges slb-sbadges">' + sb + '</span><span class="slb-scount">' + s.items.length + '</span><span class="slb-caret slb-caret-s" aria-hidden="true"></span></div>' +
            (so ? '<div class="slb-items" role="group">' + s.items.map(function (it) { self._byKey.set(String(gi(it)), it); return self._itemHtml(it, g, s, 3); }).join('') + '</div>' : '') + '</div>';
        }).join('');
        else inner = '<div class="slb-items" role="group">' + g.items.map(function (it) { self._byKey.set(String(gi(it)), it); return self._itemHtml(it, g, null, 2, isSec ? g.def : null); }).join('') + '</div>';
      }
      return '<div class="slb-group' + (isSec ? ' slb-section' : '') + layout + (open ? ' slb-open' : '') + '" role="none" data-gkey="' + esc(g.key) + '"' + (isSec ? ' data-section="' + esc(g.id) + '"' : ' data-service-nn="' + esc(g.nn) + '"') + ' style="--svc:' + esc(g.colour) + '">' + head + (open ? '<div role="group">' + inner + '</div>' : '') + '</div>';
    }).join('');
    if (!model.groups.length && !sections.length) html = '<div class="slb-empty">' + (this._items.length ? (st.q.trim() ? 'Nothing matches “' + esc(st.q.trim()) + '”.' : esc(o.emptyFilterText || 'Nothing in this service.')) : esc(o.loadingText || 'Library is loading…')) + '</div>';
    body.innerHTML = html;
    (this._nodes || []).forEach(function (pair) { var el = body.querySelector('.slb-item[data-id="' + cssEsc(pair[0].split('|')[0]) + '"][data-gkey="' + cssEsc(pair[0].split('|').slice(1).join('|')) + '"]'); if (el) el.insertBefore(pair[1], el.querySelector('.slb-badges')); });
    body.querySelectorAll('.slb-item').forEach(function (el) { el.dataset.key = 'i:' + el.dataset.gkey + '|' + el.dataset.id; });
    var hint = this.querySelector('.slb-hint'); if (hint) { var q = st.q.trim(); hint.textContent = q ? model.shown + ' of ' + model.total + ' match' : ''; hint.hidden = !q; }
    this.querySelectorAll('.slb-chip').forEach(function (b) { b.setAttribute('aria-pressed', String((st.service || '') === (b.dataset.svc || ''))); });
    // roving tabindex: restore focus target or first row
    var target = (focusKey && body.querySelector('[data-key="' + cssEsc(focusKey) + '"]')) || (st.focusKey && body.querySelector('[data-key="' + cssEsc(st.focusKey) + '"]')) || body.querySelector('[role="treeitem"]');
    if (target) { target.tabIndex = 0; if (focusKey) target.focus({ preventScroll: true }); }
  };
  function cssEsc(s) { return (global.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  /** Live counts without a re-mount: re-asks getItemBadges / getGroupBadges / getSubgroupBadges / section summaries and patches only those spans. */
  Bar.prototype.refreshBadges = function () {
    if (!this._built || this._st.rail) return this;
    var self = this, o = this._o, groups = this._groupsAll(), gmap = new Map(); groups.forEach(function (g) { gmap.set(g.key, g); (g.subgroups || []).forEach(function (s) { gmap.set(s.gkey, s); }); });
    this.querySelectorAll('.slb-ghead').forEach(function (h) {
      var g = gmap.get(h.dataset.key); if (!g) return;
      if (g.kind === 'section') { var sm = h.querySelector('.slb-gsum'); if (sm) sm.textContent = g.summary || ''; var c = h.querySelector('.slb-gcount'); if (c) c.textContent = g.count; return; }
      var b = h.querySelector('.slb-gbadges'); if (b && typeof o.getGroupBadges === 'function') { var x = badgesHtml(o.getGroupBadges(g)); if (b.innerHTML !== x) b.innerHTML = x; }
    });
    if (typeof o.getSubgroupBadges === 'function') this.querySelectorAll('.slb-shead').forEach(function (h) { var s = gmap.get(h.dataset.key), g = gmap.get(h.dataset.gkey); if (!s) return; var b = h.querySelector('.slb-sbadges'); var x = badgesHtml(o.getSubgroupBadges(s, g)); if (b.innerHTML !== x) b.innerHTML = x; });
    this.querySelectorAll('.slb-item').forEach(function (el) {
      var it = self._byKey && self._byKey.get(el.dataset.id); var g = gmap.get(el.dataset.gkey); if (!it || !g) return;
      var fn = (g.kind === 'section' && g.def.getItemBadges) || o.getItemBadges; if (typeof fn !== 'function') return;
      var nn = el.dataset.serviceNn; var x = badgesHtml(fn(it, { group: g, section: g.kind === 'section' ? g.def : null, nn: nn, bar: self, esc: esc }));
      var b = el.querySelector(':scope > .slb-badges'); if (b && b.innerHTML !== x) b.innerHTML = x;
    });
    // a section that appeared / emptied changes structure → full body render
    var want = this._sections().map(function (s) { return s.key; }).join(','), have = Array.from(this.querySelectorAll('.slb-section')).map(function (s) { return s.dataset.gkey; }).join(',');
    if (want !== have) this._renderBody();
    return this;
  };

  // ── body events (delegated once per build) ──
  Bar.prototype._focus = function (el) { if (!el) return; this.querySelectorAll('.slb-body [tabindex="0"]').forEach(function (x) { if (x !== el) x.tabIndex = -1; }); el.tabIndex = 0; el.focus(); this._st.focusKey = el.dataset.key; };
  Bar.prototype._toggleKey = function (key) { this._setOpen(key, !this._isOpen(key)); this._st.focusKey = key; this._renderBody(); var h = this.querySelector('.slb-body [data-key="' + cssEsc(key) + '"]'); if (h) this._focus(h); };
  Bar.prototype._itemOf = function (id) { return this._byKey ? this._byKey.get(String(id)) : null; };
  Bar.prototype._pick = function (id, ev, via) {
    var it = this._itemOf(id); if (!it) return; this.setActive(id);
    if (this._o.recent && this._o.recent.auto !== false) { var keep = this._st.focusKey; this.pushRecent(id); this._st.focusKey = keep; }
    if (typeof this._o.onPick === 'function') this._o.onPick(it, ev, via);
    this.dispatchEvent(new CustomEvent('sonor:library-pick', { bubbles: true, detail: { item: it, via: via, event: ev } }));
  };
  Bar.prototype._wireBody = function () {
    var self = this, body = this.querySelector('.slb-body');
    body.addEventListener('click', function (e) {
      var h = e.target.closest('.slb-ghead, .slb-shead'); if (h) { self._toggleKey(h.dataset.key); return; }
      var it = e.target.closest('.slb-item'); if (!it) return; self._focus(it);
      if ((self._o.pickOn || 'click') === 'click') self._pick(it.dataset.id, e, 'click'); else self.setActive(it.dataset.id);
    });
    body.addEventListener('dblclick', function (e) {
      var it = e.target.closest('.slb-item'); if (!it) return; var item = self._itemOf(it.dataset.id);
      if (self._o.pickOn === 'dblclick') self._pick(it.dataset.id, e, 'dblclick');
      if (typeof self._o.onActivate === 'function') self._o.onActivate(item, e);
      self.dispatchEvent(new CustomEvent('sonor:library-activate', { bubbles: true, detail: { item: item, event: e } }));
    });
    body.addEventListener('dragstart', function (e) {
      var it = e.target.closest && e.target.closest('.slb-item'); if (!it) return; var item = self._itemOf(it.dataset.id);
      try { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(self._o.dragType || 'application/sonor-library-item', it.dataset.id); e.dataTransfer.setData('text/plain', opt(self._o, 'getLabel')(item)); } catch (_) {}
      it.dataset.state = 'dragging';
      if (typeof self._o.onDragStart === 'function') self._o.onDragStart(item, e);
      self.dispatchEvent(new CustomEvent('sonor:library-drag', { bubbles: true, detail: { item: item, event: e, mode: 'html5' } }));
    });
    body.addEventListener('dragend', function (e) { var it = e.target.closest && e.target.closest('.slb-item'); if (it) delete it.dataset.state; });
    body.addEventListener('pointerdown', function (e) {
      if (self._o.drag !== 'pointer' || e.button !== 0) return; var it = e.target.closest('.slb-item'); if (!it) return; var item = self._itemOf(it.dataset.id);
      if (typeof self._o.onDragStart === 'function') self._o.onDragStart(item, e);
      self.dispatchEvent(new CustomEvent('sonor:library-drag', { bubbles: true, detail: { item: item, event: e, mode: 'pointer' } }));
    });
    body.addEventListener('keydown', function (e) {
      var cur = e.target.closest('[role="treeitem"]'); if (!cur) return;
      var rows = Array.from(body.querySelectorAll('[role="treeitem"]')), i = rows.indexOf(cur), isHead = !cur.classList.contains('slb-item');
      var parentHead = function (el) { var lvl = +el.getAttribute('aria-level'); for (var j = rows.indexOf(el) - 1; j >= 0; j--) if (+rows[j].getAttribute('aria-level') < lvl) return rows[j]; return null; };
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); self._focus(rows[Math.min(rows.length - 1, i + 1)]); break;
        case 'ArrowUp': e.preventDefault(); if (i === 0) { var s = self.querySelector('.slb-search'); if (s) s.focus(); } else self._focus(rows[i - 1]); break;
        case 'Home': e.preventDefault(); self._focus(rows[0]); break;
        case 'End': e.preventDefault(); self._focus(rows[rows.length - 1]); break;
        case 'ArrowRight': e.preventDefault(); if (isHead) { if (cur.getAttribute('aria-expanded') === 'false') self._toggleKey(cur.dataset.key); else self._focus(rows[i + 1]); } break;
        case 'ArrowLeft': e.preventDefault(); if (isHead && cur.getAttribute('aria-expanded') === 'true') self._toggleKey(cur.dataset.key); else self._focus(parentHead(cur)); break;
        case 'Enter': case ' ': e.preventDefault(); if (isHead) self._toggleKey(cur.dataset.key); else self._pick(cur.dataset.id, e, 'keyboard'); break;
        case '/': e.preventDefault(); self.focusSearch(); break;
        default:
          if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {   // type-ahead on visible rows
            var k = e.key.toLowerCase(); for (var n = 1; n <= rows.length; n++) { var r = rows[(i + n) % rows.length]; if ((r.textContent || '').trim().toLowerCase().indexOf(k) === 0 || ((r.querySelector('.slb-name, .slb-gname, .slb-sname') || {}).textContent || '').toLowerCase().indexOf(k) === 0) { self._focus(r); break; } }
          }
      }
    });
  };

  if (typeof customElements !== 'undefined' && !customElements.get('sonor-library-bar')) customElements.define('sonor-library-bar', Bar);

  /** Mount into a host element (or onto an existing <sonor-library-bar>). Returns the element — it IS the API. */
  function mount(host, opts) {
    if (typeof host === 'string') host = doc.querySelector(host);
    if (!host) throw new Error('SonorLibraryBar.mount: no host');
    var el = host.tagName === 'SONOR-LIBRARY-BAR' ? host : host.querySelector(':scope > sonor-library-bar');
    if (!el) { el = doc.createElement('sonor-library-bar'); host.appendChild(el); }
    el.configure(opts || {});
    return el;
  }

  global.SonorLibraryBar = { VERSION: VERSION, mount: mount, buildModel: buildModel, serviceNN: serviceNN, serviceMeta: serviceMeta, SERVICES: SERVICES, subgroups: subgroups };
})(typeof window !== 'undefined' ? window : globalThis);
