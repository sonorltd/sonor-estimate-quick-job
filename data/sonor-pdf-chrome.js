/**
 * Sonor PDF Chrome — workspace-shared pdf-lib primitives
 * ============================================================
 *
 * Single source of truth for the pdf-lib chrome shared across every Sonor
 * app that produces PDFs (Takeoffs, Project Master, Packs, Cinema Design,
 * Cinema Takeoff, Portal, Print suite, Brochures, Engineering, Network Map).
 *
 * Per HARMONY §3 — "Shared where it COULD be shared. App-specific only
 * where it genuinely cannot." This module IS the shared chrome. App-
 * specific painters (plan-page composition, aspect schedules, cabling info
 * reference, snapshot helpers) stay in each app's PDF module.
 *
 * Adoption:
 *   <script src="sonor-pdf-chrome.js"></script>
 *   then call window.SonorPdfChrome.pageBorder(page) etc.
 *
 * Drop-in for existing apps:
 *   1. Add `<script src="sonor-pdf-chrome.js">` BEFORE your existing PDF module.
 *   2. In your PDF module, replace inline copies with `SonorPdfChrome.*` calls.
 *   3. Sync via sync-everything.sh so every consumer app gets the same module.
 *
 * Self-test (page load):
 *   Logs "[SonorPdfChrome] loaded — N primitives ready" to console so
 *   adopters can confirm the module loaded without DevTools-diving.
 *
 * Versioning:
 *   v1.0.0  2026-05-19  Initial extraction from sonor-takeoffs-pdf.js v5.5.64
 *                       (per Bryn directive 2026-05-19 "make a skill file and
 *                       shared pdf module so things aren't so separate and
 *                       always stay in sync"). Resolves B-265.
 *
 * Backwards compatibility:
 *   sonor-takeoffs-pdf.js retains its own internal copies of these helpers
 *   for backward compat (in case sonor-pdf-chrome.js fails to load). Future
 *   apps should consume SonorPdfChrome directly and never duplicate.
 *
 * Source contract:
 *   Every helper here is byte-equivalent to the helper of the same name
 *   in sonor-takeoffs-pdf.js. When you change a helper here, you MUST
 *   also update the matching helper in sonor-takeoffs-pdf.js or the two
 *   will drift. (Future v2: sonor-takeoffs-pdf.js delegates entirely.)
 */
