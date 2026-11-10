/* ============================================================================
   sonor-pdf-v6-titleblock.js  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   ANSI Y14.1 title block, bottom-right of every drawing/schedule page.
   IDENTICAL template across every Sonor PDF — only the contents vary.

       ┌─────────────────────┬─────────────────┐
       │ [SONOR]             │  CODE  (huge)   │  ← top row
       ├─────────────────────┴─────────────────┤
       │           DRAWING TITLE                │  ← middle band
       ├──────────┬───────────┬───────────────┤
       │ SCALE    │ DATE      │  REV          │  ← bottom 3-up
       └──────────┴───────────┴───────────────┘

   Standard size 200×90 pt (about 70×32 mm at A3 scale — matches CAD norms).
   Accent colour for the code cell comes from pageSpec.part.colour so flipping
   through the document, every section's title block code is in its part hue.

   Exposes window.SonorPdfV6Titleblock = { draw }.

   Spine v1.2.6 · HARMONY §3 · closes audit finding §1 (no proper title block).
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Titleblock && window.SonorPdfV6Titleblock.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;

  const DEFAULT_W = 200;
  const DEFAULT_H = 90;

  /**
   * Draw the title block in the bottom-right corner of the page.
   *
   * @param {PDFPage} page
   * @param {object}  ctx       paint context (see chrome module)
   * @param {object}  pageSpec  current page descriptor
   * @param {object}  [opts]
   *   - x, y         override top-left position (default bottom-right)
   *   - w, h         override size (default 200×90)
   *   - accent       override code colour (default part colour)
   */
  function draw(page, ctx, pageSpec, opts) {
    const o = Object.assign({}, opts);
    const { w: pageW, h: pageH } = T.pageSize(ctx.format || 'A3', ctx.orientation || 'landscape');
    const inset = T.borderInset(ctx.format || 'A3');

    const W = o.w || DEFAULT_W;
    const Hh = o.h || DEFAULT_H;
    // Position above footer (footer baseline + footer chrome ~ 50pt) and inside
    // right border. Leaves room for the page-edge tab (6pt) + a 4pt gap.
    const x = (o.x != null) ? o.x : (pageW - inset - W - 10);
    const y = (o.y != null) ? o.y : (inset + 60);

    const fonts = ctx.fonts;
    const part = pageSpec.part || {};
    const accent = o.accent || part.colour || T.themeAccent(ctx.theme || 'cinema');
    const code   = pageSpec.code || '—';
    const title  = (pageSpec.titleblockTitle || pageSpec.title || '').toUpperCase();
    const scale  = pageSpec.scale || pageSpec.titleblockScale || 'NTS';
    const date   = pageSpec.date || (ctx.meta && ctx.meta.issueDate) || '';
    const rev    = pageSpec.revision || (ctx.meta && ctx.meta.revision) || '—';

    // ---- Outer rect -----------------------------------------------------
    page.drawRectangle({
      x, y, width: W, height: Hh,
      color: H.toLibRgb(T.BASE.white),
      borderColor: H.toLibRgb(T.BASE.text),
      borderWidth: 1.2,
    });

    // ---- Internal grid lines -------------------------------------------
    // Top row (logo | code) divider
    const topRow = Hh - 30; // 30pt deep
    const midRow = Hh - 55; // middle band 25pt deep
    page.drawLine({ start: { x, y: y + topRow }, end: { x: x + W, y: y + topRow }, color: H.toLibRgb(T.BASE.text), thickness: 0.6 });
    page.drawLine({ start: { x, y: y + midRow }, end: { x: x + W, y: y + midRow }, color: H.toLibRgb(T.BASE.text), thickness: 0.6 });
    // Top row vertical (logo | code)
    page.drawLine({ start: { x: x + 50, y: y + topRow }, end: { x: x + 50, y: y + Hh }, color: H.toLibRgb(T.BASE.text), thickness: 0.6 });
    // Bottom row verticals (scale | date | rev)
    page.drawLine({ start: { x: x + W * 0.4, y }, end: { x: x + W * 0.4, y: y + midRow }, color: H.toLibRgb(T.BASE.text), thickness: 0.6 });
    page.drawLine({ start: { x: x + W * 0.7, y }, end: { x: x + W * 0.7, y: y + midRow }, color: H.toLibRgb(T.BASE.text), thickness: 0.6 });

    // ---- Top row content -----------------------------------------------
    // SONOR mark (left cell)
    H.drawText(page, 'SONOR', {
      x: x + 25, y: y + Hh - 18,
      font: fonts.bold, size: 11, color: T.BASE.text,
      align: 'center', letterSpacing: 2,
    });
    // CODE (right cell, big)
    H.drawText(page, code, {
      x: x + (50 + W) / 2, y: y + Hh - 22,
      font: fonts.bold, size: 22, color: accent,
      align: 'center',
    });

    // ---- Middle band — drawing title -----------------------------------
    H.drawText(page, title, {
      x: x + W / 2, y: y + midRow + 9,
      font: fonts.bold, size: 10, color: T.BASE.text,
      align: 'center', letterSpacing: 0.5,
    });

    // ---- Bottom row — scale / date / rev -------------------------------
    const labelY = y + 22, valueY = y + 7;
    H.drawText(page, 'SCALE', { x: x + W * 0.2, y: labelY, font: fonts.bold, size: 8, color: T.BASE.muted, align: 'center', letterSpacing: 1 });
    H.drawText(page, String(scale), { x: x + W * 0.2, y: valueY, font: fonts.bold, size: 10, color: T.BASE.text, align: 'center' });

    H.drawText(page, 'DATE', { x: x + W * 0.55, y: labelY, font: fonts.bold, size: 8, color: T.BASE.muted, align: 'center', letterSpacing: 1 });
    H.drawText(page, String(date), { x: x + W * 0.55, y: valueY, font: fonts.bold, size: 10, color: T.BASE.text, align: 'center' });

    H.drawText(page, 'REV', { x: x + W * 0.85, y: labelY, font: fonts.bold, size: 8, color: T.BASE.muted, align: 'center', letterSpacing: 1 });
    H.drawText(page, String(rev), { x: x + W * 0.85, y: valueY, font: fonts.bold, size: 10, color: T.BASE.text, align: 'center' });
  }

  window.SonorPdfV6Titleblock = {
    VERSION: '1.0.0',
    draw,
    DEFAULT_SIZE: { w: DEFAULT_W, h: DEFAULT_H },
  };
})();
