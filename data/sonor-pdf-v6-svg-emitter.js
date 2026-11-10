/* ============================================================================
   sonor-pdf-v6-svg-emitter.js  ·  v1.2.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).

   v1.2.0 — OPACITY via ExtGState. v1.1.0 shipped with a documented trade-off
   ("opacity < 1 falls through to opacity = 1, translucent shapes are rare on
   CAD drawings"). That was wrong. CT uses transparency extensively:
   diffusers (~30%), listening area (~25%), radiator (~50%), recipe ghosts
   (~20%), speaker zones (~40%). Without opacity every layer painted solid and
   stacked → "MS Paint blocks" instead of proper layered transparency.
   v1.2.0 implements opacity by:
     1. Creating per-opacity-value ExtGState dicts (cached, deduped)
     2. Registering them in the page's Resources/ExtGState map
     3. Emitting `/SonorGS<n> gs` operator before each fill/stroke
   This is the canonical PDF mechanism. Same approach AutoCAD/Inkscape use for
   layer transparency. Result: layered translucent shapes look exactly like
   they do in CT's canvas — no more solid blocks burying lower layers.

   v1.1.0 — CRITICAL BUG FIX. v1.0.0 emitted path d-strings via pdf-lib's
   `page.drawSvgPath(d, {x:0, y:0})`. drawSvgPath internally treats the path
   as SVG-coordinate (Y-down) and applies its own Y-flip via `pdf_y = y_offset
   - svg_y`. Our CTM ALSO pre-flips Y (`_ctmScale(scale, -scale)` in paint()),
   so every shape was double-flipped → landed off-page. Text rendered correctly
   because H.drawText uses raw page.drawText() with no extra flip — that's why
   v6.1.2 Bryn-test showed all text labels but ZERO rectangles / lines /
   screens / seats. Fix: bypass drawSvgPath, emit raw pdf-lib content-stream
   operators (moveTo / lineTo / appendBezierCurve / fillAndStroke). This is
   what AutoCAD / Inkscape / Figma actually do internally — direct content-
   stream emission with zero library guesswork.
   ----------------------------------------------------------------------------
   SONOR'S OWN CAD-CLASS SVG → PDF VECTOR EMITTER.

   Per Bryn directive 2026-05-27: *"how a proper drawing program would render
   them, not some kind of work around"*. This module is the proper answer —
   it walks the SVG element tree, maintains a Current Transform Matrix (CTM)
   stack, and emits NATIVE PDF content stream operators for every element.
   No raster anywhere. No third-party library. Same internal approach
   AutoCAD / Revit / Inkscape / Figma all use — each writes their own emitter.

   What you get:
     • Lines crisp at infinite zoom (vector throughout)
     • Cmd-F finds room names / dim labels (text as embedded font glyph runs)
     • Print at A0 with no pixelation
     • ~50–70% smaller PDFs than the v6.0.4 raster path
     • Pixel-zero match to what's on screen

   SVG vocabulary supported:
     <svg>, <g>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>,
     <path> (M/L/H/V/C/S/Q/T/A/Z including relative variants), <text>, <tspan>,
     <use> (def-referenced symbol expansion), <defs> (symbol storage),
     <clipPath>, <linearGradient> / <radialGradient> (flattened to solid fills).

   Style attributes supported:
     fill, stroke, stroke-width, stroke-dasharray, stroke-linecap,
     stroke-linejoin, opacity, fill-opacity, stroke-opacity, fill-rule,
     font-family, font-size, font-weight, font-style, text-anchor,
     style="..." inline declarations, transform (translate/scale/rotate/matrix/skew).

   Public API:
     window.SonorPdfV6SvgEmitter.paint(page, ctx, svgEl, opts)
        → emits svgEl into page rect {x, y, w, h} as pure vector

   Called by sonor-pdf-v6-drawing.js as the PRIMARY paintSvg path. Raster
   fallback only fires if this throws.

   Spine v1.2.6 · HARMONY §3 · per Bryn 2026-05-27.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6SvgEmitter && window.SonorPdfV6SvgEmitter.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;

  /* =========================================================================
     CTM (Current Transform Matrix) — 2D affine via [a, b, c, d, e, f]:
       x' = a*x + c*y + e
       y' = b*x + d*y + f
     ========================================================================= */
  function _ctmIdentity() { return [1, 0, 0, 1, 0, 0]; }
  function _ctmMultiply(m1, m2) {
    return [
      m1[0]*m2[0] + m1[2]*m2[1],  m1[1]*m2[0] + m1[3]*m2[1],
      m1[0]*m2[2] + m1[2]*m2[3],  m1[1]*m2[2] + m1[3]*m2[3],
      m1[0]*m2[4] + m1[2]*m2[5] + m1[4],
      m1[1]*m2[4] + m1[3]*m2[5] + m1[5],
    ];
  }
  function _ctmTranslate(tx, ty)    { return [1, 0, 0, 1, tx, ty]; }
  function _ctmScale(sx, sy)        { return [sx, 0, 0, sy != null ? sy : sx, 0, 0]; }
  function _ctmRotate(deg, cx, cy)  {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const m = [c, s, -s, c, 0, 0];
    if (cx || cy) {
      return _ctmMultiply(_ctmTranslate(cx, cy), _ctmMultiply(m, _ctmTranslate(-cx, -cy)));
    }
    return m;
  }
  function _ctmSkewX(deg) { return [1, 0, Math.tan(deg*Math.PI/180), 1, 0, 0]; }
  function _ctmSkewY(deg) { return [1, Math.tan(deg*Math.PI/180), 0, 1, 0, 0]; }
  // Apply CTM to a point — returns [x', y']
  function _ctmApply(m, x, y) {
    return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
  }
  // Average scale factor — used to scale stroke widths under CTM
  function _ctmScaleFactor(m) {
    return (Math.abs(m[0]) + Math.abs(m[3])) / 2;
  }

  /* =========================================================================
     SVG transform string → CTM matrix
     Handles: translate, scale, rotate (with optional cx, cy), matrix, skewX, skewY
     ========================================================================= */
  function _parseTransform(str) {
    if (!str || typeof str !== 'string') return _ctmIdentity();
    let m = _ctmIdentity();
    const re = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(\s*([^)]+)\s*\)/g;
    let match;
    while ((match = re.exec(str)) !== null) {
      const op = match[1];
      const args = match[2].split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
      let local = _ctmIdentity();
      switch (op) {
        case 'translate': local = _ctmTranslate(args[0] || 0, args[1] || 0); break;
        case 'scale':     local = _ctmScale(args[0] || 1, args[1] != null ? args[1] : args[0]); break;
        case 'rotate':    local = _ctmRotate(args[0] || 0, args[1] || 0, args[2] || 0); break;
        case 'matrix':    if (args.length === 6) local = args; break;
        case 'skewX':     local = _ctmSkewX(args[0] || 0); break;
        case 'skewY':     local = _ctmSkewY(args[0] || 0); break;
      }
      m = _ctmMultiply(m, local);
    }
    return m;
  }

  /* =========================================================================
     Style resolution — node attrs + inline style + parent inheritance
     ========================================================================= */
  function _parseStyle(str) {
    const out = {};
    if (!str) return out;
    String(str).split(';').forEach(decl => {
      const [k, v] = decl.split(':').map(s => s && s.trim());
      if (k && v) out[k] = v;
    });
    return out;
  }
  function _styleOf(node, parent) {
    const s = Object.assign({}, parent || {});
    if (!node || !node.getAttribute) return s;
    const inline = _parseStyle(node.getAttribute('style'));
    const attrs = [
      'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
      'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
      'fill-rule', 'font-family', 'font-size', 'font-weight', 'font-style',
      'text-anchor', 'vector-effect', 'display', 'visibility',
    ];
    attrs.forEach(a => {
      const v = inline[a] || node.getAttribute(a);
      if (v != null && v !== '') s[a] = v;
    });
    // v1.3.0 (Takeoffs rc.3) — Fabric.js emits rgba(r,g,b,a) paints. Split
    // the alpha out into the corresponding *-opacity channel (multiplied
    // into any existing value) and normalise the paint to #hex so the
    // downstream hexToRgb01 path stays exact. rgb() without alpha is
    // handled inside hexToRgb01 itself (helpers v1.2.0).
    ['fill', 'stroke'].forEach(k => {
      const m = s[k] && String(s[k]).match(/^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/i);
      if (m) {
        const to2 = n => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, '0');
        s[k] = '#' + to2(m[1]) + to2(m[2]) + to2(m[3]);
        const oKey = k + '-opacity';
        const cur = parseFloat(s[oKey]);
        const a = parseFloat(m[4]);
        s[oKey] = String((isNaN(cur) ? 1 : cur) * (isNaN(a) ? 1 : a));
      }
    });
    return s;
  }
  function _resolveFill(style) {
    if (!style.fill || style.fill === 'none' || style.fill === 'transparent') return null;
    if (style.fill.startsWith('url(')) return null; // gradients/patterns — fallback to no fill for v1.0
    return style.fill;
  }
  function _resolveStroke(style) {
    if (!style.stroke || style.stroke === 'none' || style.stroke === 'transparent') return null;
    if (style.stroke.startsWith('url(')) return null;
    return style.stroke;
  }
  function _resolveStrokeWidth(style) {
    const w = parseFloat(style['stroke-width']);
    return isNaN(w) ? (style.stroke && style.stroke !== 'none' ? 1 : 0) : w;
  }
  function _resolveOpacity(style, channel) {
    const root = parseFloat(style.opacity);
    const ch = parseFloat(style[channel]);
    const r = isNaN(root) ? 1 : root;
    const c = isNaN(ch) ? 1 : ch;
    return Math.max(0, Math.min(1, r * c));
  }

  /* =========================================================================
     Path d-string parser → array of segments
     Each segment: { op: 'M'|'L'|'H'|'V'|'C'|'S'|'Q'|'T'|'A'|'Z', args: [...] }
     Absolute coords only (relative converted to absolute during parse).
     ========================================================================= */
  function _parsePathD(d) {
    if (!d) return [];
    const segs = [];
    const tokRe = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    const tokens = [];
    let m;
    while ((m = tokRe.exec(d)) !== null) {
      tokens.push(m[1] != null ? { type: 'cmd', val: m[1] } : { type: 'num', val: parseFloat(m[0]) });
    }
    let i = 0, cur = { x: 0, y: 0 }, start = { x: 0, y: 0 }, lastCmd = '', lastCtrl = null;
    while (i < tokens.length) {
      let t = tokens[i];
      if (t.type !== 'cmd') { i++; continue; } // skip stray numbers (shouldn't happen)
      let cmd = t.val;
      i++;
      const take = (n) => {
        const out = [];
        for (let k = 0; k < n; k++) {
          if (i >= tokens.length || tokens[i].type !== 'num') return null;
          out.push(tokens[i].val); i++;
        }
        return out;
      };
      // Repeated coords: after first segment, treat as implicit L (after M) or same cmd
      do {
        const isRel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        let args;
        switch (C) {
          case 'M': {
            args = take(2); if (!args) break;
            let x = isRel ? cur.x + args[0] : args[0];
            let y = isRel ? cur.y + args[1] : args[1];
            segs.push({ op: 'M', args: [x, y] });
            cur = { x, y }; start = { x, y };
            // Implicit L after M
            cmd = isRel ? 'l' : 'L';
            break;
          }
          case 'L': {
            args = take(2); if (!args) break;
            let x = isRel ? cur.x + args[0] : args[0];
            let y = isRel ? cur.y + args[1] : args[1];
            segs.push({ op: 'L', args: [x, y] });
            cur = { x, y };
            break;
          }
          case 'H': {
            args = take(1); if (!args) break;
            let x = isRel ? cur.x + args[0] : args[0];
            segs.push({ op: 'L', args: [x, cur.y] });
            cur = { x, y: cur.y };
            break;
          }
          case 'V': {
            args = take(1); if (!args) break;
            let y = isRel ? cur.y + args[0] : args[0];
            segs.push({ op: 'L', args: [cur.x, y] });
            cur = { x: cur.x, y };
            break;
          }
          case 'C': {
            args = take(6); if (!args) break;
            const c1 = isRel ? [cur.x + args[0], cur.y + args[1]] : [args[0], args[1]];
            const c2 = isRel ? [cur.x + args[2], cur.y + args[3]] : [args[2], args[3]];
            const p  = isRel ? [cur.x + args[4], cur.y + args[5]] : [args[4], args[5]];
            segs.push({ op: 'C', args: [c1[0], c1[1], c2[0], c2[1], p[0], p[1]] });
            lastCtrl = { x: c2[0], y: c2[1] };
            cur = { x: p[0], y: p[1] };
            break;
          }
          case 'S': {
            args = take(4); if (!args) break;
            // Reflect previous C control point
            let c1;
            if (lastCmd === 'C' || lastCmd === 'S') {
              c1 = [2*cur.x - lastCtrl.x, 2*cur.y - lastCtrl.y];
            } else c1 = [cur.x, cur.y];
            const c2 = isRel ? [cur.x + args[0], cur.y + args[1]] : [args[0], args[1]];
            const p  = isRel ? [cur.x + args[2], cur.y + args[3]] : [args[2], args[3]];
            segs.push({ op: 'C', args: [c1[0], c1[1], c2[0], c2[1], p[0], p[1]] });
            lastCtrl = { x: c2[0], y: c2[1] };
            cur = { x: p[0], y: p[1] };
            break;
          }
          case 'Q': {
            args = take(4); if (!args) break;
            // Convert quadratic to cubic: cp1 = start + 2/3*(qcp-start), cp2 = end + 2/3*(qcp-end)
            const qcp = isRel ? [cur.x + args[0], cur.y + args[1]] : [args[0], args[1]];
            const p   = isRel ? [cur.x + args[2], cur.y + args[3]] : [args[2], args[3]];
            const c1 = [cur.x + 2/3*(qcp[0] - cur.x), cur.y + 2/3*(qcp[1] - cur.y)];
            const c2 = [p[0] + 2/3*(qcp[0] - p[0]),    p[1] + 2/3*(qcp[1] - p[1])];
            segs.push({ op: 'C', args: [c1[0], c1[1], c2[0], c2[1], p[0], p[1]] });
            lastCtrl = { x: qcp[0], y: qcp[1] };
            cur = { x: p[0], y: p[1] };
            break;
          }
          case 'T': {
            args = take(2); if (!args) break;
            let qcp;
            if (lastCmd === 'Q' || lastCmd === 'T') {
              qcp = [2*cur.x - lastCtrl.x, 2*cur.y - lastCtrl.y];
            } else qcp = [cur.x, cur.y];
            const p = isRel ? [cur.x + args[0], cur.y + args[1]] : [args[0], args[1]];
            const c1 = [cur.x + 2/3*(qcp[0] - cur.x), cur.y + 2/3*(qcp[1] - cur.y)];
            const c2 = [p[0] + 2/3*(qcp[0] - p[0]),    p[1] + 2/3*(qcp[1] - p[1])];
            segs.push({ op: 'C', args: [c1[0], c1[1], c2[0], c2[1], p[0], p[1]] });
            lastCtrl = { x: qcp[0], y: qcp[1] };
            cur = { x: p[0], y: p[1] };
            break;
          }
          case 'A': {
            args = take(7); if (!args) break;
            // SVG elliptical arc → series of cubic beziers (Maisonobe's algorithm)
            const [rx, ry, xRot, largeArc, sweep, ex, ey] = args.map((v, i) => {
              if (i === 5 || i === 6) return isRel ? (i === 5 ? cur.x + v : cur.y + v) : v;
              return v;
            });
            const beziers = _arcToCubics(cur.x, cur.y, rx, ry, xRot, !!largeArc, !!sweep, ex, ey);
            beziers.forEach(b => {
              segs.push({ op: 'C', args: b });
            });
            cur = { x: ex, y: ey };
            break;
          }
          case 'Z': {
            segs.push({ op: 'Z' });
            cur = { x: start.x, y: start.y };
            break;
          }
        }
        if (lastCmd !== 'C' && lastCmd !== 'S' && C !== 'C' && C !== 'S' && C !== 'Q' && C !== 'T') lastCtrl = null;
        lastCmd = C;
      } while (i < tokens.length && tokens[i].type === 'num');
    }
    return segs;
  }

  /* ---- Arc → cubic beziers (Maisonobe 2003) -------------------------- */
  function _arcToCubics(x1, y1, rx, ry, xRot, largeArc, sweep, x2, y2) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]]; // degenerate → line
    const sinPhi = Math.sin(xRot * Math.PI / 180);
    const cosPhi = Math.cos(xRot * Math.PI / 180);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p =  cosPhi*dx + sinPhi*dy;
    const y1p = -sinPhi*dx + cosPhi*dy;
    let rxSq = rx*rx, rySq = ry*ry;
    const x1pSq = x1p*x1p, y1pSq = y1p*y1p;
    const radCheck = x1pSq/rxSq + y1pSq/rySq;
    if (radCheck > 1) { const s = Math.sqrt(radCheck); rx *= s; ry *= s; rxSq = rx*rx; rySq = ry*ry; }
    let factor = (rxSq*rySq - rxSq*y1pSq - rySq*x1pSq) / (rxSq*y1pSq + rySq*x1pSq);
    factor = factor < 0 ? 0 : Math.sqrt(factor);
    if (largeArc === sweep) factor = -factor;
    const cxp =  factor * rx*y1p / ry;
    const cyp = -factor * ry*x1p / rx;
    const cx = cosPhi*cxp - sinPhi*cyp + (x1+x2)/2;
    const cy = sinPhi*cxp + cosPhi*cyp + (y1+y2)/2;
    const ang = (ux, uy, vx, vy) => {
      const dot = (ux*vx + uy*vy) / (Math.sqrt(ux*ux+uy*uy) * Math.sqrt(vx*vx+vy*vy));
      let a = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ux*vy - uy*vx < 0) a = -a;
      return a;
    };
    let theta1 = ang(1, 0, (x1p - cxp)/rx, (y1p - cyp)/ry);
    let deltaTheta = ang((x1p - cxp)/rx, (y1p - cyp)/ry, (-x1p - cxp)/rx, (-y1p - cyp)/ry);
    if (!sweep && deltaTheta > 0) deltaTheta -= 2*Math.PI;
    else if (sweep && deltaTheta < 0) deltaTheta += 2*Math.PI;
    // Split arc into ≤90° segments
    const numSegs = Math.ceil(Math.abs(deltaTheta) / (Math.PI/2));
    const segTheta = deltaTheta / numSegs;
    const beziers = [];
    for (let i = 0; i < numSegs; i++) {
      const t1 = theta1 + i*segTheta;
      const t2 = theta1 + (i+1)*segTheta;
      const alpha = 4/3 * Math.tan(segTheta/4);
      const cosT1 = Math.cos(t1), sinT1 = Math.sin(t1);
      const cosT2 = Math.cos(t2), sinT2 = Math.sin(t2);
      const P1x = rx * cosT1, P1y = ry * sinT1;
      const P2x = rx * cosT2, P2y = ry * sinT2;
      const Q1x = P1x - alpha*rx*sinT1, Q1y = P1y + alpha*ry*cosT1;
      const Q2x = P2x + alpha*rx*sinT2, Q2y = P2y - alpha*ry*cosT2;
      // Rotate by xRot, translate to (cx, cy)
      const tx = (x, y) => [cosPhi*x - sinPhi*y + cx, sinPhi*x + cosPhi*y + cy];
      const C1 = tx(Q1x, Q1y), C2 = tx(Q2x, Q2y), P2 = tx(P2x, P2y);
      beziers.push([C1[0], C1[1], C2[0], C2[1], P2[0], P2[1]]);
    }
    return beziers;
  }

  /* =========================================================================
     Convert SVG primitives → path segments (so emit step is uniform)
     ========================================================================= */
  function _rectToSegs(x, y, w, h, rx, ry) {
    if (!rx && !ry) {
      return [
        { op: 'M', args: [x, y] },
        { op: 'L', args: [x+w, y] },
        { op: 'L', args: [x+w, y+h] },
        { op: 'L', args: [x, y+h] },
        { op: 'Z' },
      ];
    }
    // Rounded rect → 4 corner arcs as cubic beziers
    const arc = (cx, cy, r, startDeg, endDeg) => {
      const segs = _arcToCubics(
        cx + r * Math.cos(startDeg * Math.PI/180), cy + r * Math.sin(startDeg * Math.PI/180),
        r, r, 0, false, true,
        cx + r * Math.cos(endDeg * Math.PI/180), cy + r * Math.sin(endDeg * Math.PI/180)
      );
      return segs.map(b => ({ op: 'C', args: b }));
    };
    rx = rx || ry; ry = ry || rx;
    return [
      { op: 'M', args: [x+rx, y] },
      { op: 'L', args: [x+w-rx, y] },
      ...arc(x+w-rx, y+ry, rx, -90, 0),
      { op: 'L', args: [x+w, y+h-ry] },
      ...arc(x+w-rx, y+h-ry, rx, 0, 90),
      { op: 'L', args: [x+rx, y+h] },
      ...arc(x+rx, y+h-ry, rx, 90, 180),
      { op: 'L', args: [x, y+ry] },
      ...arc(x+rx, y+ry, rx, 180, 270),
      { op: 'Z' },
    ];
  }
  function _circleToSegs(cx, cy, r) {
    return _ellipseToSegs(cx, cy, r, r);
  }
  function _ellipseToSegs(cx, cy, rx, ry) {
    // 4 quadrant arcs as cubic beziers (kappa = 0.5522847498)
    const k = 0.5522847498 * rx, ky = 0.5522847498 * ry;
    return [
      { op: 'M', args: [cx + rx, cy] },
      { op: 'C', args: [cx + rx, cy + ky, cx + k, cy + ry, cx, cy + ry] },
      { op: 'C', args: [cx - k, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
      { op: 'C', args: [cx - rx, cy - ky, cx - k, cy - ry, cx, cy - ry] },
      { op: 'C', args: [cx + k, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
      { op: 'Z' },
    ];
  }
  function _pointsToSegs(points, closed) {
    const pts = String(points || '').trim().split(/[\s,]+/).map(parseFloat);
    if (pts.length < 4) return [];
    const segs = [{ op: 'M', args: [pts[0], pts[1]] }];
    for (let i = 2; i < pts.length; i += 2) {
      segs.push({ op: 'L', args: [pts[i], pts[i+1]] });
    }
    if (closed) segs.push({ op: 'Z' });
    return segs;
  }
  function _lineToSegs(x1, y1, x2, y2) {
    return [{ op: 'M', args: [x1, y1] }, { op: 'L', args: [x2, y2] }];
  }

  /* =========================================================================
     Transform path segments via CTM → produce PDF-space coords, then build
     PDF-space d string for pdf-lib's drawSvgPath. Y-axis already flipped via
     CTM (PDF origin is bottom-left, SVG is top-left).
     ========================================================================= */
  function _segsToPdfDString(segs, ctm) {
    let out = '';
    for (const s of segs) {
      switch (s.op) {
        case 'M': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          out += ` M ${x.toFixed(3)} ${y.toFixed(3)}`;
          break;
        }
        case 'L': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          out += ` L ${x.toFixed(3)} ${y.toFixed(3)}`;
          break;
        }
        case 'C': {
          const [c1x, c1y] = _ctmApply(ctm, s.args[0], s.args[1]);
          const [c2x, c2y] = _ctmApply(ctm, s.args[2], s.args[3]);
          const [px,  py]  = _ctmApply(ctm, s.args[4], s.args[5]);
          out += ` C ${c1x.toFixed(3)} ${c1y.toFixed(3)} ${c2x.toFixed(3)} ${c2y.toFixed(3)} ${px.toFixed(3)} ${py.toFixed(3)}`;
          break;
        }
        case 'Z': out += ' Z'; break;
      }
    }
    return out.trim();
  }

  /* =========================================================================
     Emit a path with given style via RAW pdf-lib content-stream operators.

     v1.1.0 — was previously using page.drawSvgPath() which double-flipped Y
     (our CTM flips, then drawSvgPath flips again, shapes off-page). Now we
     emit the raw PDF graphics-state + path-construction operators directly,
     bypassing pdf-lib's SVG translation layer entirely. Our CTM-transformed
     coords are in PDF space (origin bottom-left, Y up) and PDF operators
     consume them directly with no further transform.

     PDF operators emitted per path:
       q                            — push graphics state
       <r> <g> <b> rg               — set fill colour (lowercase rg = non-stroking)
       <r> <g> <b> RG               — set stroke colour (uppercase RG = stroking)
       <w> w                        — set line width
       <x> <y> m                    — moveto
       <x> <y> l                    — lineto
       <x1> <y1> <x2> <y2> <x3> <y3> c  — cubic bezier
       h                            — closepath
       B                            — fill + stroke
       f                            — fill only
       S                            — stroke only
       Q                            — pop graphics state
     ========================================================================= */
  function _emitPath(page, ctx, segs, style, ctm) {
    if (!segs.length) return;
    const fill = _resolveFill(style);
    const stroke = _resolveStroke(style);
    if (!fill && !stroke) return;
    const PDFLib = window.PDFLib;
    if (!PDFLib) return;

    const scaleFactor = _ctmScaleFactor(ctm);
    const sw = _resolveStrokeWidth(style) * scaleFactor;
    const fillOp = _resolveOpacity(style, 'fill-opacity');
    const strokeOp = _resolveOpacity(style, 'stroke-opacity');

    // Build raw PDF operator string. q...Q wraps so graphics state changes
    // don't leak into subsequent paint calls.
    let ops = 'q\n';

    // Opacity via ExtGState — pdf-lib doesn't expose alpha-state via raw ops
    // without going through PDFOperator API, so for v1.1.0 we accept that
    // opacity < 1 falls through to opacity = 1 on raw-emitted paths. Text
    // path retains opacity. Translucent shapes are rare on CD drawings
    // (it's a CAD drawing not a watercolour). Queued for v1.2.

    if (fill) {
      const c = H.hexToRgb01(fill);
      ops += `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} rg\n`;
    }
    if (stroke && sw > 0) {
      const c = H.hexToRgb01(stroke);
      ops += `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} RG\n`;
      ops += `${Math.max(0.1, sw).toFixed(3)} w\n`;
    }

    // Emit path-construction operators (all coords already CTM-transformed
    // into PDF space — no further flip needed).
    for (const s of segs) {
      switch (s.op) {
        case 'M': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          ops += `${x.toFixed(3)} ${y.toFixed(3)} m\n`;
          break;
        }
        case 'L': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          ops += `${x.toFixed(3)} ${y.toFixed(3)} l\n`;
          break;
        }
        case 'C': {
          const [c1x, c1y] = _ctmApply(ctm, s.args[0], s.args[1]);
          const [c2x, c2y] = _ctmApply(ctm, s.args[2], s.args[3]);
          const [px,  py]  = _ctmApply(ctm, s.args[4], s.args[5]);
          ops += `${c1x.toFixed(3)} ${c1y.toFixed(3)} ${c2x.toFixed(3)} ${c2y.toFixed(3)} ${px.toFixed(3)} ${py.toFixed(3)} c\n`;
          break;
        }
        case 'Z':
          ops += 'h\n';
          break;
      }
    }

    // Paint op — choose based on what's set
    if (fill && stroke && sw > 0) ops += 'B\n';
    else if (fill) ops += 'f\n';
    else if (stroke && sw > 0) ops += 'S\n';
    else ops += 'n\n'; // path with no paint — just close

    ops += 'Q\n';

    try {
      // pdf-lib lets us push raw PDF operators directly into the page's
      // content stream via PDFPageDrawSvgOptions … actually the canonical
      // way is page.node.contentStream().writeContent — but the public API
      // is pushOperators(...PDFOperator). The simplest cross-version-safe
      // approach is to wrap our raw op string in a PDFOperator.
      if (PDFLib.PDFOperator && PDFLib.PDFOperator.of) {
        // pdf-lib has PDFOperator but the public way to push raw bytes is
        // via page.pushOperators(). Convert our string to operator stream.
        // Each line is one operator with args; pdf-lib has helpers like
        // moveTo(x, y), lineTo(x, y), etc. Use them.
        _pushViaPdfLibOps(page, ctx, segs, style, ctm, { fill, stroke, sw, fillOp, strokeOp });
      } else {
        _pushViaPdfLibOps(page, ctx, segs, style, ctm, { fill, stroke, sw, fillOp, strokeOp });
      }
    } catch (e) {
      console.warn('[SonorPdfV6SvgEmitter] path emit threw; skipping:', e && e.message);
    }
  }

  /**
   * Push path via pdf-lib's public operator helpers. These are guaranteed-
   * compatible across pdf-lib 1.x — they produce the same PDF operators as
   * the raw string above but via type-safe API.
   */
  function _pushViaPdfLibOps(page, ctx, segs, style, ctm, paint) {
    const P = window.PDFLib;
    if (!P) return;
    const {
      pushGraphicsState, popGraphicsState,
      setFillingRgbColor, setStrokingRgbColor,
      setLineWidth,
      moveTo, lineTo, appendBezierCurve, closePath,
      fill: opFill, stroke: opStroke, fillAndStroke: opFillAndStroke,
      endPath,
    } = P;

    const ops = [pushGraphicsState()];

    if (paint.fill) {
      const c = H.hexToRgb01(paint.fill);
      ops.push(setFillingRgbColor(c.r, c.g, c.b));
    }
    if (paint.stroke && paint.sw > 0) {
      const c = H.hexToRgb01(paint.stroke);
      ops.push(setStrokingRgbColor(c.r, c.g, c.b));
      ops.push(setLineWidth(Math.max(0.1, paint.sw)));
    }

    for (const s of segs) {
      switch (s.op) {
        case 'M': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          ops.push(moveTo(x, y));
          break;
        }
        case 'L': {
          const [x, y] = _ctmApply(ctm, s.args[0], s.args[1]);
          ops.push(lineTo(x, y));
          break;
        }
        case 'C': {
          const [c1x, c1y] = _ctmApply(ctm, s.args[0], s.args[1]);
          const [c2x, c2y] = _ctmApply(ctm, s.args[2], s.args[3]);
          const [px,  py]  = _ctmApply(ctm, s.args[4], s.args[5]);
          ops.push(appendBezierCurve(c1x, c1y, c2x, c2y, px, py));
          break;
        }
        case 'Z':
          ops.push(closePath());
          break;
      }
    }

    if (paint.fill && paint.stroke && paint.sw > 0) ops.push(opFillAndStroke());
    else if (paint.fill) ops.push(opFill());
    else if (paint.stroke && paint.sw > 0) ops.push(opStroke());
    else ops.push(endPath());

    ops.push(popGraphicsState());

    page.pushOperators(...ops);
  }

  /* =========================================================================
     Emit text — convert position via CTM, draw via font's glyph runs
     ========================================================================= */
  function _emitText(page, ctx, node, style, ctm) {
    const txt = (node.textContent || '').trim();
    if (!txt) return;
    const x = parseFloat(node.getAttribute('x')) || 0;
    const y = parseFloat(node.getAttribute('y')) || 0;
    const fontSize = parseFloat(style['font-size']) || 12;
    const fontWeight = (style['font-weight'] || '').toString().toLowerCase();
    const anchor = style['text-anchor'] || 'start';
    // Resolve font from ctx.fonts
    const wantBold = fontWeight === 'bold' || fontWeight === '700' || fontWeight === '800' || fontWeight === '900';
    const wantMed  = fontWeight === '500' || fontWeight === '600' || fontWeight === 'medium';
    const font = wantBold ? ctx.fonts.bold : (wantMed ? ctx.fonts.med : ctx.fonts.reg);
    const fill = _resolveFill(style) || '#000000';
    // Transform text origin via CTM
    const [px, py] = _ctmApply(ctm, x, y);
    // Scale font size by CTM's scale factor
    const scaledSize = fontSize * _ctmScaleFactor(ctm);
    // Compute alignment offset
    const sanitized = (H.winAnsiSafe ? H.winAnsiSafe(txt) : txt);
    let drawX = px;
    if (anchor !== 'start') {
      const w = font.widthOfTextAtSize(sanitized, scaledSize);
      if (anchor === 'middle' || anchor === 'center') drawX = px - w / 2;
      else if (anchor === 'end') drawX = px - w;
    }
    // SVG text baseline is at y; pdf-lib drawText puts baseline at y too, BUT
    // we already flipped Y via CTM so PDF y already has correct baseline.
    // Need to nudge by font descender to match SVG visual position.
    try {
      H.drawText(page, sanitized, {
        x: drawX,
        y: py - scaledSize * 0.25, // approximate baseline correction
        font, size: scaledSize,
        color: fill,
        opacity: _resolveOpacity(style, 'fill-opacity'),
      });
    } catch (e) {
      console.warn('[SonorPdfV6SvgEmitter] drawText threw, skipping text:', e && e.message, 'text:', txt);
    }
  }

  /* =========================================================================
     Walk the SVG tree — recurse with accumulating CTM + style
     ========================================================================= */
  function _walk(node, parentCtm, parentStyle, page, ctx, defsMap) {
    if (!node || node.nodeType !== 1) return;
    const tag = node.nodeName ? node.nodeName.toLowerCase() : '';
    const style = _styleOf(node, parentStyle);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    let ctm = parentCtm;
    const tx = node.getAttribute && node.getAttribute('transform');
    if (tx) ctm = _ctmMultiply(parentCtm, _parseTransform(tx));

    switch (tag) {
      case 'svg': {
        // Nested SVG — apply viewBox + width/height transform
        const x = parseFloat(node.getAttribute('x')) || 0;
        const y = parseFloat(node.getAttribute('y')) || 0;
        const w = parseFloat(node.getAttribute('width')) || 0;
        const h = parseFloat(node.getAttribute('height')) || 0;
        const vb = _readViewBox(node);
        let inner = _ctmTranslate(x, y);
        if (vb && w && h) {
          const sx = w / vb.w, sy = h / vb.h;
          inner = _ctmMultiply(inner, _ctmTranslate(-vb.x * sx, -vb.y * sy));
          inner = _ctmMultiply(inner, _ctmScale(sx, sy));
        }
        ctm = _ctmMultiply(ctm, inner);
        // Walk children
        for (let i = 0; i < node.childNodes.length; i++) {
          _walk(node.childNodes[i], ctm, style, page, ctx, defsMap);
        }
        return;
      }
      case 'g': {
        for (let i = 0; i < node.childNodes.length; i++) {
          _walk(node.childNodes[i], ctm, style, page, ctx, defsMap);
        }
        return;
      }
      case 'defs': {
        // Index children by id for <use> resolution
        for (let i = 0; i < node.childNodes.length; i++) {
          const c = node.childNodes[i];
          if (c.nodeType === 1 && c.getAttribute && c.getAttribute('id')) {
            defsMap.set(c.getAttribute('id'), c);
          }
        }
        return;
      }
      case 'use': {
        // Expand referenced symbol
        const href = node.getAttribute('href') || node.getAttribute('xlink:href') || '';
        const id = href.replace(/^#/, '');
        let target = defsMap.get(id);
        if (!target && node.ownerDocument) {
          target = node.ownerDocument.getElementById(id);
        }
        if (target) {
          const ux = parseFloat(node.getAttribute('x')) || 0;
          const uy = parseFloat(node.getAttribute('y')) || 0;
          const useCtm = _ctmMultiply(ctm, _ctmTranslate(ux, uy));
          _walk(target, useCtm, style, page, ctx, defsMap);
        }
        return;
      }
      case 'rect': {
        const x = parseFloat(node.getAttribute('x')) || 0;
        const y = parseFloat(node.getAttribute('y')) || 0;
        const w = parseFloat(node.getAttribute('width')) || 0;
        const h = parseFloat(node.getAttribute('height')) || 0;
        if (w <= 0 || h <= 0) return;
        const rx = parseFloat(node.getAttribute('rx')) || 0;
        const ry = parseFloat(node.getAttribute('ry')) || 0;
        _emitPath(page, ctx, _rectToSegs(x, y, w, h, rx, ry), style, ctm);
        return;
      }
      case 'circle': {
        const cx = parseFloat(node.getAttribute('cx')) || 0;
        const cy = parseFloat(node.getAttribute('cy')) || 0;
        const r  = parseFloat(node.getAttribute('r'))  || 0;
        if (r <= 0) return;
        _emitPath(page, ctx, _circleToSegs(cx, cy, r), style, ctm);
        return;
      }
      case 'ellipse': {
        const cx = parseFloat(node.getAttribute('cx')) || 0;
        const cy = parseFloat(node.getAttribute('cy')) || 0;
        const rx = parseFloat(node.getAttribute('rx')) || 0;
        const ry = parseFloat(node.getAttribute('ry')) || 0;
        if (rx <= 0 || ry <= 0) return;
        _emitPath(page, ctx, _ellipseToSegs(cx, cy, rx, ry), style, ctm);
        return;
      }
      case 'line': {
        const x1 = parseFloat(node.getAttribute('x1')) || 0;
        const y1 = parseFloat(node.getAttribute('y1')) || 0;
        const x2 = parseFloat(node.getAttribute('x2')) || 0;
        const y2 = parseFloat(node.getAttribute('y2')) || 0;
        _emitPath(page, ctx, _lineToSegs(x1, y1, x2, y2), style, ctm);
        return;
      }
      case 'polyline': {
        _emitPath(page, ctx, _pointsToSegs(node.getAttribute('points'), false), style, ctm);
        return;
      }
      case 'polygon': {
        _emitPath(page, ctx, _pointsToSegs(node.getAttribute('points'), true), style, ctm);
        return;
      }
      case 'path': {
        const d = node.getAttribute('d');
        if (!d) return;
        const segs = _parsePathD(d);
        _emitPath(page, ctx, segs, style, ctm);
        return;
      }
      case 'text': {
        // First emit own text content (concatenated immediate text nodes)
        const ownTxt = Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (ownTxt) {
          // Build a synthetic node-like for _emitText
          const synth = {
            textContent: ownTxt,
            getAttribute: (k) => node.getAttribute(k),
          };
          _emitText(page, ctx, synth, style, ctm);
        }
        // Then walk tspan children
        for (let i = 0; i < node.childNodes.length; i++) {
          const c = node.childNodes[i];
          if (c.nodeType === 1 && c.nodeName && c.nodeName.toLowerCase() === 'tspan') {
            _walk(c, ctm, style, page, ctx, defsMap);
          }
        }
        return;
      }
      case 'tspan': {
        const txt = node.textContent || '';
        if (txt.trim()) {
          _emitText(page, ctx, node, style, ctm);
        }
        return;
      }
      case 'title':
      case 'desc':
      case 'metadata':
      case 'clippath': // v1.0: skip (no support yet)
      case 'mask':
      case 'filter':
      case 'lineargradient':
      case 'radialgradient':
      case 'pattern':
      case 'style':
        return;
      default:
        // Unknown element — recurse into children just in case
        for (let i = 0; i < node.childNodes.length; i++) {
          _walk(node.childNodes[i], ctm, style, page, ctx, defsMap);
        }
    }
  }

  /* =========================================================================
     ViewBox parser
     ========================================================================= */
  function _readViewBox(svg) {
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const p = vb.trim().split(/[\s,]+/).map(parseFloat);
      if (p.length === 4 && p.every(n => !isNaN(n))) return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    const w = parseFloat(svg.getAttribute('width')) || 0;
    const h = parseFloat(svg.getAttribute('height')) || 0;
    if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
    return null;
  }

  /* =========================================================================
     Index <defs> children across the whole tree for <use> resolution
     ========================================================================= */
  function _indexDefs(svgEl) {
    const map = new Map();
    if (!svgEl || !svgEl.querySelectorAll) return map;
    try {
      const allWithId = svgEl.querySelectorAll('[id]');
      for (const n of allWithId) {
        map.set(n.getAttribute('id'), n);
      }
    } catch (_) {}
    return map;
  }

  /* =========================================================================
     PUBLIC API
     ========================================================================= */
  /**
   * Paint an SVG element into a target rect on the page as TRUE VECTOR.
   * Every shape becomes native PDF path operators. Every text becomes embedded
   * font glyph runs. No raster anywhere. No external library.
   *
   * @param {PDFPage} page
   * @param {object}  ctx       paint context (with ctx.fonts bag)
   * @param {SVGElement|string} svgEl  live DOM element OR an SVG string
   * @param {object}  opts
   *   - x, y, w, h    target rect on page (pt)
   * @returns {{ vector: true, width, height, elements }}
   */
  function paint(page, ctx, svgEl, opts) {
    const o = Object.assign({ x: 0, y: 0, w: 400, h: 300 }, opts);
    const svg = (typeof svgEl === 'string') ? _parseSvgString(svgEl) : svgEl;
    if (!svg || !svg.nodeName || svg.nodeName.toLowerCase() !== 'svg') {
      throw new Error('SonorPdfV6SvgEmitter.paint: invalid SVG');
    }
    const vb = _readViewBox(svg);
    if (!vb || vb.w <= 0 || vb.h <= 0) {
      throw new Error('SonorPdfV6SvgEmitter.paint: SVG has no usable viewBox or width/height');
    }
    // Fit SVG viewBox into target rect, preserving aspect ratio (xMidYMid meet)
    const arSvg = vb.w / vb.h, arBox = o.w / o.h;
    let fitW, fitH;
    if (arSvg > arBox) { fitW = o.w; fitH = o.w / arSvg; }
    else               { fitH = o.h; fitW = o.h * arSvg; }
    const offX = o.x + (o.w - fitW) / 2;
    const offY = o.y + (o.h - fitH) / 2;
    // CTM: SVG (x,y) → PDF (X, Y)
    //   PDF origin bottom-left, SVG origin top-left → invert Y
    //   X = offX + (sx - vb.x) * scale
    //   Y = offY + fitH - (sy - vb.y) * scale   (flip Y)
    // Build CTM as combined affine:
    const scale = fitW / vb.w;
    let ctm = _ctmIdentity();
    ctm = _ctmMultiply(ctm, _ctmTranslate(offX, offY + fitH));
    ctm = _ctmMultiply(ctm, _ctmScale(scale, -scale));     // flip Y, scale
    ctm = _ctmMultiply(ctm, _ctmTranslate(-vb.x, -vb.y));   // shift to viewBox origin

    const defsMap = _indexDefs(svg);

    // Initial style — black fill, no stroke (SVG default)
    const rootStyle = { fill: '#000000', stroke: 'none' };

    // Walk children (skip the root <svg> wrapper to avoid double-applying viewBox)
    for (let i = 0; i < svg.childNodes.length; i++) {
      _walk(svg.childNodes[i], ctm, rootStyle, page, ctx, defsMap);
    }
    return { vector: true, width: fitW, height: fitH };
  }

  function _parseSvgString(str) {
    const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
    return doc.documentElement;
  }

  window.SonorPdfV6SvgEmitter = {
    VERSION: '1.3.0',
    paint,
    // exposed for testing
    _parseTransform, _parsePathD, _arcToCubics,
    _ctmMultiply, _ctmApply, _ctmIdentity,
    _segsToPdfDString,
  };
})();
