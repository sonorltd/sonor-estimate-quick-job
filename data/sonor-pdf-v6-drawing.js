/* ============================================================================
   sonor-pdf-v6-drawing.js  ·  v1.2.1  ·  2026-05-28 (revert v1.2.0 recolour)
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   SVG → pdf-lib vector emitter + raster image painter.

   Handles the subset of SVG actually used by Sonor drawings:
     <svg>  (nested — the v5 svg2pdf bug class)
     <g transform="translate(…) scale(…) rotate(…)">
     <rect> <circle> <line> <polyline> <polygon>
     <path d="M … L … C … Z">   (M, L, H, V, C, Q, A, Z — uppercase + lowercase)
     <text> <tspan>             (single-span text — multi-tspan caveat below)
     style/fill/stroke/stroke-width/opacity/stroke-dasharray attributes
     vector-effect="non-scaling-stroke"

   This is the workspace-side fix for the Acoustic Positions black-squares bug
   (audit finding §6 + research §3). svg2pdf.js dropped nested <svg>; we
   recurse into them properly with viewBox-aware coordinate translation.

   Public:
     paintSvg(page, ctx, svgEl, opts) → { width, height }
     paintImage(page, ctx, srcOrBytes, opts) → { width, height }   (raster fallback)
     paintScaleBar(page, ctx, opts)
     paintStatusWatermark(page, ctx)

   Exposes window.SonorPdfV6Drawing.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Drawing && window.SonorPdfV6Drawing.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;
  const C = window.SonorPdfV6Chrome;

  /* =========================================================================
     SVG → PDF emitter
     ========================================================================= */

  /**
   * Paint an SVG element into a target rect on the page.
   *
   * v6.3.0 — RESVG-FIRST. Per Bryn 2026-05-27 ("use the best possible
   * method ... find way forward using libraries which you can learn from
   * and customise"). The hand-rolled SonorPdfV6SvgEmitter v1.1.0 covered
   * basics (paths/text) but was missing opacity, gradients, patterns,
   * clipPath, masks, filters — the MS Paint look in Bryn's v6.2.1 test.
   * Resvg (Mozilla/Servo, WASM) implements the full SVG spec correctly,
   * is what GitHub uses for OG images, and produces pixel-identical output
   * to the browser at any DPR. At 4× DPR (~600 DPI on A3) the drawing
   * pages are print-grade.
   *
   * Fallback chain (each fires only if the previous fails):
   *   1. Resvg (PNG @ 4× DPR via WASM)         — primary, looks correct
   *   2. SonorPdfV6SvgEmitter (raw PDF ops)    — vector backup if Resvg fails
   *   3. Basic walker below                    — last resort
   *
   * @param {PDFPage} page
   * @param {object}  ctx       paint context (must have ctx.pdfDoc for Resvg)
   * @param {SVGElement|string} svgEl  live DOM element OR an svg string
   * @param {object}  opts
   *   - x, y       top-left of target rect on the page (pt)
   *   - w, h       target rect size (pt) — SVG fits proportionally inside
   *   - dpr        device-pixel ratio for Resvg raster (default 4 = ~600 DPI on A3)
   * @returns {Promise<{ width:number, height:number, source:string }>}
   */
  /**
   * v7.9.4 — Inject white viewBox backplate into every <svg> (including
   * nested) so CD-internal renderers (drawSightlineH/V, drawCofferSection,
   * projector throw, sub-images in composite picture pages) that emit dark
   * backdrops get a guaranteed white background underneath. Universal —
   * works for every SVG source regardless of pipeline. Idempotent — if a
   * white backplate already exists (e.g. CT's v6.5.3 cd-bg-plate) the
   * additional one is harmless.
   *
   * Strategy: regex-match every `<svg ... viewBox="x y w h" ...>` and
   * inject a `<rect x="x" y="y" width="w" height="h" fill="white"/>` as
   * the immediate next sibling. SVG content stays unchanged otherwise.
   */
  // v7.9.4: inject a white backplate after each <svg> opening tag.
  // v7.10.2 REVERT: v7.9.6 added a recolour-dark-rects pass that wiped CT
  // content (CT renders light strokes on dark backplate — recolour made
  // strokes invisible). Reverted to v7.9.4 behaviour (inject only). The
  // DR-07 black-bg fix needs a tighter approach (e.g. only the FIRST rect
  // that fills the viewBox AND only when paired with light strokes — both
  // conditions hard to detect reliably from SVG text). Held as backlog.
  function _injectWhiteBackplate(svgStr) {
    if (!svgStr || typeof svgStr !== 'string') return svgStr;
    return svgStr.replace(
      /(<svg\b[^>]*\bviewBox=["']([-\d.\s]+)["'][^>]*>)/gi,
      function (full, openTag, vbValue) {
        const parts = String(vbValue).trim().split(/\s+/).map(parseFloat);
        if (parts.length !== 4 || parts.some(isNaN)) return full;
        const [vx, vy, vw, vh] = parts;
        const plate = '<rect x="' + vx + '" y="' + vy + '" width="' + vw +
                      '" height="' + vh + '" fill="#ffffff" class="cd-pdf-bg-plate"/>';
        return openTag + plate;
      }
    );
  }

  // v8.0.0-rc.2 (Takeoffs B-376 P3 — vector plans) — optional raster
  // UNDERLAY beneath the vector SVG. The Takeoffs plan background (the
  // architect PDF page render) stays a raster image while everything DRAWN
  // (rooms, cables, blocks, labels) goes true vector. The underlay is
  // positioned through the SAME xMidYMid-meet fit as the SVG so the two
  // layers register exactly.
  //   opts/contents.underlay = { dataUrl, viewBox:{x,y,w,h}, rect:{x,y,w,h}, opacity? }
  async function paintUnderlay(page, ctx, underlay, box, vb) {
    if (!underlay || !underlay.dataUrl || !vb || !box) return;
    try {
      const pdfDoc = ctx.pdfDoc || (page && page.doc);
      const m = String(underlay.dataUrl).match(/^data:image\/(png|jpe?g);base64,(.*)$/s);
      if (!pdfDoc || !m) return;
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      const img = (m[1] === 'png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const r = underlay.rect || vb;
      const arSvg = vb.w / vb.h, arBox = box.w / box.h;
      let fitW, fitH;
      if (arSvg > arBox) { fitW = box.w; fitH = box.w / arSvg; }
      else               { fitH = box.h; fitW = box.h * arSvg; }
      const offX = box.x + (box.w - fitW) / 2;
      const offY = box.y + (box.h - fitH) / 2;
      const scale = fitW / vb.w;
      const x = offX + ((r.x - vb.x) * scale);
      const hPt = r.h * scale;
      const y = offY + fitH - ((r.y - vb.y) * scale) - hPt;   // SVG top-left → PDF bottom-left
      page.drawImage(img, {
        x, y, width: r.w * scale, height: hPt,
        opacity: (underlay.opacity != null) ? underlay.opacity : 1
      });
    } catch (e) { console.warn('[SonorPdfV6Drawing] underlay failed:', e && e.message); }
  }

  async function paintSvg(page, ctx, svgEl, opts) {
    const o = Object.assign({ x: 0, y: 0, w: 400, h: 300, dpr: 4 }, opts);

    // Resolve SVG string once for any path that needs it
    let _svgString = (typeof svgEl === 'string') ? svgEl : (svgEl && svgEl.outerHTML) || '';
    // v7.9.4 — universal white backplate injection (fixes DR-07 sightlines
    // picture + DR-09 coffer plan + DR-10 coffer section dark backgrounds).
    _svgString = _injectWhiteBackplate(_svgString);
    // If svgEl was a string, the string is canonical for downstream;
    // if it was a node, downstream paths that use .outerHTML directly will
    // still see the dark version — but the v7/Resvg/emitter all read from
    // _svgString below, so we route them via the injected string instead.
    const svgInput = (typeof svgEl === 'string') ? _svgString : (_svgString || svgEl);

    // v6.5.1 (pre-staged for v7.0.0) — PRIMARY PATH: SonorPdfV7 typst/svg2pdf
    // via Rust+WASM. TRUE VECTOR output — embeds single-page PDF as XObject
    // via pdfDoc.embedPdf + page.drawPage. Cmd-F finds drawing text, lines
    // crisp at infinite zoom, ~70% smaller PDFs vs Resvg raster. Auto-skips
    // until Bryn's one-time `wasm-pack build` lands the WASM on the brand
    // CDN — until then this no-ops and Resvg stays primary by default.
    if (window.SonorPdfV7 && _svgString) {
      try {
        const pdfDoc = ctx.pdfDoc || (page && page.doc);
        if (!pdfDoc) throw new Error('v7 path needs ctx.pdfDoc');
        // Trigger lazy init on first call. Subsequent calls reuse the
        // cached WASM. If WASM 404s or instantiation throws, fall through.
        const emb = await window.SonorPdfV7.renderAndEmbed(pdfDoc, _svgString);
        // emb is a PDFEmbeddedPage. Fit into target rect preserving aspect.
        const aspect = emb.width / emb.height;
        const targetAspect = o.w / o.h;
        let dw, dh;
        if (aspect > targetAspect) { dw = o.w; dh = o.w / aspect; }
        else                        { dh = o.h; dw = o.h * aspect; }
        const dx = o.x + (o.w - dw) / 2;
        const dy = o.y + (o.h - dh) / 2;
        page.drawPage(emb, { x: dx, y: dy, width: dw, height: dh });
        return { width: dw, height: dh, source: 'sonor-v7-typst', vector: true };
      } catch (e) {
        console.warn('[SonorPdfV6Drawing] v7 typst/svg2pdf failed, falling back to Resvg:', e && e.message);
      }
    }

    // SECONDARY PATH: Resvg raster @ 4× DPR — pixel-perfect SVG rendering
    if (window.SonorPdfV6Resvg) {
      try {
        // v7.9.4 — use the backplate-injected string from _svgString above
        // so Resvg also gets the white backdrop (was reading raw svgEl).
        const svgString = _svgString;
        if (svgString) {
          const pdfDoc = ctx.pdfDoc || (page && page.doc);
          if (!pdfDoc) throw new Error('Resvg path needs ctx.pdfDoc or page.doc');
          const pngBytes = await window.SonorPdfV6Resvg.renderSvgToPng(svgString, {
            dpr: o.dpr,
            background: 'transparent',
          });
          const image = await pdfDoc.embedPng(pngBytes);
          // Fit image into target rect preserving aspect (xMidYMid meet)
          const aspect = image.width / image.height;
          const targetAspect = o.w / o.h;
          let dw, dh;
          if (aspect > targetAspect) { dw = o.w; dh = o.w / aspect; }
          else                        { dh = o.h; dw = o.h * aspect; }
          const dx = o.x + (o.w - dw) / 2;
          const dy = o.y + (o.h - dh) / 2;
          page.drawImage(image, { x: dx, y: dy, width: dw, height: dh });
          return { width: dw, height: dh, source: 'resvg', dpr: o.dpr };
        }
      } catch (e) {
        console.warn('[SonorPdfV6Drawing] Resvg failed, falling back to vector emitter:', e && e.message);
      }
    }

    // SECONDARY PATH: Sonor's own CAD-class SVG emitter — true vector
    if (window.SonorPdfV6SvgEmitter) {
      try {
        // v7.9.4 — pass the backplate-injected svgInput so the emitter's
        // walk includes the white plate as the first child of each <svg>.
        const r = window.SonorPdfV6SvgEmitter.paint(page, ctx, svgInput, o);
        return Object.assign({ source: 'sonor-emitter', vector: true }, r);
      } catch (e) {
        console.warn('[SonorPdfV6Drawing] CAD emitter threw — falling back to basic walker:', e && e.message);
      }
    } else {
      console.warn('[SonorPdfV6Drawing] SonorPdfV6SvgEmitter not loaded — using basic walker');
    }

    // FALLBACK PATH: basic walker (v6.0.x, partial SVG support)
    const svg = (typeof svgEl === 'string') ? _parseSvgString(svgEl) : svgEl;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
      console.warn('[SonorPdfV6Drawing] paintSvg: invalid SVG'); return { width: 0, height: 0 };
    }
    o.clip = o.clip !== false;
    const vb = _viewBox(svg);
    const fit = _fitInto(vb, o.w, o.h);
    // PDF coords have y-up; SVG has y-down. We flip via a per-emit factor +
    // origin offset (toY function).
    const px0 = o.x + (o.w - fit.w) / 2;
    const py0 = o.y + (o.h - fit.h) / 2;

    // P2 (DRAWING-CAD-PDF-ROADMAP) — stash the placed to-scale plan rect (PDF
    // points) so the post-pass `measureDict` feature can scope an Acrobat
    // Measure/Viewport dict to the drawing only. Pure metadata; no effect on
    // render. Read by SonorPdfV6PostPass.measureDict.
    try { page.__sonorDrawRegion = { x0: px0, y0: py0, x1: px0 + fit.w, y1: py0 + fit.h }; } catch (_) {}

    const state = {
      page,
      ctx,
      fonts: ctx.fonts,
      fontFallback: o.fontFallback || ctx.fonts.reg,
      // Coord transform: world (svg) → page (pdf)
      // x_pdf = px0 + (x_svg - vb.x) * fit.scale
      // y_pdf = py0 + fit.h - (y_svg - vb.y) * fit.scale
      px0, py0, vb, scale: fit.scale, fitH: fit.h,
      // Inheritance stack — populated as we descend
      style: { fill: '#000000', stroke: 'none', strokeWidth: 1, opacity: 1, dash: null },
    };

    _walk(svg, state);
    return { width: fit.w, height: fit.h };
  }

  /** Parse a string into an SVG element (browser DOMParser). */
  function _parseSvgString(str) {
    const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
    return doc.documentElement;
  }

  /** Read viewBox or fall back to width/height attributes. */
  function _viewBox(svg) {
    const vbStr = svg.getAttribute('viewBox');
    if (vbStr) {
      const p = vbStr.trim().split(/\s*,\s*|\s+/).map(parseFloat);
      if (p.length === 4) return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    const w = parseFloat(svg.getAttribute('width')) || 100;
    const h = parseFloat(svg.getAttribute('height')) || 100;
    return { x: 0, y: 0, w, h };
  }

  /** Compute the largest rect with the SVG's aspect that fits in (w, h). */
  function _fitInto(vb, w, h) {
    const ar = vb.w / vb.h;
    const arTarget = w / h;
    if (ar > arTarget) {
      // SVG wider than target → height-limited
      const W = w, H = w / ar, scale = W / vb.w;
      return { w: W, h: H, scale };
    } else {
      const H = h, W = h * ar, scale = H / vb.h;
      return { w: W, h: H, scale };
    }
  }

  /** Recursively walk an SVG node and emit pdf-lib draw calls. */
  function _walk(node, parentState) {
    // For elements that carry style, inherit + read attributes onto a fresh state.
    const state = _inheritStyle(parentState, node);

    const tag = node.nodeName ? node.nodeName.toLowerCase() : '';
    switch (tag) {
      case 'svg':
        // Nested <svg> — push a new viewBox-aware transform.
        if (node !== _rootSvg(node)) {
          _emitNestedSvg(node, state);
        } else {
          // Root — children inherit ambient state
          _emitChildren(node, state);
        }
        return;
      case 'g':
        _withTransform(node, state, () => _emitChildren(node, state));
        return;
      case 'rect':       return _emitRect(node, state);
      case 'circle':     return _emitCircle(node, state);
      case 'ellipse':    return _emitEllipse(node, state);
      case 'line':       return _emitLine(node, state);
      case 'polyline':   return _emitPolyline(node, state, false);
      case 'polygon':    return _emitPolyline(node, state, true);
      case 'path':       return _emitPath(node, state);
      case 'text':       return _emitText(node, state);
      case 'defs':
      case 'title':
      case 'desc':
      case 'metadata':
        return; // skipped
      default:
        // Unknown element — try to emit children anyway
        _emitChildren(node, state);
    }
  }

  function _rootSvg(n) {
    let p = n;
    while (p && p.parentNode && p.parentNode.nodeName && p.parentNode.nodeName.toLowerCase() === 'g') {
      p = p.parentNode;
    }
    return p;
  }
  function _emitChildren(node, state) {
    const cs = node.childNodes;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].nodeType === 1) _walk(cs[i], state);
    }
  }

  /** Inherit style from parent state + node-level attribute overrides. */
  function _inheritStyle(parent, node) {
    const s = Object.assign({}, parent, { style: Object.assign({}, parent.style) });
    const a = node.getAttribute ? (k) => node.getAttribute(k) : () => null;
    if (a('fill') != null && a('fill') !== '') s.style.fill = a('fill');
    if (a('stroke') != null && a('stroke') !== '') s.style.stroke = a('stroke');
    if (a('stroke-width') != null) s.style.strokeWidth = parseFloat(a('stroke-width')) || 0;
    if (a('opacity') != null) s.style.opacity = parseFloat(a('opacity'));
    if (a('fill-opacity') != null) s.style.fillOpacity = parseFloat(a('fill-opacity'));
    if (a('stroke-opacity') != null) s.style.strokeOpacity = parseFloat(a('stroke-opacity'));
    if (a('stroke-dasharray') != null) s.style.dash = String(a('stroke-dasharray'));
    // Inline style attribute is a minimal parser — common properties only
    const inline = a('style');
    if (inline) {
      String(inline).split(';').forEach(decl => {
        const [k, v] = decl.split(':').map(x => x && x.trim());
        if (!k || !v) return;
        if (k === 'fill') s.style.fill = v;
        else if (k === 'stroke') s.style.stroke = v;
        else if (k === 'stroke-width') s.style.strokeWidth = parseFloat(v) || 0;
        else if (k === 'opacity') s.style.opacity = parseFloat(v);
        else if (k === 'stroke-dasharray') s.style.dash = v;
      });
    }
    return s;
  }

  /** Run fn with a translated/scaled coordinate state from g[transform]. */
  function _withTransform(node, state, fn) {
    const t = node.getAttribute ? node.getAttribute('transform') : null;
    if (!t) return fn();
    const ops = _parseTransform(t);
    const prev = { px0: state.px0, py0: state.py0, scale: state.scale, vbX: state.vb.x, vbY: state.vb.y };
    // Apply ops in declaration order — simple sequential model that handles
    // translate / scale / rotate around origin. Rotation only supported on
    // single-element transforms targeting text (rare in Sonor SVGs).
    ops.forEach(op => {
      if (op.type === 'translate') {
        // Shift the viewport origin in SVG units
        state.vb.x -= op.tx;
        state.vb.y -= op.ty;
      } else if (op.type === 'scale') {
        state.scale *= op.sx;
        // Match width/height shrink
      }
      // rotate handled inline at text emit, not at group-level (parity with
      // current Sonor SVG corpus).
    });
    try { fn(); } finally {
      state.vb.x = prev.vbX; state.vb.y = prev.vbY; state.scale = prev.scale;
    }
  }

  function _parseTransform(s) {
    const ops = [];
    const re = /(translate|scale|rotate|matrix)\s*\(\s*([^)]+)\s*\)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const args = m[2].split(/[\s,]+/).map(parseFloat);
      switch (m[1]) {
        case 'translate': ops.push({ type: 'translate', tx: args[0] || 0, ty: args[1] || 0 }); break;
        case 'scale':     ops.push({ type: 'scale', sx: args[0] || 1, sy: args[1] != null ? args[1] : args[0] }); break;
        case 'rotate':    ops.push({ type: 'rotate', angle: args[0] || 0, cx: args[1] || 0, cy: args[2] || 0 }); break;
        case 'matrix':    ops.push({ type: 'matrix', m: args }); break;
      }
    }
    return ops;
  }

  /** Convert SVG (x,y) → page (x,y). */
  function _x(state, x) { return state.px0 + (x - state.vb.x) * state.scale; }
  function _y(state, y) { return state.py0 + state.fitH - (y - state.vb.y) * state.scale; }
  function _s(state, v) { return v * state.scale; }

  function _strokeColour(state) {
    if (!state.style.stroke || state.style.stroke === 'none') return null;
    return H.toLibRgb(state.style.stroke);
  }
  function _fillColour(state) {
    if (!state.style.fill || state.style.fill === 'none' || state.style.fill === 'transparent') return null;
    return H.toLibRgb(state.style.fill);
  }
  function _strokeOpts(state) {
    const col = _strokeColour(state);
    if (!col) return null;
    return {
      borderColor: col,
      borderWidth: Math.max(0.25, _s(state, state.style.strokeWidth || 1)),
      borderOpacity: state.style.strokeOpacity != null ? state.style.strokeOpacity : (state.style.opacity || 1),
    };
  }

  /* ---- element emitters ----------------------------------------------- */

  function _emitNestedSvg(node, parent) {
    // Nested <svg x y width height viewBox> — the bug case from v5.
    const x = parseFloat(node.getAttribute('x')) || 0;
    const y = parseFloat(node.getAttribute('y')) || 0;
    const w = parseFloat(node.getAttribute('width')) || 0;
    const h = parseFloat(node.getAttribute('height')) || 0;
    const vb = _viewBox(node);
    // Outer-coord rect for the nested svg → pdf rect
    const px = _x(parent, x);
    const py = _y(parent, y + h);
    const pw = _s(parent, w);
    const ph = _s(parent, h);
    const fit = _fitInto(vb, pw, ph);
    // Build a fresh inner state — its coords are the nested viewBox
    const inner = Object.assign({}, parent, {
      px0: px + (pw - fit.w) / 2,
      py0: py + (ph - fit.h) / 2,
      vb: { x: vb.x, y: vb.y, w: vb.w, h: vb.h },
      scale: fit.scale,
      fitH: fit.h,
      style: Object.assign({}, parent.style),
    });
    _emitChildren(node, inner);
  }

  function _emitRect(node, state) {
    const x = parseFloat(node.getAttribute('x')) || 0;
    const y = parseFloat(node.getAttribute('y')) || 0;
    const w = parseFloat(node.getAttribute('width')) || 0;
    const h = parseFloat(node.getAttribute('height')) || 0;
    if (!w || !h) return;
    const fill = _fillColour(state);
    const sopts = _strokeOpts(state) || {};
    state.page.drawRectangle({
      x: _x(state, x),
      y: _y(state, y + h),
      width: _s(state, w),
      height: _s(state, h),
      color: fill || undefined,
      opacity: state.style.fillOpacity != null ? state.style.fillOpacity : (state.style.opacity || 1),
      ...sopts,
    });
  }

  function _emitCircle(node, state) {
    const cx = parseFloat(node.getAttribute('cx')) || 0;
    const cy = parseFloat(node.getAttribute('cy')) || 0;
    const r  = parseFloat(node.getAttribute('r'))  || 0;
    if (!r) return;
    const fill = _fillColour(state);
    const sopts = _strokeOpts(state) || {};
    state.page.drawCircle({
      x: _x(state, cx),
      y: _y(state, cy),
      size: _s(state, r),
      color: fill || undefined,
      opacity: state.style.fillOpacity != null ? state.style.fillOpacity : (state.style.opacity || 1),
      ...sopts,
    });
  }
  function _emitEllipse(node, state) {
    const cx = parseFloat(node.getAttribute('cx')) || 0;
    const cy = parseFloat(node.getAttribute('cy')) || 0;
    const rx = parseFloat(node.getAttribute('rx')) || 0;
    const ry = parseFloat(node.getAttribute('ry')) || 0;
    if (!rx || !ry) return;
    state.page.drawEllipse({
      x: _x(state, cx), y: _y(state, cy),
      xScale: _s(state, rx), yScale: _s(state, ry),
      color: _fillColour(state) || undefined,
      ..._strokeOpts(state) || {},
    });
  }
  function _emitLine(node, state) {
    const x1 = parseFloat(node.getAttribute('x1')) || 0;
    const y1 = parseFloat(node.getAttribute('y1')) || 0;
    const x2 = parseFloat(node.getAttribute('x2')) || 0;
    const y2 = parseFloat(node.getAttribute('y2')) || 0;
    const col = _strokeColour(state);
    if (!col) return;
    if (state.style.dash) {
      H.drawDashedLine(state.page,
        { x: _x(state, x1), y: _y(state, y1) },
        { x: _x(state, x2), y: _y(state, y2) },
        { color: state.style.stroke, thickness: _s(state, state.style.strokeWidth || 1) }
      );
    } else {
      state.page.drawLine({
        start: { x: _x(state, x1), y: _y(state, y1) },
        end:   { x: _x(state, x2), y: _y(state, y2) },
        color: col,
        thickness: _s(state, state.style.strokeWidth || 1),
        opacity: state.style.opacity || 1,
      });
    }
  }
  function _emitPolyline(node, state, closed) {
    const pts = String(node.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
    if (pts.length < 4) return;
    const points = [];
    for (let i = 0; i < pts.length; i += 2) points.push([pts[i], pts[i + 1]]);
    if (closed) points.push(points[0]);
    const col = _strokeColour(state);
    for (let i = 0; i < points.length - 1; i++) {
      if (col) {
        state.page.drawLine({
          start: { x: _x(state, points[i][0]),   y: _y(state, points[i][1]) },
          end:   { x: _x(state, points[i+1][0]), y: _y(state, points[i+1][1]) },
          color: col,
          thickness: _s(state, state.style.strokeWidth || 1),
        });
      }
    }
    // Fill not supported on polylines (would need SVG path emission); leave it
    // for path-based shapes, which Sonor SVGs use for true polygon fills.
  }
  function _emitPath(node, state) {
    const d = node.getAttribute('d');
    if (!d || !state.page.drawSvgPath) {
      // pdf-lib's drawSvgPath needs the d in PDF-space coords. Build a tiny
      // transformed version by parsing M/L/H/V commands. We keep it small —
      // Sonor paths are mostly rectangles / lines / quadratic curves.
      _emitSimplePath(d, state);
      return;
    }
    // Use pdf-lib's drawSvgPath when available — handles Bezier curves
    // cleanly. We pass per-call colour/transform via x/y/scale.
    const fill = _fillColour(state);
    const stroke = _strokeColour(state);
    state.page.drawSvgPath(d, {
      x: state.px0 - state.vb.x * state.scale,
      y: state.py0 + state.fitH + state.vb.y * state.scale,
      scale: state.scale,
      color: fill || undefined,
      borderColor: stroke || undefined,
      borderWidth: stroke ? Math.max(0.25, _s(state, state.style.strokeWidth || 1)) : 0,
      opacity: state.style.opacity || 1,
    });
  }
  function _emitSimplePath(d, state) {
    if (!d) return;
    // Tokenise into commands + numbers
    const re = /([MLHVZmlhvzCcSsQqTtAa])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let m, cmd = 'M', cur = { x: 0, y: 0 }, start = { x: 0, y: 0 };
    let prev = null;
    while ((m = re.exec(d)) !== null) {
      const tok = m[0];
      if (/[a-zA-Z]/.test(tok)) {
        cmd = tok;
        if (cmd === 'Z' || cmd === 'z') {
          if (prev && _strokeColour(state)) {
            state.page.drawLine({
              start: { x: _x(state, cur.x), y: _y(state, cur.y) },
              end:   { x: _x(state, start.x), y: _y(state, start.y) },
              color: _strokeColour(state),
              thickness: _s(state, state.style.strokeWidth || 1),
            });
          }
          cur = { x: start.x, y: start.y };
        }
        continue;
      }
      // It's a number — consume operands per cmd
      const nx = parseFloat(tok);
      if (cmd === 'M' || cmd === 'm') {
        const yMatch = re.exec(d); const ny = parseFloat(yMatch[0]);
        const x = cmd === 'M' ? nx : cur.x + nx;
        const y = cmd === 'M' ? ny : cur.y + ny;
        cur = { x, y }; start = { x, y }; prev = cur;
        cmd = (cmd === 'M' ? 'L' : 'l');
      } else if (cmd === 'L' || cmd === 'l') {
        const yMatch = re.exec(d); const ny = parseFloat(yMatch[0]);
        const x = cmd === 'L' ? nx : cur.x + nx;
        const y = cmd === 'L' ? ny : cur.y + ny;
        if (_strokeColour(state)) {
          state.page.drawLine({
            start: { x: _x(state, cur.x), y: _y(state, cur.y) },
            end:   { x: _x(state, x),     y: _y(state, y) },
            color: _strokeColour(state),
            thickness: _s(state, state.style.strokeWidth || 1),
          });
        }
        cur = { x, y }; prev = cur;
      } else if (cmd === 'H' || cmd === 'h') {
        const x = cmd === 'H' ? nx : cur.x + nx;
        if (_strokeColour(state)) {
          state.page.drawLine({
            start: { x: _x(state, cur.x), y: _y(state, cur.y) },
            end:   { x: _x(state, x),     y: _y(state, cur.y) },
            color: _strokeColour(state),
            thickness: _s(state, state.style.strokeWidth || 1),
          });
        }
        cur = { x, y: cur.y };
      } else if (cmd === 'V' || cmd === 'v') {
        const y = cmd === 'V' ? nx : cur.y + nx;
        if (_strokeColour(state)) {
          state.page.drawLine({
            start: { x: _x(state, cur.x), y: _y(state, cur.y) },
            end:   { x: _x(state, cur.x), y: _y(state, y) },
            color: _strokeColour(state),
            thickness: _s(state, state.style.strokeWidth || 1),
          });
        }
        cur = { x: cur.x, y };
      } else {
        // C/Q/A — skip operands (count varies); emit a straight line to next
        // anchor point approximation. Sonor paths rarely use cubic.
        // Consume 5 more numbers (max for C). Best-effort.
        for (let k = 0; k < 5; k++) re.exec(d);
      }
    }
  }
  function _emitText(node, state) {
    const x = parseFloat(node.getAttribute('x')) || 0;
    const y = parseFloat(node.getAttribute('y')) || 0;
    const sz = parseFloat(node.getAttribute('font-size')) || 10;
    const weight = (node.getAttribute('font-weight') || '').toLowerCase();
    const anchor = node.getAttribute('text-anchor') || 'start';
    const font = (weight === 'bold' || weight === '700' || weight === '800' || weight === '900')
      ? state.fonts.bold : state.fontFallback;
    const fillCol = node.getAttribute('fill') || state.style.fill || '#2C2218';
    const str = node.textContent || '';
    H.drawText(state.page, str, {
      x: _x(state, x),
      y: _y(state, y) - sz * 0.25, // baseline tweak
      font,
      size: _s(state, sz),
      color: fillCol,
      align: anchor === 'middle' ? 'center' : (anchor === 'end' ? 'right' : 'left'),
      opacity: state.style.opacity || 1,
    });
  }

  /* =========================================================================
     Raster image painter (for 3D renders only)
     ========================================================================= */

  /**
   * Embed a raster image (JPEG / PNG / dataURL / ArrayBuffer / Uint8Array) and
   * draw it into a target rect.
   *
   * @param {PDFPage} page
   * @param {object}  ctx
   * @param {string|ArrayBuffer|Uint8Array} src
   * @param {object}  opts  { x, y, w, h, fit: 'contain'|'cover'|'fill' }
   */
  async function paintImage(page, ctx, src, opts) {
    const o = Object.assign({ x: 0, y: 0, w: 400, h: 300, fit: 'contain' }, opts);
    const pdfDoc = page.doc;
    const bytes = await _normaliseImage(src);
    const kind = _imageKind(bytes);
    let img;
    if (kind === 'jpeg') img = await pdfDoc.embedJpg(bytes);
    else if (kind === 'png') img = await pdfDoc.embedPng(bytes);
    else throw new Error('SonorPdfV6Drawing.paintImage: unsupported image kind');
    const ar = img.width / img.height, arT = o.w / o.h;
    let drawW = o.w, drawH = o.h, drawX = o.x, drawY = o.y;
    if (o.fit === 'contain') {
      if (ar > arT) { drawH = o.w / ar; drawY = o.y + (o.h - drawH) / 2; }
      else          { drawW = o.h * ar; drawX = o.x + (o.w - drawW) / 2; }
    } else if (o.fit === 'cover') {
      if (ar > arT) { drawW = o.h * ar; drawX = o.x - (drawW - o.w) / 2; }
      else          { drawH = o.w / ar; drawY = o.y - (drawH - o.h) / 2; }
    }
    page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
    return { width: drawW, height: drawH };
  }
  async function _normaliseImage(src) {
    if (src instanceof Uint8Array) return src;
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    if (typeof src === 'string') {
      if (src.startsWith('data:')) {
        const b64 = src.split(',')[1];
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u;
      }
      // URL
      const buf = await (await fetch(src)).arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new Error('Unsupported image source');
  }
  function _imageKind(u8) {
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpeg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
    return null;
  }

  /* =========================================================================
     Scale bar (drawing-package convention)
     ========================================================================= */

  function paintScaleBar(page, ctx, opts) {
    const o = Object.assign({ x: 60, y: 90, scale: '1:50 @ A3', segments: [0, 0.5, 1, 2, 4], unit: 'm' }, opts);
    const fonts = ctx.fonts;
    H.drawText(page, `METRIC SCALE — ${o.scale}`, {
      x: o.x, y: o.y + 14, font: fonts.bold, size: 8, color: T.BASE.muted, letterSpacing: 2,
    });
    const segW = 35;
    o.segments.slice(0, -1).forEach((_, i) => {
      const fill = (i % 2 === 0) ? T.BASE.text : T.BASE.white;
      page.drawRectangle({
        x: o.x + i * segW, y: o.y,
        width: segW, height: 6,
        color: H.toLibRgb(fill),
        borderColor: H.toLibRgb(T.BASE.text),
        borderWidth: 0.5,
      });
    });
    o.segments.forEach((v, i) => {
      const lbl = (i === o.segments.length - 1) ? `${v} ${o.unit}` : String(v);
      const align = i === 0 ? 'left' : 'center';
      H.drawText(page, lbl, {
        x: o.x + i * segW,
        y: o.y - 12,
        font: fonts.reg, size: 9, color: T.BASE.text,
        align,
      });
    });
  }

  /* =========================================================================
     Status watermark (diagonal stamp across page body)
     ========================================================================= */

  function paintStatusWatermark(page, ctx) {
    const status = ctx.meta && ctx.meta.status;
    if (!status) return;
    const { w, h } = T.pageSize(ctx.format || 'A3', ctx.orientation || 'landscape');
    const hex = T.statusColour(status);
    const label = String(status).toUpperCase();
    const font = ctx.fonts.bold;
    // pdf-lib doesn't expose getTextWidth-with-rotation easily; we centre by
    // simple math (rough but consistent).
    page.drawText(label, {
      x: w / 2 - font.widthOfTextAtSize(label, 120) / 2,
      y: h / 2 - 40,
      font, size: 120,
      color: H.toLibRgb(hex),
      opacity: 0.07,
      rotate: H.degrees(-30),
    });
  }

  window.SonorPdfV6Drawing = {
    paintUnderlay,
    VERSION: '1.1.0',
    paintSvg,
    paintImage,
    paintScaleBar,
    paintStatusWatermark,
  };
})();
