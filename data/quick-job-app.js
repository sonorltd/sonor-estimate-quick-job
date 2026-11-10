/* quick-job-app.js — APP - ESTIMATE - Quick Job UI (app-local, v0.1.0 · 2026-11-10)
   Small jobs in two minutes: pick one or more recipes (TV install, CCTV maintenance, add a camera …), answer 2–4 questions,
   check the WeQuote lines, then Create the WeQuote quote (or add to the quote already paired). Recipes are the 'quick-job'
   estimate_templates row (built-in copy: data/estimate-quick-job-config.js). Every line is a real WeQuote product; no price is
   sent (WeQuote is the price SSOT — its catalogue sell applies on add).

   Data: estimates (kind 'quick-job' — inputs.items[] = the picked recipes + answers, sections = one per item with its WeQuote
   lines, metadata.wq_push = the quote made) · RPC estimate_link on first save · reads projects, estimate_templates, wq_products
   (names). Push: SonorWqPush.push(plan, { createQuote }) → wq-push edge (create_quote on the first call), slot 'estimate-quick-job'. */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var KIND = 'quick-job';
  var S = { db: null, projects: [], project: null, list: [], cur: null, tpl: null, names: {}, dirty: false, busy: false };

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
  function toast(m, k) { if (global.SonorShell && global.SonorShell.toast) global.SonorShell.toast(m, { kind: k || 'info' }); else console.log('[quick-job]', m); }
  function client() { return S.db && S.db.client; }
  function who() { var u = global.__SONOR_USER__ || {}; return u.name || u.email || null; }
  function E() { return global.SonorEstimate; }
  function tpl() { return S.tpl || (global.__SONOR_ESTIMATE_TEMPLATES__ || {})[KIND] || { recipes: [], job: {} }; }
  function recipe(key) { return (tpl().recipes || []).find(function (r) { return r.key === key; }) || null; }
  function vcmp(a, b) { a = String(a || '0').split('.').map(Number); b = String(b || '0').split('.').map(Number); for (var i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; }
  function uid() { return 'qj' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function editable() { return !!S.cur && S.cur.status === 'draft'; }

  // ── recipe maths (pure — exposed for tests) ─────────────────────────────────────────────────────────────
  function defaults(questions) { var o = {}; (questions || []).forEach(function (q) { if (q.default != null) o[q.key] = q.default; }); return o; }
  // inputs for the expression engine: numbers as numbers, bools as 1/0, a choice as <key>_<value> = 1 (and every other option 0)
  function env(questions, answers) {
    var a = Object.assign(defaults(questions), answers || {}), o = {};
    (questions || []).forEach(function (q) {
      var v = a[q.key];
      if (q.type === 'choice') { (q.options || []).forEach(function (op) { o[q.key + '_' + op.value] = String(v) === String(op.value) ? 1 : 0; }); }
      else if (q.type === 'bool') o[q.key] = v ? 1 : 0;
      else o[q.key] = num(v, 0);
    });
    return o;
  }
  function ev(expr, inp, dflt) { if (expr == null || expr === '') return dflt; var v = E().evalQty(String(expr).replace(/!(?!=)/g, '1-'), inp); return v == null ? null : v; }
  function visible(q, inp) { return q.when == null || !!ev(q.when, inp, 1); }
  // lines for one block (recipe or job-wide) → [{wq_product_id, label, qty, check, bundle}]
  function linesOf(block, answers) {
    var inp = env(block.questions, answers), out = [];
    (block.lines || []).forEach(function (ln) {
      if (ln.when != null && !ev(ln.when, inp, 1)) return;
      var q = ev(ln.qty, inp, 1); if (q == null) { out.push({ wq_product_id: ln.wq_product_id, label: ln.label, qty: 0, error: 'qty "' + ln.qty + '" did not evaluate' }); return; }
      q = Math.max(0, Math.round(q * 100) / 100); if (!q) return;
      out.push({ wq_product_id: Number(ln.wq_product_id), label: ln.label || null, qty: q, check: ln.check || null, bundle: !!ln.bundle });
    });
    return out;
  }
  // merge same product inside one area (wq-push dedupes per area + product, so two rows would lose the second)
  function merge(lines) { var by = {}, out = []; lines.forEach(function (l) { var k = l.wq_product_id; if (by[k]) { by[k].qty += l.qty; return; } by[k] = Object.assign({}, l); out.push(by[k]); }); return out; }
  function sections(est, T) {
    T = T || tpl(); var inp = (est && est.inputs) || {}, out = [];
    (inp.items || []).forEach(function (it, i) {
      var r = (T.recipes || []).find(function (x) { return x.key === it.recipe; }); if (!r) return;
      out.push({ key: it.id, recipe: r.key, service_nn: r.service_nn || null, title: it.title || r.title, rows: merge(linesOf(r, it.answers)) });
    });
    if (T.job && (T.job.lines || []).length) { var jl = merge(linesOf(T.job, inp.job)); if (jl.length) out.push({ key: 'job', recipe: null, title: 'Travel', rows: jl }); }
    return out;
  }
  // wq-push plan: one group "Quick job", one area per item, lines quote-priced (no sell / cost sent)
  function plan(est, opts) {
    opts = opts || {}; var secs = sections(est, opts.tpl), rooms = [], flat = [], unmapped = [], bundles = [];
    secs.forEach(function (s, i) {
      var area = String(i + 1).padStart(2, '0') + ' ' + s.title, lines = [];
      s.rows.forEach(function (r) {
        if (!(r.wq_product_id > 0)) { unmapped.push({ kind: 'quick-job', label: r.label, qty: r.qty }); return; }
        var ln = { kind: 'device', product_id: r.wq_product_id, name: S.names[r.wq_product_id] || r.label || ('WeQuote product ' + r.wq_product_id), qty: r.qty, category_id: null, bundle: r.bundle || undefined };
        lines.push(ln); flat.push(Object.assign({ area: area }, ln)); if (r.bundle) bundles.push(ln.name);
      });
      if (lines.length) rooms.push({ name: area, code: s.key, archRef: '', items: [], lines: lines });
    });
    return { version: 'quick-job-1', mode: 'smart-home', modeAuto: false, generated: new Date().toISOString(),
      project: { ref: opts.ref || '', name: opts.name || '' }, quote: opts.quote || null,
      floors: [{ name: opts.group || 'Quick job', code: 'QJ', rooms: rooms, unassigned: [], unassignedLines: [] }], scaffold: [], lines: flat,
      derived: null, unmapped: unmapped, unmappedShades: [], bundles: bundles,
      totals: { lines: flat.length, wqLines: flat.length, mapped: flat.length, unmapped: unmapped.length, bundleLines: bundles.length, mode: 'lines' },
      estimate_id: (est && est.id) || null, rev: (est && est.rev) || 1, source: { app: 'estimate-quick-job', engine: 'quick-job-app ' + VERSION } };
  }

  // ── load ───────────────────────────────────────────────────────────────────────────────────────────────
  async function boot(shellReady) {
    wire();
    var res = await shellReady; S.db = res && res.db;
    if (!(res && res.supaReady)) { toast('Supabase not reachable — quick jobs need the database', 'warn'); render(); return; }
    var c = client();
    var r = await Promise.all([
      c.from('projects').select('id, ref, name, client_name, address, postcode, status, metadata, updated_at').order('updated_at', { ascending: false }).limit(1000),
      c.from('estimate_templates').select('kind, version, template, enabled').eq('kind', KIND).maybeSingle()
    ]);
    S.projects = (r[0] && r[0].data) || [];
    var bt = (global.__SONOR_ESTIMATE_TEMPLATES__ || {})[KIND], row = r[1] && r[1].data, dt = row && row.enabled !== false && row.template;
    if (dt && (dt.recipes || []).length && (!bt || vcmp(dt.version || row.version, bt.version) >= 0)) S.tpl = dt;
    S.tplSrc = S.tpl ? 'table v' + (S.tpl.version || row.version) : 'built-in v' + ((bt || {}).version || '?');
    await loadNames();
    var qs = new URLSearchParams(location.search), want = qs.get('project') || qs.get('pid');
    var PB = global.SonorProjectBar;
    if (PB && PB.init) {
      try {
        await PB.init({ supa: c, appKey: 'estimate-quick-job', host: $('#projectBarHost'), showNew: false,
          beforeChange: function () { return !S.dirty || confirm('Discard unsaved changes to this quick job?'); },
          onChange: function (d) { var id = d && d.currentId || null; if (S.project && S.project.id === id) return; selectProject(id); } });
      } catch (e) { console.warn('[quick-job] project bar', e); }
      if (!want && PB.getActiveId) want = PB.getActiveId();
    }
    await selectProject(want || null);
  }
  async function loadNames() {
    var ids = {}; var T = tpl(); (T.recipes || []).concat([T.job || {}]).forEach(function (r) { (r.lines || []).forEach(function (l) { if (l.wq_product_id) ids[l.wq_product_id] = 1; }); });
    var need = Object.keys(ids).map(Number); if (!need.length || !client()) return;
    var r = await client().from('wq_products').select('id, short_description, is_bundle, discontinued').in('id', need);
    S.missing = need.filter(function (id) { return !(r.data || []).some(function (x) { return Number(x.id) === id; }); });
    (r.data || []).forEach(function (x) { S.names[x.id] = x.short_description; if (x.discontinued) (S.disc = S.disc || {})[x.id] = 1; });
  }
  async function selectProject(id) {
    S.project = S.projects.find(function (p) { return p.id === id; }) || null; S.list = []; S.cur = null; S.dirty = false;
    var PB = global.SonorProjectBar; if (PB && PB.getActiveId && id && PB.getActiveId() !== id) PB.setActive(id);
    if (S.project) {
      var r = await client().from('estimates').select('*').eq('project_id', S.project.id).eq('kind', KIND).order('created_at', { ascending: false });
      if (r.error) toast(r.error.message, 'error');
      S.list = r.data || [];
      var wantEst = new URLSearchParams(location.search).get('estimate');
      S.cur = (wantEst && S.list.find(function (e) { return e.id === wantEst; })) || S.list.find(function (e) { return e.status === 'draft' && !((e.metadata || {}).wq_push); }) || null;
    }
    render();
  }

  // ── edits ──────────────────────────────────────────────────────────────────────────────────────────────
  function newJob() {
    if (!S.project) return;
    var rev = S.list.reduce(function (m, e) { return Math.max(m, num(e.rev, 0)); }, 0) + 1;   // estimates is UNIQUE (project, kind, rev): each quick job on a project is its own rev
    S.cur = { id: null, project_id: S.project.id, kind: KIND, rev: rev, status: 'draft', label: '', inputs: { items: [], job: defaults((tpl().job || {}).questions) }, sections: [], totals: {}, basis: [], flags: [], source: { template: tpl().version || null }, metadata: {} };
    S.dirty = false; render();
  }
  function addItem(key) {
    if (!S.project) { toast('Pick the client project first', 'warn'); return; }
    if (!S.cur || !editable()) newJob();
    var r = recipe(key); if (!r) return;
    S.cur.inputs.items.push({ id: uid(), recipe: key, answers: defaults(r.questions) }); mark(); render();
  }
  function delItem(id) { if (!editable()) return; S.cur.inputs.items = S.cur.inputs.items.filter(function (x) { return x.id !== id; }); mark(); render(); }
  function setAns(id, key, v) {
    if (!editable()) return;
    var tgt = id === 'job' ? (S.cur.inputs.job = S.cur.inputs.job || {}) : ((S.cur.inputs.items.find(function (x) { return x.id === id; }) || {}).answers);
    if (!tgt) return; tgt[key] = v; mark(); render();
  }
  function setMeta(k, v) { if (!editable()) return; if (k === 'label') S.cur.label = v; else S.cur.metadata = Object.assign({}, S.cur.metadata, (function () { var o = {}; o[k] = v; return o; })()); mark(); }
  function mark() { S.dirty = true; var b = $('#qjSave'); if (b) b.disabled = false; }
  function defaultTitle() { var n = (S.cur.inputs.items || []).map(function (it) { var r = recipe(it.recipe); return r ? r.title : it.recipe; }); var u = []; n.forEach(function (x) { if (u.indexOf(x) < 0) u.push(x); }); return u.join(' + ') || 'Quick job'; }
  function logEntry(what) { var md = S.cur.metadata || {}, L = (md.log || []).slice(-49); L.push({ at: new Date().toISOString(), what: what, by: who() }); S.cur.metadata = Object.assign({}, md, { log: L }); }

  async function save(silent) {
    if (!S.cur || !editable() || !client()) return null;
    if (!(S.cur.inputs.items || []).length) { toast('Add a job first', 'warn'); return null; }
    if (!S.cur.label) S.cur.label = defaultTitle();
    S.cur.sections = sections(S.cur); logEntry('Saved');
    var body = { project_id: S.cur.project_id, kind: KIND, rev: S.cur.rev || 1, status: 'draft', label: S.cur.label, inputs: S.cur.inputs, sections: S.cur.sections, totals: {}, basis: [], flags: S.cur.flags || [], source: Object.assign({}, S.cur.source, { template: tpl().version || null, tpl_src: S.tplSrc }), metadata: S.cur.metadata || {} };
    var c = client(), first = !S.cur.id;
    var r = first ? await c.from('estimates').insert(body).select('*').single() : await c.from('estimates').update(body).eq('id', S.cur.id).select('*').single();
    if (r.error) { toast('Save failed: ' + r.error.message, 'error'); return null; }
    S.cur = r.data; S.dirty = false;
    if (first) { try { await c.rpc('estimate_link', { p_id: S.cur.id }); } catch (e) { console.warn('[quick-job] estimate_link', e); } S.list.unshift(S.cur); }
    else S.list = S.list.map(function (e) { return e.id === S.cur.id ? S.cur : e; });
    if (!silent) toast('Saved', 'ok'); render(); return S.cur;
  }

  // ── WeQuote ────────────────────────────────────────────────────────────────────────────────────────────
  function customerId() { var m = (S.project && S.project.metadata) || {}; return Number((S.cur && S.cur.metadata && S.cur.metadata.wq_customer_id) || m.wequote_customer_id || (m.wequote || {}).customer_id) || null; }
  function pairedQuote() { var p = S.cur && S.cur.metadata && S.cur.metadata.wq_push; return p && p.quote_id ? p : null; }
  async function push(dry) {
    if (!S.cur || S.busy) return;
    if (!global.SonorWqPush) { toast('WeQuote push module not loaded', 'error'); return; }
    if (S.dirty || !S.cur.id) { if (!(await save(true))) return; }
    var pq = pairedQuote(), cid = customerId();
    if (!pq && !cid) { toast('No WeQuote customer on this project — enter the WeQuote customer id first', 'warn'); var el = $('#qjCust'); if (el) el.focus(); return; }
    var P = plan(S.cur, { ref: S.project.ref, name: S.project.name, quote: pq ? { id: pq.quote_id, no: pq.quote_no || null } : null });
    if (!P.lines.length) { toast('Nothing to push — every line came out at zero', 'warn'); return; }
    var msg = pq ? 'Add the missing lines to WeQuote quote #' + (pq.quote_no || pq.quote_id) + '?' : 'Create a new WeQuote quote "' + S.cur.label + '" for customer ' + cid + ' with ' + P.lines.length + ' lines?';
    if (P.bundles.length) msg += '\n\n⚠ ' + P.bundles.length + ' bundle line(s) arrive EMPTY in WeQuote and need opening there: ' + P.bundles.join(', ');
    if (!dry && !confirm(msg)) return;
    S.busy = true; render(); var logs = [];
    try {
      var out = await global.SonorWqPush.push(P, { supa: client(), ref: S.project.ref, dry: !!dry, quoteId: pq ? pq.quote_id : null, slot: (global.__ESTIMATE_APP_CONFIG__ || {}).slot || 'estimate-quick-job',
        createQuote: pq ? null : { customer_id: cid, description: S.cur.label, project_id: Number(((S.project.metadata || {}).wequote_internal_id)) || null },
        onLog: function (l) { logs = logs.concat(l); var b = $('#qjLog'); if (b) { b.hidden = false; b.textContent = logs.slice(-40).join('\n'); } }, onStatus: function (m) { toast(m); } });
      if (out && out.ok && !dry) {
        var res = out.result || {}, qid = Number(res.quote_id) || (pq && pq.quote_id), qno = res.quote_no || (pq && pq.quote_no) || null;
        S.cur.metadata = Object.assign({}, S.cur.metadata, { wq_push: { at: new Date().toISOString(), by: who(), quote_id: qid, quote_no: qno, lines: P.lines.length, created: !pq } });
        logEntry((pq ? 'Pushed to WeQuote #' : 'Created WeQuote quote #') + (qno || qid)); S.dirty = true; await save(true);
      }
    } finally { S.busy = false; render(); }
  }

  // ── render ─────────────────────────────────────────────────────────────────────────────────────────────
  function qInput(owner, q, a, inp) {
    if (!visible(q, inp)) return '';
    var v = a[q.key] != null ? a[q.key] : q.default, dis = editable() ? '' : ' disabled';
    var lab = '<span>' + esc(q.label) + (q.hint ? ' <em>' + esc(q.hint) + '</em>' : '') + '</span>';
    if (q.type === 'choice') return '<div class="est-in qj-q qj-q-wide">' + lab + '<div class="qj-seg" role="radiogroup">' + (q.options || []).map(function (op) {
      var on = String(v) === String(op.value);
      return '<button type="button" role="radio" aria-checked="' + on + '" class="qj-opt' + (on ? ' on' : '') + '"' + dis + ' data-ans="' + esc(owner) + '" data-key="' + esc(q.key) + '" data-val="' + esc(op.value) + '">' + esc(op.label) + '</button>'; }).join('') + '</div></div>';
    if (q.type === 'bool') return '<label class="est-in qj-q qj-bool">' + lab + '<input type="checkbox"' + (v ? ' checked' : '') + dis + ' data-ans="' + esc(owner) + '" data-key="' + esc(q.key) + '" data-bool="1"></label>';
    return '<div class="est-in qj-q">' + lab + '<div class="qj-step"><button type="button" class="btn btn-sm"' + dis + ' data-step="-1" data-ans="' + esc(owner) + '" data-key="' + esc(q.key) + '" data-min="' + (q.min != null ? q.min : 0) + '" data-max="' + (q.max != null ? q.max : 999) + '">−</button>' +
      '<input class="input mono" type="number" inputmode="numeric" value="' + esc(num(v)) + '"' + dis + ' min="' + (q.min != null ? q.min : 0) + '" max="' + (q.max != null ? q.max : 999) + '" data-ans="' + esc(owner) + '" data-key="' + esc(q.key) + '" data-num="1">' +
      '<button type="button" class="btn btn-sm"' + dis + ' data-step="1" data-ans="' + esc(owner) + '" data-key="' + esc(q.key) + '" data-min="' + (q.min != null ? q.min : 0) + '" data-max="' + (q.max != null ? q.max : 999) + '">+</button></div></div>';
  }
  function svcVar(nn) { var sv = (((global.__SONOR_BRAND__ || {}).services) || []).find(function (x) { return String(x.nn) === String(nn); }); return sv ? ' style="--svc:' + sv.hex + '"' : ''; }
  function lineRows(rows) {
    return rows.map(function (r) {
      var nm = S.names[r.wq_product_id], flags = '';
      if (!nm) flags += ' <span class="chip chip-warn" title="Not in the WeQuote product mirror — check the id">not found</span>';
      if (S.disc && S.disc[r.wq_product_id]) flags += ' <span class="chip chip-warn">discontinued</span>';
      if (r.bundle) flags += ' <span class="chip chip-warn" title="The WeQuote API adds a bundle empty — open the line in WeQuote">bundle</span>';
      if (r.check) flags += ' <span class="chip chip-warn" title="' + esc(r.check) + '">check</span>';
      if (r.error) flags += ' <span class="chip chip-warn">' + esc(r.error) + '</span>';
      return '<tr><td class="mono qj-qty">' + esc(r.qty) + '</td><td>' + esc(nm || r.label || '?') + flags + '</td><td class="mono muted">' + esc(r.wq_product_id) + '</td></tr>';
    }).join('');
  }
  function render() {
    var host = $('#qjMain'); if (!host) return;
    var T = tpl(), act = $('#qjActions');
    var cards = (T.recipes || []).map(function (r) { return '<button type="button" class="qj-recipe card"' + svcVar(r.service_nn) + ' data-add="' + esc(r.key) + '"' + (S.project ? '' : ' disabled') + '><span class="qj-ico" aria-hidden="true">' + esc(r.icon || '＋') + '</span><b>' + esc(r.title) + '</b><span class="muted small">' + esc(r.blurb || '') + '</span></button>'; }).join('');
    var left = '<div class="card"><div class="card-header est-ptt">Add a job <span class="muted">· recipes ' + esc(S.tplSrc || '') + '</span></div><div class="qj-recipes">' + cards + '</div></div>';
    if (!S.project) { host.innerHTML = '<div class="est-grid"><div class="est-left">' + left + '</div><div class="card empty-state"><p>Pick the client project in the bar above, then tap a job.</p></div></div>'; if (act) act.innerHTML = ''; return; }
    var body = '';
    if (!S.cur || !(S.cur.inputs.items || []).length && !S.cur.id) {
      body = '<div class="card empty-state"><p>Tap a job on the left to start a quick quote for <b>' + esc(S.project.name || S.project.ref) + '</b>.</p></div>';
    } else {
      var secs = sections(S.cur), byKey = {}; secs.forEach(function (s) { byKey[s.key] = s; });
      body += (S.cur.inputs.items || []).map(function (it) {
        var r = recipe(it.recipe) || { title: it.recipe, questions: [] }, inp = env(r.questions, it.answers), sx = byKey[it.id] || { rows: [] };
        return '<div class="est-sec"' + svcVar(r.service_nn) + '><div class="est-sec-head"><span class="qj-ico" aria-hidden="true">' + esc(r.icon || '') + '</span><b class="qj-title">' + esc(r.title) + '</b>' +
          (editable() ? '<button type="button" class="btn btn-sm btn-ghost" data-del="' + esc(it.id) + '" title="Remove this job">✕</button>' : '') + '</div>' +
          ((r.questions || []).length ? '<div class="est-in-grid qj-qs">' + r.questions.map(function (q) { return qInput(it.id, q, it.answers || {}, inp); }).join('') + '</div>' : '') +
          '<table class="qj-lines"><tbody>' + (lineRows(sx.rows) || '<tr><td colspan="3" class="muted">No lines with these answers</td></tr>') + '</tbody></table></div>';
      }).join('');
      var jq = (T.job || {}).questions || [], jinp = env(jq, S.cur.inputs.job), js = byKey.job;
      if (jq.length) body += '<div class="est-sec"><div class="est-sec-head"><b class="qj-title">Whole job</b></div><div class="est-in-grid qj-qs">' + jq.map(function (q) { return qInput('job', q, S.cur.inputs.job || {}, jinp); }).join('') + '</div>' + (js ? '<table class="qj-lines"><tbody>' + lineRows(js.rows) + '</tbody></table>' : '') + '</div>';
    }
    var side = '';
    if (S.cur && (S.cur.inputs.items || []).length) {
      var P = plan(S.cur), pq = pairedQuote(), cid = customerId(), checks = 0; sections(S.cur).forEach(function (s) { s.rows.forEach(function (r) { if (r.check) checks++; }); });
      side += '<div class="card"><div class="card-header est-ptt">WeQuote</div>' +
        '<label class="est-in"><span>Quote title</span><input class="input" id="qjTitle" value="' + esc(S.cur.label || '') + '" placeholder="' + esc(defaultTitle()) + '"' + (editable() ? '' : ' disabled') + '></label>' +
        '<label class="est-in"><span>WeQuote customer id <em>' + (((S.project.metadata || {}).wequote_customer_id) ? 'from the project' : 'not on the project yet') + '</em></span><input class="input mono" id="qjCust" inputmode="numeric" value="' + esc(cid || '') + '"' + (editable() && !pq ? '' : ' disabled') + '></label>' +
        '<label class="est-in"><span>Notes for the quote <em>internal</em></span><textarea class="input" id="qjNotes" rows="3"' + (editable() ? '' : ' disabled') + '>' + esc((S.cur.metadata || {}).notes || '') + '</textarea></label>' +
        '<p class="small muted">' + P.lines.length + ' WeQuote line' + (P.lines.length === 1 ? '' : 's') + ' · priced by WeQuote on add' + (checks ? ' · <b>' + checks + ' to check</b>' : '') + (P.bundles.length ? ' · ' + P.bundles.length + ' bundle' : '') + '</p>' +
        (pq ? '<p class="small">On WeQuote quote <b class="mono">#' + esc(pq.quote_no || pq.quote_id) + '</b> · ' + esc(new Date(pq.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</p>' : '') +
        '<div class="qj-btns"><button type="button" class="btn btn-primary" id="qjPush"' + (S.busy ? ' disabled' : '') + '>' + (pq ? 'Push again (adds missing lines)' : 'Create WeQuote quote') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="qjDry"' + (S.busy ? ' disabled' : '') + '>Dry run</button></div>' + (pq ? '<p class="qj-after">Push again adds lines that are missing. A changed quantity on a line already in WeQuote is edited in WeQuote.</p>' : '') + '<pre class="qj-log mono" id="qjLog" hidden></pre></div>';
    }
    var hist = S.list.length ? '<div class="card"><div class="card-header est-ptt">Quick jobs on this project</div><ul class="qj-hist">' + S.list.map(function (e) {
      var w = (e.metadata || {}).wq_push; return '<li><button type="button" class="btn btn-ghost btn-sm' + (S.cur && S.cur.id === e.id ? ' on' : '') + '" data-open="' + esc(e.id) + '">' + esc(e.label || 'Quick job') + '</button> <span class="muted small">' + (w ? 'WQ #' + esc(w.quote_no || w.quote_id) : 'draft') + ' · ' + esc(new Date(e.updated_at || e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + '</span></li>'; }).join('') + '</ul></div>' : '';
    host.innerHTML = '<div class="qj-grid"><div class="est-left">' + left + hist + '</div><div class="est-left">' + body + '</div><div class="est-left">' + side + '</div></div>';
    if (act) act.innerHTML = (S.cur ? '<button type="button" class="btn btn-sm" id="qjNew">＋ New quick job</button><button type="button" class="btn btn-sm btn-primary" id="qjSave"' + (S.dirty ? '' : ' disabled') + '>Save</button>' : '');
  }
  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t || t.disabled) return;
      if (t.dataset.add) return addItem(t.dataset.add);
      if (t.dataset.del) return delItem(t.dataset.del);
      if (t.dataset.open) { if (S.dirty && !confirm('Discard unsaved changes?')) return; S.cur = S.list.find(function (x) { return x.id === t.dataset.open; }) || null; S.dirty = false; return render(); }
      if (t.dataset.val != null && t.dataset.ans) return setAns(t.dataset.ans, t.dataset.key, t.dataset.val);
      if (t.dataset.step) { var it = t.dataset.ans === 'job' ? S.cur.inputs.job : (S.cur.inputs.items.find(function (x) { return x.id === t.dataset.ans; }) || {}).answers; if (!it) return;
        var r = t.dataset.ans === 'job' ? tpl().job : recipe((S.cur.inputs.items.find(function (x) { return x.id === t.dataset.ans; }) || {}).recipe), q = ((r || {}).questions || []).find(function (x) { return x.key === t.dataset.key; }) || {};
        var cur = num(it[t.dataset.key] != null ? it[t.dataset.key] : q.default, 0); return setAns(t.dataset.ans, t.dataset.key, Math.min(num(t.dataset.max, 999), Math.max(num(t.dataset.min, 0), cur + num(t.dataset.step)))); }
      if (t.id === 'qjSave') return save();
      if (t.id === 'qjNew') { if (S.dirty && !confirm('Discard unsaved changes?')) return; return newJob(); }
      if (t.id === 'qjPush') return push(false);
      if (t.id === 'qjDry') return push(true);
    });
    document.addEventListener('change', function (e) {
      var t = e.target; if (!t.dataset) return;
      if (t.dataset.num) return setAns(t.dataset.ans, t.dataset.key, num(t.value, 0));
      if (t.dataset.bool) return setAns(t.dataset.ans, t.dataset.key, !!t.checked);
      if (t.id === 'qjCust') return setMeta('wq_customer_id', Number(t.value) || null);
    });
    document.addEventListener('input', function (e) { var t = e.target; if (t.id === 'qjTitle') setMeta('label', t.value); if (t.id === 'qjNotes') setMeta('notes', t.value); });
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } });
    window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  global.QuickJobApp = { VERSION: VERSION, state: S, boot: boot, save: save, push: push, addItem: addItem, newJob: newJob, render: render,
    _test: { env: env, linesOf: linesOf, sections: sections, plan: plan, merge: merge } };
})(window);
