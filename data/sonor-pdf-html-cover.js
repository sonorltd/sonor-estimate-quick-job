// =============================================================================
// sonor-pdf-html-cover.js — orchestrator for HTML PDF cover rendering
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root.
// One responsibility: thin orchestrator that glues the modular pieces
// together. Loads the canonical CSS once, calls the template builder,
// renders into a hidden iframe via html2canvas, returns dataURL ready for
// jsPDF.addImage().
//
// Module stack:
//   sonor-pdf-html-cover.css          ← brand styles (canonical, edit here)
//   sonor-pdf-html-helpers.js         ← esc, statusColour, statusInkOn
//   sonor-pdf-html-components.js      ← serviceStrip, statusPill, etc
//   sonor-pdf-html-templates.js       ← buildCover, buildSectionDivider
//   sonor-pdf-html-cover.js  ← THIS  ← renderCover, renderSectionDivider
//
// Load order on host page (or in iframe):
//   1. helpers.js
//   2. components.js
//   3. templates.js
//   4. cover.js (this file)
//   PLUS html2canvas CDN
//
// Public API (window.SonorPdfHtmlCover):
//   renderCover(opts)            → Promise<{dataUrl, w, h}>
//   renderSectionDivider(opts)   → Promise<{dataUrl, w, h}>
//   available()                  → boolean (every dep loaded?)
//   setStylesheetUrl(url)        → override CSS source (default: relative
//                                  './sonor-pdf-html-cover.css')
//
// Diagnostic:
//   window.__SONOR_HTMLCOVER_LAST_ERROR__  — last thrown error
//   window.__SONOR_HTMLCOVER_LAST_PATH__   — 'rendered' / 'cached-css' / etc

