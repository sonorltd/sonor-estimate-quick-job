/**
 * sonor-theme.js — ONE theme switch for every back-end app (sonor-kit, B-487, 2026-09-29).
 * Bryn: "dark theme for apps throughout… constant, neutral grey with service accents… back just in case".
 *
 *   Themes come from brand.css ([data-theme='graphite'] = macOS-dark neutral grey, the back-end default going forward;
 *   'slate' = the light fallback). Service colours never change. Client-facing surfaces opt out with data-theme-lock.
 *
 *   Load EARLY (classic script, before the app's CSS paints) — the kit loader also loads it, but for a flash-free boot
 *   put it first:  <script src="https://apps.sonor.co.uk/sonor-kit/v1/modules/sonor-theme.js"></script>
 *   Persists the choice in localStorage 'sonor-theme' (shared by every app on the same origin… and, because every app
 *   is its own GitHub Pages origin, also mirrored into the URL-free cookie 'sonor_theme' on .github.io so the choice
 *   follows you across apps). A ◐ toggle mounts itself into the shared header (.header-right) or project bar when present.
 *
 *   API: SonorTheme.get() → 'graphite'|'slate'|…  SonorTheme.set(name)  SonorTheme.toggle()  SonorTheme.mount(host)
 *        SonorTheme.ladder() — re-run the bar ladder (v0.3.0)
 *   Event: document 'sonor:theme' { theme }
 *
 *   v0.3.0/0.3.1 (sonor-platform §9, 2026-09-29 — Bryn: "still doesn't look right… get this right everywhere"): THE BAR LADDER IS POSITIONAL.
 *   Every full-width bar under the shared header takes the next step (--bar-2 → --bar-3 → --bar-4) in VISUAL order, whatever
 *   its role — a project bar above the tab bar is step 2, the tab bar below it step 3. Before this the steps were bound to
 *   roles (.tab-bar = 2, project bar = 3) so any app that stacks project-bar-first rendered the ladder inverted, with the
 *   tab bar sinking into the page background. v0.3.1: candidates are found by SHAPE (full-width opaque strips under the header)
 *   so app-named bars (.project-bar, .tabbar, .set-nav, .portal-subhead…) are covered without listing them; [data-bar] opts a
 *   narrower strip in, data-bar-fixed opts out. Applied as inline background so it wins over per-module injected CSS.
 */
