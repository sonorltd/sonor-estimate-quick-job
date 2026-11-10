/*!
 * sonor-project-list.js — SSOT for project-selector grouping + ordering.
 * ----------------------------------------------------------------------------
 * Canonical master lives at the WORKSPACE ROOT. It is copied into each app's
 * `data/` by `sync-everything.sh` (pair: "sonor-project-list.js|data/sonor-project-list.js").
 * NEVER edit a per-app copy — edit THIS master, then run `bash sync-everything.sh`.
 *
 * Every Sonor app that shows a project picker consumes this so the ordering
 * rules live in ONE place (HARMONY / no-islands). Change here = change everywhere.
 *
 * Rules (one source of truth):
 *   1. ⏱ Recently edited  — top N (default 5) by updated_at. CONVENIENCE
 *      DUPLICATES — each also appears in its real group below, so nothing
 *      "disappears" from the list.
 *   2. WQ tenders         — every project whose `ref` starts with a 3–5 digit
 *      WeQuote number, sorted by that number (descending = newest WQ first).
 *   3. Trials / no WQ     — `ref` without a leading number, parked at the bottom
 *      (mostly trials / sandboxes), sorted by name.
 *   4. ✔ Completed / cancelled — v1.1.0 (Bryn 2026-07-12: "the projects list
 *      should move completed projects to the bottom based on the wequote
 *      status"). Any project whose `metadata.wequote_status` is completed/
 *      cancelled (kept fresh weekly by Master Hub's syncWqProjectNames →
 *      WQ API /project/find_project), OR whose Sonor `status` column is
 *      complete/completed/cancelled/archived, sinks to a single group at
 *      the very bottom (WQ number desc, then name). Done projects are also
 *      excluded from the ⏱ Recently-edited convenience slots so they never
 *      hog the top of the list.
 *
 * Adoption (any app):
 *   <script src="data/sonor-project-list.js"></script>   // before the app script
 *   SonorProjectList.populateSelect(selectEl, rows, { currentId });
 *   // or pure:  SonorProjectList.group(rows) -> [{key,label,items:[...]}]
 *
 * The project `rows` only need: { id, ref, name, client_name?, updated_at?, created_at? }.
 * Pass `status` + `metadata` too when available — they drive the completed sink
 * (rows without them are treated as live, never hidden).
 *
 * @version 1.5.0
 *
 * v1.3.0 (2026-10-12, Bryn: "projects should be sorted in time last touched order anyway" — an enquiry with no WQ
 *   number (ENQ - Paul Murphy) was parked under 'Trials / no WQ' at the bottom, out of sight): the live list is now ONE
 *   group, LAST TOUCHED FIRST (updated_at desc, created_at fallback), whatever the ref. No WQ-number ordering, no
 *   'Recently edited' duplicates, no 'Trials' pen. Holding (⏳) and Completed (✔) still sink below it. `group()` keeps
 *   the same return shape ({key,label,items}[]).
 * v1.3.1 (same evening, Bryn: "keep the blocks thats useful, we dont want one solid list" · "probably need 10x in recents"):
 *   blocks restored — ⏱ Recently edited (10) → WQ tenders → Enquiries / no WQ number → ⏳ Holding → ✔ Completed — but every
 *   block is ordered last touched first; the WQ-number sort and the 'Trials' label are gone for good.
 * v1.3.2: ⏱ Recently edited = touched by ANY Sonor app (updated_at); WQ tenders = by WeQuote activity
 *   (metadata.wequote_activity_at / _modified_at from the Master Hub sync); Enquiries = updated_at.
 * v1.4.0 (2026-10-18, Bryn: "dont see sonor demo project here"): demo / test-subject projects
 *   (metadata.source 'demo', metadata.demo true, or a ref starting "DEMO") are pinned in a 🧪 Demo block at the
 *   very top of every picker, so the shared test project is one click away in every app. They leave the other blocks.
 */