(function () {
  'use strict';

  const MODULE_VERSION = '1.12.0';   // v1.12.0 — PAGE-NUMBER STAMP: each page with a footer 'PAGE n of T' reports where it sits (result.pageStamp: text box, colours, a clean background patch sampled from the raster) so a host can restamp the true numbers after assembly (Takeoffs Full Document, sonor-takeoffs-pdf 2.9.0); stampFor(dataUrl) for hosts that only see the image; v1.11.0 — waits that keep running in a background tab (MessageChannel, not setTimeout / rAF, when document.hidden) + a yield after each page; v1.10.0 — JPEG quality + text-page scale cap from the host quality preset (Takeoffs Draft was 68 MB); v1.9.0 — sonor-pdf-theme :root overrides appended to the stylesheet; v1.8.0 — measureSchedule + onLayout row-fit (Takeoffs v5.198.0)

  // ---- CSS cache ---------------------------------------------------------

  let _cssCache = null;
  let _cssUrl = null;  // resolved lazily when first render runs

  function _resolveDefaultCssUrl() {
    // Try to find this script's <script> tag and resolve the sibling CSS
    // file relative to it. Falls back to './sonor-pdf-html-cover.css'.
    // v1.5.0 — preserve any ?v=X.Y.Z cache-bust query string from the .js src
    // so the CSS gets the same cache-busting (otherwise stale CSS would still
    // be served while new HTML modules render with old styles — this exact
    // mismatch caused the v5.4.41 "reverted to old style" Ty Hwnnw export).
    if (typeof document === 'undefined') return './sonor-pdf-html-cover.css';
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || '';
        const m = src.match(/sonor-pdf-html-cover\.js(\?[^#]*)?/);
        if (m) {
          // m[1] holds the original query string (e.g. "?v=5.4.42") or undefined.
          const qs = m[1] || '';
          return src.replace(/sonor-pdf-html-cover\.js(\?[^#]*)?/, 'sonor-pdf-html-cover.css' + qs);
        }
      }
    } catch (_) {}
    return './sonor-pdf-html-cover.css';
  }

  async function _loadCss() {
    if (_cssCache != null) return _cssCache;
    const url = _cssUrl || _resolveDefaultCssUrl();
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('CSS fetch ' + r.status);
      _cssCache = await r.text();
      // v1.9.0 (2026-10-16) — sonor-pdf-theme.js :root overrides ride after the stylesheet: black/gold chrome + neutral greys
      try { if (window.SonorPdfTheme && typeof window.SonorPdfTheme.htmlCss === 'function') _cssCache += window.SonorPdfTheme.htmlCss(); } catch (_) {}
      return _cssCache;
    } catch (e) {
      console.warn('[SonorPdfHtmlCover] CSS load failed (' + url + ') — falling back to inline minimal styles:', e);
      // Minimal fallback so the page still renders something readable.
      _cssCache = `
        body { font-family: -apple-system, sans-serif; margin: 0; padding: 0; width: 1190px; height: 842px; }
        .hero { padding: 40px; background: #1a1f28; color: #fff; }
        .hero-title { font-size: 48px; font-weight: 800; margin: 20px 0; }
        .body { padding: 40px; }
      `;
      return _cssCache;
    }
  }

  // ---- Gilroy embed (v5.18.0) --------------------------------------------
  // The canonical CSS declares @font-face for Gilroy with ONLY local()
  // sources, so the brand font never loaded inside the render iframe — every
  // page rendered in the -apple-system fallback. Beyond being off-brand, the
  // fallback's whitespace metrics make html2canvas 1.4.1 DROP word spaces in
  // the footer title-block + at-a-glance cells (e.g. "BungalowTrial",
  // "QUANTITIESTBC"). Fetching the real Gilroy TTFs once and injecting them as
  // base64 @font-face gives html2canvas correct metrics → spaces preserved AND
  // the brand font actually renders. Fetch fails silently on file:// (the TTF
  // can't be read) → graceful fall-back to today's behaviour, no regression.

  let _gilroyFaceCache; // undefined = not tried, '' = unavailable, string = css

  function _resolveFontUrl(slug) {
    if (typeof document === 'undefined') return 'fonts/Gilroy-' + slug + '.ttf';
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || '';
        if (src.indexOf('sonor-pdf-html-cover.js') !== -1) {
          return src.replace(/sonor-pdf-html-cover\.js(\?[^#]*)?/, 'fonts/Gilroy-' + slug + '.ttf');
        }
      }
    } catch (_) {}
    return 'fonts/Gilroy-' + slug + '.ttf';
  }

  function _bufToB64(buf) {
    let bin = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return (typeof btoa === 'function') ? btoa(bin) : '';
  }

  async function _gilroyFaceCss() {
    if (_gilroyFaceCache !== undefined) return _gilroyFaceCache;
    // file:// can't fetch local binaries in most browsers — skip cleanly.
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
      _gilroyFaceCache = '';
      return _gilroyFaceCache;
    }
    const weights = [['Regular', 400], ['Medium', 600], ['Bold', 800]];
    const faces = [];
    for (let i = 0; i < weights.length; i++) {
      const slug = weights[i][0], wt = weights[i][1];
      try {
        const r = await fetch(_resolveFontUrl(slug), { credentials: 'same-origin' });
        if (!r.ok) continue;
        const b64 = _bufToB64(await r.arrayBuffer());
        if (!b64) continue;
        faces.push("@font-face{font-family:'Gilroy';font-weight:" + wt +
          ";font-style:normal;font-display:block;src:url(data:font/ttf;base64," +
          b64 + ") format('truetype');}");
      } catch (_) {}
    }
    _gilroyFaceCache = faces.length ? faces.join('\n') : '';
    return _gilroyFaceCache;
  }

  // ---- iframe pipeline ---------------------------------------------------

  // v1.11.0 (Takeoffs v5.274.0 — a 121-page Standard full document ran 50+ min) — a deck renders ~120 pages back to back; in a
  // BACKGROUND tab Chrome throttles setTimeout to 1 s, then to once a MINUTE after 5 min ("intensive throttling"), and pauses
  // requestAnimationFrame altogether — each page's 80 ms settle + rAF became a minute or a stall. When the document is hidden the
  // waits below run on MessageChannel ticks (not throttled); a visible tab is unchanged. _yieldPage() after each page lets the UI
  // paint and GC run between rasters.
  function _mcTick() { return new Promise(function (r) { try { const ch = new MessageChannel(); ch.port1.onmessage = function () { try { ch.port1.close(); } catch (_) {} r(); }; ch.port2.postMessage(0); } catch (_) { setTimeout(r, 0); } }); }
  function _hidden() { try { return typeof document !== 'undefined' && document.hidden === true; } catch (_) { return false; } }
  async function _sleep(ms) {
    if (!_hidden()) return new Promise(function (r) { setTimeout(r, ms); });
    const end = Date.now() + ms; while (Date.now() < end) await _mcTick();
  }
  function _frame() {
    return new Promise(function (r) {
      let done = false; const fin = function () { if (!done) { done = true; r(); } };
      if (!_hidden()) { try { requestAnimationFrame(fin); } catch (_) {} }
      _sleep(_hidden() ? 16 : 120).then(fin);
    });
  }
  function _yieldPage() { return _hidden() ? _mcTick() : new Promise(function (r) { setTimeout(r, 0); }); }

  // ---- v1.12.0 PAGE-NUMBER STAMP ------------------------------------------
  // The footer page number is baked into the raster, so a host whose page count changes after a page was rendered (a
  // slice that comes back empty, a dropped section) cannot fix it with text alone. Before capture we measure where the
  // "PAGE n of T" text sits and its type; after capture we build a clean background patch for that box (each row is the
  // linear blend of the raster's own pixels just outside the text — exact on the footer's gradient bar) and resolve the
  // text colours against it. The host covers the old number with the patch and draws the true one (see
  // SonorPdf restampHtmlPageNumbers). Nothing is drawn here; a page whose number was right is never touched.
  const _STAMP_SEL = '.page-footer-slim-mid, .page-footer-contactline-mid';
  function _cssRgba(v) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(String(v || ''));
    if (!m) return null;
    let a = m[4] == null ? 1 : (String(m[4]).slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return [+m[1], +m[2], +m[3], isFinite(a) ? a : 1];
  }
  function _blend(c, bg) { if (!c) return null; const a = c[3]; return [0, 1, 2].map(function (i) { return Math.round(c[i] * a + bg[i] * (1 - a)); }); }
  function _measurePageStamp(doc) {
    try {
      const mid = doc.querySelector(_STAMP_SEL); if (!mid) return null;
      const txt = String(mid.textContent || '').replace(/\s+/g, ' ').trim();
      const m = /(\d+)\s+of\s+(\d+)/i.exec(txt); if (!m) return null;
      const win = doc.defaultView || window;
      const rg = doc.createRange(); rg.selectNodeContents(mid); const tr = rg.getBoundingClientRect();
      const box = mid.getBoundingClientRect();
      const foot = (mid.closest && mid.closest('footer, .page-footer')) || mid.parentElement || mid; const fr = foot.getBoundingClientRect();
      const typeOf = function (el) {
        const c = win.getComputedStyle(el), fs = parseFloat(c.fontSize) || 10;
        const ls = c.letterSpacing === 'normal' ? 0 : (parseFloat(c.letterSpacing) || 0);
        return { px: fs, ls: ls, weight: parseInt(c.fontWeight, 10) || 400, color: c.color, upper: c.textTransform === 'uppercase' };
      };
      const b = mid.querySelector('b'), cap = mid.querySelector('.page-cap-page');
      // each piece where it sits ("PAGE" · n · "of" · T) — the host keeps these gaps so the restamp reads like the original
      const parts = [].map.call(mid.children, function (el) { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, digits: el.tagName === 'B' }; });
      return { num: +m[1], total: +m[2], text: txt, cx: tr.left + tr.width / 2, cy: tr.top + tr.height / 2, tw: tr.width, th: tr.height, tt: tr.top, tb: tr.bottom,
        boxL: box.left, boxR: box.right, footT: fr.top, footB: fr.bottom, mid: typeOf(mid), digits: typeOf(b || mid), cap: cap ? typeOf(cap) : null, parts: parts };
    } catch (_) { return null; }
  }
  function _stampPatch(canvas, st, cssW, jpegQ) {
    try {
      const k = canvas.width / cssW, padX = 34;
      const x0 = Math.max(st.boxL, st.cx - st.tw / 2 - padX), x1 = Math.min(st.boxR, st.cx + st.tw / 2 + padX);
      const X0 = Math.max(0, Math.floor(x0 * k)), X1 = Math.min(canvas.width - 1, Math.ceil(x1 * k));
      // vertically: the text box ± 5 px, kept clear of the footer's top rule and bottom edge (a patch over the rule shows)
      const yT = Math.max(st.footT + 3, st.tt - 5), yB = Math.min(st.footB - 2, st.tb + 5);
      const Y0 = Math.max(0, Math.floor(yT * k)), Y1 = Math.min(canvas.height, Math.ceil(yB * k));
      const W = X1 - X0 + 1, H = Y1 - Y0; if (W < 8 || H < 4) return null;
      const g = canvas.getContext('2d'); if (!g) return null;
      const L = g.getImageData(X0, Y0, 1, H).data, R = g.getImageData(X1, Y0, 1, H).data;
      const pc = document.createElement('canvas'); pc.width = W; pc.height = H;
      const pg = pc.getContext('2d'), img = pg.createImageData(W, H), d = img.data;
      for (let yy = 0; yy < H; yy++) {
        const i = yy * 4;
        for (let xx = 0; xx < W; xx++) {
          const t = xx / (W - 1), o = (yy * W + xx) * 4;
          d[o] = L[i] + (R[i] - L[i]) * t; d[o + 1] = L[i + 1] + (R[i + 1] - L[i + 1]) * t; d[o + 2] = L[i + 2] + (R[i + 2] - L[i + 2]) * t; d[o + 3] = 255;
        }
      }
      pg.putImageData(img, 0, 0);
      const ym = Math.min(H - 1, Math.max(0, Math.round((st.cy * k) - Y0))) * 4;
      const bg = [Math.round((L[ym] + R[ym]) / 2), Math.round((L[ym + 1] + R[ym + 1]) / 2), Math.round((L[ym + 2] + R[ym + 2]) / 2)];
      const url = pc.toDataURL('image/jpeg', Math.max(0.9, jpegQ || 0.9));
      pc.width = pc.height = 0;
      return { url: url, x: X0 / k, y: Y0 / k, w: W / k, h: H / k, bg: bg };
    } catch (_) { return null; }   // a tainted / unreadable raster → no patch, the host leaves the page as rendered
  }
  const _stampLog = [];   // the last few rendered pages → their stamp, for hosts that only see the dataUrl (addImage)
  function stampFor(dataUrl) {
    if (!dataUrl) return null;
    for (let i = _stampLog.length - 1; i >= 0; i--) if (_stampLog[i].url === dataUrl) return _stampLog[i].stamp;
    return null;
  }

  async function _renderHtmlToImage(html, opts) {
    opts = opts || {};
    const targetW = opts.width || 1190;
    const targetH = opts.height || 842;
    // v1.10.0 (Takeoffs v5.272.0) — the host's export-quality preset (window._sonorPdfQuality) also sets the JPEG quality
    // and caps the fixed scale-3 text pages on Draft / Standard. A Draft Full Document was 68 MB: ~90 full-page rasters at
    // scale >= 3, JPEG 0.92, whatever the preset said. Apps without a preset keep 0.92 and their own scale.
    let _q = null; try { if (typeof window !== 'undefined' && typeof window._sonorPdfQuality === 'function') _q = window._sonorPdfQuality(); } catch (_) {}
    const _cap = { draft: 2.5, standard: 3 }[_q && _q.key] || null;
    const scale = (_cap && !opts.measureOnly) ? Math.min(opts.scale || 2, _cap) : (opts.scale || 2);
    const jpegQ = opts.jpegQ || (_q && _q.jpegQ) || ({ draft: 0.8, standard: 0.86, high: 0.9, print: 0.95 }[_q && _q.key]) || 0.92;   // v1.12.0 — a page kind may pass its own (plan pages: the preset's planJpegQ)
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('SonorPdfHtmlCover: requires browser environment');
    }
    if (typeof html2canvas !== 'function') {
      throw new Error('SonorPdfHtmlCover: html2canvas not loaded — add CDN script');
    }
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `
      position: fixed; left: -10000px; top: 0;
      width: ${targetW}px; height: ${targetH}px;
      border: 0; visibility: hidden;
    `;
    document.body.appendChild(iframe);
    try {
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      // v5.18.0 — inject the base64 Gilroy @font-face so the brand font
      // actually loads in the iframe (the canonical CSS only ships local()
      // sources). Done before the fonts.ready wait below so html2canvas
      // renders with correct Gilroy metrics → no dropped word spaces.
      try {
        const faceCss = await _gilroyFaceCss();
        if (faceCss) {
          const st = doc.createElement('style');
          st.setAttribute('data-sonor-gilroy', '1');
          st.textContent = faceCss;
          (doc.head || doc.documentElement).appendChild(st);
        }
      } catch (_) {}
      // Allow layout + font load.
      await _sleep(80);
      // v1.7.1 (2026-05-09) — race fonts.ready with a 3 s timeout. Some
      // network conditions cause the iframe's font fetches to stall, and
      // doc.fonts.ready never resolves — hanging the entire renderCover /
      // renderSchedule / renderPlanPage pipeline. The race lets the render
      // proceed with whatever fonts ARE loaded after 3 s. Verified against
      // Cinema Design v4.10.4 PDF export hang at cover.
      if (doc.fonts && doc.fonts.ready) {
        try {
          await Promise.race([
            doc.fonts.ready,
            _sleep(3000)
          ]);
        } catch (_) {}
      }
      await _frame();
      // v1.8.0 (Takeoffs v5.198.0) — MEASURE hook. Runs against the laid-out
      // document before capture; may hide overflowing rows and returns an
      // object merged into the result. `measureOnly` skips html2canvas
      // entirely (layout-only pass — cheap, used to paginate by real heights).
      let _measured = null;
      if (typeof opts.onLayout === 'function') {
        try { _measured = opts.onLayout(doc) || null; } catch (e) { _measured = { error: String(e && e.message || e) }; }
      }
      if (opts.measureOnly) return Object.assign({ dataUrl: null, w: 0, h: 0 }, _measured || {});
      const _stampGeo = _measurePageStamp(doc);   // v1.12.0 — where the footer page number sits (null on pages without one)
      // v1.7.1 — also race html2canvas with a 30 s timeout. If html2canvas
      // itself stalls (e.g. cross-origin image that 404s and never errors),
      // the export pipeline shouldn't block forever. 30 s is generous —
      // typical canvas of an A3 page renders in ~1.2 s.
      const canvas = await Promise.race([
        html2canvas(doc.body, {
          width: targetW, height: targetH,
          scale, useCORS: true,
          backgroundColor: '#ffffff',
          logging: false
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('html2canvas 30 s timeout')), 30000))
      ]);
      const _out = Object.assign({ dataUrl: canvas.toDataURL('image/jpeg', jpegQ), w: canvas.width, h: canvas.height }, _measured || {});
      if (_stampGeo) {   // v1.12.0 — the patch + resolved colours, read from this raster before it is released
        const _patch = _stampPatch(canvas, _stampGeo, targetW, jpegQ);
        if (_patch) {
          const bgc = _patch.bg;
          _stampGeo.patch = _patch; _stampGeo.vw = targetW; _stampGeo.vh = targetH;
          _stampGeo.digitsRgb = _blend(_cssRgba(_stampGeo.digits.color), bgc);
          _stampGeo.capRgb = _stampGeo.cap ? _blend(_cssRgba(_stampGeo.cap.color), bgc) : _stampGeo.digitsRgb;
          _out.pageStamp = _stampGeo;
          _stampLog.push({ url: _out.dataUrl, stamp: _stampGeo }); if (_stampLog.length > 6) _stampLog.shift();
        }
      }
      try { canvas.width = canvas.height = 0; } catch (_) {}   // v1.11.0 — release the page raster now, not at the next GC
      await _yieldPage();
      return _out;
    } finally {
      try { document.body.removeChild(iframe); } catch (_) {}
    }
  }

  // ---- Public API --------------------------------------------------------

  function setStylesheetUrl(url) { _cssUrl = url; _cssCache = null; }

  function available() {
    return (typeof window !== 'undefined') &&
           typeof html2canvas === 'function' &&
           !!window.SonorPdfHtmlHelpers &&
           !!window.SonorPdfHtmlComponents &&
           !!window.SonorPdfHtmlTemplates;
  }

  async function renderCover(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildCover(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-cover'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // v5.147.0 — html2canvas page scale from the export-quality preset
  // (Quality selector). High (4) when absent.
  function _pageScale(fallback) {
    try {
      if (typeof window !== 'undefined' && typeof window._sonorPdfQuality === 'function') {
        const q = window._sonorPdfQuality();
        if (q && q.htmlScale > 0) return q.htmlScale;
      }
    } catch (_) {}
    return fallback || 4;
  }

  async function renderSectionDivider(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildSectionDivider(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-divider'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }


  // ---- renderRearPage (v1.9.0, §41) — the rear contact page, A4 landscape like the cover ----
  async function renderRearPage(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildRearPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-rear'; } catch (_) {}
      return result;
    } catch (e) { try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {} throw e; }
  }

  // ---- renderSchedule ----------------------------------------------------
  // Schedules render at A3 landscape (1190×842 in jsPDF points) — matches the
  // host's existing schedule format. Caller passes the same opts shape that
  // SonorPdfHtmlTemplates.buildSchedule expects.
  // v1.8.0 (Takeoffs v5.198.0) — how many schedule rows really fit the page.
  // The table wrap is `flex:1; overflow:hidden`, so anything past its box
  // was silently CLIPPED (Heybridge export: Utility/WC devices, the Study
  // PIRs and three shades vanished at page breaks). Rows are measured
  // against the wrap's bottom edge; overflowing rows are hidden before
  // capture and the count of fitted item rows is reported so the caller
  // can carry the tail onto the next page. The total row counts separately.
  function _scheduleFitLayout(doc) {
    const wrap = doc.querySelector('.page-table-wrap');
    if (!wrap) return null;
    const limit = wrap.getBoundingClientRect().bottom - 1;
    const rows = Array.prototype.slice.call(wrap.querySelectorAll('table tbody tr, table tfoot tr'));
    let fit = 0, itemCount = 0, totalFits = true, overflow = false;
    rows.forEach(tr => {
      const isTotal = /(^|\s)sch-total(\s|$)/.test(tr.className || '');
      const fits = tr.getBoundingClientRect().bottom <= limit;
      if (!isTotal) { itemCount++; if (fits && !overflow) fit++; else overflow = true; }
      else if (!fits || overflow) totalFits = false;
      if (!fits || overflow) tr.style.display = 'none';
    });
    return { fitCount: fit, itemCount, totalFits, overflow: overflow || !totalFits };
  }
  async function measureSchedule(opts) {
    const css = await _loadCss();
    const html = window.SonorPdfHtmlTemplates.buildSchedule(opts || {}, css);
    return _renderHtmlToImage(html, { width: 1190, height: 842, scale: 1, measureOnly: true, onLayout: _scheduleFitLayout });
  }

  async function renderSchedule(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildSchedule(opts || {}, css);
      // v5.147.0 — quality preset (min 3 so table text stays crisp on Draft).
      // v1.8.0 — overflowing rows are hidden at capture (never half-clipped);
      // result.fitCount tells the caller what actually made it onto the page.
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: Math.max(3, _pageScale(4)), onLayout: _scheduleFitLayout });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-schedule'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // ---- renderPlanPage ----------------------------------------------------
  // Plan pages render at A3 landscape (1190×842) with the floor canvas
  // bitmap embedded inside the HTML chrome. Caller pre-snapshots the
  // Fabric canvas → dataURL → passes as opts.canvasDataUrl. Sidebar
  // panels (drawing key / legend / floor totals / notes) all render
  // as HTML/CSS for full consistency with the cover + schedule pipeline.
  async function renderPlanPage(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildPlanPage(opts || {}, css);
      // v5.147.0 — quality preset (v5.146.0 default High = 4; the canvas
      // snapshot follows the same preset in _snapshotCanvas).
      // v1.12.0 — plan pages may take their own raster scale / JPEG quality from the preset (planScale / planJpegQ —
      // Takeoffs Standard 2.5 / 0.8: the plan pages are most of a Full Document's bytes and time). Absent → as before.
      let _pq = null; try { if (typeof window._sonorPdfQuality === 'function') _pq = window._sonorPdfQuality(); } catch (_) {}
      const _ps = (_pq && _pq.planScale > 0) ? _pq.planScale : _pageScale(4);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: _ps, jpegQ: (_pq && _pq.planJpegQ) || null });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-plan'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // v5.146.0 — CONTENTS page through the SAME pipeline as every other page
  // (Bryn: "fix this once and for all"). Rows arrive pre-laid-out from the
  // orchestrator (CONTENTS_METRICS geometry — shared with the pdf.link
  // overlay pass).
  async function renderContents(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildContents(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: Math.max(3, _pageScale(4)) });   // v5.147.0 — preset (min 3, text page)
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-contents'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  async function renderCablingInfo(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildCablingInfoPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-cabling'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // v5.111.0 — Electrical Requirements page (Bryn: "build the electrical
  // requirements page before bulk cable and design this nicely with specs
  // and info"). Same A3 chrome pipeline as every other page.
  // v1.10.0 — TRADES REQUIREMENTS — BUILDER (niches / pattresses / blind pockets)
  async function renderBuilderRequirements(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildBuilderRequirementsPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-builderreq'; } catch (_) {}
      return result;
    } catch (e) { try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {} throw e; }
  }
  async function renderElectricalRequirements(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildElectricalRequirementsPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-elecreq'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // v1.7.4 — Image page (snapshot with full Takeoffs-style chrome).
  // Used by Cinema Design's Plan + 4 elevations + Sightlines pages so they
  // get the same header / footer / section label / revisions strip as
  // every other page in the deck. Caller passes opts.imageDataUrl
  // (e.g. SonorCT.captureViewAsJpeg('plan')) and the chrome wraps it.
  async function renderImagePage(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildImagePage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-image-page'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  async function renderBendRadius(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildBendRadiusPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-bend'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  // ---- renderOverallCounts -----------------------------------------------
  // v1.7.0 (2026-05-09) — single scoreboard page emitted between Combined
  // Plans and per-service slice plans. Engineer's "what's in this project?"
  // overview at a glance. Caller passes grand totals + per-service rollup.
  async function renderOverallCounts(opts) {
    try {
      const css = await _loadCss();
      const html = window.SonorPdfHtmlTemplates.buildOverallCountsPage(opts || {}, css);
      const result = await _renderHtmlToImage(html, { width: 1190, height: 842, scale: 3 });
      try { window.__SONOR_HTMLCOVER_LAST_PATH__ = 'rendered-counts'; } catch (_) {}
      return result;
    } catch (e) {
      try { window.__SONOR_HTMLCOVER_LAST_ERROR__ = e; } catch (_) {}
      throw e;
    }
  }

  if (typeof window !== 'undefined') {
    window.SonorPdfHtmlCover = {
      __version: MODULE_VERSION,
      renderCover, renderSectionDivider, renderRearPage, renderSchedule, measureSchedule, renderPlanPage,
      renderCablingInfo, renderBendRadius, renderOverallCounts,
      renderContents,   // v5.146.0
      renderElectricalRequirements,
      renderBuilderRequirements,
      renderImagePage,
      available, setStylesheetUrl,
      stampFor   // v1.12.0
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderCover, renderSectionDivider, renderSchedule, renderPlanPage, renderContents, renderCablingInfo, renderBendRadius, renderOverallCounts, renderElectricalRequirements, renderImagePage, available, setStylesheetUrl };
  }
})();
