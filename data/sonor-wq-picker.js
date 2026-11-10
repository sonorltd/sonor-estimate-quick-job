/**
 * sonor-wq-picker.js — SHARED WeQuote product picker (workspace root master, synced to every app's data/).
 *
 * v1.0.0 (2026-09-27). Bryn: "WQ product list needs better organising showing categories etc, we have better menus in
 * other apps so this should always be consistent, not a new request every time." ONE popover for every app that picks
 * a WeQuote product (Library ▸ WeQuote links, Takeoffs ▸ Head end / push modal, …):
 *
 *   ⭐ Recommended for this line   — candidates the caller passes (resolved wq_products rows, or catalogue SKUs that
 *                                    resolve on click through the read-only proxy `get_product?sku=&catalogue_id=`)
 *   ▾ grouped by SYSTEM (category)  — Sonor own products, collapsible groups in WeQuote's proposal order, kind badge
 *                                    (Bundle · Product · 1st fix · Counter · Estimate · Service · Info), catalogue badge
 *   🔎 catalogue SKU lookup          — linked catalogues can't be browsed via the API: exact SKU + catalogue → mirror → pick
 *
 *   SonorWqPicker.open({
 *     anchor: HTMLElement,               // popover sits under this
 *     title: 'Product for Dimmer module 8ch',
 *     products: [wq_products rows],      // { id, model, short_description, sku, is_bundle, catalogue_id, catalogue_name, metadata:{category_id, category} }
 *     kinds: ['bundle','product'] | null,// classify() filter (null = all)
 *     recommended: [{ id } | { sku, catalogue_id, label, note }],
 *     search: 'dimmer',                  // initial search text
 *     systemOrder: [category ids],       // group order (default = insertion order of categories seen)
 *     lookupSku: async (sku, catalogueId, catalogueName) => productRow,   // optional (Library provides the mirror-ing one)
 *     catalogues: [[id, name], …],       // optional, default list below
 *     onPick: (productRow) => {},
 *     allowNone: true                    // shows "— none —"
 *   })
 *   SonorWqPicker.classify(p) / KIND_LABEL / KIND_COLOUR / CATALOGUES / close()
 */
