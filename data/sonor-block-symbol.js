// sonor-block-symbol.js — CANONICAL MASTER (Spine v1.2 §15 — HARMONY no-fork)
//
// ════════════════════════════════════════════════════════════════════════
// Single shared SVG renderer for a Sonor block symbol — the exact shape +
// glyph + service-coloured fill that appears on Takeoffs floor plans, the
// Library palette, the Cable Schedule "device icon" column, and (future)
// any PDF / HTML surface that wants to inline a block's plan-symbol.
//
// Geometry is canon — extracted verbatim 2026-05-11 from Takeoffs'
// `_symbolBadgeSvg` (Takeoffs v0.9.0, line 4907) which has been the
// canvas-truth palette renderer for months. Any future shape additions
// or visual tweaks land HERE — every consumer picks them up via sync.
//
// Namespace: window.SonorBlockSymbol
//
// Usage (HTML host):
//   <script src="data/sonor-block-symbol.js"></script>
//   <script>
//     const svg = SonorBlockSymbol.toInlineSVG({
//       shape: 'square', fill: '#e67eb1', glyph: 'K', size: 20
//     });
//     // → '<svg viewBox="0 0 20 20" width="20" height="20"...
//   </script>
//
// Usage (consumer with a Library row):
//   const libRow = SonorLibrary.getAllRows().find(r => r.block_code === 'WR');
//   const svg = SonorBlockSymbol.fromLibraryRow(libRow);
//   // shape, glyph, service colour resolved automatically.
//
// Service colour resolution: pulls from window.SONOR_BRAND.serviceColours
// (synced sonor-brand.js, keyed by service_nn '01'..'10'). Falls back to
// #6b4a8a (app accent) when service_nn missing or unresolvable.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  window.SonorBlockSymbol = window.SonorBlockSymbol || {};
  const BS = window.SonorBlockSymbol;
  BS.__version = '1.3.0';

  // Minimal HTML escape (the host might not have one in scope).
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 10 service colours — canonical hex from CLAUDE.md / brand-core.xml.
  // Fallback table used when window.SONOR_BRAND is not loaded.
  const _SERVICE_COLOURS_FALLBACK = {
    '01': '#8058a1', '02': '#4bb9d3', '03': '#78ba57', '04': '#f5d05c',
    '05': '#e37c59', '06': '#ec6061', '07': '#e67eb1', '08': '#ad9978',
    '09': '#b7b1a7', '10': '#302f2e'
  };
  const _APP_ACCENT_FALLBACK = '#6b4a8a';

  function _resolveServiceFill(service_nn) {
    if (!service_nn) return _APP_ACCENT_FALLBACK;
    const nn = String(service_nn).trim();
    try {
      if (window.SONOR_BRAND && window.SONOR_BRAND.serviceColours
          && window.SONOR_BRAND.serviceColours[nn]) {
        return window.SONOR_BRAND.serviceColours[nn];
      }
    } catch (_) {}
    return _SERVICE_COLOURS_FALLBACK[nn] || _APP_ACCENT_FALLBACK;
  }

  /**
   * Render a Sonor block symbol as an inline SVG string.
   *
   * @param {Object} opts
   *   @param {string} [opts.shape='circle']  one of: circle, square, diamond,
   *     pill, hex, triangle. Also accepts canvas aliases (ceiling, wall,
   *     floor, screen, in-line, node, ic, terminator, abstract, spkr).
   *   @param {string} [opts.fill='#6b4a8a']  hex fill colour (service colour).
   *   @param {string} [opts.glyph='']        single-char glyph rendered centred
   *     in white. Pass empty string to render a glyph-less swatch.
   *   @param {number} [opts.size=20]         px width + height; viewBox is
   *     0 0 20 20 scaled to this size.
   *   @param {boolean} [opts.stroke=true]    set false to drop the white
   *     outline (for small thumbnails on dark backgrounds).
   * @returns {string} inline SVG markup ready to paste into innerHTML / HTML.
   */
  // ── v1.3.0 (2026-07-07) — lum-* GEOMETRY SPECS (single source) ──────────
  // The lighting family's geometry as DATA, in the 20×20 viewBox space.
  // BOTH renderers consume this: the SVG builder in toInlineSVG (palette,
  // Library grid, schedule icons) and any canvas adapter via
  // BS.lumSpec(key) — e.g. Takeoffs' fabric renderer builds the same
  // primitives as fabric objects. Change a symbol HERE and every surface
  // follows (HARMONY no-forks). Primitive vocab: c=circle (fill:true =
  // solid dot), l=line (w = heavier stroke), r=rect, poly=filled polygon,
  // path=stroked SVG path.
  const LUM_SPECS = {
    'lum-downlight': [
      { t: 'c', cx: 10, cy: 10, r: 7.5 },
      { t: 'l', x1: 10, y1: 2.5, x2: 10, y2: 17.5 },
      { t: 'l', x1: 2.5, y1: 10, x2: 17.5, y2: 10 }
    ],
    'lum-pendant': [
      { t: 'c', cx: 10, cy: 10, r: 7.5 },
      { t: 'c', cx: 10, cy: 10, r: 2.6, fill: true }
    ],
    'lum-pendant-sm': [
      { t: 'c', cx: 10, cy: 10, r: 5.2 },
      { t: 'c', cx: 10, cy: 10, r: 1.8, fill: true }
    ],
    'lum-spot': [
      { t: 'c', cx: 8.2, cy: 11.8, r: 5.6 },
      { t: 'l', x1: 12.4, y1: 7.6, x2: 17.4, y2: 2.6 },
      { t: 'poly', points: '17.8,2.2 17.2,6.0 14.0,2.8' }
    ],
    'lum-wall': [
      { t: 'l', x1: 2, y1: 4, x2: 18, y2: 4, w: 2 },
      { t: 'path', d: 'M 4.5 4 A 5.5 5.5 0 0 0 15.5 4 Z' },
      { t: 'l', x1: 10, y1: 10.5, x2: 10, y2: 14.5 },
      { t: 'l', x1: 6, y1: 9, x2: 4, y2: 12.4 },
      { t: 'l', x1: 14, y1: 9, x2: 16, y2: 12.4 }
    ],
    'lum-picture': [
      { t: 'r', x: 3.5, y: 5, w: 13, h: 3.4, rx: 1.7 },
      { t: 'l', x1: 6, y1: 10.5, x2: 5, y2: 14.5 },
      { t: 'l', x1: 10, y1: 10.5, x2: 10, y2: 15 },
      { t: 'l', x1: 14, y1: 10.5, x2: 15, y2: 14.5 }
    ],
    'lum-track': [
      { t: 'l', x1: 2.5, y1: 6, x2: 17.5, y2: 6, w: 2 },
      { t: 'c', cx: 5.5, cy: 12, r: 2.4 },
      { t: 'c', cx: 10, cy: 12, r: 2.4 },
      { t: 'c', cx: 14.5, cy: 12, r: 2.4 }
    ],
    'lum-5a': [
      { t: 'c', cx: 9, cy: 11, r: 6 },
      { t: 'l', x1: 13.3, y1: 6.8, x2: 17.5, y2: 2.6 }
    ],
    'lum-batten': [
      { t: 'r', x: 2.5, y: 6.8, w: 15, h: 6.4, rx: 1.2 },
      { t: 'l', x1: 5.5, y1: 6.8, x2: 5.5, y2: 13.2 },
      { t: 'l', x1: 14.5, y1: 6.8, x2: 14.5, y2: 13.2 }
    ],
    'lum-downlight-adj': [
      { t: 'c', cx: 10, cy: 10, r: 7.5 },
      { t: 'l', x1: 5.2, y1: 5.2, x2: 14.8, y2: 14.8 }
    ],
    'lum-downlight-ww': [
      { t: 'c', cx: 10, cy: 10, r: 7 },
      { t: 'l', x1: 10, y1: 3, x2: 10, y2: 17 },
      { t: 'l', x1: 3, y1: 10, x2: 17, y2: 10 },
      { t: 'l', x1: 2.5, y1: 18.6, x2: 17.5, y2: 18.6, w: 2 }
    ],
    'lum-uplight': [
      { t: 'r', x: 3, y: 3, w: 14, h: 14, rx: 1.5 },
      { t: 'l', x1: 6, y1: 12, x2: 10, y2: 7.5 },
      { t: 'l', x1: 10, y1: 7.5, x2: 14, y2: 12 },
      { t: 'l', x1: 6, y1: 15, x2: 10, y2: 10.5 },
      { t: 'l', x1: 10, y1: 10.5, x2: 14, y2: 15 }
    ],
    'lum-cove': [
      { t: 'r', x: 2.5, y: 11.5, w: 15, h: 3, rx: 1 },
      { t: 'l', x1: 4.5, y1: 11, x2: 4.5, y2: 7.5 },
      { t: 'l', x1: 8, y1: 11, x2: 8, y2: 6.8 },
      { t: 'l', x1: 12, y1: 11, x2: 12, y2: 6.8 },
      { t: 'l', x1: 15.5, y1: 11, x2: 15.5, y2: 7.5 }
    ],
    'lum-chandelier': [
      { t: 'c', cx: 10, cy: 10, r: 2.6 },
      { t: 'l', x1: 10, y1: 10, x2: 10, y2: 2.5 },
      { t: 'l', x1: 10, y1: 10, x2: 10, y2: 17.5 },
      { t: 'l', x1: 10, y1: 10, x2: 2.5, y2: 10 },
      { t: 'l', x1: 10, y1: 10, x2: 17.5, y2: 10 },
      { t: 'l', x1: 10, y1: 10, x2: 4.7, y2: 4.7 },
      { t: 'l', x1: 10, y1: 10, x2: 15.3, y2: 4.7 },
      { t: 'l', x1: 10, y1: 10, x2: 4.7, y2: 15.3 },
      { t: 'l', x1: 10, y1: 10, x2: 15.3, y2: 15.3 }
    ],
    'lum-step': [
      { t: 'r', x: 3, y: 8, w: 14, h: 6, rx: 1 },
      { t: 'l', x1: 5.5, y1: 10.5, x2: 14.5, y2: 10.5 },
      { t: 'l', x1: 5.5, y1: 12.5, x2: 14.5, y2: 12.5 }
    ],
    'lum-bollard': [
      { t: 'r', x: 8, y: 3.5, w: 4, h: 13, rx: 1 },
      { t: 'l', x1: 6, y1: 7, x2: 14, y2: 7, w: 2 },
      { t: 'l', x1: 5.5, y1: 16.5, x2: 14.5, y2: 16.5, w: 2 }
    ],
    'lum-updown': [
      { t: 'c', cx: 10, cy: 10, r: 2, fill: true },
      { t: 'l', x1: 6, y1: 7, x2: 10, y2: 4 },
      { t: 'l', x1: 10, y1: 4, x2: 14, y2: 7 },
      { t: 'l', x1: 6, y1: 13, x2: 10, y2: 16 },
      { t: 'l', x1: 10, y1: 16, x2: 14, y2: 13 }
    ]
  };
  const _LUM_FALLBACK = [{ t: 'c', cx: 10, cy: 10, r: 7.5 }];
  BS.lumSpec = function (key) { return LUM_SPECS[key] || _LUM_FALLBACK; };
  BS.isLumShape = function (key) { return String(key || '').indexOf('lum-') === 0; };

  BS.toInlineSVG = function (opts) {
    opts = opts || {};
    const shape = opts.shape || 'circle';
    const fill = opts.fill || _APP_ACCENT_FALLBACK;
    const glyph = opts.glyph == null ? '' : String(opts.glyph);
    const size = (typeof opts.size === 'number' && opts.size > 0) ? opts.size : 20;
    const wantStroke = opts.stroke !== false;

    const R = 9;
    const cx = 10, cy = 10;
    const key = String(shape || '').toLowerCase().trim();
    const stroke = wantStroke
      ? 'stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"'
      : '';
    let body = '';
    // ── v1.2.0 (2026-07-07) — LIGHTING SYMBOL FAMILY (`lum-*`) ─────────────
    // Industry-standard lighting-plan symbols: OUTLINE style (stroke =
    // service colour, no filled blob), self-identifying — glyph text is
    // suppressed for these shapes (returns early). Used by 04.6 Luminaires.
    // Consumers that don't know these keys fall through their own default
    // (typically a plain circle) until they adopt v1.2.0.
    if (key.indexOf('lum-') === 0) {
      // v1.3.0 — renders from the LUM_SPECS data table above (single
      // geometry source shared with canvas adapters via BS.lumSpec).
      const c = _esc(fill);
      const S = `fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"`;
      const lb = BS.lumSpec(key).map(pr => {
        switch (pr.t) {
          case 'c':    return pr.fill
            ? `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${c}"/>`
            : `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" ${S}/>`;
          case 'l':    return pr.w
            ? `<line x1="${pr.x1}" y1="${pr.y1}" x2="${pr.x2}" y2="${pr.y2}" stroke="${c}" stroke-width="${pr.w}"/>`
            : `<line x1="${pr.x1}" y1="${pr.y1}" x2="${pr.x2}" y2="${pr.y2}" ${S}/>`;
          case 'r':    return `<rect x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${pr.h}" rx="${pr.rx || 0}" ${S}/>`;
          case 'poly': return `<polygon points="${pr.points}" fill="${c}"/>`;
          case 'path': return `<path d="${pr.d}" ${S}/>`;
          default:     return '';
        }
      }).join('');
      return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" class="sonor-block-symbol sonor-lum-symbol">${lb}</svg>`;
    }
    switch (key) {
      case 'square': case 'wall': case 'box': case 'bracket':
      case 'surface': case 'freestanding':
        body = `<rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" fill="${_esc(fill)}" ${stroke}/>`;
        break;
      case 'diamond': case 'floor':
        body = `<rect x="${cx - R * 0.9}" y="${cy - R * 0.9}" width="${R * 1.8}" height="${R * 1.8}" transform="rotate(45 ${cx} ${cy})" fill="${_esc(fill)}" ${stroke}/>`;
        break;
      case 'pill': case 'in-line': case 'screen':
        body = `<ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${(R * 0.55).toFixed(2)}" fill="${_esc(fill)}" ${stroke}/>`;
        break;
      case 'hex': case 'node': case 'ic': case 'terminator': {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          pts.push(`${(cx + R * Math.cos(a)).toFixed(2)},${(cy + R * Math.sin(a)).toFixed(2)}`);
        }
        body = `<polygon points="${pts.join(' ')}" fill="${_esc(fill)}" ${stroke}/>`;
        break;
      }
      case 'triangle':
        body = `<polygon points="${cx},${cy - R} ${cx + R * 0.9},${cy + R * 0.75} ${cx - R * 0.9},${cy + R * 0.75}" fill="${_esc(fill)}" ${stroke}/>`;
        break;
      case 'circle': case 'ceiling': case 'spkr': case 'abstract':
      default:
        body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${_esc(fill)}" ${stroke}/>`;
        break;
    }
    // v1.1.0 (2026-05-11) — Auto-scale glyph font-size based on character
    // count so multi-letter labels ("TV-4K", "STAT", "WAP-X") stop
    // overflowing the 20×20 viewBox and reading as filled-pill blobs.
    // Single chars stay at 10 (the original size); 2-3 chars step down
    // to 8; 4+ chars to 5.5. Tested visually against the Cable Schedule
    // chip rail. Bryn directive 2026-05-11: "block text needs to shrink
    // more". Stretches `textLength` to keep the glyph centred even on
    // the smaller font-size so the proportional spacing reads.
    const glyphLen = String(glyph).length;
    const glyphFont = glyphLen <= 1 ? 10
                    : glyphLen <= 3 ? 8
                    : 5.5;
    const glyphHtml = glyph
      ? `<text x="${cx}" y="${cy + 0.5}" text-anchor="middle" dominant-baseline="central" ` +
        `font-size="${glyphFont}" font-weight="700" fill="#ffffff" ` +
        `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${_esc(glyph)}</text>`
      : '';
    return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" class="sonor-block-symbol">${body}${glyphHtml}</svg>`;
  };

  /**
   * Convenience: build the SVG from a SonorLibrary row, resolving shape,
   * glyph, and service-colour fill in one call. Returns '' when libRow
   * is null/undefined (safe to inline into table cells).
   *
   * Override precedence honoured: opts.shape > libRow.shape; opts.glyph >
   * libRow.glyph; opts.fill > resolved service colour.
   */
  BS.fromLibraryRow = function (libRow, opts) {
    if (!libRow) return '';
    opts = opts || {};
    return BS.toInlineSVG({
      shape: opts.shape || libRow.shape || 'circle',
      glyph: opts.glyph != null ? opts.glyph : (libRow.glyph || ''),
      fill: opts.fill || _resolveServiceFill(libRow.service_nn),
      size: opts.size || 20,
      stroke: opts.stroke !== false
    });
  };

  // Exposed for unit tests + edge cases.
  BS._resolveServiceFill = _resolveServiceFill;
})();
