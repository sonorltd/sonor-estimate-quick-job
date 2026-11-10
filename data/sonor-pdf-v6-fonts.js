/* ============================================================================
   sonor-pdf-v6-fonts.js  ·  v1.1.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   Lazy Gilroy loader for pdf-lib. Replaces the three independent loaders
   currently in Takeoffs / CD / CT (audit §3). Lazy + cached on window so the
   first export across the session pays one fetch, all subsequent exports reuse.

   v1.1.0 — SSOT-CDN ARCHITECTURE. Bryn directive 2026-05-27: "fonts and cross
   app resources like fonts and logos should be in a shared gh repo ssot".
   Vendored `data/fonts/` (v6.0.4 workaround for sonor-brand Pages being
   unenabled) is RETIRED. Single canonical source: sonor-brand GitHub Pages.
   Codified as Spine S-4.21 — every app fetches cross-app static resources
   (fonts/logos/icons/HIRES) from the brand CDN only. One brand-regen push
   propagates to every Sonor surface in one hop. No drift, no duplication.

   Falls back to embedded Helvetica silently if the Gilroy fetch fails for any
   reason (offline, CORS, file moved) — output still renders correctly, just
   not in brand font.

   Exposes window.SonorPdfV6Fonts = { load, register, setActive }.

   Requires: pdf-lib loaded · fontkit loaded (for subsetting) — both are
   optional; if either is missing we fall back gracefully.

   Spine v1.2.6 · HARMONY §3 · closes audit finding §3.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Fonts && window.SonorPdfV6Fonts.VERSION) return;

  const T = window.SonorPdfV6Tokens;
  if (!T) {
    console.warn('[SonorPdfV6Fonts] sonor-pdf-v6-tokens.js missing — load it first');
  }

  // ---- Where to look for Gilroy TTFs -----------------------------------
  // Adapters can override per call via opts.fontBaseUrl. Default candidates
  // are tried in order; first hit wins.
  //
  // v1.1.0 — SSOT-CDN architecture. Brand-CDN URL is THE source of truth.
  // Workspace-relative paths kept ONLY as offline-dev fallbacks (Bryn
  // editing fonts locally before pushing brand). Vendored `data/fonts/`
  // path is GONE — apps no longer carry 568KB of Gilroy each, no longer
  // drift apart on Gilroy versions, no longer wait for `sync-everything.sh`
  // to propagate font updates. One brand-regen → sonor-brand push → every
  // Sonor app picks up the new font on next session. Fonts are subset-
  // embedded in each generated PDF via fontkit, so the CDN fetch happens
  // once per session (cached on window) and only the used glyphs end up
  // in the output file. Cache-friendly: GitHub Pages serves with strong
  // ETag and 10-min Cache-Control, so warm-cache fetches return 304.
  //
  // CORS: GitHub Pages serves with `Access-Control-Allow-Origin: *` for
  // static assets, so cross-origin font fetches succeed without manual
  // CORS headers.
  const BRAND_CDN_BASE = 'https://apps.sonor.co.uk/sonor-brand/FONT/';
  const DEFAULT_BASE_URLS = [
    BRAND_CDN_BASE,                                    // SSOT — sonor-brand GitHub Pages
    '../../Branding - CORE/FONT/',                     // local-dev fallback (from APP - X/dashboard/)
    '../Branding - CORE/FONT/',                        // local-dev fallback (from APP - X/)
    'Branding - CORE/FONT/',                           // local-dev fallback (workspace root)
  ];

  // ---- session cache (per-tab) -----------------------------------------
  // Stores raw ArrayBuffers keyed by weight key — embedFont() must run per
  // PDFDocument since pdf-lib's embedded fonts are doc-bound, but we share
  // the raw bytes across docs/exports.
  if (!window.__SONOR_PDF_V6_FONT_BYTES__) {
    window.__SONOR_PDF_V6_FONT_BYTES__ = {};
  }
  const BYTES = window.__SONOR_PDF_V6_FONT_BYTES__;

  // In-flight promise to dedupe concurrent loads.
  let _loadingPromise = null;

  /**
   * Fetch the four canonical Gilroy weights as ArrayBuffers, cache, return.
   * Returns { light, reg, med, bold } where each value is an ArrayBuffer.
   * On total failure returns {} and the caller falls back to Helvetica.
   *
   * @param {object} [opts]
   * @param {string|string[]} [opts.fontBaseUrl]  override candidates
   * @param {number}          [opts.timeoutMs=4000]
   */
  async function loadGilroyBytes(opts) {
    if (BYTES.bold) return BYTES; // hot path — already cached
    if (_loadingPromise) return _loadingPromise;

    const o = Object.assign({ timeoutMs: 4000 }, opts);
    const candidates = o.fontBaseUrl
      ? (Array.isArray(o.fontBaseUrl) ? o.fontBaseUrl : [o.fontBaseUrl])
      : DEFAULT_BASE_URLS;
    const weights = (T && T.FONTS && T.FONTS.fileMap) || {
      light: 'Gilroy-Light.ttf',
      reg:   'Gilroy-Regular.ttf',
      med:   'Gilroy-Medium.ttf',
      bold:  'Gilroy-Bold.ttf',
    };

    _loadingPromise = (async () => {
      const attempts = []; // collected per-candidate diagnostics for the failure log
      for (const base of candidates) {
        const isCdn = base.startsWith('http');
        try {
          const results = await Promise.all(
            ['light', 'reg', 'med', 'bold'].map(async key => {
              const url = base + weights[key];
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), o.timeoutMs);
              try {
                const res = await fetch(url, { signal: ctrl.signal });
                clearTimeout(t);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                return [key, buf];
              } catch (e) {
                clearTimeout(t);
                throw e;
              }
            })
          );
          results.forEach(([key, buf]) => { BYTES[key] = buf; });
          BYTES._baseUrl = base;
          BYTES._gilroy = true;
          console.log(`[SonorPdfV6Fonts] ✓ Gilroy bytes fetched from ${isCdn ? 'CDN ' : 'LOCAL '}${base}`);
          return BYTES;
        } catch (e) {
          attempts.push(`${base} → ${(e && e.message) || 'fetch failed'}`);
          // try next candidate
        }
      }
      // All candidates failed — leave BYTES empty; caller will fall back.
      BYTES._gilroy = false;
      console.warn('[SonorPdfV6Fonts] ✗ All Gilroy candidates failed:\n  - ' + attempts.join('\n  - '));
      return BYTES;
    })();

    try {
      return await _loadingPromise;
    } finally {
      _loadingPromise = null;
    }
  }

  /**
   * Embed Gilroy onto a given PDFDocument. Returns the standard Sonor fonts
   * bag — { light, reg, med, bold, _gilroy: boolean }.
   * Falls back to Helvetica if Gilroy bytes are unavailable.
   *
   * @param {PDFDocument} pdfDoc
   * @param {object}      [opts]   — passed to loadGilroyBytes
   */
  async function load(pdfDoc, opts) {
    if (!pdfDoc) throw new Error('SonorPdfV6Fonts.load: missing PDFDocument');
    if (!window.PDFLib) throw new Error('SonorPdfV6Fonts.load: pdf-lib not loaded');
    if (window.fontkit && typeof pdfDoc.registerFontkit === 'function') {
      try { pdfDoc.registerFontkit(window.fontkit); } catch (_) {}
    }
    const bytes = await loadGilroyBytes(opts);
    const fonts = {};
    if (bytes._gilroy && bytes.bold) {
      try {
        fonts.light = await pdfDoc.embedFont(bytes.light, { subset: true });
        fonts.reg   = await pdfDoc.embedFont(bytes.reg,   { subset: true });
        fonts.med   = await pdfDoc.embedFont(bytes.med,   { subset: true });
        fonts.bold  = await pdfDoc.embedFont(bytes.bold,  { subset: true });
        fonts._gilroy = true;
        fonts._family = 'Gilroy';
        console.log(`[SonorPdfV6Fonts] ✓ Gilroy embedded (4 weights subset, from ${bytes._baseUrl || 'cached bytes'})`);
        return fonts;
      } catch (e) {
        console.warn('[SonorPdfV6Fonts] Gilroy embed failed:', e && e.message);
        // fall through to Helvetica
      }
    }
    // Helvetica fallback (built into pdf-lib StandardFonts, always available)
    const SF = window.PDFLib.StandardFonts;
    fonts.light = await pdfDoc.embedFont(SF.Helvetica);
    fonts.reg   = await pdfDoc.embedFont(SF.Helvetica);
    fonts.med   = await pdfDoc.embedFont(SF.HelveticaBold);
    fonts.bold  = await pdfDoc.embedFont(SF.HelveticaBold);
    fonts._gilroy = false;
    fonts._family = 'Helvetica';
    console.warn('[SonorPdfV6Fonts] ⚠ Gilroy unavailable — using Helvetica fallback. PDF will not carry Sonor brand font. Per Spine S-4.21 the canonical source is https://apps.sonor.co.uk/sonor-brand/FONT/ — verify (a) sonor-brand Pages is enabled, (b) FONT/ folder is on origin/main, (c) no firewall is blocking github.io from this session.');
    return fonts;
  }

  // Convenience — pre-warm Gilroy bytes during page idle so the first export
  // click feels instant. Apps call this once after their main scripts settle.
  function preload(opts) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => loadGilroyBytes(opts), { timeout: 2000 });
    } else {
      setTimeout(() => loadGilroyBytes(opts), 1500);
    }
  }

  /**
   * Resolve a weight key against the loaded fonts bag.
   *   setActive(fonts, 'bold')   → fonts.bold
   *   setActive(fonts, fonts.med) → passthrough
   * Convenience so adapters can pass strings instead of object refs.
   */
  function setActive(fonts, weight) {
    if (!weight) return fonts.reg;
    if (typeof weight === 'object' && typeof weight.widthOfTextAtSize === 'function') return weight;
    const w = String(weight).toLowerCase();
    return fonts[w] || fonts[w.slice(0, 3)] || fonts.reg;
  }

  window.SonorPdfV6Fonts = {
    VERSION: '1.1.0',
    BRAND_CDN_BASE,
    load,
    preload,
    setActive,
    loadGilroyBytes,  // exposed for tests / advanced use
    _cache: BYTES,    // inspect-only
  };
})();
