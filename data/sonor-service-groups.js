/* ═══════════════════════════════════════════════════════════════════════
   SonorServiceGroups — anything grouped by service, in SERVICE ORDER, collapsible (v1.0.0, 2026-11-05)
   ROOT MASTER: ~/Code/Sonor/data/sonor-service-groups.js — apps carry byte-identical copies in data/ (sync-everything.sh).
   Bryn 2026-11-05: "services should be collapseable … always make everything service order wherever displayed like that".

   Order + names + colours come from __SONOR_BRAND__.services (data/sonor-brand.js, brand-core; Supabase brand_config service_NN_*) —
   never a local list. Items without a service sink to the end (stable). Collapse state is per viewer
   (localStorage, best-effort) keyed by the host's `key`.

   Usage:
     SonorServiceGroups.sort(items, getNn)                  → new array in service order (stable)
     SonorServiceGroups.group(items, getNn)                 → [{ nn:'02', svc:{…brand service}, items:[…] }] in service order
     SonorServiceGroups.render(host, items, {
        key: 'portal-warranty',          // remembers which groups are collapsed
        getNn: function (it) { return it.service_nn; },
        row:   function (it, g) { return '<div>…</div>'; },   // HTML for one item
        tier:  'client',                 // which SonorBrand name to show: client | brand | core | badge
        count: function (g) { return g.items.length + ' items'; },   // optional right-hand summary
        aside: function (g) { return ''; },                           // optional extra HTML in the header (e.g. a mini bar)
        collapsed: false,                // default state for a group never touched
        toolbar: true                    // "Expand all / Collapse all"
     });
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var VERSION = '1.1.0';   // 1.1.0 (2026-11-10): the app-extra services 11 Electrical / 12 Construction (Takeoffs' extras, same colours) get their names and colours instead of 'Other'
  var EXTRA = { '11': { nn: '11', client: 'Electrical', brand: 'Electrical', core: '11 Electrical', badge: 'Electrical', hex: '#e63946' }, '12': { nn: '12', client: 'Construction', brand: 'Construction', core: '12 Construction', badge: 'Construction', hex: '#8d6e4b' } };
  function services() { var B = global.__SONOR_BRAND__ || global.SonorBrand || {}; return B.services || []; }
  function nnOf(v) {
    if (v == null || v === '') return null;
    var m = String(v).match(/\d{1,2}/); if (!m) return null;
    var n = parseInt(m[0], 10); return n >= 1 && n <= 99 ? (n < 10 ? '0' : '') + n : null;
  }
  function rank(nn) { var L = services(); for (var i = 0; i < L.length; i++) if (L[i].nn === nn) return i; return EXTRA[nn] ? 100 + Number(nn) : nn ? 900 + Number(nn) : 9999; }
  function svc(nn) { var L = services(); for (var i = 0; i < L.length; i++) if (L[i].nn === nn) return L[i]; return EXTRA[nn] || null; }
  function getter(g) { return typeof g === 'function' ? g : function (it) { return it && (it.service_nn != null ? it.service_nn : it.nn != null ? it.nn : it.service); }; }
  function sort(items, getNn) {
    var g = getter(getNn);
    return (items || []).map(function (x, i) { return { x: x, i: i, r: rank(nnOf(g(x))) }; })
      .sort(function (a, b) { return (a.r - b.r) || (a.i - b.i); }).map(function (o) { return o.x; });
  }
  function group(items, getNn) {
    var g = getter(getNn), map = {}, out = [];
    sort(items, g).forEach(function (it) {
      var nn = nnOf(g(it)) || '';
      if (!map[nn]) { map[nn] = { nn: nn, svc: svc(nn), items: [] }; out.push(map[nn]); }
      map[nn].items.push(it);
    });
    return out;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stKey(key, nn) { return 'ssg:' + key + ':' + (nn || 'none'); }
  function getState(key, nn, dflt) { try { var v = localStorage.getItem(stKey(key, nn)); return v == null ? dflt : v === '1'; } catch (e) { return dflt; } }
  function setState(key, nn, v) { try { localStorage.setItem(stKey(key, nn), v ? '1' : '0'); } catch (e) {} }

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('sonor-ssg-css')) return;
    var css =
      '.ssg-bar{display:flex;justify-content:flex-end;gap:8px;margin:0 0 8px}' +
      '.ssg-bar button{background:none;border:0;color:inherit;opacity:.6;font:inherit;font-size:12px;cursor:pointer;padding:2px 4px}.ssg-bar button:hover{opacity:1}' +
      '.ssg{--c:#8f8574;border-radius:12px;margin:0 0 10px;border:1px solid rgba(140,130,115,.18);background:rgba(140,130,115,.04);overflow:hidden;transition:border-color .2s,box-shadow .2s}' +
      '.ssg:hover{border-color:color-mix(in srgb,var(--c) 45%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--c) 18%,transparent),0 6px 22px -12px var(--c)}' +
      '.ssg-h{all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;font-weight:600;letter-spacing:.01em}' +
      '.ssg-h:focus-visible{outline:2px solid var(--c);outline-offset:-2px}' +
      '.ssg-dot{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c);flex:none}' +
      '.ssg-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.ssg-count{font-weight:400;font-size:12px;opacity:.65;white-space:nowrap}' +
      '.ssg-aside{min-width:0;flex:0 1 160px}' +
      '.ssg-chev{width:9px;height:9px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;opacity:.55;transform:rotate(45deg) translate(-2px,-2px);transition:transform .25s cubic-bezier(.2,.8,.2,1);flex:none}' +
      '.ssg.closed .ssg-chev{transform:rotate(-45deg)}' +
      '.ssg-b{display:grid;grid-template-rows:1fr;transition:grid-template-rows .3s cubic-bezier(.2,.8,.2,1)}' +
      '.ssg.closed .ssg-b{grid-template-rows:0fr}' +
      '.ssg-in{overflow:hidden;min-height:0}.ssg-pad{padding:0 14px 12px}' +
      '@media (max-width:560px){.ssg-aside{display:none}}' +
      '@media (prefers-reduced-motion:reduce){.ssg-b,.ssg-chev{transition:none}}';
    var el = document.createElement('style'); el.id = 'sonor-ssg-css'; el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  function render(host, items, o) {
    if (typeof host === 'string') host = document.getElementById(host);
    if (!host) return [];
    o = o || {}; injectCss();
    var key = o.key || host.id || 'default', tier = o.tier || 'client';
    var groups = group(items, o.getNn);
    var html = (o.toolbar && groups.length > 1 ? '<div class="ssg-bar"><button type="button" data-ssg-all="open">Expand all</button><button type="button" data-ssg-all="close">Collapse all</button></div>' : '') +
      groups.map(function (g) {
        var s = g.svc, name = s ? (s[tier] || s.client || s.brand) : (o.otherLabel || 'Other');
        var closed = getState(key, g.nn, !!o.collapsed);
        return '<section class="ssg' + (closed ? ' closed' : '') + '" data-nn="' + g.nn + '" style="--c:' + (s ? s.hex : '#8f8574') + '">' +
          '<button type="button" class="ssg-h" aria-expanded="' + (!closed) + '"><span class="ssg-dot"></span><span class="ssg-name">' + esc(name) + '</span>' +
          (o.aside ? '<span class="ssg-aside">' + (o.aside(g) || '') + '</span>' : '') +
          '<span class="ssg-count">' + esc(o.count ? o.count(g) : g.items.length) + '</span><span class="ssg-chev"></span></button>' +
          '<div class="ssg-b"><div class="ssg-in"><div class="ssg-pad">' + g.items.map(function (it) { return o.row ? o.row(it, g) : esc(String(it)); }).join('') + '</div></div></div></section>';
      }).join('');
    host.innerHTML = html;
    if (!host.__ssg) {
      host.__ssg = true;
      host.addEventListener('click', function (e) {
        var all = e.target.closest('[data-ssg-all]');
        if (all) {
          var open = all.getAttribute('data-ssg-all') === 'open';
          host.querySelectorAll('.ssg').forEach(function (sec) { sec.classList.toggle('closed', !open); sec.querySelector('.ssg-h').setAttribute('aria-expanded', String(open)); setState(host.__ssgKey, sec.getAttribute('data-nn'), !open); });
          return;
        }
        var h = e.target.closest('.ssg-h'); if (!h || !host.contains(h)) return;
        var sec = h.parentNode, closed = sec.classList.toggle('closed');
        h.setAttribute('aria-expanded', String(!closed)); setState(host.__ssgKey, sec.getAttribute('data-nn'), closed);
      });
    }
    host.__ssgKey = key;
    return groups;
  }

  global.SonorServiceGroups = { VERSION: VERSION, sort: sort, group: group, render: render, rank: function (v) { return rank(nnOf(v)); }, service: function (v) { return svc(nnOf(v)); }, injectCss: injectCss };
})(typeof window !== 'undefined' ? window : globalThis);
