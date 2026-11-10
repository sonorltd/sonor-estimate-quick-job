/**
 * sonor-led-drawings.js — CANONICAL MASTER (workspace root → data/ in every app via sync-everything, like sonor-led-engineering.js)
 * v1.1.0 · 2026-11-01 — Bryn: "drawing could be better like it is from other apps". The drawings now speak the same language as the
 *   Engineering rack / DIN builder and the Stretched Fabric design pack: device boxes with a service band, ports and terminal labels;
 *   orthogonal wires with junction dots and cable labels (2C 1.5 mm² · 10 m, DMX, CH1–4); the head-end board as a dashed enclosure with
 *   its tab; the board elevation at true scale — DIN rail with isolator / MCB / dimmed-feed faces, slotted trunking between rows,
 *   filled device tiles with their L × W, the LV terminal rail with V+ / V− pairs per run, dimension strings with ticks — and the
 *   PDF draws them on Sonor drawing sheets (drawing no., notes column, legend strip, scale, NOT FOR CONSTRUCTION foot) from the
 *   shared luxury chrome (sonor-pdf-luxury.js ≥ 1.6.0 drawingSheet).
 * v1.0.0 · 2026-11-01 — Bryn: "can you include a schematic for the wiring and an elevation of head end decoders and psu's? … use our
 *   current best methods preferably shared from other apps so there are no monoliths and apps dont fall out of sync".
 *
 * ONE drawing source for LED wiring, built from SonorLedEng.project() (engine ≥ 1.5.0). Each drawing is a plain DISPLAY LIST in points
 * and the same list is painted two ways, so the screen and the PDF can never disagree:
 *   SonorLedDrawings.schematic(eng, { width, maxHeight, legend })  → { sheets: [{ w, h, title, items, groups }] }
 *   SonorLedDrawings.elevation(board, { width, maxHeight })        → { w, h, items, mm, kPerMm, schedule, board }
 *   SonorLedDrawings.legend()                                       → [{ key, label, colour }] (for a notes column)
 *   SonorLedDrawings.toSvg(sheet, { theme: 'dark'|'paper' })       → SVG string (apps)
 *   SonorLedDrawings.toPdf(page, sheet, { x, top, scale, H, fonts, theme, safe }) → vectors on a pdf-lib page (packs)
 * The board is packed on the kit's slot grid (SonorSlotGrid.autoLayout — the same first-fit as the Engineering rack and DIN panels)
 * when the kit is on the page; a built-in first-fit is the offline fallback. Sizes are Library dimensions (metadata.led.dims_mm);
 * nominal sizes are drawn dashed and say so. No DOM, no DB — node-tested (tests/led-drawings.test.mjs).
 */
