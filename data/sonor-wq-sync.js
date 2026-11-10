/**
 * sonor-wq-sync.js — CANONICAL MASTER (sonor-platform §24 — one WeQuote sync, every app)
 * v1.7.4 · 2026-10-17 — the wq-proxy fallback sends the project (anon) key (apikey + Bearer) so wq-proxy can be key-gated (EDGE_KEY_ENFORCE).
 * v1.7.3 · 2026-10-17 — MERGE-ONLY (projects.metadata law): every metadata write goes through the sonor_merge_project_metadata RPC
 *   (server-side `metadata || patch`), so a key another app wrote between our read and our write can no longer be dropped. The
 *   old read-then-replace only runs if the RPC call itself fails. Column patches (ref / client_* / address / value_quoted) are a
 *   separate column-only update.
 * v1.7.1 · 2026-10-15 — the `wq_quote_index` table now EXISTS (B-509 closed): the index is shared by every device and built once —
 *   before this every browser / node run rebuilt it in localStorage, one /quote/get per quote (~400 calls a time). Labour + programme
 *   fields (v1.7.0) now round-trip through the table too.
 * v1.7.0 · 2026-10-06 — compact() keeps labour_hours / labour_cost / labour_price + expected_start / expected_end per quote (B-512: the Board's
 *   '% of quoted labour' and a WeQuote fallback for the Target date come from here — no DDL, no extra pull).
 * v1.6.0 · 2026-10-02 — MIRROR: after reading a project's quotes the sync writes the live stage / revision / updated stamp back onto
 *   the matching wq_quote_links rows (PM / Takeoffs mirrors) so no app can show a stale stage. WeQuote is the truth for a quote's
 *   stage; a links row is a pointer to it. (28 Oldfield Road read "in progress" from a 30-Sep links row while WeQuote said sent.)
 * v1.5.1 · 2026-10-02 — adopt checks ownership against every project (closed ones too) + skips SONOR-internal WQ rows.
 * v1.5.0 · 2026-10-02 — ADOPT: every sync first adopts WeQuote projects that have no Sonor project yet (created, or with a quote
 *   touched, inside 180 days; test rows skipped) as `projects` rows — ref "<no> - <description>", status enquiry (the stage mirror
 *   moves it on), metadata.source 'wequote'; the in-WQ = lead trigger logs the enquiry. Bryn: "Fraser Morgan… MacFadyen is a recent
 *   not on there too — account for all this": the Board can only show what projects holds, so WeQuote feeds it.
 * v1.4.2 · 2026-10-02 — SAFETY: quick refresh needs a complete index (else builds it first) and a lookup miss never empties a
 *   project's quote list (a fresh browser's 3-page index wiped 10 projects' quotes on 2026-10-02 17:05 — repaired by a full sync).
 * v1.4.1 · 2026-10-02 — quick refresh also re-reads the WQ project row (name · customer · status · modified) — one call each.
 * v1.4.0 · 2026-10-02 — HISTORY: WeQuote exposes no events and hides superseded revisions, so the index KEEPS them — every stage
 *   change seen on a refresh is appended to the quote's history[] ({ on, from, to } / { on, rev }), a revision id that WeQuote
 *   stops serving is kept as superseded, and a project's quotes are grouped by number: the latest revision carries
 *   revisions[] (older ones we saw) + history[]. The Board shows all of it when a row is open.
 * v1.3.1 · 2026-10-02 — QUICK REFRESH: syncProjects(rows, { quick: true }) re-reads every known quote of every row given (stage
 *   changes land — cancelled / accepted / new revision) + the newest 3 list pages for new quotes, skipping the project / customer
 *   look-ups. The Board's plain ⟳ WQ is quick over the open projects; shift-click is the full force sync.
 * v1.7.2 · 2026-10-17 — a CUST- customer row (made by a service call or Tasks) takes the WeQuote ref when 🔗 linked, like ENQ-/SITE- (§31).
 * v1.3.0 · 2026-10-02 — LINKING: listProjects() (one /project/list_project per run), suggestProjects(row) (postcode · customer · name
 *   matches for a Sonor project with no WQ number yet, e.g. an ENQ- lead once the WQ project exists), linkProject(client, row, wqNo)
 *   (stamps wequote_id, renames an ENQ- / SITE- ref to "<no> - <WQ description>", syncs the row). Board 🔗 and Hub use it.
 * v1.2.0 · 2026-10-01 — QUOTE INDEX: every WQ quote fetched once (/quote/get) and kept by WQ project_id / customer_id in the
 *   `wq_quote_index` table (B-509) or this browser's localStorage; a project's quotes are then a lookup, not a name guess (1192
 *   Linkside etc. had quotes whose descriptions never mentioned the project). Incremental after the first build.
 * v1.1.0 · 2026-10-01 — quotes matched on the FRESH WQ project / customer names (+ one /quote/list walk per run, not 3 pages per
 *   project); stores wequote_created_at / wequote_modified_at / wequote_activity_at (+ per-quote created_at / updated_at / accepted_date)
 *   so the Board can rank by WeQuote activity (Active · 90+ · Completed). API: quotesFor(client, row, internalId, customerId, names?, run?)
 * v1.0.0 · 2026-10-01 — lifted verbatim from sonor-master/index.html v3.31.0 (syncWqProjectNames + _wqApiFetch family,
 * v3.16–v3.31) so the Board (⟳ WQ refresh) and the Hub (⟳ Sync WeQuote) run the SAME code. No DOM; the caller re-renders.
 *
 *   await SonorWqSync.syncProjects(client, rows, { force, onProgress(done, total, row) })  → number changed
 *     rows = projects rows (id, ref, name, client_*, address, postcode, value_quoted, metadata) — mutated in place on success
 *     A project whose ref starts with the WQ number ('1404 - TV Upgrades') is a WQ project even without metadata.wequote_id.
 *   SonorWqSync.wqNoOf(row) · apiFetch(client, path, params) · findProject(client, no) · findCustomer(client, name) · quotesFor(client, row, internalId, customerId)
 *
 * Credentials: wq_config (api_base, proxy_enabled, proxy_url) — anon SELECT; the browser never sees api_key (B-469), the
 * wq-proxy edge function resolves it. Classic script, no export. Synced to every app's data/ by sync-everything.sh.
 */
