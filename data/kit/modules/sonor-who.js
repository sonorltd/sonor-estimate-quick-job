/* ═══════════════════════════════════════════════════════════════════════
   SonorWho \u2014 who edited what, on every item, in every app (v1.0.0, kit 0.10.0, Hub 3.50.0, 2026-10-31)
   Bryn: "similar to how fieldwire \u2026 whoever edits has a bubble initials by it" \u00b7 "no manual entries, all is linked to users"

   Loaded on EVERY page by the apps.sonor.co.uk gateway (v1.8.0+) \u2014 no app needs a <script> tag. Idempotent.
   Data: Supabase audit_log (stamped server-side from the signed-in login) via RPCs sonor_people / sonor_last_editors /
   sonor_audit_since / sonor_project_editors / sonor_here (presence). Calls go through the gateway's fetch wrapper, so they
   carry the person's own session.

   DECLARATIVE (apps only add attributes \u2014 the module does the rest, live):
     data-sonor-row="table:pk"        \u2192 initials bubble of the LAST person to edit that row (tooltip: name \u00b7 when \u00b7 what changed).
                                         Goes inside a [data-sonor-who-slot] child if there is one, else at the end of the element.
     data-sonor-person="email|name"   \u2192 that person's bubble (+ name with data-sonor-person-mode="both", name only with "name").
     <select data-sonor-people>       \u2192 filled with the Sonor users (value = email). A stored value that is not a user stays,
                                         marked "(not a user)". data-sonor-people="staff" limits to staff; "+none" adds "\u2014 Unassigned".
   JS:
     SonorWho.ready \u2192 Promise \u00b7 people() \u00b7 person(v) \u00b7 label(v) \u00b7 initials(v) \u00b7 bubble(v, {size, title}) \u2192 <span>
     fillSelect(sel, {value, kinds, none}) \u00b7 lastEditor(table, pk) \u00b7 watch() \u2192 re-scan now
     events on document: 'sonor:who-change' {rows:[{table_name,row_pk,who,at,app,project_id}]} \u00b7 'sonor:who-here' {people}
   CHROME: a small cluster beside the "who am I" pill (or inside [data-sonor-who-bar]) \u2014 who else is in this app / project
   right now (green ring) + who last edited this project in this app.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  if (global.SonorWho && global.SonorWho.VERSION) return;
  var VERSION = '1.0.1';   // 1.0.1: multi-person strings are not matched to one user; non-ASCII escaped
  var U = global.__SONOR_USER__ || null;
  var SBC = global.__SONOR_SB__ || {};
  var SB = SBC.url || 'https://ysmvklstkzodlocttspy.supabase.co';
  var ANON = SBC.anon || global.SONOR_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbXZrbHN0a3pvZGxvY3R0c3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc0OTMsImV4cCI6MjA4OTM0MzQ5M30.08kRS_dtbwz0rSYezNGMJHnOU_st8GKZseQPefcMEMc';
  var APP = (U && U.app) || (location.pathname.split('/')[1] || '').toLowerCase();
  var POLL = 20000;

  var S = { people: [], byEmail: {}, byName: {}, rows: {}, pending: {}, since: new Date().toISOString(), here: [], proj: null, timer: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rpc(fn, args) {
    return global.fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) })
      .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.round(s / 86400) + ' d ago'; return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function ink(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff'; var n = parseInt(m[1], 16); var l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#1C1C1E' : '#fff'; }

  // ── people ───────────────────────────────────────────────────────────
  function person(v) {
    if (!v) return null; var k = String(v).trim().toLowerCase();
    // exact email / full name / first name / initials only — a value like 'Bryn + Mark' or 'Chris (Moore Secure)' is NOT a user
    // (matching its first word would silently drop the second person on the next save)
    return S.byEmail[k] || S.byName[k] || null;
  }
  function label(v) { var p = person(v); return p ? p.name : (v || ''); }
  function initials(v) { var p = person(v); if (p) return p.initials; var w = String(v || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
  function bubble(v, o) {
    o = o || {}; var p = person(v); var el = document.createElement('span');
    el.className = 'sw-b' + (o.size === 'sm' ? ' sw-sm' : o.size === 'lg' ? ' sw-lg' : '') + (p ? '' : ' sw-out') + (o.ring ? ' sw-ring' : '');
    var col = p ? p.colour : '#5A5A5E';
    el.style.background = col; el.style.color = ink(col);
    el.textContent = initials(v);
    el.title = o.title || (p ? p.name : (v ? v + ' (not a Sonor user)' : ''));
    el.setAttribute('aria-label', el.title);
    return el;
  }

  // ── rows: last editor per row ────────────────────────────────────────
  function rowTitle(r) {
    var p = person(r.who); var what = (r.op === 'insert' ? 'added' : r.op === 'delete' ? 'deleted' : 'edited');
    var ch = (r.changed || []).filter(function (c) { return !/(_at|_by)$/.test(c); }).slice(0, 4).map(function (c) { return c.replace(/_/g, ' '); });
    return (p ? p.name : r.who) + ' \u00b7 ' + what + ' ' + ago(r.at) + (ch.length ? ' \u00b7 ' + ch.join(', ') : '') + (r.saves > 1 ? ' (' + r.saves + ' saves)' : '');
  }
  function paintRow(el) {
    var key = el.getAttribute('data-sonor-row'); var r = S.rows[key];
    var slot = el.querySelector(':scope > [data-sonor-who-slot], [data-sonor-who-slot]') || el;
    var old = slot.querySelector(':scope > .sw-row'); if (old) old.remove();
    if (!r || !r.who) return;
    var b = bubble(r.who, { size: 'sm', title: rowTitle(r) }); b.classList.add('sw-row');
    if (Date.now() - new Date(r.at).getTime() < 90e3) b.classList.add('sw-fresh');
    slot.appendChild(b);
  }
  function want(key) {
    if (key in S.rows || S.pending[key]) return; var i = key.indexOf(':'); if (i < 1) return;
    S.pending[key] = 1; clearTimeout(want.t); want.t = setTimeout(flush, 80);
  }
  function flush() {
    var byT = {}; Object.keys(S.pending).forEach(function (k) { var i = k.indexOf(':'); (byT[k.slice(0, i)] = byT[k.slice(0, i)] || []).push(k.slice(i + 1)); });
    S.pending = {};
    Object.keys(byT).forEach(function (t) {
      var pks = byT[t];
      for (var i = 0; i < pks.length; i += 200) (function (chunk) {
        rpc('sonor_last_editors', { p_table: t, p_pks: chunk }).then(function (rows) {
          chunk.forEach(function (pk) { S.rows[t + ':' + pk] = null; });
          (rows || []).forEach(function (r) { S.rows[t + ':' + r.row_pk] = r; });
          chunk.forEach(function (pk) { paintAll(t + ':' + pk); });
        });
      })(pks.slice(i, i + 200));
    });
  }
  function paintAll(key) {
    var sel = key ? '[data-sonor-row="' + (global.CSS && CSS.escape ? CSS.escape(key) : key) + '"]' : '[data-sonor-row]';
    document.querySelectorAll(sel).forEach(paintRow);
  }

  // ── people bubbles + selects ─────────────────────────────────────────
  function paintPerson(el) {
    var v = el.getAttribute('data-sonor-person'); var mode = el.getAttribute('data-sonor-person-mode') || 'bubble';
    if (el.__swv === v + mode) return; el.__swv = v + mode;
    el.innerHTML = ''; if (!v) return;
    if (mode !== 'name') el.appendChild(bubble(v, { size: el.getAttribute('data-sonor-size') || 'sm' }));
    if (mode !== 'bubble') { var n = document.createElement('span'); n.className = 'sw-name'; n.textContent = label(v); el.appendChild(n); }
    el.classList.add('sw-person');
  }
  function fillSelect(sel, o) {
    o = o || {}; var spec = sel.getAttribute('data-sonor-people') || '';
    var kinds = o.kinds || (/staff/.test(spec) ? ['staff', 'subcontractor'] : null);
    var none = o.none != null ? o.none : /\+none/.test(spec);
    var cur = o.value != null ? o.value : (sel.value || sel.getAttribute('data-value') || '');
    var curP = person(cur); var curV = curP ? curP.email : cur;
    var list = S.people.filter(function (p) { return p.status !== 'disabled' && p.role_key !== 'demo' && (!kinds || kinds.indexOf(p.kind) >= 0); });
    var h = (none || !curV ? '<option value="">\u2014 Unassigned</option>' : '') +
      list.map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.name) + '</option>'; }).join('');
    if (curV && !list.some(function (p) { return p.email === curV; })) h += '<option value="' + esc(curV) + '">' + esc(label(curV)) + (curP ? '' : ' (not a user)') + '</option>';
    sel.innerHTML = h; sel.value = curV; sel.__swFilled = S.people.length;
  }

  // ── scan + observe ───────────────────────────────────────────────────
  function scan(root) {
    root = root && root.querySelectorAll ? root : document;
    var rows = root.querySelectorAll('[data-sonor-row]');
    rows.forEach(function (el) { var k = el.getAttribute('data-sonor-row'); if (k in S.rows) { if (!el.querySelector('.sw-row') && S.rows[k]) paintRow(el); } else want(k); });
    root.querySelectorAll('[data-sonor-person]').forEach(paintPerson);
    root.querySelectorAll('select[data-sonor-people]').forEach(function (s) { if (s.__swFilled !== S.people.length) fillSelect(s); });
    if (root !== document && root.matches) {
      if (root.matches('[data-sonor-row]')) { var k = root.getAttribute('data-sonor-row'); if (k in S.rows) paintRow(root); else want(k); }
      if (root.matches('[data-sonor-person]')) paintPerson(root);
    }
  }
  var mo = new MutationObserver(function (muts) {
    var dirty = false; for (var i = 0; i < muts.length && !dirty; i++) {
      var m = muts[i]; if (m.type === 'attributes') { dirty = true; break; }
      for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1 && !(n.classList && (n.classList.contains('sw-b') || n.classList.contains('sw-name')))) { dirty = true; break; } }
    }
    if (dirty) { clearTimeout(mo.t); mo.t = setTimeout(scan, 60); }
  });

  // ── project + presence + polling ─────────────────────────────────────
  function projectId() {
    try { if (global.SonorProjectBar && SonorProjectBar.getActiveId) { var a = SonorProjectBar.getActiveId(); if (a) return a; } } catch (e) {}
    var q = new URLSearchParams(location.search); var p = q.get('pid') || q.get('project') || q.get('project_id');
    if (!p) { try { p = localStorage.getItem('sonor_active_project_id::' + APP) || localStorage.getItem('sonor_active_project_id'); } catch (e) {} }
    return /^[0-9a-f-]{36}$/i.test(p || '') ? p : null;
  }
  function cluster() {
    var host = document.querySelector('[data-sonor-who-bar]');
    var el = document.getElementById('sonor-who-here');
    if (!el) { el = document.createElement('div'); el.id = 'sonor-who-here'; if (host) { host.appendChild(el); el.classList.add('sw-inbar'); } else document.body.appendChild(el); }
    return el;
  }
  function drawCluster(last) {
    var el = cluster(); el.innerHTML = '';
    var here = S.here.filter(function (h, i, a) { return a.findIndex(function (x) { return x.email === h.email; }) === i; });
    if (here.length) {
      var g = document.createElement('span'); g.className = 'sw-here';
      here.slice(0, 5).forEach(function (h) {
        var where = h.app === APP ? 'here now' : 'on this project in ' + h.app;
        g.appendChild(bubble(h.email, { size: 'sm', ring: true, title: label(h.email) + ' \u00b7 ' + where }));
      });
      if (here.length > 5) { var m = document.createElement('span'); m.className = 'sw-more'; m.textContent = '+' + (here.length - 5); g.appendChild(m); }
      el.appendChild(g);
    }
    if (last && last.who) {
      var l = document.createElement('span'); l.className = 'sw-last';
      l.appendChild(bubble(last.who, { size: 'sm', title: label(last.who) + ' \u00b7 last edit on this project here ' + ago(last.at) }));
      var t = document.createElement('span'); t.textContent = 'edited ' + ago(last.at); l.appendChild(t);
      el.appendChild(l);
    }
    el.hidden = !el.childNodes.length;
  }
  function tick() {
    var pid = projectId();
    var a = rpc('sonor_here', { p_app: APP, p_project: pid, p_page: location.pathname }).then(function (rows) {
      S.here = rows || []; document.dispatchEvent(new CustomEvent('sonor:who-here', { detail: { people: S.here } }));
    });
    var b = pid ? rpc('sonor_project_editors', { p_project: pid, p_app: APP, p_limit: 1 }).then(function (r) { return (r || [])[0] || null; }) : Promise.resolve(null);
    var c = rpc('sonor_audit_since', { p_since: S.since }).then(function (rows) {
      if (!rows || !rows.length) return;
      S.since = rows[0].at;
      var seen = {};
      rows.slice().reverse().forEach(function (r) {
        var k = r.table_name + ':' + r.row_pk;
        if (k in S.rows) { var cur = S.rows[k]; S.rows[k] = Object.assign({}, cur || {}, { row_pk: r.row_pk, who: r.who, at: r.at, app: r.app, op: (cur && cur.op) || 'update', changed: (cur && cur.changed) || [] }); seen[k] = 1; }
      });
      Object.keys(seen).forEach(function (k) { delete S.rows[k]; want(k); });   // re-fetch for the real changed list
      document.dispatchEvent(new CustomEvent('sonor:who-change', { detail: { rows: rows } }));
    });
    Promise.all([a, b, c]).then(function (res) { drawCluster(res[1]); });
  }

  var css = '.sw-b{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:24px;height:24px;border-radius:50%;font:700 10px/1 "DM Sans",system-ui,sans-serif;letter-spacing:.02em;vertical-align:middle;box-shadow:0 0 0 2px var(--surface-1,var(--bg1,#1C1C1E));cursor:default;user-select:none}' +
    '.sw-b.sw-sm{width:20px;height:20px;font-size:9px}.sw-b.sw-lg{width:32px;height:32px;font-size:12px}.sw-b.sw-out{opacity:.7;font-style:italic}' +
    '.sw-b.sw-ring{box-shadow:0 0 0 2px var(--surface-1,#1C1C1E),0 0 0 3.5px #3DB56F}' +
    '.sw-row{margin-left:6px}.sw-row.sw-fresh{animation:sw-pulse 1.4s ease-out 2}@keyframes sw-pulse{0%{box-shadow:0 0 0 2px var(--surface-1,#1C1C1E),0 0 0 2px rgba(173,153,120,.9)}100%{box-shadow:0 0 0 2px var(--surface-1,#1C1C1E),0 0 0 10px rgba(173,153,120,0)}}' +
    '.sw-person{display:inline-flex;align-items:center;gap:6px;vertical-align:middle}.sw-name{white-space:nowrap}' +
    '#sonor-who-here{position:fixed;right:12px;bottom:46px;z-index:2147482999;display:flex;align-items:center;gap:10px;padding:4px 10px 4px 6px;border-radius:999px;background:#2C2C2E;border:1px solid rgba(255,255,255,.12);color:#C7C7CC;font:500 11px/1.4 "DM Sans",system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
    '#sonor-who-here.sw-inbar{position:static;box-shadow:none;background:transparent;border:0;padding:0}' +
    '#sonor-who-here[hidden]{display:none}#sonor-who-here .sw-here{display:flex}#sonor-who-here .sw-here .sw-b+.sw-b{margin-left:-6px}' +
    '#sonor-who-here .sw-last{display:flex;align-items:center;gap:6px}#sonor-who-here .sw-here+.sw-last{border-left:1px solid rgba(255,255,255,.12);padding-left:10px}' +
    '#sonor-who-here .sw-more{margin-left:4px;color:#98989D}' +
    '@media print{.sw-b,#sonor-who-here{display:none!important}}@media (prefers-reduced-motion:reduce){.sw-row.sw-fresh{animation:none}}';

  var readyResolve; var ready = new Promise(function (r) { readyResolve = r; });
  function start() {
    if (!U || !U.ok) { readyResolve(false); return; }
    var st = document.createElement('style'); st.id = 'sonor-who-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st);
    rpc('sonor_people').then(function (rows) {
      S.people = rows || []; S.byEmail = {}; S.byName = {};
      S.people.forEach(function (p) { S.byEmail[p.email.toLowerCase()] = p; S.byName[String(p.name || '').toLowerCase()] = p; var first = String(p.name || '').split(' ')[0].toLowerCase(); if (first && !S.byName[first]) S.byName[first] = p; S.byName[String(p.initials || '').toLowerCase()] = S.byName[String(p.initials || '').toLowerCase()] || p; });
      readyResolve(true);
      scan(document);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sonor-row', 'data-sonor-person'] });
      tick(); S.timer = setInterval(function () { if (!document.hidden) tick(); }, POLL);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
      document.addEventListener('sonor:project-changed', function () { setTimeout(tick, 300); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  global.SonorWho = {
    VERSION: VERSION, ready: ready,
    people: function () { return S.people.slice(); }, person: person, label: label, initials: initials, bubble: bubble,
    fillSelect: fillSelect, lastEditor: function (t, pk) { return S.rows[t + ':' + pk] || null; }, watch: function () { scan(document); },
    here: function () { return S.here.slice(); }, projectId: projectId
  };
})(window);
