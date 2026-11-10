// ─────────────────────────────────────────────────────────────────────────
// SONOR SHELL — workspace-shared app chrome orchestrator  v1.0.0
// B-317 / GEL 2.0 — Spine v1.3 §21 (S-4.21). Contract: docs/SONOR-SHELL-SPEC.md
// Master at workspace root; synced per-repo by sync-everything.sh (S-4.2).
//
// The shell COMPOSES the existing proven modules rather than replacing them
// (CAPABILITY-AWARE RE-ANALYSIS, 2026-06-10): SonorHeader (header chrome),
// SonorApp (version badge + source toggle + Supabase phase-2 + self-report),
// SonorPalette (Cmd+K). It adds: unified toasts, boot self-test + health
// ping, optional edit-primitive autoload, optional project-bus autoload.
//
// DATASETS RULE (binding — DECISIONS 2026-06-10): the shell NEVER reads
// app tables. Apps differ in function + datasets; everything app-specific
// arrives through the manifest.
//
// Usage:
//   const shell = SonorShell.mount({
//     appKey: 'inventory', appName: 'Inventory', repo: 'sonor-inventory',
//     version: APP_VERSION,
//     faviconHref: '../data/favicon.svg',     // dashboard apps only
//     supabase: true,        // shell runs SonorApp phase-2 → shell.db ready
//                            // false → app manages its own SonorDB and may
//                            //         call SonorShell.dbStatus(state)
//     palette: { self: 'inventory', providers: [fnOrItems…], gnav: {…} },
//     edit: false,           // true → autoload sonor-edit-ui/panel (synced copies)
//     project: false,        // true → autoload project bus + bar (synced copies)
//     assetBase: 'data/'     // 'data/' (root apps) | '../data/' (dashboard apps)
//   });
//   shell.ready.then(({db, supaReady}) => { … });     // when supabase:true
//   SonorShell.toast('Saved', {kind:'ok'});
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  'use strict';
  if (global.SonorShell && global.SonorShell.__loaded) return;

  var SHELL_VERSION = '1.1.1'; // v1.1.1: versionId passthrough (Master Hub's hubVersion badge)
  var _manifest = null;
  var _toastEl = null;
  var _toastTimer = null;
  var _selfTestResult = null;

  // ── Toasts (ARIA live region; styles in sonor-shell.css) ──
  function toast(msg, opts) {
    opts = opts || {};
    if (typeof opts === 'string') opts = { kind: opts };           // toast(msg,'ok')
    var kind = opts.kind === 'err' ? 'error' : (opts.kind || 'info'); // accept legacy 'err'
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'sonor-shell-toast';
      _toastEl.setAttribute('role', 'status');
      _toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = String(msg == null ? '' : msg);
    _toastEl.className = 'show ' + kind;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { _toastEl.className = ''; }, opts.ms || 2800);
  }

  // ── Script/CSS autoloading (synced per-repo copies, never CDN) ──
  function _load(src, isCss) {
    return new Promise(function (resolve) {
      var sel = isCss ? 'link[href="' + src + '"]' : 'script[src="' + src + '"]';
      if (document.querySelector(sel)) return resolve(true);
      var el;
      if (isCss) { el = document.createElement('link'); el.rel = 'stylesheet'; el.href = src; }
      else { el = document.createElement('script'); el.src = src; }
      el.onload = function () { resolve(true); };
      el.onerror = function () { console.warn('[SonorShell] failed to load', src); resolve(false); };
      document.head.appendChild(el);
    });
  }

  // ── Boot self-test (the B-250 class-killer) ──
  // Checks the assembly, not the app: theme rendered, brand.css live,
  // required shared modules present, version badge set. Result logged loud
  // + pinged to app_versions.metadata.health when a db handle exists.
  function selfTest(db) {
    var m = _manifest || {};
    var checks = {};
    try {
      checks.theme_declared = (document.documentElement.getAttribute('data-theme') || '') !== '';
      var s01 = getComputedStyle(document.documentElement).getPropertyValue('--s01').trim();
      checks.brand_css_live = s01 !== '';                       // synced data/brand.css loaded
      checks.header_mounted = !!document.querySelector('#sonor-header .logo');
      checks.version_badge = !!(document.getElementById('nav-version') || {}).textContent;
      checks.sonor_brand_js = !!global.__SONOR_BRAND__;
      checks.sonor_db_js = typeof global.SonorDB !== 'undefined';
      checks.palette = !!(global.SonorPalette && global.SonorPalette.__loaded);
      (m.requires || []).forEach(function (g) { checks['requires_' + g] = !!global[g]; });
    } catch (e) { checks.exception = String(e && e.message); }
    var fails = Object.keys(checks).filter(function (k) { return checks[k] === false; });
    _selfTestResult = { ok: fails.length === 0, checks: checks, fails: fails };
    if (fails.length) {
      console.error('%c[SonorShell] SELF-TEST FAIL — ' + fails.join(', '),
        'color:#fff;background:#c0392b;padding:2px 6px;border-radius:3px');
    } else {
      console.info('[SonorShell] self-test ✓ (' + Object.keys(checks).length + ' checks)');
    }
    _pingHealth(db);
    return _selfTestResult;
  }

  function _pingHealth(db) {
    // Fire-and-forget. RLS allows UPDATE on app_versions; merge into metadata.
    try {
      var m = _manifest || {};
      if (!db || !db.client || !m.appKey || !_selfTestResult) return;
      var payload = {
        at: new Date().toISOString(),
        shell: SHELL_VERSION,
        app_version: m.version || null,
        ok: _selfTestResult.ok,
        fails: _selfTestResult.fails
      };
      db.client.from('app_versions').select('metadata').eq('app_key', m.appKey).single()
        .then(function (res) {
          var meta = (res && res.data && res.data.metadata) || {};
          meta.health = payload;
          return db.client.from('app_versions').update({ metadata: meta }).eq('app_key', m.appKey);
        })
        .then(function () { /* ok */ }, function () { /* nice-to-have */ });
    } catch (e) { /* never let health-ping break an app */ }
  }

  // ── DB status passthrough (apps managing their own SonorDB) ──
  function dbStatus(state, text) {
    if (global.SonorHeader) global.SonorHeader.updateDbStatus(state, text);
  }

  // ── Unload-flush registry (v1.1.0, B-334 — NEVER lose user-modified data) ──
  // The 2026-06-10 persistence sweep found 9 of 11 Supabase-writing apps had
  // debounced saves with NO unload safety net (only Leads + Library had hand-
  // rolled hooks). Apps register their immediate-flush fns once; the shell
  // wires the belt-and-braces trio of lifecycle hooks (per Leads v3.6.11):
  //   beforeunload (desktop close/nav) + pagehide (mobile-reliable, bfcache)
  //   + visibilitychange→hidden (mobile backgrounding, fires while tab lives).
  // Flush fns MUST be synchronous-start + fire-and-forget safe + idempotent
  // (they can run several times) and MUST NOT clear dirty-sets on unknowable
  // outcomes (the Leads v4.1.2 lesson).
  var _flushFns = [];
  var _flushHooked = false;
  function _runFlush() {
    for (var i = 0; i < _flushFns.length; i++) {
      try { _flushFns[i](); } catch (e) { /* one bad flush never blocks the rest */ }
    }
  }
  function onFlush(fn) {
    if (typeof fn !== 'function') return;
    _flushFns.push(fn);
    if (_flushHooked) return;
    _flushHooked = true;
    global.addEventListener('beforeunload', _runFlush);
    global.addEventListener('pagehide', _runFlush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') _runFlush();
    });
  }

  // ── mount ──
  function mount(m) {
    _manifest = m = m || {};
    var base = m.assetBase || 'data/';

    // 1. Header (existing proven module — header markup target #sonor-header)
    if (global.SonorHeader) {
      global.SonorHeader.init({
        appName: m.appName || m.appKey || 'App',
        repo: m.repo || '',
        faviconHref: m.faviconHref,
        showLinks: m.showLinks === true,
        versionId: m.versionId // optional custom badge id (Master Hub: 'hubVersion')
      });
      if (m.versionId && m.version) {
        try { var bv = document.getElementById(m.versionId); if (bv) bv.textContent = 'v' + m.version; } catch (e) {}
      }
    } else {
      console.warn('[SonorShell] SonorHeader not loaded — load data/sonor-header.js before sonor-shell.js');
    }

    // 2. Palette (Cmd/Ctrl+K) — built-in app-switcher + app-local providers
    if (global.SonorPalette) {
      var provs = [];
      var p = m.palette || {};
      if (p.apps !== false) provs.push(global.SonorPalette.providers.apps({ selfKey: p.self || m.appKey }));
      (p.providers || []).forEach(function (pr) {
        provs.push(typeof pr === 'function' ? pr : global.SonorPalette.providers.commands(pr));
      });
      global.SonorPalette.init({ providers: provs, gnav: p.gnav, placeholder: p.placeholder });
    }

    // 3. Optional autoloads (synced copies in the app's data/ dir)
    var loads = [];
    if (m.edit) {
      loads.push(_load(base + 'sonor-edit-panel.css', true));
      loads.push(_load(base + 'sonor-edit-ui.js'));
      loads.push(_load(base + 'sonor-edit-panel.js'));
    }
    if (m.project) {
      // Order matters: bus BEFORE bar (HARMONY §6 single-writer)
      loads.push(_load(base + 'sonor-project-bus.js').then(function () {
        return _load(base + 'sonor-project-bar.js');
      }));
    }

    // 4. Version badge + source toggle + (optional) Supabase phase-2.
    //    SonorApp.init handles all of it; supabase:false → badge+toggle only.
    var ready;
    if (m.supabase && global.SonorApp && global.SonorApp.init) {
      ready = global.SonorApp.init({
        appKey: m.appKey, appName: m.appName, repo: m.repo, appVersion: m.version
      }).then(function (res) {
        selfTest(res && res.supaDb);
        return { db: res && res.supaDb, supaReady: !!(res && res.supaReady) };
      });
    } else {
      // Badge without a second SonorDB instance (source-toggle wiring stays
      // with the app's existing code in supabase:false mode — SonorApp.init
      // is the only exported path that wires it).
      try {
        if (global.SonorApp && global.SonorApp.setVersionBadge) global.SonorApp.setVersionBadge(m.version);
        else { var el = document.getElementById('nav-version'); if (el && m.version) el.textContent = 'v' + m.version; }
      } catch (e) { /* fine */ }
      // App owns its db — run the self-test after first paint; the app can
      // call SonorShell.selfTest(db) again post-connect for the health ping.
      ready = Promise.all(loads).then(function () {
        setTimeout(function () { selfTest(null); }, 400);
        return { db: null, supaReady: false };
      });
    }

    return { ready: ready, toast: toast, selfTest: selfTest, dbStatus: dbStatus };
  }

  global.SonorShell = {
    __loaded: true,
    version: SHELL_VERSION,
    mount: mount,
    toast: toast,
    selfTest: selfTest,
    dbStatus: dbStatus,
    onFlush: onFlush
  };
})(typeof window !== 'undefined' ? window : this);