(function (global) {
  'use strict';
  var VERSION = '1.5.0';

  // Parse the WeQuote number from a ref ("1381 - Awaken Spa" -> 1381). null if none.
  function wqOf(p) {
    var m = String((p && p.ref) || '').match(/^\s*(\d{3,5})\b/);
    return m ? parseInt(m[1], 10) : null;
  }
  function tsOf(p) {
    var t = Date.parse((p && (p.updated_at || p.created_at)) || '');
    return isNaN(t) ? 0 : t;
  }
  function defaultLabel(p) {
    var ref = (p && p.ref) ? '[' + p.ref + '] ' : '';
    return ref + ((p && (p.name || p.client_name)) || '(untitled)');
  }

  // v1.1.0 — is the project finished? WeQuote status is the primary signal
  // (metadata.wequote_status, synced weekly by Master Hub from the WQ API);
  // the Sonor status column is the fallback for non-WQ projects. Missing
  // both → live.
  var DONE_WQ    = { completed: 1, cancelled: 1 };
  var DONE_SONOR = { complete: 1, completed: 1, cancelled: 1, archived: 1 };
  function doneOf(p) {
    if (!p) return false;
    // Accept the WQ status either nested (full row: metadata.wequote_status)
    // or top-level (lean PostgREST select alias `wequote_status:metadata->>wequote_status`).
    var wq = String(p.wequote_status || ((p.metadata || {}).wequote_status) || '').toLowerCase();
    if (DONE_WQ[wq]) return true;
    var st = String(p.status || '').toLowerCase();
    return !!DONE_SONOR[st];
  }

  // v1.2.0 — HOLDING PATTERN (Bryn 2026-07-31: gcal-created SITE-* projects
  // "need to be categorised in a holding pattern until they are assigned
  // properly or not"). States in projects.metadata.holding:
  //   'holding'   → parked in a ⏳ group above the completed sink
  //   'assigned'  → treated as a normal live project
  //   'dismissed' → hidden from every picker (data kept; un-dismiss via Blueprint)
  // AUTO-RULE (no key set): a calendar-created project (metadata.source='gcal')
  // with no WeQuote number in its ref is holding by default — so future gcal
  // imports park themselves without waiting for the importer to tag them.
  // Assigning a real WQ ref (or setting holding='assigned') releases it.
  // v1.3.2 — when WeQuote last touched the project (either timestamp, whichever is later); 0 when never synced
  function wqTouchOf(p) {
    if (!p) return 0; var m = p.metadata || {};
    var t = 0; [p.wequote_activity_at || m.wequote_activity_at, p.wequote_modified_at || m.wequote_modified_at, p.wequote_created_at || m.wequote_created_at].forEach(function (v) { var n = v ? Date.parse(v) : 0; if (n && n > t) t = n; });
    return t || 0;
  }
  // v1.4.0 — the shared demo / test-subject project(s)
  function demoOf(p) {
    if (!p) return false; var m = p.metadata || {};
    if (String(p.source || m.source || '').toLowerCase() === 'demo') return true;
    if (m.demo === true || m.demo === 'true') return true;
    return /^\s*DEMO\b/i.test(String(p.ref || ''));
  }
  // v1.5.0 — the studio's own project (pinned under Demo)
  function studioOf(p) {
    if (!p || demoOf(p)) return false; var m = p.metadata || {};
    if (String(p.source || m.source || '').toLowerCase() === 'studio') return true;
    if (m.studio === true || m.studio === 'true') return true;
    return /^\s*STUDIO\b/i.test(String(p.ref || ''));
  }
  function holdingStateOf(p) {
    if (!p) return null;
    var h = String(p.holding || ((p.metadata || {}).holding) || '').toLowerCase();
    if (h) return h;
    var src = String(p.source || ((p.metadata || {}).source) || '').toLowerCase();
    if (src === 'gcal' && wqOf(p) == null) return 'holding';
    return null;
  }
  function holdingOf(p) { return holdingStateOf(p) === 'holding'; }
  function dismissedOf(p) { return holdingStateOf(p) === 'dismissed'; }

  // Pure — returns ordered groups: [{ key, label, items:[...] }]
  function group(rows, opts) {
    opts = opts || {};
    var recentCount = (opts.recentCount != null) ? opts.recentCount : 10;   // v1.3.1 ten (Bryn: "probably need 10x in recents")
    var wqDescending = (opts.wqDescending !== false); // default newest-first
    var list = Array.isArray(rows) ? rows.slice() : [];
    var out = [];

    // v1.1.0 — completed/cancelled projects (WQ status first, Sonor status
    // fallback) sink to their own group at the very bottom and stay out of
    // the live groups + the recent convenience slots.
    list = list.filter(function (p) { return !dismissedOf(p); });   // v1.2.0 — dismissed hidden everywhere
    var demo = list.filter(demoOf);                                     // v1.4.0 — pinned at the top
    list = list.filter(function (p) { return !demoOf(p); });
    var studio = list.filter(studioOf);                                 // v1.5.0 — pinned under Demo
    list = list.filter(function (p) { return !studioOf(p); });
    var holding = list.filter(function (p) { return holdingOf(p) && !doneOf(p); });
    var live = list.filter(function (p) { return !doneOf(p) && !holdingOf(p); });
    var done = list.filter(doneOf);

    // v1.3.1 (Bryn: "keep the blocks thats useful, we dont want one solid list") — the BLOCKS stay, the ORDER inside
    // every block is last touched first (updated_at desc; WQ number / name only break ties):
    //   ⏱ Recently edited (top 10)  →  WQ tenders  →  Enquiries / no WQ number  →  ⏳ Holding  →  ✔ Completed
    var byTouch = function (a, b) {
      var d = tsOf(b) - tsOf(a); if (d) return d;
      var wa = wqOf(a), wb = wqOf(b); if (wa != null && wb != null && wa !== wb) return wb - wa;
      return String((a && (a.name || a.ref)) || '').localeCompare(String((b && (b.name || b.ref)) || ''));
    };
    if (demo.length) out.push({ key: 'demo', label: '🧪  Demo / test project', items: demo });
    if (studio.length) out.push({ key: 'studio', label: '🎛  Studio', items: studio });
    var recent = live.filter(function (p) { return tsOf(p) > 0; }).sort(byTouch).slice(0, recentCount);
    if (recent.length) out.push({ key: 'recent', label: '⏱  Recently edited', items: recent });
    // v1.3.2 (Bryn: "recents last touched by any of our apps, the rest can be in order of when wq was touched") —
    // the WQ block orders by WEQUOTE activity (metadata.wequote_activity_at / wequote_modified_at, synced by Master Hub),
    // not by our own updated_at; WQ number breaks ties.
    var byWq = function (a, b) { var d = wqTouchOf(b) - wqTouchOf(a); if (d) return d; var wa = wqOf(a), wb = wqOf(b); if (wa != null && wb != null && wa !== wb) return wb - wa; return byTouch(a, b); };
    var wq = live.filter(function (p) { return wqOf(p) != null; }).sort(byWq);
    if (wq.length) out.push({ key: 'wq', label: 'WQ tenders — by WeQuote activity', items: wq });
    var enq = live.filter(function (p) { return wqOf(p) == null; }).sort(byTouch);
    if (enq.length) out.push({ key: 'enquiries', label: 'Enquiries / no WQ number — last touched first', items: enq });

    holding.sort(function (a, b) { return tsOf(b) - tsOf(a); });   // newest site visit first
    if (holding.length) out.push({ key: 'holding', label: '⏳  Site / holding — to assign', items: holding });

    done.sort(function (a, b) {
      var wa = wqOf(a), wb = wqOf(b);
      if (wa != null && wb != null && wa !== wb) return wqDescending ? (wb - wa) : (wa - wb);
      if ((wa != null) !== (wb != null)) return (wa != null) ? -1 : 1;   // numbered before un-numbered
      return String((a && (a.name || a.ref)) || '').localeCompare(String((b && (b.name || b.ref)) || ''));
    });
    if (done.length) out.push({ key: 'done', label: '✔  Completed / cancelled', items: done });

    return out;
  }

  // DOM — (re)build a <select> with grouped <optgroup>s, preserving selection.
  // opts: { currentId, labelFor(p), valueFor(p), placeholder (string|false), recentCount, wqDescending }
  function populateSelect(selectEl, rows, opts) {
    if (!selectEl) return;
    opts = opts || {};
    var labelFor = opts.labelFor || defaultLabel;
    var valueFor = opts.valueFor || function (p) { return p.id; };
    var keep = (opts.currentId != null) ? opts.currentId : selectEl.value;
    var doc = selectEl.ownerDocument || global.document;

    selectEl.innerHTML = '';
    if (opts.placeholder !== false) {
      var blank = doc.createElement('option');
      blank.value = '';
      blank.textContent = opts.placeholder || '— Select project —';
      selectEl.appendChild(blank);
    }
    group(rows, opts).forEach(function (g) {
      var og = doc.createElement('optgroup');
      og.label = g.label;
      g.items.forEach(function (p) {
        var o = doc.createElement('option');
        o.value = valueFor(p);
        o.textContent = labelFor(p);
        og.appendChild(o);
      });
      selectEl.appendChild(og);
    });

    var arr = Array.isArray(rows) ? rows : [];
    if (keep && arr.some(function (p) { return valueFor(p) === keep; })) selectEl.value = keep;
    else if (keep) selectEl.value = '';
    return selectEl.value;
  }

  global.SonorProjectList = {
    VERSION: VERSION, demoOf: demoOf, studioOf: studioOf, wqOf: wqOf, tsOf: tsOf, wqTouchOf: wqTouchOf, doneOf: doneOf,
    holdingStateOf: holdingStateOf, holdingOf: holdingOf, dismissedOf: dismissedOf,
    group: group, populateSelect: populateSelect, defaultLabel: defaultLabel
  };
})(typeof window !== 'undefined' ? window : this);
