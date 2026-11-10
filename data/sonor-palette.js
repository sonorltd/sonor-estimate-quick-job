// ─────────────────────────────────────────────────────────────────────────
// SONOR PALETTE — workspace-shared Cmd/Ctrl+K command palette  v1.0.0
// Extracted from APP - Tasks (sonor-tasks.html v2.71.x, B-317 / GEL 2.0).
// Master lives at workspace root; synced per-repo by sync-everything.sh.
// NEVER edit a per-app copy (Spine S-4.2).
//
// Usage (normally via SonorShell.mount — direct use also fine):
//   SonorPalette.init({
//     placeholder: 'Type a command…',
//     providers: [
//       SonorPalette.providers.apps(),          // built-in: switch Sonor app
//       function (q) { return [{ id, label, hotkey, run }]; }   // app-local
//     ],
//     gnav: { t: () => showView('table') },     // optional G-prefix key map
//     maxEmpty: 16, maxFiltered: 12
//   });
//   SonorPalette.open() / .close() / .toggle()
//
// Provider contract: fn(query:string) -> array of {id, label, hotkey?, run}
//   - called on every keystroke; keep it cheap (slice your arrays)
//   - items are concatenated in provider order, then filtered by label
//   - DATASETS RULE (DECISIONS 2026-06-10): built-in providers touch only
//     shared sources (__SONOR_BRAND__.appUrls). App tables stay app-owned —
//     pass app-local providers from the app's own code.
// ─────────────────────────────────────────────────────────────────────────
(function (global) {
  'use strict';
  if (global.SonorPalette && global.SonorPalette.__loaded) return;

  var PALETTE_VERSION = '1.0.0';
  var _cfg = null;
  var _focus = 0;
  var _els = null;       // { backdrop, input, list }
  var _pendingG = false;
  var _pendingGTimer = null;

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── DOM (injected once; styles live in sonor-shell.css) ──
  function _ensureDom() {
    if (_els) return _els;
    var backdrop = document.createElement('div');
    backdrop.className = 'sonor-palette-backdrop';
    backdrop.id = 'sonor-palette-backdrop';
    backdrop.innerHTML =
      '<div class="sonor-palette" role="dialog" aria-modal="true" aria-label="Command palette">' +
      '<input id="sonor-palette-input" placeholder="' + _esc((_cfg && _cfg.placeholder) || 'Type a command…') + '" autocomplete="off" spellcheck="false">' +
      '<ul id="sonor-palette-list" role="listbox"></ul></div>';
    document.body.appendChild(backdrop);
    _els = {
      backdrop: backdrop,
      input: backdrop.querySelector('#sonor-palette-input'),
      list: backdrop.querySelector('#sonor-palette-list')
    };
    _els.input.addEventListener('input', function () { _focus = 0; _render(_els.input.value); });
    _els.input.addEventListener('keydown', function (e) {
      var items = _items(_els.input.value);
      if (e.key === 'ArrowDown') { e.preventDefault(); _focus = Math.min(items.length - 1, _focus + 1); _render(_els.input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _focus = Math.max(0, _focus - 1); _render(_els.input.value); }
      else if (e.key === 'Enter') { e.preventDefault(); var it = items[_focus]; if (it) { close(); _run(it); } }
      else if (e.key === 'Escape') { close(); }
    });
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    return _els;
  }

  function _run(it) {
    try { it.run(); } catch (e) { console.warn('[SonorPalette] command failed:', it.id, e && e.message); }
  }

  function _items(q) {
    var query = (q || '').toLowerCase().trim();
    var all = [];
    var provs = (_cfg && _cfg.providers) || [];
    for (var i = 0; i < provs.length; i++) {
      try {
        var got = provs[i](query);
        if (got && got.length) all = all.concat(got);
      } catch (e) { /* one bad provider never kills the palette */ }
    }
    if (!query) return all.slice(0, (_cfg && _cfg.maxEmpty) || 16);
    return all.filter(function (it) {
      return String(it.label || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, (_cfg && _cfg.maxFiltered) || 12);
  }

  function _render(q) {
    var els = _ensureDom();
    var items = _items(q);
    els.list.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      if (i === _focus) li.classList.add('focus');
      li.innerHTML = '<span>' + _esc(it.label) + '</span>' +
        (it.hotkey ? '<span class="hotkey">' + _esc(it.hotkey) + '</span>' : '');
      li.addEventListener('click', function () { close(); _run(it); });
      els.list.appendChild(li);
    });
  }

  function open() {
    var els = _ensureDom();
    els.backdrop.classList.add('open');
    els.input.value = '';
    _focus = 0;
    _render('');
    setTimeout(function () { els.input.focus(); }, 0);
  }
  function close() { if (_els) _els.backdrop.classList.remove('open'); }
  function isOpen() { return !!(_els && _els.backdrop.classList.contains('open')); }
  function toggle() { isOpen() ? close() : open(); }

  // ── Global keyboard wiring (Cmd/Ctrl+K + optional G-prefix nav) ──
  function _onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault(); toggle(); return;
    }
    if (e.key === 'Escape' && isOpen()) { close(); return; }
    var tag = (e.target && e.target.tagName) || '';
    var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (e.target && e.target.isContentEditable);
    if (inField || e.metaKey || e.ctrlKey || e.altKey || isOpen()) return;
    var gnav = _cfg && _cfg.gnav;
    if (!gnav) return;
    if (!_pendingG && (e.key === 'g' || e.key === 'G')) {
      _pendingG = true;
      clearTimeout(_pendingGTimer);
      _pendingGTimer = setTimeout(function () { _pendingG = false; }, 800);
      return;
    }
    if (_pendingG) {
      var fn = gnav[String(e.key).toLowerCase()];
      _pendingG = false;
      clearTimeout(_pendingGTimer);
      if (fn) { e.preventDefault(); try { fn(); } catch (err) { /* app handler */ } }
    }
  }

  function init(cfg) {
    _cfg = cfg || {};
    if (!_cfg.providers) _cfg.providers = [];
    document.addEventListener('keydown', _onKeydown);
    return api;
  }

  // ── Built-in providers (shared sources only — datasets rule) ──
  var providers = {
    // Switch to any registered Sonor app. Reads __SONOR_BRAND__.appUrls,
    // honours the current source toggle (hosted default, S-4.x).
    apps: function (opts) {
      opts = opts || {};
      return function () {
        var B = global.__SONOR_BRAND__ || {};
        var urls = B.appUrls || {};
        var src = (global.appSource === 'local') ? 'local' : 'hosted';
        var set = urls[src] || {};
        var labels = B.appNames || {};
        return Object.keys(set).filter(function (k) { return k !== opts.selfKey; })
          .map(function (k) {
            return {
              id: 'app:' + k,
              label: 'Open app: ' + (labels[k] || k),
              hotkey: '↗',
              run: function () { global.location.href = set[k]; }
            };
          });
      };
    },
    // Static command list helper: providers.commands([{id,label,hotkey,run}])
    commands: function (list) { return function () { return list || []; }; }
  };

  var api = {
    __loaded: true,
    version: PALETTE_VERSION,
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    providers: providers
  };
  global.SonorPalette = api;
})(typeof window !== 'undefined' ? window : this);
