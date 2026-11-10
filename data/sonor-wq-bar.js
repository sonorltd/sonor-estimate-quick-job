// sonor-wq-bar.js — CANONICAL MASTER (root; synced to every app's data/ by sync-everything.sh)
//
// ONE WeQuote status control for every project-aware Sonor app (B-470, 2026-09-28).
//   🧾 WeQuote ▾  #2799 r1 · in progress · 🔒
// Reads `v_project_quote` (the project's primary quote), `wq_quote_links` (every quote on the project) and `wq_events`
// (what WeQuote told us lately) for the active project — anon SELECT only, nothing here can write to WeQuote — and
// keeps itself LIVE through Supabase realtime on wq_quote_links / wq_events (fed by the wq-webhook edge function).
//
// Loading:
//   <script src="data/sonor-wq-bar.js"></script>        ← after supabase-js (and after sonor-project-bar.js if used)
//   SonorWqBar.init({ supa: db });                       // auto-mounts into the shared SonorProjectBar meta strip and
//                                                        // follows `sonor:project-changed`
//   SonorWqBar.init({ supa: db, host: el, ref: () => currentRef, actions: [                 // custom host (Takeoffs)
//     { id: 'btnWqPush', label: '🧾 Push plan…', disabled: () => !ready, onClick: fn }, { id: 'btnHeadEnd', label: '⚙ Head end…', onClick: fn } ] });
//   SonorWqBar.refresh(); SonorWqBar.setRef('1403 - 28 Oldfield Road'); SonorWqBar.state() → { primary, quotes, events }
//
// Version: 1.4.2 — £ PRICE DRIFT (B-476 follow-up): reconcile.price_drift from the nightly (list price moved since the quote
//                  was built / unpriced lines) → £ n on the pill + rows in the Spec check section.
// Version: 1.4.1 — ⚙ ENGINEERING note (B-472 phase 2): Engineering's cloud save writes wq_quote_links(takeoffs-push).metadata.engineering
//                  → "⚙ Engineering rev B (#3) · 12 devices · 4 min ago" in the quote card, live (realtime on wq_quote_links).
// Version: 1.4.0 — CLIENT LINKS (B-483 follow-up): every private client_docs link on the project (title, quote, issued,
//                  views, last viewed) with copy / open / revoke — revoke = client_docs.revoked_at (anon update policy), the
//                  `doc` edge fn then answers 410. Live via realtime on client_docs. Re-issue = Takeoffs › 📄 Scope of works.
// Version: 1.3.0 — 📄 Scope of works: opens the latest filed brief (v_project_quote.scope_pdf → signed URL from the private
//                  project-docs bucket, B-482) from the quote card.
// Version: 1.2.1 — nightly spec_check events (B-476) rendered in "Recent from WeQuote".
// Version: 1.2.0 — Lucide icons via root sonor-icons.js (B-478) with emoji fallback when it is not on the page; loads it
//                  from beside its own script when absent (same zero-touch pattern as the project bar).
// Version: 1.1.0 — SPEC CHECK flag (B-481): v_project_quote.spec_issues (Takeoffs' quote-vs-takeoff checksum saved in
//                  wq_quote_links.metadata.reconcile) → ⚠ n on the pill + a "Spec check" section (missing / qty / extra).
// Version: 1.0.0 — first cut. Project matched by its leading number (projects.ref "1403 - …" ↔ wq_quote_links.project_ref
//                  "1403" or "1403 - …"). Stage chips: in_progress / sent / accepted / complete / cancelled; 🔒 when the
//                  link is locked (B-466). Menu: primary quote card (description, revision, stage, updated, locked reason,
//                  Open in WeQuote), every other quote on the project (slot + stage, each opens in WeQuote), recent events,
//                  app actions, ↻. Dark (project bar) and light (Takeoffs header) via CSS vars — no cream anywhere.
(function (global) {
  'use strict';
  var VERSION = '1.5.1';   // 1.5.0 (2026-10-13) WeQuote API call budget readout (wq_api_usage) in the menu foot · 1.4.6 // 2026-10-02 §26 stage law: chips on the status tokens (amber ours · blue client · green yes · red no)
  var WQ_QUOTE_URL = 'https://app.wequote.cloud/sonor-ltd/quote/';   // + <id>/editor
  var LOCK_STAGES = { sent: 1, accepted: 1, complete: 1 };
  var STAGE_LABEL = { in_progress: 'in progress', sent: 'sent', accepted: 'accepted', complete: 'complete', cancelled: 'cancelled', declined: 'declined', draft: 'draft' };

  var _OWN_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  function _ico(name, fallback, o) { var I = global.SonorIcons; return (I && I.has(name)) ? I.svg(name, o) : fallback; }
  function _loadIcons(then) {
    if (global.SonorIcons || !_OWN_SRC || document.getElementById('sonor-icons-script')) { if (then) then(); return; }
    var sc = document.createElement('script'); sc.id = 'sonor-icons-script'; sc.src = _OWN_SRC.replace(/sonor-wq-bar\.js(\?.*)?$/, 'sonor-icons.js'); sc.async = true; sc.onload = function () { if (then) then(); }; sc.onerror = function () {}; document.head.appendChild(sc);
  }
  var _supa = null, _host = null, _refFn = null, _actions = [], _autoHost = false, _appKey = '';
  var _state = { ref: null, refNo: null, primary: null, quotes: [], events: [], docs: [], loadedAt: 0, error: null };
  var DOC_URL = 'https://ysmvklstkzodlocttspy.supabase.co/functions/v1/doc/';   // + <token> (→ branded landing), + /pdf
  var _armed = null;   // client_docs id whose Revoke button is awaiting its second click
  var _open = false, _channel = null, _timer = null, _observer = null;

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function _refNo(ref) { var m = String(ref || '').match(/^\s*(\d{3,}|DEMO)\b/); return m ? m[1] : null; }   // 1.5.1: the Demo project (ref 'DEMO - …') has a sample quote too
  function _ago(iso) { if (!iso) return ''; var d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.round(d / 60) + ' min ago'; if (d < 86400) return Math.round(d / 3600) + ' h ago'; return Math.round(d / 86400) + ' d ago'; }
  function _stageCls(st) { return 'swq-stage swq-stage-' + String(st || 'none').replace(/[^a-z]/g, '-'); }
  function _gbp(v) { var n = Number(v); return isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v); }
  function _drift(q) { var rc = q && q.reconcile; return (rc && Array.isArray(rc.price_drift)) ? rc.price_drift : []; }
  function _locked(q) { return !!(q && (q.locked_at || LOCK_STAGES[String(q.wq_stage || '').toLowerCase()])); }

  function _css() {
    if (document.getElementById('sonor-wq-bar-styles')) return;
    var css = [
      '.sonor-wq-bar{position:relative;display:inline-flex;align-items:center;gap:6px;font:12px/1.3 "DM Mono",SF Mono,Menlo,monospace;color:inherit}',
      '.sonor-wq-bar .swq-btn{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:999px;border:1px solid var(--swq-border,var(--border,rgba(148,163,184,.45)));background:var(--swq-bg,var(--card,rgba(255,255,255,.06)));color:inherit;cursor:pointer;white-space:nowrap;font:inherit;font-weight:600}',
      '.sonor-wq-bar .swq-btn:hover{border-color:var(--border-strong,rgba(244,241,236,.35))}',   // 1.4.6: neutral hover, no service purple on chrome
      '.sonor-wq-bar .swq-btn .swq-caret{opacity:.6;font-size:10px;display:inline-flex}.sonor-wq-bar .swq-lbl{display:inline-flex;align-items:center;gap:5px}.sonor-wq-bar .swq-warn .s-icon,.sonor-wq-bar .swq-pill .s-icon{vertical-align:-0.1em}',
      '.sonor-wq-bar .swq-pill{display:inline-flex;align-items:center;gap:5px;font-weight:600}',
      '.sonor-wq-bar .swq-pill.swq-none{opacity:.55;font-weight:500}',
      '.swq-stage{display:inline-block;padding:0 7px;border-radius:9px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:16px;color:#fff;background:#64748B}',
      '.swq-stage-in-progress,.swq-stage-draft{background:var(--status-amber,#E0922F)}.swq-stage-sent{background:var(--info,#3B9DD8)}.swq-stage-accepted,.swq-stage-complete{background:var(--status-ok,#3DB56F)}.swq-stage-cancelled,.swq-stage-declined{background:var(--status-bad,#E2524F)}',
      '.sonor-wq-bar .swq-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:120;min-width:320px;max-width:440px;padding:8px;border-radius:8px;background:var(--card,#fff);color:var(--text,#0F172A);border:1px solid var(--border,#CBD5E1);box-shadow:0 12px 32px rgba(15,23,42,.22);font:12px/1.4 "DM Sans",system-ui,sans-serif;display:none;flex-direction:column;gap:6px}',
      '.sonor-wq-bar.open .swq-menu{display:flex}',
      '.sonor-wq-bar .swq-card{padding:8px 10px;border-radius:6px;background:var(--surface,#F1F5F9);border:1px solid var(--border,#CBD5E1)}',
      '.sonor-wq-bar .swq-card b{font-size:13px}',
      '.sonor-wq-bar .swq-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.sonor-wq-bar .swq-dim{opacity:.6;font-size:11px}',
      '.sonor-wq-bar .swq-h{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:4px 2px 0;font-weight:700}',
      '.sonor-wq-bar .swq-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;cursor:pointer;border:1px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}',
      '.sonor-wq-bar .swq-item:hover{background:var(--surface,#F1F5F9);border-color:var(--border,#CBD5E1)}',
      '.sonor-wq-bar .swq-item:disabled{opacity:.45;cursor:default}',
      '.sonor-wq-bar .swq-item .swq-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sonor-wq-bar .swq-slot{font-size:10px;padding:0 6px;border-radius:8px;background:var(--tint,#E2E8F0);color:var(--text,#334155);font-weight:700;text-transform:uppercase}',
      '.sonor-wq-bar .swq-ev{font-size:11px;padding:2px 8px;opacity:.85}',
      '.sonor-wq-bar .swq-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px;padding-top:6px;border-top:1px solid var(--border,#CBD5E1)}',
      '.sonor-wq-bar .swq-mini{padding:2px 8px;font-size:11px;border-radius:4px;border:1px solid var(--border,#CBD5E1);background:var(--card,#fff);color:inherit;cursor:pointer}',
      '.sonor-wq-bar .swq-primary{background:var(--cta-bg,var(--accent,#2d718b));border-color:var(--cta-bg,var(--accent,#2d718b));color:var(--cta-text,#fff)}',
      '.sonor-wq-bar .swq-warn{display:inline-block;padding:0 6px;border-radius:8px;background:#DC2626;color:#fff;font-size:10px;font-weight:700;line-height:16px}',
      '.sonor-wq-bar .swq-ok{color:#22C55E;font-weight:700}',
      '.sonor-wq-bar .swq-drift{background:#B45309}',
      '.sonor-wq-bar .swq-doc{padding:4px 8px;border-radius:5px;border:1px solid transparent;display:flex;flex-direction:column;gap:2px}.sonor-wq-bar .swq-doc:hover{border-color:var(--border,#CBD5E1)}',
      '.sonor-wq-bar .swq-doc.swq-dead{opacity:.5}.sonor-wq-bar .swq-doc .swq-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.sonor-wq-bar .swq-danger{background:#DC2626;border-color:#DC2626;color:#fff}',
      '.sonor-wq-bar .swq-api{font-size:11px;padding:4px 8px;border-radius:5px;margin-top:4px;background:var(--tint,#E2E8F0);color:var(--muted,#64748B)}',
      '.sonor-wq-bar .swq-api-warn{color:#B45309;background:color-mix(in srgb,#E0922F 18%,transparent)}',
      '.sonor-wq-bar .swq-api-over{color:#fff;background:#DC2626;font-weight:700}',
      '.sonor-project-bar .sonor-wq-bar{--swq-bg:var(--tint,#E2E8F0);--swq-border:var(--border-strong,var(--border,#CBD5E1))}'   /* 2026-10-13 — neutral chrome, no purple (Bryn) */,
      '.sonor-project-bar .sonor-wq-bar .swq-menu{color:var(--text,#0F172A)}'   /* v1.4.4: the menu sits on --card, so its ink is --text (graphite made it dark-on-dark) */
    ].join('\n');
    var st = document.createElement('style'); st.id = 'sonor-wq-bar-styles'; st.textContent = css; document.head.appendChild(st);
  }

  // ── data ────────────────────────────────────────────────────────────────────────────────────────────
  async function _load() {
    var ref = typeof _refFn === 'function' ? _refFn() : _refFn;
    _state.ref = ref || null; _state.refNo = _refNo(ref); _state.error = null;
    if (!_supa || !_state.refNo) { _state.primary = null; _state.quotes = []; _state.events = []; _state.docs = []; _render(); return _state; }
    try {
      var no = _state.refNo;
      var r1 = await _supa.from('v_project_quote').select('*').eq('ref_no', no).limit(1).maybeSingle();
      var r2 = await _supa.from('wq_quote_links').select('id, project_ref, slot, quote_id, quote_no, wq_revision, wq_stage, wq_description, wq_updated_at, stage_changed_at, locked_at, locked_reason, status, pushed_at, plan_revision_label, updated_at, engineering:metadata->engineering').or('project_ref.eq.' + no + ',project_ref.ilike.' + no + ' - %,project_ref.ilike.' + no + '-%').order('updated_at', { ascending: false });
      var r3 = await _supa.from('wq_events').select('id, received_at, type, quote_id, resolved, project_ref').or('project_ref.eq.' + no + ',project_ref.ilike.' + no + ' - %,project_ref.ilike.' + no + '-%').order('received_at', { ascending: false }).limit(6);
      _state.primary = (r1 && r1.data && r1.data.quote_id) ? r1.data : null;
      _state.quotes = (r2 && r2.data) || [];
      _state.events = (r3 && r3.data) || [];
      try { var r4 = await _supa.from('client_docs').select('id, token, kind, title, project_ref, quote_no, quote_rev, created_at, expires_at, revoked_at, views, last_viewed_at').or('project_ref.eq.' + no + ',project_ref.ilike.' + no + ' - %,project_ref.ilike.' + no + '-%').order('created_at', { ascending: false }).order('id').limit(8); _state.docs = (r4 && r4.data) || []; } catch (_) { _state.docs = []; }
      // 1.5.0 — API call budget this period (public.wq_api_usage; period starts on the 18th). Shown in the foot so a blown
      // allowance is visible before a push is attempted (13.10.26: 17,807 / 5,000 calls, locked out until the 18th).
      try { var r5 = await _supa.from('wq_api_usage').select('period_start, calls, limit_calls, hard_stop, exhausted').order('period_start', { ascending: false }).limit(1).maybeSingle(); _state.api = (r5 && r5.data) || null; } catch (_) { _state.api = null; }
      _state.loadedAt = Date.now();
    } catch (e) { _state.error = e && e.message || String(e); }
    _render();
    return _state;
  }

  function _subscribe() {
    if (_channel || !_supa || typeof _supa.channel !== 'function') return;
    try {
      _channel = _supa.channel('sonor-wq-bar')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wq_quote_links' }, function (p) { var row = (p && (p.new || p.old)) || {}; if (_refNo(row.project_ref) === _state.refNo) _debounced(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'client_docs' }, function (p) { var row = (p && (p.new || p.old)) || {}; if (_refNo(row.project_ref) === _state.refNo) _debounced(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wq_events' }, function (p) { var row = (p && p.new) || {}; if (!_state.refNo || _refNo(row.project_ref) === _state.refNo || _state.quotes.some(function (q) { return q.quote_id === row.quote_id; })) _debounced(); })
        .subscribe();
    } catch (_) { _channel = null; }
  }
  function _debounced() { clearTimeout(_timer); _timer = setTimeout(_load, 400); }

  // ── render ──────────────────────────────────────────────────────────────────────────────────────────
  function _pillHtml() {
    var q = _state.primary;
    if (!_state.refNo) return '<span class="swq-pill swq-none">no project</span>';
    if (!q) return '<span class="swq-pill swq-none">no quote yet</span>';
    var st = String(q.wq_stage || '').toLowerCase();
    return '<span class="swq-pill">#' + _esc(q.quote_no || q.quote_id) + (q.wq_revision ? ' r' + _esc(q.wq_revision) : '')
      + (st ? ' <span class="' + _stageCls(st) + '">' + _esc(STAGE_LABEL[st] || st.replace(/_/g, ' ')) + '</span>' : '')
      + (_locked(q) ? ' ' + '<span class="swq-lock" data-locked="true" title="Locked" style="display:inline-flex;align-items:center;padding:1px 4px;border-radius:4px;line-height:1">' + _ico('lock', '🔒', { size: 12 }) + '</span>' : '') + (_drift(q).length ? ' <span class="swq-warn swq-drift" title="' + _drift(q).length + ' line(s) with price drift — list price moved since this quote was built, or unpriced">£ ' + _drift(q).length + '</span>' : '') + (q.spec_issues > 0 ? ' <span class="swq-warn" title="' + q.spec_issues + ' spec-check issue(s) — quote does not match the takeoff">' + _ico('triangle-alert', '⚠', { size: 11 }) + ' ' + q.spec_issues + '</span>' : (q.spec_issues === 0 ? ' <span class="swq-ok" title="quote matches the takeoff (spec check)">' + _ico('check', '✓', { size: 13 }) + '</span>' : '')) + '</span>';
  }
  // v1.4.1 — latest Engineering cloud save noted on the takeoffs-push link row (metadata.engineering)
  function _engHtml() {
    var row = _state.quotes.find(function (x) { return x.engineering && x.engineering.at; }); if (!row) return '';
    var e = row.engineering;
    return '<div class="swq-dim" title="' + _esc((e.title || '') + (e.diff ? ' · +' + (e.diff.added || 0) + ' ~' + (e.diff.moved || 0) + ' −' + (e.diff.removed || 0) : '')) + '">' + _ico('settings', '⚙', { size: 11 }) + ' Engineering' + (e.revision ? ' rev ' + _esc(e.revision) : '') + (e.eng_revision != null ? ' (#' + _esc(e.eng_revision) + ')' : '') + ' · ' + _esc(e.nodes || 0) + ' devices' + (e.racks ? ' · ' + _esc(e.racks) + ' rack' + (e.racks === 1 ? '' : 's') : '') + ' · saved ' + _esc(_ago(e.at)) + '</div>';
  }
  function _menuHtml() {
    var q = _state.primary, h = [];
    if (q) {
      var st = String(q.wq_stage || '').toLowerCase();
      h.push('<div class="swq-card"><div class="swq-row"><b>#' + _esc(q.quote_no || q.quote_id) + (q.wq_revision ? ' · rev ' + _esc(q.wq_revision) : '') + '</b>'
        + (st ? '<span class="' + _stageCls(st) + '">' + _esc(STAGE_LABEL[st] || st) + '</span>' : '') + (_locked(q) ? '<span title="' + _esc(q.locked_reason || 'locked') + '">' + _ico('lock', '🔒', { size: 14 }) + '</span>' : '') + '<span class="swq-slot">' + _esc(q.slot || '') + '</span></div>'
        + (q.wq_description ? '<div>' + _esc(q.wq_description) + '</div>' : '')
        + _engHtml()
        + '<div class="swq-dim">' + (q.stage_changed_at ? 'stage changed ' + _ago(q.stage_changed_at) + ' · ' : '') + (q.pushed_at ? 'pushed ' + _ago(q.pushed_at) + ' · ' : '') + (q.plan_revision_label ? 'plan "' + _esc(q.plan_revision_label) + '" · ' : '') + (_state.quotes.length > 1 ? _state.quotes.length + ' quotes on this project' : '') + '</div>'
        + '<div class="swq-row" style="margin-top:6px"><button type="button" class="swq-mini swq-primary" data-swq-open="' + _esc(q.quote_id) + '">Open in WeQuote ' + _ico('external-link', '↗', { size: 12 }) + '</button>'
        + (q.scope_pdf && (q.scope_pdf.link || q.scope_pdf.path) ? '<button type="button" class="swq-mini" ' + (q.scope_pdf.link ? 'data-swq-link="' + _esc(q.scope_pdf.link) + '"' : 'data-swq-doc="' + _esc(q.scope_pdf.path) + '"') + ' title="Scope of works brief filed ' + _esc(_ago(q.scope_pdf.at)) + (q.scope_pdf.quote_no ? ' for quote #' + _esc(q.scope_pdf.quote_no) : '') + (q.scope_pdf.link ? ' — private client link' : '') + '">' + _ico('file-text', '📄', { size: 12 }) + ' Scope of works</button>' : '') + '</div></div>');
    } else {
      h.push('<div class="swq-card"><b>No WeQuote quote paired</b><div class="swq-dim">' + (_state.refNo ? 'Pair or push one from Takeoffs, or create it in WeQuote under project ' + _esc(_state.refNo) + ' — it appears here automatically.' : 'Pick a project first.') + '</div>' + _engHtml() + '</div>');
    }
    if (q && q.reconcile) {
      var rc = q.reconcile;
      h.push('<div class="swq-h">Spec check · quote vs takeoff <span class="swq-dim" style="text-transform:none;letter-spacing:0">' + _ago(rc.at) + '</span></div>');
      if (!rc.issues) h.push('<div class="swq-ev swq-ok">' + _ico('check', '✓', { size: 13 }) + ' matches — ' + _esc(rc.matched || 0) + ' products' + (rc.extra && rc.extra.length ? ' · ' + rc.extra.length + ' added in WeQuote' : '') + '</div>');
      (rc.missing || []).slice(0, 5).forEach(function (m) { h.push('<div class="swq-ev"><span class="swq-warn">missing</span> ' + _esc(m.name) + ' ×' + _esc(m.qty) + (m.areas && m.areas.length ? ' <span class="swq-dim">' + _esc(m.areas.map(function (a) { return a.area; }).join(', ')) + '</span>' : '') + '</div>'); });
      (rc.qty_diff || []).slice(0, 5).forEach(function (d) { h.push('<div class="swq-ev"><span class="swq-warn">qty</span> ' + _esc(d.name) + ' takeoff ×' + _esc(d.takeoff) + ' · quote ×' + _esc(d.quote) + '</div>'); });
      var more = ((rc.missing || []).length - 5) + ((rc.qty_diff || []).length - 5); if (more > 0) h.push('<div class="swq-ev swq-dim">+ ' + more + ' more — open Takeoffs › 🔍 Spec check</div>');
      if (rc.extra && rc.extra.length && rc.issues) h.push('<div class="swq-ev swq-dim">' + rc.extra.length + ' line(s) only on the quote (added in WeQuote)</div>');
      var dr = _drift(q); dr.slice(0, 5).forEach(function (d) { h.push('<div class="swq-ev"><span class="swq-warn swq-drift">£</span> ' + _esc(d.name) + (d.kind === 'unpriced' ? ' — £0 on this quote, list £' + _esc(_gbp(d.ref)) : ' — list £' + _esc(_gbp(d.list)) + ' here, £' + _esc(_gbp(d.ref)) + ' on #' + _esc(d.ref_quote_no) + ' (' + (d.pct > 0 ? '+' : '') + _esc(d.pct) + '%)') + '</div>'); });
      if (dr.length > 5) h.push('<div class="swq-ev swq-dim">+ ' + (dr.length - 5) + ' more price lines — see the nightly report</div>');
    }
    var others = _state.quotes.filter(function (x) { return !q || x.id !== q.link_id; });
    if (others.length) {
      h.push('<div class="swq-h">Other quotes on this project</div>');
      others.forEach(function (x) { var st2 = String(x.wq_stage || '').toLowerCase(); h.push('<button type="button" class="swq-item" data-swq-open="' + _esc(x.quote_id) + '"><span class="swq-grow">#' + _esc(x.quote_no || x.quote_id) + (x.wq_revision ? ' r' + _esc(x.wq_revision) : '') + (x.wq_description ? ' — ' + _esc(x.wq_description) : '') + '</span>' + (st2 ? '<span class="' + _stageCls(st2) + '">' + _esc(STAGE_LABEL[st2] || st2) + '</span>' : '') + (_locked(x) ? _ico('lock', '🔒', { size: 12 }) : '') + '<span class="swq-slot">' + _esc(x.slot || '') + '</span></button>'); });
    }
    if (_state.docs.length) {
      h.push('<div class="swq-h">Client links <span class="swq-dim" style="text-transform:none;letter-spacing:0">private · revocable</span></div>');
      _state.docs.forEach(function (d) {
        var dead = !!(d.revoked_at || (d.expires_at && new Date(d.expires_at) < new Date()));
        var kind = { scope: 'Scope of works', brief: 'Brief' }[d.kind] || 'Document';
        h.push('<div class="swq-doc' + (dead ? ' swq-dead' : '') + '"><div class="swq-row"><span class="swq-grow" title="' + _esc(d.title || kind) + '">' + _ico('file-text', '📄', { size: 12 }) + ' ' + _esc(kind) + (d.quote_no ? ' · #' + _esc(d.quote_no) + (d.quote_rev ? ' r' + _esc(d.quote_rev) : '') : '') + '</span>'
          + (dead ? '<span class="swq-slot" title="' + (d.revoked_at ? 'revoked ' + _esc(_ago(d.revoked_at)) : 'expired') + '">' + (d.revoked_at ? 'revoked' : 'expired') + '</span>' : '<span class="swq-dim" title="' + (d.last_viewed_at ? 'last viewed ' + _esc(_ago(d.last_viewed_at)) : 'not opened yet') + '">' + _ico('eye', '👁', { size: 11 }) + ' ' + _esc(d.views || 0) + '</span>') + '</div>'
          + '<div class="swq-row"><span class="swq-dim">issued ' + _esc(_ago(d.created_at)) + '</span><span style="flex:1"></span>'
          + (dead ? '' : '<button type="button" class="swq-mini" data-swq-copy="' + _esc(d.token) + '" title="Copy the private link">' + _ico('copy', '⧉', { size: 11 }) + ' copy</button><button type="button" class="swq-mini" data-swq-link="' + DOC_URL + _esc(d.token) + '" title="Open the client landing page">' + _ico('external-link', '↗', { size: 11 }) + '</button><button type="button" class="swq-mini' + (_armed === d.id ? ' swq-danger' : '') + '" data-swq-revoke="' + _esc(d.id) + '" title="Revoke — the link stops working for the client (the file stays filed)">' + (_armed === d.id ? 'revoke — sure?' : _ico('eye-off', '⛔', { size: 11 }) + ' revoke') + '</button>') + '</div></div>');
      });
      if (_appKey !== 'takeoffs') h.push('<div class="swq-ev swq-dim">re-issue a link from Takeoffs › 📄 Scope of works brief</div>');
    }
    if (_actions.length) {
      h.push('<div class="swq-h">Actions</div>');
      _actions.forEach(function (a, i) { var dis = typeof a.disabled === 'function' ? !!a.disabled(_state) : !!a.disabled; h.push('<button type="button" class="swq-item" data-swq-action="' + i + '"' + (a.id ? ' id="' + _esc(a.id) + '"' : '') + (dis ? ' disabled' : '') + (a.title ? ' title="' + _esc(a.title) + '"' : '') + '><span class="swq-grow">' + _esc(a.label) + '</span></button>'); });
    }
    if (_state.events.length) {
      h.push('<div class="swq-h">Recent from WeQuote</div>');
      _state.events.forEach(function (e) { var r = e.resolved || {};
        if (e.type === 'spec_check') { h.push('<div class="swq-ev">' + (r.issues ? '<span class="swq-warn">' + _esc(r.issues) + '</span> spec check' : _ico('check', '✓', { size: 12 }) + ' spec check') + (e.quote_id ? ' · #' + _esc(r.quote_no || e.quote_id) : '') + (r.issues ? ' — ' + _esc(r.missing || 0) + ' missing, ' + _esc(r.qty_diff || 0) + ' qty' : ' — matches') + ' <span class="swq-dim">' + _ago(e.received_at) + ' · nightly</span></div>'); return; }
        h.push('<div class="swq-ev">' + _esc(String(e.type || '').replace(/_/g, ' ')) + (e.quote_id ? ' · #' + _esc(r.quote_no || e.quote_id) : '') + (r.stage ? ' → ' + _esc(STAGE_LABEL[r.stage] || r.stage) : '') + ' <span class="swq-dim">' + _ago(e.received_at) + '</span></div>'); });
    }
    if (_state.api) {   // 1.5.0 — API budget line
      var ap = _state.api, used = Number(ap.calls || 0), lim = Number(ap.limit_calls || 5000), ps = new Date(ap.period_start + 'T00:00:00'), rs = new Date(ps.getFullYear(), ps.getMonth() + 1, ps.getDate());
      var over = ap.exhausted || used >= Number(ap.hard_stop || 4500), warn = !over && used >= 3500;
      h.push('<div class="swq-api' + (over ? ' swq-api-over' : warn ? ' swq-api-warn' : '') + '" title="WeQuote API calls this billing period (resets on the 18th) — every proxy read and push write counts; Sonor stops at ' + _esc(ap.hard_stop || 4500) + '">' + (over ? _ico('alert-triangle', '⛔', { size: 12 }) + ' ' : '') + 'API calls ' + _esc(used.toLocaleString()) + ' / ' + _esc(lim.toLocaleString()) + ' · resets ' + rs.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (over ? ' — pushes and lookups are off until then' : '') + '</div>');
    }
    h.push('<div class="swq-foot"><span class="swq-dim">' + (_state.error ? '⚠ ' + _esc(_state.error) : (_state.loadedAt ? 'live · ' + _ago(new Date(_state.loadedAt).toISOString()) : '')) + '</span><span><button type="button" class="swq-mini" data-swq-refresh="1" title="Re-read from Supabase">' + _ico('refresh-cw', '↻', { size: 12 }) + '</button></span></div>');
    return h.join('');
  }
  function _render() {
    if (!_host) return;
    var wrap = _host.querySelector('.sonor-wq-bar');
    if (!wrap) {
      _host.innerHTML = '<span class="sonor-wq-bar"><button type="button" class="swq-btn" aria-haspopup="menu" aria-expanded="false"><span class="swq-lbl">' + _ico('receipt', '🧾') + ' WeQuote</span><span class="swq-pillhost"></span><span class="swq-caret">' + _ico('chevron-down', '▾', { size: 12 }) + '</span></button><div class="swq-menu" role="menu"></div></span>';
      wrap = _host.querySelector('.sonor-wq-bar');
      var btn = wrap.querySelector('.swq-btn');
      btn.addEventListener('click', function (e) { e.stopPropagation(); _toggle(); });
      wrap.querySelector('.swq-menu').addEventListener('click', function (e) {
        var t = e.target.closest('[data-swq-open],[data-swq-action],[data-swq-refresh],[data-swq-doc],[data-swq-link],[data-swq-copy],[data-swq-revoke]'); if (!t) return;
        e.stopPropagation();
        if (t.hasAttribute('data-swq-copy')) { _copy(DOC_URL + t.getAttribute('data-swq-copy'), t); return; }
        if (t.hasAttribute('data-swq-revoke')) { _revoke(t.getAttribute('data-swq-revoke')); return; }
        if (t.hasAttribute('data-swq-link')) { global.open(t.getAttribute('data-swq-link'), '_blank', 'noopener'); return; }
        if (t.hasAttribute('data-swq-doc')) { _openDoc(t.getAttribute('data-swq-doc')); return; }
        if (t.hasAttribute('data-swq-open')) { global.open(WQ_QUOTE_URL + t.getAttribute('data-swq-open') + '/editor', '_blank', 'noopener'); return; }
        if (t.hasAttribute('data-swq-refresh')) { _load(); return; }
        var a = _actions[Number(t.getAttribute('data-swq-action'))]; _toggle(false); if (a && typeof a.onClick === 'function') a.onClick(_state);
      });
      document.addEventListener('click', function (e) { if (_open && !wrap.contains(e.target)) { _armed = null; _toggle(false); } });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _open) _toggle(false); });
    }
    wrap.querySelector('.swq-pillhost').innerHTML = _pillHtml();
    wrap.querySelector('.swq-menu').innerHTML = _menuHtml();
    if (global.SonorIcons) { try { global.SonorIcons.replaceEmoji(wrap.querySelector('.swq-menu'), { selector: '.swq-item .swq-grow', size: 14 }); } catch (_) {} }
    wrap.querySelector('.swq-btn').title = _state.primary ? ('WeQuote #' + (_state.primary.quote_no || '') + ' · ' + (_state.primary.wq_description || '') + (_locked(_state.primary) ? ' · locked' : '')) : 'WeQuote quotes for this project';
  }
  // private project-docs bucket → short-lived signed URL (anon select policy) → new tab
  async function _openDoc(path) {
    if (!_supa || !_supa.storage) return;
    try { var r = await _supa.storage.from('project-docs').createSignedUrl(path, 900); var url = r && r.data && r.data.signedUrl; if (url) global.open(url, '_blank', 'noopener'); } catch (e) { console.warn('[wq-bar] signed url failed', e); }
  }
  function _copy(text, btn) {
    var done = function () { if (btn) { var was = btn.innerHTML; btn.textContent = 'copied ✓'; setTimeout(function () { btn.innerHTML = was; }, 1400); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { global.prompt('Copy this link', text); }); return; } } catch (_) {}
    global.prompt('Copy this link', text);
  }
  // two-click revoke: first click arms the button ("revoke — sure?"), second within 6 s writes client_docs.revoked_at
  async function _revoke(id) {
    if (_armed !== id) { _armed = id; _render(); setTimeout(function () { if (_armed === id) { _armed = null; _render(); } }, 6000); return; }
    _armed = null;
    try { var r = await _supa.from('client_docs').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null); if (r && r.error) throw r.error; } catch (e) { _state.error = 'revoke failed: ' + (e && e.message || e); }
    _load();
  }
  function _toggle(force) {
    var wrap = _host && _host.querySelector('.sonor-wq-bar'); if (!wrap) return;
    _open = typeof force === 'boolean' ? force : !_open;
    wrap.classList.toggle('open', _open);
    wrap.querySelector('.swq-btn').setAttribute('aria-expanded', _open ? 'true' : 'false');
    // close sibling Takeoffs popovers (same header) so only one menu is open
    if (_open) { try { document.querySelectorAll('.pb-tools-menu').forEach(function (m) { m.style.display = 'none'; }); } catch (_) {} }
  }

  // ── auto-mount into the shared SonorProjectBar ──────────────────────────────────────────────────────
  function _autoMount() {
    var bar = document.querySelector('.sonor-project-bar'); if (!bar) return false;
    var meta = bar.querySelector('.meta') || bar;
    var host = bar.querySelector('.sonor-wq-host');
    if (!host) { host = document.createElement('span'); host.className = 'sonor-wq-host'; meta.appendChild(host); }
    if (_host !== host) { _host = host; _render(); }
    return true;
  }
  function _watchBar() {
    if (_observer) return;
    var root = document.body; if (!root || typeof MutationObserver === 'undefined') return;
    _observer = new MutationObserver(function () { if (_autoHost && !document.contains(_host)) { if (_autoMount()) _render(); } });
    _observer.observe(root, { childList: true, subtree: true });
  }

  function init(opts) {
    opts = opts || {}; _css();
    _supa = opts.supa || global.supa || (global.db && global.db.client) || null;
    _actions = Array.isArray(opts.actions) ? opts.actions : [];
    _appKey = opts.appKey || '';
    if (opts.host) { _host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host; _autoHost = false; }
    else { _autoHost = true; _autoMount(); _watchBar(); }
    if (opts.ref != null) _refFn = opts.ref;
    else _refFn = function () { try { var pb = global.SonorProjectBar; var a = pb && pb.getProject ? pb.getProject() : null; return a && a.ref; } catch (_) { return null; } };
    document.addEventListener('sonor:project-changed', function () { if (_autoHost) setTimeout(function () { _autoMount(); _load(); }, 50); else _load(); });
    _subscribe();
    _render();
    _loadIcons(function () { _render(); });
    return _load();
  }

  global.SonorWqBar = { VERSION: VERSION, init: init, refresh: _load, setRef: function (ref) { _refFn = ref; return _load(); }, setActions: function (a) { _actions = Array.isArray(a) ? a : []; _render(); }, state: function () { return _state; }, close: function () { _toggle(false); }, STAGE_LABEL: STAGE_LABEL };
})(typeof window !== 'undefined' ? window : this);