(function (global) {
  'use strict';
  var VERSION = '1.0.0';
  var CATALOGUES = [[26, 'Alltrade'], [37, 'Snap One'], [3, 'Lutron'], [1058, 'Lutron RA3'], [408, 'Lutron Alisse'], [395, 'Lutron Palladiom (Square)'], [475, 'Lutron Palladiom (Rectangle)'], [454, 'Cinelux Seating'], [12, 'Invision/Pulse Cinemas'], [63, 'Pulse Cinemas']];
  var KIND_LABEL = { counter: 'Counter', firstfix: '1st fix', estimate: 'Estimate', bundle: 'Bundle', info: 'Info', service: 'Service', product: 'Product' };
  var KIND_COLOUR = { counter: '#4bb9d3', firstfix: '#302f2e', estimate: '#e37c59', bundle: '#8058a1', info: '#b7b1a7', service: '#ad9978', product: '#78ba57' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pname(p) { return (p && (p.model || p.short_description || p.name)) || ''; }
  function pcat(p) { var m = p && p.metadata; return (m && m.category) || p.category || ''; }
  function pcid(p) { var m = p && p.metadata; var v = m && m.category_id != null ? m.category_id : p.category_id; return v != null ? Number(v) : null; }
  function classify(p) {
    var n = pname(p).toLowerCase(), sku = (p.sku || '').toLowerCase();
    if (/^(load count|zone count)/.test(n) || /load count for information/.test(n)) return 'counter';
    if (sku === '1stfix-point' || /^cld-1st/.test(sku) || /^1st fix cabling/.test(n) || /^1st fix - /.test(n)) return 'firstfix';
    if (/estimate/.test(n)) return 'estimate';
    if (p.is_bundle) return 'bundle';
    if (/by (site|others|client)|supplied & installed|tba by|works by|for information/.test(n)) return 'info';
    if (/^(design - |design & |on-site maintenance|installation & (setup|commissioning)|delivery - )/.test(n)) return 'service';
    return 'product';
  }
  var _styled = false;
  function _styles() {
    if (_styled) return; _styled = true;
    var st = document.createElement('style'); st.id = 'sonor-wq-picker-css';
    st.textContent = '.swp{position:fixed;z-index:10000;width:460px;max-height:min(520px,80vh);display:flex;flex-direction:column;background:var(--card,var(--lib-bg,#fff));color:var(--text,inherit);border:1px solid var(--border,var(--lib-border,#CBD5E1));border-radius:8px;box-shadow:0 14px 40px rgba(15,23,42,.22);padding:8px;font-size:12px;font-family:inherit}'
      + '.swp-head{display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:6px}.swp-head b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.swp-x{margin-left:auto;border:none;background:none;font-size:16px;cursor:pointer;color:inherit;opacity:.7}'
      + '.swp-search{width:100%;padding:5px 8px;border:1px solid var(--border,#CBD5E1);border-radius:5px;background:var(--card,#fff);color:inherit;font-size:12px;margin-bottom:6px}'
      + '.swp-list{overflow:auto;flex:1;min-height:0}.swp-g{display:flex;align-items:center;gap:6px;padding:4px 6px;margin-top:4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#64748B);cursor:pointer;border-radius:4px;background:var(--tint,#E2E8F0)}.swp-g .n{margin-left:auto;font-weight:600;opacity:.7}.swp-g.rec{background:#fff3e6;color:#9a4b00}'
      + '.swp-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;cursor:pointer}.swp-row:hover{background:var(--tint,#E2E8F0)}.swp-row.sel{outline:2px solid #6b4a8a}.swp-row small{margin-left:auto;opacity:.65;white-space:nowrap}.swp-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.swp-kind{display:inline-block;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;padding:1px 5px;border-radius:3px;flex-shrink:0}.swp-cat{display:inline-block;font-size:8px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7c3aed;border:1px solid #c4b5fd;padding:0 4px;border-radius:3px;flex-shrink:0}.swp-note{font-size:10px;opacity:.7}'
      + '.swp-look{display:flex;gap:6px;align-items:center;border-top:1px solid var(--border,#CBD5E1);padding-top:6px;margin-top:6px;font-size:11px}.swp-look input,.swp-look select{padding:3px 6px;border:1px solid var(--border,#CBD5E1);border-radius:4px;background:var(--card,#fff);color:inherit;font-size:11px}.swp-look button{padding:3px 8px;border:1px solid #6b4a8a;background:#6b4a8a;color:#fff;border-radius:4px;cursor:pointer;font-size:11px}.swp-msg{font-size:10px;min-height:12px;opacity:.75;margin-top:3px}.swp-none{opacity:.7;font-style:italic}';
    document.head.appendChild(st);
  }
  var _open = null;
  function close() { if (_open) { _open.el.remove(); document.removeEventListener('mousedown', _outside); document.removeEventListener('keydown', _esc); _open = null; } }
  function _outside(e) { if (_open && !_open.el.contains(e.target)) close(); }
  function _esc(e) { if (e.key === 'Escape') close(); }

  function open(opts) {
    opts = opts || {}; close(); _styles();
    var products = (opts.products || []).slice(), kinds = opts.kinds || null, cats = opts.catalogues || CATALOGUES;
    var byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    var el = document.createElement('div'); el.className = 'swp';
    el.innerHTML = '<div class="swp-head"><b>' + esc(opts.title || 'WeQuote product') + '</b>' + (kinds ? '<label style="font-size:10px;margin-left:6px"><input type="checkbox" class="swp-all"> all kinds</label>' : '') + '<button type="button" class="swp-x" title="Close">✕</button></div>'
      + '<input type="search" class="swp-search" placeholder="Search products, SKU, system…">'
      + '<div class="swp-list"></div>'
      + '<div class="swp-look" title="Linked catalogues can’t be browsed through the API — enter the exact SKU and pick the catalogue">🔎 <input type="text" class="swp-sku" placeholder="catalogue SKU" style="width:150px"><select class="swp-cat-sel">' + cats.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('') + '</select><button type="button" class="swp-look-btn">Look up</button></div><div class="swp-msg"></div>';
    document.body.appendChild(el);
    var r = opts.anchor && opts.anchor.getBoundingClientRect ? opts.anchor.getBoundingClientRect() : { bottom: 80, left: 80 };
    el.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 540)) + 'px'; el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 480)) + 'px';
    _open = { el: el };
    var inp = el.querySelector('.swp-search'), list = el.querySelector('.swp-list'), all = el.querySelector('.swp-all'), msg = el.querySelector('.swp-msg');
    inp.value = opts.search || '';
    var collapsed = {};
    var pick = function (p) { try { opts.onPick && opts.onPick(p); } finally { close(); } };
    var rowHtml = function (p, extra) {
      var k = classify(p);
      return '<div class="swp-row' + (opts.selectedId != null && Number(opts.selectedId) === Number(p.id) ? ' sel' : '') + '" data-id="' + p.id + '"><span class="swp-kind" style="background:' + KIND_COLOUR[k] + '">' + KIND_LABEL[k] + '</span><span class="nm">' + esc(pname(p)) + (extra ? ' <span class="swp-note">' + esc(extra) + '</span>' : '') + '</span>' + (p.catalogue_name ? '<span class="swp-cat">' + esc(p.catalogue_name) + '</span>' : '') + '<small>' + esc(p.sku || '') + ' · #' + p.id + '</small></div>';
    };
    var render = function () {
      var q = inp.value.trim().toLowerCase(), useKinds = kinds && !(all && all.checked) ? kinds : null;
      var html = '';
      if (opts.allowNone) html += '<div class="swp-row swp-none" data-id="">— none — (not pushed)</div>';
      // ⭐ recommended
      var rec = (opts.recommended || []).map(function (c) { if (c.id != null && byId[c.id]) return { p: byId[c.id], note: c.note }; return { sku: c.sku, catalogue_id: c.catalogue_id, label: c.label || c.sku, note: c.note }; });
      if (rec.length) {
        html += '<div class="swp-g rec">⭐ Recommended for this line<span class="n">' + rec.length + '</span></div>';
        rec.forEach(function (c) {
          if (c.p) { html += rowHtml(c.p, c.note); return; }
          var cn = (cats.find(function (x) { return Number(x[0]) === Number(c.catalogue_id); }) || [])[1] || ('catalogue ' + c.catalogue_id);
          html += '<div class="swp-row" data-sku="' + esc(c.sku) + '" data-cat="' + esc(c.catalogue_id) + '"><span class="swp-kind" style="background:#e8892b">SKU</span><span class="nm">' + esc(c.label) + (c.note ? ' <span class="swp-note">' + esc(c.note) + '</span>' : '') + '</span><span class="swp-cat">' + esc(cn) + '</span><small>' + esc(c.sku) + ' · look up</small></div>';
        });
      }
      // grouped by system
      var groups = {}, order = [];
      products.forEach(function (p) {
        if (useKinds && useKinds.indexOf(classify(p)) < 0) return;
        if (q && (pname(p) + ' ' + (p.sku || '') + ' ' + pcat(p) + ' ' + p.id + ' ' + (p.catalogue_name || '')).toLowerCase().indexOf(q) < 0) return;
        var cid = pcid(p), key = cid != null ? String(cid) : 'none';
        if (!groups[key]) { groups[key] = { cid: cid, name: pcat(p) || (cid != null ? 'System #' + cid : 'No system'), rows: [] }; order.push(key); }
        groups[key].rows.push(p);
      });
      var so = (opts.systemOrder || []).map(Number);
      order.sort(function (a, b) { var ia = so.indexOf(Number(a)), ib = so.indexOf(Number(b)); ia = ia < 0 ? 900 : ia; ib = ib < 0 ? 900 : ib; return ia - ib || groups[a].name.localeCompare(groups[b].name); });
      var shown = 0;
      order.forEach(function (key) {
        var g = groups[key]; g.rows.sort(function (a, b) { return pname(a).localeCompare(pname(b)); });
        var isCol = q ? false : !!collapsed[key];
        html += '<div class="swp-g" data-g="' + esc(key) + '">' + (isCol ? '▸' : '▾') + ' ' + esc(g.name) + '<span class="n">' + g.rows.length + '</span></div>';
        if (!isCol) g.rows.slice(0, 120).forEach(function (p) { html += rowHtml(p); shown++; });
      });
      if (!order.length && !rec.length) html += '<div style="padding:12px;opacity:.7">No matches' + (kinds && all ? ' — tick "all kinds" or change the search.' : '.') + '</div>';
      list.innerHTML = html;
    };
    list.addEventListener('click', async function (e) {
      var g = e.target.closest('.swp-g:not(.rec)'); if (g) { collapsed[g.dataset.g] = !collapsed[g.dataset.g]; render(); return; }
      var row = e.target.closest('.swp-row'); if (!row) return;
      if (row.classList.contains('swp-none')) { pick(null); return; }
      if (row.dataset.sku) {
        if (typeof opts.lookupSku !== 'function') { msg.textContent = 'No catalogue lookup available here'; return; }
        msg.textContent = 'Looking up ' + row.dataset.sku + '…';
        try { var p = await opts.lookupSku(row.dataset.sku, Number(row.dataset.cat), (cats.find(function (x) { return Number(x[0]) === Number(row.dataset.cat); }) || [])[1]); if (p) pick(p); else msg.textContent = 'Not found — check the SKU in WeQuote › Browse Catalogues'; }
        catch (err) { msg.innerHTML = '<span style="color:#b91c1c">' + esc(err && err.message || err) + '</span>'; }
        return;
      }
      var p2 = byId[row.dataset.id]; if (p2) pick(p2);
    });
    el.querySelector('.swp-look-btn').addEventListener('click', async function () {
      var sku = el.querySelector('.swp-sku').value.trim(), sel = el.querySelector('.swp-cat-sel'); if (!sku) return;
      if (typeof opts.lookupSku !== 'function') { msg.textContent = 'No catalogue lookup available here'; return; }
      msg.textContent = 'Looking up ' + sku + ' in ' + sel.options[sel.selectedIndex].text + '…';
      try { var p = await opts.lookupSku(sku, Number(sel.value), sel.options[sel.selectedIndex].text); if (p) pick(p); else msg.textContent = 'Not found'; }
      catch (err) { msg.innerHTML = '<span style="color:#b91c1c">' + esc(err && err.message || err) + '</span>'; }
    });
    el.querySelector('.swp-sku').addEventListener('keydown', function (e) { if (e.key === 'Enter') el.querySelector('.swp-look-btn').click(); });
    el.querySelector('.swp-x').addEventListener('click', close);
    inp.addEventListener('input', render); if (all) all.addEventListener('change', render);
    render();
    setTimeout(function () { inp.focus(); inp.select(); document.addEventListener('mousedown', _outside); document.addEventListener('keydown', _esc); }, 0);
    return el;
  }
  global.SonorWqPicker = { VERSION: VERSION, open: open, close: close, classify: classify, KIND_LABEL: KIND_LABEL, KIND_COLOUR: KIND_COLOUR, CATALOGUES: CATALOGUES, pname: pname };
})(typeof window !== 'undefined' ? window : globalThis);
