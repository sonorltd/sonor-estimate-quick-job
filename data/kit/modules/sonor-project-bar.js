// sonor-project-bar.js — CANONICAL MASTER (Spine v1.2.5 §16 family)
//
// Shared project picker + metadata strip for every Sonor app that wants
// to bind to a `projects` row from Supabase. Replaces the hand-rolled
// project bars in each app (Takeoffs, Leads, Cinema Design, etc) with
// one consistent component synced across the family.
//
// Architecture:
//   - Loads `projects` table on init (RLS: anon SELECT) into a local cache
//   - Renders a top strip: dropdown picker + metadata pills (ref / status /
//     client / address) + Refresh button + "+ New" button
//   - Active project ID persisted in localStorage `sonor_active_project_id`
//     (cross-tab synced via the `storage` event — switch project in one
//     tab, every other Sonor tab follows)
//   - Fires CustomEvent `sonor:project-changed` on document with detail
//     { previousId, currentId, project } so apps can rebuild state
//
// Loading patterns:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="data/sonor-project-bar.js"></script>     ← AFTER supabase-js
//   <script>
//     SonorProjectBar.init({
//       supa: db,                                  // initialised SupabaseClient
//       host: document.getElementById('projectBarHost'),  // optional, lazily creates if absent
//       onChange: function(detail) { ... }         // optional callback
//     });
//   </script>
//
// Namespace: window.SonorProjectBar
//
// Version: 1.15.0 — NO NEW PROJECTS FROM APP BARS (2026-10-31, Bryn: "remove new project creation buttons from all apps
//                  because they are always created from here anyway"): + New is now OPT-IN (`showNew: true`); no app passes it.
//                  Projects are created only in the Master Hub (Database → Master Projects, + New Project) and by the
//                  log-enquiry / new-project-kickoff skills + WeQuote adoption. `_openNewProjectDialog` kept for the opt-in only.
// Version: 1.14.0 — three ADDITIVE init hooks (2026-10-17, so Takeoffs + Takeover can drop their own pickers):
//                  `decorateOption(p)` → string suffix or {prefix, suffix, title} per picker option (also applied
//                  after SonorProjectList builds the grouped options); `beforeChange(newId, prevId)` → return false
//                  or Promise<false> to veto a switch from the picker (selection restored, no bus / LS write — for
//                  unsaved-changes guards; a third arg { fromOtherTab } is true when another tab of the same app
//                  switched, and false there means "don't follow"); `showNew: false` hides the bar's + New (apps with their own New modal).
//                  Apps that pass none of them behave exactly as 1.13.0.
// Version: 1.13.0 — picker re-fetches on open (2026-10-16): opening the dropdown reloads the list when it is older than
//                  20 s, so ⏱ Recently edited stays accurate after another app / session saves. Bryn: "the recents isnt accurate".
// Version: 1.12.0 — OFFLINE project list (2026-10-13): the loaded list is mirrored to localStorage `sonor_projects_cache`
//                  (slim rows, ~1 KB each) and used when Supabase can't be reached, so a field app refreshed with no
//                  signal still has its picker / finder / project name. Bryn: "will all this work offline on the ipad".
// Version: 1.11.1 — Blueprint / Brief / Costs links are neutral graphite pills, not service-purple (2026-10-12).
// Version: 1.11.0 — Lucide icons (B-478): chrome emoji on the Blueprint / Brief / Costs links and the bar buttons become
//                  SVG icons when root sonor-icons.js is on the page (the WeQuote control loads it beside itself).
// Version: 1.10.0 — 🧾 WeQuote status (2026-09-28, B-470). The bar mounts the shared
//                  `sonor-wq-bar.js` control (live quote № · rev · stage · 🔒 for the
//                  active project, fed by the wq-webhook edge fn + realtime) into its
//                  meta strip. Zero-touch for apps: if SonorWqBar is not on the page the
//                  bar loads data/sonor-wq-bar.js from beside its own script. Opt out
//                  with init({ wqBar: false }).
// Version: 1.5.0 — 📄 Brief link (2026-07-16, B-398). When the active project
//                  has a structured client brief (projects.metadata.brief —
//                  the pattern established on 1387 Andy Bell), the bar shows a
//                  "📄 Brief" link next to the meta pills that opens the live
//                  per-project brief page in a NEW TAB:
//                  https://apps.sonor.co.uk/sonor-project-master/brief.html?pid={id}
//                  The page renders metadata.brief + the notes timeline, so it
//                  needs no rebuild as more client info is logged. Shown in
//                  BOTH normal and readOnly (host-mode) bars.
// Version: 1.4.0 — PER-APP project memory (`appKey` init option, 2026-07-16).
//                  Bryn: "we just want same menu layout, not the same project to
//                  be selected on refresh in different apps." Pass `appKey`
//                  ('takeoffs', 'cinema-design', …): the bar persists/restores
//                  the active project under `sonor_active_project_id::{appKey}`
//                  — each app remembers ITS OWN project across refreshes. The
//                  bar still PUBLISHES to the bus (global key = "last touched",
//                  which hosts stamp for embedded children), but a standalone
//                  bar no longer FOLLOWS other apps' bus events — it only syncs
//                  its own app's tabs via a storage listener on the scoped key.
//                  `readOnly` (host-mode) bars are the exception: they follow
//                  ALL bus events + boot from the GLOBAL key, so an embedded
//                  app stays in lockstep with its host. No appKey → legacy
//                  global-key behaviour unchanged.
// Version: 1.3.0 — `readOnly` init option (host mode, 2026-07-16). When an app
//                  runs EMBEDDED inside another Sonor app (e.g. Cinema Takeoff
//                  inside Cinema Design's Takeoff tab), pass `readOnly: true`:
//                  the bar renders the active project as a static label — no
//                  <select>, no ↻/+New — so there is exactly ONE picker (the
//                  host's) and the embedded app can never diverge to a second
//                  project. The bar still subscribes to the bus, so it follows
//                  every host switch and always shows what it's locked to.
// Version: 1.2.0 — picker delegates grouping/ordering to SonorProjectList when
//                  present (2026-07-16): same Recently-edited / WQ-tenders /
//                  Trials / Completed-sink view as the Takeoffs project selector —
//                  ONE SSOT (`sonor-project-list.js`) for every Sonor picker.
//                  Additive: without the module the bar renders the v1.1.0 flat
//                  list unchanged. Load `data/sonor-project-list.js` BEFORE this
//                  file to opt in.
// Version: 1.1.0 — consumes sonor-project-bus.js when present (2026-05-17, B-263)
//                  No behaviour change for callers — bus integration is additive.
//                  If bus is loaded, all cross-tab/iframe/Realtime sync routes
//                  through the bus (single writer). If bus is NOT loaded, the
//                  bar falls back to its own localStorage + storage event
//                  handling exactly as in v1.0.0.
// Version: 1.0.0 — initial extraction (2026-04-28 / PM v3.5.0)
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.SonorProjectBar && window.SonorProjectBar.__version) {
    return;  // idempotent — second load is a no-op
  }

  // v1.1.0 — bus integration. If sonor-project-bus.js is loaded, the bar
  // becomes a pure UI layer over it: state lives in the bus, events come
  // from the bus, broadcasts go through the bus. If absent, the bar keeps
  // its v1.0.0 self-contained behaviour (localStorage + storage event).
  // Looked up dynamically (not cached) so script load order doesn't matter.
  function _bus() {
    return (typeof window !== 'undefined' && window.SonorProjectBus) || null;
  }

  // v1.10.0 — remember where this script was loaded from so the WeQuote control can be loaded from beside it.
  const _OWN_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  const LS_KEY = 'sonor_active_project_id';
  // v1.5.0 — per-project client-brief page (repo-slug URL form per the
  // GITHUB PAGES URL LAW; page lives in the Project Master repo).
  const BRIEF_URL = 'https://apps.sonor.co.uk/sonor-project-master/brief.html';
  function _briefLink(active) {
    if (!active || !active.metadata || !active.metadata.brief) return '';
    return `<a class="brief-link" href="${BRIEF_URL}?pid=${encodeURIComponent(active.id)}" target="_blank" rel="noopener" title="Client brief for this project — opens in a new tab">📄 Brief</a>`;
  }

  // v1.6.0 — per-project TRADES page (builder / joiner works list). Neutral
  // surface in the Project Master repo, exact brief-link pattern; shown when
  // the project carries a trades list (projects.metadata.trades — written by
  // the trades page via sonor_merge_project_metadata). Areas carry
  // PROJECT-ROOM TAGs {floor_id, floor_code, name} from takeoffs_floors
  // areas — the same room identity RFI clouds resolve to; tasks join later.
  // v1.9.0 — trades + budget are now ONE surface: COSTS (budget.html —
  // provisional budget + trade works quote list, xlsx import/export, all
  // PDFs). trades.html is a redirect stub there. Shown when the project
  // carries either dataset (metadata.trades OR metadata.budget).
  const COSTS_URL = 'https://apps.sonor.co.uk/sonor-project-master/budget.html';
  function _tradesLink(active) {
    if (!active || !active.metadata || (!active.metadata.trades && !active.metadata.budget)) return '';
    return `<a class="brief-link" href="${COSTS_URL}?pid=${encodeURIComponent(active.id)}" target="_blank" rel="noopener" title="Costs — provisional budget + builder/joiner trade works, opens in a new tab">💷 Costs</a>`;
  }

  // v1.7.0 — per-project BLUEPRINT (the all-app index: brief, design spec,
  // boards, seating, takeoffs rooms + revisions, WeQuote quote links, trades,
  // snags, tasks, renders, schedules). Always shown for the active project —
  // "all projects should have the blueprint regardless of used or not".
  const BLUEPRINT_URL = 'https://apps.sonor.co.uk/sonor-project-master/blueprint.html';
  function _blueprintLink(active) {
    if (!active) return '';
    return `<a class="brief-link" href="${BLUEPRINT_URL}?pid=${encodeURIComponent(active.id)}" target="_blank" rel="noopener" title="Project blueprint — every surface from every app, opens in a new tab">🧭 Blueprint</a>`;
  }

  // ---- Internal state ----
  let _supa = null;
  let _projects = [];                 // cached rows
  let _activeId = null;
  let _onChange = null;
  let _readOnly = false;   // v1.3.0 — host mode: label instead of picker
  let _appKey = null;      // v1.4.0 — per-app project memory (scoped LS key)
  let _decorate = null;    // v1.14.0 — decorateOption(p) hook
  let _beforeChange = null;// v1.14.0 — beforeChange(newId, prevId) veto hook
  let _showNew = false;    // v1.15.0 — + New is opt-in (showNew:true); projects are created in the Master Hub

  // v1.4.0 — which LS key this bar instance persists/restores from.
  // readOnly (embedded) bars use the GLOBAL key — the host stamps it.
  // appKey bars use the app-scoped key — per-app memory.
  function _lsKeyFor() {
    if (_readOnly || !_appKey) return LS_KEY;
    return LS_KEY + '::' + _appKey;
  }
  let _hostEl = null;
  let _initialised = false;

  // ---- Helpers ----
  function _read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function _write(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* quota — ignore */ }
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Status colour ----
  // Keys mirror the canonical `project_status` enum in Supabase
  // (enquiry|quoted|won|active|install|commission|snagging|complete|on_hold|lost).
  // Legacy uppercase aliases retained for back-compat with older surfaces.
  const STATUS_COLOUR = {
    ENQUIRY:    '#b7b1a7',
    QUOTED:     '#e37c59',
    QUOTE:      '#e37c59',  // legacy alias
    WON:        '#78ba57',
    ACTIVE:     '#4bb9d3',
    INSTALL:    '#4bb9d3',
    COMMISSION: '#4bb9d3',
    SNAGGING:   '#ec6061',
    COMPLETE:   '#78ba57',
    COMPLETED:  '#78ba57', // legacy alias
    ON_HOLD:    '#E0922F',
    LOST:       '#b7b1a7',
    // legacy aliases (kept so old localStorage / old rows don't crash colour lookup)
    PROPOSED:   '#e37c59',
    ISSUED:     '#4bb9d3',
    LIVE:       '#4bb9d3',
    APPROVED:   '#78ba57',
    CANCELLED:  '#b7b1a7',
    ARCHIVED:   '#b7b1a7'
  };
  function _statusColour(status) {
    if (!status) return '#b7b1a7';
    return STATUS_COLOUR[String(status).toUpperCase()] || '#b7b1a7';
  }

  // ---- Inject the project bar CSS (one-shot, idempotent) ----
  function _injectStyles() {
    if (document.getElementById('sonor-project-bar-styles')) return;
    const css = `
      .sonor-project-bar {
        /* v2.x 2026-09-29 (sonor-platform §9): ladder step 3 under the header; text is --surface-text — NEVER --body,
           which is a BACKGROUND alias in the app vocabularies (graphite turned the bar's text invisible) */
        background: var(--bar-3, var(--footer-bg, #141008));
        color: var(--surface-text, #F4F1EC);
        padding: 10px 16px;
        display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
        font-family: 'DM Sans', -apple-system, sans-serif; font-size: 12.5px;
        border-bottom: 1px solid var(--bar-line, rgba(244, 241, 236, 0.10));
      }
      .sonor-project-bar .label {
        font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
        opacity: 0.55; font-weight: 600;
      }
      .sonor-project-bar select {
        background: var(--bar-4, transparent);
        color: var(--surface-text, #F4F1EC);
        border: 1px solid var(--border-strong, rgba(244, 241, 236, 0.22));
        border-radius: 4px;
        padding: 5px 10px;
        font-family: 'DM Mono', SF Mono, monospace; font-size: 12px;
        min-width: 220px; cursor: pointer;
      }
      .sonor-project-bar select:focus { outline: 1px solid var(--accent, #6b4a8a); outline-offset: 1px; }
      .sonor-project-bar select option { background: var(--bar-4, #2a1f15); color: var(--surface-text, #F4F1EC); }
      .sonor-project-bar .meta {
        display: inline-flex; align-items: center; gap: 14px;
        font-family: 'DM Mono', SF Mono, monospace; font-size: 11px;
        opacity: 0.85;
      }
      .sonor-project-bar .meta-cell { display: inline-flex; gap: 5px; align-items: baseline; }
      .sonor-project-bar .meta-cell .k {
        font-size: 9px; letter-spacing: 0.08em; opacity: 0.55; text-transform: uppercase;
      }
      .sonor-project-bar .brief-link {
        font-size: 11.5px; font-weight: 600; text-decoration: none;
        color: var(--text-primary, var(--surface-text, #F4F1EC)); background: var(--card, rgba(255,255,255,.06));
        border: 1px solid var(--border, rgba(148,163,184,.45));
        padding: 3px 10px; border-radius: 999px; white-space: nowrap;
      }
      /* v1.11.1 (2026-10-12, Bryn: "blueprint etc buttons are purple, should fit in with the dark grey theme") — neutral
         graphite pills like the WeQuote control; the kit's §18 hover wash does the rest. Service purple is NOT chrome. */
      .sonor-project-bar .brief-link:hover { border-color: var(--border-strong, rgba(244,241,236,.35)); background: var(--surface-hover, rgba(255,255,255,.1)); }
      .sonor-project-bar .status-pill {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 9px; border-radius: 10px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      }
      .sonor-project-bar .actions { margin-left: auto; display: inline-flex; gap: 6px; }
      .sonor-project-bar button {
        background: transparent; color: var(--surface-text, #F4F1EC);
        border: 1px solid var(--border-strong, rgba(244, 241, 236, 0.22));
        border-radius: 4px; padding: 5px 11px;
        font-family: 'DM Mono', SF Mono, monospace; font-size: 11px;
        cursor: pointer; transition: background 0.12s;
      }
      .sonor-project-bar button:hover { background: var(--surface-hover, rgba(244, 241, 236, 0.07)); }
      .sonor-project-bar button.primary {
        background: var(--cta-bg, var(--accent, #6b4a8a)); border-color: var(--cta-bg, var(--accent, #6b4a8a)); color: var(--cta-text, #fff);
      }
      .sonor-project-bar button.primary:hover {
        background: var(--cta-hover, rgba(107, 74, 138, 0.85));
      }
      .sonor-project-bar .note {
        font-size: 10.5px; opacity: 0.55; font-style: italic;
      }
    `;
    const style = document.createElement('style');
    style.id = 'sonor-project-bar-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // v1.14.0 — apply the app's decorateOption hook to every option of the picker (walks by value, so it works for the
  // flat list AND the SonorProjectList grouped build, including the ⏱ Recently-edited duplicates).
  function _decorateOptions(sel) {
    if (!sel || typeof _decorate !== 'function') return;
    const byId = {};
    _projects.forEach(p => { if (p && p.id) byId[p.id] = p; });
    Array.prototype.forEach.call(sel.options, o => {
      const p = o.value && byId[o.value];
      if (!p) return;
      let d;
      try { d = _decorate(p); } catch (e) { return; }
      if (d == null || d === '') return;
      if (typeof d === 'string') { o.textContent = o.textContent + d; return; }
      if (typeof d === 'object') {
        o.textContent = (d.prefix || '') + o.textContent + (d.suffix || '');
        if (d.title) o.title = d.title;
      }
    });
  }

  // ---- Render the bar into _hostEl ----
  function _render() {
    if (!_hostEl) return;
    const active = _projects.find(p => p && p.id === _activeId) || null;
    const status = active && active.status ? String(active.status).toUpperCase() : '';
    const statusCol = _statusColour(status);
    const opts = [
      '<option value="">— select project —</option>',
      ..._projects.map(p => {
        const sel = p.id === _activeId ? ' selected' : '';
        const ref = p.ref ? `[${p.ref}] ` : '';
        return `<option value="${_esc(p.id)}"${sel}>${_esc(ref + (p.name || 'Untitled'))}</option>`;
      })
    ].join('');
    // v1.3.0 — host mode: the active project is DISPLAYED, never picked here.
    // The host app's bar is the single selector; this bar follows via the bus.
    if (_readOnly) {
      _hostEl.innerHTML = `
        <div class="sonor-project-bar" role="region" aria-label="Project (set by host app)">
          <span class="label">Project</span>
          <span class="meta-cell" title="Project is selected in the host app — this embedded view follows it automatically."><span class="k">🔗</span><span>${active ? _esc((active.ref ? '[' + active.ref + '] ' : '') + (active.name || 'Untitled')) : '— follows host app —'}</span></span>
          ${active ? `
            <span class="meta">
              ${active.client_name ? `<span class="meta-cell"><span class="k">CLIENT</span><span>${_esc(active.client_name)}</span></span>` : ''}
              ${status ? `<span class="status-pill" style="background:${statusCol}33;border:1px solid ${statusCol};color:#F4F1EC">${_esc(status)}</span>` : ''}
              ${_blueprintLink(active)}${_briefLink(active)}${_tradesLink(active)}
            </span>
          ` : '<span class="note">No project selected in the host app yet.</span>'}
        </div>
      `;
      _iconify();   // v1.11.0
      return;   // no select / refresh / +New wiring in host mode
    }
    _hostEl.innerHTML = `
      <div class="sonor-project-bar" role="region" aria-label="Project picker">
        <span class="label">Project</span>
        <select id="sonorProjectPicker" aria-label="Select active project">${opts}</select>
        ${active ? `
          <span class="meta">
            ${active.ref ? `<span class="meta-cell"><span class="k">REF</span><span>${_esc(active.ref)}</span></span>` : ''}
            ${active.client_name ? `<span class="meta-cell"><span class="k">CLIENT</span><span>${_esc(active.client_name)}</span></span>` : ''}
            ${active.address ? `<span class="meta-cell"><span class="k">ADDR</span><span>${_esc(active.address)}</span></span>` : ''}
            ${status ? `<span class="status-pill" style="background:${statusCol}33;border:1px solid ${statusCol};color:#F4F1EC">${_esc(status)}</span>` : ''}
            ${_blueprintLink(active)}${_briefLink(active)}${_tradesLink(active)}
          </span>
        ` : '<span class="note">No project selected — pick one above to load it into this app.</span>'}
        <span class="actions">
          <button id="sonorProjectRefresh" title="Re-fetch projects from Supabase">↻</button>
          ${_showNew ? '<button id="sonorProjectNew" class="primary" title="Create a new project">+ New</button>' : ''}
        </span>
      </div>
    `;
    _iconify();   // v1.11.0
    // Wire the selector
    const sel = document.getElementById('sonorProjectPicker');
    // v1.2.0 — delegate grouping/ordering to the workspace SSOT when loaded
    // (data/sonor-project-list.js): ⏱ Recently edited → WQ tenders (desc) →
    // Trials/no-WQ → ✔ Completed/cancelled sink. EXACTLY the Takeoffs
    // selector view, from the same module. The inline flat `opts` above
    // remains the no-module fallback (offline / fetch fail) — same pattern
    // as Takeoffs' _populateProjectDropdown (v5.34.0).
    if (sel && window.SonorProjectList && typeof window.SonorProjectList.populateSelect === 'function') {
      try {
        window.SonorProjectList.populateSelect(sel, _projects, {
          currentId: _activeId,
          placeholder: '— select project —'
        });
      } catch (e) {
        console.warn('[ProjectBar] SonorProjectList delegate failed — flat list kept:', e && e.message);
      }
    }
    _decorateOptions(sel);   // v1.14.0
    if (sel) {
      sel.addEventListener('change', e => {
        const newId = e.target.value || null;
        // v1.14.0 — beforeChange veto (unsaved-changes guards). false / Promise<false> = stay where we are.
        if (typeof _beforeChange === 'function' && newId !== _activeId) {
          const prevId = _activeId;
          const restore = () => { try { sel.value = prevId || ''; } catch (_) {} };
          let r;
          try { r = _beforeChange(newId, prevId, { fromOtherTab: false }); } catch (err) { console.warn('[ProjectBar] beforeChange threw:', err); r = true; }
          if (r && typeof r.then === 'function') {
            restore();   // hold the old selection while the app decides
            r.then(ok => { if (ok === false) { restore(); return; } if (_activeId === prevId) _setActiveProject(newId); },
                   err => { console.warn('[ProjectBar] beforeChange rejected:', err); restore(); });
            return;
          }
          if (r === false) { restore(); return; }
        }
        _setActiveProject(newId);
      });
      // v1.13.0 (Bryn 16.10.26: "the recents isnt accurate") — the list was fetched ONCE at boot, so a project saved by
      // another app / session after that (or created while the tab sat open) never moved into ⏱ Recently edited. Opening
      // the picker re-fetches when the list is older than 20 s; the native dropdown keeps the stale options until the
      // live list lands (a blink later), and the active selection is kept.
      const _refreshIfStale = () => { if (Date.now() - _loadedAt > 20000 && !_loading) loadProjects(); };
      sel.addEventListener('mousedown', _refreshIfStale);
      sel.addEventListener('focus', _refreshIfStale);
      sel.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') _refreshIfStale(); });
    }
    const refreshBtn = document.getElementById('sonorProjectRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadProjects());
    const newBtn = document.getElementById('sonorProjectNew');
    if (newBtn) newBtn.addEventListener('click', _openNewProjectDialog);
  }

  // ---- Active project state machine ----
  function _setActiveProject(newId) {
    const previousId = _activeId;
    if (previousId === newId) return;
    _activeId = newId;
    // v1.4.0 — per-app memory: ALWAYS persist to this app's scoped key (this is
    // what boot restores from). The bus write below still maintains the global
    // "last touched" key for hosts/embedded handoffs.
    if (_appKey && !_readOnly) {
      if (newId) _write(_lsKeyFor(), newId);
      else { try { localStorage.removeItem(_lsKeyFor()); } catch (e) {} }
    }
    // v1.1.0 — when bus is present, route the write through it (single writer).
    // The bus handles LS + cross-tab/iframe/Realtime fan-out + dispatches the
    // same `sonor:project-changed` CustomEvent. Our subscriber (bound in init)
    // catches the echo, updates _activeId/_render again no-op, and calls onChange.
    const bus = _bus();
    if (bus && typeof bus.set === 'function') {
      bus.set(newId, { source: _appKey || 'project-bar', actor: 'human' });
      // No early-return here — the bar's UI also wants the onChange callback
      // fired locally with the project object. Bus dispatches the doc event;
      // we still need to invoke _onChange with the resolved project row.
      _render();
      const project = _projects.find(p => p && p.id === newId) || null;
      const detail = { previousId, currentId: newId, project };
      if (typeof _onChange === 'function') {
        try { _onChange(detail); } catch (e) { console.warn('[ProjectBar] onChange threw:', e); }
      }
      return;
    }
    // v1.0.0 fallback path — no bus, self-contained
    if (newId) _write(LS_KEY, newId); else { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
    _render();
    const project = _projects.find(p => p && p.id === newId) || null;
    const detail = { previousId, currentId: newId, project };
    document.dispatchEvent(new CustomEvent('sonor:project-changed', { detail }));
    if (typeof _onChange === 'function') {
      try { _onChange(detail); } catch (e) { console.warn('[ProjectBar] onChange threw:', e); }
    }
  }

  // ---- Cross-tab sync — listen to storage events ----
  // v1.1.0 — when bus is present, bus owns storage event handling.
  // We subscribe to the bus instead. If bus is absent, fall back to v1.0.0.
  function _bindStorageSync() {
    const bus = _bus();
    // v1.4.0 — per-app bars DO NOT follow the bus (that's what made every app
    // land on the same project). They sync only their OWN app's tabs via a
    // storage listener on the scoped key. Embedded readOnly bars still follow
    // the bus below (host lockstep); legacy no-appKey bars keep v1.1.0 behaviour.
    if (_appKey && !_readOnly) {
      window.addEventListener('storage', (e) => {
        if (e.key !== _lsKeyFor()) return;
        const newId = e.newValue || null;
        if (newId === _activeId) return;
        // v1.14.0 — the app may decline to follow another of its own tabs (third arg { fromOtherTab: true }); a declined
        // follow changes nothing here and writes nothing (no tab ping-pong). Promise answers are honoured the same way.
        if (typeof _beforeChange === 'function') {
          let r;
          try { r = _beforeChange(newId, _activeId, { fromOtherTab: true }); } catch (err) { r = true; }
          if (r === false) return;
          if (r && typeof r.then === 'function') { r.then(ok => { if (ok !== false && _activeId !== newId) _followOtherTab(newId); }, () => {}); return; }
        }
        _followOtherTab(newId);
      });
      return;
    }
    function _followOtherTab(newId) {   // hoisted — used by the per-app storage listener above
      _activeId = newId;
      _render();
      const project = _projects.find(p => p && p.id === newId) || null;
      const detail = { previousId: null, currentId: newId, project, fromOtherTab: true, via: 'storage-event' };
      document.dispatchEvent(new CustomEvent('sonor:project-changed', { detail }));
      if (typeof _onChange === 'function') {
        try { _onChange(detail); } catch (e2) { /* ignore */ }
      }
    }
    if (bus && typeof bus.subscribe === 'function') {
      bus.subscribe((detail) => {
        // Skip if we initiated this set (project-bar source) — onChange already fired.
        if (detail && detail.source === 'project-bar' && detail.via === 'set') return;
        const newId = detail && detail.currentId || null;
        if (newId === _activeId) return;
        _activeId = newId;
        _render();
        const project = _projects.find(p => p && p.id === newId) || null;
        const onChangeDetail = {
          previousId: detail && detail.previousId,
          currentId: newId,
          project,
          fromOtherTab: detail && detail.via === 'storage-event',
          via: detail && detail.via
        };
        if (typeof _onChange === 'function') {
          try { _onChange(onChangeDetail); } catch (e) { /* ignore */ }
        }
      });
      return;
    }
    // v1.0.0 fallback — direct storage event handling
    window.addEventListener('storage', (e) => {
      if (e.key !== LS_KEY) return;
      const newId = e.newValue || null;
      if (newId === _activeId) return;
      _activeId = newId;
      _render();
      const project = _projects.find(p => p && p.id === newId) || null;
      const detail = { previousId: null, currentId: newId, project, fromOtherTab: true };
      document.dispatchEvent(new CustomEvent('sonor:project-changed', { detail }));
      if (typeof _onChange === 'function') {
        try { _onChange(detail); } catch (e) { /* ignore */ }
      }
    });
  }

  // ---- Project list loader ----
  let _loadedAt = 0, _loading = false;   // v1.13.0
  async function loadProjects() {
    if (!_supa) return [];
    _loading = true;
    if (!_projects.length) { const seed = _cacheRead(); if (seed.length) { _projects = seed; _render(); } }   // v1.12.0 instant picker from the device cache; the live list replaces it when it lands
    try {
      const { data, error } = await _supa
        .from('projects')
        .select('id, ref, name, client_name, address, postcode, status, metadata, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      _projects = Array.isArray(data) ? data : [];
      _loadedAt = Date.now(); _loading = false;
      _cacheWrite(_projects);
      _render();
      return _projects;
    } catch (e) {
      _loading = false;
      console.warn('[ProjectBar] loadProjects failed:', e && e.message);
      // v1.12.0 OFFLINE — no signal on site (or a refresh with none): fall back to the last list this device saw, so the
      // picker, the finder and the project name still work and the field apps carry on from their own caches.
      const cached = _cacheRead();
      if (cached.length && !_projects.length) { _projects = cached; _render(); }
      return _projects.slice();
    }
  }
  // Slim per-device cache of the project list (localStorage, ~1 KB per project): the picker/finder fields + the metadata
  // keys SonorProjectList orders by. Never the big metadata blobs (briefs, survey summaries, plan notes).
  const CACHE_KEY = 'sonor_projects_cache';
  const META_KEEP = ['is_test', 'holding', 'source', 'wequote_status', 'wequote_number', 'wequote_activity_at', 'wequote_modified_at', 'wequote_created_at', 'trades', 'budget'];
  function _cacheWrite(rows) {
    try {
      const slim = rows.map(p => {
        const m = p.metadata || {}, mm = {};
        META_KEEP.forEach(k => { if (m[k] !== undefined) mm[k] = m[k]; });
        if (m.brief) mm.brief = true;   // the bar only asks "is there a brief?"
        return { id: p.id, ref: p.ref, name: p.name, client_name: p.client_name, address: p.address, postcode: p.postcode, status: p.status, created_at: p.created_at, updated_at: p.updated_at, metadata: mm };
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: slim }));
    } catch (e) { /* quota / private mode — the cache is a convenience */ }
  }
  function _cacheRead() { try { const o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return o && Array.isArray(o.rows) ? o.rows : []; } catch (e) { return []; } }

  // Suggest a unique-looking project ref so users don't have to invent one.
  // Pattern: SON-{YYYY}-{NNN} where NNN is the next free number for the year
  // across the loaded _projects list. Falls back to SON-{YYYY}-001 if no
  // existing refs match the pattern.
  function _suggestRef() {
    const yr = String(new Date().getFullYear());
    const re = new RegExp('^SON-' + yr + '-(\\d{3,})$', 'i');
    let max = 0;
    for (const p of _projects) {
      if (!p || !p.ref) continue;
      const m = String(p.ref).match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return 'SON-' + yr + '-' + String(max + 1).padStart(3, '0');
  }

  // Inserts a project; returns the resolved promise the caller awaits.
  // Centralised so the retry-on-conflict path doesn't duplicate logic.
  function _insertProject(payload) {
    return _supa.from('projects')
      .insert(payload)
      .select('id, ref, name, client_name, address, postcode, status, metadata')
      .single();
  }

  function _openNewProjectDialog() {
    const name = prompt('New project name:');
    if (!name) return;
    const suggestion = _suggestRef();
    let ref = prompt(
      'Reference (leave blank for none, or accept the suggestion):',
      suggestion
    );
    // null = user cancelled the second prompt entirely. Treat as abort,
    // not as "use no ref" — the user might have second-thoughts.
    if (ref === null) return;
    if (!_supa) {
      alert('Supabase not connected — can\'t create a project.');
      return;
    }
    const payload = {
      name: String(name).trim(),
      ref: String(ref).trim() || null,
      // Supabase project_status enum is lowercase:
      // enquiry|quoted|won|active|install|commission|snagging|complete|on_hold|lost
      status: 'enquiry'
    };
    _insertProject(payload).then(({ data, error }) => {
      if (error) {
        // Postgres unique-violation = SQLSTATE 23505. Surfaced by Supabase
        // with `code: '23505'` AND `message` containing the constraint name.
        // Detect the projects.ref unique violation specifically and offer
        // a one-step retry with a different ref (don't lose the name input).
        const isRefDup = (error.code === '23505' && /projects_ref/i.test(error.message || '')) ||
                         /duplicate key.*projects_ref/i.test(error.message || '');
        if (isRefDup && payload.ref) {
          const retry = prompt(
            'Reference "' + payload.ref + '" is already in use.\n\n' +
            'Pick a different reference (or leave blank for none):',
            _suggestRef()
          );
          if (retry === null) return; // cancelled
          const retryPayload = Object.assign({}, payload, {
            ref: String(retry).trim() || null
          });
          _insertProject(retryPayload).then(({ data: data2, error: err2 }) => {
            if (err2) {
              alert('Create project failed: ' + (err2.message || err2));
              return;
            }
            _projects.unshift(data2);
            _setActiveProject(data2.id);
          });
          return;
        }
        alert('Create project failed: ' + (error.message || error));
        return;
      }
      _projects.unshift(data);
      _setActiveProject(data.id);
    });
  }

  // ---- Public init ----
  // v1.11.0 — swap leading chrome emoji (🧭 📄 💷 ↻) for Lucide icons once sonor-icons.js is present
  function _iconify() { try { if (window.SonorIcons && _hostEl) window.SonorIcons.replaceEmoji(_hostEl, { selector: '.brief-link, .sonor-project-bar button', size: 14 }); } catch (_) {} }
  // v1.10.0 — shared WeQuote status control (root sonor-wq-bar.js). Loaded from beside this script when absent.
  let _wqBar = true, _wqBarStarted = false;
  function _mountWqBar() {
    if (!_wqBar || _wqBarStarted || typeof window === 'undefined') return;
    _wqBarStarted = true;
    const start = () => { try { if (window.SonorWqBar && !window.SonorWqBar.state().loadedAt && !window.SonorWqBar.__mountedByBar) { window.SonorWqBar.__mountedByBar = true; window.SonorWqBar.init({ supa: _supa, appKey: _appKey || undefined }); } if (!window.SonorIcons) { const t = setInterval(() => { if (window.SonorIcons) { clearInterval(t); _iconify(); } }, 300); setTimeout(() => clearInterval(t), 8000); } else _iconify(); } catch (e) { console.warn('[ProjectBar] WeQuote control failed', e && e.message); } };
    if (window.SonorWqBar) { start(); return; }
    if (!_OWN_SRC) return;
    const sc = document.createElement('script');
    sc.src = _OWN_SRC.replace(/sonor-project-bar\.js(\?.*)?$/, 'sonor-wq-bar.js');
    sc.async = true; sc.onload = start; sc.onerror = () => { /* app without the synced file — no control, no error */ };
    document.head.appendChild(sc);
  }

  async function init(opts) {
    if (_initialised) {
      console.warn('[ProjectBar] already initialised — call refresh() instead.');
      return;
    }
    _initialised = true;
    _supa = (opts && opts.supa) || null;
    _onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : null;
    _readOnly = !!(opts && opts.readOnly);   // v1.3.0 — host mode
    _appKey = (opts && opts.appKey) || null; // v1.4.0 — per-app memory
    _hostEl = (opts && opts.host) || null;
    _decorate = (opts && typeof opts.decorateOption === 'function') ? opts.decorateOption : null;      // v1.14.0
    _beforeChange = (opts && typeof opts.beforeChange === 'function') ? opts.beforeChange : null;      // v1.14.0
    _showNew = !!(opts && opts.showNew === true);                                                      // v1.14.0
    if (!_hostEl) {
      // Auto-create at top of body
      _hostEl = document.createElement('div');
      _hostEl.id = 'sonorProjectBarHost';
      const first = document.body.firstChild;
      if (first) document.body.insertBefore(_hostEl, first);
      else document.body.appendChild(_hostEl);
    }
    _injectStyles();
    _bindStorageSync();
    // Restore active project from localStorage — v1.4.0: scoped key when
    // appKey given (per-app memory); GLOBAL key for readOnly/legacy bars.
    _activeId = _read(_lsKeyFor()) || null;
    // v1.8.0 — universal ?pid= deep link (Blueprint / Brief / Trades convention):
    // any app opened with ?pid=<project-uuid> adopts that project on load.
    // App-specific params (?project=, ?config=…) stay app-owned; an explicit
    // link wins over per-app memory, and the choice persists to it.
    try {
      const _pid = new URLSearchParams(location.search).get('pid');
      if (_pid && /^[0-9a-f-]{36}$/i.test(_pid) && !_readOnly) {
        _activeId = _pid;
        if (_appKey) _write(_lsKeyFor(), _pid);
      }
    } catch (e) {}
    _wqBar = !(opts && opts.wqBar === false);   // v1.10.0
    _render();   // initial empty render so the bar shows immediately
    if (_supa) await loadProjects();
    _mountWqBar();   // v1.10.0 — shared 🧾 WeQuote control (auto-mounts into .meta, follows sonor:project-changed)
    // If we have an active id but the project isn't in the list, render anyway
    // (consumer can detect missing project via getProject() returning null)
    _render();
    return _projects;
  }

  function getActiveId() { return _activeId; }
  function getProject(id) {
    const target = id || _activeId;
    if (!target) return null;
    return _projects.find(p => p && p.id === target) || null;
  }
  function getProjects() { return _projects.slice(); }
  function setActive(id) { _setActiveProject(id); }
  function refresh() { return loadProjects(); }
  // v1.14.0 — re-render the picker (e.g. after the app's decorateOption answer changed) without a network fetch
  function rerender() { _render(); }

  // ---- Export ----
  const api = {
    init, refresh, loadProjects,
    getActiveId, getProject, getProjects, setActive, rerender,
    __version: '1.14.0',
    __ls_key: LS_KEY
  };
  if (typeof window !== 'undefined') window.SonorProjectBar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
