/* sonor-pdf-pack.js — ONE pack engine for the back-end apps' working PDFs (v1.1.0, 2026-11-01, root master → data/)
   v1.1.0 (2026-11-01, cover art set — Bryn: "use the file list and review notes in 027, then ingest … and check the actual A3/A4 cover
   overlays and crops"): the cover is the house ART layout (sonor-pdf-luxury 1.7.0 cover({ layout: 'art' })) — <heroFile> on a portrait
   pack, <heroFile minus .jpg>-landscape.jpg on a landscape pack (twin fallback), full bleed, no fade, text in the clean zone; the
   subtitle wraps to two lines in the zone instead of being clipped to one.
   Bryn 2026-11-01: "make all exports work in the best pdf version, dont redo everything only ones that havent been updated
   for a while fix this across all apps". The legacy jsPDF / window.print exports (Tender, Inventory, Follow-Up call sheet,
   Accounts Advisor, Hub Board) move onto the shared pdf-lib chrome through this ONE engine instead of five hand-rolled
   table painters. Same anatomy as LED Calc / Network Map (sonor-platform §41 / §49):
     · SonorPdfLuxury (data/sonor-pdf-luxury.js) in theme('neutral') + footerMode('minimal') — white sheet, page-number footer,
       Service Contracts cover, rear contact page with the CEDIA mark bottom-right, UK phone format.
     · PAPER: A4 / A3 × portrait / landscape. Landscape lays out on the A3-landscape canvas (1190.55 × 841.89) and is scaled
       1/√2 onto A4; portrait lays out on A4 (595.28 × 841.89) and is scaled √2 onto A3 — so the chrome's absolute y always
       lands and an A4 and an A3 copy are identical. Proper pages, never 2-up.
     · FLOW: sections are pre-paginated before anything is painted (every page knows its number). A section that fits the rest
       of the page stays there; one that fits a page but not the rest starts a fresh page (a short table never splits); a long
       one flows on with the table head repeated and a "(continued)" line.
     · Tables: neutral grey, gold-ruled heads, service colour only as a thin strip on a group row.
     · The pack dialog (dialog()) is the LED Calc one — ticks by tier, presets, paper + orientation, dark theme, remembered.
   No maths here: every number arrives already formatted by the app (paint exactly what the app shows).

   API  SonorPdfPack.ready(base) · build(opts, fn(pk)) → Uint8Array · dialog(opts) · download(bytes, name) · safe(s)
        pk.section(eyebrow, title, note, {label, newPage}) → S;  S.table(cols, rows, {after}) · S.para(textOrRuns, {size, colour})
        S.bullets(items) · S.tiles(tiles, {per}) · S.kv(pairs, {cols}) · S.custom(h, draw(P, y)) · S.gap(h)
        pk.cover(opts) · pk.rear(opts) · pk.page(draw(P, no, total)) · pk.F · pk.L · pk.W · pk.H · pk.M · pk.CW · pk.LAND · pk.COL
   cols: [{ h, w (share), a: 'r'|'c', f: 'b', size, mut, max (lines) }]
   rows: [cell…] | { cells:[…], flag, total } | { group: 'label', colour:[r,g,b], note } | { sub: 'text' }
   cell: 'text' | { t, c: 'mut'|'ok'|'bad'|'amber'|'gold'|'sonor'|'orig'|[r,g,b], b: true, dot: [r,g,b] } | { box: true } (an empty tick box)
*/
(function (global) {
  'use strict';
  var VERSION = '1.1.0';
  var PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  var FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

  function selfDir() {
    try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^/]*$/, ''); } catch (e) {}
    try { var arr = document.getElementsByTagName('script'); for (var i = arr.length - 1; i >= 0; i--) { if (/sonor-pdf-pack\.js/.test(arr[i].src)) return arr[i].src.replace(/[^/]*$/, ''); } } catch (e) {}
    return 'data/';
  }
  var BASE = selfDir();
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('could not load ' + src)); }; document.head.appendChild(s); }); }
  async function ready(base) {
    base = base || BASE;
    if (!global.PDFLib) await loadScript(PDFLIB);
    if (!global.fontkit) { try { await loadScript(FONTKIT); } catch (e) { /* Helvetica fallback */ } }
    if (!global.SonorPdfTheme) { try { await loadScript(base + 'sonor-pdf-theme.js'); } catch (e) {} }
    if (!global.SonorPdfLuxury) await loadScript(base + 'sonor-pdf-luxury.js');
  }

  // Gilroy (ligatures off, luxury 1.5.2) + the Helvetica fallback are both Latin-1 safe: map the rest, drop emoji
  var MAP = { '→': '>', '←': '<', '↔': '<->', '⟶': '>', '⇒': '>', '≤': '<=', '≥': '>=', '×': 'x', '−': '-', '•': '·', '✓': 'Y', '✔': 'Y', '✕': '-', '✗': '-', '✘': '-', '★': '*', '↳': '>', '²': '2', '³': '3', 'Ω': 'ohm', '√': 'sqrt', '≈': '~', '€': 'EUR ', 'Δ': 'delta ', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ' };
  function safe(s) { return String(s == null ? '' : s).replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF–—‘’“”…]/g, function (c) { return MAP[c] != null ? MAP[c] : ''; }).replace(/[ \t]{2,}/g, ' '); }

  function download(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/pdf' }), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = String(name || 'Sonor.pdf').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' '); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }

  async function build(o, fn) {
    o = o || {};
    await ready(o.base);
    var PL = global.PDFLib, L = global.SonorPdfLuxury;
    var LAND = (o.orient || 'portrait') === 'landscape', paper = o.paper === 'A3' ? 'A3' : 'A4';
    var CAN = LAND ? L.SHEETS['A3-landscape'] : L.SHEETS.A4;
    var SCALE = LAND ? (paper === 'A4' ? Math.SQRT1_2 : 1) : (paper === 'A3' ? Math.SQRT2 : 1);
    var prevSheet = L.sheet(), prevTheme = L.theme();
    L.sheet({ w: CAN.w, h: CAN.h }); L.theme('neutral'); L.footerMode('minimal', safe(o.project || ''));
    try {
      var W = CAN.w, H = CAN.h, M = L.M, COL = L.COL, CW = W - M * 2, base = o.base || BASE;
      var doc = await PL.PDFDocument.create();
      var F = await L.makeFonts(doc, base);
      var hero = null, cedia = null, fade = null;
      try { hero = await (L.loadCoverArt ? L.loadCoverArt(doc, base + (o.heroFile || 'contract-hero.jpg'), LAND) : L.loadImage(doc, base + (o.heroFile || 'contract-hero.jpg'))); } catch (e) {}   // v1.1.0 — portrait / landscape twin by the pack's orientation
      try { cedia = await L.loadImage(doc, base + 'cedia-member-stacked.png'); } catch (e) {}
      try { var fu = L.fadePngDataUrl(); if (fu) fade = await doc.embedPng(fu); } catch (e) {}

      var K = o.typeScale || 1;
      var TS = (LAND ? 9.4 : 7.9) * K, LH = (LAND ? 12.4 : 10.4) * K, HEAD_H = LAND ? 21 : 18, PAD = 4;
      var TOP = 92, BOTTOM = H - 60, GAP = LAND ? 26 : 20;
      var C = { mut: COL.MUT, ok: [44, 122, 82], bad: [176, 64, 40], amber: [196, 120, 30], gold: COL.GDEEP, sonor: [107, 74, 138], orig: COL.INK, ink: COL.INK, ink2: COL.INK2 };
      function colOf(c, dflt) { if (!c) return dflt || COL.INK; if (Array.isArray(c)) return c; return C[c] || dflt || COL.INK; }
      function T(P, s, x, top, size, font, c) { P.text(safe(s), x, top, size, font || F.r, c || COL.INK); }
      function wrapS(s, font, size, w) {
        var out = []; safe(s).split('\n').forEach(function (para) { var ls = L.wrap(para, font, size, w); if (!ls.length) ls = ['']; ls.forEach(function (ln) {   // hard-break a single word wider than the cell
          while (font.widthOfTextAtSize(ln, size) > w && ln.length > 1) { var k = ln.length; while (k > 1 && font.widthOfTextAtSize(ln.slice(0, k), size) > w) k--; out.push(ln.slice(0, k)); ln = ln.slice(k); }
          out.push(ln); }); });
        return out;
      }
      function clip(lines, max, font, size, w) { if (!max || lines.length <= max) return lines; var keep = lines.slice(0, max), last = keep[max - 1] + '…'; while (last.length > 1 && font.widthOfTextAtSize(last, size) > w) last = last.slice(0, -2) + '…'; keep[max - 1] = last; return keep; }
      // rich text: runs [{t, b}] → lines of segments
      function runsOf(x) { if (Array.isArray(x)) return x; return [{ t: String(x == null ? '' : x) }]; }
      function richLines(runs, size, width) {
        var lines = [], cur = [], curW = 0, sp = F.r.widthOfTextAtSize(' ', size);
        function flush() { lines.push(cur); cur = []; curW = 0; }
        runsOf(runs).forEach(function (r) {
          var font = r.b ? F.b : F.r, parts = safe(r.t).split('\n');
          parts.forEach(function (part, pi) {
            if (pi > 0) flush();
            part.split(/\s+/).forEach(function (w) {
              if (!w) return; var ww = font.widthOfTextAtSize(w, size), add = (cur.length ? sp : 0) + ww;
              if (curW + add > width && cur.length) { flush(); add = ww; }
              cur.push({ t: w, font: font, c: r.c, gap: cur.length ? sp : 0 }); curW += add;
            });
          });
        });
        if (cur.length || !lines.length) flush();
        return lines;
      }
      function drawRich(P, line, x, top, size, dflt) { var cx = x; line.forEach(function (s) { cx += s.gap; P.text(s.t, cx, top, size, s.font, colOf(s.c, dflt || COL.INK2)); cx += s.font.widthOfTextAtSize(s.t, size); }); }

      // ── sections → atoms (each atom: { h, draw(P, y), keepNext, headRef, title, label }) ──
      var sections = [], covers = [], rears = [], extra = [];
      function colsFor(cols, x0, width) { var tot = cols.reduce(function (a, c) { return a + (c.w || 1); }, 0), x = x0; return cols.map(function (c) { var w = width * (c.w || 1) / tot, r = Object.assign({}, c, { x: x, wpx: w }); x += w; return r; }); }
      function cellOf(v) { if (v != null && typeof v === 'object' && !Array.isArray(v)) return v; return { t: v == null ? '' : String(v) }; }
      function rowCells(r) { return Array.isArray(r) ? r : (r.cells || []); }

      function Section(eyebrow, title, note, opt) {
        opt = opt || {};
        var S = { atoms: [], newPage: !!opt.newPage, label: safe(opt.label || title || eyebrow || '').toUpperCase(), minLead: opt.minLead || 4 };
        var titleSize = LAND ? 20 : 16.5, noteSize = LAND ? 10 : 9, noteW = Math.min(CW, LAND ? 820 : CW);
        var noteLines = note ? wrapS(note, F.r, noteSize, noteW).slice(0, 6) : [];
        var hh = 14 + titleSize + 6 + (noteLines.length ? noteLines.length * (noteSize + 3.6) + 6 : 0) + 6;
        if (eyebrow || title) S.atoms.push({ h: hh, keepNext: true, label: S.label, draw: function (P, y) {
          if (eyebrow) P.tracked(safe(eyebrow).toUpperCase(), M, y, LAND ? 8.5 : 7.6, F.r, COL.GOLD, 2.4);
          if (title) T(P, title, M - 0.5, y + 13, titleSize, F.b, COL.INK);
          noteLines.forEach(function (ln, i) { T(P, ln, M, y + 14 + titleSize + 6 + i * (noteSize + 3.6), noteSize, F.r, COL.INK2); });
        } });
        S.table = function (cols, rows, to) {
          to = to || {};
          var x0 = to.x || M, width = to.width || CW, CC = colsFor(cols, x0, width), x1 = x0 + width;
          var ts = to.size || TS, lh = ts * (LH / TS);
          function cellLines(c, cell) { var font = (cell.b || c.f === 'b') ? F.b : F.r, sz = c.size ? c.size * K : ts; var avail = c.wpx - PAD * 2 - (cell.dot ? 8 : 0); return { font: font, sz: sz, lines: clip(wrapS(cell.t, font, sz, avail), c.max || to.max || 8, font, sz, avail) }; }
          var head = { h: HEAD_H, head: true, keepNext: true, label: S.label, draw: function (P, y) {
            CC.forEach(function (c) { var t = safe(c.h || '').toUpperCase(), hs = LAND ? 7.2 : 6.1; if (c.a === 'r') P.trackedRight(t, c.x + c.wpx - PAD, y + 5, hs, F.r, COL.MUT, 1.1); else if (c.a === 'c') P.center(t, c.x + c.wpx / 2, y + 5, hs, F.r, COL.MUT, 1.1); else P.tracked(t, c.x + PAD, y + 5, hs, F.r, COL.MUT, 1.1); });
            P.hline(x0, x1, y + HEAD_H - 3, COL.GOLD, 0.7, 0.9);
          } };
          if (cols.some(function (c) { return c.h; })) S.atoms.push(head); else head = null;
          var list = rows && rows.length ? rows : [[{ t: to.empty || 'Nothing recorded', c: 'mut' }]];
          list.forEach(function (r, ri) {
            var atom;
            if (r && r.group != null) {
              var gh = (LAND ? 24 : 20) + (r.note ? (LAND ? 11 : 9.5) : 0);
              atom = { h: gh, keepNext: true, draw: function (P, y) { P.rect(x0, y + 4, 2.6, gh - 8, r.colour || COL.GOLD); P.tracked(safe(r.group).toUpperCase(), x0 + 9, y + 7, LAND ? 8.2 : 6.9, F.b, COL.INK, 1.5); if (r.right) P.right(safe(r.right), x1 - PAD, y + 7, LAND ? 8.2 : 6.9, F.r, COL.MUT); if (r.note) T(P, r.note, x0 + 9, y + 7 + (LAND ? 12 : 10), LAND ? 7.6 : 6.6, F.r, COL.MUT); P.hline(x0, x1, y + gh, COL.LINE, 0.5); } };
            } else if (r && r.sub != null) {
              var sz = ts - 0.6, sl = clip(wrapS('> ' + r.sub, F.r, sz, width - 22 - PAD), 4, F.r, sz, width - 22 - PAD), sh = sl.length * (lh - 0.8) + 5;
              atom = { h: sh, draw: function (P, y) { P.rect(x0, y, width, sh, [247, 247, 246]); sl.forEach(function (ln, i) { T(P, ln, x0 + 18, y + 2.5 + i * (lh - 0.8), sz, F.r, COL.MUT); }); P.hline(x0, x1, y + sh, COL.LINE, 0.3, 0.7); } };
            } else {
              var cells = rowCells(r).map(cellOf), meas = CC.map(function (c, i) { return cellLines(c, cells[i] || { t: '' }); });
              if (cells.length === 1 && CC.length > 1) { var span = Object.assign({}, CC[0], { wpx: width }); meas = [cellLines(span, cells[0])]; }
              var nl = meas.reduce(function (a, m) { return Math.max(a, m.lines.length); }, 1), rh = Math.max(15, nl * lh + 5), tot = r && r.total;
              atom = { h: rh, draw: function (P, y) {
                if (tot) { P.rect(x0, y, width, rh, [243, 242, 239]); P.hline(x0, x1, y, COL.INK, 0.7); }
                meas.forEach(function (m, i) {
                  var c = meas.length === 1 && CC.length > 1 ? Object.assign({}, CC[0], { wpx: width }) : CC[i], cell = cells[i] || {};
                  var colr = colOf(cell.c, (c.mut ? COL.MUT : (r.flag ? C.amber : COL.INK)));
                  var tx = c.x + PAD + (cell.dot ? 8 : 0);
                  if (cell.dot) P.dot(c.x + PAD + 2.6, y + 3 + m.sz * 0.55, 2.6, colOf(cell.dot));
                  if (cell.box) { var bs = m.sz + 1.5; P.rectB(c.a === 'c' ? c.x + (c.wpx - bs) / 2 : c.x + PAD, y + 2.5, bs, bs, COL.INK, 0.8); return; }   // a tick box for a paper checklist
                  m.lines.forEach(function (ln, li) { var ty = y + 3 + li * lh; if (c.a === 'r') P.right(ln, c.x + c.wpx - PAD, ty, m.sz, m.font, colr); else if (c.a === 'c') P.center(ln, c.x + c.wpx / 2, ty, m.sz, m.font, colr, 0); else P.text(ln, tx, ty, m.sz, m.font, colr); });
                });
                P.hline(x0, x1, y + rh, COL.LINE, 0.4, 0.85);
              } };
            }
            if (head) { atom.headRef = head; atom.title = title; }
            atom.label = S.label; S.atoms.push(atom);
          });
          if (to.after) S.para(to.after, { size: (LAND ? 8.4 : 7.4), colour: COL.MUT, gapBefore: 6 });
          return S;
        };
        S.para = function (text, po) {
          po = po || {}; var sz = (po.size || (LAND ? 9.6 : 8.4)), w = po.width || Math.min(CW, LAND ? 860 : CW), lines = richLines(text, sz, w), lh2 = sz + 3.8;
          if (po.gapBefore) S.atoms.push({ h: po.gapBefore, draw: function () {}, label: S.label });
          lines.forEach(function (ln, i) { S.atoms.push({ h: lh2 + (i === lines.length - 1 ? (po.after == null ? 5 : po.after) : 0), keepNext: (i === 0 && lines.length > 1) || (!!po.keepNext && i === lines.length - 1), label: S.label, draw: function (P, y) { drawRich(P, ln, M + (po.indent || 0), y, sz, po.colour || COL.INK2); } }); });
          return S;
        };
        S.bullets = function (items, bo) {
          bo = bo || {}; var sz = bo.size || (LAND ? 9.4 : 8.2), w = Math.min(CW, LAND ? 860 : CW) - 14, lh2 = sz + 3.6;
          (items || []).forEach(function (it) {
            var lines = richLines(it, sz, w), bh = lines.length * lh2 + 3;
            S.atoms.push({ h: bh, label: S.label, draw: function (P, y) { P.rect(M + 1, y + sz * 0.42, 3.2, 1.2, COL.GOLD); lines.forEach(function (ln, i) { drawRich(P, ln, M + 14, y + i * lh2, sz, COL.INK2); }); } });
          });
          return S;
        };
        S.tiles = function (tiles, to) {
          to = to || {}; var per = to.per || (LAND ? 6 : 3), g = 10, tw = (CW - (per - 1) * g) / per, vs = LAND ? 18 : 15;
          for (var i = 0; i < tiles.length; i += per) {
            (function (row) {
              var subs = row.map(function (t) { return t.sub ? clip(wrapS(t.sub, F.r, LAND ? 7.6 : 6.8, tw - 2), to.subLines || 3, F.r, LAND ? 7.6 : 6.8, tw - 2) : []; });
              var vls = row.map(function (t) { return clip(wrapS(t.value, F.b, vs, tw - 2), 2, F.b, vs, tw - 2); });
              var maxV = vls.reduce(function (a, s) { return Math.max(a, s.length); }, 1);
              var maxS = subs.reduce(function (a, s) { return Math.max(a, s.length); }, 0), th = 12 + maxV * (vs + 3) + 14 + maxS * ((LAND ? 7.6 : 6.8) + 3) + 12;
              S.atoms.push({ h: th, label: S.label, draw: function (P, y) {
                row.forEach(function (t, k) { var x = M + k * (tw + g); P.rect(x, y, tw, 2.2, colOf(t.colour, COL.GOLD)); vls[k].forEach(function (ln, li) { T(P, ln, x, y + 10 + li * (vs + 3), vs, F.b, COL.INK); });
                  var ly = y + 10 + maxV * (vs + 3) + 2; P.tracked(safe(t.label || '').toUpperCase(), x, ly, LAND ? 6.6 : 5.9, F.r, COL.MUT, 1.3);
                  subs[k].forEach(function (ln, li) { T(P, ln, x, ly + 12 + li * ((LAND ? 7.6 : 6.8) + 3), LAND ? 7.6 : 6.8, F.r, COL.INK2); }); });
              } });
            })(tiles.slice(i, i + per));
          }
          return S;
        };
        S.kv = function (pairs, ko) {
          ko = ko || {}; var cols = ko.cols || (LAND ? 3 : 2), g = 18, cw = (CW - (cols - 1) * g) / cols, vs = LAND ? 10 : 8.8;
          pairs = (pairs || []).filter(function (p) { return p && p[1] != null && String(p[1]) !== ''; });
          for (var i = 0; i < pairs.length; i += cols) {
            (function (row) {
              var vl = row.map(function (p) { return clip(wrapS(p[1], F.b, vs, cw - 4), ko.max || 4, F.b, vs, cw - 4); }), n = vl.reduce(function (a, l) { return Math.max(a, l.length); }, 1), kh = 11 + n * (vs + 3) + 9;
              S.atoms.push({ h: kh, label: S.label, draw: function (P, y) { row.forEach(function (p, k) { var x = M + k * (cw + g); P.tracked(safe(p[0]).toUpperCase(), x, y, LAND ? 6.6 : 5.9, F.r, COL.MUT, 1.3); vl[k].forEach(function (ln, li) { T(P, ln, x, y + 10 + li * (vs + 3), vs, F.b, COL.INK); }); P.hline(x, x + cw, y + kh - 4, COL.LINE, 0.4, 0.8); }); } });
            })(pairs.slice(i, i + cols));
          }
          return S;
        };
        S.custom = function (h, draw, co) { S.atoms.push({ h: h, draw: draw, label: S.label, keepNext: !!(co && co.keepNext) }); return S; };
        S.gap = function (h) { S.atoms.push({ h: h || 10, draw: function () {}, label: S.label }); return S; };
        sections.push(S);
        return S;
      }

      var pk = {
        PL: PL, L: L, F: F, W: W, H: H, M: M, CW: CW, LAND: LAND, COL: COL, C: C, TS: TS, LH: LH, TOP: TOP, BOTTOM: BOTTOM, paper: paper, orient: LAND ? 'landscape' : 'portrait',
        hero: hero, cedia: cedia, fade: fade, doc: doc, safe: safe, wrap: wrapS, T: T, colOf: colOf,
        section: function (eyebrow, title, note, opt) { return Section(eyebrow, title, note, opt); },
        cover: function (co) { covers.push(co || {}); },
        rear: function (ro) { rears.push(ro || {}); },
        page: function (draw) { extra.push(draw); }   // a whole custom content page, painted after the flowed pages
      };
      await fn(pk);

      // ── pre-paginate ──
      var pages = [], cur, y;
      function newPage() { cur = []; pages.push(cur); y = TOP; }
      function place(a) { cur.push({ a: a, y: y }); y += a.h; }
      newPage();
      sections.forEach(function (S) {
        var atoms = S.atoms; if (!atoms.length) return;
        var total = atoms.reduce(function (a, x) { return a + x.h; }, 0), CAP = BOTTOM - TOP;
        if (y > TOP) {
          if (S.newPage) newPage();
          else {
            var rem = BOTTOM - (y + GAP);
            if (total > rem) {
              if (total <= CAP) newPage();
              else { var lead = atoms.slice(0, S.minLead).reduce(function (a, x) { return a + x.h; }, 0); if (lead > rem) newPage(); }
            }
            if (y > TOP) y += GAP;
          }
        }
        atoms.forEach(function (a, i) {
          var need = a.h, j = i; while (atoms[j].keepNext && atoms[j + 1]) { j++; need += atoms[j].h; if (need > (BOTTOM - TOP) * 0.5) break; }
          if (y + need > BOTTOM && y > TOP) {
            newPage();
            if (a.headRef && !a.head) {
              var t = a.title; place({ h: 14, label: a.label, draw: function (P, yy) { T(P, (t || '') + '  (continued)', M, yy, LAND ? 8.6 : 7.6, F.b, COL.MUT); } });
              place(a.headRef);
            }
          }
          place(a);
        });
      });
      pages = pages.filter(function (p) { return p.length; });

      // ── paint ──
      var plan = [];
      covers.forEach(function (co) { plan.push(function (P) {
        var sub = co.subtitle ? safe(co.subtitle) : null;   // v1.1.0 — the art cover wraps the subtitle (two lines) inside the clean zone
        L.cover(P, F, { layout: 'art', hero: co.noHero ? null : hero, eyebrow: safe(co.eyebrow || ''), title: safe(co.title || ''), subtitle: sub,
          info: (co.info || []).map(function (r) { return [safe(r[0]).toUpperCase(), safe(r[1] || '-')]; }), brandLarge: true, cediaImg: cedia });
      }); });
      var docLabel = safe(o.docLabel || '').toUpperCase();
      pages.forEach(function (pg) { plan.push(function (P, no) {
        var lab = (pg[0] && pg[0].a.label) || docLabel;
        L.pageHead(P, F, lab, null, 0, lab, { brand: 'large' });
        if (docLabel && lab !== docLabel) P.trackedRight(docLabel, W - M, 42, LAND ? 7.4 : 6.6, F.r, COL.LABEL, 1.8);
        pg.forEach(function (it) { it.a.draw(P, it.y); });
        L.pageFoot(P, F, { pageNo: no });
      }); });
      extra.forEach(function (draw) { plan.push(function (P, no, total) { draw(P, no, total); L.pageFoot(P, F, { pageNo: no }); }); });
      rears.forEach(function (ro) { plan.push(function (P) { L.rearPage(P, F, Object.assign({ cediaImg: cedia }, ro)); }); });

      var total = plan.length;
      plan.forEach(function (fnP, i) {
        var page = doc.addPage([W * SCALE, H * SCALE]);
        if (SCALE !== 1) page.pushOperators(PL.pushGraphicsState(), PL.scale(SCALE, SCALE));
        var P = L.mk(page, doc); P.rect(0, 0, W, H, COL.CREAM);
        fnP(P, i + 1, total);
        if (SCALE !== 1) page.pushOperators(PL.popGraphicsState());
      });
      doc.setTitle(safe((o.title || 'Sonor') + (o.project ? ' - ' + o.project : '') + ' (' + paper + ' ' + (LAND ? 'landscape' : 'portrait') + ')'));
      doc.setAuthor('Sonor Ltd'); doc.setCreator('Sonor ' + (o.app || 'app') + ' · sonor-pdf-pack ' + VERSION);
      var bytes = await doc.save();
      bytes.pageCount = total;
      return bytes;
    } finally { L.sheet(prevSheet); L.theme(prevTheme); }
  }

  // ── the pack dialog (LED Calc anatomy: tiers of ticks, presets, paper + orientation; dark theme, grey edges) ──
  function css() {
    if (document.getElementById('sonor-pdf-pack-css')) return;
    var s = document.createElement('style'); s.id = 'sonor-pdf-pack-css';
    s.textContent = '#xpModal .xp-back{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000}' +
      '#xpModal .xp{position:fixed;z-index:9001;top:50%;left:50%;transform:translate(-50%,-50%);width:min(600px,92vw);max-height:86vh;overflow:auto;background:var(--svc-surface,var(--card,var(--card-bg,#1f1f21)));color:var(--text,#e7e7e7);border:1px solid var(--border-strong,var(--border,#3a3a3d));border-radius:14px;padding:18px 20px;box-shadow:0 24px 64px rgba(0,0,0,.6);font-family:inherit}' +
      '#xpModal h3{margin:0;font-size:15px}#xpModal .xp-top{display:flex;justify-content:space-between;align-items:center;gap:10px}' +
      '#xpModal .xp-sub{font-size:12px;color:var(--text-muted,#9a9a9a);margin:6px 0 10px}' +
      '#xpModal .xp-tier{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted,#9a9a9a);margin:12px 0 4px}' +
      '#xpModal .xp-row{display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;cursor:pointer}#xpModal .xp-row.locked{opacity:.6}#xpModal .xp-row input{accent-color:var(--svc-accent,var(--accent,#ad9978))}' +
      '#xpModal .xp-line{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}' +
      '#xpModal .xp-btn{font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid var(--border-strong,var(--border,#3a3a3d));background:transparent;color:inherit;cursor:pointer}' +
      '#xpModal .xp-btn:hover{border-color:var(--svc-accent,var(--accent,#ad9978))}' +
      '#xpModal .xp-btn.pri{background:var(--svc-accent,var(--accent,#ad9978));border-color:transparent;color:var(--cta-text,#111);font-weight:600;padding:7px 16px}' +
      '#xpModal .xp-btn[disabled]{opacity:.55;cursor:progress}#xpModal .xp-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px}#xpModal .xp-note{font-size:12px;color:var(--text-muted,#9a9a9a)}';
    document.head.appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function prefs(o) {
    var d = { sections: null, paper: (o.defaults && o.defaults.paper) || 'A4', orient: (o.defaults && o.defaults.orient) || 'portrait' };
    try { if (o.lsKey) Object.assign(d, JSON.parse(localStorage.getItem(o.lsKey) || '{}')); } catch (e) {}
    var keys = (o.sections || []).map(function (s) { return s.key; });
    if (o.preset && o.presets && o.presets[o.preset]) d.sections = o.presets[o.preset].slice();
    if (!Array.isArray(d.sections)) d.sections = (o.sections || []).filter(function (s) { return s.on !== false || s.locked; }).map(function (s) { return s.key; });
    else (o.sections || []).forEach(function (s) { if (d.seen && d.seen.indexOf(s.key) < 0 && s.on !== false && d.sections.indexOf(s.key) < 0) d.sections.push(s.key); });   // a section new since last time comes in ticked
    d.seen = keys; return d;
  }
  function dialog(o) {
    css(); var old = document.getElementById('xpModal'); if (old) old.remove();
    var P = prefs(o), tiers = [];
    (o.sections || []).forEach(function (s) { var t = s.tier || 'Sections'; if (tiers.indexOf(t) < 0) tiers.push(t); });
    var h = '<div class="xp-back" data-x="close"></div><div class="xp" role="dialog" aria-label="' + esc(o.title || 'Export PDF') + '"><div class="xp-top"><h3>' + esc(o.title || 'Export PDF') + '</h3><button class="xp-btn" data-x="close" title="Close">✕</button></div>' +
      '<p class="xp-sub">' + esc(o.intro || 'One pack — tick what goes in.') + '</p>' +
      (o.presets ? '<div class="xp-line" style="margin-bottom:6px">' + Object.keys(o.presets).map(function (k) { return '<button class="xp-btn" data-preset="' + esc(k) + '">' + esc((o.presetLabels || {})[k] || k) + '</button>'; }).join('') + '</div>' : '') +
      tiers.map(function (t) { return '<div class="xp-tier">' + esc(t) + '</div>' + o.sections.filter(function (s) { return (s.tier || 'Sections') === t; }).map(function (s) { return '<label class="xp-row' + (s.locked ? ' locked' : '') + '"><input type="checkbox" data-sec="' + esc(s.key) + '"' + (s.locked || P.sections.indexOf(s.key) >= 0 ? ' checked' : '') + (s.locked ? ' disabled' : '') + '> <span>' + esc(s.label) + '</span></label>'; }).join(''); }).join('') +
      (o.paper === false ? '' : '<div class="xp-tier">Paper</div><div class="xp-line">' + ['A4', 'A3'].map(function (p) { return '<label class="xp-row"><input type="radio" name="xpPaper" value="' + p + '"' + (P.paper === p ? ' checked' : '') + '> ' + p + '</label>'; }).join('') + '<span style="width:14px"></span>' + [['landscape', 'Landscape'], ['portrait', 'Portrait']].map(function (x) { return '<label class="xp-row"><input type="radio" name="xpOrient" value="' + x[0] + '"' + (P.orient === x[0] ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join('') + '</div>') +
      '<div class="xp-foot"><span class="xp-note" id="xpNote"></span><button class="xp-btn pri" data-x="go">' + esc(o.goLabel || 'Export PDF') + '</button></div></div>';
    var el = document.createElement('div'); el.id = 'xpModal'; el.innerHTML = h; document.body.appendChild(el);
    function q(sel) { return el.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }
    function close() { el.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-x],[data-preset]'); if (!t) return;
      if (t.dataset.x === 'close') return close();
      if (t.dataset.preset) { var keys = o.presets[t.dataset.preset]; qa('input[data-sec]').forEach(function (i) { if (!i.disabled) i.checked = keys.indexOf(i.dataset.sec) >= 0; }); return; }
      if (t.dataset.x === 'go') {
        var pr = { sections: qa('input[data-sec]').filter(function (i) { return i.checked; }).map(function (i) { return i.dataset.sec; }), paper: (q('input[name=xpPaper]:checked') || {}).value || P.paper, orient: (q('input[name=xpOrient]:checked') || {}).value || P.orient, seen: P.seen };
        try { if (o.lsKey) localStorage.setItem(o.lsKey, JSON.stringify(pr)); } catch (e) {}
        t.disabled = true; q('#xpNote').textContent = 'Building…';
        Promise.resolve().then(function () { return o.onGo(pr); }).then(function (res) { close(); return res; }).catch(function (e) { console.error('[sonor-pdf-pack]', e); t.disabled = false; q('#xpNote').textContent = 'Failed: ' + (e && e.message || e); });
      }
    });
    return el;
  }

  global.SonorPdfPack = { VERSION: VERSION, ready: ready, build: build, dialog: dialog, download: download, safe: safe, prefs: prefs };
})(typeof window !== 'undefined' ? window : this);