(function (global) {
  'use strict';
  var VERSION = '1.2.2';   // 1.2.2 2026-11-01 — field cables read their real cores (engine 1.7.0 cable.label: 5C for an RGBW decoder output, 3C pixel)
  // was 1.2.1:   // 1.2.1 2026-11-01 — ply board drawn neutral (no cream / brown tint), Sonor PDF paper law
  function num(x, d) { var n = Number(x); return isFinite(n) ? n : (d || 0); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function pad3(n) { return ('00' + n).slice(-3); }
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }
  function prodShort(label) { return String(label || '').replace(/^Tagra\s+/i, '').replace(/Constant Voltage\s*/i, 'CV ').replace(/LED Driver\s*·?\s*/i, '').replace(/\s*·\s*IP20/i, '').replace(/\s+/g, ' ').trim(); }

  // wire classes — colour by what the conductor carries
  var WIRE = {
    mains:  { label: '230 V unswitched',        dark: '#c99a6b', paper: [140, 92, 50],  w: 1.3 },
    dimmed: { label: '230 V dimmed (triac)',    dark: '#e3a63a', paper: [205, 130, 20], w: 1.3, dash: [5, 2.5] },
    lv:     { label: '24 V DC feed (2-core)',   dark: '#e2705f', paper: [190, 58, 44],  w: 1.5 },
    pwm:    { label: 'Decoder output (PWM)',    dark: '#e58fb0', paper: [186, 74, 120], w: 1.1 },
    dmx:    { label: 'DMX512 (screened, daisy-chain)', dark: '#5ea8ea', paper: [44, 112, 190], w: 1.2, dash: [3.5, 2] },
    data:   { label: 'Ethernet / pixel data (Cat6)', dark: '#ad8ce0', paper: [118, 80, 160], w: 1.1, dash: [1.4, 1.8] }
  };
  // device roles — the service band on each box / tile (lighting = service 04 yellow; mains brown; DMX blue; data purple)
  var ROLE = {
    supply:  { dark: '#c99a6b', paper: [140, 92, 50] },
    dimmed:  { dark: '#e3a63a', paper: [205, 130, 20] },
    psu:     { dark: '#9aa3ae', paper: [96, 104, 116] },
    decoder: { dark: '#5ea8ea', paper: [44, 112, 190] },
    node:    { dark: '#ad8ce0', paper: [118, 80, 160] },
    pixel:   { dark: '#ad8ce0', paper: [118, 80, 160] },
    run:     { dark: '#f5d05c', paper: [196, 160, 40] }
  };
  var THEME = {
    dark:  { bg: '#16191e', text: '#eef0f3', muted: '#98a1ac', faint: '#59606a', line: '#3a4049', box: '#22262d', boxLine: '#56606b', encl: '#7d8792', tab: '#2b3038',
             board: '#262b32', boardLine: '#6b7480', ply: '#24272c', plyEdge: '#6b7480', grain: '#2e3238', trunk: '#3a4049', trunkSlot: '#4b525c', rail: '#9aa3ae', mcb: '#d9dde2', mcbInk: '#16191e', term: '#c9ced4', knock: '#16191e', dim: '#98a1ac' },
    paper: { bg: null, text: [24, 24, 24], muted: [112, 112, 112], faint: [190, 190, 190], line: [214, 214, 214], box: [255, 255, 255], boxLine: [70, 70, 70], encl: [120, 120, 120], tab: [244, 243, 240],
             board: [250, 249, 246], boardLine: [90, 90, 90], ply: [250, 250, 249], plyEdge: [90, 90, 90], grain: [232, 232, 230], /* 1.2.1 — no cream (Bryn: "get rid of the cream background of panels") */ trunk: [226, 226, 226], trunkSlot: [196, 196, 196], rail: [150, 150, 150], mcb: [255, 255, 255], mcbInk: [24, 24, 24], term: [236, 236, 236], knock: [251, 250, 247], dim: [70, 70, 70] }
  };
  var NOMINAL = { driver: function (w) { var t = [[30, 158, 46], [60, 160, 58], [75, 170, 45], [100, 170, 45], [150, 179, 63], [200, 195, 67], [240, 210, 72], [320, 215, 78]]; for (var i = 0; i < t.length; i++) if (w <= t[i][0]) return [t[i][1], t[i][2]]; return [230, 80]; },
    decoder: [175, 46], node: [90, 62], pixel: [120, 70], din: [72, 90] };

  // ── display list ──
  function DL() { var it = []; return {
    items: it,
    rect: function (x, y, w, h, o) { it.push({ t: 'rect', x: x, y: y, w: w, h: h, o: o || {} }); },
    line: function (pts, wire, o) { it.push({ t: 'line', pts: pts, wire: wire || null, o: o || {} }); },
    text: function (x, y, s, o) { it.push({ t: 'text', x: x, y: y, s: String(s == null ? '' : s), o: o || {} }); },
    dot: function (x, y, wire, o) { it.push({ t: 'dot', x: x, y: y, wire: wire, o: o || {} }); },
    port: function (x, y, wire) { it.push({ t: 'port', x: x, y: y, wire: wire }); },
    dim: function (x1, y1, x2, y2, s, o) { it.push({ t: 'dim', x1: x1, y1: y1, x2: x2, y2: y2, s: s, o: o || {} }); },
    tag: function (x, y, s, wire, o) { it.push({ t: 'tag', x: x, y: y, s: String(s), wire: wire, o: o || {} }); },   // a cable label knocked out of its wire
    open: function (cls, id, data) { it.push({ t: 'open', cls: cls, id: id, data: data || {} }); },   // 1.2.0 — SVG groups (hover / hot wires); the PDF ignores them
    close: function () { it.push({ t: 'close' }); }
  }; }
  // a device box: white face, thin ink outline, the role band down the left, title / sub / third line
  function box(d, x, y, w, h, role, title, sub, third, o) {
    o = o || {};
    d.rect(x, y, w, h, { box: true, dash: o.dash });
    d.rect(x, y, 3.2, h, { band: role });
    d.text(x + 9, y + 5, short(title, Math.floor((w - 14) / 4.05)), { size: 7.6, bold: true });
    if (sub) d.text(x + 9, y + 16, short(sub, Math.floor((w - 14) / 3.25)), { size: 6.2, muted: true });
    if (third && h > 30) d.text(x + 9, y + 26, short(third, Math.floor((w - 14) / 3.25)), { size: 6, muted: true });
  }

  // ══ WIRING SCHEMATIC — a SYSTEM SHEET in the Engineering style (1.2.0) ══
  // Bryn: "can you show the schematic in the led calc app, similar to engineering". Columns left → right SUPPLY · PSU / DRIVER · DMX NODE ·
  // DECODER / CONTROLLER · LED STRIP RUN, every device a card like the Engineering sheet block (service accent, ID chip, make / model,
  // service tag, input ports left / outputs right with connector chips, IN | note | OUT footer, location under), one card per real
  // device (a decoder serves its zone's runs, a radial its PSUs, a node its universes), orthogonal wires in lanes that never overlap,
  // coloured by what they carry, with the cable ID at both ends. Head ends are dashed board regions; local drivers sit in their own.
  var CW = { sup: 138, psu: 152, node: 142, ctl: 164, run: 218 }, CG = { hdr: 27, row: 12, foot: 11, loc: 11, gap: 12, lane: 5, edge: 34 };
  var COLS = ['sup', 'psu', 'node', 'ctl', 'run'], COLTITLE = { sup: 'SUPPLY', psu: 'PSU / DRIVER', node: 'DMX NODE', ctl: 'DECODER / CONTROLLER', run: 'LED STRIP RUN  ·  in the room' };
  function tw(s, size) { return String(s).length * size * 0.58; }
  function cardH(c) { return CG.hdr + Math.max(1, c.left.length, c.right.length) * CG.row + CG.foot; }
  function schematic(eng, opts) {
    opts = opts || {}; var maxH = num(opts.maxHeight, 0) || 1e9;
    var el = eng.electrical || (global.SonorLedEng && global.SonorLedEng.electrical(eng)) || { boards: [], spurs: [] };
    var spurOf = {}; (el.spurs || []).forEach(function (s) { spurOf[s.run] = s; });
    var heads = eng.headEnds || [], allNodes = (eng.controllers && eng.controllers.nodes || []).filter(function (n) { return n.runs; });
    var nodeById = {}; allNodes.forEach(function (n) { nodeById[n.id] = n; });
    var boardOf = {}; (el.boards || []).forEach(function (b) { boardOf[b.id] = b; });
    function ctlKey(e) { return e.decoder ? 'd:' + e.decoder.zone : (e.pixel && e.pixel.output ? 'p:' + String(e.pixel.output).split('-')[0] : '~' + e.id); }
    var groups = [];
    heads.forEach(function (h) { var rs = (eng.runs || []).filter(function (e) { return e.location === 'head-end' && e.headEnd === h.id; }); if (rs.length) groups.push({ key: h.id, head: h, board: boardOf[h.id] || null, runs: rs, title: h.id + '  ·  ' + h.label + (h.location ? '  ·  ' + h.location : ''), nodes: allNodes.filter(function (n) { return (n.headEnd || (heads[0] && heads[0].id)) === h.id; }) }); });
    var local = (eng.runs || []).filter(function (e) { return e.location !== 'head-end'; });
    if (local.length) groups.push({ key: 'local', head: null, runs: local, title: 'LOCAL DRIVERS  ·  beside each strip, accessible', nodes: [] });
    // clusters: the runs one control device serves sit together
    groups.forEach(function (g) {
      g.runs = g.runs.slice().sort(function (a, b) { return ctlKey(a).localeCompare(ctlKey(b)) || String(a.floor).localeCompare(String(b.floor)) || String(a.id).localeCompare(String(b.id)); });
      g.clusters = []; var last = null;
      g.runs.forEach(function (e) { var k = ctlKey(e); if (!last || last.key !== k || k.charAt(0) === '~') { last = { key: k, runs: [] }; g.clusters.push(last); } last.runs.push(e); });
    });
    // ── device cards (geometry-free) ──
    var seq = { psu: 0, dec: 0, px: 0, fcu: 0 };
    function two(n) { return ('0' + n).slice(-2); }
    function runCard(e) {
      var triac = e.control === 'triac', inL = e.decoder ? { label: 'PWM IN', chip: (e.dmx && e.dmx.channels > 1 ? e.dmx.channels + ' ch' : '1 ch'), wire: 'pwm' } : (e.pixel ? { label: 'DATA + ' + (e.strip.volts || 5) + ' V', chip: 'SPI', wire: 'data' } : { label: (e.strip.volts || 24) + ' V IN', chip: '+ −', wire: 'lv' });
      var foot = (e.feeds || []).length + ' feed' + ((e.feeds || []).length === 1 ? '' : 's') + (e.cable ? '  ·  ' + (e.cable.label || '2C ' + e.cable.csa + ' mm²') + '  ·  ' + e.cable.length_m + ' m  ·  ' + e.cable.drop_pct + ' %' : '') + (e.dmx && e.dmx.address ? '  ·  U' + e.dmx.universe + ' ' + pad3(e.dmx.address) : '') + (e.pixel && e.pixel.output ? '  ·  ' + e.pixel.output : '');
      return { kind: 'run', role: 'run', id: String(e.id), title: e.strip.label, sub: (e.strip.product && e.strip.product.sku ? e.strip.product.sku + '  ·  ' : '') + r1(e.metres) + ' m  ·  ' + Math.round(e.load_w) + ' W  ·  ' + (e.strip.volts || 24) + ' V', tag: 'LED', left: [inL], right: [], foot: foot, loc: (e.floor ? e.floor + '  ·  ' : '') + (e.room || ''), run: e,
        info: [['Strip', e.strip.label + (e.strip.product && e.strip.product.sku ? ' (' + e.strip.product.sku + ')' : '')], ['Length · load', r1(e.metres) + ' m · ' + Math.round(e.load_w) + ' W'], ['Control', triac ? 'Triac (mains-dimmed PSU)' : (e.controlLabel || e.control)], ['Feeds', (e.feeds || []).length + (e.cable ? ' · ' + (e.cable.label || '2C ' + e.cable.csa + ' mm²') + ' · ' + e.cable.length_m + ' m · ' + e.cable.drop_pct + ' % drop' : '')]].concat(e.dmx && e.dmx.address ? [['DMX', 'U' + e.dmx.universe + ' ' + pad3(e.dmx.address) + (e.dmx.channels > 1 ? '–' + pad3(e.dmx.address + e.dmx.channels - 1) : '') + (e.dmx.node ? ' · ' + e.dmx.node : '')]] : []) };
    }
    function psuCard(e) {
      var dr = e.driver || {}, triac = e.control === 'triac', n = ++seq.psu;
      return { kind: 'psu', role: 'psu', id: 'PSU-' + two(n), title: dr.drivers ? (dr.drivers > 1 ? dr.drivers + ' no. ' : '') + dr.driver_w + ' W ' + (triac ? 'triac' : 'CV') + ' PSU' : 'No driver', sub: dr.product ? prodShort(dr.product.label) : 'generic size — no Library match', tag: 'PSU',
        left: [{ label: triac ? '230 V DIM' : '230 V IN', chip: 'L N E', wire: triac ? 'dimmed' : 'mains' }], right: [{ label: (e.strip.volts || 24) + ' V OUT', chip: '+ −', wire: 'lv' }],
        foot: Math.round(e.input_w || 0) + ' W in  ·  ' + (dr.loaded_pct ? dr.loaded_pct + ' % loaded' : '') + (dr.product && dr.product.mount && dr.product.mount !== 'surface' ? '  ·  ' + dr.product.mount.toUpperCase() : ''), loc: e.location === 'head-end' ? '' : (e.floor ? e.floor + '  ·  ' : '') + (e.room || '') + '  ·  local', run: e, dash: !dr.product,
        info: [['Product', dr.product ? dr.product.label : 'Generic ' + (dr.driver_w || '') + ' W — no Library match'], ['Serves', e.id + ' · ' + (e.room || '')], ['Load', Math.round(e.load_w) + ' W out · ' + Math.round(e.input_w || 0) + ' W in' + (dr.loaded_pct ? ' · ' + dr.loaded_pct + ' %' : '')], ['Mount', (dr.product && dr.product.mount) || 'surface']] };
    }
    function localSupplyCard(e) {
      var sp = spurOf[e.id] || {}, triac = e.control === 'triac', plug = sp.localSupply === 'plug', n = ++seq.fcu;
      return { kind: 'sup', role: triac ? 'dimmed' : 'supply', id: (plug ? 'SKT-' : 'FCU-') + two(n), title: plug ? (triac ? 'Round-pin socket 5 A' : 'Socket 13 A') : (triac ? 'FCU · dimmed live' : 'Fused spur (FCU)'), sub: plug ? (sp.fuse_std === 'circuit' ? 'plug-in · no plug fuse' : 'plug-in · ' + (sp.fuse_a || 3) + ' A plug fuse') : (sp.fuse_a || 3) + ' A fuse  ·  ' + (sp.fuse_std || 'BS 1362'), tag: triac ? 'DIMMED' : 'MAINS',
        left: [], right: [{ label: plug ? 'PLUG' : 'LOAD', chip: 'L N E', wire: triac ? 'dimmed' : 'mains' }], foot: triac ? 'from the dimmer channel' : 'from a lighting radial', loc: (e.floor ? e.floor + '  ·  ' : '') + (e.room || ''), run: e,
        info: [['Supply', sp.supply || (plug ? 'Plug-in socket' : 'Fused connection unit')], ['Fuse', sp.fuse_std === 'circuit' ? 'none — 5 A circuit' : (sp.fuse_a || 3) + ' A (' + (sp.fuse_std || 'BS 1362') + ')'], ['Input', Math.round(sp.input_w || e.input_w || 0) + ' W · ' + (sp.input_a || '') + ' A']] };
    }
    function boardSupplyCards(g, runsHere) {
      var out = [], b = g.board; if (!b) return out; var here = {}; runsHere.forEach(function (e) { here[e.id] = e; });
      (b.circuits || []).forEach(function (c) {
        var rs = (c.drivers || []).filter(function (r) { return here[r]; }); if (!rs.length) return;
        out.push({ kind: 'sup', role: 'supply', id: c.id, title: 'Radial · ' + c.mcb_a + ' A type C', sub: 'unswitched  ·  MCB at the DB  ·  DP isolator on the board', tag: 'MAINS', left: [], right: rs.map(function (r) { return { label: 'TO ' + r, chip: 'L N E', wire: 'mains', run: r }; }),
          foot: Math.round(c.input_w) + ' W  ·  ' + c.input_a + ' A', loc: '', info: [['Circuit', c.id + ' · ' + c.mcb_a + ' A type C MCB at the DB'], ['Feeds', c.drivers.join(', ')], ['Load', Math.round(c.input_w) + ' W · ' + c.input_a + ' A']] });
      });
      (b.dimmedFeeds || []).forEach(function (f) {
        if (!here[f.run]) return;
        out.push({ kind: 'sup', role: 'dimmed', id: f.id, title: 'Dimmed feed', sub: 'lighting control dimmer channel  ·  JB on the board', tag: 'DIMMED', left: [], right: [{ label: 'TO ' + f.run, chip: 'L N E', wire: 'dimmed', run: f.run }], foot: Math.round(f.input_w) + ' W', loc: '', info: [['Feed', f.id + ' · dimmed live from the lighting control'], ['Serves', f.run + ' · ' + (f.room || '')], ['Load', Math.round(f.input_w) + ' W']] });
      });
      return out;
    }
    function ctlCard(cl) {
      var e0 = cl.runs[0];
      if (e0.decoder) {
        var dc = e0.decoder, n = ++seq.dec, chan = 1;
        var right = cl.runs.map(function (e) { var ch = Math.max(1, e.dmx ? e.dmx.channels : 1), lab = dc.qty > 1 ? 'TO ' + e.id : 'CH' + chan + (ch > 1 ? '–' + (chan + ch - 1) : ''); if (dc.qty <= 1) chan += ch; return { label: lab, chip: 'PWM', wire: 'pwm', run: e.id }; });
        var addr = cl.runs.filter(function (e) { return e.dmx && e.dmx.address; }).map(function (e) { return 'U' + e.dmx.universe + ' ' + pad3(e.dmx.address); });
        return { kind: 'ctl', role: 'decoder', id: 'DEC-' + two(n), title: (dc.qty > 1 ? dc.qty + ' no. ' : '') + dc.label.replace(/^Skydance\s+/i, '').replace(/\s+CV.*$/i, '') + (/decoder/i.test(dc.label) ? '' : ' decoder'), sub: (dc.channels ? dc.channels + ' ch × PWM' : 'PWM') + '  ·  DMX in / thru', tag: 'DMX',
          left: [{ label: 'DMX IN', chip: 'RJ45', wire: 'dmx', dmx: true }].concat(cl.runs.map(function (e) { return { label: 'V IN · ' + e.id, chip: '+ −', wire: 'lv', run: e.id }; })), right: right,
          foot: addr.join('  ·  '), loc: String(dc.zone || '').split(' | ').pop().replace(/^[\s·]+/, ''), runs: cl.runs, node: e0.dmx && e0.dmx.node, universe: e0.dmx && e0.dmx.universe,
          info: [['Product', dc.label], ['Zone', String(dc.zone || '').split(' | ').pop().replace(/^[\s·]+/, '')], ['Runs', cl.runs.map(function (e) { return e.id; }).join(', ')], ['DMX', addr.join(' · ') || '—'], ['Mount', dc.mount || 'surface']] };
      }
      if (e0.pixel) {
        var n2 = ++seq.px;
        return { kind: 'ctl', role: 'pixel', id: 'PXC-' + two(n2), title: 'Pixel controller', sub: short(e0.pixel.controller || '', 40), tag: 'DATA',
          left: [{ label: 'LAN · Art-Net', chip: 'RJ45', wire: 'data', lan: true }].concat(cl.runs.map(function (e) { return { label: 'V IN · ' + e.id, chip: '+ −', wire: 'lv', run: e.id }; })),
          right: cl.runs.map(function (e) { return { label: (e.pixel.output || 'OUT').replace(/^PX\d+-/, 'OUT '), chip: 'SPI', wire: 'data', run: e.id }; }), foot: 'LAN from the network switch', loc: '', runs: cl.runs,
          info: [['Product', e0.pixel.controller || 'Pixel controller'], ['Outputs', cl.runs.map(function (e) { return e.pixel.output + ' → ' + e.id; }).join(' · ')]] };
      }
      return null;
    }
    function nodeCard(n) {
      var right = []; for (var u = 1; u <= Math.max(1, n.universes); u++) right.push({ label: 'U' + u, chip: 'DMX', wire: 'dmx', universe: u });
      var prod = n.interface && n.interface.product;
      return { kind: 'node', role: 'node', id: n.id, title: n.label, sub: prod ? prod.label.split(/\s+[—-]\s+/)[0] : 'DMX interface', tag: 'DMX', left: [{ label: 'LAN', chip: 'PoE', wire: 'data', lan: true }], right: right,
        foot: n.universes + ' U  ·  ' + n.channels + ' ch', loc: n.location || '', node: n, info: [['Interface', prod ? prod.label : 'DMX interface (' + ((n.interface && n.interface.system) || '') + ')'], ['Universes · channels', n.universes + ' · ' + n.channels], ['Runs', String(n.runs)], ['Mount', (prod && prod.mount) || 'surface']] };
    }
    // ── pages: a group may break between clusters ──
    function est(cl) { var h = 0; cl.runs.forEach(function (e) { h += cardH({ left: [1], right: [] }) + CG.loc + CG.gap; }); var c = cl.runs[0].decoder || cl.runs[0].pixel ? CG.hdr + (cl.runs.length + 1) * CG.row + CG.foot + CG.loc + CG.gap : 0; return Math.max(h, c); }
    var TOP = 26, TAB = 22, pages = [], cur = null, y = 0;
    function newPage() { cur = { parts: [] }; pages.push(cur); y = TOP; }
    var estAll = TOP + groups.reduce(function (a, g) { return a + TAB + 16 + (g.nodes.length ? g.nodes.length * 60 : 0) + g.clusters.reduce(function (b, c) { return b + est(c); }, 0); }, 0);
    if (estAll <= maxH * 1.3) maxH = 1e9;
    newPage();
    groups.forEach(function (g) {
      var first = true, part = null;
      g.clusters.forEach(function (cl) {
        var need = (part ? 0 : TAB + 16 + (first && g.nodes.length ? g.nodes.length * 60 : 0)) + est(cl);
        if (y + need > maxH && cur.parts.length && (part ? part.clusters.length : true)) { newPage(); part = null; }
        if (!part) { part = { g: g, clusters: [], cont: !first, withNodes: first }; cur.parts.push(part); y += TAB + 16 + (first && g.nodes.length ? g.nodes.length * 60 : 0); first = false; }
        part.clusters.push(cl); y += est(cl);
      });
    });
    var sheets = pages.map(function (pg, pi) { return layoutPage(pg, pi, pages.length); });
    return { sheets: sheets.length && sheets[0].items.length > 6 ? sheets : [], wires: WIRE };

    function layoutPage(pg, pi, np) {
      var cards = [], wires = [], regions = [];
      var yc = TOP;
      pg.parts.forEach(function (part) {
        var g = part.g, top = yc, runsHere = [];
        part.clusters.forEach(function (cl) { runsHere = runsHere.concat(cl.runs); });
        yc += TAB + 10;
        // node band (top of a head end)
        var nodes = part.withNodes ? g.nodes.map(nodeCard) : [];
        nodes.forEach(function (nc) { nc.col = 'node'; nc.y = yc; nc.h = cardH(nc); cards.push(nc); yc += nc.h + CG.loc + CG.gap; });
        // clusters
        var psuOf = {}, runOf = {}, decs = [];
        part.clusters.forEach(function (cl) {
          var ctop = yc, rc = cl.runs.map(runCard), ctl = ctlCard(cl);
          var hRuns = rc.reduce(function (a, c) { return a + cardH(c) + CG.loc + CG.gap; }, 0), hCtl = ctl ? cardH(ctl) + CG.loc + CG.gap : 0, H = Math.max(hRuns, hCtl);
          var ry = ctop + (H - hRuns) / 2;
          rc.forEach(function (c) { c.col = 'run'; c.y = ry; c.h = cardH(c); cards.push(c); runOf[c.run.id] = c; ry += c.h + CG.loc + CG.gap; });
          cl.runs.forEach(function (e) {
            var rcard = runOf[e.id], p = psuCard(e); p.col = 'psu'; p.h = cardH(p); p.y = rcard.y + (rcard.h - p.h) / 2; cards.push(p); psuOf[e.id] = p;
            if (e.location !== 'head-end') { var s = localSupplyCard(e); s.col = 'sup'; s.h = cardH(s); s.y = p.y + CG.hdr - CG.hdr; cards.push(s); s.y = p.y + (p.h - s.h) / 2; regions.push({ local: true, run: e.id, s: s, p: p }); wires.push({ cls: s.role === 'dimmed' ? 'dimmed' : 'mains', id: e.id + '-M', from: [s, 'r', 0], to: [p, 'l', 0] }); }
          });
          if (ctl) { ctl.col = 'ctl'; ctl.h = cardH(ctl); ctl.y = ctop + (H - (ctl.h + CG.loc + CG.gap)) / 2; cards.push(ctl); decs.push(ctl);
            cl.runs.forEach(function (e, k) {
              wires.push({ cls: 'lv', id: e.id + '-V', from: [psuOf[e.id], 'r', 0], to: [ctl, 'l', k + 1] });
              wires.push({ cls: ctl.role === 'pixel' ? 'data' : 'pwm', id: e.id + (ctl.role === 'pixel' ? '-D' : '-P'), from: [ctl, 'r', k], to: [runOf[e.id], 'l', 0], label: ctl.right[k].label });
            });
          } else cl.runs.forEach(function (e) { wires.push({ cls: 'lv', id: e.id + '-V', from: [psuOf[e.id], 'r', 0], to: [runOf[e.id], 'l', 0], spec: e.cable ? (e.strip.volts || 24) + ' V  ·  ' + (e.cable.label || '2C ' + e.cable.csa + ' mm²') + '  ·  ' + e.cable.length_m + ' m' : null, note: e.control === 'triac' ? 'mains-dimmed at the PSU — no decoder' : '' }); });
          yc = ctop + H;
        });
        // head-end supply cards — at the mean of their PSUs, pushed apart
        if (g.head) {
          var sc = boardSupplyCards(g, runsHere), floor = top + TAB + 10;
          sc.forEach(function (c) { c.col = 'sup'; c.h = cardH(c); var ys = c.right.map(function (p) { var ps = psuOf[p.run]; return ps ? ps.y + CG.hdr + CG.row / 2 : 0; }); c.want = ys.reduce(function (a, v) { return a + v; }, 0) / Math.max(1, ys.length) - CG.hdr - (c.right.length * CG.row) / 2; });
          sc.sort(function (a, b) { return a.want - b.want; });
          sc.forEach(function (c) { c.y = Math.max(c.want, floor); floor = c.y + c.h + CG.loc + CG.gap; cards.push(c); c.right.forEach(function (p, i) { wires.push({ cls: p.wire, id: p.run + '-M', from: [c, 'r', i], to: [psuOf[p.run], 'l', 0] }); }); });
          yc = Math.max(yc, floor);
        }
        // DMX buses: node universe → its decoders (or a stub when the node is on another board)
        var bus = {};
        decs.filter(function (d0) { return d0.role === 'decoder'; }).forEach(function (d0) { var k = (d0.node || '?') + '|' + (d0.universe || 1); (bus[k] = bus[k] || { node: d0.node, u: d0.universe || 1, decs: [] }).decs.push(d0); });
        Object.keys(bus).forEach(function (k) {
          var b = bus[k], nc = nodes.filter(function (c) { return c.id === b.node; })[0] || null;
          wires.push({ cls: 'dmx', id: (b.node || 'DMX') + '-U' + b.u, bus: true, from: nc ? [nc, 'r', Math.max(0, b.u - 1)] : null, stub: nc ? null : 'from ' + (b.node || 'DMX node') + (nodeById[b.node] && nodeById[b.node].label ? ' · ' + nodeById[b.node].label : '') + ' (other board)', tos: b.decs.map(function (d0) { return [d0, 'l', 0]; }) });
        });
        yc += 8;
        regions.push({ g: g, top: top, bot: yc, cont: part.cont });
        yc += 18;
      });
      // ── channels + lanes ──
      function portY(ref) { var c = ref[0]; return c.y + CG.hdr + ref[2] * CG.row + CG.row / 2; }
      var CH = {}; ['sup', 'psu', 'node', 'ctl'].forEach(function (c, i) { CH[c] = { right: COLS[i + 1], lanes: [] }; });
      function chOf(fromCol) { return CH[fromCol]; }
      function laneFor(ch, y1, y2, dir, w) { var lo = Math.min(y1, y2) - 3, hi = Math.max(y1, y2) + 3; for (var i = 0; ; i++) { var L = ch.lanes[i] = ch.lanes[i] || []; if (!L.some(function (iv) { return lo < iv[1] && iv[0] < hi; })) { L.push([lo, hi]); return i; } } }
      // the channel a jog uses: the gap just LEFT of the target column (sup→psu jogs in sup|psu, psu→ctl in node|ctl …)
      var jogs = [];
      wires.forEach(function (w) {
        if (w.bus) { var ys = w.tos.map(portY); if (w.from) ys.push(portY(w.from)); w.y1 = Math.min.apply(null, ys) - (w.from ? 0 : 14); w.y2 = Math.max.apply(null, ys); w.ch = CH.node; jogs.push(w); return; }
        w.ya = portY(w.from); w.yb = portY(w.to); if (Math.abs(w.ya - w.yb) < 0.5) return;
        var tcol = w.to[0].col, ci = COLS.indexOf(tcol); w.ch = CH[COLS[ci - 1]]; jogs.push(w);
      });
      // order: buses first (they own the node|ctl gap), then down-jogs by source y, up-jogs by source y desc (no crossings within a fan)
      jogs.sort(function (a, b) { if (!!b.bus - !!a.bus) return !!b.bus - !!a.bus; var da = a.bus ? 0 : (a.ya < a.yb ? 0 : 1), db = b.bus ? 0 : (b.ya < b.yb ? 0 : 1); if (da !== db) return da - db; return da === 0 ? a.ya - b.ya : b.ya - a.ya; });
      jogs.forEach(function (w) { w.lane = w.bus ? laneFor(w.ch, w.y1, w.y2) : laneFor(w.ch, w.ya, w.yb); });
      // column x: each gap = cable-ID room + lanes + room
      var X = {}, x = 0; COLS.forEach(function (c, i) { X[c] = x; x += CW[c]; if (CH[c]) { CH[c].x0 = x; x += Math.max(70, CG.edge * 2 + CH[c].lanes.length * CG.lane); CH[c].x1 = x; } });
      var W = x;
      function laneX(w) { return w.bus ? w.ch.x0 + CG.edge - 6 + w.lane * CG.lane : w.ch.x1 - CG.edge + 6 - w.lane * CG.lane; }
      cards.forEach(function (c) { c.x = X[c.col]; c.w = CW[c.col]; });
      // ── paint ──
      var d = DL(), H = yc;
      COLS.forEach(function (c) { d.text(X[c], 4, COLTITLE[c], { size: 6.6, muted: true, track: 1.4 }); });
      d.line([[0, 16], [W, 16]], null, { rule: true });
      regions.forEach(function (r) {
        if (r.local) { var lx = r.s.x - 6, ly = Math.min(r.s.y, r.p.y) - 5, lw = r.p.x + r.p.w + 6 - lx, lh = Math.max(r.s.y + r.s.h, r.p.y + r.p.h) - ly + 5; d.rect(lx, ly, lw, lh, { encl: true, light: true }); return; }
        var g = r.g, ttl = g.title.toUpperCase() + (r.cont ? '  (CONT.)' : '');
        if (g.head) { var ew = X.ctl + CW.ctl + 10 + 6; d.rect(-6, r.top, ew, r.bot - r.top, { encl: true }); d.rect(-6, r.top, Math.min(ew, 26 + ttl.length * 4.6), 18, { tab: true }); d.text(2, r.top + 5, ttl, { size: 6.8, bold: true, track: 0.9 }); d.text(ew - 10, r.top + 5.5, 'HEAD-END BOARD  ·  18 mm ply', { size: 5.8, muted: true, track: 1.2, anchor: 'end' }); }
        else d.text(0, r.top + 5, ttl, { size: 6.8, bold: true, track: 0.9 });
      });
      // wires (under the cards)
      var wmeta = [];
      wires.forEach(function (w) {
        d.open('ld-wire', w.id, { cls: w.cls, from: w.bus ? (w.from ? w.from[0].id : '') : w.from[0].id, to: w.bus ? w.tos.map(function (t) { return t[0].id; }).join(',') : w.to[0].id });
        if (w.bus) {
          var bx = laneX(w);
          if (w.from) { var fy = portY(w.from), fx = w.from[0].x + w.from[0].w; d.line([[fx, fy], [bx, fy]], 'dmx'); d.text(fx + 5, fy - 7, w.id, { size: 4.8, wire: 'dmx' }); }
          else { d.text(bx + 3, w.y1 - 3, w.stub, { size: 4.8, wire: 'dmx' }); }
          d.line([[bx, w.y1], [bx, w.y2]], 'dmx');
          w.tos.forEach(function (t) { var ty = portY(t), tx = t[0].x; d.line([[bx, ty], [tx, ty]], 'dmx'); d.dot(bx, ty, 'dmx', { r: 1.7 }); d.text(tx - 5, ty - 7, w.id, { size: 4.8, wire: 'dmx', anchor: 'end' }); });
          wmeta.push({ id: w.id, cls: 'dmx', from: w.from ? w.from[0].id : null, to: w.tos.map(function (t) { return t[0].id; }) });
        } else {
          var a = w.from[0], b = w.to[0], x1 = a.x + a.w, x2 = b.x, y1 = w.ya, y2 = w.yb;
          var pts = Math.abs(y1 - y2) < 0.5 ? [[x1, y1], [x2, y2]] : (function () { var lx = laneX(w); return [[x1, y1], [lx, y1], [lx, y2], [x2, y2]]; })();
          d.line(pts, w.cls);
          d.text(x1 + 5, y1 - 7, w.id, { size: 4.8, wire: w.cls });
          d.text(x2 - 5, y2 - 7, w.id, { size: 4.8, wire: w.cls, anchor: 'end' });
          if (w.spec && pts.length === 2) { var mx = (X.node + X.ctl + CW.ctl) / 2; d.tag(mx, y1, w.spec, w.cls); if (w.note) d.text(mx, y1 - 13, w.note, { size: 5.2, muted: true, anchor: 'middle' }); }
          wmeta.push({ id: w.id, cls: w.cls, from: a.id, to: [b.id] });
        }
        d.close();
      });
      // cards
      var blocks = [];
      cards.forEach(function (c) { paintCard(d, c); blocks.push({ id: c.id, kind: c.kind, role: c.role, x: c.x, y: c.y, w: c.w, h: c.h, title: c.title, sub: c.sub, loc: c.loc, info: c.info || [] }); });
      if (opts.legend !== false) { var lx2 = 0, ly2 = H + 4; Object.keys(WIRE).forEach(function (k) { d.line([[lx2, ly2 + 4], [lx2 + 22, ly2 + 4]], k); d.text(lx2 + 27, ly2, WIRE[k].label, { size: 6.2, muted: true }); lx2 += 34 + WIRE[k].label.length * 3.4 + 12; }); H = ly2 + 14; }
      return { w: W, h: H, items: d.items, blocks: blocks, wires: wmeta, title: 'Wiring schematic' + (np > 1 ? ' — sheet ' + (pi + 1) + ' of ' + np : ''), groups: pg.parts.map(function (p) { return p.g.key; }) };
    }
  }
  // one Engineering-style device card
  function paintCard(d, c) {
    var x = c.x, y = c.y, w = c.w, h = c.h;
    d.open('ld-el', c.id, { kind: c.kind, role: c.role });
    d.rect(x, y, w, h, { card: true });
    d.rect(x + 0.4, y + 0.4, w - 0.8, CG.hdr - 0.4, { head: true });
    d.rect(x, y, w, 2.4, { band: c.role });
    var idw = tw(c.id, 5.6) + 7; d.rect(x + 6, y + 6, idw, 9, { idchip: c.role }); d.text(x + 6 + idw / 2, y + 7.6, c.id, { size: 5.6, bold: true, anchor: 'middle', role: c.role, mono: true });
    var tgw = tw(c.tag, 4.6) + 7; d.rect(x + w - 6 - tgw, y + 6.5, tgw, 8, { tagfill: c.role }); d.text(x + w - 6 - tgw / 2, y + 8.1, c.tag, { size: 4.6, bold: true, anchor: 'middle', inv: true, track: 0.4 });
    var room = w - 12 - idw - 4 - tgw - 4; d.text(x + 6 + idw + 4, y + 6.6, short(c.title, Math.floor(room / (7 * 0.55))), { size: 7, bold: true });
    d.text(x + 6, y + 17.6, short(c.sub, Math.floor((w - 12) / (5.2 * 0.5))), { size: 5.2, muted: true });
    d.line([[x, y + CG.hdr], [x + w, y + CG.hdr]], null, { rule: true });
    function row(p, i, side) {
      var py = y + CG.hdr + i * CG.row + CG.row / 2, lw = tw(p.label, 5.4), cw = tw(p.chip, 4.6) + 6;
      if (side === 'l') { d.text(x + 7, py - 3.2, p.label, { size: 5.4 }); d.rect(x + 7 + lw + 4, py - 3.8, cw, 7.6, { chip: p.wire }); d.text(x + 7 + lw + 4 + cw / 2, py - 2.4, p.chip, { size: 4.6, anchor: 'middle', wire: p.wire }); }
      else { d.text(x + w - 7, py - 3.2, p.label, { size: 5.4, anchor: 'end' }); d.rect(x + w - 7 - lw - 4 - cw, py - 3.8, cw, 7.6, { chip: p.wire }); d.text(x + w - 7 - lw - 4 - cw / 2, py - 2.4, p.chip, { size: 4.6, anchor: 'middle', wire: p.wire }); }
      if (p.lan) d.dot(side === 'l' ? x : x + w, py, null, { r: 1.7, hollow: true }); else d.port(side === 'l' ? x : x + w, py, p.wire);
    }
    c.left.forEach(function (p, i) { row(p, i, 'l'); }); c.right.forEach(function (p, i) { row(p, i, 'r'); });
    var fy = y + h - CG.foot; d.line([[x, fy], [x + w, fy]], null, { rule: true });
    d.text(x + 6, fy + 3, c.left.length ? 'IN' : '', { size: 4.4, muted: true, track: 0.5 });
    d.text(x + w / 2, fy + 3, short(c.foot || '', Math.floor((w - 40) / (4.8 * 0.5))), { size: 4.8, muted: true, anchor: 'middle' });
    d.text(x + w - 6, fy + 3, c.right.length ? 'OUT' : '', { size: 4.4, muted: true, anchor: 'end', track: 0.5 });
    d.rect(x, y, w, h, { outline: true, dash: c.dash });
    if (c.loc) d.text(x, y + h + 2.4, short(c.loc, Math.floor(w / (5.2 * 0.55))), { size: 5.2, bold: true, muted: true });
    d.close();
  }

  // ══ HEAD-END BOARD ELEVATION (true scale) ══
  // 1.2.0 — an LED head end is an 18 mm ply backboard with the PSUs, decoders and nodes SCREWED TO ITS FACE (Bryn: "led panels are not
  // necessarily din rail, they are psus and decoders mounted on the surface of 18mm ply usually. only make it din if a device has that
  // property"). Each item's Library mount decides: surface → screwed to the ply (two fixings), din → on a DIN rail drawn only when some item
  // needs one (as long as they need), rack → in a rack, listed, never drawn here. The radials are protected at the DB (C10 MCBs there);
  // each lands on a surface DP isolator on the board, each dimmed feed in a junction box.
  function elevation(board, opts) {
    opts = opts || {}; var targetW = num(opts.width, 760);
    var items = [], mountOf = function (m) { m = String(m || '').toLowerCase(); return /^din/.test(m) ? 'din' : (/^(rack|shelf)/.test(m) ? 'rack' : 'surface'); };
    (board.drivers || []).forEach(function (dv) { var dm = dv.dims_mm && dv.dims_mm.length >= 2 ? dv.dims_mm : null, f = dm || NOMINAL.driver(dv.size_w); for (var q = 0; q < (dv.qty || 1); q++) items.push({ id: 'psu-' + dv.run + '-' + q, role: 'psu', label: dv.size_w + ' W ' + (dv.control === 'triac' ? 'triac' : 'CV') + ' PSU', sub: dv.run + (dv.circuit ? '  ·  ' + dv.circuit : ''), mm: [num(f[0]), num(f[1])], nominal: !dm, product: dv.label, run: dv.run, band: dv.control === 'triac' ? 'dimmed' : 'supply', mount: mountOf(dv.mount) }); });
    (board.decoders || []).forEach(function (dc, i) { var din = mountOf(dc.mount) === 'din', f = dc.dims_mm || (din ? NOMINAL.din : NOMINAL.decoder); for (var q = 0; q < (dc.qty || 1); q++) items.push({ id: 'dec-' + i + '-' + q, role: 'decoder', label: dc.label.replace(/^Skydance\s+/i, '').split(' ')[0] + ' decoder', sub: String(dc.zone || '').split(' | ').pop().replace(/^[\s·]+/, ''), mm: [num(f[0]), num(f[1])], nominal: !dc.dims_mm, product: dc.label, mount: mountOf(dc.mount) }); });
    (board.nodes || []).forEach(function (n, i) { var din = mountOf(n.mount) === 'din', f = n.dims_mm || (din ? NOMINAL.din : NOMINAL.node); items.push({ id: 'node-' + i, role: 'node', label: n.label, sub: n.product || 'DMX node', mm: [num(f[0]), num(f[1])], nominal: !n.dims_mm, product: n.product || 'DMX node', mount: mountOf(n.mount) }); });
    if ((board.pixel || []).length) { var pc = Math.ceil(board.pixel.length / 4), p0 = board.pixel[0] || {}; for (var p = 0; p < pc; p++) items.push({ id: 'px-' + p, role: 'pixel', label: 'Pixel controller', sub: board.pixel.slice(p * 4, p * 4 + 4).map(function (x) { return x.output; }).join(' '), mm: (p0.dims_mm || NOMINAL.pixel).slice(0, 2).map(Number), nominal: !p0.dims_mm, product: p0.controller || 'Pixel controller', mount: mountOf(p0.mount) }); }
    var runs = (board.drivers || []).map(function (dv) { return dv.run; });
    var surf = items.filter(function (i) { return i.mount === 'surface'; }), dinIt = items.filter(function (i) { return i.mount === 'din'; }), racked = items.filter(function (i) { return i.mount === 'rack'; });
    // geometry (mm) — supplies row, DIN row (only if needed), rows of surface kit between slotted trunking, LV terminal strip
    var M = 30, GAP = 22, SUP = 110, DINROW = 110, TRUNK = 40, ROWH = 100, TERM = 110, ACC = 86;
    var sup = (board.circuits || []).map(function (c) { return { id: c.id, kind: 'iso', face: c.id, sub: '20 A DP isolator', note: 'C' + c.mcb_a + ' at the DB' }; })
      .concat((board.dimmedFeeds || []).map(function (f) { return { id: f.id, kind: 'jb', face: f.id, sub: 'dimmed feed JB', note: f.run }; }));
    var maxL = surf.reduce(function (a, i) { return Math.max(a, i.mm[0]); }, 0), supW = sup.length * (ACC + 14) + M * 2, dinW = dinIt.reduce(function (a, i) { return a + i.mm[0] + 2; }, 0) + 40 + M * 2;
    var boardW = Math.max(600, supW, dinW, Math.ceil(((maxL + GAP) * 2 + M * 2) / 50) * 50);
    if (surf.length > 8) boardW = Math.max(boardW, 900); if (surf.length > 14) boardW = Math.max(boardW, 1200);
    boardW = Math.ceil(boardW / 50) * 50;
    var unit = 10, size = Math.floor((boardW - M * 2) / unit);
    var gItems = surf.map(function (i) { return { id: i.id, size: Math.ceil((i.mm[0] + GAP) / unit), label: i.label, weightRank: i.role === 'psu' ? 2 : 1 }; });
    var placed = [], rows = 0;
    if (gItems.length) for (rows = 1; rows < 40; rows++) {
      var grid = { orientation: 'horizontal', rows: rows, size: size, unit: unit };
      placed = (global.SonorSlotGrid && global.SonorSlotGrid.autoLayout) ? global.SonorSlotGrid.autoLayout(grid, gItems) : firstFit(grid, gItems);
      if (!placed.some(function (i) { return i.unplaced; })) break;
    }
    var at = {}; placed.forEach(function (p) { at[p.id] = p; });
    var termNeeded = runs.length * 2 * 6 + 40;
    var termRows = Math.max(1, Math.ceil(termNeeded / (boardW - M * 2)));
    var boardH = Math.ceil((M + SUP + TRUNK + (dinIt.length ? DINROW + TRUNK : 0) + rows * (ROWH + TRUNK) + termRows * TERM + M) / 50) * 50;
    var k = Math.min(targetW / (boardW + 70), opts.maxHeight ? (opts.maxHeight - 40) / (boardH + 40) : 1e9), d = DL(), ox = 0, oy = 6;
    var mm = function (v) { return v * k; }, X = function (v) { return ox + mm(v); }, Y = function (v) { return oy + mm(v); };
    // 18 mm ply backboard — grain, corner fixings
    d.rect(X(0), Y(0), mm(boardW), mm(boardH), { ply: true });
    for (var gy = 37; gy < boardH - 10; gy += 61) d.line([[X(8), Y(gy)], [X(boardW * 0.42), Y(gy + 6)], [X(boardW - 8), Y(gy + 2)]], null, { grain: true });
    [[15, 15], [boardW - 15, 15], [15, boardH - 15], [boardW - 15, boardH - 15]].forEach(function (pp) { d.dot(X(pp[0]), Y(pp[1]), null, { r: Math.max(1.2, mm(5)), hollow: true }); });
    function fix(xm, ym, wmm, hmm) { [[xm + 6, ym + hmm / 2], [xm + wmm - 6, ym + hmm / 2]].forEach(function (pp) { d.dot(X(pp[0]), Y(pp[1]), null, { r: Math.max(0.7, mm(2.2)), screw: true }); }); }
    // incoming supplies — surface accessories
    var sx = M, syTop = M + (SUP - ACC) / 2;
    sup.forEach(function (a) {
      d.rect(X(sx), Y(syTop), mm(ACC), mm(ACC), { acc: a.kind });
      if (a.kind === 'iso') d.rect(X(sx + ACC * 0.36), Y(syTop + ACC * 0.3), mm(ACC * 0.28), mm(ACC * 0.4), { toggle: 'iso' });
      else d.dot(X(sx + ACC / 2), Y(syTop + ACC / 2), null, { r: Math.max(1, mm(ACC * 0.16)), hollow: true });
      d.text(X(sx + ACC / 2), Y(syTop) - 8, a.face, { size: Math.max(5, Math.min(7, mm(ACC) * 0.2)), bold: true, anchor: 'middle' });
      d.text(X(sx + ACC / 2), Y(syTop + ACC) + 1.5, a.note, { size: Math.max(3.8, Math.min(5.2, mm(ACC) * 0.14)), muted: true, anchor: 'middle' });
      sx += ACC + 14;
    });
    d.text(X(sx + 10), Y(M + SUP / 2) - 4, 'Incoming supplies  ·  ' + (board.circuits || []).length + ' radial' + ((board.circuits || []).length === 1 ? '' : 's') + ' on DP isolators (MCBs at the DB)' + (board.dimmedFeeds && board.dimmedFeeds.length ? '  ·  ' + board.dimmedFeeds.length + ' dimmed feed' + (board.dimmedFeeds.length === 1 ? '' : 's') + ' in JBs' : ''), { size: 5.8, muted: true });
    function trunk(ymm) { d.rect(X(M), Y(ymm), mm(boardW - M * 2), mm(TRUNK - 8), { trunk: true }); for (var tx0 = M + 20; tx0 < boardW - M - 10; tx0 += 40) d.rect(X(tx0), Y(ymm + 4), mm(16), mm(TRUNK - 16), { slot: true }); }
    function tile(i, xm, ym) {
      var w = mm(i.mm[0]), h = mm(i.mm[1]);
      d.rect(X(xm), Y(ym), w, h, { tile: i.role, dash: i.nominal });
      d.rect(X(xm), Y(ym), Math.max(2, mm(5)), h, { band: i.band || i.role });
      var ls = Math.min(8.4, Math.max(5.2, h / 3.6)), ss = Math.min(6.6, Math.max(4.6, h / 5));
      d.text(X(xm) + Math.max(4, mm(9)), Y(ym) + 3, short(i.label, Math.floor((w - 8) / (ls * 0.56))), { size: ls, bold: true });
      if (h > ls * 2.3) d.text(X(xm) + Math.max(4, mm(9)), Y(ym) + 4 + ls, short(i.sub, Math.floor((w - 8) / (ss * 0.53))), { size: ss, muted: true });
      if (h > ls * 2.3 + ss * 1.6) d.text(X(xm) + Math.max(4, mm(9)), Y(ym) + 5 + ls + ss * 1.25, Math.round(i.mm[0]) + ' × ' + Math.round(i.mm[1]) + (i.nominal ? ' nominal' : ' mm'), { size: ss * 0.92, muted: true });
    }
    var ty = M + SUP; trunk(ty); var cy = ty + TRUNK;
    // DIN rail — only for kit the Library marks DIN, only as long as it needs
    if (dinIt.length) {
      var railL = dinIt.reduce(function (a, i) { return a + i.mm[0] + 2; }, 0) + 40;
      d.rect(X(M), Y(cy + DINROW / 2 - 17.5), mm(railL), mm(35), { rail: true });
      var dx = M + 20; dinIt.forEach(function (i) { var hh = Math.min(i.mm[1], DINROW - 6); tile({ role: i.role, label: i.label, sub: i.sub, mm: [i.mm[0], hh], nominal: i.nominal, band: i.band }, dx, cy + (DINROW - hh) / 2); dx += i.mm[0] + 2; });
      d.text(X(M + railL + 12), Y(cy + DINROW / 2) - 4, '35 mm DIN rail  ·  DIN-mount kit only (' + dinIt.length + ')', { size: 5.8, muted: true });
      trunk(cy + DINROW); cy += DINROW + TRUNK;
    }
    // surface kit — screwed to the ply, packed on the kit slot grid
    for (var r = 0; r < rows; r++) {
      var rowTop = cy + r * (ROWH + TRUNK);
      surf.forEach(function (i) {
        var pz = at[i.id]; if (!pz || pz.unplaced || pz.row !== r) return;
        var xm = M + pz.start * unit, ym = rowTop + (ROWH - i.mm[1]) / 2;
        tile(i, xm, ym); fix(xm, ym, i.mm[0], i.mm[1]);
      });
      trunk(rowTop + ROWH);
    }
    // LV terminal strip — screwed to the board, a V+ / V− pair per run
    var trTop = cy + rows * (ROWH + TRUNK);
    for (var tr = 0; tr < termRows; tr++) {
      var tyy = trTop + tr * TERM, per = Math.floor((boardW - M * 2 - 40) / 12), slice = runs.slice(tr * per, tr * per + per), tx = M + 10, labels = [];
      d.rect(X(tx - 4), Y(tyy + 8), mm(slice.length * 12 + 20), mm(46), { mcb: 'bar' });
      tx += 6;
      slice.forEach(function (rid) { ['+', '−'].forEach(function (pol) { d.rect(X(tx), Y(tyy + 12), mm(5.4), mm(38), { term: pol }); tx += 6; }); labels.push([tx - 6, rid]); });
      labels.forEach(function (l) { d.text(X(l[0]), Y(tyy + 58) + 2 + Math.min(30, mm(40)), short(l[1], 16), { size: Math.max(3.8, Math.min(5.4, mm(12) * 0.5)), muted: true, rot: true }); });
      if (tr === 0) d.text(X(tx + 20), Y(tyy + 31) - 9, 'LV terminal strip  ·  V+ / V− per run to the field', { size: 5.8, muted: true });
    }
    if (racked.length) d.text(X(0), Y(boardH) + 26, 'Racked, not on this board: ' + racked.map(function (i) { return i.label; }).join(', '), { size: 5.8, muted: true });
    d.dim(X(0), Y(boardH) + 14, X(boardW), Y(boardH) + 14, boardW + ' mm');
    d.dim(X(boardW) + 16, Y(0), X(boardW) + 16, Y(boardH), boardH + ' mm', { vertical: true });
    var schedule = [], by = {};
    items.forEach(function (i) { var key = i.role + '|' + i.label + '|' + i.product + '|' + i.mount; var s0 = by[key] = by[key] || { role: i.role, label: i.label, product: i.product, mm: i.mm, nominal: i.nominal, mount: i.mount, qty: 0 }; s0.qty++; });
    Object.keys(by).forEach(function (kk) { schedule.push(by[kk]); });
    return { w: mm(boardW) + 52, h: mm(boardH) + (racked.length ? 40 : 32), items: d.items, mm: [boardW, boardH], kPerMm: k, schedule: schedule, board: board, rows: rows, din: dinIt.length, racked: racked.length, backboard: '18 mm ply',
      title: (board.label || 'Head end') + ' — board elevation', placedVia: (global.SonorSlotGrid && global.SonorSlotGrid.autoLayout) ? 'kit slot grid' : 'built-in first-fit' };
  }
  function firstFit(grid, items) {
    var out = [], loose = items.slice().sort(function (a, b) { return (b.weightRank || 0) - (a.weightRank || 0) || b.size - a.size; });
    loose.forEach(function (it) {
      for (var row = 0; row < grid.rows; row++) for (var s = 0; s + it.size <= grid.size; s++) {
        if (!out.some(function (o) { return o.row === row && s < o.start + o.size && o.start < s + it.size; })) { out.push(Object.assign({}, it, { start: s, row: row })); return; }
      }
      out.push(Object.assign({}, it, { start: -1, row: 0, unplaced: true }));
    });
    return out;
  }
  function legend(kind) {
    if (kind === 'elevation') return [['supply', 'PSU on a radial (unswitched)'], ['dimmed', 'PSU on a dimmed feed (triac)'], ['decoder', 'DMX decoder'], ['node', 'DMX node / pixel controller']].map(function (r) { return { key: r[0], label: r[1], colour: ROLE[r[0]].paper, w: 3 }; }).concat([{ key: 'ply', label: '18 mm ply backboard - kit screwed to its face', colour: THEME.paper.plyEdge, w: 3 }, { key: 'nominal', label: 'Dashed = nominal size', colour: [112, 112, 112], dash: [3, 2], w: 0.8 }]);
    return Object.keys(WIRE).map(function (k) { return { key: k, label: WIRE[k].label, colour: WIRE[k].paper, dash: WIRE[k].dash || null, w: WIRE[k].w }; });
  }

  // ══ PAINTERS ══
  function hex(c) { return typeof c === 'string' ? c : 'rgb(' + c.join(',') + ')'; }
  function arr(c) { if (typeof c !== 'string') return c; var h = c.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(c, bg, t) { c = arr(c); bg = arr(bg); return [0, 1, 2].map(function (i) { return Math.round(c[i] * t + bg[i] * (1 - t)); }); }
  function textCol(o, T, theme) { if (o.inv) return theme === 'paper' ? [255, 255, 255] : '#16191e'; if (o.wire && WIRE[o.wire]) return theme === 'paper' ? WIRE[o.wire].paper : WIRE[o.wire].dark; if (o.role && ROLE[o.role]) return ROLE[o.role][theme]; return o.ink ? T.mcbInk : (o.muted ? T.muted : T.text); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rectStyle(o, T, theme) {
    if (o.box) return { fill: T.box, stroke: T.boxLine, sw: 0.7, dash: o.dash ? [3, 2] : null, rx: 2 };
    if (o.card) return { fill: T.box, rx: 3 };
    if (o.outline) return { fill: null, stroke: T.boxLine, sw: 0.7, dash: o.dash ? [3, 2] : null, rx: 3 };
    if (o.head) return { fill: T.tab };
    if (o.idchip) { var Ri = ROLE[o.idchip] || ROLE.psu; return { fill: mix(Ri[theme], T.box, 0.18), stroke: Ri[theme], sw: 0.5, rx: 2 }; }
    if (o.tagfill) { var Rg = ROLE[o.tagfill] || ROLE.psu; return { fill: Rg[theme], rx: 2 }; }
    if (o.chip) { var Wc = WIRE[o.chip] ? WIRE[o.chip][theme] : T.muted; return { fill: mix(Wc, T.box, 0.16), stroke: Wc, sw: 0.45, rx: 2 }; }
    if (o.band) { var R = ROLE[o.band] || ROLE.psu; return { fill: R[theme] }; }
    if (o.encl) return { fill: null, stroke: T.encl, sw: o.light ? 0.5 : 0.8, dash: o.light ? [2, 2] : [6, 3], rx: 4 };
    if (o.tab) return { fill: T.tab, stroke: T.encl, sw: 0.6, rx: 3 };
    if (o.board) return { fill: T.board, stroke: T.boardLine, sw: 0.9, rx: 2 };
    if (o.ply) return { fill: T.ply, stroke: T.plyEdge, sw: 1.1, rx: 1 };
    if (o.acc) return { fill: T.mcb, stroke: T.boxLine, sw: 0.6, rx: 3 };
    if (o.rail) return { fill: T.rail };
    if (o.trunk) return { fill: T.trunk, stroke: T.faint, sw: 0.4 };
    if (o.slot) return { fill: T.trunkSlot };
    if (o.toggle) return { fill: o.toggle === 'iso' ? (theme === 'paper' ? [200, 40, 40] : '#e05a4f') : T.mcbInk };
    if (o.mcb) return { fill: o.mcb === 'dim' ? ROLE.dimmed[theme] : (o.mcb === 'bar' ? T.term : T.mcb), stroke: T.boxLine, sw: 0.5, rx: 1 };
    if (o.term) return { fill: o.term === '+' ? (theme === 'paper' ? [214, 84, 66] : '#c4574b') : (theme === 'paper' ? [60, 60, 60] : '#5a5f66'), stroke: T.boxLine, sw: 0.3 };
    if (o.tile) { var Rt = ROLE[o.tile] || ROLE.psu; return { fill: theme === 'paper' ? mix(Rt.paper, [255, 255, 255], 0.1) : T.box, stroke: Rt[theme], sw: 0.9, dash: o.dash ? [3, 2] : null, rx: 2 }; }
    if (o.strip) return { fill: ROLE.run[theme] };
    return { fill: T.box, stroke: T.boxLine, sw: 0.6 };
  }
  function toSvg(sheet, opts) {
    opts = opts || {}; var theme = opts.theme === 'paper' ? 'paper' : 'dark', T = THEME[theme], pad = opts.pad == null ? 14 : opts.pad;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-pad) + ' ' + (-pad) + ' ' + (sheet.w + pad * 2) + ' ' + (sheet.h + pad * 2) + '" font-family="DM Sans, Gilroy, system-ui, sans-serif">';
    if (T.bg) s += '<rect x="' + (-pad) + '" y="' + (-pad) + '" width="' + (sheet.w + pad * 2) + '" height="' + (sheet.h + pad * 2) + '" fill="' + T.bg + '"/>';
    sheet.items.forEach(function (it) {
      var o = it.o || {};
      if (it.t === 'open') { s += '<g class="' + it.cls + '" data-id="' + esc(it.id) + '"' + Object.keys(it.data || {}).map(function (k) { return ' data-' + k + '="' + esc(it.data[k]) + '"'; }).join('') + '>'; return; }
      if (it.t === 'close') { s += '</g>'; return; }
      if (it.t === 'rect') { var st = rectStyle(o, T, theme); s += '<rect x="' + it.x.toFixed(1) + '" y="' + it.y.toFixed(1) + '" width="' + Math.max(0, it.w).toFixed(1) + '" height="' + Math.max(0, it.h).toFixed(1) + '"' + (st.rx ? ' rx="' + st.rx + '"' : '') + ' fill="' + (st.fill ? hex(st.fill) : 'none') + '"' + (st.stroke ? ' stroke="' + hex(st.stroke) + '" stroke-width="' + st.sw + '"' : '') + (st.dash ? ' stroke-dasharray="' + st.dash.join(' ') + '"' : '') + '/>'; }
      else if (it.t === 'line') { var w = it.wire ? WIRE[it.wire] : null, col = w ? w[theme] : (o.grain ? T.grain : (o.rule ? T.line : T.faint)); s += '<polyline points="' + it.pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + hex(col) + '" stroke-width="' + (w ? w.w : 0.6) + '" stroke-linejoin="round"' + (w && w.dash ? ' stroke-dasharray="' + w.dash.join(' ') + '"' : '') + '/>'; }
      else if (it.t === 'dot') { var c = it.wire ? WIRE[it.wire][theme] : T.boxLine; if (o.screw) { s += '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="' + (o.r || 1) + '" fill="' + hex(T.rail) + '" stroke="' + hex(T.boxLine) + '" stroke-width="0.4"/>'; return; } s += '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="' + (o.r || 2.2) + '"' + (o.hollow ? ' fill="none" stroke="' + hex(T.boardLine) + '" stroke-width="0.6"' : ' fill="' + hex(c) + '"') + '/>'; }
      else if (it.t === 'port') s += '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="1.9" fill="' + hex(T.box) + '" stroke="' + hex(WIRE[it.wire][theme]) + '" stroke-width="1"/>';
      else if (it.t === 'tag') { var tw = it.s.length * 3.15 + 6, tc = WIRE[it.wire] ? WIRE[it.wire][theme] : T.muted; s += '<rect x="' + (it.x - tw / 2).toFixed(1) + '" y="' + (it.y - 4.6).toFixed(1) + '" width="' + tw.toFixed(1) + '" height="9.2" rx="2" fill="' + hex(T.knock) + '"/><text x="' + it.x.toFixed(1) + '" y="' + (it.y + 2.1).toFixed(1) + '" font-size="5.8" text-anchor="middle" fill="' + hex(tc) + '">' + esc(it.s) + '</text>'; }
      else if (it.t === 'dim') { var dc = hex(T.dim), v = o.vertical; s += '<line x1="' + it.x1 + '" y1="' + it.y1 + '" x2="' + it.x2 + '" y2="' + it.y2 + '" stroke="' + dc + '" stroke-width="0.5"/>'; [[it.x1, it.y1], [it.x2, it.y2]].forEach(function (p) { s += v ? '<line x1="' + (p[0] - 4) + '" y1="' + p[1] + '" x2="' + (p[0] + 4) + '" y2="' + p[1] + '" stroke="' + dc + '" stroke-width="0.5"/>' : '<line x1="' + p[0] + '" y1="' + (p[1] - 4) + '" x2="' + p[0] + '" y2="' + (p[1] + 4) + '" stroke="' + dc + '" stroke-width="0.5"/>'; });
        var mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2; s += v ? '<text x="' + (mx + 4) + '" y="' + my + '" font-size="6.4" fill="' + dc + '" transform="rotate(-90 ' + (mx + 4) + ' ' + my + ')" text-anchor="middle" dy="6">' + esc(it.s) + '</text>' : '<text x="' + mx + '" y="' + (my + 10) + '" font-size="6.4" text-anchor="middle" fill="' + dc + '">' + esc(it.s) + '</text>'; }
      else if (it.t === 'text') { var sz = o.size || 8, colT = textCol(o, T, theme), anc = o.anchor === 'end' ? 'end' : (o.anchor === 'middle' ? 'middle' : 'start');
        s += '<text x="' + it.x.toFixed(1) + '" y="' + (it.y + sz * 0.82).toFixed(1) + '" font-size="' + sz + '"' + (o.bold ? ' font-weight="700"' : '') + (o.track ? ' letter-spacing="' + o.track + '"' : '') + ' text-anchor="' + anc + '" fill="' + hex(colT) + '"' + (o.mono ? ' font-family="DM Mono, ui-monospace, monospace"' : '') + (o.rot ? ' transform="rotate(-90 ' + it.x.toFixed(1) + ' ' + (it.y + sz * 0.82).toFixed(1) + ')"' : '') + '>' + esc(it.s) + '</text>'; }
    });
    return s + '</svg>';
  }
  // pdf-lib — page = PDFPage; opts = { x, top (pt from the top of the canvas), scale, H (canvas height), fonts: {b, r}, theme, safe }
  function toPdf(page, sheet, opts) {
    var PL = global.PDFLib; opts = opts || {}; var theme = opts.theme === 'dark' ? 'dark' : 'paper', T = THEME[theme], k = num(opts.scale, 1), OX = num(opts.x), OY = num(opts.top), H = num(opts.H, 841.89), F = opts.fonts || {}, safe = opts.safe || function (x) { return x; };
    function rgb(c) { if (typeof c === 'string') { var h = c.replace('#', ''); c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } return PL.rgb(c[0] / 255, c[1] / 255, c[2] / 255); }
    function px(x) { return OX + x * k; } function py(y) { return H - (OY + y * k); }
    function lw(w) { return Math.max(0.35, w * Math.min(1, k + 0.15)); }
    function txt(s, x, y, sz, font, col, anchor, rot) {
      if (!font) return; s = safe(s); var w = font.widthOfTextAtSize(s, sz);
      if (rot) { page.drawText(s, { x: x + sz * 0.3, y: y, size: sz, font: font, color: col, rotate: PL.degrees(90) }); return; }
      page.drawText(s, { x: anchor === 'end' ? x - w : (anchor === 'middle' ? x - w / 2 : x), y: y, size: sz, font: font, color: col });
    }
    sheet.items.forEach(function (it) {
      var o = it.o || {};
      if (it.t === 'rect') { var st = rectStyle(o, T, theme), opt = { x: px(it.x), y: py(it.y + it.h), width: Math.max(0, it.w * k), height: Math.max(0, it.h * k) }; if (st.fill) opt.color = rgb(st.fill); else opt.opacity = 0; if (st.stroke) { opt.borderColor = rgb(st.stroke); opt.borderWidth = lw(st.sw); if (st.dash) opt.borderDashArray = st.dash; } page.drawRectangle(opt); }
      else if (it.t === 'line') { var w = it.wire ? WIRE[it.wire] : null, col = rgb(w ? w[theme] : (o.grain ? T.grain : (o.rule ? T.line : T.faint))); for (var i = 1; i < it.pts.length; i++) { var lo = { start: { x: px(it.pts[i - 1][0]), y: py(it.pts[i - 1][1]) }, end: { x: px(it.pts[i][0]), y: py(it.pts[i][1]) }, thickness: lw(w ? w.w : 0.6), color: col }; if (w && w.dash) lo.dashArray = w.dash; page.drawLine(lo); } }
      else if (it.t === 'dot') { var dc = it.wire ? WIRE[it.wire][theme] : T.boxLine; if (o.screw) { page.drawCircle({ x: px(it.x), y: py(it.y), size: (o.r || 1) * k, color: rgb(T.rail), borderColor: rgb(T.boxLine), borderWidth: 0.3 }); return; } if (o.hollow) page.drawCircle({ x: px(it.x), y: py(it.y), size: (o.r || 2.2) * k, borderColor: rgb(T.boardLine), borderWidth: 0.5, opacity: 0, borderOpacity: 1 }); else page.drawCircle({ x: px(it.x), y: py(it.y), size: (o.r || 2.2) * k, color: rgb(dc) }); }
      else if (it.t === 'port') page.drawCircle({ x: px(it.x), y: py(it.y), size: 1.9 * k, color: rgb(T.box), borderColor: rgb(WIRE[it.wire][theme]), borderWidth: lw(1) });
      else if (it.t === 'tag') { var tsz = 5.8 * k, tf = F.r, ts = safe(it.s), tw = tf ? tf.widthOfTextAtSize(ts, tsz) + 6 * k : 0; page.drawRectangle({ x: px(it.x) - tw / 2, y: py(it.y) - 4.6 * k, width: tw, height: 9.2 * k, color: rgb(theme === 'paper' ? [255, 255, 255] : T.knock) }); txt(ts, px(it.x), py(it.y) - 2.1 * k, tsz, tf, rgb(WIRE[it.wire] ? WIRE[it.wire][theme] : T.muted), 'middle'); }
      else if (it.t === 'dim') { var dcol = rgb(T.dim), v = o.vertical; page.drawLine({ start: { x: px(it.x1), y: py(it.y1) }, end: { x: px(it.x2), y: py(it.y2) }, thickness: 0.5, color: dcol }); [[it.x1, it.y1], [it.x2, it.y2]].forEach(function (p) { if (v) page.drawLine({ start: { x: px(p[0] - 4), y: py(p[1]) }, end: { x: px(p[0] + 4), y: py(p[1]) }, thickness: 0.5, color: dcol }); else page.drawLine({ start: { x: px(p[0]), y: py(p[1] - 4) }, end: { x: px(p[0]), y: py(p[1] + 4) }, thickness: 0.5, color: dcol }); });
        var mx = px((it.x1 + it.x2) / 2), my = py((it.y1 + it.y2) / 2); if (v) txt(it.s, mx + 9 * k, my - (F.r ? F.r.widthOfTextAtSize(safe(it.s), 6.4 * k) / 2 : 0), 6.4 * k, F.r, dcol, null, true); else txt(it.s, mx, my - 10 * k, 6.4 * k, F.r, dcol, 'middle'); }
      else if (it.t === 'text') { var sz = (o.size || 8) * k, font = o.bold ? (F.b || F.r) : F.r, colT = rgb(textCol(o, T, theme)); if (!font) return; var str = safe(it.s);
        if (o.track) { var cxp = px(it.x); for (var j = 0; j < str.length; j++) { page.drawText(str[j], { x: cxp, y: py(it.y) - sz * 0.82, size: sz, font: font, color: colT }); cxp += font.widthOfTextAtSize(str[j], sz) + o.track * k; } }
        else txt(str, px(it.x), py(it.y) - sz * 0.82, sz, font, colT, o.anchor, o.rot); }
    });
  }

  global.SonorLedDrawings = { VERSION: VERSION, WIRE: WIRE, ROLE: ROLE, THEME: THEME, schematic: schematic, elevation: elevation, legend: legend, toSvg: toSvg, toPdf: toPdf };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
