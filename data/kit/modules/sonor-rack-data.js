/**
 * sonor-rack-data.js — racks & patchbays SSOT contract + the read-only <sonor-rack-view> element (sonor-kit, B-504, 2026-09-30).
 * Contract: docs/RACKS-SSOT.md. Engineering is the only editor; PM, Packs, Takeoffs, PDFs render through this.
 *
 *   SonorRackData.load(client, projectId)   → { state, racks, nodes, patchPanels, revision, updatedAt } | null
 *   SonorRackData.toGridItems(rack, nodes, side)  → items for <sonor-slot-grid>
 *   SonorRackData.deviceOf(item, nodes)     → the node (device) a rack item points at, or null for accessories
 *   SonorRackData.editUrl(projectId)        → Engineering deep link (?pid=)
 *
 *   <sonor-rack-view project-id="uuid" [rack-id] [sides="front,rear"] [numbers] [patch] [width="300"]></sonor-rack-view>
 *     resolves a Supabase client like SonorSortable (or set SonorRackData._client), loads the newest eng_state, and
 *     renders every rack: title + cabinet, front/rear elevations (readonly slot-grid), the numbers rail (SonorRackCalc),
 *     patch panels (when [patch]) and an "Edit in Engineering ↗" link. Empty state when the project has no engineered
 *     rack yet. Emits 'sonor:rack-view-loaded' { racks } and 'sonor:rack-view-empty'.
 */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = global.document;
  var SERVICE_COLOURS = { cinema: '#8058a1', audio: '#4bb9d3', video: '#78ba57', lighting: '#f5d05c', automation: '#e37c59', climate: '#ec6061', control: '#e67eb1', security: '#ad9978', network: '#b7b1a7', structure: '#302f2e' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function findClient() {
    var c = [global.SonorRackData && global.SonorRackData._client, global.SonorDB && (global.SonorDB.current && global.SonorDB.current.client || global.SonorDB.client), global.sonorDb && global.sonorDb.client, global.db && global.db.client, global._supaDb && global._supaDb.client, global.supabaseClient, global.S && global.S.db && global.S.db.client, global.SonorLibrary && global.SonorLibrary.client && global.SonorLibrary.client()];
    for (var i = 0; i < c.length; i++) if (c[i] && typeof c[i].from === 'function') return c[i];
    try { if (global.supabase && global.supabase.createClient && typeof SONOR_SUPABASE_URL !== 'undefined') { var made = global.supabase.createClient(SONOR_SUPABASE_URL, SONOR_SUPABASE_ANON); (global.SonorRackData || {})._client = made; return made; } } catch (_) {}
    return null;
  }
  function editUrl(projectId) {
    var B = global.__SONOR_BRAND__ || {}; var local = /^(file:|http:\/\/localhost)/.test(location.href);
    var base = (B.appUrls && B.appUrls[local ? 'local' : 'hosted'] && B.appUrls[local ? 'local' : 'hosted'].engineering) || 'https://apps.sonor.co.uk/sonor-engineering/';
    if (local && /^\.\.\//.test(base) && /\/dashboard\//.test(location.pathname)) base = '../' + base;   // dashboard/ pages sit one level deeper than appUrls.local assumes
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'pid=' + encodeURIComponent(projectId || '');
  }
  async function load(client, projectId) {
    client = client || findClient(); if (!client || !projectId) return null;
    var r = await client.from('easyschematic_diagrams').select('id,title,eng_state,eng_revision,eng_updated_at').eq('project_id', projectId).not('eng_state', 'is', null).order('eng_updated_at', { ascending: false }).limit(1).maybeSingle();
    if (r.error) throw r.error; if (!r.data || !r.data.eng_state) return null;
    var st = r.data.eng_state;
    return { id: r.data.id, title: r.data.title, state: st, racks: Array.isArray(st.racks) ? st.racks : [], nodes: Array.isArray(st.nodes) ? st.nodes : [], patchPanels: Array.isArray(st.patchPanels) ? st.patchPanels : [], revision: r.data.eng_revision, updatedAt: r.data.eng_updated_at };
  }
  function deviceOf(it, nodes) { if (!it || it.accessory || it.accessoryId) return null; return (nodes || []).find(function (n) { return n.id === it.deviceId; }) || null; }
  function toGridItems(rack, nodes, side) {
    return (rack.items || []).filter(function (it) { return (it.side || 'front') === side && !it.vertical; }).map(function (it) {
      var dev = deviceOf(it, nodes); var d = dev && dev.data || {};
      var acc = !dev; var label = acc ? (it.label || 'Accessory') : (d.label || it.deviceId);
      var plate = acc && /sonor/i.test(label) && /plate|blank|panel/i.test(label);
      return { id: acc ? (it.accessoryId || 'acc-' + it.slotU) : it.deviceId, start: it.slotU || 0, size: it.heightU || 1, row: 0, kind: acc ? 'accessory' : 'device', label: label, sub: [it.manufacturer || d.manufacturer, it.modelNumber || d.modelNumber].filter(Boolean).join(' · '), colour: plate ? '#090807' : (acc ? '#475569' : (SERVICE_COLOURS[d.service] || '#334155')), locked: true, plate: plate };
    });
  }
  function specs(rack, nodes) {
    var C = global.SonorRackCalc; if (!C) return null;
    return (rack.items || []).map(function (it) {
      var dev = deviceOf(it, nodes);
      if (!dev) return { id: it.accessoryId || it.label, label: it.label || 'Accessory', u: it.heightU || 1, watts: 0, kg: 0, depth: 0, accessory: true, side: it.side, start: it.slotU, vertical: !!it.vertical };
      var s = C.specFromLibrary(Object.assign({}, dev.data, { id: dev.id, label: dev.data && dev.data.label, subName: dev.data && (dev.data.subName || dev.data.category), libMetadata: dev.data && (dev.data.libMetadata || (dev.data.raw && dev.data.raw.metadata)) }));
      return Object.assign(s, { id: dev.id, u: it.heightU || s.u || 1, side: it.side, start: it.slotU, vertical: !!it.vertical, onUps: dev.data && dev.data.onUps });
    });
  }
  function numbersHtml(rack, nodes) {
    var C = global.SonorRackCalc; if (!C) return '';
    var r = C.compute(specs(rack, nodes), { rack: { heightU: rack.heightU, depthMm: rack.depthMm || null, wallMount: /wall/i.test(rack.name || '') || (rack.heightU || 42) <= 15 }, poeLoads: [] });
    var tile = function (l, v, u, sub) { return '<div class="rv-tile"><div class="rv-l">' + l + '</div><div class="rv-v">' + v + '<small>' + (u || '') + '</small></div>' + (sub ? '<div class="rv-s">' + esc(sub) + '</div>' : '') + '</div>'; };
    return '<div class="rv-rail">' + tile('Space', r.space.usedU + '/' + r.space.heightU, 'U', 'front ' + r.space.frontU + ' · rear ' + r.space.rearU) + tile('Power', r.power.totalW, 'W', r.power.amps + ' A · ' + r.power.breakerA + ' A MCB') + tile('Heat', Number(r.heat.btuHr).toLocaleString('en-GB'), 'BTU/h', r.heat.ventilation) + tile('Weight', r.weight.totalKg, 'kg', r.weight.devicesKg + ' kg kit') + tile('Depth', r.depth.deepestMm || '—', r.depth.deepestMm ? 'mm' : '', r.depth.deepest || '') + tile('Outlets', r.outlets.wanted + '/' + r.outlets.supplied, '', r.outlets.supplied ? Math.max(0, r.outlets.spare) + ' spare' : 'no PDU') + tile('UPS', r.ups.runtimeMin != null ? r.ups.runtimeMin : (r.ups.units.length ? '—' : r.ups.recommendVa), r.ups.runtimeMin != null ? 'min' : (r.ups.units.length ? '' : 'VA'), r.ups.units.length ? r.ups.protectedW + ' W protected' : (r.ups.protectedW ? 'recommended' : '')) + '</div>' +
      (r.warnings.length ? '<ul class="rv-warn">' + r.warnings.slice(0, 5).map(function (w) { return '<li data-level="' + w.level + '">' + esc(w.text) + '</li>'; }).join('') + '</ul>' : '');
  }
  function patchHtml(panels, rackId) {
    var ps = (panels || []).filter(function (p) { return !rackId || p.rackId === rackId; }); if (!ps.length) return '';
    return ps.map(function (p) {
      var rows = (p.assignments || []).slice().sort(function (a, b) { return (a.port || 0) - (b.port || 0); });
      return '<div class="rv-patch"><h5>' + esc(p.name || 'Patch panel') + ' <span class="rv-n">' + (rows.filter(function (a) { return a.label; }).length) + '/' + (p.ports || rows.length) + '</span></h5><div class="rv-ports">' + Array.from({ length: p.ports || rows.length }, function (_, i) { var a = rows.find(function (x) { return x.port === i + 1; }) || {}; return '<div class="rv-port' + (a.label ? ' on' : '') + '" title="' + esc((a.label || '') + (a.cable ? ' · ' + a.cable : '')) + '"><b>' + (i + 1) + '</b><span>' + esc(a.label || '') + '</span></div>'; }).join('') + '</div></div>';
    }).join('');
  }

  var Base = typeof HTMLElement !== 'undefined' ? HTMLElement : function () {};
  function View() { return Reflect.construct(Base, [], View); }
  View.prototype = Object.create(Base.prototype); View.prototype.constructor = View;
  Object.defineProperty(View, 'observedAttributes', { get: function () { return ['project-id', 'rack-id', 'sides', 'width']; } });
  View.prototype.connectedCallback = function () {
    this.classList.add('s-rack-view'); this._load();
    // no project-id attribute → follow the shared project bar (and reload when it changes)
    if (!this.getAttribute('project-id')) { var self = this; this._onProj = function () { self._load(); }; doc.addEventListener('sonor:project-changed', this._onProj); }
  };
  View.prototype.disconnectedCallback = function () { if (this._onProj) doc.removeEventListener('sonor:project-changed', this._onProj); };
  View.prototype.attributeChangedCallback = function () { if (this.isConnected) this._load(); };
  View.prototype.reload = function () { return this._load(true); };
  View.prototype._load = async function () {
    var self = this, pid = this.getAttribute('project-id') || (global.SonorProjectBar && global.SonorProjectBar.getActiveId && global.SonorProjectBar.getActiveId()) || null;
    if (!pid) { this.innerHTML = '<div class="rv-empty">No project selected.</div>'; return; }
    this.innerHTML = '<div class="rv-empty s-skeleton" style="height:120px"></div>';
    var data = null;
    try { data = await load(null, pid); } catch (e) { this.innerHTML = '<div class="rv-empty">Could not load the engineered racks: ' + esc(e.message || e) + '</div>'; return; }
    var rackId = this.getAttribute('rack-id'); var racks = data ? data.racks.filter(function (r) { return !rackId || r.id === rackId; }) : [];
    if (!racks.length) {
      this.innerHTML = '<div class="rv-empty"><b>No engineered rack for this project yet.</b><br>Racks and patchbays are built in Engineering — the one place they are edited.<br><a class="rv-edit s-btn-mini" href="' + esc(editUrl(pid)) + '" target="_blank" rel="noopener">Open in Engineering ↗</a></div>';
      this.dispatchEvent(new CustomEvent('sonor:rack-view-empty', { detail: { projectId: pid } })); return;
    }
    var sides = (this.getAttribute('sides') || 'front,rear').split(',').map(function (s) { return s.trim(); }); var width = this.getAttribute('width') || '300';
    this.innerHTML = '<div class="rv-head"><span class="rv-meta">Engineered in Engineering · rev ' + esc(data.revision || '—') + (data.updatedAt ? ' · ' + new Date(data.updatedAt).toLocaleDateString('en-GB') : '') + '</span><a class="rv-edit s-btn-mini" href="' + esc(editUrl(pid)) + '" target="_blank" rel="noopener">Edit in Engineering ↗</a></div>' +
      racks.map(function (rack) {
        return '<section class="rv-rack" data-rack="' + esc(rack.id) + '"><h4>' + esc(rack.name || 'Rack') + ' <span class="rv-n">' + (rack.heightU || 42) + 'U' + (rack.cabinetName ? ' · ' + esc(rack.cabinetName) : '') + (rack.location ? ' · ' + esc(rack.location) : '') + '</span></h4>' +
          (self.hasAttribute('numbers') ? numbersHtml(rack, data.nodes) : '') +
          '<div class="rv-sides">' + sides.map(function (side) { return '<div class="rv-side"><div class="rv-side-h">' + side.toUpperCase() + '</div><sonor-slot-grid readonly orientation="vertical" rows="1" size="' + (rack.heightU || 42) + '" unit="22" width="' + esc(width) + '" label-origin="1" data-side="' + side + '"></sonor-slot-grid></div>'; }).join('') + '</div>' +
          (self.hasAttribute('patch') ? patchHtml(data.patchPanels, rack.id) : '') + '</section>';
      }).join('');
    racks.forEach(function (rack) { var sec = self.querySelector('[data-rack="' + rack.id + '"]'); if (!sec) return; sec.querySelectorAll('sonor-slot-grid').forEach(function (g) { g.items = toGridItems(rack, data.nodes, g.dataset.side); }); });
    this.dispatchEvent(new CustomEvent('sonor:rack-view-loaded', { detail: { projectId: pid, racks: racks, revision: data.revision } }));
  };
  if (typeof customElements !== 'undefined' && !customElements.get('sonor-rack-view')) customElements.define('sonor-rack-view', View);
  global.SonorRackData = { VERSION: VERSION, load: load, toGridItems: toGridItems, deviceOf: deviceOf, editUrl: editUrl, client: findClient, _client: null };
})(typeof window !== 'undefined' ? window : globalThis);
