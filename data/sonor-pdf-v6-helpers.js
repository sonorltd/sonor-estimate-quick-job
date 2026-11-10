/* ============================================================================
   sonor-pdf-v6-helpers.js  ·  v1.1.0  ·  paintVerticalGradient (v7.10.0)  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   Small pure helpers used by every SonorPdfV6 module. Zero dependencies beyond
   pdf-lib (which provides the rgb() / degrees() constructors). Loaded FIRST in
   the v6 dependency chain.

   Exposes window.SonorPdfV6Helpers = { ... }.

   Spine v1.2.6 · HARMONY §3 · per Bryn 2026-05-27 PDF v6 directive.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Helpers && window.SonorPdfV6Helpers.VERSION) return;

  /* ---- colour helpers -------------------------------------------------- */
  // Normalised 0-1 rgb object from 0-255 channels — what pdf-lib's rgb() expects.
  function rgb01(r, g, b) {
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  // Parse #RRGGBB / #RGB / rgb(...) → {r,g,b} normalised 0-1. Falls back to black.
  // v1.2.0 (Takeoffs vector plans rc.3) — accepts #hex / #abc, rgb(r,g,b),
  // rgba(r,g,b,a) (alpha ignored here — the emitter folds it into
  // fill/stroke-opacity), and the CSS named colours Fabric.js emits.
  // Pre-rc.3 anything non-hex silently became BLACK — the Bickerton
  // "MS-Paint blobs" export.
  const CSS_NAMED_01 = {
    white: 'ffffff', black: '000000', grey: '808080', gray: '808080',
    silver: 'c0c0c0', red: 'ff0000', green: '008000', lime: '00ff00',
    blue: '0000ff', navy: '000080', yellow: 'ffff00', orange: 'ffa500',
    purple: '800080', magenta: 'ff00ff', cyan: '00ffff', aqua: '00ffff',
    brown: 'a52a2a', pink: 'ffc0cb', gold: 'ffd700', beige: 'f5f5dc',
    tan: 'd2b48c', violet: 'ee82ee', indigo: '4b0082', cream: 'fffdd0'
  };
  function hexToRgb01(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    if (typeof hex === 'object' && 'r' in hex) return hex;
    const m = String(hex).trim();
    const fn = m.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (fn) return rgb01(Math.round(+fn[1]), Math.round(+fn[2]), Math.round(+fn[3]));
    let h = m.startsWith('#') ? m.slice(1) : (CSS_NAMED_01[m.toLowerCase()] || m);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
    return rgb01(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }
  // pdf-lib's rgb() wrapper using a v6 colour object.
  function toLibRgb(col) {
    if (!window.PDFLib) throw new Error('SonorPdfV6: pdf-lib not loaded');
    const c = hexToRgb01(col);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }

  /* ---- text helpers ---------------------------------------------------- */
  // v6.0.3 — WinAnsi sanitizer. pdf-lib's StandardFonts (Helvetica fallback
  // path) uses WinAnsi encoding and throws on Unicode chars outside that
  // range — common offenders: → ← — – ’ ‘ “ ” … Δ ≥ ≤ ≈ ±. When Gilroy IS
  // loaded via fontkit, those chars render fine via embedded glyphs. But to
  // make the export bulletproof regardless of which font path won (e.g.
  // hosted env where the FONT folder fetch fails), we always sanitize before
  // passing strings to pdf-lib. ASCII fallbacks lose a little prettiness but
  // mean the PDF NEVER throws mid-export.
  //
  // Triggered by Bryn 2026-05-27: "PDF export failed: WinAnsi cannot encode
  // → (0x2192)" — adapter's "Fabric → Stud Mount" label hit Helvetica
  // fallback and exploded the whole export.
  const _UNICODE_TO_ASCII = {
    '→': '->',   '←': '<-',   '↑': '^',    '↓': 'v',    // arrows
    '⇒': '=>',   '⇐': '<=',                                        // double arrows
    '—': '-',    '–': '-',                                          // em/en dash
    '’': "'",    '‘': "'",                                          // smart single quotes
    '“': '"',    '”': '"',                                          // smart double quotes
    '…': '...',  '«': '<<',   '»': '>>',                       // ellipsis, guillemets
    'Δ': 'D',    'Ω': 'Ohm',                                        // greek delta, omega
    '≥': '>=',   '≤': '<=',   '≈': '~',    '±': '+/-',    // math
    '•': '*',    '▪': '*',    '▸': '>',    '◂': '<',      // bullets/triangles
    '✓': '+',    '✗': 'x',    '✕': 'x',                        // tick / cross
    ' ': ' ',                                                            // non-breaking space → regular
    // Keep WinAnsi-safe Unicode pass-through (no mapping needed):
    //   · (·), ° (°), × (×), ² (²), ³ (³), € (€),
    //   – wait, – IS mapped above (en dash is NOT in WinAnsi cp1252).
    //
    // v7.0.1 — degrade superscripts/subscripts to ASCII even though some ARE
    // in WinAnsi. Gilroy's subset (and many custom fonts) doesn't include
    // U+00B2/U+00B3 glyphs, so pdf-lib silently emits a tofu box. ASCII
    // "m2"/"ft2" is the engineering-standard fallback that ALWAYS renders,
    // regardless of which font path won the load race. Bryn verified v6.5.6
    // showed boxes on P-02 Room & Project Design — this closes that bug.
    '²': '2', '³': '3',                          // ² ³ superscripts (WinAnsi but Gilroy lacks glyph)
    '⁰': '0', '⁴': '4', '⁵': '5',          // ⁰ ⁴ ⁵ superscripts (not in WinAnsi)
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '₀': '0', '₁': '1', '₂': '2', '₃': '3',          // subscripts
  };
  function _winAnsiSafe(str) {
    if (!str) return str;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const code = str.charCodeAt(i);
      // Map known Unicode chars to ASCII
      if (_UNICODE_TO_ASCII[c]) { out += _UNICODE_TO_ASCII[c]; continue; }
      // Pass through ASCII (0x00–0x7F) and WinAnsi (Latin-1 Supplement 0xA0–0xFF
      // PLUS pdf-lib's WinAnsi extension chars 0x80–0x9F like € ‚ ƒ etc).
      if (code <= 0xFF) { out += c; continue; }
      // Anything else: best-effort transliteration via ASCII fallback or '?'
      out += '?';
    }
    return out;
  }

  // Universal text painter — handles align, letterSpacing, opacity, rotation.
  // opts: { x, y, font, size, color, align ('left'|'center'|'right'),
  //         letterSpacing, opacity, rotate (pdf-lib degrees obj or {type,angle}) }
  function drawText(page, text, opts) {
    if (text == null || text === '') return;
    const o = Object.assign({ size: 10, align: 'left', letterSpacing: 0, opacity: 1 }, opts || {});
    const str = _winAnsiSafe(String(text));
    let x = o.x;
    if (o.align !== 'left' && o.font && typeof o.font.widthOfTextAtSize === 'function') {
      const w = o.font.widthOfTextAtSize(str, o.size) + o.letterSpacing * Math.max(0, str.length - 1);
      if (o.align === 'right') x -= w;
      else if (o.align === 'center') x -= w / 2;
    }
    const drawOpts = {
      x: x,
      y: o.y,
      font: o.font,
      size: o.size,
      color: toLibRgb(o.color || '#2C2218'),
      opacity: o.opacity,
    };
    if (o.letterSpacing) drawOpts.characterSpacing = o.letterSpacing;
    if (o.rotate) drawOpts.rotate = o.rotate;
    page.drawText(str, drawOpts);
  }

  // Word-wrap a string to a max width by character measurement.
  // Returns [line1, line2, ...]. Splits on spaces; long single tokens are not broken.
  // v6.0.3 — also sanitizes Unicode → WinAnsi-safe before measuring so the
  // wrap math matches what'll actually render (and pdf-lib won't throw later
  // when the wrapped lines are drawn).
  function wrapText(text, opts) {
    if (!text) return [];
    const o = Object.assign({ size: 10, letterSpacing: 0 }, opts);
    if (!o.font || !o.maxWidth) return [_winAnsiSafe(String(text))];
    const measure = s => o.font.widthOfTextAtSize(s, o.size) + o.letterSpacing * Math.max(0, s.length - 1);
    const words = _winAnsiSafe(String(text)).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const candidate = cur ? cur + ' ' + w : w;
      if (measure(candidate) > o.maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---- dashed-line / dashed-rect / dashed-circle ----------------------- */
  function drawDashedLine(page, a, b, opts) {
    const o = Object.assign({ thickness: 0.8, dash: 3, gap: 2 }, opts);
    const col = toLibRgb(o.color || '#2C2218');
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const step = o.dash + o.gap;
    const ux = dx / len, uy = dy / len;
    for (let s = 0; s < len; s += step) {
      const e = Math.min(s + o.dash, len);
      page.drawLine({
        start: { x: a.x + ux * s, y: a.y + uy * s },
        end:   { x: a.x + ux * e, y: a.y + uy * e },
        color: col,
        thickness: o.thickness,
      });
    }
  }
  function drawDashedRect(page, x, y, w, h, opts) {
    const sides = [
      [{ x, y }, { x: x + w, y }],
      [{ x: x + w, y }, { x: x + w, y: y + h }],
      [{ x: x + w, y: y + h }, { x, y: y + h }],
      [{ x, y: y + h }, { x, y }],
    ];
    sides.forEach(([a, b]) => drawDashedLine(page, a, b, opts));
  }
  function drawDashedCircle(page, cx, cy, r, opts) {
    const o = Object.assign({ segs: 18, thickness: 1, color: '#2C2218' }, opts);
    const col = toLibRgb(o.color);
    for (let i = 0; i < o.segs; i++) {
      if (i % 2 !== 0) continue;
      const a1 = (i / o.segs) * Math.PI * 2;
      const a2 = ((i + 1) / o.segs) * Math.PI * 2;
      page.drawLine({
        start: { x: cx + Math.cos(a1) * r, y: cy + Math.sin(a1) * r },
        end:   { x: cx + Math.cos(a2) * r, y: cy + Math.sin(a2) * r },
        color: col,
        thickness: o.thickness,
      });
    }
  }

  /* ---- rotation -------------------------------------------------------- */
  function degrees(angle) {
    if (!window.PDFLib) throw new Error('SonorPdfV6: pdf-lib not loaded');
    return window.PDFLib.degrees(angle);
  }
  function degrees90() { return degrees(90); }

  /* ---- font / size resolution ----------------------------------------- */
  // Resolve a "weight key" → font object from the loaded fonts bag.
  // Adapters pass either a font object directly OR a key like 'bold' / 'reg'.
  function resolveFont(fonts, weight) {
    if (!weight) return fonts.reg || fonts.regular || fonts.bold;
    if (typeof weight === 'object' && typeof weight.widthOfTextAtSize === 'function') return weight;
    const w = String(weight).toLowerCase();
    return fonts[w] || fonts[w.slice(0, 3)] || fonts.reg || fonts.regular;
  }

  /* ---- gradient helper (v1.1.0 / v7.10.0) ------------------------------ */
  // Paint a fake vertical gradient by stacking `bands` thin horizontal rects
  // with linearly-interpolated colours between the given hex stops. pdf-lib
  // has no native linearGradient — this gives a smooth perceptual ramp at
  // negligible file-size cost (24 rects × hex colour ≈ 1 KB).
  //
  // stops: array of hex strings, top → bottom. e.g. ['#1a1a2e','#392a55','#5b3877'].
  // direction: 'down' (default) or 'up'.
  function _interpHex(a, b, t) {
    const aR = parseInt(a.slice(1, 3), 16), aG = parseInt(a.slice(3, 5), 16), aB = parseInt(a.slice(5, 7), 16);
    const bR = parseInt(b.slice(1, 3), 16), bG = parseInt(b.slice(3, 5), 16), bB = parseInt(b.slice(5, 7), 16);
    const mix = (x, y) => Math.round(x + (y - x) * t);
    return rgb01(mix(aR, bR), mix(aG, bG), mix(aB, bB));
  }
  function paintVerticalGradient(page, opts) {
    if (!page || !opts) return;
    const o = Object.assign({ bands: 24, direction: 'down' }, opts);
    if (!Array.isArray(o.stops) || o.stops.length < 2) return;
    const bands = Math.max(4, o.bands | 0);
    const bandH = o.h / bands;
    const stops = (o.direction === 'up') ? o.stops.slice().reverse() : o.stops;
    for (let i = 0; i < bands; i++) {
      // Position 0..1 down the gradient axis
      const t = (bands === 1) ? 0 : i / (bands - 1);
      // Which segment of stops are we in?
      const seg = t * (stops.length - 1);
      const idx = Math.min(stops.length - 2, Math.floor(seg));
      const localT = seg - idx;
      const colour = _interpHex(stops[idx], stops[idx + 1], localT);
      // Top-down paint — band 0 sits at top, last band at bottom.
      const bandY = o.y + o.h - (i + 1) * bandH;
      page.drawRectangle({
        x: o.x, y: bandY,
        width: o.w, height: bandH + 0.5, // +0.5 hides hairline seams in some viewers
        // v1.2.0 — _interpHex returns a raw {r,g,b}; pdf-lib REQUIRES its
        // own rgb() Color instance (Bickerton F-01 "Invalid color" crash).
        color: toLibRgb(colour),
      });
    }
  }

  /* ---- export ---------------------------------------------------------- */
  window.SonorPdfV6Helpers = {
    VERSION: '1.2.0',
    rgb01,
    hexToRgb01,
    toLibRgb,
    drawText,
    wrapText,
    drawDashedLine,
    drawDashedRect,
    drawDashedCircle,
    degrees,
    degrees90,
    resolveFont,
    winAnsiSafe: _winAnsiSafe,
    paintVerticalGradient,
  };
})();
