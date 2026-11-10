/* sonor-app.js — shared Phase 1/Phase 2 bootstrap per Spine rule S-4.2.
   Synced to every "APP - {slug}"/sonor-app.js via sync-everything.sh.
   Edit here ONLY — never edit a per-app copy.

   Spine v1.2 references:
     S-4.2  Single source of truth for shared code — no hand-edited copies.
     S-4.7  Phase 1 local init + Phase 2 async Supabase overlay.
     S-4.9  Apps self-report version via db.versions.report().

   Host app usage (call ONCE near the bottom of the inline <script>):

     <script>
       const APP_VERSION = '0.0.0';
       SonorApp.init({
         appKey:  'portal',           // matches app_versions.app_key
         appName: 'Portal',           // display name
         repo:    'sonor-portal',     // GitHub repo slug
         appVersion: APP_VERSION      // optional — defaults to window.APP_VERSION
       }).then(({ supaDb, supaReady }) => {
         // Phase 2 — host app does its own overlay from Supabase here
       });
     </script>

   This module is vanilla JS — no ES modules, no bundler — so it works with a
   plain <script src> in every HTML app. It reads window.__SONOR_BRAND__.appUrls
   to wire the Drive/GitHub source toggle, and expects the DOM to contain the
   standard spine scaffolding (#nav-version, #dbStatus or .status-indicator,
   #sourceToggle, [data-app-key] links). Missing elements are silently skipped
   so partial-adoption apps don't throw.
*/

