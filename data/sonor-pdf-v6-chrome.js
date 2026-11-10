/* ============================================================================
   sonor-pdf-v6-chrome.js  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   The SINGLE chrome painter for every Sonor PDF page. Replaces the three
   drifted chrome systems Bryn flagged in the v5.46.1 audit. Paints:

     • ISO 5457 border (10mm A2-A5, 20mm A0/A1, 0.6mm stroke)
     • Header band (logo + section label, status pill, project ref)
     • Service strip (4pt accent under header)
     • Page-edge tab (right side, part colour, rotated part-key letter)
     • Footer (contact line + page X of Y)

   Per-page variation is via ctx — theme accent, part code/colour, page number,
   section label. The LAYOUT is identical every page. That's the whole point.

   Exposes window.SonorPdfV6Chrome = { paintPage }.

   Spine v1.2.6 · HARMONY §3 · closes audit finding §1 (three chrome styles).
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Chrome && window.SonorPdfV6Chrome.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;
  if (!H || !T) {
    console.warn('[SonorPdfV6Chrome] helpers/tokens missing — load them first');
  }

  /**
   * Paint the chrome on a single page.
   *
   * @param {PDFPage} page     pdf-lib page object
   * @param {object}  ctx      shared paint context:
   *   - format       'A3' | 'A4' | ...
   *   - orientation  'landscape' | 'portrait'
   *   - fonts        bag from SonorPdfV6Fonts.load()
   *   - theme        themeKey ('cinema', 'takeoff', ...)
   *   - meta         { projectName, projectRef, status, ... }
   *   - app          adapter name ('Cinema Design', 'Takeoffs', ...)
   * @param {object}  pageSpec the current page descriptor from the spec:
   *   - code         'DR-01' / 'AV-03'
   *   - title        page title
   *   - part         { key, code, title, colour }
   *   - pageNum      1-based
   *   - pageTotal    document total
   *   - status       overrides ctx.meta.status if set
   */
  function paintPage(page, ctx, pageSpec) {
    const { w, h } = T.pageSize(ctx.format || 'A3', ctx.orientation || 'landscape');
    const inset = T.borderInset(ctx.format || 'A3');
    const fonts = ctx.fonts;
    const theme = T.themeColours(ctx.theme || 'cinema');
    const partColour = (pageSpec.part && pageSpec.part.colour) || theme.primary;
    const status = pageSpec.status || (ctx.meta && ctx.meta.status) || 'DRAFT';
    const statusHex = T.statusColour(status);
    const statusInk = T.statusInk(status);
    const projectRef = (ctx.meta && ctx.meta.projectRef) || '—';
    const appLabel = (ctx.appLabel || ctx.app || 'SONOR').toUpperCase();
    const sectionLabel = String(pageSpec.title || '').toUpperCase();
    const pageNum = pageSpec.pageNum || 1;
    const pageTotal = pageSpec.pageTotal || pageNum;
    const partKey = (pageSpec.part && pageSpec.part.key) || '';

    // ---- ISO 5457 border ------------------------------------------------
    page.drawRectangle({
      x: inset, y: inset,
      width: w - 2 * inset, height: h - 2 * inset,
      borderColor: H.toLibRgb(T.BASE.text),
      borderWidth: 1.2,
    });

    // ---- Header band (28pt deep, full bleed within border) -------------
    // v7.9.2 — was 44pt. Reduced per Bryn "minimise outer borders, keep it
    // almost full page". Drawings now get an extra 16pt of vertical body.
    const headerH = 28;
    const headerY = h - inset - headerH;
    // v7.10.2 REVERT: v7.10.0's gradient header broke per-page chrome paint
    // (theme.mid or paintVerticalGradient internal error on drawing pages).
    // Restored to flat fill — exact v7.9.5 behaviour.
    page.drawRectangle({
      x: inset, y: headerY,
      width: w - 2 * inset, height: headerH,
      color: H.toLibRgb(theme.dark),
    });
    // Bullet in part colour
    page.drawCircle({
      x: inset + 20, y: headerY + headerH / 2,
      size: 5,
      color: H.toLibRgb(partColour),
    });
    // SONOR wordmark
    H.drawText(page, 'SONOR', {
      x: inset + 32, y: headerY + headerH / 2 - 5,
      font: fonts.bold, size: 13, color: T.BASE.white,
      letterSpacing: 1,
    });
    // separator dot · app label · section label
    H.drawText(page, '·', { x: inset + 87, y: headerY + headerH / 2 - 5, font: fonts.reg, size: 11, color: theme.pale });
    H.drawText(page, appLabel, { x: inset + 100, y: headerY + headerH / 2 - 5, font: fonts.bold, size: 12, color: T.BASE.white });
    // v6.0.3 — measure the SANITIZED string so the layout matches what
    // drawText will actually paint (drawText sanitizes Unicode → WinAnsi-safe).
    const appWidth = fonts.bold.widthOfTextAtSize(H.winAnsiSafe ? H.winAnsiSafe(appLabel) : appLabel, 12);
    H.drawText(page, '·', { x: inset + 100 + appWidth + 12, y: headerY + headerH / 2 - 5, font: fonts.reg, size: 11, color: theme.pale });
    H.drawText(page, sectionLabel, { x: inset + 100 + appWidth + 24, y: headerY + headerH / 2 - 5, font: fonts.med, size: 12, color: T.BASE.white });

    // ---- Header right — status pill + project ref ----------------------
    const statusW = 90, statusGap = 14, pillH = 20;
    const rightEdge = w - inset - 20;
    const pillX = rightEdge - fonts.reg.widthOfTextAtSize(H.winAnsiSafe ? H.winAnsiSafe(projectRef) : projectRef, 11) - statusGap - statusW;
    page.drawRectangle({
      x: pillX, y: headerY + (headerH - pillH) / 2,
      width: statusW, height: pillH,
      color: H.toLibRgb(statusHex),
    });
    H.drawText(page, status.toUpperCase(), {
      x: pillX + statusW / 2, y: headerY + headerH / 2 - 4,
      font: fonts.bold, size: 9, color: statusInk,
      align: 'center', letterSpacing: 0.5,
    });
    H.drawText(page, projectRef, {
      x: rightEdge, y: headerY + headerH / 2 - 4,
      font: fonts.reg, size: 11, color: theme.pale,
      align: 'right',
    });

    // ---- Service strip (4pt, part colour) ------------------------------
    page.drawRectangle({
      x: inset, y: headerY - 4,
      width: w - 2 * inset, height: 4,
      color: H.toLibRgb(partColour),
    });

    // ---- Page-edge tab (right side, full body height) ------------------
    const tabW = 6;
    const tabTop = headerY - 4;
    const footerH = 64;     // v1.3.0 — Four-Winds style title block (was 50)
    const tabBottom = inset + footerH;
    page.drawRectangle({
      x: w - inset - tabW, y: tabBottom,
      width: tabW, height: tabTop - tabBottom,
      color: H.toLibRgb(partColour),
    });
    if (partKey) {
      // Rotated part-key letter, white, centred along the tab.
      const tabMid = (tabTop + tabBottom) / 2;
      page.drawText(String(partKey).toUpperCase(), {
        x: w - inset - tabW / 2 + 4,
        y: tabMid - fonts.bold.widthOfTextAtSize(String(partKey).toUpperCase(), 11) / 2,
        font: fonts.bold, size: 11,
        color: H.toLibRgb(T.BASE.white),
        rotate: H.degrees90(),
      });
    }

    // ---- Footer: 5-column title block (v1.3.0 / CD v7.8.0) -------------
    // Bryn directive 2026-05-28 — adopt the Four Winds / Takeoffs PDF style:
    // proper engineering drawing-package title block as a full-width footer.
    // 5 columns: Sonor identity | PROJECT | REV/DESCRIPTION/BY/DATE+status
    // | REVISION HISTORY | DRG/PAGE/SCALE. Replaces the previous narrow
    // 3-element contact-line footer. Renders on every page (cover excluded).
    const buildVer = ctx.buildVersion || '';
    const appShort = (ctx.app || 'Sonor');
    const fbX  = inset;
    const fbY  = inset;
    const fbW  = w - 2 * inset;
    const fbH  = 64;        // title block height (was 50 narrow footer)
    // Compute 5 column widths as fractions of available width
    const colWidths = [0.14, 0.20, 0.24, 0.22, 0.20].map(f => fbW * f);
    const colX = [fbX];
    for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

    // Top hairline (separates body from title block)
    page.drawLine({
      start: { x: fbX,        y: fbY + fbH },
      end:   { x: fbX + fbW,  y: fbY + fbH },
      color: H.toLibRgb(T.BASE.text), thickness: 0.6,
    });
    // Vertical column dividers (thin)
    for (let i = 1; i < colX.length; i++) {
      page.drawLine({
        start: { x: colX[i], y: fbY },
        end:   { x: colX[i], y: fbY + fbH },
        color: H.toLibRgb(T.BASE.muted), thickness: 0.4, opacity: 0.5,
      });
    }

    // Small caps label helper
    const _label = (txt, x, y) => {
      H.drawText(page, String(txt).toUpperCase(), {
        x, y, font: fonts.bold, size: 6.5, color: T.BASE.muted,
        letterSpacing: 1.4,
      });
    };
    const _value = (txt, x, y, opts) => {
      const o = Object.assign({ size: 9, font: fonts.med, color: T.BASE.text }, opts || {});
      H.drawText(page, String(txt), {
        x, y, font: o.font, size: o.size, color: o.color,
        letterSpacing: o.letterSpacing || 0,
      });
    };

    /* Column 1 — Sonor identity */
    const c1x = colX[0] + 10;
    H.drawText(page, 'SONOR', {
      x: c1x, y: fbY + fbH - 14,
      font: fonts.bold, size: 12, color: T.BASE.text, letterSpacing: 2,
    });
    H.drawText(page, 'Smart homes', {
      x: c1x, y: fbY + fbH - 24,
      font: fonts.reg, size: 7, color: T.BASE.muted,
    });
    H.drawText(page, 'Chester, England  ·  sonor.co.uk', {
      x: c1x, y: fbY + 22, font: fonts.reg, size: 6.5, color: T.BASE.muted,
    });
    H.drawText(page, 'projects@sonor.co.uk  ·  07933 684 000', {
      x: c1x, y: fbY + 12, font: fonts.reg, size: 6.5, color: T.BASE.muted,
    });

    /* Column 2 — PROJECT */
    const c2x = colX[1] + 10;
    _label('PROJECT', c2x, fbY + fbH - 12);
    _value((ctx.meta && ctx.meta.projectName) || '—', c2x, fbY + fbH - 28, { size: 11, font: fonts.bold });
    H.drawText(page, 'Ref: ' + ((ctx.meta && ctx.meta.projectRef) || '—'), {
      x: c2x, y: fbY + fbH - 40, font: fonts.reg, size: 7.5, color: T.BASE.muted,
    });
    if (ctx.meta && ctx.meta.projectAddress) {
      H.drawText(page, ctx.meta.projectAddress, {
        x: c2x, y: fbY + 12, font: fonts.reg, size: 7.5, color: T.BASE.text,
      });
    }

    /* Column 3 — REV / DESCRIPTION / BY / DATE + status */
    const c3x = colX[2] + 10;
    const c3HeaderY = fbY + fbH - 12;
    const subColW = colWidths[2] / 4;
    _label('REV',         c3x + subColW * 0,       c3HeaderY);
    _label('DESCRIPTION', c3x + subColW * 0.7,     c3HeaderY);
    _label('BY',          c3x + subColW * 2.4,     c3HeaderY);
    _label('DATE',        c3x + subColW * 3.0,     c3HeaderY);
    const c3ValY = fbY + fbH - 28;
    _value((ctx.meta && ctx.meta.revision) || '—', c3x + subColW * 0, c3ValY, { font: fonts.bold });
    _value('REVISION — ' + ((ctx.meta && ctx.meta.issueDate) || _today()).toUpperCase(),
           c3x + subColW * 0.7, c3ValY, { size: 8 });
    _value(ctx.meta && ctx.meta.drawnBy || 'SON', c3x + subColW * 2.4, c3ValY, { font: fonts.bold });
    _value((ctx.meta && ctx.meta.issueDate) || _today(),
           c3x + subColW * 3.0, c3ValY, { size: 8 });
    // Status pill (small, under REV)
    const statusPill = String(status || '').toUpperCase();
    const pillW = Math.min(70, fonts.bold.widthOfTextAtSize(statusPill, 8) + 14);
    page.drawRectangle({
      x: c3x, y: fbY + fbH - 48,
      width: pillW, height: 14,
      color: H.toLibRgb(statusHex),
    });
    H.drawText(page, statusPill, {
      x: c3x + pillW / 2, y: fbY + fbH - 45,
      font: fonts.bold, size: 8, color: statusInk,
      align: 'center', letterSpacing: 1,
    });
    H.drawText(page, 'Drawn ' + (ctx.meta && ctx.meta.drawnBy || 'Sonor') + '   ·   Chk —', {
      x: c3x, y: fbY + 22, font: fonts.reg, size: 6.5, color: T.BASE.muted,
    });
    if (ctx.meta && ctx.meta.basis) {
      H.drawText(page, ctx.meta.basis, {
        x: c3x, y: fbY + 12, font: fonts.reg, size: 6.5, color: T.BASE.muted,
      });
    }

    /* Column 4 — REVISION HISTORY */
    const c4x = colX[3] + 10;
    _label('REVISION HISTORY', c4x, fbY + fbH - 12);
    // Show the most recent revision (single row for now — could expand later)
    const revRow = (ctx.meta && ctx.meta.revision)
      ? (ctx.meta.revision + '   ' + (ctx.meta.issueDate || _today()) + '   REVISION — ' + ((ctx.meta.issueDate || '').toUpperCase()))
      : '—';
    H.drawText(page, revRow, {
      x: c4x, y: fbY + fbH - 28,
      font: fonts.reg, size: 7, color: T.BASE.text,
    });

    /* Column 5 — DRG / PAGE / SCALE */
    const c5x = colX[4] + 10;
    _label('DRG', c5x, fbY + fbH - 12);
    // Sheet identifier: project ref + part + page code (e.g. SON-2026-005-DR-01)
    const sheetCode = pageSpec.code
      ? ((ctx.meta && ctx.meta.projectRef ? ctx.meta.projectRef + '-' : '') + pageSpec.code)
      : ((ctx.meta && ctx.meta.projectRef) || '—');
    _value(sheetCode, c5x, fbY + fbH - 26, { size: 9, font: fonts.bold });
    // PAGE + SCALE row
    _label('PAGE', c5x, fbY + 28);
    _value(pageNum + ' / ' + pageTotal, c5x + 32, fbY + 28, { size: 9, font: fonts.bold });
    _label('SCALE', c5x, fbY + 14);
    _value(pageSpec.scale || 'NTS', c5x + 32, fbY + 14, { size: 8 });
    // App version + build provenance — bottom-right of footer in muted text
    if (buildVer) {
      H.drawText(page, appShort + ' v' + buildVer, {
        x: fbX + fbW - 10, y: fbY + 4,
        font: fonts.reg, size: 6, color: T.BASE.muted,
        align: 'right',
      });
    }
  }

  // Tiny ISO-style date helper for fallback when meta.issueDate is empty
  function _today() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  /**
   * Return the drawable body bounds (inside chrome) for a given page format.
   * Painters use this to know how much room they have.
   * Returns { x, y, w, h } in pt.
   */
  function bodyBounds(format, orientation) {
    const { w, h } = T.pageSize(format || 'A3', orientation || 'landscape');
    const inset = T.borderInset(format || 'A3');
    const headerH = 28;     // v1.4.0 (CD v7.9.2) — minimised, was 44pt
    const stripH = 4;
    const footerH = 64;     // v1.3.0 — Four-Winds title block
    const tabW = 6;
    return {
      x: inset + 10,
      y: inset + footerH + 10,
      w: w - 2 * inset - tabW - 20,
      h: h - 2 * inset - headerH - stripH - footerH - 20,
    };
  }

  /**
   * v1.2.0 (CD v6.5.6) — Paint a small renderer label in the footer right
   * area for drawing/image pages, AFTER the body paint when the renderer
   * is known. Lets engineers diagnose per-page render quality from the
   * printed PDF (e.g. "this drawing came from resvg, that one from v7").
   * Pure overlay — doesn't repaint or interfere with anything else.
   *
   * pageSpec.renderer is set by the orchestrator from paintSvg's `source`
   * return value: 'sonor-v7-typst' / 'resvg' / 'sonor-emitter' /
   * 'basic-walker' / 'image' / 'fallback'.
   *
   * Position: footer right area (between page-code top-right and edge tab).
   * Style: tiny muted text in [brackets], unobtrusive, low-contrast — for
   * forensic audit not headline reading.
   */
  function paintRendererChip(page, ctx, pageSpec) {
    if (!pageSpec || !pageSpec.renderer) return;
    const { w } = T.pageSize(ctx.format || 'A3', ctx.orientation || 'landscape');
    const inset = T.borderInset(ctx.format || 'A3');
    const fonts = ctx.fonts;
    // Map orchestrator renderer source → short human label
    const RENDERER_LABELS = {
      'sonor-v7-typst':  'v7-vector',
      'resvg':           'resvg-raster',
      'sonor-emitter':   'emitter-vector',
      'basic-walker':    'walker',
      'image':           'image',
      'fallback':        'fallback',
    };
    const label = '[' + (RENDERER_LABELS[pageSpec.renderer] || pageSpec.renderer) + ']';
    // v1.3.0 — title block footer now occupies the full bottom 64pt.
    // Drop the renderer chip into the gap between body and title block
    // (just above the title block's top hairline, right-aligned).
    H.drawText(page, label, {
      x: w - inset - 80, y: inset + 68,
      font: fonts.reg, size: 7,
      color: { r: 0.55, g: 0.5, b: 0.45 },     // muted earthy grey
      align: 'right',
      letterSpacing: 0.3,
    });
  }

  window.SonorPdfV6Chrome = {
    VERSION: '1.5.1',
    paintPage,
    paintRendererChip,
    bodyBounds,
  };
})();
