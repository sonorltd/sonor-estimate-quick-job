/* ============================================================================
   sonor-pdf-v7-typst.js  ·  v0.1.1  ·  2026-05-28
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   THE V7 RENDERER. JS wrapper around the sonor-svg2pdf-wasm crate (Rust
   port of typst/svg2pdf compiled to WebAssembly). TRUE VECTOR SVG → PDF
   conversion: no raster, infinite zoom, Cmd-F text, ~70% smaller files
   than v6.3's Resvg raster path.

   Per Bryn directive 2026-05-28: "we want it working towards the best
   possible, so keep pushing on". This is the renderer that replaces v6.3's
   Resvg-as-PRIMARY architecture. v6 stays as the fallback chain:

     V7 (this module, Rust+WASM, vector)
       ↓ if WASM fails to load OR svg2pdf throws
     SonorPdfV6Resvg (Rust+WASM, raster @ 4× DPR)
       ↓ if Resvg fails
     SonorPdfV6SvgEmitter (hand-rolled, partial SVG support)
       ↓ if emitter throws
     basic walker in v6-drawing.js

   Integration with the master pdf-lib document:
     1. v7 produces a single-page PDF (Vec<u8> from Rust → Uint8Array in JS)
        containing the SVG as native PDF objects (paths/text/gradients/etc).
     2. We call pdfDoc.embedPdf(pdfBytes) which returns an array of
        PDFEmbeddedPage objects.
     3. page.drawPage(embeddedPage, { x, y, width, height }) draws it as
        a vector XObject on the target page — true vector at any scale.

   This is the same technique LaTeX uses to embed PDF figures and exactly
   what svg2pdf's standalone CLI does internally. Bullet-proof and
   industry-standard.

   Public API:
     window.SonorPdfV7.renderSvgToPdfBytes(svgString)
        → Promise<Uint8Array>  (single-page PDF, ready for pdfDoc.embedPdf)

     window.SonorPdfV7.renderAndEmbed(pdfDoc, svgString)
        → Promise<PDFEmbeddedPage>  (convenience for the v6 drawing module)

     window.SonorPdfV7.isReady()  → boolean
     window.SonorPdfV7.preload()  → void  (idle warm-up)
     window.SonorPdfV7.VERSION    → '0.1.1'

   WASM loading:
     - Lazy: first export pays ~1-2s WASM fetch + instantiate
     - Cached on window.__SONOR_PDF_V7_WASM__ across the session
     - Loaded from Branding-CORE/dist/wasm/svg2pdf/ on the brand CDN
       (Spine S-4.21 — sonor-brand GitHub Pages)

   Spine v1.2.6 · HARMONY §3 · v7.0.0 architecture.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV7 && window.SonorPdfV7.VERSION) return;

  // ---- Where to find the WASM bundle --------------------------------------
  // Built locally by `wasm-pack build` in sonor-svg2pdf-wasm/, output is
  // copied to Branding-CORE/dist/wasm/svg2pdf/ and pushed to sonor-brand
  // (GitHub Pages serves it via the CDN). Per Spine S-4.21 brand-CDN-first.
  const WASM_CDN_BASE = 'https://apps.sonor.co.uk/sonor-brand/dist/wasm/svg2pdf/';
  const WASM_LOCAL_FALLBACKS = [
    '../../Branding - CORE/dist/wasm/svg2pdf/',  // local dev from dashboard/
    '../Branding - CORE/dist/wasm/svg2pdf/',      // local dev from app root
    'Branding - CORE/dist/wasm/svg2pdf/',          // workspace root
  ];

  // ---- Lazy WASM init state -----------------------------------------------
  if (!window.__SONOR_PDF_V7_WASM__) {
    window.__SONOR_PDF_V7_WASM__ = { api: null, initPromise: null, baseUrl: null };
  }
  const STATE = window.__SONOR_PDF_V7_WASM__;

  /**
   * Try each WASM base URL until one resolves. Returns the base URL that
   * worked (caller appends the JS/WASM filenames). Throws if all fail.
   */
  async function _findWasmBase() {
    const candidates = [WASM_CDN_BASE].concat(WASM_LOCAL_FALLBACKS);
    const errors = [];
    for (const base of candidates) {
      try {
        // Probe the JS loader file. If it 200s, the WASM is at the same base.
        const probe = await fetch(base + 'sonor_svg2pdf_wasm.js', { method: 'HEAD' });
        if (probe.ok) return base;
        errors.push(`${base} → HTTP ${probe.status}`);
      } catch (e) {
        errors.push(`${base} → ${e && e.message}`);
      }
    }
    throw new Error('SonorPdfV7: could not locate WASM bundle. Tried:\n  - ' + errors.join('\n  - '));
  }

  /**
   * Lazy-init the WASM module. Loads the JS shim via dynamic import, calls
   * its default init() with the WASM binary URL, caches the exported API
   * on window for reuse across exports in the same session.
   *
   * First call: ~1-2s (WASM fetch + compile + instantiate).
   * Subsequent calls: instant (cached).
   */
  async function _ensureReady(silent) {
    if (STATE.api) return STATE.api;
    if (STATE.initPromise) return STATE.initPromise;

    // silent === true → boot-time preload; never trigger the status overlay.
    // The overlay must only appear when the user actually clicks Export.
    const S = (silent === true) ? null : window.SonorPdfV6Status;
    STATE.initPromise = (async () => {
      try {
        if (S) S.update('Locating v7 WASM bundle…');
        const base = await _findWasmBase();
        STATE.baseUrl = base;
        if (S) S.update('Loading v7 svg2pdf WASM (~3 MB)…');

        // wasm-pack --target web produces an ES module loader. Dynamic
        // import means we don't need a <script> tag in the host page.
        const wasmModule = await import(/* webpackIgnore: true */ base + 'sonor_svg2pdf_wasm.js');
        if (S) S.update('Instantiating v7 svg2pdf engine…');

        // The default export takes the WASM binary URL (or fetch promise)
        // and returns once the WebAssembly.Module is instantiated. Each
        // exported Rust function then becomes a callable on the module.
        await wasmModule.default(base + 'sonor_svg2pdf_wasm_bg.wasm');

        STATE.api = wasmModule;
        const v = (wasmModule.svg2pdf_version && wasmModule.svg2pdf_version()) || '?';
        console.log('[SonorPdfV7] ✓ Rust+WASM svg2pdf ready (v' + v + ' from ' + base + ')');
        return STATE.api;
      } catch (e) {
        console.warn('[SonorPdfV7] ⚠ WASM init failed:', e && e.message);
        STATE.initPromise = null; // allow retry on next call
        throw e;
      }
    })();

    return STATE.initPromise;
  }

  /**
   * Convert an SVG string to single-page PDF bytes via the Rust WASM module.
   *
   * @param {string} svgString   Complete SVG document as text
   * @returns {Promise<Uint8Array>}  PDF bytes ready for pdfDoc.embedPdf
   */
  async function renderSvgToPdfBytes(svgString) {
    if (!svgString) throw new Error('renderSvgToPdfBytes: missing svgString');
    const api = await _ensureReady();
    if (typeof api.svg_to_pdf_bytes !== 'function') {
      throw new Error('SonorPdfV7: WASM module loaded but svg_to_pdf_bytes export missing');
    }
    try {
      // The Rust function returns Vec<u8>, which wasm-bindgen surfaces as
      // a Uint8Array on the JS side. Direct pass-through.
      return api.svg_to_pdf_bytes(svgString);
    } catch (e) {
      // Rust panics + Result::Err both come through here. The JsValue
      // string carries our formatted error message from lib.rs.
      console.warn('[SonorPdfV7] svg_to_pdf_bytes threw:', e && e.message || e);
      throw e;
    }
  }

  /**
   * Convenience: render SVG to single-page PDF + embed in the master
   * pdf-lib PDFDocument as a vector XObject in one shot.
   *
   * Used by sonor-pdf-v6-drawing.js's paintSvg as the v7 PRIMARY path.
   *
   * @param {PDFDocument} pdfDoc  the master pdf-lib doc being built
   * @param {string}      svgString
   * @returns {Promise<PDFEmbeddedPage>}  ready for page.drawPage(emb, {x,y,w,h})
   */
  async function renderAndEmbed(pdfDoc, svgString) {
    if (!pdfDoc) throw new Error('renderAndEmbed: missing pdfDoc');
    if (!window.PDFLib) throw new Error('renderAndEmbed: pdf-lib not loaded');
    const pdfBytes = await renderSvgToPdfBytes(svgString);
    // embedPdf returns an array (one entry per source page). Our v7 always
    // emits single-page PDFs from svg2pdf, so we want [0].
    const embeddedPages = await pdfDoc.embedPdf(pdfBytes);
    if (!embeddedPages || !embeddedPages.length) {
      throw new Error('SonorPdfV7: pdfDoc.embedPdf returned no pages — corrupt SVG output?');
    }
    return embeddedPages[0];
  }

  /**
   * Is the WASM module loaded + initialised right now?
   */
  function isReady() {
    return !!STATE.api;
  }

  /**
   * Idle pre-warm so the first export feels instant. Safe to call
   * multiple times — _initPromise dedupes.
   */
  function preload() {
    // Pass silent=true so the status overlay is NOT shown during
    // boot-time pre-warm — only an explicit user-initiated export
    // should ever paint the panel. Bug fix v0.1.1 (2026-05-28).
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => _ensureReady(true).catch(() => {}), { timeout: 5000 });
    } else {
      setTimeout(() => _ensureReady(true).catch(() => {}), 3000);
    }
  }

  window.SonorPdfV7 = {
    VERSION: '0.1.1',
    renderSvgToPdfBytes,
    renderAndEmbed,
    isReady,
    preload,
    _state: STATE, // inspect-only
  };
})();
