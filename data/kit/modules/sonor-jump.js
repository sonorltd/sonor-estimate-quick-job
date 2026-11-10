/* ═══════════════════════════════════════════════════════════════════════
   SonorJump \u2014 "this project in\u2026" \u2014 every app links to every other app (v1.0.0, kit 0.11.0, 2026-10-31)
   Bryn: "keep going to everything links to everything else. everything wired"

   Loaded on EVERY page by the apps.sonor.co.uk gateway (v1.9.0+) \u2014 apps add nothing. Idempotent.
   A \u21c4 button (inside the shared project bar when the page has one, else beside the who-am-I pill) opens a panel listing
   every project app the signed-in person can open \u2014 grouped by section colour, site views included \u2014 each opening on the
   SAME project (?pid=<projects.id>, the universal project-bar deep link). Levels come from ONE rpc sonor_access_levels.
   The current app is marked; apps at level None are left out; read-only levels show "view".
   Optional: an element with [data-sonor-jump] gets the button instead.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  if (global.SonorJump && global.SonorJump.VERSION) return;
  var VERSION = '1.0.0';
  var U = global.__SONOR_USER__ || null;
  var SBC = global.__SONOR_SB__ || {};
  var SB = SBC.url || 'https://ysmvklstkzodlocttspy.supabase.co';
  var ANON = SBC.anon || '';
  var HERE = (U && U.app) || '';
  var G = { management: ['Project Management', '#e67eb1'], projects: ['Projects & Engineering', '#2d718b'], cinema: ['Cinema', '#8058a1'], aesthetics: ['Aesthetics', '#ad9978'] };
  // key (access level) · name · path on apps.sonor.co.uk · group · extra query
  var APPS = [
    ['pm', 'Project Master', '/sonor-project-master/sonor-project-master.html', 'management'],
    ['pm', 'Project brief', '/sonor-project-master/brief.html', 'management'],
    ['tasks', 'Tasks', '/sonor-tasks/sonor-tasks.html', 'management'],
    ['portal', 'Portal', '/sonor-portal/dashboard/sonor-portal.html', 'management'],
    ['service-contracts', 'Service Contracts', '/sonor-service-contracts/dashboard/sonor-service-contracts.html', 'management'],
    ['takeover', 'Takeover', '/sonor-takeover/dashboard/sonor-takeover.html', 'management'],
    ['rams', 'RAMS', '/sonor-rams/', 'management'],
    ['survey', 'Survey', '/sonor-survey/dashboard/sonor-survey.html', 'projects'],
    ['takeoffs', 'Takeoffs', '/sonor-takeoffs/sonor-takeoffs.html', 'projects'],
    ['takeoffs', 'Takeoffs \u00b7 site view', '/sonor-takeoffs/site.html', 'projects', 'view=site'],
    ['engineering', 'Engineering', '/sonor-engineering/', 'projects'],
    ['engineering', 'Engineering \u00b7 site view', '/sonor-engineering/', 'projects', 'view=site'],
    ['netmap', 'Network Map', '/sonor-network-map/', 'projects'],
    ['tender', 'Tender', '/sonor-tender/sonor-tender.html', 'projects'],
    ['led-calc', 'LED Calc', '/sonor-led-calc/dashboard/sonor-led-calc.html', 'projects'],
    ['master', 'Plans (PDFs)', '/sonor-master/plans.html', 'projects'],
    ['cinema', 'Cinema Design', '/sonor-cinema/dashboard/sonor-cinema.html', 'cinema'],
    ['cinema-tools', 'Cinema Tools', '/sonor-cinema-tools/dashboard/sonor-cinema-tools.html', 'cinema'],
    ['seating', 'Seating', '/sonor-seating/dashboard/sonor-seating.html', 'cinema'],
    ['cinema-aesthetic', 'Cinema Aesthetic', '/sonor-cinema-aesthetic/dashboard/sonor-cinema-aesthetic.html', 'aesthetics'],
    ['lighting-design', 'Lighting Design', '/sonor-lighting-design/dashboard/sonor-lighting-design.html', 'aesthetics'],
    ['garden-lighting', 'Garden Lighting', '/sonor-garden-lighting/dashboard/sonor-garden-lighting.html', 'aesthetics'],
    ['stretched-fabric', 'Stretched Fabric', '/sonor-stretched-fabric/dashboard/sonor-stretched-fabric.html', 'aesthetics']
  ];
  var LV = null, open = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pid() {
    if (global.SonorWho && SonorWho.projectId) return SonorWho.projectId();
    try { if (global.SonorProjectBar && SonorProjectBar.getActiveId) { var a = SonorProjectBar.getActiveId(); if (a) return a; } } catch (e) {}
    var q = new URLSearchParams(location.search).get('pid'); return /^[0-9a-f-]{36}$/i.test(q || '') ? q : null;
  }
  function levels() {
    if (LV) return Promise.resolve(LV);
    var keys = {}; APPS.forEach(function (a) { keys[a[0]] = a[3]; });
    var body = { p_email: U.email, p_apps: Object.keys(keys).map(function (k) { return { key: k, group: keys[k] }; }) };
    return global.fetch(SB + '/rest/v1/rpc/sonor_access_levels', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) { LV = j || {}; return LV; });
  }
  function hrefFor(a, p) { var q = new URLSearchParams(); if (a[4]) a[4].split('&').forEach(function (kv) { var x = kv.split('='); q.set(x[0], x[1]); }); q.set('pid', p); return a[2] + '?' + q.toString(); }
  function isHere(a) { return a[0] === HERE && (!a[4] || location.search.indexOf(a[4]) >= 0) && location.pathname.indexOf(a[2].replace(/[^/]*$/, '')) === 0 && (a[4] ? true : location.pathname.indexOf('site.html') < 0 && location.search.indexOf('view=site') < 0); }

  function panel() {
    var el = document.getElementById('sonor-jump-panel');
    if (!el) { el = document.createElement('div'); el.id = 'sonor-jump-panel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'This project in other apps'); document.body.appendChild(el); }
    return el;
  }
  function render() {
    var p = pid(), el = panel();
    if (!p) { el.innerHTML = '<div class="sj-h">This project in\u2026</div><div class="sj-empty">Pick a project first \u2014 then every app opens on it.</div>'; return; }
    levels().then(function (lv) {
      var html = '<div class="sj-h">This project in\u2026</div>', last = '';
      APPS.forEach(function (a) {
        var l = lv[a[0]] || (a[0] === 'master' ? 'view' : 'none'); if (l === 'none') return;
        if (a[3] !== last) { last = a[3]; html += '<div class="sj-g" style="--c:' + G[a[3]][1] + '">' + esc(G[a[3]][0]) + '</div>'; }
        var here = isHere(a);
        html += '<a class="sj-a' + (here ? ' sj-here' : '') + '" style="--c:' + G[a[3]][1] + '" href="' + esc(hrefFor(a, p)) + '"' + (here ? ' aria-current="page"' : '') + '>' +
          '<span class="sj-dot"></span>' + esc(a[1]) + (here ? '<i>here</i>' : l === 'view' ? '<i>view</i>' : '') + '</a>';
      });
      el.innerHTML = html;
    });
  }
  function toggle(force) {
    open = force != null ? force : !open; var el = panel();
    el.classList.toggle('sj-open', open); if (open) { render(); place(); }
    var b = document.getElementById('sonor-jump-btn'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function place() {
    var b = document.getElementById('sonor-jump-btn'), el = panel(); if (!b) return;
    var r = b.getBoundingClientRect(), w = 260;
    var left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
    if (r.top > innerHeight / 2) { el.style.top = ''; el.style.bottom = (innerHeight - r.top + 6) + 'px'; } else { el.style.bottom = ''; el.style.top = (r.bottom + 6) + 'px'; }
    el.style.left = left + 'px';
  }
  function button() {
    var b = document.getElementById('sonor-jump-btn');
    if (!b) {
      b = document.createElement('button'); b.id = 'sonor-jump-btn'; b.type = 'button'; b.title = 'Open this project in another app';
      b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = '<span aria-hidden="true">\u21c4</span> Apps';
      b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    }
    var host = document.querySelector('[data-sonor-jump]') || document.querySelector('#sonorProjectBarHost .meta, #sonorProjectBarHost .spb-meta, #sonorProjectBarHost');
    if (host) { if (b.parentNode !== host) { host.appendChild(b); } b.classList.add('sj-inbar'); b.classList.remove('sj-float'); }
    else { if (b.parentNode !== document.body) document.body.appendChild(b); b.classList.add('sj-float'); b.classList.remove('sj-inbar'); }
  }

  var css = '#sonor-jump-btn{font:600 11px/1 "DM Sans",system-ui,sans-serif;color:#C7C7CC;background:#2C2C2E;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}' +
    '#sonor-jump-btn:hover,#sonor-jump-btn[aria-expanded=true]{color:#F5F5F7;border-color:rgba(173,153,120,.6)}#sonor-jump-btn span{color:#ad9978;font-size:13px}' +
    '#sonor-jump-btn.sj-inbar{margin-left:8px}#sonor-jump-btn.sj-float{position:fixed;left:12px;bottom:12px;z-index:2147482998;box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:.8}' +
    '#sonor-jump-panel{position:fixed;z-index:2147483001;width:260px;max-height:min(70vh,560px);overflow:auto;display:none;background:#1C1C1E;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:8px;box-shadow:0 18px 40px rgba(0,0,0,.5);font:500 13px/1.3 "DM Sans",system-ui,sans-serif;color:#F5F5F7}' +
    '#sonor-jump-panel.sj-open{display:block}#sonor-jump-panel .sj-h{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#98989D;padding:4px 8px 6px}' +
    '#sonor-jump-panel .sj-g{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--c);padding:8px 8px 3px}' +
    '#sonor-jump-panel .sj-a{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;color:#F5F5F7;text-decoration:none}#sonor-jump-panel .sj-a:hover,#sonor-jump-panel .sj-a:focus{background:rgba(255,255,255,.06);outline:none}' +
    '#sonor-jump-panel .sj-dot{width:8px;height:8px;border-radius:50%;background:var(--c);flex:0 0 auto}#sonor-jump-panel .sj-a i{margin-left:auto;font-style:normal;font-size:10px;color:#98989D}' +
    '#sonor-jump-panel .sj-here{background:rgba(255,255,255,.04)}#sonor-jump-panel .sj-empty{padding:8px;color:#98989D;font-size:12px}' +
    '@media print{#sonor-jump-btn,#sonor-jump-panel{display:none!important}}';

  function start() {
    if (!U || !U.ok) return;
    var st = document.createElement('style'); st.id = 'sonor-jump-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st);
    button();
    var mo = new MutationObserver(function () { clearTimeout(mo.t); mo.t = setTimeout(function () { var b = document.getElementById('sonor-jump-btn'); if (!b || !b.isConnected || (b.classList.contains('sj-float') && document.querySelector('[data-sonor-jump], #sonorProjectBarHost'))) button(); }, 120); });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', function (e) { if (open && !e.target.closest('#sonor-jump-panel')) toggle(false); });
    document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') toggle(false); });
    addEventListener('resize', function () { if (open) place(); });
    document.addEventListener('sonor:project-changed', function () { if (open) render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  global.SonorJump = { VERSION: VERSION, open: function () { toggle(true); }, close: function () { toggle(false); }, apps: APPS };
})(window);