(function(global) {
  'use strict';

  // Guard against double-load
  if (global.SonorApp && global.SonorApp.__loaded) return;

  // ---------------------------------------------------------------
  // DB status indicator
  //   Compatible with two markup shapes:
  //     (a) Spine pattern: .status-indicator > .status-dot + .status-label
  //     (b) Portal legacy: #dbStatus.db-status > .db-dot + .db-label
  //   Pass `id` (default 'dbStatus') to target a specific element.
  // ---------------------------------------------------------------
  function updateDbStatusIndicator(state, label, opts) {
    opts = opts || {};
    var id = opts.id || 'dbStatus';
    var el = document.getElementById(id);
    if (!el) return;

    // Reset known state classes, re-apply the current one (container level)
    ['connecting', 'live', 'offline', 'error'].forEach(function(s) {
      el.classList.remove(s);
    });
    if (state) el.classList.add(state);

    // ALSO apply to the inner dot element — sonor-header.css targets
    // `.db-dot.live` / `.status-dot.live` (not the container). Without this
    // the dot never turns green on live. Works for both markup shapes.
    var dotEl = el.querySelector('.db-dot')
             || el.querySelector('.status-dot')
             || el.querySelector('[data-status-dot]');
    if (dotEl) {
      ['connecting', 'live', 'offline', 'error'].forEach(function(s) {
        dotEl.classList.remove(s);
      });
      if (state) dotEl.classList.add(state);
    }

    var labelEl = el.querySelector('.status-label')
               || el.querySelector('.db-label')
               || el.querySelector('[data-status-label]');
    if (labelEl && label != null) labelEl.textContent = label;
  }

  // ---------------------------------------------------------------
  // Source toggle (Drive / GitHub)
  //   Reads appUrls from window.__SONOR_BRAND__ (synced sonor-brand.js).
  //   Updates every [data-app-key] element's href to the matching URL.
  // ---------------------------------------------------------------
  var _appSource = null;

  function getAppUrls() {
    var brand = global.__SONOR_BRAND__ || {};
    return brand.appUrls || { local: {}, hosted: {} };
  }

  function setAppSource(src) {
    if (src !== 'local' && src !== 'hosted') return;
    _appSource = src;

    var urls = getAppUrls()[src] || {};

    // Toggle button active state
    var toggleButtons = document.querySelectorAll('#sourceToggle button[data-src]');
    toggleButtons.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.src === src);
    });

    // Rewrite every [data-app-key] href to match the selected source
    document.querySelectorAll('[data-app-key]').forEach(function(el) {
      var key = el.dataset.appKey;
      if (!key) return;
      var url = urls[key];
      if (url) el.setAttribute('href', url);
    });
  }

  function getAppSource() {
    if (_appSource) return _appSource;
    // Default: local on file://, hosted on http(s)://
    return (global.location && global.location.protocol === 'file:') ? 'local' : 'hosted';
  }

  function wireSourceToggle() {
    var toggle = document.getElementById('sourceToggle');
    if (toggle) {
      toggle.addEventListener('click', function(e) {
        var btn = e.target.closest('button[data-src]');
        if (btn) setAppSource(btn.dataset.src);
      });
    }
    setAppSource(getAppSource());
  }

  // ---------------------------------------------------------------
  // Version badge
  // ---------------------------------------------------------------
  function setVersionBadge(appVersion) {
    var el = document.getElementById('nav-version');
    if (el && appVersion) el.textContent = 'v' + appVersion;
  }

  // ---------------------------------------------------------------
  // Supabase init — Phase 2
  //   Returns { supaDb, supaReady }.
  //   supaDb is null when SonorDB isn't loaded or ping fails.
  //   Never throws — host apps await the promise safely.
  // ---------------------------------------------------------------
  function initSupabase(config) {
    var appKey = (config && config.appKey) || null;
    var appName = (config && config.appName) || appKey || 'Sonor app';
    var repo = (config && config.repo) || null;
    var appVersion = (config && config.appVersion) || global.APP_VERSION || null;
    var pingTimeoutMs = (config && config.pingTimeoutMs) || 5000;

    updateDbStatusIndicator('connecting', 'Connecting…');

    if (typeof global.SonorDB === 'undefined') {
      updateDbStatusIndicator('offline', 'Local only');
      // eslint-disable-next-line no-console
      console.warn('[SonorApp] SonorDB not loaded — running Phase 1 only');
      return Promise.resolve({ supaDb: null, supaReady: false });
    }

    var supaDb;
    try {
      supaDb = new global.SonorDB();
    } catch (e) {
      updateDbStatusIndicator('offline', 'Local only');
      console.warn('[SonorApp] SonorDB init threw:', e && e.message);
      return Promise.resolve({ supaDb: null, supaReady: false });
    }

    var pingPromise;
    try {
      pingPromise = Promise.race([
        supaDb.ping(),
        new Promise(function(_, reject) {
          setTimeout(function() { reject(new Error('timeout')); }, pingTimeoutMs);
        })
      ]);
    } catch (e) {
      updateDbStatusIndicator('offline', 'Local only');
      return Promise.resolve({ supaDb: null, supaReady: false });
    }

    return pingPromise.then(function(ok) {
      if (!ok) {
        updateDbStatusIndicator('error', 'DB Error');
        return { supaDb: supaDb, supaReady: false };
      }
      updateDbStatusIndicator('live', 'Supabase');

      // Fire-and-forget version self-report
      if (appKey && appVersion && supaDb.versions && typeof supaDb.versions.report === 'function') {
        try {
          Promise.resolve(supaDb.versions.report(appKey, appVersion, appName, repo))
            .catch(function() { /* version report is nice-to-have */ });
        } catch (e) { /* ignore */ }
      }
      return { supaDb: supaDb, supaReady: true };
    }).catch(function(err) {
      updateDbStatusIndicator('offline', 'Local only');
      console.warn('[SonorApp] Supabase ping failed:', err && err.message);
      return { supaDb: null, supaReady: false };
    });
  }

  // ---------------------------------------------------------------
  // init — the one-liner every app calls
  // ---------------------------------------------------------------
  function init(config) {
    config = config || {};
    var appVersion = config.appVersion || global.APP_VERSION || null;

    // Phase 1 (synchronous, cheap)
    setVersionBadge(appVersion);
    wireSourceToggle();

    // Phase 2 (async, non-blocking — host app chains onto the resolved promise)
    return initSupabase({
      appKey: config.appKey,
      appName: config.appName,
      repo: config.repo,
      appVersion: appVersion,
      pingTimeoutMs: config.pingTimeoutMs
    });
  }

  // ---------------------------------------------------------------
  // Floor canonical sort order
  // ---------------------------------------------------------------
  // Per Bryn directive 2026-05-08 (Sonor PDF v5.4.41 memo + Takeoffs
  // session proposal): wherever floors[] is listed/iterated for output
  // (PDF cover floorsTable, schedule headers, plan loop, project meta
  // tables, JSON exports), use this canonical sequence:
  //   GF (Ground), 1F (First), 2F (Second), 3F+, BA (Basement), EXT (Exterior)
  // Single source of truth → identical output across Cinema Takeoff,
  // Cinema Design, Takeoffs, RAMS, Project Master, Packs.
  //
  // Inputs accepted:
  //   - {code: 'GF'|'G'|'0F'|'1F'|'F1'|'BA'|'EXT', name: 'First Floor', ...}
  //   - {name: 'GROUND', ...}
  // Returns a NEW sorted array — does not mutate input.
  // v5.5.36 — Hardened rank to recognise the actual text floor names that
  // appear in the Takeoffs data ("First Floor", "Second Floor", etc.)
  // alongside the short codes ("GF", "1F", "BA", "EXT"). The previous
  // rank only matched short codes + a "GROUND" prefix, so text-named
  // upper floors fell to 9999 (unknown). With both Ground and First as
  // unknowns vs one ranked, the sort produced "1F before GF" — Bryn
  // confirmed 2026-05-11. New rank handles ordinal words (FIRST → 1,
  // SECOND → 2, …), "Nst/Nnd/Nrd/Nth Floor" patterns, "Floor N" pattern,
  // plus the original codes. Stable sort, never mutates input.
  const _ORDINAL_WORDS = {
    FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5,
    SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10
  };
  function _floorRank(f) {
    // v5.5.36 — Accept either a string OR an object with {code, name}.
    // Previous shape only handled the object form which silently fell
    // through to 9999 when callers passed a raw string.
    let raw = '';
    if (typeof f === 'string') raw = f;
    else if (f && typeof f === 'object') raw = String(f.code || f.name || '');
    const code = raw.toUpperCase().trim();
    if (!code) return 9999;
    // 2026-10-10 (Greylands) — OUTBUILDINGS: a separate building's levels sort after the house and
    // before EXT. Codes PH (pool house) / PHB (its basement / plant) / OB / OBB, or names with
    // POOL HOUSE / OUTBUILDING / ANNEX. Checked first so "Pool House Ground" / "… Basement" don't
    // fall into the house's GF / BA ranks. Below-ground outbuilding levels sort after their building.
    if (code === 'PH' || code === 'OB' || code === 'PHB' || code === 'OBB'
        || /POOL ?HOUSE|OUTBUILDING|ANNEXE?\b/.test(code)) {
      return 1800 + ((code === 'PHB' || code === 'OBB' || /BASEMENT|PLANT|LOWER/.test(code)) ? 10 : 0);
    }
    // Ground floor first — code 'GF' / 'G' / '0F' or name containing 'GROUND'
    if (code === 'GF' || code === 'G' || code === '0F') return 0;
    // Check sub-ground variants BEFORE the GROUND prefix check so
    // "Lower Ground" doesn't get swallowed by the 'GROUND' substring
    // match below. v5.5.75 — rank changed from -1 (first-of-deck, before
    // Ground) to 990 (basement-like, just before BA at 1000). Per Bryn
    // canonical sort GF → 1F → 2F → BA → EXT, Lower Ground reads as a
    // sub-ground / basement-adjacent level and belongs near the bottom
    // of the floor stack, NOT the top. Bryn flagged v5.5.71 export
    // showing "Lower Ground Floor" as Floor 1 of 3 — that was the -1
    // ranking; now it lands at Floor N of N (just above BA / EXT).
    if (code === 'LG' || code.indexOf('LOWER GROUND') !== -1) return 990;
    if (code.indexOf('GROUND') !== -1) return 0;
    // Numbered short codes — '1F' / '2F' / 'F1' / 'F2'
    const shortNum = code.match(/^(\d+)F$/) || code.match(/^F(\d+)$/);
    if (shortNum) return parseInt(shortNum[1], 10);
    // "1st Floor" / "2nd Floor" / "3rd Floor" / "4th Floor" etc.
    const ordNum = code.match(/^(\d+)(ST|ND|RD|TH)\s+FLOOR/);
    if (ordNum) return parseInt(ordNum[1], 10);
    // "Floor 1" / "Floor 2"
    const floorN = code.match(/^FLOOR\s+(\d+)/);
    if (floorN) return parseInt(floorN[1], 10);
    // Ordinal words — "First Floor", "Second Floor", "Third Floor" …
    // Match the FIRST word of the code against the ordinal map.
    const firstWord = code.split(/\s+/)[0];
    if (_ORDINAL_WORDS[firstWord] != null) return _ORDINAL_WORDS[firstWord];
    // Plain leading digit "1 FLOOR" / "01" / "1"
    const plainNum = code.match(/^(\d+)$/) || code.match(/^(\d+)\s+/);
    if (plainNum) return parseInt(plainNum[1], 10);
    // Basement always near the end (after numbered floors)
    if (code === 'BA' || code.indexOf('BASEMENT') !== -1
        || code.indexOf('CELLAR') !== -1) return 1000;
    // Roof / loft variants (post-basement, pre-exterior)
    if (code.indexOf('ROOF') !== -1 || code.indexOf('LOFT') !== -1
        || code.indexOf('ATTIC') !== -1) return 1500;
    // Exterior absolute last (after basement / roof)
    if (code === 'EXT' || code === 'EXTERIOR' || code === 'EXTERNAL'
        || code.indexOf('EXTERIOR') !== -1 || code.indexOf('EXTERNAL') !== -1
        || code.indexOf('OUTSIDE') !== -1 || code.indexOf('OUTDOOR') !== -1
        || code === 'GARDEN' || code === 'EXT.' || code.indexOf('GROUNDS') !== -1)
      return 2000;
    // Unknowns sorted last in original order (rank 9999 → stable)
    return 9999;
  }
  function sonorSortFloors(floors) {
    if (!Array.isArray(floors)) return floors;
    // Stable sort: pair with index, sort by (rank, originalIndex), strip index.
    return floors
      .map((f, i) => ({ f, i, r: _floorRank(f) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map(x => x.f);
  }

  // ---------------------------------------------------------------
  // Service canonical sort order
  // ---------------------------------------------------------------
  // Bryn directive 2026-05-11 — "blocks or services etc should be
  // 01 / 02 / 03 .... in order of services". Canonical Sonor service
  // numbering per workspace CLAUDE.md (the 10 services + their NNs):
  //   01 Cinema · 02 Audio · 03 Video · 04 Lighting · 05 Automation
  //   06 Climate · 07 Control · 08 Security · 09 Network · 10 Infrastructure
  //
  // Single source of truth for: Cable Schedule (cluster sort), Blocks
  // Schedule (NN.sub sort), CSV exports, PDF reports — every cross-
  // service ordering across the Takeoffs / Cinema apps / Print suite
  // routes through this so they stay identical without per-app drift.
  //
  // Inputs accepted (per-item):
  //   - { service_nn: '01' | 1 | '1', ... }
  //   - { service: 'cinema', ... }   (case-insensitive key match)
  //   - { nn: '01', ... }            (legacy field name on some records)
  //   - Plain string '01' | 'cinema' | '01 Cinema' | 'CINEMA'
  //
  // Returns a NEW sorted array — does not mutate input. Unknown items
  // sink to the end in original order (stable). Same pattern as
  // sonorSortFloors above.
  const _SERVICE_KEY_TO_NN = {
    cinema: 1,  audio: 2,  video: 3,  lighting: 4, automation: 5,
    climate: 6, control: 7, security: 8, network: 9,  infrastructure: 10,
    // Legacy aliases — keep here so older records still rank correctly.
    hvac: 6,    cctv: 8,    networking: 9, infra: 10
  };
  function sonorServiceRank(item) {
    if (item == null) return 9999;
    if (typeof item === 'number') return item > 0 && item <= 10 ? item : 9999;
    if (typeof item === 'string') {
      const s = item.trim();
      // Leading "NN " or "NN." or just "NN"
      const numHead = s.match(/^(\d{1,2})\b/);
      if (numHead) {
        const n = parseInt(numHead[1], 10);
        if (n >= 1 && n <= 10) return n;
      }
      const lower = s.toLowerCase().replace(/[^a-z]/g, '');
      if (_SERVICE_KEY_TO_NN[lower] != null) return _SERVICE_KEY_TO_NN[lower];
      return 9999;
    }
    if (typeof item === 'object') {
      // Prefer explicit service_nn / nn fields.
      const nnRaw = item.service_nn != null ? item.service_nn
                  : item.nn != null ? item.nn
                  : null;
      if (nnRaw != null) {
        const n = parseInt(String(nnRaw).replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
      }
      if (item.service) return sonorServiceRank(item.service);
      if (item.service_key) return sonorServiceRank(item.service_key);
      if (item.service_name) return sonorServiceRank(item.service_name);
      if (item.aspect) return sonorServiceRank(item.aspect);
    }
    return 9999;
  }
  function sonorSortServices(items) {
    if (!Array.isArray(items)) return items;
    return items.slice()
      .map((x, i) => ({ x, i, r: sonorServiceRank(x) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map(o => o.x);
  }

  // ---------------------------------------------------------------
  // Device placement maps — rack vs end-point classification.
  //
  // SSOT for every app that needs to filter/display device_catalogue
  // rows by physical placement. Exposed as:
  //   window.SONOR_RACK_CATEGORIES    — Set of category strings
  //   window.SONOR_ENDPOINT_CATEGORIES — Set of category strings
  //   SonorApp.isRackDevice(cat)
  //   SonorApp.isEndpointDevice(cat)
  //
  // Library uses these for the Devices tab Rack/End Points filter.
  // Project Master, Network Map etc. can read the same Sets without
  // maintaining a local copy (no islands, no drift).
  //
  // When a new category is added to device_catalogue, update BOTH Sets
  // here and run sync-everything.sh — one edit, all apps benefit.
  // ---------------------------------------------------------------
  var SONOR_RACK_CATEGORIES = new Set([
    'amplifier', 'bridge', 'conditioner', 'controller', 'hdbt_transmitter',
    'hdd', 'hub', 'io_expander', 'lighting_dimmer', 'lighting_processor',
    'matrix_audio', 'matrix_video', 'media_player', 'multiviewer', 'nvr',
    'patch_panel', 'pdu', 'processor', 'rack', 'rack_accessory', 'receiver',
    'router', 'streamer', 'switch', 'ups'
  ]);

  var SONOR_ENDPOINT_CATEGORIES = new Set([
    'camera', 'hdbt_receiver', 'hdmi_ip_rx', 'intercom', 'intercom_monitor',
    'keypad', 'mk_sound', 'motion_sensor', 'presence_sensor', 'projector', 'projector_lift',
    'remote', 'speaker', 'subwoofer', 'thermostat', 'touchscreen',
    'tv', 'tv_lift', 'tv_mount', 'tv_outdoor', 'wap'
  ]); // v5.5.39 — added mk_sound (M&K Sound own category)

  function sonorDevicePlacement(category) {
    var c = String(category || '').toLowerCase();
    if (SONOR_RACK_CATEGORIES.has(c))     return 'rack';
    if (SONOR_ENDPOINT_CATEGORIES.has(c)) return 'endpoint';
    return 'unknown';
  }

  // ---------------------------------------------------------------
  // Boot log so engineers can verify which sort version is actually
  // loaded in the browser (catches stale-cache cases where the
  // synced file is on disk but the browser is running an older copy).
  // v5.5.37 — added after Bryn 2026-05-11 reported floor sort still
  // wrong after v5.5.36 ship — turned out to be cache, not code.
  // ---------------------------------------------------------------
  try {
    const _testSort = sonorSortFloors(['First Floor', 'Ground Floor']);
    console.info('[Sonor sort] sonor-app.js loaded — version v5.5.39+ '
      + (Array.isArray(_testSort) && _testSort[0] === 'Ground Floor'
          ? '(floor sort: GF before 1F ✓)'
          : '(floor sort: BROKEN — got ' + JSON.stringify(_testSort) + ')'));
  } catch (_) {}

  // ---------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------
  global.SonorApp = {
    __loaded: true,
    init: init,
    initSupabase: initSupabase,
    setAppSource: setAppSource,
    getAppSource: getAppSource,
    updateDbStatusIndicator: updateDbStatusIndicator,
    setVersionBadge: setVersionBadge,
    sortFloors: sonorSortFloors,
    floorRank: _floorRank,
    sortServices: sonorSortServices,
    serviceRank: sonorServiceRank,
    // Device placement SSOT (v5.5.38)
    rackCategories:      SONOR_RACK_CATEGORIES,
    endpointCategories:  SONOR_ENDPOINT_CATEGORIES,
    devicePlacement:     sonorDevicePlacement,
    isRackDevice:        function(cat) { return SONOR_RACK_CATEGORIES.has(String(cat||'').toLowerCase()); },
    isEndpointDevice:    function(cat) { return SONOR_ENDPOINT_CATEGORIES.has(String(cat||'').toLowerCase()); }
  };

  // Also expose at top-level for direct (non-namespaced) call sites — matches
  // the pattern Bryn / Takeoffs proposal expects: `sonorSortFloors(floors)`.
  if (typeof global.sonorSortFloors === 'undefined') {
    global.sonorSortFloors = sonorSortFloors;
  }
  if (typeof global.sonorSortServices === 'undefined') {
    global.sonorSortServices = sonorSortServices;
  }
  if (typeof global.sonorServiceRank === 'undefined') {
    global.sonorServiceRank = sonorServiceRank;
  }
  // v5.5.36 — Floor rank exposed for callers that need a comparator key
  // directly (e.g. mixed-comparator paths where floor + service rank
  // are combined into a single sort numeric).
  if (typeof global.sonorFloorRank === 'undefined') {
    global.sonorFloorRank = _floorRank;
  }
  // v5.5.38 — Device placement Sets exposed at top level so any app
  // can write: SONOR_RACK_CATEGORIES.has(cat) without namespacing.
  if (typeof global.SONOR_RACK_CATEGORIES === 'undefined') {
    global.SONOR_RACK_CATEGORIES    = SONOR_RACK_CATEGORIES;
    global.SONOR_ENDPOINT_CATEGORIES = SONOR_ENDPOINT_CATEGORIES;
    global.sonorDevicePlacement      = sonorDevicePlacement;
  }

  // 2026-09-29 (sonor-platform §12, spec sweep) — INK BY LUMINANCE, shared. Text/glyph on a computed fill (a service
  // colour, a status hex) is dark on bright fills and white on deep ones. Was Master Hub-only (_inkFor); now every
  // app: sonorInkFor('#f5d05c') → '#0B1A22', sonorInkFor('#8058a1') → '#fff'. Accepts #rgb/#rrggbb/rgb().
  function sonorInkFor(colour) {
    var s = String(colour || '').trim(), r, g, b, m;
    if ((m = s.match(/^#?([0-9a-f]{3})$/i))) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
    else if ((m = s.match(/^#?([0-9a-f]{6})/i))) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); }
    else if ((m = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/))) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else return '#fff';
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#0B1A22' : '#fff';
  }
  if (typeof global.sonorInkFor === 'undefined') global.sonorInkFor = sonorInkFor;
  if (global.SonorApp && !global.SonorApp.inkFor) global.SonorApp.inkFor = sonorInkFor;

})(typeof window !== 'undefined' ? window : this);