(function () {
  'use strict';

  // ============================================================
  // CONSTANTS — Sonor brand palette (slate theme, post-B-188)
  // ============================================================
  // Resolved from `[data-theme='slate']` in Branding - CORE/dist/brand.css.
  // Apps embedding this module inherit the exact same palette so chrome
  // primitives render identically everywhere. Hardcoded for resilience —
  // works offline + when brand.css hasn't loaded yet (e.g. early init).
  const COLOURS = {
    bar:        '#151A22',
    text:       '#1A1F28',
    text2:      '#475161',
    muted:      '#636C7A',
    faint:      '#A8B0BC',
    surfaceTxt: '#F4F5F8',
    body:       '#FFFFFF',
    panel:      '#F7F8FA',
    tint:       '#F7F8FA',
    altRow:     '#FAFBFC',
    border:     '#E2E5EA',
    borderHard: '#C5CAD2',
    accent:     '#475161',
    appAccent:  '#6b4a8a',
    danger:     '#ec6061',
    ok:         '#78ba57',
    // Status pill palette (matches v5.4.4 _statusPill colour map)
    draftSlate:    '#636C7A',
    installGreen:  '#3D8B40',
    asBuiltAqua:   '#4bb9d3',
    archived:      '#302F2E'
  };

  // 2026-10-16 — sonor-pdf-theme.js is the ONE palette (§41): black chrome, ink greys, gold accent. Literals above = offline fallback.
  try {
    const _T = (typeof window !== 'undefined' && window.SonorPdfTheme) ? window.SonorPdfTheme.HEX : null;
    if (_T) Object.assign(COLOURS, { bar: _T.black, text: _T.ink, text2: _T.ink2, muted: _T.muted, faint: _T.g500, panel: _T.g100, tint: _T.g100, altRow: _T.g50, border: _T.g300, borderHard: _T.g400, accent: _T.gold, appAccent: _T.gold, archived: _T.label });
  } catch (_) {}

  // ============================================================
  // PURE UTILITIES — no pdf-lib dependency, safe to call early
  // ============================================================

  function hexToRgb(hex) {
    const h = String(hex || '').replace(/^#/, '');
    const v = h.length === 3
      ? h.split('').map(c => c + c).join('')
      : h.padEnd(6, '0').slice(0, 6);
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16)
    };
  }

  function mixWithWhite(hex, amount) {
    const c = hexToRgb(hex);
    const a = Math.max(0, Math.min(1, amount));
    const r = Math.round(c.r + (255 - c.r) * a);
    const g = Math.round(c.g + (255 - c.g) * a);
    const b = Math.round(c.b + (255 - c.b) * a);
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  function base64ToBytes(b64) {
    const raw = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    const bin = (typeof atob === 'function') ? atob(raw) : '';
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ============================================================
  // PDF-LIB GUARD — primitives that need PDFLib loaded
  // ============================================================

  function pdfLibAvailable() {
    return typeof window !== 'undefined'
      && window.PDFLib
      && window.PDFLib.PDFDocument
      && typeof window.PDFLib.PDFDocument.create === 'function';
  }

  function rgbHex(hex) {
    if (!pdfLibAvailable()) return null;
    const c = hexToRgb(hex);
    return window.PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255);
  }

  // ============================================================
  // TEXT METRICS — measure + truncate + word-wrap split
  // ============================================================

  function truncate(font, size, text, maxW) {
    const s = String(text == null ? '' : text);
    if (!s) return s;
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (font.widthOfTextAtSize(s.slice(0, mid) + '…', size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + '…';
  }

  function splitText(font, size, text, maxW) {
    const s = String(text == null ? '' : text);
    if (!s) return [];
    const words = s.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ============================================================
  // DRAW HELPERS — text + rect with align + colour
  // ============================================================

  function drawText(page, text, x, y, opts) {
    opts = opts || {};
    const font = opts.font;
    const size = opts.size || 10;
    const colour = opts.colour || rgbHex(COLOURS.text);
    const align = opts.align || 'left';
    let drawX = x;
    if (align === 'right' || align === 'centre' || align === 'center') {
      const w = font.widthOfTextAtSize(String(text), size);
      drawX = (align === 'right') ? x - w : x - w / 2;
    }
    page.drawText(String(text), { x: drawX, y, font, size, color: colour });
  }

  function drawRect(page, x, y, w, h, colour, opts) {
    opts = opts || {};
    page.drawRectangle({
      x, y, width: w, height: h,
      color: colour,
      borderColor: opts.borderColor || undefined,
      borderWidth: opts.borderWidth || undefined
    });
  }

  // ============================================================
  // BRAND CHROME — Sonor canonical visual primitives
  // ============================================================

  // Page-edge rounded brand frame (printer's mark). Light-blue tint,
  // 0.6pt stroke, 8pt inset. Paint LAST on every page so it sits on top
  // of body content + footer band.
  function pageBorder(page) {
    if (!pdfLibAvailable()) return;
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const inset = 8;
    const cBorder = window.PDFLib.rgb(0xa4 / 255, 0xc8 / 255, 0xe0 / 255);
    page.drawRectangle({
      x: inset, y: inset,
      width: pageW - inset * 2, height: pageH - inset * 2,
      borderColor: cBorder, borderWidth: 0.6
      // No fill — frame sits on top of already-painted content.
    });
  }

  // CAD-style segmented scale bar. opts: { x, y, metres, pxPerM }.
  // y is BASELINE (top-down per legacy jsPDF convention).
  function scaleBar(page, ctx, opts) {
    if (!pdfLibAvailable()) return 0;
    const pageH = page.getHeight();
    const x = opts.x || 24;
    const y = opts.y || 100;
    const targetM = opts.metres || 5;
    const fontReg = ctx.fontReg;
    const cText = rgbHex(COLOURS.text);
    const cMuted = rgbHex(COLOURS.muted);
    const cBody = rgbHex(COLOURS.body);

    drawText(page, 'Scale:', x, pageH - y,
      { font: fontReg, size: 8, colour: cMuted });
    const barX = x + 28;
    const barW = 90;
    const barH = 6;
    page.drawRectangle({
      x: barX, y: pageH - y - 1, width: barW, height: barH,
      color: cBody,
      borderColor: cText, borderWidth: 0.6
    });
    const segW = barW / 5;
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) {
        drawRect(page, barX + i * segW, pageH - y - 1, segW, barH, cText);
      }
    }
    drawText(page, '0', barX, pageH - y + 9,
      { font: fontReg, size: 7, colour: cMuted });
    drawText(page, String(targetM) + ' m', barX + barW, pageH - y + 9,
      { font: fontReg, size: 7, colour: cMuted, align: 'right' });
    if (opts.pxPerM) {
      drawText(page, '1m = ' + Number(opts.pxPerM).toFixed(1) + ' px',
        barX + barW + 6, pageH - y,
        { font: fontReg, size: 7, colour: cMuted });
    }
    return barW + 28;
  }

  // Architectural compass mark. opts: { x, y, size }. y is BASELINE.
  function northArrow(page, ctx, opts) {
    if (!pdfLibAvailable()) return 0;
    const pageH = page.getHeight();
    const x = opts.x || 24;
    const y = opts.y || 100;
    const size = opts.size || 18;
    const r = size / 2;
    const cx = x + r;
    const cyTopDown = y - r;
    const fontBold = ctx.fontBold;
    const fontReg = ctx.fontReg;
    const cText = rgbHex(COLOURS.text);
    const cMuted = rgbHex(COLOURS.muted);
    const cWhite = rgbHex('#FFFFFF');

    page.drawCircle({
      x: cx, y: pageH - cyTopDown,
      size: r,
      color: cWhite,
      borderColor: cText, borderWidth: 0.8
    });

    const tipDy = -r * 0.6;
    const baseDy = r * 0.55;
    const wHalf = r * 0.65;
    const arrowPath = 'M 0 ' + tipDy +
                      ' L ' + (-wHalf) + ' ' + baseDy +
                      ' L ' + wHalf + ' ' + baseDy + ' Z';
    try {
      page.drawSvgPath(arrowPath, {
        x: cx, y: pageH - cyTopDown,
        color: cText,
        scale: 1
      });
    } catch (_) {
      // 3-line outline fallback for older pdf-lib versions
      page.drawLine({
        start: { x: cx, y: pageH - cyTopDown + (-tipDy) },
        end:   { x: cx - wHalf, y: pageH - cyTopDown - baseDy },
        thickness: 1, color: cText
      });
      page.drawLine({
        start: { x: cx - wHalf, y: pageH - cyTopDown - baseDy },
        end:   { x: cx + wHalf, y: pageH - cyTopDown - baseDy },
        thickness: 1, color: cText
      });
      page.drawLine({
        start: { x: cx + wHalf, y: pageH - cyTopDown - baseDy },
        end:   { x: cx, y: pageH - cyTopDown + (-tipDy) },
        thickness: 1, color: cText
      });
    }

    drawText(page, 'N',
      cx, pageH - (cyTopDown + r * 0.15) - 3,
      { font: fontBold, size: 5.5, colour: cWhite, align: 'centre' });
    drawText(page, 'North',
      cx, pageH - (y + 8),
      { font: fontReg, size: 7, colour: cMuted, align: 'centre' });

    return size + 4;
  }

  // Coloured pill showing project state. Status colour map matches the
  // jsPDF _statusPill v5.4.4 exactly — every Sonor reference status
  // (INITIAL DRAFT, REVISED DRAFT, FOR REVIEW, FOR INSTALL, FINAL,
  // AS-BUILT, ARCHIVED) gets its brand-coherent colour.
  function statusPill(page, ctx, state, x, y, opts) {
    if (!pdfLibAvailable()) return { w: 0, h: 0 };
    opts = opts || {};
    const label = String(state || 'ACTIVE').toUpperCase();
    const colourMap = {
      'INITIAL DRAFT':      COLOURS.draftSlate,
      'DRAFT':              COLOURS.draftSlate,
      'REVISED DRAFT':      '#e37c59',
      'FOR REVIEW':         '#f5d05c',
      'FINAL DRAFT FOR SITE REVIEW': '#e37c59',
      'PRELIMINARY':        '#e37c59',
      'ACTIVE':             COLOURS.ok,
      'FOR INSTALL':        COLOURS.installGreen,
      'FOR INSTALLATION':   COLOURS.installGreen,
      'ISSUED FOR INSTALL': COLOURS.installGreen,
      'FINAL ISSUE FOR SITE INSTALLATION': COLOURS.installGreen,
      'FINAL CONSTRUCTION': COLOURS.installGreen,
      'FINAL':              COLOURS.ok,
      'AS-BUILT':           COLOURS.asBuiltAqua,
      'ARCHIVED':           COLOURS.archived
    };
    const fillHex = colourMap[label] || COLOURS.ok;
    const fill = rgbHex(fillHex);
    const cWhite = rgbHex('#FFFFFF');
    const fontSize = opts.fontSize || 7.5;
    const fontBold = ctx.fontBold;
    const padX = opts.padX || 8;
    const padY = opts.padY || 3;
    const pageH = page.getHeight();
    const txtW = fontBold.widthOfTextAtSize(label, fontSize);
    const w = txtW + padX * 2;
    const h = fontSize + padY * 2;
    page.drawRectangle({
      x, y: pageH - y - h,
      width: w, height: h,
      color: fill
    });
    drawText(page, label,
      x + w / 2, pageH - y - h + padY + 1,
      { font: fontBold, size: fontSize, colour: cWhite, align: 'centre' });
    return { w, h };
  }

  // ============================================================
  // RESOURCE EMBED — fonts + wordmark, shared across the doc
  // ============================================================

  // Standard pdf-lib font embed pattern + optional wordmark from window
  // global. Every Sonor PDF doc should call this ONCE then pass the ctx
  // through to all subsequent painters.
  async function embedSharedResources(pdfDoc) {
    if (!pdfLibAvailable()) return null;
    const { StandardFonts } = window.PDFLib;
    const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let wordmarkRef = null;
    if (window.__SONOR_WORDMARK_PDF__) {
      try {
        const wmStr = String(window.__SONOR_WORDMARK_PDF__);
        const wmBytes = base64ToBytes(wmStr);
        wordmarkRef = (wmStr.indexOf('image/png') !== -1)
          ? await pdfDoc.embedPng(wmBytes)
          : await pdfDoc.embedJpg(wmBytes);
      } catch (e) {
        console.warn('[SonorPdfChrome] wordmark embed failed:', e);
      }
    }
    return { fontReg, fontBold, wordmarkRef };
  }

  // ============================================================
  // HTML LUXURY COVER — SonorPdfHtmlCover bridge for pdf-lib
  // ============================================================
  // Tries the HTML/CSS luxury cover (blue gradients, status pill, revision
  // timeline) via SonorPdfHtmlCover.renderCover → html2canvas → JPEG embed.
  // Returns true on success, false on any failure (caller falls back to
  // its own native pdf-lib cover composition).
  //
  // Opt-out:
  //   localStorage.takeoffs-pdf-html-cover = '0'
  //   OR window.__SONOR_PDF_HTML_COVER__ = false
  async function tryHtmlCover(pdfDoc, coverPage, ctx, opts) {
    if (!pdfLibAvailable()) return false;
    try {
      const htmlCoverDisabled =
        (typeof window !== 'undefined') && (
          window.__SONOR_PDF_HTML_COVER__ === false ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-cover') === '0')
        );
      if (htmlCoverDisabled) return false;
      if (typeof window === 'undefined' ||
          !window.SonorPdfHtmlCover ||
          typeof window.SonorPdfHtmlCover.available !== 'function' ||
          !window.SonorPdfHtmlCover.available()) {
        return false;
      }

      const meta = ctx.meta;
      const result = await window.SonorPdfHtmlCover.renderCover(Object.assign({
        title: (opts && opts.title) || 'TAKE-OFF',
        subtitle: 'PROJECT TAKE-OFF',
        projectName: meta && meta.name,
        client: meta && meta.client,
        address: meta && meta.address,
        reference: (meta && meta.ref) || '—',
        status: meta && meta.status,
        issueDate: (meta && (meta.dateUk || meta.date)) || '',
        revision: meta && meta.revision,
        revisionHistory: (meta && meta.revisionHistory) || [],
        appName: 'Takeoffs',
        appVersion: meta && meta.appVersion,
        accentHex: '#6b4a8a',
        backdropImg: null,
        services: (opts && opts.services) || null,
        floors: (opts && opts.floors) || null,
        totals: (opts && opts.totals) || null
      }, opts && opts.coverOverrides ? opts.coverOverrides : {}));

      if (!result || !result.dataUrl) return false;

      const raw = String(result.dataUrl);
      const isPng = raw.indexOf('data:image/png') === 0;
      const bytes = base64ToBytes(raw);
      const ref = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const pageW = coverPage.getWidth();
      const pageH = coverPage.getHeight();
      coverPage.drawImage(ref, { x: 0, y: 0, width: pageW, height: pageH });
      try { window.__SONOR_LAST_COVER_PATH__ = 'html-via-chrome'; } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[SonorPdfChrome] HTML cover render/embed failed — caller will fall back:', e);
      return false;
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  const api = {
    VERSION: '1.0.0',
    COLOURS,
    // Pure utilities
    hexToRgb, mixWithWhite, base64ToBytes,
    // PDF-lib helpers
    pdfLibAvailable, rgbHex,
    // Text helpers
    truncate, splitText,
    drawText, drawRect,
    // Brand chrome
    pageBorder, scaleBar, northArrow, statusPill,
    // Resource embed + HTML cover bridge
    embedSharedResources, tryHtmlCover
  };

  if (typeof window !== 'undefined') {
    window.SonorPdfChrome = api;
    try {
      console.info('[SonorPdfChrome v' + api.VERSION + '] loaded — '
        + Object.keys(api).filter(k => typeof api[k] === 'function').length
        + ' primitives ready');
    } catch (_) {}
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
