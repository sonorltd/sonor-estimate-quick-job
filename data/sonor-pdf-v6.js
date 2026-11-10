/* ============================================================================
   sonor-pdf-v6.js  ·  v6.0.0-rc.1  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   The SonorPdfV6 orchestrator — the single entry point for every Sonor app
   that exports a PDF. Replaces three drifted painter stacks across CD / CT /
   Takeoffs with one unified contract per the v6 spec.

   Public API:
     SonorPdfV6.exportDoc(spec, opts) → { blob, bytes, filename, pages }

   spec shape — see reports/PDF-V6-SPEC_2026-05-27.md §3.2. Minimum:
     {
       app: 'cinema-design',     // adapter name
       theme: 'cinema',          // 'cinema'|'takeoff'|'packs'|'cineca'|'rams'
       format: 'A3',
       orientation: 'landscape',
       meta: { projectName, projectRef, status, issueDate, revision },
       parts: [{ key, code, title, colour, pages: [...] }]
     }

   opts:
     - filename       defaults to '{app}_{date}.pdf'
     - postpass       ['bookmarks', 'statusWatermark', 'signatureLine'] (defaults)
     - fontBaseUrl    override Gilroy fetch path
     - download       true → trigger download blob; false → return blob only

   Dependency graph (load order):
     1. pdf-lib UMD          (window.PDFLib)
     2. @pdf-lib/fontkit UMD (window.fontkit) — optional but recommended
     3. sonor-pdf-v6-helpers.js
     4. sonor-pdf-v6-tokens.js
     5. sonor-pdf-v6-fonts.js
     6. sonor-pdf-v6-chrome.js
     7. sonor-pdf-v6-titleblock.js
     8. sonor-pdf-v6-schedule.js
     9. sonor-pdf-v6-drawing.js
     10. sonor-pdf-v6-cover.js
     11. sonor-pdf-v6-postpass.js
     12. sonor-pdf-v6.js (this file)

   HARMONY §3 · Spine v1.2.6 · per Bryn 2026-05-27 PDF v6 directive.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6 && window.SonorPdfV6.VERSION) return;

  const VERSION = '6.0.0-rc.1';
  const DEFAULTS = {
    format: 'A3',
    orientation: 'landscape',
    theme: 'cinema',
    postpass: ['bookmarks', 'statusWatermark'],
    download: true,
  };

  function _ensureDependencies() {
    const missing = [];
    if (!window.PDFLib)                     missing.push('pdf-lib UMD');
    if (!window.SonorPdfV6Helpers)          missing.push('sonor-pdf-v6-helpers.js');
    if (!window.SonorPdfV6Tokens)           missing.push('sonor-pdf-v6-tokens.js');
    if (!window.SonorPdfV6Fonts)            missing.push('sonor-pdf-v6-fonts.js');
    if (!window.SonorPdfV6Chrome)           missing.push('sonor-pdf-v6-chrome.js');
    if (!window.SonorPdfV6Titleblock)       missing.push('sonor-pdf-v6-titleblock.js');
    if (!window.SonorPdfV6Schedule)         missing.push('sonor-pdf-v6-schedule.js');
    if (!window.SonorPdfV6Drawing)          missing.push('sonor-pdf-v6-drawing.js');
    if (!window.SonorPdfV6Cover)            missing.push('sonor-pdf-v6-cover.js');
    if (!window.SonorPdfV6PostPass)         missing.push('sonor-pdf-v6-postpass.js');
    if (missing.length) throw new Error('SonorPdfV6 missing dependencies: ' + missing.join(', '));
  }

  /**
   * Main entry — orchestrates an entire PDF doc end-to-end.
   *
   * @param {object} spec   document spec (see header comment)
   * @param {object} [opts] document-level options
   * @returns {Promise<{ blob, bytes, filename, pages }>}
   */
  async function exportDoc(spec, opts) {
    const S = window.SonorPdfV6Status;
    try {
      _ensureDependencies();
    } catch (e) {
      if (S) S.error(e);
      throw e;
    }
    const o = Object.assign({}, DEFAULTS, opts);
    if (!spec || !Array.isArray(spec.parts)) {
      const err = new Error('SonorPdfV6.exportDoc: spec must include parts[]');
      if (S) S.error(err);
      throw err;
    }

    if (S) S.show('Initialising PDF…');
    const { PDFDocument } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    if (S) S.update('Loading Gilroy fonts…');
    const fonts = await window.SonorPdfV6Fonts.load(pdfDoc, { fontBaseUrl: opts && opts.fontBaseUrl });

    const ctx = {
      pdfDoc,
      fonts,
      app:    spec.app || 'app',
      appLabel: spec.appLabel || spec.app || 'Sonor',
      theme:  spec.theme || o.theme,
      format: spec.format || o.format,
      orientation: spec.orientation || o.orientation,
      meta:   spec.meta || {},
      brand:  spec.brand || {},
      // v1.1.0 (CD v6.5.5) — pass build version through to chrome footer so
      // every page carries provenance. Adapter sets spec.buildVersion to the
      // app's APP_VERSION (e.g. '6.5.5'). Falls back to empty string —
      // chrome painter then renders the legacy two-element contact footer.
      buildVersion: spec.buildVersion || '',
    };

    // ---- Flatten parts → page list with computed page numbers --------
    // v6.0.4 — pre-split overflowing schedules into multiple page entries
    // BEFORE numbering. Pre-v6.0.4 the orchestrator added continuation pages
    // dynamically during paint, but they all stamped the ORIGINAL page's
    // pageNum (because flatten ran once at start). Now schedules with > N
    // rows split upfront so every emitted page gets a unique pageNum +
    // accurate pageTotal.
    const flatPages = _flattenPages(spec.parts);
    const pageList = _expandOverflowingSchedules(flatPages, ctx);
    pageList.forEach((p, i) => {
      p.pageSpec.pageNum = i + 1;
      p.pageSpec.pageTotal = pageList.length;
    });

    // ---- Paint each page ---------------------------------------------
    // v6.3.1 — each page wrapped in try/catch. A single page failure renders
    // a "page render failed" placeholder instead of aborting the whole 46-page
    // export. The user gets a PDF, the status panel shows the error, and the
    // console has the full stack. Pre-v6.3.1, one Resvg WASM init failure
    // killed everything silently and Bryn saw "PDF export did nothing".
    const { w: pageW, h: pageH } = window.SonorPdfV6Tokens.pageSize(ctx.format, ctx.orientation);
    const pageIndex = [];
    let pageFailures = 0;
    for (let i = 0; i < pageList.length; i++) {
      const entry = pageList[i];
      const pageNum = i + 1;
      if (S) S.progress(pageNum, pageList.length, 'Painting page');
      const page = pdfDoc.addPage([pageW, pageH]);
      try {
        await _paintPage(page, ctx, entry.pageSpec);
      } catch (e) {
        pageFailures++;
        const code = (entry.pageSpec && entry.pageSpec.code) || '?';
        const kind = (entry.pageSpec && entry.pageSpec.kind) || '?';
        console.error('[SonorPdfV6] page ' + pageNum + ' (' + code + ', kind=' + kind + ') failed:', e);
        // Render minimal failure placeholder so the user can see WHICH page broke.
        try {
          if (window.SonorPdfV6Chrome) window.SonorPdfV6Chrome.paintPage(page, ctx, entry.pageSpec);
          if (window.SonorPdfV6Helpers) {
            window.SonorPdfV6Helpers.drawText(page,
              '⚠ Page render failed (' + code + ')',
              { x: 60, y: pageH - 80, font: ctx.fonts.bold, size: 14, color: '#ec6061' });
            window.SonorPdfV6Helpers.drawText(page,
              String(e && e.message || e),
              { x: 60, y: pageH - 110, font: ctx.fonts.reg, size: 10, color: '#8B7D6B' });
          }
        } catch (_) { /* even placeholder failed — give up on this page */ }
      }
      pageIndex.push({ page, pageSpec: entry.pageSpec });
    }

    // ---- Post-pass ----------------------------------------------------
    if (S) S.update('Adding bookmarks + watermarks…');
    try {
      await window.SonorPdfV6PostPass.run(pdfDoc, ctx, pageIndex, o.postpass);
    } catch (e) {
      console.warn('[SonorPdfV6] post-pass failed (non-fatal):', e);
    }

    // ---- Serialise + return ------------------------------------------
    if (S) S.update('Saving PDF…');
    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const filename = o.filename || _defaultFilename(ctx);
    if (o.download !== false && typeof document !== 'undefined') {
      _triggerDownload(blob, filename);
    }
    if (S) {
      if (pageFailures > 0) {
        S.error(pageFailures + ' page(s) failed — see console. PDF still saved as ' + filename);
      } else {
        S.success(filename + ' · ' + pageList.length + ' pages · ' + (bytes.length / 1024).toFixed(0) + ' KB');
      }
    }
    return { blob, bytes, filename, pages: pageList.length, pageFailures };
  }

  /**
   * Walk parts → pages, attaching part metadata to each page descriptor so
   * downstream painters (chrome, titleblock, postpass) can read it.
   */
  function _flattenPages(parts) {
    const out = [];
    parts.forEach(part => {
      if (!Array.isArray(part.pages)) return;
      const partMeta = { key: part.key, code: part.code, title: part.title, colour: part.colour };
      part.pages.forEach(p => {
        out.push({
          pageSpec: Object.assign({}, p, { part: partMeta }),
        });
      });
    });
    return out;
  }

  /**
   * v6.0.4 — pre-split schedules that would overflow a single page so each
   * page in the final list is self-contained and gets a unique pageNum.
   * Uses SonorPdfV6Schedule.estimateRows for accurate fit calculation against
   * the actual body bounds + row heights. Safe no-op for pages with rows
   * that fit, OR for kinds that don't have schedule contents (cover, plan,
   * image, divider, etc.).
   */
  function _expandOverflowingSchedules(flatPages, ctx) {
    if (!window.SonorPdfV6Schedule || !window.SonorPdfV6Chrome) return flatPages;
    const SCHEDULE_KINDS = new Set(['schedule', 'signoff', 'revisions', 'toc', 'intro', 'info']);
    const bounds = window.SonorPdfV6Chrome.bodyBounds(ctx.format, ctx.orientation);
    const availH = bounds.h - 60; // leave room for titleblock + scale bar
    const out = [];
    flatPages.forEach(entry => {
      const pg = entry.pageSpec;
      const isSchedule = SCHEDULE_KINDS.has(pg.kind);
      const rows = pg.contents && pg.contents.rows;
      if (!isSchedule || !Array.isArray(rows) || rows.length <= 5) {
        out.push(entry); // no rows or trivially short
        return;
      }
      // Estimate how many rows fit on one page
      let remaining = rows.slice();
      let pageIdx = 0;
      while (remaining.length) {
        const n = window.SonorPdfV6Schedule.estimateRows(availH, remaining);
        const sliceN = Math.max(1, Math.min(remaining.length, n || remaining.length));
        const slice = remaining.slice(0, sliceN);
        const isLast = sliceN >= remaining.length;
        const newSpec = Object.assign({}, pg, {
          contents: Object.assign({}, pg.contents, { rows: slice }),
        });
        if (pageIdx > 0) {
          newSpec.subtitle = (pg.subtitle || '') + ' (CONTINUED ' + (pageIdx + 1) + ')';
        }
        // Keep total on first only — orchestrator owns pageTotal externally
        if (!isLast) delete newSpec.contents.total;
        out.push({ pageSpec: newSpec });
        remaining = remaining.slice(sliceN);
        pageIdx++;
        if (pageIdx > 20) break; // safety: cap any runaway split at 20 pages
      }
    });
    return out;
  }

  /**
   * Paint a single page according to its kind. Each kind has a single canonical
   * painter; no per-app special-casing inside the orchestrator.
   */
  async function _paintPage(page, ctx, pageSpec) {
    const kind = pageSpec.kind || 'schedule';

    switch (kind) {
      case 'cover':
        // Cover doesn't wear the chrome — it's the luxury sheet.
        // Adapter may pass `cover.dataUrl` (pre-rendered via SonorPdfHtmlCover);
        // when present, paint() embeds it full-bleed. Otherwise paints natively.
        await window.SonorPdfV6Cover.paint(page, ctx, pageSpec.cover || {});
        return;

      case 'toc':
      case 'revisions':
      case 'intro':
      case 'info':
      case 'schedule':
      case 'signoff':
        window.SonorPdfV6Chrome.paintPage(page, ctx, pageSpec);
        await _paintScheduleAware(page, ctx, pageSpec);
        // v7.8.1 — Bryn 2026-05-28: "we don't need the original info bloc,
        // just the footer". The new v7.8.0 Four-Winds footer now carries
        // sheet code + scale + page + revision — the small bottom-right CAD
        // title block is redundant. Removed call.
        return;

      case 'divider':
        // Part divider — full-bleed accent + giant code + title.
        await _paintDivider(page, ctx, pageSpec);
        return;

      case 'plan':
      case 'elevation':
      case 'section':
      case 'drawing':
        window.SonorPdfV6Chrome.paintPage(page, ctx, pageSpec);
        await _paintDrawing(page, ctx, pageSpec);
        // v7.8.1 — Bryn 2026-05-28: "we don't need the original info bloc,
        // just the footer". The new v7.8.0 Four-Winds footer now carries
        // sheet code + scale + page + revision — the small bottom-right CAD
        // title block is redundant. Removed call.
        return;

      case 'image':
        window.SonorPdfV6Chrome.paintPage(page, ctx, pageSpec);
        await _paintImagePage(page, ctx, pageSpec);
        // v7.8.1 — Bryn 2026-05-28: "we don't need the original info bloc,
        // just the footer". The new v7.8.0 Four-Winds footer now carries
        // sheet code + scale + page + revision — the small bottom-right CAD
        // title block is redundant. Removed call.
        return;

      default:
        console.warn(`[SonorPdfV6] unknown page kind: ${kind}`);
        window.SonorPdfV6Chrome.paintPage(page, ctx, pageSpec);
    }
  }

  /**
   * v6.0.4 — simplified. Pre-split now happens in _expandOverflowingSchedules
   * (called during flatten) so every schedule page entry is self-contained
   * and fits on one page. Just call paint() — no dynamic add-page loop, no
   * continuation pageNum bug.
   */
  async function _paintScheduleAware(page, ctx, pageSpec) {
    const table = pageSpec.table || pageSpec.contents;
    if (!table) return;
    window.SonorPdfV6Schedule.paint(page, ctx, table, {
      subtitle: pageSpec.subtitle,
      accent: pageSpec.part && pageSpec.part.colour,
    });
  }

  /**
   * DEAD CODE (kept temporarily as reference until v6.1 cleanup).
   * Pre-v6.0.4 dynamic continuation logic — replaced by upfront pre-split.
   */
  async function _paintScheduleAware_v603_dead(page, ctx, pageSpec) {
    const table = pageSpec.table || pageSpec.contents;
    if (!table) return;
    let currentPage = page;
    let cur = table;
    let pageOffset = 0;
    while (true) {
      const result = window.SonorPdfV6Schedule.paint(currentPage, ctx, cur, {
        subtitle: pageSpec.subtitle,
        accent: pageSpec.part && pageSpec.part.colour,
      });
      if (!result.overflow) return;
      pageOffset++;
      // Add a continuation page with the same chrome but a "(continued)" hint.
      const { w: pw, h: ph } = window.SonorPdfV6Tokens.pageSize(ctx.format, ctx.orientation);
      const contPage = ctx.pdfDoc.addPage([pw, ph]);
      // We need to also re-paint chrome + titleblock — but page numbers will be
      // re-stamped by the orchestrator's pre-walk on the next run. For now we
      // reuse the same pageSpec with a subtitle suffix.
      const contSpec = Object.assign({}, pageSpec, {
        subtitle: (pageSpec.subtitle || '') + ` (continued ${pageOffset})`,
      });
      window.SonorPdfV6Chrome.paintPage(contPage, ctx, contSpec);
      // v7.8.1 — continuation page no longer paints bottom-right title block
      // (footer carries all sheet/page/scale data).
      currentPage = contPage;
      cur = Object.assign({}, table, { rows: result.overflowRows });
    }
  }

  /**
   * Drawing emission — takes an SVG (DOM element, string, or selector) and
   * paints it via the SVG vector emitter. Body bounds + scale bar handled by
   * the drawing module.
   */
  async function _paintDrawing(page, ctx, pageSpec) {
    const bounds = window.SonorPdfV6Chrome.bodyBounds(ctx.format, ctx.orientation);
    const contents = pageSpec.contents || {};

    // Subtitle / heading inside body
    if (pageSpec.subtitle) {
      window.SonorPdfV6Helpers.drawText(page, String(pageSpec.subtitle).toUpperCase(), {
        x: bounds.x, y: bounds.y + bounds.h - 18,
        font: ctx.fonts.bold, size: 11,
        color: (pageSpec.part && pageSpec.part.colour) || window.SonorPdfV6Tokens.themeAccent(ctx.theme),
        letterSpacing: 3,
      });
    }

    // Resolve the SVG source
    let svg = contents.svgEl || null;
    if (!svg && contents.svgId && typeof document !== 'undefined') {
      svg = document.getElementById(contents.svgId);
    }
    if (!svg && contents.svgString) {
      svg = contents.svgString;
    }
    if (!svg) {
      window.SonorPdfV6Helpers.drawText(page, '(drawing source not provided)', {
        x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2,
        font: ctx.fonts.reg, size: 12, color: '#8B7D6B', align: 'center',
      });
      return;
    }

    // Paint SVG into body (leaving ~60pt at bottom for scale bar + title block reserve)
    const drawArea = {
      x: bounds.x + 20,
      y: bounds.y + 100,
      w: bounds.w - 240,            // leave room for title block on right
      h: bounds.h - 130,
    };
    // v6.5.6 — capture which renderer fired so chrome footer can stamp the
    // [v7-vector] / [resvg-raster] / [emitter-vector] / [walker] chip.
    // paintSvg returns { width, height, source, ... }; source is the renderer
    // identifier. Stashed on pageSpec for paintRendererChip below.
    // v8.0.0-rc.2 — raster underlay (Takeoffs plan background) registers
    // through the same fit as the SVG. viewBox read from the svg string.
    try {
      if (contents.underlay && window.SonorPdfV6Drawing.paintUnderlay) {
        const svgStr = (typeof svg === 'string') ? svg : ((svg && svg.outerHTML) || '');
        const vbM = svgStr.match(/viewBox=["']\s*([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)/);
        const vb = vbM ? { x: +vbM[1], y: +vbM[2], w: +vbM[3], h: +vbM[4] } : (contents.underlay.viewBox || null);
        await window.SonorPdfV6Drawing.paintUnderlay(page, ctx, contents.underlay, drawArea, vb);
      }
    } catch (e) { console.warn('[SonorPdfV6] underlay paint failed:', e && e.message); }
    const drawResult = await window.SonorPdfV6Drawing.paintSvg(page, ctx, svg, drawArea);
    if (drawResult && drawResult.source) {
      pageSpec.renderer = drawResult.source;
    }
    if (window.SonorPdfV6Chrome && window.SonorPdfV6Chrome.paintRendererChip) {
      try { window.SonorPdfV6Chrome.paintRendererChip(page, ctx, pageSpec); } catch (_) {}
    }

    // Scale bar
    if (contents.scale !== false) {
      window.SonorPdfV6Drawing.paintScaleBar(page, ctx, {
        x: bounds.x + 20, y: bounds.y + 30,
        scale: contents.scale || pageSpec.scale || '1:50 @ A3',
      });
    }

    // v7.7.0 — CAD advisory chip: "ALL DIMENSIONS IN MM · DO NOT SCALE
    // FROM DRAWING". Standard convention every CAD package outputs on every
    // drawing — dimensions are authoritative, scale is not (printers
    // distort, scans shrink, photocopies clip). Amber-tinted chip with a
    // warning glyph, positioned RIGHT of the scale bar so they read as a
    // pair. Skipped if `contents.advisory === false`.
    if (contents.advisory !== false) {
      try {
        const ADVISORY_TXT = 'ALL DIMENSIONS IN MILLIMETRES  ·  DO NOT SCALE FROM DRAWING';
        // Sit it to the right of the scale bar; estimated scale-bar width
        // is ~280pt (4-segment 0/0.5/1/2/4m + caption). Place advisory at
        // bounds.x + 320 so it doesn't overlap.
        const advX = bounds.x + 320;
        const advY = bounds.y + 32;
        const txtW = (ctx.fonts && ctx.fonts.bold && ctx.fonts.bold.widthOfTextAtSize)
                     ? ctx.fonts.bold.widthOfTextAtSize(ADVISORY_TXT, 7) + 20
                     : 320;
        // Amber tinted background panel
        page.drawRectangle({
          x: advX, y: advY - 4,
          width: txtW, height: 16,
          color: window.SonorPdfV6Helpers.toLibRgb('#fef3c7'),
          opacity: 0.85,
          borderColor: window.SonorPdfV6Helpers.toLibRgb('#d97706'),
          borderWidth: 0.5,
        });
        // Warning marker
        window.SonorPdfV6Helpers.drawText(page, '!', {
          x: advX + 6, y: advY + 1,
          font: ctx.fonts.bold, size: 9, color: '#92400e',
        });
        // Advisory text
        window.SonorPdfV6Helpers.drawText(page, ADVISORY_TXT, {
          x: advX + 14, y: advY + 1,
          font: ctx.fonts.bold, size: 7, color: '#92400e',
          letterSpacing: 1,
        });
      } catch (_) { /* advisory is decorative; never fail the export */ }
    }
  }

  /**
   * Image page emission — raster image into body bounds.
   */
  async function _paintImagePage(page, ctx, pageSpec) {
    const bounds = window.SonorPdfV6Chrome.bodyBounds(ctx.format, ctx.orientation);
    const contents = pageSpec.contents || {};
    if (!contents.src) return;
    await window.SonorPdfV6Drawing.paintImage(page, ctx, contents.src, {
      x: bounds.x + 20, y: bounds.y + 80,
      w: bounds.w - 40, h: bounds.h - 110,
      fit: contents.fit || 'contain',
    });
    if (pageSpec.caption) {
      window.SonorPdfV6Helpers.drawText(page, pageSpec.caption, {
        x: bounds.x + 20, y: bounds.y + 40,
        font: ctx.fonts.reg, size: 10, color: '#8B7D6B',
      });
    }
    // v6.5.6 — image pages get the renderer chip too, tagged 'image'.
    pageSpec.renderer = 'image';
    if (window.SonorPdfV6Chrome && window.SonorPdfV6Chrome.paintRendererChip) {
      try { window.SonorPdfV6Chrome.paintRendererChip(page, ctx, pageSpec); } catch (_) {}
    }
    // v7.7.0 — image pages get the CAD advisory too (they ARE drawings).
    if (contents.advisory !== false) {
      try {
        const ADVISORY_TXT = 'ALL DIMENSIONS IN MILLIMETRES  ·  DO NOT SCALE FROM DRAWING';
        const advX = bounds.x + 320;
        const advY = bounds.y + 32;
        const txtW = (ctx.fonts && ctx.fonts.bold && ctx.fonts.bold.widthOfTextAtSize)
                     ? ctx.fonts.bold.widthOfTextAtSize(ADVISORY_TXT, 7) + 20 : 320;
        page.drawRectangle({
          x: advX, y: advY - 4, width: txtW, height: 16,
          color: window.SonorPdfV6Helpers.toLibRgb('#fef3c7'), opacity: 0.85,
          borderColor: window.SonorPdfV6Helpers.toLibRgb('#d97706'), borderWidth: 0.5,
        });
        window.SonorPdfV6Helpers.drawText(page, '!', {
          x: advX + 6, y: advY + 1, font: ctx.fonts.bold, size: 9, color: '#92400e',
        });
        window.SonorPdfV6Helpers.drawText(page, ADVISORY_TXT, {
          x: advX + 14, y: advY + 1, font: ctx.fonts.bold, size: 7, color: '#92400e',
          letterSpacing: 1,
        });
      } catch (_) {}
    }
  }

  /**
   * Part-divider sheet — big code + title, full-bleed accent band.
   */
  async function _paintDivider(page, ctx, pageSpec) {
    const { w, h } = window.SonorPdfV6Tokens.pageSize(ctx.format, ctx.orientation);
    const accent = (pageSpec.part && pageSpec.part.colour) ||
                   window.SonorPdfV6Tokens.themeAccent(ctx.theme);
    const fonts = ctx.fonts;
    // Hero accent band (top 60%)
    page.drawRectangle({
      x: 0, y: h * 0.4, width: w, height: h * 0.6,
      color: window.SonorPdfV6Helpers.toLibRgb(accent),
    });
    // Subtle dark overlay for legibility
    page.drawRectangle({
      x: 0, y: h * 0.4, width: w, height: h * 0.6,
      color: window.SonorPdfV6Helpers.toLibRgb('#140e26'),
      opacity: 0.35,
    });
    // Giant part code
    window.SonorPdfV6Helpers.drawText(page, (pageSpec.part && pageSpec.part.key) || '—', {
      x: 60, y: h * 0.78,
      font: fonts.bold, size: 220, color: '#ffffff',
      opacity: 0.18, letterSpacing: -8,
    });
    // Part title centred
    window.SonorPdfV6Helpers.drawText(page, ((pageSpec.part && pageSpec.part.title) || '').toUpperCase(), {
      x: w / 2, y: h * 0.5,
      font: fonts.bold, size: 72, color: '#ffffff',
      align: 'center', letterSpacing: -1,
    });
    if (pageSpec.subtitle) {
      window.SonorPdfV6Helpers.drawText(page, pageSpec.subtitle, {
        x: w / 2, y: h * 0.43,
        font: fonts.med, size: 16, color: 'rgb(245,240,250)',
        align: 'center', letterSpacing: 3,
      });
    }
    // Bottom strip (matches cover's brand strip)
    page.drawRectangle({ x: 0, y: 0, width: w, height: 52, color: window.SonorPdfV6Helpers.toLibRgb('#141008') });
    window.SonorPdfV6Helpers.drawText(page, 'SONOR', {
      x: 50, y: 18, font: fonts.bold, size: 22, color: '#ffffff', letterSpacing: 8,
    });
  }

  /**
   * Default filename: cinema-design_2026-05-27.pdf
   */
  function _defaultFilename(ctx) {
    const slug = (ctx.app || 'sonor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    return `${slug}_${date}.pdf`;
  }

  /**
   * Trigger a browser download for a blob.
   */
  function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.SonorPdfV6 = {
    VERSION,
    exportDoc,
    // Subsystem references for advanced/testing use — adapters normally don't
    // touch these directly; they go through exportDoc.
    helpers:   window.SonorPdfV6Helpers,
    tokens:    window.SonorPdfV6Tokens,
    fonts:     window.SonorPdfV6Fonts,
    chrome:    window.SonorPdfV6Chrome,
    titleblock: window.SonorPdfV6Titleblock,
    schedule:  window.SonorPdfV6Schedule,
    drawing:   window.SonorPdfV6Drawing,
    cover:     window.SonorPdfV6Cover,
    postpass:  window.SonorPdfV6PostPass,
  };
})();
