/* sonor-ink.js — SHARED INK RENDERER (canonical master at workspace root, synced to every app's data/)
 * v1.3.1 (2026-10-14, Survey v0.11.1) — drawStrokeSegments(ctx, st, from, to, cap): incremental live painting
 * v1.3.0 (2026-10-14, Survey v0.11.0) — mark kind 'object': site objects (radiator, steel, loft hatch, existing kit…) as a graphite rounded square
 * v1.2.0 (2026-10-12, Survey v0.6.0) — text objects + pin marks (RFI / snag / client / note / dim)
 * v1.0.0 (2026-10-12, APP - Survey v0.3.0 / Takeoffs survey-ink layer) — HARMONY §3: the one place that knows how a
 * Survey stroke / image object is painted, so Takeoffs (overlay layer), Survey (editor, thumbnails, PDF report) and any
 * future consumer (Tasks snag pins, Portal) render byte-identical ink from the same `survey_pages.ink` record.
 * Pure Canvas 2D, no DOM, no Supabase, no view state: every point is in PAGE units (plan pages = the Takeoffs 1400×900
 * world frame). Callers set the context transform; this module only draws.
 *   stroke: { id, tool:'pen'|'hl', c:'#hex', w, t, pts:[[x,y,p],…] }
 *   object: { id, kind:'image', src, path, x, y, w, h }        images: { [src]: ImageBitmap|HTMLImageElement }
 *   object: { id, kind:'text', text, size, c, x, y, w, h }       v1.2.0 — typed text, wrapped to w; h is derived (lines × size × 1.25)
 *   mark:   { …, kind:'pin', pin:'rfi'|'snag'|'client'|'note'|'dim', n, text, c, glyph }   v1.2.0 — survey pins (RFI 3, SNAG 1 …) that pull through to Takeoffs plan_notes
 * API: SonorInk.widthAt(stroke, p) · drawStroke(ctx, stroke, {alpha}) · drawObjects(ctx, objects, images, {alpha, skipMissing}) ·
 *      drawPaper(ctx, page, lineWidth) · renderPage(page, canvas, pxWidth, {minStroke}) · drawInk(ctx, ink, images, opts)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.SonorInk = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.3.1', PAPER = { line: 36, grid: 25 }, MARK_R = 13;
  var PIN_LABEL = { rfi: 'RFI', snag: 'SNAG', client: 'CLIENT', note: 'NOTE', dim: 'DIM' };
  // v1.1.0 — SURVEY MARKS: { id, code, block_code, service_nn, label, glyph, c:'#svc', x, y, t, kind:'block'|'photo', photo_page_id?, note? }
  // A mark is a survey-stage intent ("TV here", "keypad here", "photo taken here") in page units; Takeoffs swaps block marks
  // for Library blocks (block_code) at takeoff stage. Drawn as a service-coloured disc + glyph; photo marks as a camera tag.
  function inkFor(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || ''); if (!m) return '#fff'; var l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)); return l > 150 ? '#0B1A22' : '#fff'; }
  function drawMark(ctx, m, opts) {
    var alpha = (opts && opts.alpha != null) ? opts.alpha : 1, r = (opts && opts.r) || MARK_R, c = m.c || '#98989D';
    ctx.save(); ctx.globalAlpha = alpha;
    if (m.kind === 'photo') {
      ctx.fillStyle = '#1C1C1E'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - r * 0.55, m.y - r * 1.1); ctx.lineTo(m.x + r * 0.55, m.y - r * 1.1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(m.x - r, m.y - r * 2.4, r * 2, r * 1.5, 3) : ctx.rect(m.x - r, m.y - r * 2.4, r * 2, r * 1.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m.x, m.y - r * 1.65, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1C1C1E'; ctx.beginPath(); ctx.arc(m.x, m.y - r * 1.65, r * 0.22, 0, Math.PI * 2); ctx.fill();
    } else if (m.kind === 'pin') {   // v1.2.0 — a flag: diamond + numbered label ("RFI 3"), service-neutral colour per pin type
      ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(m.x, m.y - r * 1.15); ctx.lineTo(m.x + r * 1.15, m.y); ctx.lineTo(m.x, m.y + r * 1.15); ctx.lineTo(m.x - r * 1.15, m.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = inkFor(c); ctx.font = 'bold ' + Math.round(r * 0.95) + 'px "DM Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.glyph || '?').slice(0, 2), m.x, m.y + 0.5);
      var lab = (PIN_LABEL[m.pin] || 'PIN') + (m.n ? ' ' + m.n : ''), fs = Math.round(r * 0.8); ctx.font = 'bold ' + fs + 'px "DM Sans", system-ui, sans-serif'; ctx.textAlign = 'left';
      var lw = ctx.measureText(lab).width + r * 0.8, lx = m.x + r * 1.35, ly = m.y - r * 0.6, lh = r * 1.2;
      ctx.fillStyle = c; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(lx, ly, lw, lh, r * 0.25); else ctx.rect(lx, ly, lw, lh); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = inkFor(c); ctx.fillText(lab, lx + r * 0.4, ly + lh / 2 + 0.5);
    } else if (m.kind === 'object') {   // v1.3.0 — SITE OBJECT (radiator, steel, loft hatch…): graphite rounded square, so it never reads as a service device
      ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(m.x - r, m.y - r, r * 2, r * 2, r * 0.3); else ctx.rect(m.x - r, m.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = inkFor(c); ctx.font = 'bold ' + Math.round(r * 0.7) + 'px "DM Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.glyph || '?').slice(0, 4), m.x, m.y + 0.5);
      if (m.photo_page_id) { ctx.fillStyle = '#fff'; ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(m.x + r * 0.85, m.y - r * 0.85, r * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    } else {
      ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = inkFor(c); ctx.font = 'bold ' + Math.round(r * 0.78) + 'px "DM Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.glyph || '?').slice(0, 4), m.x, m.y + 0.5);
      if (m.photo_page_id) { ctx.fillStyle = '#fff'; ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(m.x + r * 0.8, m.y - r * 0.8, r * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawMarks(ctx, marks, opts) { (marks || []).forEach(function (m) { drawMark(ctx, m, opts); }); }
  function markAt(marks, pt, r) { r = r || MARK_R * 1.3; for (var i = (marks || []).length - 1; i >= 0; i--) { var m = marks[i]; var dy = m.kind === 'photo' ? pt[1] - (m.y - MARK_R * 1.4) : pt[1] - m.y; if (Math.hypot(m.x - pt[0], dy) <= r) return m; } return null; }
  function widthAt(st, p) { if (st.tool === 'hl') return st.w * 4; var pr = (p == null || p === 0) ? 0.5 : p; return st.w * (0.45 + 1.1 * pr); }
  function drawStroke(ctx, st, opts) { drawStrokeSegments(ctx, st, 1, (st.pts || []).length, true, opts); }
  // v1.3.1 — segments [from, to) of a stroke, so a live stroke is painted INCREMENTALLY while the pen moves (Notability feel:
  // each pointer event adds its new segments instead of repainting the whole stroke). Segment i is the quadratic through the
  // midpoints around pts[i-1], so it depends only on pts[i-2..i]; `cap` draws the final lineTo to the last point.
  function drawStrokeSegments(ctx, st, from, to, cap, opts) {
    var pts = st.pts; if (!pts || !pts.length) return;
    var alpha = (opts && opts.alpha != null) ? opts.alpha : 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = st.c; ctx.globalAlpha = alpha;
    if (st.tool === 'hl') { ctx.globalAlpha = 0.32 * alpha; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
    if (pts.length === 1) { if (from <= 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], widthAt(st, pts[0][2]) / 2, 0, Math.PI * 2); ctx.fillStyle = st.c; ctx.fill(); } ctx.restore(); return; }
    from = Math.max(1, from | 0); to = Math.min(pts.length, to == null ? pts.length : to | 0);
    for (var i = from; i < to; i++) {
      var prev = pts[i - 1], p = pts[i], w = (widthAt(st, prev[2]) + widthAt(st, p[2])) / 2;
      ctx.lineWidth = Math.max(0.4, w); ctx.beginPath();
      if (i > 1) { var pp = pts[i - 2]; ctx.moveTo((pp[0] + prev[0]) / 2, (pp[1] + prev[1]) / 2); ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2); }
      else { ctx.moveTo(prev[0], prev[1]); ctx.lineTo((prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2); }
      if (cap && i === pts.length - 1) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawObjects(ctx, objects, images, opts) {
    var alpha = (opts && opts.alpha != null) ? opts.alpha : 1;
    (objects || []).forEach(function (o) {
      ctx.save(); ctx.globalAlpha = alpha;
      if (o.kind === 'text') { drawText(ctx, o); ctx.restore(); return; }
      var im = images && images[o.src];
      if (im) { try { ctx.drawImage(im, o.x, o.y, o.w, o.h); } catch (e) { } }
      else if (!(opts && opts.skipMissing)) { ctx.fillStyle = '#eef0f4'; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.strokeStyle = '#b8bec8'; ctx.lineWidth = 1; ctx.strokeRect(o.x, o.y, o.w, o.h); }
      ctx.restore();
    });
  }
  // v1.2.0 — typed text: wrapped to o.w at o.size px (page units); o.h is kept in step so hit-testing / selection boxes fit
  function wrapText(ctx, text, width) {
    var out = []; String(text || '').split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/), cur = '';
      words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > width && cur) { out.push(cur); cur = w; } else cur = t; });
      out.push(cur);
    }); return out;
  }
  function drawText(ctx, o) {
    var size = o.size || 32, lh = size * 1.25;
    ctx.font = (o.bold ? 'bold ' : '') + size + 'px "DM Sans", system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = o.c || '#141414';
    var lines = wrapText(ctx, o.text, Math.max(size, o.w || size * 8)); o.h = Math.max(lh, lines.length * lh);
    lines.forEach(function (ln, i) { ctx.fillText(ln, o.x, o.y + i * lh); });
  }
  function drawPaper(ctx, page, lw) {
    var sp = page.space;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sp.w, sp.h);
    if (page.image) { var f = page.imageFit || { x: 0, y: 0, w: sp.w, h: sp.h }; try { ctx.drawImage(page.image, f.x, f.y, f.w, f.h); } catch (e) { } }
    else if (page.paper === 'lined') {
      ctx.strokeStyle = '#c9d3e6'; ctx.lineWidth = lw;
      for (var y = PAPER.line * 2; y < sp.h; y += PAPER.line) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(sp.w - 40, y); ctx.stroke(); }
      ctx.strokeStyle = '#f0b9b9'; ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(90, sp.h); ctx.stroke();
    } else if (page.paper === 'grid') {
      ctx.strokeStyle = '#dde3ee'; ctx.lineWidth = lw; ctx.beginPath();
      for (var gx = 0; gx <= sp.w; gx += PAPER.grid) { ctx.moveTo(gx, 0); ctx.lineTo(gx, sp.h); }
      for (var gy = 0; gy <= sp.h; gy += PAPER.grid) { ctx.moveTo(0, gy); ctx.lineTo(sp.w, gy); }
      ctx.stroke();
    }
  }
  function drawInk(ctx, ink, images, opts) {
    drawObjects(ctx, (ink && ink.objects) || [], images, Object.assign({ skipMissing: true }, opts || {}));
    ((ink && ink.strokes) || []).forEach(function (st) { drawStroke(ctx, st, opts); });
    drawMarks(ctx, (ink && ink.marks) || [], opts);
  }
  function renderPage(page, canvas, pxWidth, opts) {
    opts = opts || {}; var sp = page.space, s = pxWidth / sp.w;
    canvas = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    canvas.width = Math.round(pxWidth); canvas.height = Math.round(sp.h * s);
    var x = canvas.getContext('2d'); x.setTransform(s, 0, 0, s, 0, 0);
    drawPaper(x, page, 1 / s); drawObjects(x, page.objects, page.images);
    (page.strokes || []).forEach(function (st) { drawStroke(x, opts.minStroke ? Object.assign({}, st, { w: Math.max(st.w, opts.minStroke / s) }) : st); });
    drawMarks(x, page.marks, { r: Math.max(MARK_R, (opts.minMark || 0) / s) });
    return canvas;
  }
  return { VERSION: VERSION, PAPER: PAPER, MARK_R: MARK_R, PIN_LABEL: PIN_LABEL, inkFor: inkFor, drawText: drawText, wrapText: wrapText, drawMark: drawMark, drawMarks: drawMarks, markAt: markAt, widthAt: widthAt, drawStroke: drawStroke, drawStrokeSegments: drawStrokeSegments, drawObjects: drawObjects, drawPaper: drawPaper, drawInk: drawInk, renderPage: renderPage };
}));
