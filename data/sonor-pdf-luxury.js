/* Sonor PDF Luxury — SHARED client-proposal chrome (v1.7.0, root master)
   v1.7.0 (2026-11-01, cover art set — Bryn: "use the file list and review notes in 027, then ingest … and check the actual A3/A4 cover
   overlays and crops" · "obvs when we have a1 a0 these should be stretched out"): cover({ layout: 'art' }) (alias background: true) — the
   house cover ART (Branding - CORE/PDF-COVERS, black void, subject lower-right / right 45 %) drawn full bleed, cover-fit at ANY sheet size
   (A4 → A0, never capped), with NO fade / band; mark + wordmark, eyebrow, title (wraps up to 3 lines, steps down 54 → 28 pt), subtitle
   (2 lines) and the info cells are set INSIDE the clean zone — portrait: the top of the page down to 52 % of its height · landscape:
   the left 55 % column. Every size scales with the sheet's short side (an A3 copy = the A4 one enlarged). opts.heroLandscape picks the
   landscape image on a landscape sheet. loadCoverArt(doc, url, landscape?) loads <name>-landscape.jpg on a landscape sheet (the default
   is the current sheet()) and falls back to the other twin. A project photo cover (no layout) is unchanged — byte-identical.
   v1.6.0 (2026-11-01, LED Calc — Bryn: "drawing could be better like it is from other apps"): the DRAWING SHEET anatomy the Stretched
   Fabric design pack proved (fabric-pack.js head / foot / lay / legend / scaleBar), lifted here so every app's drawing pages share it:
   drawingSheet(P, F, o) → { box, notes } paints the head (mark + project / drawing no. + revision, eyebrow "<no> · DESIGN DEVELOPMENT",
   title, sub), the notes column (landscape: right · portrait: below) with o.notes blocks, the legend strip (o.legend items + o.legendRight)
   and the foot ("NOT FOR CONSTRUCTION · DESIGN DEVELOPMENT · date" · project · drawing · Page n / total); scaleBar(P, F, x, top, ptPerMm,
   totalMm, label) and scaleOf(ptPerMm) → 1:N. Fabric can move onto these (B-585d).
   v1.5.2 (2026-11-01, LED Calc): makeFonts embeds Gilroy with ligatures OFF (features liga / clig / dlig false). pdf-lib maps "ff" / "fi"
   to Gilroy's ligature glyphs but advances by the single-letter widths, so "Takeoffs" printed as "Takeoff s" — the reason consumers
   inserted "f f" spaces. Every pack on this chrome now sets "ff" correctly; the "f f" workaround in a consumer can go.
   v1.4.0 (2026-10-16): palette read from sonor-pdf-theme.js when present — ONE PDF theme workspace-wide (black/gold chrome, neutral greys).
   v1.3.1 (2026-10-16, Takeover): cover() wraps a title that is still too wide at 38 pt onto two lines (eyebrow lifts with it).
   v1.3.0 (2026-10-16, Takeover): footerMode('minimal', project) — page-number-only running footer; rearPage() — the closing contact page
   (projects@ / service@ / phone / web / CEDIA). Adopted by Takeover + Service Contracts; classic footer stays the default elsewhere.
   v1.2.0 (2026-10-12, Survey): OPT-IN theme('neutral') — white paper + neutral greys for working documents (survey reports,
   schedules, anything that is not a client proposal); gold accents stay. theme('luxury') = the cream default, untouched.
   cover opts.brandColour — the top-left mark + wordmark colour on the cover (Survey passes COL.GOLD: white vanished on a bright hero).
   v1.1.0 (2026-09-10, Service Contracts): OPT-IN pageHead brand:'large', pageFoot {logos:[…]} (partner-logo footer),
   cover brandLarge + footLogos. Defaults unchanged — Cinema Aesthetic / Cinema Tools render byte-identical.
   window.SonorPdfLuxury — the proven pdf-lib page system from the Seating
   Configurator proposal (seating-pdf.js v0.22.x), extracted VERBATIM so every
   client-facing proposal (seating · cinema design · future docs) shares ONE
   styling source. Edit THIS master at workspace root; propagate with
   `bash sync-everything.sh --only sonor-pdf-luxury.js`. Rules: cinema-pdf-luxury
   skill (frame-edge, divider discipline, truncate-vs-wrap, Gilroy glyph traps).
   Consumers: data/aesthetic-pdf.js (Cinema Design Proposal). Seating adoption:
   SEATING-SSOT-CONTRACT §6 ask logged 2026-07-19.
*/
(function (global) {
  'use strict';

  var A4 = { w: 595.28, h: 841.89 };
  // v1.5.0 (2026-10-22, Bryn: "make it proper pages" — the whole Stretched Fabric pack as A3 landscape, not A4 spreads): the chrome can
  // now be told the SHEET it is drawing on. sheet({ w, h }) mutates the one A4 object every painter closes over, so pageHead / pageFoot /
  // cover / rearPage / sectionHead and every consumer that reads lx.A4 at draw time lay out on that sheet; sheet() with no args returns
  // the current size; sheet('A4') restores the default. A3 landscape (1190.55 × 841.89) shares A4 portrait's HEIGHT, so every absolute
  // y in the chrome (cover title block, info row, foot) still lands — only widths change. Prose keeps a readable measure: TW() caps a
  // paragraph width at 640 pt on wide sheets (sectionHead uses it; consumers should wrap prose with lx.TW(), tables may span A4.w − 2M).
  var SHEETS = { A4: { w: 595.28, h: 841.89 }, 'A4-landscape': { w: 841.89, h: 595.28 }, A3: { w: 841.89, h: 1190.55 }, 'A3-landscape': { w: 1190.55, h: 841.89 } };
  function sheet(opts) { if (opts == null) return { w: A4.w, h: A4.h }; var sz = typeof opts === 'string' ? SHEETS[opts] : opts; if (sz && sz.w && sz.h) { A4.w = sz.w; A4.h = sz.h; } return { w: A4.w, h: A4.h }; }
  function TW() { return Math.min(A4.w - M * 2, 640); }
  var M = 48;
  var COL = {
    GOLD: [173, 153, 120], GOLDL: [200, 180, 142], GDEEP: [140, 116, 60], PUR: [128, 88, 161],
    CREAM: [251, 250, 247], INK: [26, 24, 20], INK2: [60, 55, 47], MUT: [120, 112, 96],
    DARK: [9, 8, 7], DARK2: [22, 19, 24], LINE: [214, 205, 188], LABEL: [150, 138, 116], PAGE_NO: [170, 160, 140],
    INFO: [168, 156, 136]
  };

  // ── v1.4.0 (2026-10-22) — PAPER: the cream page background is gone from EVERY Sonor PDF (Bryn, on the Fabric design pack: "drop the cream backgrounds too, or maybe just a very slight tint" → "yes all pdfs re cream"). Both themes now share one paper, a very slight warm tint (251/250/247); 'luxury' keeps its warm ink / gold line tones, 'neutral' its greys. No consumer change needed — COL.CREAM is read at draw time.
  // ── v1.2.0 THEMES — Bryn: "I don't think we should have the cream background in the pdf… only maybe the luxury apps like
  // seating and lighting, everything else should be more neutral". COL is mutated in place (every painter reads it at draw
  // time), so a consumer calls theme() once before building. Default = luxury (cream) — Cinema Design / Seating / Lighting unchanged.
  var THEMES = {
    luxury:  { CREAM: [251, 250, 247], INK: [26, 24, 20], INK2: [60, 55, 47], MUT: [120, 112, 96], LINE: [214, 205, 188], LABEL: [150, 138, 116], PAGE_NO: [170, 160, 140], INFO: [168, 156, 136] },
    neutral: { CREAM: [251, 250, 247], INK: [24, 24, 24], INK2: [62, 62, 62], MUT: [118, 118, 118], LINE: [222, 222, 222], LABEL: [138, 138, 138], PAGE_NO: [164, 164, 164], INFO: [172, 172, 172] }
  };
  // v1.4.0 (2026-10-16) — sonor-pdf-theme.js is the ONE palette (Bryn: "gel all the branding now so minor tweaks can be
  // system wide"): when it is on the page its luxury() sets replace the literals above — same values today, one place tomorrow.
  try {
    var _T = (typeof window !== 'undefined' && window.SonorPdfTheme) ? window.SonorPdfTheme.luxury() : null;
    if (_T) { Object.assign(COL, _T.shared, _T.luxury); THEMES.luxury = _T.luxury; THEMES.neutral = _T.neutral; }
  } catch (e) {}
  var _theme = 'luxury';
  function theme(name) { if (name == null) return _theme; var t = THEMES[name]; if (!t) return _theme; Object.keys(t).forEach(function (k) { COL[k] = t[k].slice(); }); _theme = name; return _theme; }

  var HOUSE = 'M92.02,38.41v51.4c0,2.63-2.13,4.75-4.75,4.75h-3.34c-2.62,0-4.75-2.12-4.75-4.75v-45.34c0-2.45-1.11-4.77-3.01-6.31l-25.23-20.41c-2.8-2.27-6.76-2.42-9.73-.36l-23.15,16.05.45,1.55c22.38,9.5,40.47,30.05,47.71,53.39.95,3.06-1.32,6.18-4.53,6.18h-5.36c-2.08,0-3.9-1.37-4.54-3.35-6.96-21.83-24.83-38.23-46.17-46.13-1.31-.49-2.31-1.5-2.79-2.75-.2-.51-.31-1.06-.32-1.64l-.12-9.11c-.02-1.58.75-3.06,2.05-3.96L28.74,10.74,42.11,1.45c.16-.11.32-.22.49-.31,2.35-1.4,5.22-1.5,7.64-.34.57.26,1.12.61,1.63,1.03l37.16,30.29c1.89,1.54,2.99,3.85,2.99,6.29Z ' +
    'M34.59,94.55h-5.25c-1.6,0-3.09-.81-3.97-2.15-5.47-8.37-11.98-15.35-20.72-20.32-1.5-.85-2.45-2.42-2.45-4.15v-5.58c0-3.52,3.68-5.79,6.85-4.26,12.79,6.15,23.95,16.91,29.85,29.73,1.45,3.14-.86,6.73-4.32,6.73h0Z ' +
    'M4.26,83.39c7.65-1.71,9.39,9.06,4.03,10.83-8.9,2.94-11.25-9.22-4.03-10.83Z';
  var WA = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z';

  // smooth alpha fade (canvas-rendered PNG — no banding); cached per session
  var _fadePng = null;
  function fadePngDataUrl() {
    if (_fadePng) return _fadePng;
    try {
      var cv = document.createElement('canvas'); cv.width = 16; cv.height = 1024;
      var g = cv.getContext('2d'); var gr = g.createLinearGradient(0, 0, 0, 1024);
      gr.addColorStop(0, 'rgba(9,8,7,0)'); gr.addColorStop(0.45, 'rgba(9,8,7,0.55)'); gr.addColorStop(1, 'rgba(9,8,7,1)');
      g.fillStyle = gr; g.fillRect(0, 0, 16, 1024);
      _fadePng = cv.toDataURL('image/png');
    } catch (e) { _fadePng = null; }
    return _fadePng;
  }

  function col(a) { return global.PDFLib.rgb(a[0] / 255, a[1] / 255, a[2] / 255); }
  function hexRgb(hx) {
    hx = String(hx || '').replace('#', '');
    return /^[0-9a-f]{6}$/i.test(hx) ? [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)] : [80, 76, 70];
  }
  async function fetchBytes(url) { var r = await fetch(url); if (!r.ok) throw new Error('fetch ' + url + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); }

  // load an image URL → embedded pdf image (webp handled via canvas → jpeg)
  async function loadImage(doc, url) {
    var abs = (typeof document !== 'undefined') ? new URL(url, document.baseURI).href : url;
    if (/\.jpe?g(\?|$)/i.test(abs)) return doc.embedJpg(await fetchBytes(abs));
    if (/\.png(\?|$)/i.test(abs)) return doc.embedPng(await fetchBytes(abs));
    var bytes = await fetchBytes(abs);
    var blob = new Blob([bytes]); var u = URL.createObjectURL(blob);
    try {
      var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = u; });
      var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      var dataUrl = cv.toDataURL('image/jpeg', 0.86);
      var b64 = dataUrl.split(',')[1], bin = atob(b64), out = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return await doc.embedJpg(out);
    } finally { URL.revokeObjectURL(u); }
  }

  function mk(page, doc) {
    var P = {
      page: page,
      text: function (str, x, top, size, font, c, opts) { opts = opts || {}; page.drawText(String(str), { x: x, y: A4.h - top - size, size: size, font: font, color: col(c || COL.INK), lineHeight: opts.lineHeight, maxWidth: opts.maxWidth }); },
      tracked: function (str, x, top, size, font, c, track) {
        track = track || 0; str = String(str); var cx = x, y = A4.h - top - size;
        for (var i = 0; i < str.length; i++) { page.drawText(str[i], { x: cx, y: y, size: size, font: font, color: col(c || COL.INK) }); cx += font.widthOfTextAtSize(str[i], size) + track; }
        return cx - x - track;
      },
      trackedRight: function (str, right, top, size, font, c, track) {
        track = track || 0; str = String(str); var w = 0; for (var i = 0; i < str.length; i++) w += font.widthOfTextAtSize(str[i], size) + track; w -= track;
        P.tracked(str, right - w, top, size, font, c, track); return w;
      },
      right: function (str, right, top, size, font, c) { var w = font.widthOfTextAtSize(String(str), size); page.drawText(String(str), { x: right - w, y: A4.h - top - size, size: size, font: font, color: col(c || COL.INK) }); },
      center: function (str, cx, top, size, font, c, track) {
        var w = 0; str = String(str);
        for (var i = 0; i < str.length; i++) w += font.widthOfTextAtSize(str[i], size) + (track || 0);
        w -= (track || 0); P.tracked(str, cx - w / 2, top, size, font, c, track || 0);
      },
      rect: function (x, top, w, h, c, o) { page.drawRectangle({ x: x, y: A4.h - top - h, width: w, height: h, color: col(c), opacity: o == null ? 1 : o }); },
      rectB: function (x, top, w, h, c, bw, o) { page.drawRectangle({ x: x, y: A4.h - top - h, width: w, height: h, borderColor: col(c), borderWidth: bw, opacity: 0, borderOpacity: o == null ? 1 : o }); },
      hline: function (x1, x2, top, c, t, o) { page.drawLine({ start: { x: x1, y: A4.h - top }, end: { x: x2, y: A4.h - top }, thickness: t || 0.6, color: col(c), opacity: o == null ? 1 : o }); },
      vline: function (x, top1, top2, c, t, o) { page.drawLine({ start: { x: x, y: A4.h - top1 }, end: { x: x, y: A4.h - top2 }, thickness: t || 0.6, color: col(c), opacity: o == null ? 1 : o }); },
      logo: function (x, top, h, c) { var sc = h / 95; page.drawSvgPath(HOUSE, { x: x, y: A4.h - top, scale: sc, color: col(c || COL.GOLD) }); },
      image: function (img, x, top, w, h, o) { page.drawImage(img, { x: x, y: A4.h - top - h, width: w, height: h, opacity: o == null ? 1 : o }); },
      dot: function (x, top, r, c, borderC) { page.drawCircle({ x: x, y: A4.h - top, size: r, color: col(c), borderColor: borderC ? col(borderC) : undefined, borderWidth: borderC ? 0.6 : 0 }); },
      rrect: function (x, top, w, h, r, c, bw, o) {
        r = Math.min(r, w / 2, h / 2);
        var p = 'M ' + r + ',0 H ' + (w - r) + ' A ' + r + ',' + r + ' 0 0 1 ' + w + ',' + r + ' V ' + (h - r) + ' A ' + r + ',' + r + ' 0 0 1 ' + (w - r) + ',' + h + ' H ' + r + ' A ' + r + ',' + r + ' 0 0 1 0,' + (h - r) + ' V ' + r + ' A ' + r + ',' + r + ' 0 0 1 ' + r + ',0 Z';
        page.drawSvgPath(p, { x: x, y: A4.h - top, borderColor: col(c), borderWidth: bw || 0.8, borderOpacity: o == null ? 1 : o });
      },
      fadeDown: function (x, top, w, h, c, maxO, steps) {
        steps = steps || 56; maxO = maxO == null ? 1 : maxO;
        var slice = h / steps;
        for (var i = 0; i < steps; i++) {
          var t = (i + 1) / steps;
          var o = maxO * t * t * (1 - (1 - t) * 0.2);
          P.rect(x, top + slice * i, w, slice * 1.9, c, o * 0.62);
          P.rect(x, top + slice * i, w, slice * 1.1, c, o * 0.5);
        }
      },
      link: function (str, x, top, size, font, c, url) {
        P.text(str, x, top, size, font, c);
        var w = font.widthOfTextAtSize(String(str), size);
        P.hline(x, x + w, top + size + 2, c, 0.5, 0.5);
        try {
          var PL = global.PDFLib;
          var ann = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, A4.h - top - size - 3, x + w, A4.h - top + 2], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PL.PDFString.of(url) } });
          var ref = doc.context.register(ann);
          var key = PL.PDFName.of('Annots');
          var existing = page.node.lookup(key);
          if (existing) existing.push(ref); else page.node.set(key, doc.context.obj([ref]));
        } catch (e) {}
        return w;
      }
    };
    return P;
  }

  function wrap(str, font, size, width) {
    var words = String(str || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function money(n) { return n == null ? 'POA' : '£' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  function mm(v) { return v != null ? Math.round(v) + ' mm' : null; }

  // fonts — Gilroy trio with Helvetica fallback. `base` = app's data/ dir.
  async function makeFonts(doc, base) {
    var PL = global.PDFLib, F = {};
    try { if (global.fontkit) doc.registerFontkit(global.fontkit); } catch (e) {}
    try {
      var NOLIG = { subset: false, features: { liga: false, clig: false, dlig: false } };   // v1.5.2 — Gilroy ligatures mis-advance in pdf-lib
      F.b = await doc.embedFont(await fetchBytes(base + 'fonts/gilroy-extrabold.otf'), NOLIG);
      F.r = await doc.embedFont(await fetchBytes(base + 'fonts/gilroy-regular.otf'), NOLIG);
      F.l = await doc.embedFont(await fetchBytes(base + 'fonts/gilroy-ultralight.otf'), NOLIG);
    } catch (e) {
      F.b = await doc.embedFont(PL.StandardFonts.HelveticaBold);
      F.r = await doc.embedFont(PL.StandardFonts.Helvetica);
      F.l = F.r;
    }
    return F;
  }

  // shared page furniture — content pages. docLabel appears on pages 1–2's LHS;
  // pages 3+ carry their own section label (v0.19.0 rule).
  // opts (v1.1.0, all optional — defaults keep the seating/cinema look):
  //   brand: 'large' → Sonor mark + wordmark top-left (22 pt), section label sits after it
  function pageHead(P, F, label, pageNo, total, docLabel, opts) {
    opts = opts || {};
    var lhs = (pageNo >= 3 && label) ? label : (docLabel || 'PROPOSAL');
    if (opts.brand === 'large') {
      P.logo(M, 30, 22, COL.GOLD);
      P.tracked('SONOR', M + 27, 34.5, 14, F.b, COL.INK, 3.6);
      P.tracked(lhs, M + 118, 42, 8, F.r, COL.LABEL, 2.4);
    } else {
      P.tracked(lhs, M, 42, 8, F.r, COL.LABEL, 2.4);
    }
    if (pageNo) P.trackedRight(pageNo + ' / ' + total, A4.w - M, 42, 8, F.r, COL.PAGE_NO, 1.6);
    P.hline(M, A4.w - M, 68, COL.LINE, 0.8);
  }
  // opts (v1.1.0): { logos: [pdf-lib images] } → footer band shows ONLY those logos (partners /
  // third parties / manufacturers), centred, ≤ 18 pt tall; no wordmark, no contact line.
  // v1.3.0 (2026-10-16, Takeover / Bryn: "dont think we need the info in the footer of every page, just page numbering and then full
  // contact info on the rear page"): footerMode('minimal') makes EVERY pageFoot call render only `<project> · Page N` (bottom-right,
  // small) — the full contact block moves to rearPage(). Default stays 'classic' so Seating / Cinema render byte-identical until they opt in.
  var _footerMode = 'classic', _footerProject = '';
  function footerMode(mode, project) { if (mode) _footerMode = mode; if (project != null) _footerProject = String(project); return _footerMode; }
  function pageFoot(P, F, opts) {
    opts = opts || {};
    if (_footerMode === 'minimal' || opts.minimal) {
      var txt = (opts.project || _footerProject ? (opts.project || _footerProject) + '  ·  ' : '') + (opts.pageLabel || 'Page') + ' ' + (opts.pageNo || '');
      if (opts.pageNo) P.trackedRight(txt, A4.w - M, A4.h - 30, 7, F.r, COL.PAGE_NO, 1.2);
      return;
    }
    if (opts.logos) {
      P.hline(M, A4.w - M, A4.h - 56, COL.LINE, 0.8);
      var imgs = opts.logos.filter(Boolean), maxH = 18, gapL = 22, dims = imgs.map(function (im) { var h = Math.min(maxH, im.height), w = im.width * (h / im.height); if (w > 110) { w = 110; h = im.height * (w / im.width); } return { im: im, w: w, h: h }; });
      var totalW = dims.reduce(function (a, d) { return a + d.w; }, 0) + gapL * Math.max(0, dims.length - 1);
      var x = (A4.w - totalW) / 2, cy = A4.h - 30;
      dims.forEach(function (d) { P.image(d.im, x, cy - d.h / 2, d.w, d.h, 0.9); x += d.w + gapL; });
      if (opts.note) P.tracked(String(opts.note).toUpperCase(), M, A4.h - 44.2, 6.5, F.r, COL.INFO, 1.4);
      return;
    }
    var GDEEP = COL.GDEEP;
    P.hline(M, A4.w - M, A4.h - 56, COL.LINE, 0.8);
    // opts.email (v1.1.1) — per-document contact address; default stays projects@ for proposals
    P.tracked(String(opts.email || 'projects@sonor.co.uk').toUpperCase(), M, A4.h - 44.2, 7.2, F.r, GDEEP, 1.4);
    var s = 'SONOR', ss = 9.5, tr = 2.8, tw = 0;
    for (var i = 0; i < s.length; i++) tw += F.b.widthOfTextAtSize(s[i], ss) + tr;
    tw -= tr;
    var markW = 15 * (93 / 95), gap = 7, totW = markW + gap + tw;
    var cx0 = (A4.w - totW) / 2;
    P.logo(cx0, A4.h - 47.5, 15, COL.GOLD);
    P.tracked(s, cx0 + markW + gap, A4.h - 44.6, ss, F.b, GDEEP, tr);
    var phone = '07933 684 000', ps = 8;
    var phW = 0; for (var j = 0; j < phone.length; j++) phW += F.r.widthOfTextAtSize(phone[j], ps) + 1.2;
    var phX = A4.w - M - phW;
    P.tracked(phone, phX, A4.h - 44.4, ps, F.r, GDEEP, 1.2);
    P.page.drawSvgPath(WA, { x: phX - 14, y: 45.6, scale: 9.5 / 24, color: col(GDEEP) });
  }

  // ── COVER ART (v1.7.0) — the house background art: full bleed, no fade, text only in the clean zone ─────
  function isLandscape() { return A4.w > A4.h; }
  function artTwinUrl(url, landscape) {
    var u = String(url || ''), m = /^(.*?)(-landscape)?(\.[a-z0-9]+)(\?.*)?$/i.exec(u);
    if (!m) return u;
    return m[1] + (landscape ? '-landscape' : '') + m[3] + (m[4] || '');
  }
  // load the cover art for the sheet's orientation: <name>.jpg (portrait) / <name>-landscape.jpg (landscape), falling back to the twin
  async function loadCoverArt(doc, url, landscape) {
    if (landscape == null) landscape = isLandscape();
    var want = artTwinUrl(url, landscape), other = artTwinUrl(url, !landscape);
    try { return await loadImage(doc, want); } catch (e) { return await loadImage(doc, other); }
  }
  function coverArt(P, F, opts) {
    var W = A4.w, H = A4.h, LAND = W > H, k = Math.min(W, H) / 595.28, m = M * k, fi = M * 0.62 * k;
    P.rect(0, 0, W, H, COL.DARK);
    var img = (LAND && opts.heroLandscape) ? opts.heroLandscape : (!LAND && opts.heroPortrait) ? opts.heroPortrait : opts.hero;
    if (img) {   // cover-fit, centred — the art is 1:1.414 like every ISO sheet, so A4 → A0 fills with no crop and no distortion
      var iw = img.width, ih = img.height, s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
      P.image(img, (W - dw) / 2, (H - dh) / 2, dw, dh, 1);
    }
    P.rectB(fi, fi, W - fi * 2, H - fi * 2, COL.GOLD, 0.7 * k, 0.34);
    var bc = opts.brandColour || COL.CREAM, brandTop = fi + 22 * k;
    P.logo(m, brandTop, 30 * k, bc);
    P.tracked('SONOR', m + 37 * k, fi + 28 * k, 18 * k, F.b, bc, 4.2 * k);
    // the clean zone
    var zx = m, zw = LAND ? W * 0.55 - m - 14 * k : W - m * 2;
    var zTop = brandTop + 30 * k + 46 * k, zBot = LAND ? H - fi - 34 * k : H * 0.52;
    var title = String(opts.title || 'Proposal'), eyebrow = String(opts.eyebrow || 'PROPOSAL').toUpperCase();
    var sub = opts.subtitle ? String(opts.subtitle) : '', info = (opts.info || []).slice(0, 3);
    function fitLines(str, font, size, width, max) {
      var ls = wrap(str, font, size, width);
      var hb = []; ls.forEach(function (ln) { while (font.widthOfTextAtSize(ln, size) > width && ln.length > 1) { var n = ln.length; while (n > 1 && font.widthOfTextAtSize(ln.slice(0, n), size) > width) n--; hb.push(ln.slice(0, n)); ln = ln.slice(n); } hb.push(ln); }); ls = hb;   // a word wider than the cell breaks onto the next line, never clipped
      if (ls.length > max) { var keep = ls.slice(0, max), last = keep[max - 1] + '…'; while (last.length > 1 && font.widthOfTextAtSize(last, size) > width) last = last.slice(0, -2) + '…'; keep[max - 1] = last; return keep; }
      return ls;
    }
    var cols = info.length || 1, cw = zw / cols, infoSize = (cw < 150 * k ? 11 : 12.5) * k, infoLh = infoSize * 1.2;
    var infoVals = info.map(function (c) {   // a value too wide for its cell breaks at its ' · ' separators first, then by words
      var v = String(c[1] || '—'), cwi = cw - 16 * k;
      if (F.b.widthOfTextAtSize(v, infoSize) <= cwi || v.indexOf('·') < 0) return fitLines(v, F.b, infoSize, cwi, 3);
      var out = []; v.split(/\s*·\s*/).filter(Boolean).forEach(function (part) { out = out.concat(fitLines(part, F.b, infoSize, cwi, 3)); });
      return out.length > 3 ? fitLines(out.join(' '), F.b, infoSize, cwi, 3) : out;
    });
    var infoLines = infoVals.reduce(function (a, v) { return Math.max(a, v.length); }, 1);
    var subSize = 19 * k, subLh = 24 * k;
    function layout(tsz) {
      var tl = wrap(title, F.b, tsz, zw);
      var sl = sub ? fitLines(sub, F.l, subSize, zw, 2) : [];
      var h = 8.5 * k + 22 * k + tl.length * tsz * 1.06 + (sl.length ? 14 * k + sl.length * subLh : 0) + (info.length ? 34 * k + 13 * k + infoLines * infoLh : 0);
      return { tsz: tsz, tl: tl, sl: sl, h: h };
    }
    var sizes = [54, 46, 40, 34, 30, 26].map(function (v) { return v * k; }), L = null;
    for (var i = 0; i < sizes.length; i++) {   // the biggest size that keeps the title to 2 lines (3 at the small end) and the block inside the zone
      var c = layout(sizes[i]), wide = c.tl.some(function (ln) { return F.b.widthOfTextAtSize(ln, sizes[i]) > zw; });
      if (!wide && c.tl.length <= (i < 3 ? 2 : 3) && c.h <= zBot - zTop) { L = c; break; }
    }
    if (!L) { L = layout(sizes[sizes.length - 1]); L.tl = fitLines(title, F.b, L.tsz, zw, 3); }
    var room = Math.max(0, zBot - zTop - L.h), y = zTop + room * (LAND ? 0.5 : 0.62);
    P.hline(zx, zx + 26 * k, y + 4 * k, COL.GOLD, 1 * k, 0.95);
    P.tracked(eyebrow, zx + 34 * k, y, 8.5 * k, F.r, COL.GOLDL, 3.2 * k);
    y += 8.5 * k + 22 * k;
    L.tl.forEach(function (ln) { P.text(ln, zx - 2 * k, y, L.tsz, F.b, COL.CREAM); y += L.tsz * 1.06; });
    if (L.sl.length) { y += 14 * k; L.sl.forEach(function (ln) { P.text(ln, zx, y, subSize, F.l, COL.GOLDL); y += subLh; }); }
    if (info.length) {
      y += 34 * k;
      P.hline(zx, zx + zw, y - 16 * k, COL.GOLD, 0.5 * k, 0.45);
      info.forEach(function (c, i) {
        var x = zx + i * cw;
        P.tracked(String(c[0] || ''), x, y, 7 * k, F.r, COL.INFO, 1.8 * k);
        infoVals[i].forEach(function (ln, j) { P.text(ln, x, y + 13 * k + j * infoLh, infoSize, F.b, COL.CREAM); });
      });
    }
    // logo strip — the clear band BELOW the frame, as on the photo cover (CEDIA right, or first in a partner strip)
    var cyL = H - 14 * k;
    if (opts.footLogos && opts.footLogos.length) {
      var fx = m, fh = 12 * k, gapF = 22 * k;
      if (opts.cediaImg) { var ch0 = ((opts.cediaImg.width / opts.cediaImg.height) < 3 ? 13 : 9) * k; var cw0 = ch0 * (opts.cediaImg.width / opts.cediaImg.height); P.image(opts.cediaImg, fx, cyL - ch0 / 2, cw0, ch0, 0.92); fx += cw0 + gapF + 6 * k; }
      opts.footLogos.filter(Boolean).forEach(function (im) { var fw = im.width * (fh / im.height), h2 = fh; if (fw > 70 * k) { fw = 70 * k; h2 = im.height * (fw / im.width); } P.image(im, fx, cyL - h2 / 2, fw, h2, 0.9); fx += fw + gapF; });
    } else if (opts.cediaImg) {
      var ch = ((opts.cediaImg.width / opts.cediaImg.height) < 3 ? 13 : 9) * k, cwd = ch * (opts.cediaImg.width / opts.cediaImg.height);
      P.image(opts.cediaImg, W - m - cwd, cyL - ch / 2, cwd, ch, 0.92);
    } else {
      P.trackedRight('CEDIA MEMBER', W - m, cyL - 3 * k, 6 * k, F.r, COL.INFO, 1.2 * k);
    }
    if (opts.centreLogoImg) {
      var mlh = 10 * k, mlw = opts.centreLogoImg.width * (mlh / opts.centreLogoImg.height);
      if (mlw > 95 * k) { mlw = 95 * k; mlh = opts.centreLogoImg.height * (mlw / opts.centreLogoImg.width); }
      P.image(opts.centreLogoImg, (W - mlw) / 2, cyL - mlh / 2, mlw, mlh, 0.92);
    }
  }

  // ── COVER — dark hero cover, identical anatomy to the seating proposal ─────
  // opts: { hero, fadeImg, eyebrow, title, subtitle, info:[[LABEL,value]×3],
  //         centreLogoImg, cediaImg }
  function cover(P, F, opts) {
    opts = opts || {};
    if (opts.layout === 'art' || opts.background === true) return coverArt(P, F, opts);   // v1.7.0 — the house art layout
    P.rect(0, 0, A4.w, A4.h, COL.DARK);
    if (opts.hero) {
      var iw = opts.hero.width, ih = opts.hero.height, s = Math.max(A4.w / iw, A4.h / ih);
      var dw = iw * s, dh = ih * s;
      P.image(opts.hero, (A4.w - dw) / 2, 0, dw, dh, 1);
      var fTop = A4.h * (opts.airy ? 0.58 : 0.66), fH = A4.h * (opts.airy ? 0.26 : 0.22);
      if (opts.fadeImg) P.image(opts.fadeImg, 0, fTop, A4.w, fH, 1);
      else P.fadeDown(0, fTop, A4.w, fH, COL.DARK, 1, 56);
      P.rect(0, fTop + fH - 1, A4.w, A4.h - (fTop + fH) + 1, COL.DARK, 1);
    }
    // inset frame — CONSISTENT inset on all four sides; content sits inside it
    P.rectB(M * 0.62, M * 0.62, A4.w - M * 1.24, A4.h - M * 1.24, COL.GOLD, 0.7, 0.34);

    // airy (v1.1.0, Service Contracts): title block starts higher and the info row sits lower, so a
    // title + subtitle + 3-cell info row breathe instead of stacking tight above the logo strip.
    var ty = opts.airy ? 630 : 672;
    var title = opts.title || 'Proposal';
    var tsize = F.b.widthOfTextAtSize(title, 54) > (A4.w - M * 2) ? 38 : 54;
    // v1.3.1 (2026-10-16, Takeover): a title still too wide at 38 pt wraps onto a second line ABOVE the baseline row instead of
    // running off the frame (Woodbrook "Smart home system rescue & takeover"). Single-line titles render byte-identical.
    var tl = (tsize === 38 && F.b.widthOfTextAtSize(title, 38) > (A4.w - M * 2)) ? wrap(title, F.b, 38, A4.w - M * 2).slice(0, 2) : [title];
    var lift = (tl.length - 1) * 44;
    P.hline(M, M + 26, ty - 20 - lift, COL.GOLD, 1, 0.95);
    P.tracked(String(opts.eyebrow || 'PROPOSAL').toUpperCase(), M + 34, ty - 24 - lift, 8.5, F.r, COL.GOLDL, 3.2);
    tl.forEach(function (ln, i) { P.text(ln, M - 2, ty + (tsize === 38 ? 12 : 0) - lift + i * 44, tsize, F.b, COL.CREAM); });
    if (opts.subtitle) P.text(opts.subtitle, M, ty + (opts.airy ? 68 : 62), 19, F.l, COL.GOLDL);

    var iy = opts.airy ? 766 : 772, cw = (A4.w - M * 2) / 3;
    P.hline(M, A4.w - M, iy - 16, COL.GOLD, 0.5, 0.45);
    (opts.info || []).slice(0, 3).forEach(function (c, i) {
      var x = M + i * cw;
      P.tracked(c[0], x, iy, 7, F.r, COL.INFO, 1.8);
      P.text(c[1] || '—', x, iy + 13, 12.5, F.b, COL.CREAM, { maxWidth: cw - 16 });
    });
    // brandLarge (v1.1.0): mark + wordmark top-left inside the frame instead of the small strip entry
    if (opts.brandLarge) {
      var bc = opts.brandColour || COL.CREAM;   // v1.2.0 — gold on a bright hero, cream on a dark one
      if (opts.topShade) {   // v1.2.0 opt-in: a soft dark band under the mark so it reads on a bright hero — the smooth fade PNG, flipped (no stepped banding)
        var H = A4.h * 0.22;
        if (opts.fadeImg) P.page.drawImage(opts.fadeImg, { x: 0, y: A4.h, width: A4.w, height: -H, opacity: opts.topShade });
        else P.rect(0, 0, A4.w, H * 0.5, COL.DARK, opts.topShade * 0.6);
      }
      P.logo(M, M * 0.62 + 22, 30, bc);
      P.tracked('SONOR', M + 37, M * 0.62 + 28, 18, F.b, bc, 4.2);
    }
    // logo strip — clear band BELOW the frame (heights ≤13, one centreline)
    var cyL = A4.h - 14;
    if (!opts.brandLarge) { P.logo(M, cyL - 6, 12, COL.CREAM); P.tracked('SONOR', M + 18, cyL - 4, 8, F.b, COL.CREAM, 2.4); }
    // footLogos (v1.1.2): CEDIA always first on the left, then the partner / brand marks spaced evenly after it
    if (opts.footLogos && opts.footLogos.length) {
      var fx = M, fh = 12, gapF = 22;
      if (opts.cediaImg) { var ch0 = (opts.cediaImg.width / opts.cediaImg.height) < 3 ? 13 : 9; var cw0 = ch0 * (opts.cediaImg.width / opts.cediaImg.height); P.image(opts.cediaImg, fx, cyL - ch0 / 2, cw0, ch0, 0.92); fx += cw0 + gapF + 6; }
      opts.footLogos.filter(Boolean).forEach(function (im) { var fw = im.width * (fh / im.height), h2 = fh; if (fw > 70) { fw = 70; h2 = im.height * (fw / im.width); } P.image(im, fx, cyL - h2 / 2, fw, h2, 0.9); fx += fw + gapF; });
    }
    if (opts.centreLogoImg) {
      var mlh = 10, mlw = opts.centreLogoImg.width * (mlh / opts.centreLogoImg.height);
      if (mlw > 95) { mlw = 95; mlh = opts.centreLogoImg.height * (mlw / opts.centreLogoImg.width); }
      P.image(opts.centreLogoImg, (A4.w - mlw) / 2, cyL - mlh / 2, mlw, mlh, 0.92);
    }
    if (opts.footLogos && opts.footLogos.length) { /* CEDIA already drawn at the left of the strip */ }
    else if (opts.cediaImg) {
      var ch = (opts.cediaImg.width / opts.cediaImg.height) < 3 ? 13 : 9;
      var cwd = ch * (opts.cediaImg.width / opts.cediaImg.height);
      P.image(opts.cediaImg, A4.w - M - cwd, cyL - ch / 2, cwd, ch, 0.92);
    } else {
      P.trackedRight('CEDIA MEMBER', A4.w - M, cyL - 3, 6, F.r, COL.INFO, 1.2);
    }
  }

  // ── REAR PAGE (v1.3.0) — the full contact block, once, on a charcoal closing page. opts: { tagline, labels:{new,service,phone,web},
  //    email_new, email_service, phone, web, company, cediaImg, markColour }. Every client document ends with this (sonor-platform §43).
  function rearPage(P, F, opts) {
    opts = opts || {};
    P.rect(0, 0, A4.w, A4.h, COL.DARK2);
    var bc = opts.markColour || COL.CREAM;
    P.logo(M, M * 0.62 + 22, 30, bc);
    P.tracked('SONOR', M + 37, M * 0.62 + 28, 18, F.b, bc, 4.2);
    var ty = 372;
    P.text(opts.tagline || 'Smart homes, beautifully done.', M, ty, 22, F.l, COL.GOLDL);
    P.hline(M, A4.w - M, ty + 62, COL.GOLD, 0.5, 0.45);
    var L = opts.labels || {}, cw = (A4.w - M * 2) / 2, rows = [
      [[L.new || 'NEW PROJECTS & PROPOSALS', opts.email_new || 'projects@sonor.co.uk'], [L.service || 'SERVICE & SUPPORT', opts.email_service || 'service@sonor.co.uk']],
      [[L.phone || 'TELEPHONE', opts.phone || (opts.intl ? '+44 7933 684 000' : '07933 684 000')], [L.web || 'WEB', opts.web || 'sonor.co.uk']]   // v1.5.1 — UK format by default; +44 only on foreign-language proposals (opts.intl)
    ];
    rows.forEach(function (r, ri) { r.forEach(function (c, ci) { var x = M + ci * cw, y = ty + 84 + ri * 46; P.tracked(String(c[0]).toUpperCase(), x, y, 7, F.r, COL.INFO, 1.8); P.text(c[1], x, y + 13, 13, F.b, COL.CREAM); }); });
    P.text(opts.company || 'Sonor Ltd  ·  Chester, England  ·  Trusted by homeowners across the North West & Wales', M, ty + 194, 8.5, F.r, COL.INFO);
    // v1.5.1 (2026-10-22, Bryn): CEDIA member mark bottom RIGHT of the rear page, a proper size
    if (opts.cediaImg) { var ch = (opts.cediaImg.width / opts.cediaImg.height) < 3 ? 34 : 22; var cwd = ch * (opts.cediaImg.width / opts.cediaImg.height); P.image(opts.cediaImg, A4.w - M - cwd, A4.h - 40 - ch, cwd, ch, 0.95); }
    else P.trackedRight('CEDIA MEMBER', A4.w - M, A4.h - 46, 6, F.r, COL.INFO, 1.2);
  }

  // ── labelled spec rows (the p2/p4 pattern: LABEL / bold value / divider) ──
  // rows: [[label, value], …] (null/empty values dropped). Returns bottom y.
  function specRows(P, F, rows, x, top, colW) {
    rows = (rows || []).filter(function (r) { return r && r[1]; });
    var sy = top;
    rows.forEach(function (r, ri) {
      P.tracked(String(r[0]).toUpperCase(), x, sy, 6.5, F.r, COL.MUT, 1.5);
      var lines = wrap(String(r[1]), F.b, 11.5, colW - 12);
      lines.forEach(function (ln, li) { P.text(ln, x, sy + 11 + li * 13.5, 11.5, F.b, COL.INK); });
      sy += 11 + lines.length * 13.5 + 11;
      if (ri < rows.length - 1) P.hline(x, x + colW, sy - 7, COL.LINE, 0.5, 0.7);
    });
    return sy;
  }

  // ── section header on a cream page (eyebrow + big title + optional note) ──
  // v1.0.1 — note wraps to 4 lines max (was 3 — long standards blurbs clipped
  // mid-sentence); returned y always clears the painted lines.
  function sectionHead(P, F, eyebrow, title, note) {
    P.tracked(String(eyebrow || '').toUpperCase(), M, 92, 8.5, F.r, COL.GOLD, 2.6);
    P.text(title || '', M - 1, 106, 26, F.b, COL.INK);
    var y = 148;
    if (note) {
      wrap(note, F.r, 10.5, TW()).slice(0, 4).forEach(function (ln, i) {
        P.text(ln, M, 142 + i * 14, 10.5, F.r, COL.INK2); y = 142 + (i + 1) * 14 + 6;
      });
    }
    return Math.max(y, 156);
  }

  // ── DRAWING SHEET (v1.6.0) ─────────────────────────────────────────────────
  function scaleOf(ptPerMm) { return Math.round((72 / 25.4) / ptPerMm); }
  function scaleBar(P, F, x, top, ptPerMm, totalMm, label) {
    totalMm = totalMm || 1000; var seg = totalMm / 4;
    if (label) P.text(label, x, top - 12, 6.5, F.b, COL.INK2);
    for (var i = 0; i < 4; i++) P.rect(x + i * seg * ptPerMm, top, seg * ptPerMm, 3, i % 2 ? COL.CREAM : COL.INK2);
    P.rectB(x, top, totalMm * ptPerMm, 3, COL.INK2, 0.5);
    [0, 2, 4].forEach(function (k) { var v = k * seg, t = totalMm >= 1000 ? (v / 1000) + '' : Math.round(v) + ''; var w = F.r.widthOfTextAtSize(t, 6); P.text(t, x + v * ptPerMm - w / 2, top + 6, 6, F.r, COL.MUT); });
    P.text(totalMm >= 1000 ? 'metres' : 'mm', x + totalMm * ptPerMm + 8, top - 1, 6, F.r, COL.MUT);
  }
  // o = { drawingNo, title, sub, projectNo, rev, option, dateText, status, pageNo, total, notes: [{ head, lines: [..] | rows: [[k, v]..] }],
  //       legend: [{ label, colour:[r,g,b], dash:[..], w }], legendRight, notesWidth (fraction, landscape) }
  function drawingSheet(P, F, o) {
    o = o || {}; var LAND = A4.w > A4.h, W = A4.w, H = A4.h, safeT = o.safe || function (x) { return x; };
    P.logo(M, 30, 22, COL.GOLD); P.tracked('SONOR', M + 27, 34.5, 14, F.b, COL.INK, 3.6);
    P.tracked(safeT(((o.projectNo ? o.projectNo + '  ·  ' : '') + (o.drawingNo || 'DRAWING')).toUpperCase()), M + 118, 42, 8, F.r, COL.LABEL, 2.4);
    P.trackedRight(safeT(((o.option ? o.option + '  ·  ' : '') + (o.rev || 'R1')).toUpperCase()), W - M, 42, 8, F.r, COL.LABEL, 2.4);
    P.hline(M, W - M, 68, COL.LINE, 0.8);
    P.tracked(safeT((o.drawingNo ? o.drawingNo + '  ·  ' : '') + (o.status || 'DESIGN DEVELOPMENT')), M, 88, 8.5, F.r, COL.GOLD, 2.6);
    P.text(safeT(o.title || ''), M - 1, 100, 24, F.b, COL.INK);
    var subBottom = 128;
    if (o.sub) wrap(safeT(o.sub), F.r, 9.5, Math.min(W - M * 2, 820)).slice(0, 2).forEach(function (ln, i) { P.text(ln, M, 134 + i * 13, 9.5, F.r, COL.INK2); subBottom = 134 + (i + 1) * 13; });
    var top = Math.max(160, subBottom + 14), bottom = H - 76, box, notes;
    if (LAND) { var nx = Math.round(W * (1 - (o.notesWidth || 0.27))); box = { x: M, top: top, w: nx - M - 28, h: bottom - top - 8 }; notes = { x: nx, top: top, w: W - M - nx }; P.vline(nx - 14, top, bottom - 8, COL.LINE, 0.6); }
    else { var bh = Math.round((bottom - top) * 0.62); box = { x: M, top: top, w: W - M * 2, h: bh }; notes = { x: M, top: top + bh + 18, w: W - M * 2 }; P.hline(M, W - M, top + bh + 8, COL.LINE, 0.6); }
    // notes column
    var ny = notes.top, colBottom = bottom - 10, cols = LAND ? 1 : 2, cw = (notes.w - (cols - 1) * 22) / cols, ci = 0, cx = notes.x;
    (o.notes || []).forEach(function (b) {
      if (!b) return;
      var need = 18 + ((b.rows || []).length * 11) + ((b.lines || []).length * 11);
      if (!LAND && ny + Math.min(need, 60) > colBottom && ci < cols - 1) { ci++; cx = notes.x + ci * (cw + 22); ny = notes.top; }
      if (ny > colBottom - 20) return;
      P.tracked(safeT(String(b.head || '').toUpperCase()), cx, ny, 7, F.r, COL.GOLD, 1.8); P.hline(cx, cx + cw, ny + 12, COL.LINE, 0.5);
      ny += 19;
      (b.rows || []).forEach(function (r) { if (ny > colBottom) return; var k = safeT(String(r[0])), v = safeT(String(r[1] == null ? '' : r[1])); P.text(k, cx, ny, 7.2, F.b, COL.INK); var vl = wrap(v, F.r, 7.2, cw * 0.58); vl.slice(0, 2).forEach(function (ln, i) { P.right(ln, cx + cw, ny + i * 9.5, 7.2, F.r, COL.INK2); }); ny += Math.max(1, Math.min(2, vl.length)) * 9.5 + 2.5; });
      (b.lines || []).forEach(function (t) { wrap(safeT(t), F.r, 7.2, cw).forEach(function (ln) { if (ny > colBottom) return; P.text(ln, cx, ny, 7.2, F.r, COL.INK2); ny += 9.6; }); ny += 2.5; });
      ny += 9;
    });
    // legend strip
    var ly = H - 58; P.hline(M, W - M, ly - 10, COL.GOLD, 0.6, 0.6);
    var lx = M; (o.legend || []).forEach(function (it) {
      var c = global.PDFLib.rgb(it.colour[0] / 255, it.colour[1] / 255, it.colour[2] / 255), opt = { start: { x: lx, y: H - ly - 3.5 }, end: { x: lx + 20, y: H - ly - 3.5 }, thickness: it.w || 1.2, color: c }; if (it.dash) opt.dashArray = it.dash; P.page.drawLine(opt);
      var lab = safeT(it.label); P.text(lab, lx + 25, ly, 6.5, F.r, COL.MUT); lx += 25 + F.r.widthOfTextAtSize(lab, 6.5) + 18;
    });
    if (o.legendRight) P.right(safeT(o.legendRight), W - M, ly + 0.5, 6.5, F.r, COL.MUT);
    // foot
    P.tracked(safeT(('NOT FOR CONSTRUCTION  ·  ' + (o.status || 'DESIGN DEVELOPMENT') + '  ·  ' + (o.dateText || '')).toUpperCase()), M, H - 30, 6.5, F.r, COL.INFO, 1.4);
    if (o.pageNo) P.trackedRight(safeT((o.projectNo ? o.projectNo + '  ·  ' : '') + (o.drawingNo ? o.drawingNo + '  ·  ' : '') + 'Page ' + o.pageNo + (o.total ? ' / ' + o.total : '')), W - M, H - 30, 7, F.r, COL.PAGE_NO, 1.2);
    return { box: box, notes: notes, land: LAND };
  }

  global.SonorPdfLuxury = {
    drawingSheet: drawingSheet, scaleBar: scaleBar, scaleOf: scaleOf,
    __version: '1.7.0', sheet: sheet, SHEETS: SHEETS, TW: TW, theme: theme, THEMES: THEMES, footerMode: footerMode, rearPage: rearPage,
    A4: A4, M: M, COL: COL, HOUSE: HOUSE, WA: WA,
    col: col, hexRgb: hexRgb, fadePngDataUrl: fadePngDataUrl,
    fetchBytes: fetchBytes, loadImage: loadImage,
    mk: mk, wrap: wrap, money: money, mm: mm,
    makeFonts: makeFonts, pageHead: pageHead, pageFoot: pageFoot,
    cover: cover, coverArt: coverArt, loadCoverArt: loadCoverArt, artTwinUrl: artTwinUrl, isLandscape: isLandscape, specRows: specRows, sectionHead: sectionHead
  };
})(window);
