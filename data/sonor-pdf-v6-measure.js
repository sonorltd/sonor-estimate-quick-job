// @ts-check
/**
 * Sonor PDF v6 — Measure / Viewport dictionary (CAD-grade measurable PDFs)
 * =======================================================================
 *
 * Workspace-shared canonical master (HARMONY §2 / Spine S-4.2). Synced into
 * each PDF-producing app's data/ by sync-everything.sh — never hand-edit a copy.
 *
 * @version 1.0.0  (2026-05-29 — DRAWING-CAD-PDF-ROADMAP P2)
 *
 * WHY: a to-scale plan plotted at 1:50 / 1:100 is only truly "CAD-grade" if the
 * recipient can MEASURE real distances/areas off it. Acrobat's Measure tool only
 * reports real-world units when the page carries a /VP (Viewport) array whose
 * entries hold a /Measure dictionary (ISO 32000 §8.7.2 / §12.9). Without it the
 * tool reports PDF points. This module attaches a rectilinear (/Subtype /RL)
 * Measure dict so an architect/builder opens the Sonor PDF and measures metres
 * and m² directly.
 *
 * The maths (the whole trick):
 *   1 PDF point = 1/72 inch = 25.4/72 mm = 0.352777… mm on PAPER.
 *   At plot scale 1:R, 1 paper-mm = R real-mm, so
 *   real metres per PDF point = (25.4/72/1000) · R.
 *   That factor is the /C of the X-axis NumberFormat (points → metres).
 *
 * pdf-lib note: context.obj() turns JS strings into PDF *names* (/Foo) and JS
 * numbers into PDFNumber. TEXT values (unit label, scale ratio) MUST be wrapped
 * in PDFString.of(...) or they'd serialise as names. Streams stay compressed;
 * the dict keys are what Acrobat reads.
 *
 * API
 *   SonorPdfV6Measure.parseRatio('1:50 @ A3')           → 50   (null if none)
 *   SonorPdfV6Measure.metresPerPoint(ratio)             → number
 *   SonorPdfV6Measure.attach({ pdfDoc, page, ratio, bbox, unit?, areaUnit?, precision?, name?, PDFLib? })
 *   SonorPdfV6Measure.attachToScale({ pdfDoc, page, scale, bbox, ... })  // parses scale string for you
 *
 * `bbox` is the to-scale drawing region in PDF points [x0, y0, x1, y1] (lower-left
 * origin). Pass the plan/viewport rect, not the whole sheet, so the Measure tool
 * is active over the drawing only.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorPdfV6Measure = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const __version = '1.0.0';

  const POINT_TO_MM = 25.4 / 72; // 0.3527777…

  /** Parse a scale ratio out of a scale string like "1:50 @ A3" / "1:100" / "NTS". */
  function parseRatio(scale) {
    if (typeof scale === 'number' && isFinite(scale) && scale > 0) return scale;
    if (typeof scale !== 'string') return null;
    const m = scale.match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  /** Real metres represented by one PDF point at plot scale 1:ratio. */
  function metresPerPoint(ratio) {
    return (POINT_TO_MM / 1000) * Number(ratio);
  }

  function _resolvePDFLib(opts) {
    return (opts && opts.PDFLib) || (typeof window !== 'undefined' ? window.PDFLib : null);
  }

  /**
   * Attach a rectilinear Measure/Viewport to one page.
   * @returns {boolean} true if attached, false if skipped (no ratio / bad input).
   */
  function attach(opts) {
    opts = opts || {};
    const PDFLib = _resolvePDFLib(opts);
    const { pdfDoc, page, ratio, bbox } = opts;
    if (!PDFLib || !pdfDoc || !page) return false;
    const r = Number(ratio);
    if (!isFinite(r) || r <= 0) return false;
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;

    const { PDFName, PDFString } = PDFLib;
    const ctx = pdfDoc.context;
    const unit = opts.unit || 'm';
    const areaUnit = opts.areaUnit || (unit + '²'); // m²
    const precision = (opts.precision != null) ? opts.precision : 2;
    const denom = Math.round(Math.pow(10, precision));   // 2 dp → 100
    const mPerPt = metresPerPoint(r);

    // NumberFormat dict — F:/D = decimal, D = precision denominator, RD = decimal sep.
    const numFmt = (u, C) => ctx.obj({
      Type: 'NumberFormat',
      U: PDFString.of(u),
      C: C,
      F: PDFName.of('D'),
      D: denom,
      RD: PDFString.of('.'),
      RT: PDFString.of(''),
      PS: PDFString.of(''),
      SS: PDFString.of('')
    });

    const measure = ctx.obj({
      Type: 'Measure',
      Subtype: 'RL',                 // rectilinear
      R: PDFString.of('1:' + r),     // human scale-ratio label
      X: [ numFmt(unit, mPerPt) ],   // X axis: points → metres
      Y: [ numFmt(unit, mPerPt) ],   // Y axis: same (uniform scale)
      D: [ numFmt(unit, 1) ],        // distance: identity on the X unit
      A: [ numFmt(areaUnit, 1) ]     // area: (metres)² → m²
    });

    const viewport = ctx.obj({
      Type: 'Viewport',
      BBox: bbox.map(Number),
      Name: PDFString.of(opts.name || 'Drawing'),
      Measure: measure
    });

    // /VP is an array of viewport dicts on the page node. Append, don't clobber.
    let vp = page.node.lookup(PDFName.of('VP'));
    if (vp && typeof vp.push === 'function') {
      vp.push(viewport);
    } else {
      page.node.set(PDFName.of('VP'), ctx.obj([viewport]));
    }
    return true;
  }

  /** Convenience: parse the scale string then attach. Skips silently if NTS / no ratio. */
  function attachToScale(opts) {
    opts = opts || {};
    const ratio = parseRatio(opts.scale);
    if (ratio == null) return false;
    return attach(Object.assign({}, opts, { ratio }));
  }

  return { parseRatio, metresPerPoint, attach, attachToScale, __version };
});