(function (global) {
  'use strict';
  var VERSION = '1.7.4';
  var _cfgCache = new Map();   // client → config | false
  async function getConfig(client) {
    if (_cfgCache.has(client)) return _cfgCache.get(client);
    var c = false;
    try { var r = await client.from('wq_config').select('api_base, proxy_enabled, proxy_url').limit(1).single(); c = (r.data && r.data.proxy_enabled && r.data.proxy_url) ? r.data : false; } catch (e) { c = false; }
    _cfgCache.set(client, c); return c;
  }
  async function apiFetch(client, path, params) {
    // v1.7.0 / §29 — ONE transport: when the shared SonorWQClient is on the page (it carries the pluggable transport — proxy today,
    // the WeQuote MCP connector tomorrow) every call goes through it; the direct proxy fetch below is only the fallback.
    if (global.SonorWQClient && typeof global.SonorWQClient.get === 'function') {
      try { await global.SonorWQClient.init(client); return await global.SonorWQClient.get(path, params || {}, { force: true }); } catch (e) { if (!/allowlist|not configured/.test(String(e && e.message))) return null; }
    }
    var cfg = await getConfig(client); if (!cfg) return null;
    try {
      var url; var headers = { 'Accept': 'application/json', 'X-Sonor-Source': 'wq-sync' };   // v1.7.1 — named for the per-source burst guard
      if (cfg.proxy_enabled && cfg.proxy_url) {
        url = new URL(cfg.proxy_url); url.searchParams.set('endpoint', path);
        // 2026-10-17 — send the project (anon) key the client already holds (apikey + Bearer, as send-email) so wq-proxy can be locked
        var k = ''; try { k = client.supabaseKey || (client.rest && client.rest.headers && client.rest.headers.apikey) || global.SONOR_SUPABASE_ANON || (global.__SONOR_BRAND__ && global.__SONOR_BRAND__.supabase && global.__SONOR_BRAND__.supabase.anonKey) || ''; } catch (_) {}
        if (k) { headers['apikey'] = k; headers['Authorization'] = 'Bearer ' + k; }
      }
      else { url = new URL((cfg.api_base || 'https://app.wequote.cloud/external').replace(/\/$/, '') + path); headers['Api-Key'] = cfg.api_key; }
      Object.entries(params || {}).forEach(function (kv) { url.searchParams.set(kv[0], kv[1]); });
      var r = await fetch(url.toString(), { headers });
      if (r.status === 429) { var b = null; try { b = await r.json(); } catch (_) {} var err = new Error('WeQuote call budget refused: ' + ((b && b.reason) || 'burst')); err.budget = true; throw err; }   // v1.7.1 — never read a refusal as data
      if (!r.ok) return null; return await r.json();
    } catch (e) { if (e && e.budget) throw e; return null; }
  }
  async function findProject(client, projectNo) { var j = await apiFetch(client, '/project/find_project', { project_no: projectNo }); return (Array.isArray(j) && j[0] && j[0].project_no) ? j[0] : null; }
  async function findCustomer(client, name) { if (!name) return null; var j = await apiFetch(client, '/customer/find', { name: name }); return (Array.isArray(j) && j[0] && j[0].name) ? j[0] : null; }
  var wqNoOf = function (r) { var m = r.metadata || {}; if (m.wequote_id) return String(m.wequote_id); var x = String(r.ref || '').match(/^(\d{3,5})\b/); return x ? x[1] : null; };
  // v1.1.0 — one walk of /quote/list per sync run (it is paged 10/page, newest first, no project filter — see WQ-QUOTE-FORMAT.md),
  // shared by every project in the run instead of 3 pages per project. Capped at 80 pages (800 quotes).
  async function listAllQuotes(client, run, maxPages) {
    if (run && run.quoteList) return run.quoteList;
    var all = []; maxPages = maxPages || 80;
    for (var page = 1; page <= maxPages; page++) {
      var rows = await apiFetch(client, '/quote/list', { page: page });
      if (!Array.isArray(rows) || !rows.length) break;
      all = all.concat(rows);
      if (rows.length < 10) break;
    }
    if (run) run.quoteList = all;
    return all;
  }
  var norm = function (s) { return String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ').trim(); };
  // candidates = quotes whose description / title mentions the WQ project name, the Sonor name, the customer or the WQ number;
  // each is verified with /quote/get (project_id = this WQ project, or customer_id = this customer). v1.0.0 only matched the
  // STALE row names (first sync: "Marian Horrocks" vs quote "TV Upgrades" → 0 quotes) — now the fresh WQ names are used too.
  function compact(q) {
    return { id: q.id, quote_no: q.quote_no, description: q.description, title: q.title, stage: q.stage, subtotal: q.subtotal, total: q.total, margin: q['total_margin_%'],
      quote_date: q.quote_date, expiry_date: q.expiry_date, accepted_date: q.accepted_date || null, created_at: q.created_datetime || null, updated_at: q.updated_datetime || null,
      project_id: q.project_id || null, customer_id: q.customer_id || null, revision: q.revision || null, is_latest: q.is_latest_revision !== false, archived: !!q.archived,
      subsystems: (q.subsystems || []).map(function (s) { return s.description; }),
      address: [q.address_line_1, q.address_line_2, q.address_line_3, q.posttown, q.county].filter(Boolean).join(', '), postcode: q.postcode || '',
      // v1.7.0 — the quote's own labour + programme (Bryn: "quoted labour hours … % used on the Board"; B-512): hours / cost / sell + WeQuote's expected dates
      labour_hours: q.labour_total_hours != null ? Number(q.labour_total_hours) : null, labour_cost: q.labour_total_cost != null ? Number(q.labour_total_cost) : null, labour_price: q.labour_total_price != null ? Number(q.labour_total_price) : null,
      expected_start: q.expected_start_date || null, expected_end: q.expected_completion_date || null };
  }
  // ── v1.2.0 QUOTE INDEX — every WeQuote quote, keyed by WQ project / customer, so "which quotes belong to project N" is a
  // lookup instead of a name guess (WQ's /quote/list has no project filter and carries only id / no / description). Lives in
  // the `wq_quote_index` table when it exists (B-509 — shared by every device) and otherwise in localStorage on this
  // browser (Hub + Board share it: same origin). Built once (one /quote/get per quote), then only NEW quote ids are fetched
  // and the quotes of the projects being synced are re-fetched so stage changes land.
  var IDX_KEY = 'sonor:wq-quote-index';
  async function loadIndex(client, run) {
    if (run && run.index) return run.index;
    var idx = { quotes: {}, built_at: null, store: 'local' };
    try {
      var r = await client.from('wq_quote_index').select('*');
      if (!r.error && Array.isArray(r.data)) {
        idx.store = 'table';
        r.data.forEach(function (row) { idx.quotes[row.quote_id] = { id: row.quote_id, quote_no: row.quote_no, description: row.description, title: row.title, stage: row.stage, subtotal: row.subtotal, total: row.total, margin: row.margin_pct,
          quote_date: row.quote_date, expiry_date: row.expiry_date, accepted_date: row.accepted_date, created_at: row.wq_created_at, updated_at: row.wq_updated_at, project_id: row.project_id, customer_id: row.customer_id,
          revision: row.revision, is_latest: row.is_latest !== false, archived: !!row.archived, subsystems: row.subsystems || [], address: row.address || '', postcode: row.postcode || '', history: row.history || [], superseded: !!row.superseded,
          labour_hours: row.labour_hours, labour_cost: row.labour_cost, labour_price: row.labour_price, expected_start: row.expected_start, expected_end: row.expected_end }; });
        idx.built_at = r.data.length ? 'table' : null;
      }
    } catch (e) { /* no table → local */ }
    if (idx.store === 'local') {
      try { var j = JSON.parse(localStorage.getItem(IDX_KEY) || 'null'); if (j && j.quotes) { idx.quotes = j.quotes; idx.built_at = j.built_at; } } catch (e) {}
    }
    if (run) run.index = idx;
    return idx;
  }
  async function saveIndex(client, idx, changedIds) {
    if (idx.store === 'table') {
      var rows = (changedIds || Object.keys(idx.quotes)).map(function (id) { var q = idx.quotes[id]; return q && { quote_id: q.id, quote_no: q.quote_no, project_id: q.project_id, customer_id: q.customer_id, stage: q.stage, description: q.description, title: q.title,
        revision: q.revision, is_latest: q.is_latest, archived: q.archived, quote_date: q.quote_date, expiry_date: q.expiry_date, accepted_date: q.accepted_date, subtotal: q.subtotal, total: q.total, margin_pct: q.margin,
        subsystems: q.subsystems, address: q.address, postcode: q.postcode, wq_created_at: wqIso(q.created_at), wq_updated_at: wqIso(q.updated_at), history: q.history || [], superseded: !!q.superseded,
        labour_hours: q.labour_hours ?? null, labour_cost: q.labour_cost ?? null, labour_price: q.labour_price ?? null, expected_start: q.expected_start || null, expected_end: q.expected_end || null, indexed_at: new Date().toISOString() }; }).filter(Boolean);
      for (var i = 0; i < rows.length; i += 200) { try { var ur = await client.from('wq_quote_index').upsert(rows.slice(i, i + 200), { onConflict: 'quote_id' }); if (ur && ur.error) console.warn('[wq-sync] index save failed:', ur.error.message); } catch (e) { console.warn('[wq-sync] index save failed:', e && e.message); } }   // v1.7.1 — never silent (a 400 hid the whole index for 2 weeks)
    } else {
      try { localStorage.setItem(IDX_KEY, JSON.stringify({ v: 1, built_at: idx.built_at || new Date().toISOString(), quotes: idx.quotes })); } catch (e) {}
    }
  }
  // fetch every quote id not yet indexed (+ the ids in refreshIds) — one /quote/get each
  async function updateIndex(client, run, refreshIds, onProgress) {
    run = run || {};
    var idx = await loadIndex(client, run);
    var list = await listAllQuotes(client, run, run.quick ? 3 : 80);
    var want = list.filter(function (q) { return !idx.quotes[q.id]; }).map(function (q) { return q.id; });
    (refreshIds || []).forEach(function (id) { if (want.indexOf(id) < 0 && idx.quotes[id]) want.push(id); });
    run.fetched = run.fetched || {}; want = want.filter(function (id) { return !run.fetched[id]; });   // once per run
    var changed = [];
    for (var i = 0; i < want.length; i++) {
      if (onProgress) try { onProgress(i + 1, want.length, { ref: 'WQ quote index', name: String(want[i]) }); } catch (_) {}
      var q = await apiFetch(client, '/quote/get', { id: want[i] });
      run.fetched[want[i]] = true;
      if (want.length > 60) await new Promise(function (res) { setTimeout(res, 1100); });   // v1.7.1 — pace a big build (~55/min) under the burst guard (120/min, 600/10 min per source)
      var prev = idx.quotes[want[i]];
      if (q && q.id) {
        var row = compact(q); row.history = (prev && prev.history) || [];
        if (prev && prev.stage && prev.stage !== row.stage) row.history = row.history.concat([{ on: wqIso(q.updated_datetime) || new Date().toISOString(), from: prev.stage, to: row.stage }]).slice(-20);
        if (prev && prev.revision && row.revision > prev.revision) row.history = row.history.concat([{ on: wqIso(q.created_datetime) || new Date().toISOString(), rev: row.revision }]).slice(-20);
        if (!prev && !row.history.length) row.history = [{ on: wqIso(q.created_datetime) || new Date().toISOString(), seen: row.stage, rev: row.revision }];
        idx.quotes[q.id] = row; changed.push(q.id);
      }
      if (changed.length && changed.length % 25 === 0) { idx.built_at = idx.built_at || new Date().toISOString(); await saveIndex(client, idx, changed.slice(-25)); }   // v1.7.1 — checkpoint: an interrupted build resumes, never restarts else if (prev && !prev.superseded && refreshIds && refreshIds.indexOf(want[i]) >= 0 && !(await apiFetch(client, '/quote/get', { id: want[i] }))) { prev.superseded = true; prev.superseded_at = new Date().toISOString(); changed.push(prev.id); }   // WeQuote stopped serving it = a newer revision replaced it
    }
    if (changed.length || !idx.built_at) { idx.built_at = idx.built_at || new Date().toISOString(); await saveIndex(client, idx, changed); }
    return idx;
  }
  var allByProject = function (idx, internalId) { return Object.keys(idx.quotes).map(function (k) { return idx.quotes[k]; }).filter(function (q) { return q.project_id === internalId; }); };
  // one row per quote NUMBER: the latest live revision, carrying the older revisions we saw (revisions[]) + the stage history
  var byProject = function (idx, internalId) {
    var groups = {};
    allByProject(idx, internalId).forEach(function (q) { var k = String(q.quote_no || q.id); (groups[k] = groups[k] || []).push(q); });
    return Object.keys(groups).map(function (k) {
      var rows = groups[k].slice().sort(function (a, b) { return (b.revision || 1) - (a.revision || 1) || (b.id - a.id); });
      var live = rows.filter(function (r) { return !r.superseded && r.is_latest !== false; });
      var head = Object.assign({}, live[0] || rows[0]);
      head.revisions = rows.filter(function (r) { return r.id !== head.id; }).map(function (r) { return { id: r.id, revision: r.revision || 1, stage: r.stage, quote_date: r.quote_date, created_at: r.created_at, updated_at: r.updated_at, subtotal: r.subtotal, superseded: !!r.superseded }; });
      head.history = rows.reduce(function (a, r) { return a.concat((r.history || []).map(function (h) { return Object.assign({ revision: r.revision || 1 }, h); })); }, []).sort(function (a, b) { return String(a.on) < String(b.on) ? -1 : 1; }).slice(-30);
      return head;
    });
  };
  // quotes for one project: the index by WQ project id (re-fetched so the stage is current); name-match on the list
  // only as a fallback for quotes filed under the customer without a project
  async function quotesFor(client, row, internalId, customerId, names, run) {
    run = run || {};
    try {
      var idx = await loadIndex(client, run);
      var mine = internalId ? byProject(idx, internalId) : [];
      if (mine.length) {
        await updateIndex(client, run, allByProject(idx, internalId).filter(function (q) { return !q.superseded; }).map(function (q) { return q.id; }));
        mine = byProject(idx, internalId);
      } else {
        var m = row.metadata || {};
        var keys = [].concat(names || [], [m.wequote_name, row.name, row.client_name, m.wequote_customer]).map(norm).filter(function (n) { return n && n.length >= 3; });
        var list = await listAllQuotes(client, run, run.quick ? 3 : 80);
        var cands = list.filter(function (q) { return !idx.quotes[q.id] && keys.some(function (n) { return norm((q.description || '') + ' ' + (q.quote_title || '')).indexOf(n) >= 0; }); }).slice(0, 8);
        for (var i = 0; i < cands.length; i++) { var q = await apiFetch(client, '/quote/get', { id: cands[i].id }); if (q && q.id) idx.quotes[q.id] = compact(q); }
        if (cands.length) await saveIndex(client, idx, cands.map(function (c) { return c.id; }));
        mine = internalId ? byProject(idx, internalId) : [];
        if (!mine.length && customerId) mine = Object.keys(idx.quotes).map(function (k) { return idx.quotes[k]; }).filter(function (q) { return q.customer_id === customerId && !q.project_id && q.is_latest !== false; });
      }
      return mine.sort(function (a, b) { return (Number(b.quote_no) || 0) - (Number(a.quote_no) || 0); });
    } catch (e) { return null; }
  }
  // WeQuote stamps are "YYYY-MM-DD HH:MM:SS" (UK) — normalise to ISO so every app compares them the same way
  var wqIso = function (v) { if (!v) return null; var d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); };
  // ── v1.3.0 linking ──
  async function listProjects(client, run) {
    if (run && run.projects) return run.projects;
    var j = await apiFetch(client, '/project/list_project', {});
    var list = Array.isArray(j) ? j : [];
    if (run) run.projects = list;
    return list;
  }
  var pcNorm = function (s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); };
  var words = function (s) { return norm(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && ['the','and','ltd','limited','mr','mrs','dr','house','road','lane','drive','court','avenue','street','new','build','project','electrical','home','smart','cinema','upgrade','upgrades','installation','room','enq'].indexOf(w) < 0; }); };
  // candidates for a Sonor row with no WQ number: scored by postcode (strong), customer/client name words, WQ description vs Sonor name/ref words
  async function suggestProjects(client, row, run, taken) {
    var list = await listProjects(client, run);
    taken = taken || {};
    var pc = pcNorm(row.postcode); var who = words([row.client_name, row.name, row.metadata && row.metadata.wequote_customer].join(' ')); var what = words([row.name, row.ref, row.address, row.notes].join(' '));
    var enq = (row.metadata && (row.metadata.enquiry_date || row.metadata.first_seen)) || row.created_at; var enqT = enq ? new Date(enq).getTime() : 0;
    return list.map(function (p) {
      var score = 0, why = [];
      // a WQ project no Sonor project owns yet, created around / after the enquiry, is the likeliest match of all
      var cT = p.created_datetime ? new Date(String(p.created_datetime).replace(' ', 'T')).getTime() : 0;
      if (!taken[String(p.project_no)]) { var dd = enqT && cT ? (cT - enqT) / 86400000 : null; if (dd != null && dd >= -3 && dd <= 45) { score += 40; why.push('unlinked, created ' + Math.round(dd) + 'd after the enquiry'); } else if (dd != null && dd > -45 && dd < 0) { score += 15; why.push('unlinked, created ' + Math.round(-dd) + 'd before the enquiry'); } }
      if (pc && pcNorm(p.postcode) === pc) { score += 60; why.push('postcode'); }
      var cw = words(p.customer_name); var hitC = cw.filter(function (w) { return who.indexOf(w) >= 0; });
      if (hitC.length) { score += 25 * hitC.length; why.push('customer ' + hitC.join(' ')); }
      var dw = words(p.description); var hitD = dw.filter(function (w) { return what.indexOf(w) >= 0; });
      if (hitD.length) { score += 10 * hitD.length; why.push('name ' + hitD.join(' ')); }
      if (taken[String(p.project_no)]) score -= 100;
      return { no: String(p.project_no), id: p.id, description: p.description, customer: p.customer_name, postcode: p.postcode, created: p.created_datetime, status: p.status, score: score, why: why.join(' · ') };
    }).filter(function (c) { return c.score > 0; }).sort(function (a, b) { return b.score - a.score || (b.created > a.created ? 1 : -1); }).slice(0, 6);
  }
  // v1.7.3 — merge-only write of projects.metadata: RPC first (atomic `metadata || patch` on the server); read-merge-write only as
  // the fallback when the RPC call fails. Returns the error (or null).
  async function mergeMeta(client, id, patch) {
    try { var rr = await client.rpc('sonor_merge_project_metadata', { p_project_id: id, p_patch: patch }); if (!rr.error) return null; } catch (e) {}
    var cur = await client.from('projects').select('metadata').eq('id', id).single();
    var cm = (cur.data && cur.data.metadata && typeof cur.data.metadata === 'object') ? cur.data.metadata : {};
    var u = await client.from('projects').update({ metadata: Object.assign({}, cm, patch) }).eq('id', id);
    return u.error || null;
  }
  // link a Sonor project to a WQ project number, then sync it (names, customer, quotes, activity)
  async function linkProject(client, row, wqNo, opts) {
    opts = opts || {};
    wqNo = String(wqNo || '').trim(); if (!/^\d{3,5}$/.test(wqNo)) throw new Error('WeQuote project number expected (e.g. 1407)');
    var p = await findProject(client, wqNo); if (!p) throw new Error('WeQuote has no project ' + wqNo);
    var fresh = await client.from('projects').select('metadata,updated_at').eq('id', row.id).single();
    var fm = (fresh.data && fresh.data.metadata) || {};
    var lpatch = { wequote_id: wqNo, wequote_internal_id: p.id, wequote_linked_at: new Date().toISOString(), wequote_linked_by: opts.by || 'board', wequote_touched_before: fm.wequote_touched_before || (fresh.data && fresh.data.updated_at) || null };
    var lerr = await mergeMeta(client, row.id, lpatch);   // v1.7.3 merge-only
    if (lerr) throw lerr;
    row.metadata = Object.assign({}, fm, lpatch);
    var n = await syncProjects(client, [row], { force: true, onProgress: opts.onProgress });
    return { project: p, changed: n };
  }
  // ── v1.5.0 adopt: WeQuote projects nobody in `projects` owns yet ──
  var TEST_RX = /\b(test|claude|dummy|sample|tst|sonor)\b/i;   // v1.5.1: + 'sonor' (internal WQ projects like 1375 World Cup)
  async function adoptProjects(client, rows, opts) {
    opts = opts || {}; var days = opts.sinceDays || 180; var run = opts.run || {};
    var owned = {}; (rows || []).forEach(function (r) { var n = wqNoOf(r); if (n) owned[String(n)] = true; });
    // v1.5.1 — ownership is checked against EVERY project, not the (possibly filtered) rows: a closed Sonor project that owns a
    // WQ number under a different ref (1343 → WQ 1363, title override by design) must not be adopted again
    try { var all = await client.from('projects').select('ref,metadata'); (all.data || []).forEach(function (r) { var n = wqNoOf(r); if (n) owned[String(n)] = true; }); } catch (e) {}
    var list = await listProjects(client, run); if (!list.length) return [];
    var idx = null; try { idx = await loadIndex(client, run); } catch (e) {}
    var lastQuoteTouch = {};
    if (idx) Object.keys(idx.quotes).forEach(function (k) { var q = idx.quotes[k]; if (!q.project_id) return; var t = wqIso(q.updated_at) || wqIso(q.created_at) || ''; if (t > (lastQuoteTouch[q.project_id] || '')) lastQuoteTouch[q.project_id] = t; });
    var cutoff = new Date(Date.now() - days * 86400000).toISOString();
    var adopted = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i]; var no = String(p.project_no || '').trim();
      if (!/^\d{3,5}$/.test(no) || owned[no]) continue;
      if (TEST_RX.test(p.customer_name || '') || TEST_RX.test(p.description || '')) continue;
      var created = wqIso(p.created_datetime) || '', modified = wqIso(p.modified_datetime) || '', qt = lastQuoteTouch[p.id] || '';
      var recent = created >= cutoff || modified >= cutoff || qt >= cutoff;
      if (!recent) continue;
      // double-check nothing owns it by ref prefix (rows may be a filtered list)
      try { var ex = await client.from('projects').select('id').ilike('ref', no + ' - %').limit(1); if (ex.data && ex.data.length) { owned[no] = true; continue; } } catch (e) {}
      var row = { ref: no + ' - ' + (p.description || 'WeQuote ' + no), name: p.description || ('WeQuote ' + no), client_name: p.customer_name || null, address: [p.address_line_1, p.address_line_2, p.address_line_3, p.posttown, p.county].filter(Boolean).join(', ') || null, postcode: p.postcode || null, status: 'enquiry',
        notes: 'Adopted from WeQuote ' + new Date().toISOString().slice(0, 10) + ' (project existed in WeQuote with no Sonor project — ' + (qt ? 'quote activity ' + qt.slice(0, 10) : 'created ' + created.slice(0, 10)) + ').',
        metadata: { source: 'wequote', created_by: 'wq-sync', wequote_id: no, wequote_internal_id: p.id, wequote_name: p.description || '', wequote_customer: p.customer_name || '', wequote_status: p.status || '', wequote_created_at: created || null, wequote_modified_at: modified || null, enquiry_date: (created || new Date().toISOString()).slice(0, 10), first_seen: created || null } };
      try { var ins = await client.from('projects').insert(row).select('id,ref,name,client_name,address,postcode,status,services,value_quoted,value_agreed,start_date,target_date,notes,metadata,created_at,updated_at').single(); if (ins.data) { adopted.push(ins.data); owned[no] = true; if (rows) rows.push(ins.data); } } catch (e) {}
    }
    return adopted;
  }
  // ── v1.6.0 mirror: live quote state → wq_quote_links (stage, revision, wq_updated_at, wq_description) ──
  async function mirrorLinks(client, row, qs) {
    if (!qs || !qs.length) return 0; var n = 0;
    try {
      var no = wqNoOf(row); var refs = [row.ref]; if (no) refs.push(no);
      var r = await client.from('wq_quote_links').select('id,project_ref,quote_id,quote_no,wq_stage,wq_revision,wq_updated_at').or('project_ref.eq.' + refs.map(function (x) { return String(x).replace(/,/g, ''); }).join(',project_ref.eq.'));
      var links = (r.data || []).filter(function (l) { return l.quote_id || l.quote_no; });
      for (var i = 0; i < links.length; i++) {
        var l = links[i]; var q = qs.find(function (x) { return (l.quote_id && Number(x.id) === Number(l.quote_id)) || (l.quote_no && String(x.quote_no) === String(l.quote_no)); });
        if (!q) continue;
        var upd = wqIso(q.updated_at);
        if (l.wq_stage === q.stage && (l.wq_revision || null) === (q.revision || null) && (l.wq_updated_at ? wqIso(l.wq_updated_at) : null) === upd) continue;
        var u = await client.from('wq_quote_links').update({ wq_stage: q.stage, wq_revision: q.revision || null, wq_updated_at: upd, wq_description: q.description || null, stage_changed_at: l.wq_stage !== q.stage ? new Date().toISOString() : undefined }).eq('id', l.id);
        if (!u.error) n++;
      }
    } catch (e) {}
    return n;
  }
  async function syncProjects(client, rows, opts) {
    opts = opts || {}; var force = !!opts.force; var quick = !!opts.quick && !force;
    var staleBefore = Date.now() - 7 * 24 * 3600e3;
    var targets = (rows || []).filter(function (r) { var m = r.metadata || {}; if (!wqNoOf(r)) return false; if (quick) return !!m.wequote_internal_id; if (force || !m.wequote_name || !m.wequote_id || !m.wequote_activity_at) return true;   /* v1.1.0: no activity stamp yet → pull once */ return !(m.wequote_synced_at && new Date(m.wequote_synced_at).getTime() > staleBefore); });
    var run = { quick: quick };
    var changed = 0, done = 0;
    // v1.4.2 — a quick refresh is only quick when the index is COMPLETE on this browser; a fresh browser (empty localStorage)
    // builds the whole index first, otherwise projects whose quotes sit outside the newest pages would read as "no quotes"
    if (quick) { try { var idx0 = await loadIndex(client, run); if (!idx0.built_at || Object.keys(idx0.quotes).length < 100) run.quick = false; } catch (e) { run.quick = false; } }
    try { await updateIndex(client, run, null, opts.onProgress); } catch (e) {}
    // v1.5.0 — adopt WeQuote projects nobody owns (after the index, so "a quote touched lately" counts), then sync them in this run
    var adopted = []; try { adopted = await adoptProjects(client, rows, { run: run, sinceDays: opts.sinceDays }); } catch (e) { adopted = []; }
    if (adopted.length) { targets = targets.concat(adopted); if (opts.onAdopted) try { opts.onAdopted(adopted); } catch (_) {} }   // v1.2.0 quote index (new quotes only after the first build)
    for (var ti = 0; ti < targets.length; ti++) {
      var r = targets[ti]; done++; if (opts.onProgress) try { opts.onProgress(done, targets.length, r); } catch (_) {}
      var wqNo = wqNoOf(r);
      if (quick) {   // v1.3.1 — quotes only: re-read the ones we know, pick up new ones; names / customer stay as stored
        var qm = r.metadata || {};
        var qp = await findProject(client, wqNo);   // v1.4.1 — the project row too (name · customer · status · modified): one cheap call
        var qq = await quotesFor(client, r, Number(qm.wequote_internal_id), Number(qm.wequote_customer_id) || null, [qp && qp.description, qp && qp.customer_name, qm.wequote_name, qm.wequote_customer], run);
        if (!qq) continue;
        if (!qq.length && (qm.wequote_quotes || []).length) continue;   // never wipe a quote list on a lookup miss
        try { await mirrorLinks(client, r, qq); } catch (e) {}
        var qpatch = { wequote_quotes: qq, wequote_quotes_synced_at: new Date().toISOString(), wequote_synced_at: new Date().toISOString() };
        if (qp) Object.assign(qpatch, { wequote_name: qp.description || qm.wequote_name || '', wequote_customer: qp.customer_name || qm.wequote_customer || '', wequote_status: qp.status || '', wequote_modified_at: wqIso(qp.modified_datetime) || qm.wequote_modified_at || null });
        var qact = [qm.wequote_modified_at].concat(qq.map(function (q) { return wqIso(q.updated_at) || wqIso(q.quote_date); })).filter(Boolean).sort();
        if (qact.length) qpatch.wequote_activity_at = qact[qact.length - 1];
        try {
          var qfresh = await client.from('projects').select('metadata,updated_at').eq('id', r.id).single();
          var qfm = (qfresh.data && qfresh.data.metadata) || {};
          var before = JSON.stringify([qfm.wequote_quotes || null, qfm.wequote_name, qfm.wequote_customer, qfm.wequote_status]), after = JSON.stringify([qq, qpatch.wequote_name || qfm.wequote_name, qpatch.wequote_customer || qfm.wequote_customer, qpatch.wequote_status || qfm.wequote_status]);
          if (before === after) continue;   // nothing moved — no write, no updated_at bump
          var qprev = qfm.wequote_synced_at && qfresh.data.updated_at && Math.abs(new Date(qfresh.data.updated_at) - new Date(qfm.wequote_synced_at)) < 120000;
          qpatch.wequote_touched_before = (qprev && qfm.wequote_touched_before) ? qfm.wequote_touched_before : (qfresh.data && qfresh.data.updated_at) || new Date().toISOString();
          if (await mergeMeta(client, r.id, qpatch)) continue;   // v1.7.3 merge-only
          r.metadata = Object.assign({}, r.metadata, qpatch); changed++;
        } catch (e) {}
        continue;
      }
      var p = await findProject(client, wqNo); if (!p) continue;
      r.metadata = r.metadata || {}; if (!r.metadata.wequote_id) r.metadata.wequote_id = wqNo;
      var patch = { wequote_id: wqNo, wequote_name: p.description || '', wequote_customer: p.customer_name || '', wequote_status: p.status || '', wequote_internal_id: p.id, wequote_synced_at: new Date().toISOString(),
        wequote_created_at: wqIso(p.created_datetime), wequote_modified_at: wqIso(p.modified_datetime) };   // v1.1.0 — WQ activity (Board 90+ rule)
      var cust = await findCustomer(client, p.customer_name); var colPatch = {};
      if (cust) {
        var addr = [cust.address_line_1, cust.address_line_2, cust.address_line_3, cust.posttown, cust.county].filter(Boolean).join(', ');
        patch.wequote_customer_id = cust.id; if (addr) patch.wequote_address = addr; if (cust.postcode) patch.wequote_postcode = cust.postcode; if (cust.phone_number) patch.wequote_phone = cust.phone_number; if (cust.email_address) patch.wequote_email = cust.email_address;
        if (!r.client_name && cust.name) colPatch.client_name = cust.name; if (!r.client_email && cust.email_address) colPatch.client_email = cust.email_address; if (!r.client_phone && cust.phone_number) colPatch.client_phone = cust.phone_number; if (!r.address && addr) colPatch.address = addr; if (!r.postcode && cust.postcode) colPatch.postcode = cust.postcode;
      }
      var qs = await quotesFor(client, r, patch.wequote_internal_id, patch.wequote_customer_id, [p.description, p.customer_name], run);
      if (qs && !qs.length && (r.metadata.wequote_quotes || []).length) qs = null;   // v1.4.2 — a miss keeps what we had
      if (qs && qs.length) { try { await mirrorLinks(client, r, qs); } catch (e) {} }
      if (qs && qs.length) {
        patch.wequote_quotes = qs; patch.wequote_quotes_synced_at = new Date().toISOString();
        var act = [patch.wequote_modified_at].concat(qs.map(function (q) { return wqIso(q.updated_at) || wqIso(q.quote_date); })).filter(Boolean).sort();
        if (act.length) patch.wequote_activity_at = act[act.length - 1];
        if (r.value_quoted == null && qs[0].subtotal != null) colPatch.value_quoted = qs[0].subtotal;
        if (qs[0].address) { patch.wequote_address = qs[0].address; if (qs[0].postcode) patch.wequote_postcode = qs[0].postcode; if (!r.address) colPatch.address = qs[0].address; if (!r.postcode && qs[0].postcode) colPatch.postcode = qs[0].postcode; }
      } else if (patch.wequote_modified_at) { patch.wequote_activity_at = patch.wequote_modified_at; }
      if (/^(SITE-|ENQ\b|ENQ-|CUST\b|CUST-)/.test(String(r.ref || '')) && r.metadata.wequote_id) colPatch.ref = r.metadata.wequote_id + ' - ' + (patch.wequote_name || r.name || '');   // v1.3.0: ENQ- leads take the WQ ref once linked · v1.7.2: CUST- customer rows (service calls / Tasks) too
      try {
        var fresh = await client.from('projects').select('metadata,updated_at').eq('id', r.id).single();
        var fm = (fresh.data && fresh.data.metadata) || {};
        // a sync is NOT a human touch: remember the updated_at we are about to bump (SonorBoardLog.touchedAt reads it back —
        // §22). If updated_at is still our own previous sync stamp, keep the older human date.
        var prevSync = fm.wequote_synced_at && fresh.data.updated_at && Math.abs(new Date(fresh.data.updated_at) - new Date(fm.wequote_synced_at)) < 120000;
        patch.wequote_touched_before = (prevSync && fm.wequote_touched_before) ? fm.wequote_touched_before : (fresh.data && fresh.data.updated_at) || new Date().toISOString();
        if (await mergeMeta(client, r.id, patch)) continue;   // v1.7.3 merge-only
        if (Object.keys(colPatch).length) { var cu = await client.from('projects').update(colPatch).eq('id', r.id); if (cu.error) continue; }
        r.metadata = Object.assign({}, r.metadata, patch); Object.assign(r, colPatch); changed++;
      } catch (e) { /* keep cached */ }
    }
    return changed;
  }
  global.SonorWqSync = { VERSION: VERSION, getConfig: getConfig, apiFetch: apiFetch, findProject: findProject, findCustomer: findCustomer, quotesFor: quotesFor, listAllQuotes: listAllQuotes, listProjects: listProjects, suggestProjects: suggestProjects, linkProject: linkProject, adoptProjects: adoptProjects, mirrorLinks: mirrorLinks, loadIndex: loadIndex, updateIndex: updateIndex, saveIndex: saveIndex, byProject: byProject, wqIso: wqIso, wqNoOf: wqNoOf, syncProjects: syncProjects };
})(typeof window !== 'undefined' ? window : this);
