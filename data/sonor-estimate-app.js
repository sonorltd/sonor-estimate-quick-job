/* sonor-estimate-app.js — CANONICAL MASTER (workspace root; synced to data/ of every APP - ESTIMATE - * app)
   v1.0.0 · 2026-11-09 · B-809 · sonor-platform §67 — the ONE estimate app UI. Each estimate app (APP - ESTIMATE - Cinema,
   - Media Wall, - Media Room …) is a thin host page that sets window.__ESTIMATE_APP__ = { kind, appKey } and calls
   EstimateApp.boot(shell.ready). Everything else — inputs, sections editor, live cards, export modal, revisions, hand-off —
   lives here, so a new kind is a template + a host page, never a new app body.

   Flow: project picker (SonorProjectBar, grouped blocks, last touched first) → the project's estimates of this kind (R1, R2 …)
   → inputs panel (room sizes etc. from the template; pre-filled from the design apps' rows via projects.metadata.links)
   → sections editor (drag to reorder sections and rows, rows editable, option / allowance toggles) → live cards → export modal
   (Cover · Overview · Product cards · Preliminary budget · Basis · Rear, A3/A4, landscape default) → Issue (freezes the rev,
   records it on the project) → Progress → (opens the design app on the project) / Push to WeQuote (when a quote is paired).

   Data: estimates (this app's only table writes: insert / update drafts; RPCs estimate_link · estimate_issue · estimate_new_rev),
   estimate_templates (read; offline tier data/sonor-estimate-templates.js), av_catalogue (read — product names, hero_image, specs,
   msrp, wq link), projects (read; written ONLY through the estimate RPCs), cinema_designs / media_wall_configs (read — inputs).
*/
(function (global) {
  'use strict';
  var VERSION = '1.3.0';   // 1.3.0: a published design budget (template.designBudget) seeds the sections — 1410 Media Room from Stretched Fabric.   // 1.2.0: garden design into Whole House, ?pid= + ?estimate= deep links. 1.1.0: source freshness + history + the project mirror (estimates_summary), sub-group rows
  var E = global.SonorEstimate;
  var A = global.__ESTIMATE_APP__ || {};
  var S = { db: null, ready: false, projects: [], project: null, list: [], cur: null, dirty: false, tpl: null, lib: {}, libLoaded: false, collapsed: {} };
  var LS = 'sonor-estimate-' + (A.kind || 'x');
  var PDF_SECTIONS = [['cover', 'Cover'], ['overview', 'Overview'], ['products', 'Product cards'], ['budget', 'Preliminary budget'], ['basis', 'Basis'], ['rear', 'Rear page']];

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
  function toast(msg, kind) { if (global.SonorShell && global.SonorShell.toast) global.SonorShell.toast(msg, { kind: kind || 'info' }); else console.log('[estimate]', msg); }
  function money(v) { return E.money(v); }
  function who() { var u = global.__SONOR_USER__ || {}; return u.name || u.email || null; }
  function fmtAt(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function reads() { return E.readsOf(tpl(), A.kind); }
  function nowStamps() { return E.sourceStamps((S.project && S.project.metadata) || {}, reads(), S.linked); }
  function stampRead(what) { if (!S.cur) return; S.cur.source = Object.assign({}, S.cur.source, { read: nowStamps(), read_at: new Date().toISOString() }); if (what) log(what); }
  function log(what) { if (!S.cur || S.cur.status !== 'draft') return; var md = S.cur.metadata || {}, L = md.log || [], last = L[L.length - 1], by = who();
    if (what === 'Saved' && last && last.what === 'Saved' && last.by === by && Date.now() - Date.parse(last.at) < 15 * 60000) { last.at = new Date().toISOString(); return; }   // one line per editing burst
    S.cur.metadata = E.logEntry(md, what, by); }
  function client() { return S.db && S.db.client; }
  function tpl() { return S.tpl || ((global.__SONOR_ESTIMATE_TEMPLATES__ || {})[A.kind]) || { inputs: [], sections: [] }; }
  function editable() { return !!S.cur && S.cur.status === 'draft'; }
  function appUrl(key) { var b = global.__SONOR_BRAND__ || {}, u = b.appUrls || {}; var src = location.protocol === 'file:' ? 'local' : 'hosted'; var map = { cinemaDesign: 'cinema', stretchedFabric: 'stretched-fabric', ledCalc: 'led-calc', mediaWall: 'media-wall', gardenLighting: 'garden-lighting', seating: 'seating', takeoffs: 'takeoffs', pm: 'pm' }; return (u[src] || {})[map[key] || key] || null; }

  // ── load ────────────────────────────────────────────────────────────────────────────────────────
  async function boot(shellReady) {
    E = global.SonorEstimate; A = global.__ESTIMATE_APP__ || A;
    wire();
    var res = await shellReady; S.db = res && res.db; S.ready = !!(res && res.supaReady);
    if (!S.ready) { toast('Supabase not reachable — estimates need the database', 'warn'); render(); return; }
    var c = client();
    var r = await Promise.all([
      c.from('projects').select('id, ref, name, client_name, address, postcode, status, metadata, updated_at').order('updated_at', { ascending: false }).limit(1000),
      c.from('estimate_templates').select('kind, title, version, template').eq('kind', A.kind).maybeSingle()
    ]);
    if (r[0].error) toast(r[0].error.message, 'error');
    S.projects = r[0].data || [];
    // 1.2.0 — the NEWER template wins: the table copy (estimate_templates) is used only when its version is at least the built-in one,
    // so a pushed template is live at once and the table can never hold an app back on an older method. Offline → the built-in copy.
    var bt = (global.__SONOR_ESTIMATE_TEMPLATES__ || {})[A.kind], dt = r[1] && r[1].data && r[1].data.template;
    var vcmp = function (a, b) { a = String(a || '0').split('.').map(Number); b = String(b || '0').split('.').map(Number); for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); } return 0; };
    if (dt && ((dt.sections || []).length || dt.takeoff) && (!bt || vcmp(dt.version || r[1].data.version, bt.version) >= 0)) S.tpl = dt;
    S.tplSrc = S.tpl ? 'table' : (dt ? 'built-in, newer than the table' : 'offline copy');
    var qs = new URLSearchParams(location.search), want = qs.get('project') || qs.get('pid') || (location.hash.match(/project=([0-9a-f-]{36})/) || [])[1];
    var PB = global.SonorProjectBar;
    if (PB && PB.init) {
      try {
        await PB.init({ supa: c, appKey: A.appKey, host: $('#projectBarHost'), showNew: false,
          beforeChange: function () { return !S.dirty || confirm('Discard unsaved changes to this estimate?'); },
          onChange: function (d) { var id = d && d.currentId || null; if (S.project && S.project.id === id) return; selectProject(id); } });
      } catch (e) { console.warn('[estimate] project bar', e); }
      if (!want && PB.getActiveId) want = PB.getActiveId();
    }
    await selectProject(want || null);
  }
  async function selectProject(id) {
    S.project = S.projects.find(function (p) { return p.id === id; }) || null; S.cur = null; S.list = []; S.dirty = false;
    var PB = global.SonorProjectBar; if (PB && PB.getActiveId && id && PB.getActiveId() !== id) PB.setActive(id);
    if (S.project) {
      var r = await client().from('estimates').select('*').eq('project_id', S.project.id).eq('kind', A.kind).order('rev', { ascending: false });
      if (r.error) toast(r.error.message, 'error');
      S.list = r.data || [];
      var wantEst = new URLSearchParams(location.search).get('estimate'); S.cur = (wantEst && S.list.find(function (e) { return e.id === wantEst; })) || S.list.find(function (e) { return e.status === 'draft'; }) || S.list[0] || null;   // 1.2.0 — ?estimate=<id> deep link (Blueprint, project bar, other estimates)
      await loadLinked();
    }
    await loadLibrary();
    render();
  }
  // Library rows for every model_id the template or the estimate names — names, hero_image, specs, msrp, WeQuote link
  async function loadLibrary() {
    var ids = {}; (tpl().sections || []).forEach(function (s) { (s.rows || []).forEach(function (r) { if (r.model_id) ids[r.model_id] = 1; }); });
    if (S.cur) (S.cur.sections || []).forEach(function (s) { (s.rows || []).forEach(function (r) { if (r.model_id) ids[r.model_id] = 1; }); });
    var need = Object.keys(ids).filter(function (k) { return !S.lib[k]; }); if (!need.length || !client()) return;
    var r = await client().from('av_catalogue').select('model_id, make, model, category, service_nn, description, msrp_gbp, metadata').in('model_id', need);
    (r.data || []).forEach(function (x) { var md = x.metadata || {}; S.lib[x.model_id] = { make: x.make, model: x.model, category: x.category, service_nn: x.service_nn, description: x.description, msrp: x.msrp_gbp, hero_image: md.hero_image || null, specs: md.specs || null, wq: md.wq || null, trade: md.trade_price_gbp != null ? Number(md.trade_price_gbp) : null, wq_sell: md.wq && md.wq.sell != null ? Number(md.wq.sell) : null }; });
  }
  function lib(id) { return S.lib[id] || null; }
  // the project's estimates of OTHER kinds (a whole house reads the room estimates; their saved time is a source like Takeoffs)
  async function loadLinked() {
    S.linked = [];
    if (!S.project || !client() || reads().indexOf('estimate:*') < 0) return S.linked;
    try { var r = await client().from('estimates').select('id, kind, rev, status, label, sections, metadata, updated_at').eq('project_id', S.project.id).neq('kind', A.kind); S.linked = E.pickLinked(r.data || []); } catch (e) { console.warn('[estimate] linked estimates', e); }
    return S.linked;
  }

  // inputs from the design apps' rows (§66 links) — never typed twice
  async function inputsFromProject() {
    await refreshProject();
    var p = S.project, md = (p && p.metadata) || {}, L = md.links || {}, inp = E.inputsFromSummaries ? E.inputsFromSummaries(md) : {}, c = client();   // 1.1.0: the design apps' summaries + Takeoffs first, then the linked rows
    var cdId = L.cinema_design_id || ((md.cinema_rooms || [])[0] || {}).design_id || null;
    try {
      if (cdId) { var cd = await c.from('cinema_designs').select('room_width, room_depth, room_height, metadata').eq('id', cdId).maybeSingle(); if (cd.data) { if (cd.data.room_width) inp.w_mm = Number(cd.data.room_width); if (cd.data.room_depth) inp.d_mm = Number(cd.data.room_depth); if (cd.data.room_height) inp.h_mm = Number(cd.data.room_height); } }
      if (A.kind === 'media-wall') { var mw = await c.from('media_wall_configs').select('config').eq('project_id', p.id).eq('archived', false).order('updated_at', { ascending: false }).limit(1); var rm = mw.data && mw.data[0] && mw.data[0].config && mw.data[0].config.design && mw.data[0].config.design.room; if (rm) { if (rm.wall_mm) inp.w_mm = rm.wall_mm; if (rm.ceiling_mm) inp.h_mm = rm.ceiling_mm; } }
      if (!inp.h_mm && p.metadata && p.metadata.ceiling_height_mm) inp.h_mm = Number(p.metadata.ceiling_height_mm);
    } catch (e) { console.warn('[estimate] inputs from links', e); }
    return inp;
  }

  // the project record again (Takeoffs / the design apps may have published since the list loaded)
  async function refreshProject() {
    if (!S.project || !client()) return;
    try { var r = await client().from('projects').select('id, ref, name, client_name, address, postcode, status, metadata, updated_at').eq('id', S.project.id).maybeSingle(); if (r.data) { S.project = r.data; S.projects = S.projects.map(function (x) { return x.id === r.data.id ? r.data : x; }); } } catch (e) { console.warn('[estimate] project refresh', e); }
  }
  // sections for a new / reseeded estimate: Takeoffs (whole house) or the template + inputs (one room)
  async function seedSections(t, inputs) {
    // 1.3.0 — a design app that publishes a client budget (template.designBudget: ['stretched_fabric_spec', …]) seeds the sections; the
    // template + inputs is the fallback when no design has been priced yet
    var md0 = (S.project && S.project.metadata) || {}, dk = (t.designBudget || []).find(function (k) { return md0[k] && md0[k].budget && (md0[k].budget.sections || []).length; });
    if (dk && E.fromDesignBudget) { toast('Sections taken from the ' + E.sourceLabel(dk) + ' design', 'info'); return E.fromDesignBudget(md0[dk].budget); }
    if (t.source !== 'takeoff') return E.fromTemplate(t, inputs, lib);
    var md = (S.project && S.project.metadata) || {}, ts = md.takeoff_summary;
    if (!ts || !(ts.places || []).length) { toast('No Takeoffs plan on this project yet — draw the points in Takeoffs, then re-read', 'warn'); return []; }
    var linked = await loadLinked();
    return E.fromTakeoff(t, ts, { linked: linked, garden: md.garden_lighting_spec });
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────
  async function newEstimate() {
    if (!S.project) { toast('Pick a project first', 'warn'); return; }
    var t = tpl(), inputs = Object.assign(E.defaultsOf(t), await inputsFromProject());
    await loadLibrary();
    var rev = S.list.reduce(function (m, e) { return Math.max(m, e.rev || 0); }, 0) + 1;
    var secs = await seedSections(t, inputs);
    S.cur = { id: null, project_id: S.project.id, kind: A.kind, rev: rev, status: 'draft', label: t.title, inputs: inputs, sections: secs, basis: (t.basis || []).slice(), flags: t.flags === null ? [] : (t.flags || []).slice(), totals: {}, source: { template: A.kind + '@' + (t.version || '1.0.0'), app: A.appKey, app_version: A.version || null }, metadata: { contingency: (t.defaults || {}).contingency || 0 } };
    stampRead('Created R' + rev + (t.source === 'takeoff' ? ' from Takeoffs' : ' from the ' + (t.title || 'template').toLowerCase() + ' template'));
    S.dirty = true; render();
  }
  async function reseed() {
    var t = tpl(), tk = t.source === 'takeoff';
    if (!editable()) return; if (!confirm(tk ? 'Re-read the sections from Takeoffs and the project\'s other estimates? Typed changes to rows are replaced.' : 'Rebuild the sections from the template and the inputs? Typed changes to rows are replaced.')) return;
    if (tk) { Object.assign(S.cur.inputs, await inputsFromProject()); }
    S.cur.sections = await seedSections(t, S.cur.inputs); stampRead(tk ? 'Re-read from Takeoffs' + ((S.linked || []).length ? ' + ' + S.linked.map(function (e) { return (e.label || e.kind) + ' R' + e.rev; }).join(', ') : '') : 'Sections rebuilt from the template'); S.dirty = true; render();
  }
  // a room estimate: take the design apps' current figures into the inputs (rows untouched) and record the read
  async function rereadInputs() {
    if (!editable()) return; Object.assign(S.cur.inputs, await inputsFromProject()); stampRead('Inputs re-read from ' + reads().map(E.sourceLabel).join(', ')); S.dirty = true; render(); toast('Inputs updated from the project — rebuild the sections if the sizes changed', 'info');
  }
  // the project-record mirror: projects.metadata.estimates_summary.by_kind[kind] (latest rev + the latest sent one), via the shared merge RPC
  async function publishSummary() {
    if (!S.cur || !S.cur.id || !client()) return; await refreshProject(); var md = (S.project && S.project.metadata) || {};
    var e = E.summaryEntry(S.cur), sent = S.list.filter(function (x) { return x.status === 'sent'; }).sort(function (a, b) { return b.rev - a.rev; })[0];
    if (sent) { var st = sent.totals || E.totals(sent); e.sent = { id: sent.id, rev: sent.rev, core_inc: st.core_inc || 0, with_options_inc: st.with_options_inc || 0, at: (sent.metadata || {}).issued_at || sent.updated_at || null }; }
    try { var r = await client().rpc('sonor_merge_project_metadata', { p_project_id: S.project.id, p_patch: { estimates_summary: E.mergeSummary(md.estimates_summary, e) } }); if (r.error) throw r.error; await refreshProject(); }
    catch (err) { console.warn('[estimate] project mirror', err); }
  }
  function estModel() { var c = S.cur || {}; return { id: c.id, kind: A.kind, rev: c.rev, label: c.label, sections: c.sections || [], basis: c.basis || [], flags: c.flags, contingency: num((c.metadata || {}).contingency, 0), intro: (c.metadata || {}).intro || null }; }
  async function save(silent, opts) {
    if (!S.cur || !editable()) return null; var c = client(); if (!c) return null;
    if (!opts || !opts.noLog) log('Saved');
    var m = estModel(); S.cur.totals = E.totals(m); S.cur.sections.forEach(function (s) { var t = S.cur.totals.sections[s.key] || {}; s.total_inc = t.total_inc; s.options_inc = t.options_inc; });
    var body = { project_id: S.cur.project_id, kind: A.kind, rev: S.cur.rev, status: 'draft', label: S.cur.label, inputs: S.cur.inputs, sections: S.cur.sections, totals: S.cur.totals, basis: S.cur.basis, flags: S.cur.flags || [], source: S.cur.source || {}, metadata: S.cur.metadata || {} };
    var r = S.cur.id ? await c.from('estimates').update(body).eq('id', S.cur.id).select('*').single() : await c.from('estimates').insert(body).select('*').single();
    if (r.error) { toast('Save failed: ' + r.error.message, 'error'); return null; }
    var first = !S.cur.id; S.cur = r.data; S.dirty = false;
    if (first) { await c.rpc('estimate_link', { p_id: S.cur.id }); S.list.unshift(S.cur); } else S.list = S.list.map(function (e) { return e.id === S.cur.id ? S.cur : e; });
    await publishSummary();
    if (!silent) toast('Saved · R' + S.cur.rev, 'ok'); render(); return S.cur;
  }
  async function issue() {
    if (!S.cur) return;
    if (!confirm('Issue R' + S.cur.rev + '? It is frozen once issued — later changes become R' + (S.cur.rev + 1) + '.')) return;
    log('Issued R' + S.cur.rev); S.cur.metadata = Object.assign({}, S.cur.metadata, { issued_at: new Date().toISOString(), issued_by: who() });
    if (!(await save(true, { noLog: true }))) return;   // the log line + issued_at go in BEFORE the freeze
    var r = await client().rpc('estimate_issue', { p_id: S.cur.id }); if (r.error) { toast('Issue failed: ' + r.error.message, 'error'); return; }
    var kept = S.cur.id; await selectProject(S.project.id); S.cur = S.list.find(function (e) { return e.id === kept; }) || S.cur; await publishSummary(); render();
    toast('Issued R' + S.cur.rev + ' — recorded on the project', 'ok');
  }
  async function newRev() {
    if (!S.cur || !S.cur.id) return; var r = await client().rpc('estimate_new_rev', { p_id: S.cur.id }); if (r.error) { toast(r.error.message, 'error'); return; }
    var from = S.cur.rev; await selectProject(S.project.id); var n = S.list.find(function (e) { return e.id === r.data; }); if (n) { S.cur = n; S.cur.metadata = Object.assign({}, S.cur.metadata, { issued_at: null, issued_by: null }); stampRead('R' + n.rev + ' started from R' + from); await save(true, { noLog: true }); }
  }
  function pickRev(id) { if (S.dirty && !confirm('Discard unsaved changes?')) return; S.cur = S.list.find(function (e) { return e.id === id; }) || S.cur; S.dirty = false; render(); }

  // edits
  function mark() { var was = S.dirty; S.dirty = true; renderCards(); if (!was) renderActions(); }
  function setInput(k, v) { if (!editable()) return; S.cur.inputs[k] = v === '' ? null : num(v, null); mark(); }
  function setMeta(k, v) { if (!editable()) return; S.cur.metadata = S.cur.metadata || {}; S.cur.metadata[k] = k === 'contingency' ? num(v, 0) / 100 : v; mark(); }
  function setSec(si, k, v) { if (!editable()) return; var s = S.cur.sections[si]; if (!s) return; s[k] = (k === 'optional') ? !!v : v; mark(); if (k === 'optional') render(); }
  function setRow(si, ri, k, v) {
    if (!editable()) return; var r = (S.cur.sections[si] || {}).rows[ri]; if (!r) return;
    if (k === 'optional' || k === 'allowance') r[k] = !!v; else if (k === 'label' || k === 'unit') r[k] = v;
    else if (k === 'inc') r.inc = v === '' ? null : num(v, null);
    else if (k === 'qty') { var unitPx = r.unit_sell_ex != null ? r.unit_sell_ex : (num(r.qty, 1) ? num(r.sell_ex) / num(r.qty, 1) : 0); r.qty = num(v, 1); if (unitPx) r.sell_ex = Math.round(unitPx * r.qty * 100) / 100; r.unit_sell_ex = unitPx; }
    else if (k === 'sell_ex') { r.sell_ex = v === '' ? null : num(v, null); r.unit_sell_ex = num(r.qty, 1) ? r.sell_ex / num(r.qty, 1) : r.sell_ex; }
    mark(); if (k === 'qty' || k === 'sell_ex' || k === 'optional') renderRowInc(si, ri);
  }
  function addRow(si) { if (!editable()) return; S.cur.sections[si].rows.push({ label: '', qty: 1, unit: 'no.', sell_ex: 0 }); mark(); render(); }
  function delRow(si, ri) { if (!editable()) return; S.cur.sections[si].rows.splice(ri, 1); mark(); render(); }
  function addSection(nn) { if (!editable()) return; var sv = ((global.__SONOR_BRAND__ || {}).services || []).find(function (x) { return String(x.nn) === String(nn); }); S.cur.sections.push({ key: 'sec-' + Date.now().toString(36), service_nn: nn || null, hex: nn ? null : '#ad9978', title: sv ? (sv.client || sv.name) : 'New section', rows: [{ label: '', qty: 1, sell_ex: 0 }] }); mark(); render(); }
  function delSection(si) { if (!editable()) return; if (!confirm('Remove this section?')) return; S.cur.sections.splice(si, 1); mark(); render(); }
  function toggle(si) { var k = (S.cur.sections[si] || {}).key; S.collapsed[k] = !S.collapsed[k]; render(); }
  function setBasis(txt) { if (!editable()) return; S.cur.basis = String(txt || '').split('\n').map(function (t) { return t.trim(); }).filter(Boolean); mark(); }

  // ── render ──────────────────────────────────────────────────────────────────────────────────────
  function render() {
    var host = $('#estMain'); if (!host) return;
    var t = tpl(), c = S.cur;
    renderActions();
    if (!S.project) { host.innerHTML = '<div class="card empty-state">Pick a project in the bar above to start a ' + esc((t.title || 'estimate').toLowerCase()) + '.</div>'; return; }
    if (!c) { host.innerHTML = '<div class="card empty-state"><h3>' + esc(S.project.name || S.project.ref) + '</h3><p class="muted">No ' + esc((t.title || 'estimate').toLowerCase()) + ' on this project yet. ' + (t.source === 'takeoff' ? 'A new one reads every point on the Takeoffs plan by service, and takes the cinema / media wall figures from their own estimates.' : 'A new one starts from the ' + esc(t.title || '') + ' template, with the room sizes taken from the project\'s design apps and Takeoffs.') + '</p><button class="btn btn-primary" onclick="EstimateApp.newEstimate()">Start ' + esc((t.title || 'estimate').toLowerCase()) + '</button></div>'; return; }
    var ro = !editable(), h = '';
    h += '<div class="est-grid"><div class="est-left">';
    // inputs
    h += '<div class="card est-inputs"><div class="card-header est-ptt">Inputs <span class="muted">· ' + esc(t.title || '') + ' template ' + esc(t.version || '') + (S.tpl ? '' : ' (' + esc(S.tplSrc || 'offline copy') + ')') + '</span>' + (ro ? '' : (t.source === 'takeoff' ? '<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="EstimateApp.reseed()" title="Read the points from Takeoffs and the project\'s room estimates again">↻ Re-read from Takeoffs</button>' : '<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="EstimateApp.reseed()" title="Rebuild the sections from the template and these inputs">↻ Reseed sections</button>')) + '</div>' + staleHtml() + '<div class="est-in-grid">';
    (t.inputs || []).forEach(function (i) { var v = c.inputs[i.key]; h += '<label class="est-in"><span class="field-label">' + esc(i.label) + (i.unit ? ' <em>' + esc(i.unit) + '</em>' : '') + '</span><input class="input mono" type="number" ' + (i.step ? 'step="' + i.step + '" ' : '') + (i.min != null ? 'min="' + i.min + '" ' : '') + (i.max != null ? 'max="' + i.max + '" ' : '') + 'value="' + esc(v == null ? '' : v) + '"' + (ro || i.readonly ? ' disabled' : '') + ' onchange="EstimateApp.setInput(\'' + i.key + '\',this.value)"></label>'; });
    h += '<label class="est-in"><span class="field-label">Contingency <em>%</em></span><input class="input mono" type="number" step="1" min="0" value="' + Math.round(num((c.metadata || {}).contingency, 0) * 100) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setMeta(\'contingency\',this.value)"></label>';
    h += '<label class="est-in est-in-wide"><span class="field-label">Document name</span><input class="input" value="' + esc(c.label || t.title) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setLabel(this.value)"></label>';
    h += '</div></div>';
    // sections
    h += '<div class="est-secs" id="estSecs">';
    (c.sections || []).forEach(function (s, si) {
      var hex = E.hexOf(s), col = !!S.collapsed[s.key];
      h += '<div class="est-sec' + (col ? ' collapsed' : '') + '" data-id="' + esc(s.key) + '" style="--svc:' + hex + '">';
      h += '<div class="est-sec-head">' + (ro ? '' : '<span class="s-drag" title="Drag to reorder">⋮⋮</span>') + '<span class="est-nn" style="color:' + hex + '">§' + String(si + 1).padStart(2, '0') + '</span>' +
        '<input class="input est-title" value="' + esc(s.title) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setSec(' + si + ',\'title\',this.value)">' +
        '<label class="est-chk" title="The whole section is an option"><input type="checkbox"' + (s.optional ? ' checked' : '') + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setSec(' + si + ',\'optional\',this.checked)"> option</label>' +
        '<span class="est-sec-tot mono" id="secTot' + si + '"></span>' +
        '<button class="btn btn-ghost btn-sm" onclick="EstimateApp.toggle(' + si + ')">' + (col ? '▸' : '▾') + '</button>' + (ro ? '' : '<button class="btn btn-ghost btn-sm" title="Remove section" onclick="EstimateApp.delSection(' + si + ')">✕</button>') + '</div>';
      if (!col) {
        h += '<table class="est-rows"><thead><tr>' + (ro ? '' : '<th></th>') + '<th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Sell ex VAT</th><th class="r">Inc. VAT</th><th class="c">Opt</th><th class="c">Allow.</th>' + (ro ? '' : '<th></th>') + '</tr></thead><tbody data-sec="' + si + '">';
        var gset = {}; (s.rows || []).forEach(function (r) { if (r.group) gset[r.group] = 1; }); var multi = Object.keys(gset).length > 1, prevG = null, ncol = ro ? 7 : 9;
        (s.rows || []).forEach(function (r, ri) {
          var L = r.model_id ? lib(r.model_id) : null, g = r.optional ? 'Options' : (r.group || 'Other');
          if (multi && g !== prevG) { h += '<tr class="est-grp"><td colspan="' + ncol + '">' + esc(g) + '</td></tr>'; prevG = g; }   // the WeQuote-style sub-group (same split as the PDF)
          h += '<tr data-id="' + si + ':' + ri + '"' + (r.optional ? ' class="opt"' : '') + '>' + (ro ? '' : '<td class="dr"><span class="s-drag">⋮⋮</span></td>') +
            '<td><input class="input" value="' + esc(r.label) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'label\',this.value)">' + (r.model_id ? '<span class="est-lib" title="Library ' + esc(r.model_id) + (L && L.wq ? ' · WeQuote ' + esc(L.wq.product_id) : '') + '">' + esc(r.model_id) + (L && L.wq ? ' <b class="wq-pill">WQ</b>' : '') + '</span>' : '') + (r.price_source ? '<span class="est-src">' + esc(r.price_source) + '</span>' : '') + '</td>' +
            '<td class="r"><input class="input mono num" type="number" step="any" value="' + esc(r.qty == null ? 1 : r.qty) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'qty\',this.value)"></td>' +
            '<td><input class="input unit" value="' + esc(r.unit || '') + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'unit\',this.value)"></td>' +
            '<td class="r"><input class="input mono num" type="number" step="any" value="' + esc(r.sell_ex == null ? '' : r.sell_ex) + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'sell_ex\',this.value)"></td>' +
            '<td class="r"><input class="input mono num inc" type="number" step="10" placeholder="' + E.rowInc(r, { contingency: num((c.metadata || {}).contingency, 0) }) + '" value="' + esc(r.inc == null ? '' : r.inc) + '" title="Leave blank to use sell ex VAT × 1.2 (+ contingency), rounded to £10"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'inc\',this.value)" id="inc' + si + '_' + ri + '"></td>' +
            '<td class="c"><input type="checkbox"' + (r.optional ? ' checked' : '') + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'optional\',this.checked)"></td>' +
            '<td class="c"><input type="checkbox"' + (r.allowance ? ' checked' : '') + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setRow(' + si + ',' + ri + ',\'allowance\',this.checked)"></td>' +
            (ro ? '' : '<td><button class="btn btn-ghost btn-sm" onclick="EstimateApp.delRow(' + si + ',' + ri + ')">✕</button></td>') + '</tr>';
        });
        h += '</tbody></table>' + (ro ? '' : '<button class="btn btn-ghost btn-sm est-add" onclick="EstimateApp.addRow(' + si + ')">+ Row</button>');
        h += '<input class="input est-note" placeholder="Note under the section (optional, client wording)" value="' + esc(s.note || '') + '"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setSec(' + si + ',\'note\',this.value)">';
      }
      h += '</div>';
    });
    h += '</div>';
    if (!ro) { h += '<div class="est-addsec"><span class="field-label">Add section</span>'; ((global.__SONOR_BRAND__ || {}).services || []).forEach(function (sv) { h += '<button class="btn btn-ghost btn-sm" style="--svc:' + sv.hex + '" onclick="EstimateApp.addSection(\'' + sv.nn + '\')"><i class="est-dot"></i>' + esc(sv.core || (sv.nn + ' ' + (sv.client || ''))) + '</button>'; }); h += '<button class="btn btn-ghost btn-sm" onclick="EstimateApp.addSection(null)"><i class="est-dot" style="background:#ad9978"></i>Joinery / fabric (gold)</button></div>'; }
    h += '<div class="card"><div class="card-header est-ptt">Basis <span class="muted">· one line each — client wording</span></div><textarea class="input est-basis"' + (ro ? ' disabled' : '') + ' onchange="EstimateApp.setBasis(this.value)">' + esc((c.basis || []).join('\n')) + '</textarea></div>';
    h += '</div><aside class="est-side"><div class="est-sticky">';
    h += '<div id="estCards"></div>';
    h += '<div class="card est-links"><div class="card-header est-ptt">Project</div>' + linksHtml() + '</div>';
    h += '<div class="card est-hist"><div class="card-header est-ptt">History</div>' + historyHtml() + '</div>';
    h += '</div></aside></div>';
    host.innerHTML = h;
    renderCards(); attachSort();
  }
  function renderRowInc(si, ri) { var r = S.cur.sections[si].rows[ri], el = $('#inc' + si + '_' + ri); if (el) el.placeholder = E.rowInc(r, { contingency: num((S.cur.metadata || {}).contingency, 0) }); }
  function renderCards() {
    var el = $('#estCards'); if (!el || !S.cur) return; var b = E.budget(estModel());
    var h = '<div class="est-cards"><div class="kpi"><div class="kpi-label">Core</div><div class="kpi-value">' + money(b.core_inc) + '</div><div class="kpi-sub">inc. VAT' + (b.contingency ? ' + ' + Math.round(b.contingency * 100) + '% contingency' : '') + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">With options</div><div class="kpi-value">' + money(b.with_options_inc) + '</div><div class="kpi-sub">' + (b.options_inc ? E.signed(b.options_inc) + ' options' : 'no options') + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Of which allowances</div><div class="kpi-value">' + money(b.allowance_inc) + '</div><div class="kpi-sub">priced before order</div></div></div>';
    h += '<div class="card est-bysys">' + b.sections.map(function (s, i) { return '<div class="est-sysrow" style="--svc:' + E.hexOf(s) + '"><i></i><span class="nn">§' + String(i + 1).padStart(2, '0') + '</span><span class="t">' + esc(s.title) + '</span><span class="v mono">' + (s.total != null ? money(s.total) : 'option') + (s.options_inc ? '<em>' + E.signed(s.options_inc) + '</em>' : '') + '</span></div>'; }).join('') + '</div>';
    el.innerHTML = h;
    (S.cur.sections || []).forEach(function (s, si) { var t = $('#secTot' + si), bs = b.sections.find(function (x) { return x.key === s.key; }); if (t) t.textContent = bs ? (bs.total != null ? money(bs.total) : '') + (bs.options_inc ? '  ' + E.signed(bs.options_inc) : '') : ''; });
  }
  // amber "changed since read" line per source — the Takeoffs "TAKEOFFS CHANGED" pattern (§48): flag, never auto-apply
  function staleHtml() {
    var c = S.cur; if (!c) return ''; var rd = (c.source || {}).read, st = E.staleSources(rd, nowStamps());
    if (!rd) return c.status === 'draft' ? '<div class="est-stale muted small">The sources this estimate read were not recorded (made before 1.1.0) — ' + (tpl().source === 'takeoff' ? 'Re-read from Takeoffs' : 'Re-read inputs') + ' to record them.</div>' : '';
    if (!st.length) return '<div class="est-stale small muted">In step with ' + Object.keys(rd).map(E.sourceLabel).join(', ') + ' · read ' + fmtAt((c.source || {}).read_at) + '</div>';
    var tk = tpl().source === 'takeoff', act = c.status === 'draft' ? (tk ? '' : '<button class="btn btn-sm" onclick="EstimateApp.' + (tk ? 'reseed' : 'rereadInputs') + '()">↻ ' + 'Re-read inputs</button>') : '<button class="btn btn-sm" onclick="EstimateApp.newRev()">New revision to pick it up</button>';
    return '<div class="est-stale">' + st.map(function (x) { return '<span class="chip chip-warn">' + esc(x.label.toUpperCase()) + ' CHANGED</span><span class="small muted">' + fmtAt(x.now_at) + (x.read_at ? ' · this estimate read ' + fmtAt(x.read_at) : ' · not read yet') + '</span>'; }).join('') + act + '</div>';
  }
  function historyHtml() {
    var c = S.cur || {}, L = ((c.metadata || {}).log || []).slice().reverse(), last = L[0];
    var h = '<div class="small">' + (last ? 'Last adjusted <b>' + fmtAt(last.at) + '</b>' + (last.by ? ' by ' + esc(last.by) : '') : 'Saved ' + fmtAt(c.updated_at)) + '</div>';
    if (L.length) h += '<ul class="est-log">' + L.slice(0, 8).map(function (e) { return '<li><span class="mono">' + fmtAt(e.at) + '</span> ' + esc(e.what) + (e.by ? ' <span class="muted">· ' + esc(e.by) + '</span>' : '') + '</li>'; }).join('') + '</ul>';
    if (L.length > 8) h += '<p class="small muted">' + (L.length - 8) + ' earlier · the full row history is in the Hub → Users → Activity</p>';
    return h;
  }
  function linksHtml() {
    var p = S.project || {}, L = (p.metadata && p.metadata.links) || {}, ests = (p.metadata && p.metadata.cost_estimates) || [], t = tpl(), h = '';
    h += '<div class="kv"><span class="k">Project</span><span>' + esc(p.ref || p.name || '') + '</span>';
    if (p.client_name) h += '<span class="k">Client</span><span>' + esc(p.client_name) + '</span>';
    h += '<span class="k">WeQuote</span><span>' + (L.wq_quote_no ? '#' + esc(L.wq_quote_no) : '<span class="muted">no quote yet</span>') + '</span>';
    h += '<span class="k">Estimates</span><span>' + (S.list.length ? S.list.map(function (e) { return 'R' + e.rev + ' ' + e.status; }).join(' · ') : '—') + '</span>';
    if (ests.length) h += '<span class="k">Cost records</span><span>' + ests.map(function (e) { return esc(e.id); }).join(' · ') + '</span>';
    // 1.1.0 — what this estimate reads from the project (Takeoffs + the design apps' summaries + the other estimates)
    var md = p.metadata || {}, ts = md.takeoff_summary, pts = ts && (ts.places || []).filter(function (x) { return x.kind === 'symbol'; }).length;
    var upd = function (k) { var a = E.sourceAt(md, k); return a ? ' <span class="muted">· ' + fmtAt(a) + '</span>' : ''; };
    h += '<span class="k">Takeoffs</span><span>' + (pts ? pts + ' points · ' + (ts.rooms || '—') + ' rooms · ' + (ts.floors || '—') + ' floors' + upd('takeoff_summary') : '<span class="muted">no plan yet</span>') + '</span>';
    if (md.cinema_design_summary && md.cinema_design_summary.room) { var r = md.cinema_design_summary.room; h += '<span class="k">Cinema Design</span><span>' + [r.w_mm, r.d_mm, r.h_mm].join(' × ') + ' mm' + upd('cinema_design_summary') + '</span>'; }
    var gs = md.garden_lighting_spec; if (gs && reads().indexOf('garden_lighting_spec') >= 0 && (gs.zones || []).length) { var nf = gs.zones.reduce(function (a, z) { return a + (z.fixtures || []).reduce(function (b, f) { return b + (+f.qty || 0); }, 0); }, 0); h += '<span class="k">Garden Lighting</span><span>' + gs.zones.length + ' zones · ' + nf + ' fittings' + upd('garden_lighting_spec') + '</span>'; }
    ['stretched_fabric_spec', 'led_spec'].forEach(function (k) { if (md[k] && reads().indexOf(k) >= 0) h += '<span class="k">' + esc(E.sourceLabel(k)) + '</span><span>published' + upd(k) + '</span>'; });
    if ((S.linked || []).length) h += '<span class="k">Room estimates</span><span>' + S.linked.map(function (e) { return esc(e.label || e.kind) + ' R' + e.rev + ' ' + e.status + ' <span class="muted">· ' + fmtAt(e.updated_at) + '</span>'; }).join('<br>') + '</span>';
    var es = md.estimates_summary && md.estimates_summary.by_kind; if (es) h += '<span class="k">On the project</span><span>' + Object.keys(es).map(function (k) { var x = es[k]; return esc(x.label || E.sourceLabel('estimate:' + k)) + ' R' + x.rev + ' ' + money(x.core_inc) + ' <span class="muted">· ' + fmtAt(x.updated_at) + '</span>'; }).join('<br>') + '</span>';
    h += '</div>';
    var prog = (t.progress || []).map(function (g) { var u = appUrl(g.app); return u ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'pid=' + encodeURIComponent(p.id) + (g.param === 'project' ? '&project=' + encodeURIComponent(p.id) : '') + (S.cur && S.cur.id ? '&estimate=' + S.cur.id : '')) + '">' + esc(g.label) + ' →</a>' : ''; }).join('');
    if (prog) h += '<div class="card-header est-ptt" style="margin-top:12px">Progress →</div><div class="est-prog">' + prog + '</div><p class="small muted">Opens the design app on this project; it reads this estimate\'s inputs through the project links.</p>';
    return h;
  }
  function renderActions() {
    var el = $('#estActions'); if (!el) return; var c = S.cur, t = tpl(), h = '';
    if (S.list.length) h += '<select class="select" onchange="EstimateApp.pickRev(this.value)">' + S.list.map(function (e) { return '<option value="' + e.id + '"' + (c && c.id === e.id ? ' selected' : '') + '>R' + e.rev + ' · ' + e.status + '</option>'; }).join('') + (c && !c.id ? '<option selected>R' + c.rev + ' · new</option>' : '') + '</select>';
    if (c) h += '<span class="chip chip-stage-' + (c.status === 'draft' ? 'draft' : c.status === 'sent' ? 'sent' : 'cancelled') + '">' + esc(c.status) + '</span>' + (S.dirty ? '<span class="chip chip-warn" id="estDirty">unsaved</span>' : '');   // drawn only when dirty (.chip's display beats [hidden])
    if (c && editable()) h += '<button class="btn btn-sm" onclick="EstimateApp.save()">Save</button><button class="btn btn-sm" onclick="EstimateApp.issue()">Issue R' + c.rev + '</button>';
    if (c && !editable()) h += '<button class="btn btn-sm" onclick="EstimateApp.newRev()">New revision</button>';
    if (c) h += '<button class="btn btn-primary btn-sm" onclick="EstimateApp.exportDialog()">Export PDF…</button>';
    var L = (S.project && S.project.metadata && S.project.metadata.links) || {};
    if (c && c.id) h += '<button class="btn btn-sm" ' + (L.wq_quote_id ? '' : 'disabled title="No WeQuote quote paired on this project yet (projects.metadata.links.wq_quote_id)"') + ' onclick="EstimateApp.pushWq()">Push to WeQuote</button>';
    if (!c && S.project) h += '<button class="btn btn-primary btn-sm" onclick="EstimateApp.newEstimate()">Start ' + esc((t.title || 'estimate').toLowerCase()) + '</button>';
    el.innerHTML = h;
  }
  function attachSort() {
    var SS = global.SonorSortable; if (!SS || !editable()) return;
    SS.attach($('#estSecs'), { item: '.est-sec', handle: '.est-sec-head .s-drag', key: function (el) { return el.dataset.id; }, onReorder: function (ch, order) { var by = {}; S.cur.sections.forEach(function (s) { by[s.key] = s; }); S.cur.sections = order.map(function (k) { return by[k]; }).filter(Boolean); mark(); render(); } });
    document.querySelectorAll('.est-rows tbody').forEach(function (tb) {
      var si = Number(tb.dataset.sec);
      SS.attach(tb, { item: 'tr[data-id]', handle: '.s-drag', key: function (el) { return el.dataset.id; }, onReorder: function (ch, order) { var rows = S.cur.sections[si].rows; S.cur.sections[si].rows = order.map(function (k) { return rows[Number(String(k).split(':')[1])]; }).filter(Boolean); mark(); render(); } });
    });
  }

  // ── export ──────────────────────────────────────────────────────────────────────────────────────
  function prefs() { try { return JSON.parse(localStorage.getItem(LS + '-pdf') || 'null') || {}; } catch (e) { return {}; } }
  function exportDialog() {
    var pf = Object.assign({ sections: ['cover', 'overview', 'products', 'budget', 'basis', 'rear'], paper: 'A3', orient: 'landscape' }, prefs(), (S.cur.metadata || {}).pdf || {});
    var fmt = pf.paper === 'A4' && pf.orient === 'portrait' ? 'A4-portrait' : 'A3-landscape';   // the two formats (Bryn 2026-11-09: "a4 portrait and a3 landscape will be the options … a3 default")
    var h = '<div class="modal-backdrop show" id="estModal" onclick="if(event.target===this)this.remove()"><div class="modal-card est-modal"><h3>Export ' + esc(S.cur.label || 'estimate') + '</h3><div class="modal-body">' +
      PDF_SECTIONS.map(function (s) { return '<label class="est-tick"><input type="checkbox" value="' + s[0] + '"' + (pf.sections.indexOf(s[0]) >= 0 ? ' checked' : '') + (s[0] === 'cover' ? ' disabled checked' : '') + '> ' + s[1] + '</label>'; }).join('') +
      '<div class="est-paper"><label><span class="field-label">Format</span><select class="select" id="estFormat"><option value="A3-landscape"' + (fmt === 'A3-landscape' ? ' selected' : '') + '>A3 landscape (default)</option><option value="A4-portrait"' + (fmt === 'A4-portrait' ? ' selected' : '') + '>A4 portrait</option></select></label></div>' +
      '<p class="small muted">Client document: no internal costs, no hosted links. Options show as the change they make.</p></div>' +
      '<div class="modal-actions"><button class="btn" onclick="document.getElementById(\'estModal\').remove()">Cancel</button><button class="btn btn-primary" onclick="EstimateApp.exportRun()">Export PDF</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
  }
  async function exportRun() {
    var md = $('#estModal'), secs = Array.prototype.slice.call(md.querySelectorAll('.est-tick input:checked')).map(function (i) { return i.value; });
    var pf = { sections: secs.indexOf('cover') < 0 ? ['cover'].concat(secs) : secs, paper: $('#estFormat').value === 'A4-portrait' ? 'A4' : 'A3', orient: $('#estFormat').value === 'A4-portrait' ? 'portrait' : 'landscape' };
    try { localStorage.setItem(LS + '-pdf', JSON.stringify(pf)); } catch (e) {}
    md.remove(); toast('Building the PDF…');
    try { await global.SonorEstimate.pdf.generate(pdfModel(pf)); } catch (e) { console.error(e); toast('PDF failed: ' + e.message, 'error'); return; }
    if (editable() && S.cur.id) { log('PDF exported · ' + (pf.paper === 'A4' ? 'A4 portrait' : 'A3 landscape')); await save(true, { noLog: true }); }
  }
  function pdfModel(pf) {
    var c = S.cur, p = S.project || {}, t = tpl(), b = E.budget(estModel()), title = (p.address || p.name || '').split('\n')[0].split(',')[0] || p.name || 'Your home';
    var rows = (t.inputs || []).filter(function (i) { return c.inputs[i.key] != null && i.kind !== 'bool' && c.inputs[i.key] !== 0; }).slice(0, 6).map(function (i) { return [i.label, c.inputs[i.key] + (i.unit ? ' ' + i.unit : '')]; });
    var ref = (String(p.ref || '').match(/^(\d{3,5}|ENQ-[A-Z0-9]+)/i) || [])[1] || ((p.metadata && p.metadata.lab && p.metadata.lab.key) || '');
    return Object.assign({ budget: b, doc: c.label || t.title, title: title, subtitle: 'Preliminary budget · R' + c.rev, client: p.client_name || '', project: (p.name || title), ref: [ref, 'R' + c.rev].filter(Boolean).join(' · '),
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), base: '../data/', coverUrl: '../data/estimate-cover.jpg',
      overview: { rowsHead: t.source === 'takeoff' ? 'THE HOUSE · FROM THE PLAN' : 'THE ROOM', intro: (t.overview || {}).intro || 'A first budget for your ' + (t.title || 'project').replace(/ estimate$/i, '').toLowerCase() + ', by system. The design and a measured quotation follow.', rows: rows, points: (t.overview || {}).points || [] },
      products: E.products(estModel(), lib), basisExtra: { included: t.included || [], excluded: t.excluded || [] },
      filename: 'sonor-' + A.kind + '-estimate-' + (ref || 'project').toLowerCase() + '-r' + c.rev + '.pdf' }, pf);
  }
  async function pushWq() {
    var c = S.cur, L = (S.project.metadata && S.project.metadata.links) || {}; if (!c || !c.id || !L.wq_quote_id) return;
    var CFG = global.__ESTIMATE_APP_CONFIG__ || {}, pid = CFG.wqSingleLineProduct || null;
    var plan = E.wqPlan(estModel(), { product_id: pid, ref: S.project.ref, name: S.project.name, quote: { id: L.wq_quote_id, no: L.wq_quote_no || null } });
    if (plan.unmapped.length) { toast('WeQuote needs a "supply & install per estimate" product before an estimate can be pushed (WQ-PRODUCTS-NEEDED #30) — set wqSingleLineProduct in the app config', 'warn'); return; }
    if (!global.SonorWqPush) { toast('WeQuote push module not loaded', 'error'); return; }
    if (!confirm('Push R' + c.rev + ' to WeQuote #' + (L.wq_quote_no || L.wq_quote_id) + '? One priced line per section, options as OPTIONAL lines.')) return;
    var out = await global.SonorWqPush.push(plan, { supa: client(), ref: S.project.ref, quoteId: L.wq_quote_id, slot: 'estimate-' + A.kind, onStatus: function (m) { toast(m); } });
    if (out && out.ok && c.status === 'draft') { c.metadata = Object.assign({}, c.metadata, { wq_push: { at: new Date().toISOString(), quote_id: L.wq_quote_id, lines: plan.totals.wqLines } }); log('Pushed to WeQuote #' + (L.wq_quote_no || L.wq_quote_id)); S.dirty = true; await save(true, { noLog: true }); }
  }
  function setLabel(v) { if (!editable()) return; S.cur.label = v; mark(); }

  function wire() {
    window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } });
    // back to this tab after working in Takeoffs / a design app → re-read the project record and flag what changed (never auto-apply)
    var lastPull = 0; window.addEventListener('focus', async function () { if (!S.project || !S.cur || Date.now() - lastPull < 20000) return; lastPull = Date.now(); await refreshProject(); await loadLinked();
      var a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; render(); });
  }

  global.EstimateApp = { VERSION: VERSION, state: S, boot: boot, selectProject: selectProject, newEstimate: newEstimate, reseed: reseed, save: save, issue: issue, newRev: newRev, pickRev: pickRev,
    setInput: setInput, setMeta: setMeta, setSec: setSec, setRow: setRow, addRow: addRow, delRow: delRow, addSection: addSection, delSection: delSection, toggle: toggle, setBasis: setBasis, setLabel: setLabel,
    rereadInputs: rereadInputs, publishSummary: publishSummary, exportDialog: exportDialog, exportRun: exportRun, pdfModel: pdfModel, pushWq: pushWq, render: render };
})(window);