(function (global) {
  'use strict';
  var VERSION = '0.3.4';
  var KEY = 'sonor-theme', COOKIE = 'sonor_theme';
  var DARK = 'graphite', LIGHT = 'slate';
  var doc = global.document; if (!doc) { global.SonorTheme = { VERSION: VERSION }; return; }
  if (global.SonorTheme && global.SonorTheme.set) return;   // v0.2.0 — the local boot copy (data/sonor-theme.js) already ran; the served one is additive
  var html = doc.documentElement;
  var locked = html.hasAttribute('data-theme-lock');

  function readCookie() { var m = doc.cookie.match(/(?:^|;\s*)sonor_theme=([a-z-]+)/); return m ? m[1] : null; }
  function writeCookie(v) { try { var d = new Date(Date.now() + 365 * 864e5).toUTCString(); doc.cookie = COOKIE + '=' + v + '; expires=' + d + '; path=/; SameSite=Lax' + (/github\.io$/.test(location.hostname) ? '; domain=.github.io' : ''); } catch (_) {} }
  // v0.3.3 — only the two family themes are valid choices. Legacy values left behind by older per-app toggles
  // ('dark' / 'nocturne' → graphite, 'light' / 'earthy' → slate, anything else → graphite) used to land on <html>
  // verbatim: brand.css painted a legacy palette while the kit's [data-theme='graphite'] bar ladder never matched,
  // so bars + table heads went light on a dark page (Bryn's Board screenshot 2026-09-30 08:28).
  function normalise(v) { if (!v) return null; v = String(v).toLowerCase(); if (v === DARK || v === LIGHT) return v; if (v === 'light' || v === 'earthy' || v === 'slate-light') return LIGHT; return DARK; }
  function stored() { var raw; try { raw = localStorage.getItem(KEY) || readCookie(); } catch (_) { raw = readCookie(); } var v = normalise(raw); if (v && v !== raw) { try { localStorage.setItem(KEY, v); } catch (_) {} writeCookie(v); } return v; }
  function get() { return html.getAttribute('data-theme') || LIGHT; }
  function set(name, opts) {
    if (!name) return get();
    html.setAttribute('data-theme', name);
    if (!(opts && opts.silent)) { try { localStorage.setItem(KEY, name); } catch (_) {} writeCookie(name); }
    html.style.colorScheme = (name === DARK || name === 'nocturne' || name === 'dark') ? 'dark' : 'light';
    doc.querySelectorAll('.sonor-theme-btn').forEach(paint);
    doc.dispatchEvent(new CustomEvent('sonor:theme', { detail: { theme: name } }));
    return name;
  }
  function toggle() { return set(get() === DARK ? LIGHT : DARK); }
  function paint(btn) { var dark = get() === DARK; btn.setAttribute('aria-pressed', dark ? 'true' : 'false'); btn.title = dark ? 'Graphite (dark) — click for the light fallback' : 'Slate (light) — click for graphite'; btn.innerHTML = dark ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'; }
  function mount(host) {
    host = typeof host === 'string' ? doc.querySelector(host) : host; if (!host || host.querySelector('.sonor-theme-btn')) return null;
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'sonor-theme-btn';
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--border-strong,rgba(255,255,255,.2));background:transparent;color:inherit;cursor:pointer;opacity:.85';
    b.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    paint(b); host.appendChild(b); return b;
  }
  function autoMount() {
    if (locked) return;
    var tries = 0, t = setInterval(function () {
      var host = doc.querySelector('.header .header-right') || doc.querySelector('.sonor-project-bar .meta') || doc.querySelector('.sonor-header-right');
      if (host) { mount(host); clearInterval(t); } else if (++tries > 40) clearInterval(t);
    }, 250);
  }

  // v0.2.0 (sonor-platform §14) — the VOCAB layer: every app colour name → brand token, one generated file, every theme.
  // Injected right after this script so it sits after brand.css and, being unlayered `html[data-theme]`, beats any
  // leftover app palette. Served: ../vocab.css next to the modules; offline copy: data/sonor-vocab.css beside this file.
  (function injectVocab() {
    try {
      if (doc.getElementById('sonor-vocab-css')) return;
      var me = doc.currentScript || (function () { var ss = doc.getElementsByTagName('script'); for (var i = ss.length - 1; i >= 0; i--) if (/sonor-theme\.js/.test(ss[i].src)) return ss[i]; })();
      var src = me && me.src ? me.src : ''; if (!src) return;
      var href = /\/modules\/sonor-theme\.js/.test(src) ? src.replace(/\/modules\/sonor-theme\.js.*$/, '/vocab.css') : src.replace(/sonor-theme\.js.*$/, 'sonor-vocab.css');
      var l = doc.createElement('link'); l.id = 'sonor-vocab-css'; l.rel = 'stylesheet'; l.href = href;
      (me && me.parentNode ? me.parentNode : doc.head).insertBefore(l, me ? me.nextSibling : null);
    } catch (_) {}
  })();

  // v0.3.0 — positional bar ladder (see header comment). Runs after DOM ready + a few late ticks (project bar / shell mount async).
  var STEPS = ['--bar-2', '--bar-3', '--bar-4'];
  function ladder() {
    try {
      var vw = doc.documentElement.clientWidth || global.innerWidth || 0; if (!vw) return;
      var head = doc.querySelector('#sonor-header, .header, .sonor-shell-header, body > header'); var top0 = head ? head.getBoundingClientRect().bottom + global.scrollY : 0;
      var opaque = function (el) { var m = (getComputedStyle(el).backgroundColor || '').match(/[\d.]+/g); return !!m && (m[3] === undefined || +m[3] >= 0.5); };
      // v0.3.1 — bars are found by SHAPE, not by class: any full-width opaque strip stacked under the header
      // (left ≤ 8px, width ≥ 95vw, 18–120px tall, within 320px of the header) — plus anything that opts in with [data-bar].
      // Inset panels (canvas toolbars, banners with margins) are not bars. Nested strips collapse into their outer bar.
      var all = Array.prototype.slice.call(doc.querySelectorAll('body *')).filter(function (el) {
        if (el.hasAttribute('data-bar-fixed') || (head && head.contains(el)) || el.closest('.s-paper,[data-bar-fixed],script,style,select,svg')) return false;
        var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' && !el.hasAttribute('data-bar')) return false;
        var r = el.getBoundingClientRect(); var top = r.top + global.scrollY;
        if (top < top0 - 2 || top > top0 + 320 || r.height < 18 || r.height > 120) return false;
        if (el.hasAttribute('data-bar')) return r.width >= vw * 0.6;   // v0.3.4 — an opt-in bar needs no background of its own: the ladder paints it
        return r.left <= 8 && r.width >= vw * 0.95 && opaque(el);
      });
      var outer = all.filter(function (el) { return !all.some(function (o) { return o !== el && o.contains(el); }); })
        .map(function (el) { return { el: el, top: el.getBoundingClientRect().top + global.scrollY }; })
        .sort(function (a, b) { return a.top - b.top; });
      var step = 0, lastTop = -1;
      outer.forEach(function (x) { if (Math.abs(x.top - lastTop) > 2) { if (lastTop >= 0) step = Math.min(step + 1, STEPS.length - 1); lastTop = x.top; }
        x.el.setAttribute('data-bar-step', String(step + 2)); x.el.style.background = 'var(' + STEPS[step] + ')'; x.el.style.borderBottom = '1px solid var(--bar-line, rgba(255,255,255,.08))'; });
    } catch (_) {}
  }
  function ladderLater() { if (locked) return; ladder(); [300, 1000, 2500, 5000].forEach(function (ms) { setTimeout(ladder, ms); }); }
  doc.addEventListener('sonor:theme', function () { setTimeout(ladder, 0); });

  // apply the remembered theme NOW (before first paint when loaded in <head>)
  if (!locked) { var s = stored() || normalise(get()); if (s && s !== get()) set(s, { silent: true }); else html.style.colorScheme = get() === DARK ? 'dark' : 'light'; }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { autoMount(); ladderLater(); }); else { autoMount(); ladderLater(); }

  global.SonorTheme = { VERSION: VERSION, get: get, set: set, toggle: toggle, mount: mount, ladder: ladder, DARK: DARK, LIGHT: LIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
