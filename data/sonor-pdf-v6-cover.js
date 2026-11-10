/* ============================================================================
   sonor-pdf-v6-cover.js  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   Native cover painter. Handles the luxury front sheet for every Sonor PDF.
   Three zones:
     1. HERO BAND (top 60%) — gradient hero with eyebrow / project name / ref
        / 4 info cells (REFERENCE / STATUS pill / ISSUE DATE / REVISION).
     2. CONTENT BAND (middle 30%) — two-column: stats panel left + part list
        right.
     3. BRAND STRIP (bottom 6%) — SONOR wordmark + tagline + contact +
        positional service-dot strip.

   The cover IS a chrome-less page kind — we don't call SonorPdfV6Chrome here.
   That's deliberate: the cover is one sheet, not a chrome-bearing drawing.

   The HTML-cover bridge (`SonorPdfHtmlCover` in workspace root) stays in place
   as an optional luxury-render path. Adapters pick by setting `cover.mode`:
   `'native'` (default) or `'html'`. Both produce semantically the same cover.

   Exposes window.SonorPdfV6Cover = { paint, paintViaHtml }.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Cover && window.SonorPdfV6Cover.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;

  /**
   * Paint a cover page natively (vector).
   *
   * @param {PDFPage} page
   * @param {object}  ctx     paint context (with fonts, theme, meta)
   * @param {object}  cover   cover-specific data
   *   - eyebrow      string (e.g. "ATMOS 7.1.4 REFERENCE DESIGN")
   *   - title        string (project name — required)
   *   - subTitle     string (REF · REV · DATE line)
   *   - stats        [[label, value], ...] for left stats panel
   *   - parts        [{ key, code, title, sheetCount, colour }] for right part list
   *   - cediaMember  boolean — show small membership pill
   */
  async function paint(page, ctx, cover) {
    const { w, h } = T.pageSize(ctx.format || 'A3', ctx.orientation || 'landscape');
    const fonts = ctx.fonts;
    const theme = T.themeColours(ctx.theme || 'cinema');
    const meta = ctx.meta || {};
    const status = meta.status || 'DRAFT';

    /* ---- HTML cover bridge (preferred for luxury hero) ---------------
       If the adapter passed `cover.dataUrl` (pre-rendered by
       SonorPdfHtmlCover.renderCover), embed it full-bleed instead of
       native-painting. Falls through to native if anything goes wrong. */
    if (cover && cover.dataUrl && window.SonorPdfV6Drawing) {
      try {
        await window.SonorPdfV6Drawing.paintImage(page, ctx, cover.dataUrl, {
          x: 0, y: 0, w, h, fit: 'cover',
        });
        // v7.4.0 — overlay an auto-captured plan thumbnail top-right of
        // the cover so engineers can recognise the project at a glance
        // (visual project ID before they even open to page 10). Routes
        // through paintSvg which auto-picks v7-vector / Resvg / emitter
        // depending on what's loaded — crisp regardless of substrate.
        // Tucked in the top-right corner of the hero band where the HTML
        // cover template leaves whitespace.
        if (cover.thumbnailSvg && window.SonorPdfV6Drawing.paintSvg) {
          try {
            const TH_W = 260, TH_H = 200;
            const TH_X = w - TH_W - 40;
            const TH_Y = h - TH_H - 70;
            // Subtle white plate behind the thumbnail so it reads against
            // the dark hero band even if the captured SVG has transparency
            page.drawRectangle({
              x: TH_X - 8, y: TH_Y - 8,
              width: TH_W + 16, height: TH_H + 16,
              color: H.toLibRgb('#ffffff'),
              opacity: 0.94,
              borderColor: H.toLibRgb('#cbb89a'),
              borderWidth: 0.6,
            });
            await window.SonorPdfV6Drawing.paintSvg(page, ctx, cover.thumbnailSvg, {
              x: TH_X, y: TH_Y, w: TH_W, h: TH_H,
            });
            // Tiny caption under the thumbnail
            H.drawText(page, 'PLAN · DR-01', {
              x: TH_X + TH_W / 2, y: TH_Y - 18,
              font: fonts.bold, size: 8,
              color: { r: 0.95, g: 0.93, b: 0.88 },
              align: 'center', letterSpacing: 2,
            });
          } catch (e2) {
            console.warn('[SonorPdfV6Cover] thumbnail overlay failed:', e2 && e2.message);
          }
        }
        return;
      } catch (e) {
        console.warn('[SonorPdfV6Cover] HTML cover embed failed, falling back to native:', e && e.message);
      }
    }

    /* ---- Hero band (top 60%) ----------------------------------------- */
    const heroH = h * 0.6;
    const heroY = h - heroH;
    // v7.10.0 — smooth 5-stop vertical gradient: rich purple-night top
    // → primary mid → mid → deeper bottom. Replaces the v6 3-band fake.
    // Stops chosen from the theme palette so it stays brand-locked.
    if (H.paintVerticalGradient) {
      H.paintVerticalGradient(page, {
        x: 0, y: heroY, w, h: heroH, bands: 32,
        stops: [
          theme.dark,                      // top — deepest
          theme.dark,                      // hold the dark for top quarter
          theme.mid || theme.primary,      // ease to primary
          theme.primary,                   // primary midpoint
          theme.mid || theme.dark,         // ease back
        ],
      });
    } else {
      // Fallback to legacy 3-band if helper missing
      page.drawRectangle({ x: 0, y: heroY, width: w, height: heroH, color: H.toLibRgb(theme.dark) });
      page.drawRectangle({ x: 0, y: heroY, width: w, height: heroH * 0.4, color: H.toLibRgb(theme.mid) });
      page.drawRectangle({ x: 0, y: heroY, width: w, height: heroH * 0.16, color: H.toLibRgb(theme.primary) });
    }
    // Subtle highlight glow — radial-ish band centred on title
    page.drawRectangle({
      x: 0, y: heroY + heroH * 0.30,
      width: w, height: heroH * 0.25,
      color: H.toLibRgb(theme.pale || '#ffffff'),
      opacity: 0.04,
    });

    // Eyebrow
    if (cover && cover.eyebrow) {
      H.drawText(page, `— ${cover.eyebrow.toUpperCase()} —`, {
        x: w / 2, y: heroY + heroH * 0.62,
        font: fonts.bold, size: 13, color: theme.pale,
        align: 'center', letterSpacing: 6,
      });
    }
    // Project name
    const title = (cover && cover.title) || meta.projectName || 'PROJECT';
    H.drawText(page, title.toUpperCase(), {
      x: w / 2, y: heroY + heroH * 0.42,
      font: fonts.bold, size: T.FONTS.scale.hero, color: T.BASE.white,
      align: 'center', letterSpacing: -2,
    });
    // Sub-title (REF · REV · DATE)
    const sub = (cover && cover.subTitle) ||
      `${meta.projectRef || '—'}  ·  REVISION ${meta.revision || 'A0'}  ·  ${(meta.issueDate || '').toUpperCase()}`;
    H.drawText(page, sub, {
      x: w / 2, y: heroY + heroH * 0.34,
      font: fonts.med, size: 14, color: theme.pale,
      align: 'center', letterSpacing: 3,
    });
    // v7.9.1 — "DESIGNED FOR:" client/address line below sub-title.
    // Only renders when meta.client OR meta.projectAddress is populated —
    // otherwise the area stays clean. Premium-feel touch matching the
    // engineering-deliverable convention seen in Takeoffs PDFs.
    const designedForParts = [];
    if (meta.client)         designedForParts.push(meta.client);
    if (meta.projectAddress) designedForParts.push(meta.projectAddress);
    if (designedForParts.length) {
      H.drawText(page, '— DESIGNED FOR —', {
        x: w / 2, y: heroY + heroH * 0.26,
        font: fonts.bold, size: 9, color: theme.pale,
        align: 'center', letterSpacing: 5,
      });
      H.drawText(page, designedForParts.join('  ·  '), {
        x: w / 2, y: heroY + heroH * 0.22,
        font: fonts.med, size: 12, color: T.BASE.white,
        align: 'center', letterSpacing: 2,
      });
    }

    // CEDIA member pill (bottom-left of hero, optional)
    if (cover && cover.cediaMember !== false) {
      page.drawRectangle({
        x: 50, y: heroY + 60,
        width: 120, height: 28,
        color: H.toLibRgb('#ffffff'), opacity: 0.12,
        borderColor: H.toLibRgb('#ffffff'), borderWidth: 0.5, borderOpacity: 0.3,
      });
      H.drawText(page, 'CEDIA MEMBER', {
        x: 110, y: heroY + 70,
        font: fonts.bold, size: 11, color: T.BASE.white,
        align: 'center', letterSpacing: 2,
      });
    }

    // 4 info cells along bottom of hero
    const cellY = heroY + 18;
    const cells = [
      { label: 'REFERENCE', value: meta.projectRef || '—', x: 80 },
      { label: 'STATUS',    value: status,                  x: 340, pill: true },
      { label: 'ISSUE DATE',value: meta.issueDate || '—',   x: 600 },
      { label: 'REVISION',  value: meta.revision || '—',    x: 860 },
    ];
    cells.forEach(c => {
      H.drawText(page, c.label, {
        x: c.x, y: cellY + 36,
        font: fonts.bold, size: 10, color: theme.pale, letterSpacing: 2,
      });
      if (c.pill) {
        const txt = c.value.toUpperCase();
        const pillW = Math.max(140, fonts.bold.widthOfTextAtSize(txt, 11) + 28);
        page.drawRectangle({
          x: c.x, y: cellY,
          width: pillW, height: 26,
          color: H.toLibRgb(T.statusColour(status)),
        });
        H.drawText(page, txt, {
          x: c.x + pillW / 2, y: cellY + 9,
          font: fonts.bold, size: 11, color: T.statusInk(status),
          align: 'center', letterSpacing: 1,
        });
      } else {
        H.drawText(page, String(c.value), {
          x: c.x, y: cellY + 5,
          font: fonts.bold, size: 20, color: T.BASE.white,
        });
      }
    });

    /* ---- Content band — stats + parts -------------------------------- */
    const contentTopY = heroY - 30;
    // Left: stats panel
    if (cover && Array.isArray(cover.stats) && cover.stats.length) {
      const sx = 50;
      H.drawText(page, 'PROJECT AT A GLANCE', {
        x: sx, y: contentTopY,
        font: fonts.bold, size: 11, color: theme.primary, letterSpacing: 3,
      });
      page.drawLine({
        start: { x: sx, y: contentTopY - 8 }, end: { x: sx + 490, y: contentTopY - 8 },
        color: H.toLibRgb(theme.pale), thickness: 0.6,
      });
      cover.stats.forEach((row, i) => {
        const y = contentTopY - 28 - i * 22;
        H.drawText(page, row[0], { x: sx, y, font: fonts.reg, size: 11, color: T.BASE.muted });
        H.drawText(page, row[1], { x: sx + 490, y, font: fonts.bold, size: 11, color: T.BASE.text, align: 'right' });
      });
    }

    // Right: part list
    if (cover && Array.isArray(cover.parts) && cover.parts.length) {
      const px = 650;
      H.drawText(page, 'DOCUMENT CONTENTS', {
        x: px, y: contentTopY,
        font: fonts.bold, size: 11, color: theme.primary, letterSpacing: 3,
      });
      page.drawLine({
        start: { x: px, y: contentTopY - 8 }, end: { x: px + 490, y: contentTopY - 8 },
        color: H.toLibRgb(theme.pale), thickness: 0.6,
      });
      cover.parts.forEach((p, i) => {
        const y = contentTopY - 28 - i * 26;
        const colour = p.colour || theme.primary;
        page.drawRectangle({
          x: px, y: y - 2,
          width: 5, height: 18,
          color: H.toLibRgb(colour),
        });
        const code = p.code ? `${p.code} · ${(p.title || '').toUpperCase()}` : (p.title || '').toUpperCase();
        H.drawText(page, code, {
          x: px + 14, y,
          font: fonts.bold, size: 11, color: T.BASE.text,
        });
        H.drawText(page, p.sheetCount ? `${p.sheetCount} sheet${p.sheetCount === 1 ? '' : 's'}` : '', {
          x: px + 490, y,
          font: fonts.reg, size: 11, color: T.BASE.muted,
          align: 'right',
        });
      });
    }

    /* ---- Bottom brand strip ------------------------------------------ */
    const stripH = 52;
    page.drawRectangle({ x: 0, y: 0, width: w, height: stripH, color: H.toLibRgb(T.BASE.footer) });
    H.drawText(page, 'SONOR', {
      x: 50, y: 18,
      font: fonts.bold, size: 22, color: T.BASE.white, letterSpacing: 8,
    });
    H.drawText(page, 'SMART HOMES, BEAUTIFULLY DONE', {
      x: w / 2, y: 21,
      font: fonts.med, size: 11, color: T.BASE.muted,
      align: 'center', letterSpacing: 3,
    });
    H.drawText(page, 'projects@sonor.co.uk  ·  07933 684 000', {
      x: w - 50, y: 21,
      font: fonts.reg, size: 11, color: T.BASE.muted,
      align: 'right',
    });
    // Positional service dot strip
    T.SERVICES.forEach((s, i) => {
      page.drawCircle({
        x: 50 + i * 12, y: 38,
        size: 3,
        color: H.toLibRgb(s.hex),
      });
    });
  }

  /**
   * HTML-cover bridge stub. If `window.SonorPdfHtmlCover` is loaded (the
   * existing luxury HTML pipeline) and the adapter prefers HTML rendering,
   * delegate to it. Returns true if the bridge handled it. v6 keeps the bridge
   * unchanged — this is the only intentional rasterisation surface.
   */
  async function paintViaHtml(page, ctx, cover, opts) {
    if (typeof window.SonorPdfHtmlCover === 'undefined' ||
        !window.SonorPdfHtmlCover.available ||
        !window.SonorPdfHtmlCover.available()) {
      return false;
    }
    try {
      await window.SonorPdfHtmlCover.renderCover(Object.assign({}, ctx.meta, cover, opts), { page });
      return true;
    } catch (e) {
      console.warn('[SonorPdfV6Cover] HTML cover bridge failed, falling back:', e && e.message);
      return false;
    }
  }

  window.SonorPdfV6Cover = {
    VERSION: '1.3.0',
    paint,
    paintViaHtml,
  };
})();
