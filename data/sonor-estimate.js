/* sonor-estimate.js — CANONICAL MASTER (workspace root; synced to data/ of every consumer by sync-everything.sh)
   ONE estimate engine for every Sonor client budget (v1.0.0 · 2026-11-09 · B-809 · sonor-platform §67).
   Bryn 2026-11-09: "one shared engine, not three apps … every document has the same budget layout".

   Ported out of Stretched Fabric v0.4.2 (FabricApp.budgetModel() + FabricPdf secBudget) so Stretched Fabric, Media Wall,
   Takeover and the Estimates family (APP - ESTIMATE - Cinema / Media Wall / Media Room …) all draw the SAME page:
   §nn service-colour bar per section, rows right-aligned inc. VAT and rounded to £10, OPTION / ALLOWANCE tags, section
   totals, two balanced columns on landscape, light gold-outline cards (Core · With options · Of which allowances), Basis
   and red "Electrical · by others" style exclusion flags. No dark boxes (2026-11-07 rule), options as +/− increments only.

   SECTION MODEL (what an estimate stores in estimates.sections, and what every consumer hands the drawer):
     { key, service_nn: '01'..'10' | null, hex: '#…' | null, title, optional, note, total_label,
       rows: [{ label, qty, unit, sell_ex, inc, optional, allowance, model_id, wq_line, library_ref, labour_h }] }
     • inc (inc. VAT, rounded) wins when given; else sell_ex × (1 + VAT) × (1 + contingency) rounded to £10.
     • qty > 1 prefixes the client label "3 no. …" (Stretched Fabric v0.4.2 rule) unless row.qtyInLabel === false.

   API (pure — node-testable; the PDF part needs window.SonorPdfLuxury + PDFLib at call time):
     SonorEstimate.budget(est, opts)          → { sections[], core_inc, options_inc, allowance_inc, with_options_inc, basis[], flags[], intro }
     SonorEstimate.totals(est, opts)          → { core_ex, core_inc, options_inc, allowance_inc, with_options_inc, sections:{key:{total_inc, options_inc}} }
     SonorEstimate.fromTemplate(tpl, inputs, lib, opts) → sections[] (Library model_ids, quantity + labour expressions, prices)
     SonorEstimate.evalQty(expr, inputs)      → number (safe arithmetic over the room inputs)
     SonorEstimate.record(est, opts)          → projects.metadata.cost_estimates[] record (§66 shape)
     SonorEstimate.wqPlan(est, opts)          → ONE priced line per section (+ OPTIONAL lines for options) for wq-push 1.4+
     SonorEstimate.products(est, lib)         → product-card list (hero_image, make/model, specs) from the Library rows
     SonorEstimate.clientLabel(s)             → client copy (no "(£…)", "(quoted)", "Builder —")
     SonorEstimate.pdf.budgetPage(b, opts)    → draw fn(P, F, pageNo, TOTAL) on the luxury chrome  ← the shared page
     SonorEstimate.pdf.generate(m)            → the one-pack estimate PDF (cover · overview · products · budget · basis · rear)
*/
(function (global) {
  'use strict';
  var VERSION = '1.4.0';   // 1.4.0 — rows can be `existing` (shown "retained", never priced) — Bryn 2026-11-09, 1410
  var VAT = 0.2;

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
  function r10(v) { return Math.round(num(v) / 10) * 10; }
  function money(v) { return '£' + Math.round(num(v)).toLocaleString('en-GB'); }
  function signed(v) { return (v < 0 ? '− ' : '+ ') + money(Math.abs(v)); }
  function clientLabel(x) {
    var t = String(x == null ? '' : (typeof x === 'object' ? (x.client || x.label || x.name || '') : x))
      .replace(/\s*\((?=[^)]*(?:£|quoted|approx|estimate|TBC|ex VAT))[^)]*\)\s*/gi, ' ').replace(/^Builder\s*[—-]\s*/i, '').replace(/\s+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function svcList() { return ((global.__SONOR_BRAND__ || {}).services) || []; }
  function svcHex(nn) { var sv = svcList().find(function (x) { return String(x.nn) === String(nn); }); return sv ? sv.hex : null; }
  var FALLBACK_HEX = { '01': '#8058a1', '02': '#4bb9d3', '03': '#78ba57', '04': '#f5d05c', '05': '#e37c59', '06': '#ec6061', '07': '#e67eb1', '08': '#ad9978', '09': '#b7b1a7', '10': '#302f2e' };   // offline only — brand-core is the SSOT
  function hexOf(sec) { return sec.hex || svcHex(sec.service_nn) || FALLBACK_HEX[String(sec.service_nn)] || '#ad9978'; }

  // ── row + section maths ───────────────────────────────────────────────────────────────────────────
  function rowInc(r, opts) {
    opts = opts || {}; if (r.inc != null && r.inc !== '') return num(r.inc);
    var vat = opts.vat == null ? VAT : opts.vat, cont = num(opts.contingency, 0);
    return r10(num(r.sell_ex) * (1 + vat) * (1 + cont));
  }
  function rowLabel(r) { var q = num(r.qty, 1); return (q > 1 && r.qtyInLabel !== false && !/^\d+\s*no\.\s/i.test(r.label || '') ? q + ' no. ' : '') + clientLabel(r.label); }

  // budget(est) — the client budget model (SF v0.4.2 budgetModel output shape). est = { sections, basis, flags, intro, contingency }
  function budget(est, opts) {
    est = est || {}; opts = opts || {};
    var o = { vat: opts.vat == null ? (est.vat == null ? VAT : est.vat) : opts.vat, contingency: opts.contingency == null ? num(est.contingency, 0) : opts.contingency };
    var sections = [], core = 0, optionsInc = 0, allowanceInc = 0;
    (est.sections || []).forEach(function (sx) {
      if (!sx || sx.hidden) return;
      var secOpt = !!sx.optional, tot = 0, optTot = 0;
      var rows = (sx.rows || []).filter(function (r) { return r && !r.hidden && (r.label || r.inc || r.sell_ex); }).map(function (r) {
        var ex = !!r.existing, inc = ex ? 0 : rowInc(r, o), opt = !ex && (secOpt || !!r.optional);
        return { label: rowLabel(r), inc: inc, optional: opt, allowance: !ex && !!r.allowance, existing: ex, model_id: r.model_id || null, group: r.group || null };
      });
      if (sx.sortOptionsLast !== false) rows.sort(function (a, b) { return (a.existing ? 1 : 0) - (b.existing ? 1 : 0) || (a.optional ? 1 : 0) - (b.optional ? 1 : 0); });   // core rows first, existing (retained) next, options after
      rows.forEach(function (r) { if (r.optional) { optionsInc += r.inc; optTot += r.inc; } else { tot += r.inc; core += r.inc; if (r.allowance) allowanceInc += r.inc; } });
      if (!rows.length) return;
      sections.push({ key: sx.key, service_nn: sx.service_nn || null, hex: sx.hex || null, title: clientLabel(sx.title), optional: secOpt, note: sx.note || null,
        total_label: sx.total_label || (clientLabel(sx.title) + ' total · inc. VAT'), rows: rows, total: rows.some(function (r) { return !r.optional; }) ? tot : null, options_inc: optTot });
    });
    var basis = (est.basis && est.basis.length ? est.basis.slice() : ['Dimensions and quantities from the information we have; final figures follow the survey.', 'Products as named, or an equivalent of the same standard.', 'Includes VAT at 20%; excludes anything not described.']);
    if (o.contingency && !basis.some(function (t) { return /contingency/i.test(t); })) basis.push('Includes a ' + Math.round(o.contingency * 100) + '% contingency.');
    if (optionsInc && !basis.some(function (t) { return /options/i.test(t); })) basis.push('Options are shown as the change they make and are not in the core figure.');
    if (allowanceInc && !basis.some(function (t) { return /allowance/i.test(t); })) basis.push('Allowances are priced before order.');
    var flags = est.flags && est.flags.length ? est.flags : (est.flags === null || opts.noDefaultFlag ? [] : [{ label: 'Electrical · by others', text: 'Electrical work is not included — supplies, circuits and connections by the site electrician.', hex: '#ec6061' }]);
    return { sections: sections, core_inc: core, options_inc: optionsInc, allowance_inc: allowanceInc, with_options_inc: core + optionsInc, basis: basis, flags: flags, intro: est.intro || null, contingency: o.contingency };
  }
  function totals(est, opts) {
    var b = budget(est, opts), o = { vat: VAT, contingency: num((est || {}).contingency, 0) }, coreEx = 0, secs = {};
    (est.sections || []).forEach(function (sx) { (sx.rows || []).forEach(function (r) { if (!(sx.optional || r.optional) && !r.hidden && !r.existing) coreEx += r.sell_ex != null ? num(r.sell_ex) : rowInc(r, o) / (1 + VAT); }); });
    b.sections.forEach(function (s) { secs[s.key] = { total_inc: s.total, options_inc: s.options_inc }; });
    return { core_ex: Math.round(coreEx * 100) / 100, core_inc: b.core_inc, options_inc: b.options_inc, allowance_inc: b.allowance_inc, with_options_inc: b.with_options_inc, sections: secs };
  }

  // ── templates ─────────────────────────────────────────────────────────────────────────────────────
  // evalQty — arithmetic over the room inputs only: numbers, + − × ÷ ( ) ?: comparisons, ceil/floor/round/max/min/abs.
  var FNS = { ceil: Math.ceil, floor: Math.floor, round: Math.round, max: Math.max, min: Math.min, abs: Math.abs, sqrt: Math.sqrt };
  function evalQty(expr, inputs) {
    if (expr == null || expr === '') return null; if (typeof expr === 'number') return expr;
    var s = String(expr); if (!/^[\s\w.+\-*/(),?:<>=!&|%]*$/.test(s)) return null;
    var ids = s.match(/[A-Za-z_]\w*/g) || [], env = {}, ok = true;
    ids.forEach(function (id) { if (FNS[id]) env[id] = FNS[id]; else if (inputs && Object.prototype.hasOwnProperty.call(inputs, id)) env[id] = num(inputs[id]); else ok = false; });
    if (!ok) return null;
    try { var keys = Object.keys(env); var v = Function.apply(null, keys.concat(['"use strict"; return (' + s + ');'])).apply(null, keys.map(function (k) { return env[k]; })); return isFinite(v) ? Number(v) : null; } catch (e) { return null; }
  }
  // price a Library product: WeQuote catalogue sell when linked, else Library trade ÷ (1 − margin), else MSRP ex VAT, else the template's fallback
  // precedence: WeQuote catalogue sell (when the product mirror carries it) → Library trade ÷ (1 − margin) → the template's house price
  // (sell_ex — a number or an expression over the inputs, taken from the latest WeQuote quote) → Library MSRP ex VAT → TBC (allowance)
  function priceOf(row, lib, d, inp) {
    var p = (lib && row.model_id && (typeof lib === 'function' ? lib(row.model_id) : lib[row.model_id])) || null, m = num((d || {}).margin, 0.3);
    if (p && p.wq_sell != null) return { sell_ex: num(p.wq_sell), source: 'wq', cost_ex: p.wq_cost != null ? num(p.wq_cost) : null };
    if (p && p.trade != null) return { sell_ex: Math.round(num(p.trade) / (1 - m) * 100) / 100, source: 'library-trade', cost_ex: num(p.trade) };
    if (row.sell_ex != null && row.sell_ex !== '') { var v = typeof row.sell_ex === 'number' ? row.sell_ex : evalQty(row.sell_ex, inp || {}); if (v != null) return { sell_ex: num(v), source: 'template', cost_ex: row.cost_ex != null ? num(row.cost_ex) : null }; }
    if (p && p.msrp != null) return { sell_ex: Math.round(num(p.msrp) / (1 + VAT) * 100) / 100, source: 'library-msrp', cost_ex: null };
    return { sell_ex: 0, source: 'tbc', cost_ex: null };
  }
  // fromTemplate(tpl, inputs, lib, opts) — tpl.sections in Sonor service order; each row {label, model_id, qty (expr), unit, labour_h (expr), optional, allowance, sell_ex, when (expr)}
  // labour per section → one "Installation and commissioning" row (Σ hours × the app's labour sell rate), the WQ client-proposal convention (SF v0.4.2).
  function fromTemplate(tpl, inputs, lib, opts) {
    tpl = tpl || {}; opts = opts || {}; var d = Object.assign({ margin: 0.3, labourSell: 62, labourCost: 31 }, tpl.defaults || {}, opts.defaults || {});
    var inp = derive(Object.assign({}, defaultsOf(tpl), inputs || {}));
    return (tpl.sections || []).map(function (ts) {
      if (ts.when != null && !evalQty(ts.when, inp)) return null;
      var hours = 0, rows = [];
      (ts.rows || []).forEach(function (tr) {
        if (tr.when != null && !evalQty(tr.when, inp)) return;
        var q = tr.qty == null ? 1 : evalQty(tr.qty, inp); if (q == null) q = 1; q = Math.max(0, Math.round(q * 100) / 100);
        if (!q) return;
        var lh = evalQty(tr.labour_h, inp) || 0; hours += lh * (tr.labour_per === 'line' ? 1 : q);
        var p = priceOf(tr, lib, d, inp), libRow = lib && tr.model_id ? (typeof lib === 'function' ? lib(tr.model_id) : lib[tr.model_id]) : null;
        var unit = num(p.sell_ex), perUnit = tr.unit && tr.unit !== 'no.' && tr.unit !== 'each';
        var lab = String(tr.label || (libRow ? [libRow.make, libRow.model].filter(Boolean).join(' ') : 'Item')).replace(/\{(\w+)\}/g, function (_, k) { return inp[k] != null ? inp[k] : ''; });
        if (perUnit && tr.showQty !== false) lab += ' · ' + (Math.round(q * 10) / 10) + ' ' + tr.unit;
        rows.push({ label: lab, qty: q, unit: tr.unit || 'no.', unit_sell_ex: unit, sell_ex: Math.round(unit * q * 100) / 100,
          optional: !!tr.optional, allowance: !!(tr.allowance || p.source === 'tbc'), model_id: tr.model_id || null, wq_line: tr.wq_line || null, library_ref: tr.model_id ? 'av_catalogue/' + tr.model_id : null,
          price_source: p.source, qtyInLabel: perUnit ? false : undefined, labour_h: lh || 0 });
      });
      if (hours > 0 && ts.labour !== false) rows.push({ label: ts.labour_label || 'Installation and commissioning', qty: 1, sell_ex: Math.round(hours * d.labourSell * 100) / 100, labour_h: Math.round(hours * 10) / 10, labour: true });
      return { key: ts.key, service_nn: ts.service_nn || null, hex: ts.hex || null, title: ts.title, optional: !!ts.optional, note: ts.note || null, rows: rows };
    }).filter(function (s) { return s && s.rows.length; });
  }
  // fromDesignBudget(budget) — 1.4.0: a design app's published client budget (e.g. projects.metadata.stretched_fabric_spec.budget, the
  // §70 section model) taken as this estimate's sections, so a room estimate fronts the design instead of re-entering it (Bryn 2026-11-09,
  // 1410: "is this fully done as the correct project under media room estimate app … as well as its potentially other apps that share info")
  function fromDesignBudget(b) {
    return ((b && b.sections) || []).map(function (sx) {
      return { key: sx.key, service_nn: sx.service_nn || null, hex: sx.hex || null, title: sx.title, optional: !!sx.optional, note: sx.note || null, total_label: sx.total_label || null, from_design: true,
        rows: (sx.rows || []).map(function (r) { var o = { label: r.label, inc: r.existing ? 0 : num(r.inc), sell_ex: r.existing ? 0 : Math.round(num(r.inc) / (1 + VAT) * 100) / 100 }; ['optional', 'allowance', 'existing'].forEach(function (k) { if (r[k]) o[k] = true; }); if (r.model_id) o.model_id = r.model_id; return o; }) };
    }).filter(function (s) { return s.rows.length; });
  }
  // ── Takeoffs → sections (1.1.0, Bryn 2026-11-09: "these are a front end export for what i held in the project via other apps") ──
  // Takeoffs is the device SSOT: projects.metadata.takeoff_summary.places[kind:'symbol'] {code, label, service_nn, floor_name}.
  // tpl.takeoff = { services: {nn: {title, per_point (ex VAT), labour_h, exclude, replaced_by: kind}}, rates: {code: {label, sell_ex, labour_h, skip}},
  //                 patterns: [{re, label?, sell_ex, labour_h}], led_m: {label, sell_ex, labour_h} (per metre, service 04), programming: {nn, h_per_point, label} }
  function takeoffCounts(summary) {
    var out = {}; ((summary || {}).places || []).forEach(function (p) {
      if (!p || p.kind !== 'symbol' || !p.code) return; var nn = String(p.service_nn || '00').padStart(2, '0');
      var g = out[nn] = out[nn] || {}, r = g[p.code] = g[p.code] || { code: p.code, n: 0, label: p.label || p.code, floors: {} };
      r.n++; if (p.floor_name) r.floors[p.floor_name] = (r.floors[p.floor_name] || 0) + 1;
    });
    return out;
  }
  function rateFor(tk, code, nn) {
    var r = (tk.rates || {})[code]; if (r) return Object.assign({ source: 'rate' }, r);
    var pt = (tk.patterns || []).find(function (x) { return new RegExp(x.re).test(code); }); if (pt) return Object.assign({ source: 'rate' }, pt);
    var sv = (tk.services || {})[nn] || {}; return { sell_ex: sv.per_point != null ? sv.per_point : null, labour_h: sv.labour_h, source: sv.per_point != null ? 'service-rate' : 'tbc' };
  }
  // linked = [{kind, rev, label, sections, contingency}] — the project's own estimates of other kinds; each REPLACES the takeoff service it covers
  function fromTakeoff(tpl, summary, opts) {
    tpl = tpl || {}; opts = opts || {}; var tk = tpl.takeoff || {}, d = Object.assign({ margin: 0.3, labourSell: 62 }, tpl.defaults || {}, opts.defaults || {});
    var counts = takeoffCounts(summary), linked = opts.linked || [], out = [], svcs = tk.services || {}, progPts = 0;
    var nns = Object.keys(Object.assign({}, svcs, counts)).filter(function (nn) { return nn !== '00'; }).sort();
    nns.forEach(function (nn) {
      var sv = svcs[nn] || {}, g = counts[nn] || {}, link = sv.replaced_by && linked.find(function (e) { return e.kind === sv.replaced_by; });
      if (sv.exclude) return;
      if (link) {   // the room's own estimate (Cinema / Media Wall …) carries this service — its section totals, never the raw takeoff points
        var lb = budget({ sections: link.sections, contingency: link.contingency || 0 }, { noDefaultFlag: true }), rows = [];
        lb.sections.forEach(function (s) { if (s.total != null) rows.push({ label: s.title, qty: 1, inc: s.total, linked: true }); if (s.options_inc) rows.push({ label: s.title + ' — options', qty: 1, inc: s.options_inc, optional: true, linked: true }); });
        if (rows.length) out.push({ key: 'est-' + link.kind, service_nn: nn, title: sv.linked_title || sv.title || link.label, note: 'From the ' + (link.label || link.kind) + ' R' + (link.rev || 1) + ' — change it there and re-read.', rows: rows, source: { estimate_id: link.id || null, kind: link.kind, rev: link.rev } });
        return;
      }
      var hours = 0, rows = [], gard = nn === (tk.garden && tk.garden.nn || '04') && opts.garden && (opts.garden.zones || []).length ? opts.garden : null;
      Object.keys(g).map(function (k) { return g[k]; }).filter(function (c) { return !(gard && tk.garden.replaces && new RegExp(tk.garden.replaces).test(c.code)); }).sort(function (a, b) { return b.n - a.n || String(a.code).localeCompare(b.code); }).forEach(function (c) {
        var r = rateFor(tk, c.code, nn); if (r.skip) return;
        var unit = r.sell_ex == null ? 0 : num(r.sell_ex), lh = r.labour_h != null ? num(r.labour_h) : num(sv.labour_h, 0);
        hours += lh * c.n; if (nn >= '02' && nn <= '08') progPts += c.n;
        var own = (tk.rates || {})[c.code], lbl = own && own.label ? own.label : (c.label && c.label !== c.code ? c.label : (r.label || c.code));
        rows.push({ label: lbl, qty: c.n, unit: 'no.', unit_sell_ex: unit, sell_ex: Math.round(unit * c.n * 100) / 100, allowance: r.source !== 'rate', price_source: r.source, takeoff_code: c.code, labour_h: lh });
      });
      if (nn === '04' && tk.led_m && summary && num(summary.led_m) > 0) { var m = Math.round(num(summary.led_m) * 10) / 10; hours += num(tk.led_m.labour_h) * m; rows.push({ label: (tk.led_m.label || 'LED strip, drivers and fitting') + ' · ' + m + ' m', qty: m, unit: 'm', unit_sell_ex: num(tk.led_m.sell_ex), sell_ex: Math.round(num(tk.led_m.sell_ex) * m * 100) / 100, qtyInLabel: false, takeoff_code: 'led_m', price_source: 'rate' }); }
      if (gard) { var gr = gardenRows(tk.garden, gard); gr.rows.forEach(function (r) { rows.push(r); }); hours += gr.hours; }
      if (!rows.length) return;
      // sub-groups inside the service (the WeQuote split — Bryn 2026-11-09: "lighting control, lighting fixtures, led …"): first match wins, else the default group
      var gs = sv.groups || [];
      if (gs.length) { var gi = function (r) { if (r.group) { var gk = gs.findIndex(function (x) { return x.label === r.group; }); if (gk >= 0) return gk; } var code = String(r.takeoff_code || ''); for (var i = 0; i < gs.length; i++) if (gs[i].re && new RegExp(gs[i].re, 'i').test(code)) return i; var di = gs.findIndex(function (x) { return x.default; }); return di >= 0 ? di : gs.length - 1; };
        rows.forEach(function (r, i) { r._o = i; r._g = gi(r); r.group = gs[r._g].label; }); rows.sort(function (a, b) { return a._g - b._g || a._o - b._o; }); rows.forEach(function (r) { delete r._o; delete r._g; }); }
      // one line per item: the same label from different plan symbols (e.g. two downlight codes) merges — qty and sell add up
      var byL = {}; rows = rows.filter(function (r) { var k = (r.group || '') + '|' + r.label + '|' + (r.unit || ''); var m = byL[k]; if (!m) { byL[k] = r; return true; }
        m.qty = Math.round((num(m.qty) + num(r.qty)) * 10) / 10; m.sell_ex = Math.round((num(m.sell_ex) + num(r.sell_ex)) * 100) / 100; m.unit_sell_ex = Math.round(m.sell_ex / m.qty * 100) / 100;
        m.takeoff_codes = (m.takeoff_codes || [m.takeoff_code]).concat(r.takeoff_code); m.allowance = m.allowance || r.allowance; return false; });
      if (hours > 0 && sv.labour !== false) rows.push({ label: sv.labour_label || 'Installation and commissioning', qty: 1, sell_ex: Math.round(hours * d.labourSell * 100) / 100, labour_h: Math.round(hours * 10) / 10, labour: true, group: gs.length ? (tk.install_group || 'Installation and programming') : null });
      out.push({ key: 'svc-' + nn, service_nn: nn, title: sv.title || ('Service ' + nn), note: sv.note || null, rows: rows });
    });
    var pg = tk.programming; if (pg && progPts) { var sec = out.find(function (s) { return s.service_nn === pg.nn; }); var h = Math.round(progPts * num(pg.h_per_point) * 10) / 10; var row = { label: pg.label || 'Programming and commissioning', qty: 1, sell_ex: Math.round(h * d.labourSell * 100) / 100, labour_h: h, labour: true, group: sec && sec.rows.some(function (r) { return r.group; }) ? (tk.install_group || 'Installation and programming') : null }; if (sec) sec.rows.push(row); }
    return out;
  }
  // ── freshness + log (1.3.0 — Bryn 2026-11-09: "every single project should have its data mirrored across all apps and keep log of when it
  // was last adjusted"). Each estimate keeps source.read = { <project metadata key | 'estimate:<kind>'>: the source's own saved time } from the
  // moment it read them; staleSources() compares that with the project as it is now. Times come from what each app already publishes.
  var SOURCES = [
    { key: 'takeoff_summary', label: 'Takeoffs', at: ['updated_at'] },
    { key: 'cinema_design_summary', label: 'Cinema Design', at: ['saved_at', 'updated_at'] },
    { key: 'stretched_fabric_spec', label: 'Stretched Fabric', at: ['updated_at'] },
    { key: 'led_spec', label: 'LED Calc', at: ['updated_at'] },
    { key: 'lighting_control', label: 'Lighting control', at: ['saved_at', 'updated_at'] },
    { key: 'garden_lighting_spec', label: 'Garden Lighting', at: ['updated_at'] },
    { key: 'cinema_takeoff_summary', label: 'Cinema Takeoff', at: ['saved_at', 'updated_at'] }
  ];
  var READS = { 'whole-home': ['takeoff_summary', 'garden_lighting_spec', 'estimate:*'], cinema: ['cinema_design_summary', 'stretched_fabric_spec', 'led_spec', 'cinema_takeoff_summary'], 'media-room': ['cinema_design_summary', 'led_spec', 'takeoff_summary'], 'media-wall': ['led_spec'], 'garden-lighting': ['garden_lighting_spec', 'takeoff_summary'] };
  function readsOf(tpl, kind) { return (tpl && tpl.reads) || READS[kind] || []; }
  function sourceAt(md, key) { var sx = SOURCES.find(function (x) { return x.key === key; }), v = md && md[key]; if (!sx || !v || typeof v !== 'object') return null; for (var i = 0; i < sx.at.length; i++) if (v[sx.at[i]]) return String(v[sx.at[i]]); return null; }
  function sourceLabel(key) { if (/^estimate:/.test(key)) return key.slice(9).replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) + ' estimate'; var sx = SOURCES.find(function (x) { return x.key === key; }); return sx ? sx.label : key; }
  // what an estimate of this template reads, stamped with each source's saved time now
  function sourceStamps(md, reads, linked) {
    var o = {};
    (reads || []).forEach(function (k) {
      if (k === 'estimate:*') { (linked || []).forEach(function (e) { if (e.updated_at) o['estimate:' + e.kind] = String(e.updated_at); }); return; }
      var at = sourceAt(md, k); if (at) o[k] = at;
    });
    return o;
  }
  // sources changed (or newly published) since the estimate read them → [{ key, label, read_at, now_at }]
  function staleSources(read, now) {
    read = read || {}; var out = [];
    Object.keys(now || {}).forEach(function (k) { var a = read[k], b = now[k]; if (!b) return; if (!a || Date.parse(b) > Date.parse(a) + 1000) out.push({ key: k, label: sourceLabel(k), read_at: a || null, now_at: b }); });
    return out;
  }
  // the estimate's own history (metadata.log, newest last, capped) — who / when / what; the audit_log trigger keeps the row-level record
  function logEntry(md, what, by, at) { md = md || {}; var log = (md.log || []).slice(-49); log.push({ at: at || new Date().toISOString(), what: String(what), by: by || null }); return Object.assign({}, md, { log: log }); }
  // the project-record mirror (projects.metadata.estimates_summary) — one entry per kind, the newest usable revision; *_summary keys are
  // ignored by sonor_project_activity (§55b), so publishing it never reads as a human edit
  function summaryEntry(est, opts) {
    opts = opts || {}; var t = est.totals || totals(est), md = est.metadata || {}, log = md.log || [];
    return { id: est.id || null, kind: est.kind, rev: est.rev || 1, status: est.status || 'draft', label: est.label || null, core_inc: t.core_inc || 0, with_options_inc: t.with_options_inc || 0, options_inc: t.options_inc || 0,
      sections: (est.sections || []).map(function (s) { var st = (t.sections || {})[s.key] || {}; return { key: s.key, service_nn: s.service_nn || null, title: s.title, total_inc: st.total_inc != null ? st.total_inc : null }; }),
      updated_at: opts.at || est.updated_at || new Date().toISOString(), issued_at: md.issued_at || null, read: (est.source || {}).read || null, last: log.length ? log[log.length - 1] : null, app: 'estimate-' + est.kind, engine: VERSION };
  }
  function mergeSummary(cur, entry) { var o = Object.assign({}, cur || {}); o.by_kind = Object.assign({}, o.by_kind || {}); o.by_kind[entry.kind] = entry; o.updated_at = entry.updated_at; o.version = 1; return o; }

  // Garden Lighting's published design (projects.metadata.garden_lighting_spec — that app is the single writer) → priced rows, grouped 'Garden lighting'.
  // Fittings by kind (the picked product named), drivers, a switch per zone, exterior cable; replaces the plan's exterior points (tk.garden.replaces).
  function gardenRows(cfg, spec) {
    cfg = cfg || {}; var kinds = cfg.kinds || {}, dflt = cfg.default || { sell_ex: 180, labour_h: 1 }, by = {}, drivers = 0, cable = 0, strip = 0, switches = 0, rows = [], hours = 0, picks = spec.picks || {};
    (spec.zones || []).forEach(function (z) {
      (z.fixtures || []).forEach(function (f) { by[f.kind] = (by[f.kind] || 0) + num(f.qty, 1); });
      (z.drivers || []).forEach(function (d) { drivers += num(d.qty, 1); });
      cable += num(z.cable_m, 0); strip += num(z.strip_m, 0); switches += z.switch && z.switch.shareWith ? 0 : num((z.switch || {}).qty, 1);
    });
    function add(code, label, qty, unit, r) { if (!qty) return; var u = num(r.sell_ex), lh = num(r.labour_h, 0); hours += lh * qty; rows.push({ label: label, qty: Math.round(qty * 10) / 10, unit: unit, unit_sell_ex: u, sell_ex: Math.round(u * qty * 100) / 100, takeoff_code: 'garden:' + code, price_source: 'rate', group: cfg.group || 'Garden lighting', labour_h: lh, from: 'garden_lighting_spec' }); }
    Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).forEach(function (k) { var r = kinds[k] || dflt, pk = picks[k]; add(k, (r.label || (k.charAt(0).toUpperCase() + k.slice(1) + ' light')) + (pk && pk.name ? ' — ' + [pk.manufacturer, pk.name].filter(Boolean).join(' ') : ''), by[k], 'no.', r); });
    if (cfg.driver) add('driver', cfg.driver.label || 'Exterior LED driver', drivers, 'no.', cfg.driver);
    if (cfg.switch) add('switch', (cfg.switch.label || 'Switching per zone') + (spec.control ? ' · ' + spec.control : ''), switches, 'no.', cfg.switch);
    if (spec.pir && cfg.pir) add('pir', cfg.pir.label || 'PIR sensor', 1, 'no.', cfg.pir);
    if (cfg.strip_m) add('strip', cfg.strip_m.label || 'Exterior LED strip', strip, 'm', cfg.strip_m);
    if (cfg.cable_m) add('cable', cfg.cable_m.label || 'Exterior cable, ducting and joints', cable, 'm', cfg.cable_m);
    return { rows: rows, hours: hours };
  }
  // the project's estimates of other kinds, newest usable rev each (sent wins over draft; superseded never)
  function pickLinked(rows, kinds) {
    var by = {}; (rows || []).forEach(function (e) { if (e.status === 'superseded' || (kinds && kinds.indexOf(e.kind) < 0)) return; var b = by[e.kind]; if (!b || (e.status === 'sent' && b.status !== 'sent') || (e.status === b.status && e.rev > b.rev)) by[e.kind] = e; });
    return Object.keys(by).map(function (k) { var e = by[k]; return { id: e.id, kind: e.kind, rev: e.rev, status: e.status, label: e.label, updated_at: e.updated_at || null, sections: e.sections || [], contingency: num((e.metadata || {}).contingency, 0) }; });
  }
  // the design apps' own summaries on the project record → estimate inputs (never typed twice, §66)
  function inputsFromSummaries(md) {
    md = md || {}; var o = {}, cd = md.cinema_design_summary || {}, rm = cd.room || {};
    if (rm.w_mm) o.w_mm = num(rm.w_mm); if (rm.d_mm) o.d_mm = num(rm.d_mm); if (rm.h_mm) o.h_mm = num(rm.h_mm);
    if (cd.seating && cd.seating.count) o.seats = num(cd.seating.count);
    if (cd.display) { var mm = /(\d{2,3})/.exec(String(cd.display.label || cd.display.mode || '')); if (mm) o.screen_in = num(mm[1]); o.projector = /^pj/i.test(String(cd.display.mode || '')) ? 1 : 0; }
    if (cd.audio && cd.audio.atmos_config) { var at = String(cd.audio.atmos_config).split('.'); if (at.length === 3) o.heights = num(at[2]); }
    var ts = md.takeoff_summary || {}; if (ts.rooms) o.rooms = num(ts.rooms); if (ts.floors) o.floors = num(ts.floors);
    if (!o.h_mm && md.ceiling_height_mm) o.h_mm = num(md.ceiling_height_mm);
    return o;
  }

  // metres from the mm inputs (w, d, h, depth) so expressions read naturally: (w + d) * 2 * h
  function derive(i) { [['w', 'w_mm'], ['d', 'd_mm'], ['h', 'h_mm'], ['depth', 'depth_mm']].forEach(function (k) { if (i[k[0]] == null && i[k[1]] != null) i[k[0]] = num(i[k[1]]) / 1000; }); return i; }
  function defaultsOf(tpl) { var o = {}; (tpl.inputs || []).forEach(function (i) { if (i.default != null) o[i.key] = i.default; }); return o; }

  // ── project linkage (§66) ─────────────────────────────────────────────────────────────────────────
  function record(est, opts) {
    opts = opts || {}; var t = totals(est), groups = {};
    (est.sections || []).forEach(function (s) { var st = t.sections[s.key] || {}; groups[s.key] = { title: s.title, service_nn: s.service_nn || null, total_inc: st.total_inc, options_inc: st.options_inc }; });
    return { id: 'estimate-' + est.kind + '-r' + (est.rev || 1), source: 'Sonor ' + (est.label || est.kind + ' estimate'), app: 'estimate-' + est.kind, estimate_id: est.id || null, kind: est.kind,
      rev: 'R' + (est.rev || 1), date: (opts.date || new Date().toISOString()).slice(0, 10), currency: 'GBP', ex_vat: false, groups: groups, totals: t, notes: est.basis || [] };
  }
  // ONE priced line per section, options as their own OPTIONAL lines (kind '-opt' so the delta never dedupes them against the core line).
  // Plan v2 shape (the Stretched Fabric single-line push): one floor 'EST', one area per section (§nn title), lines {product_id, qty 1,
  // unit each, sell, cost, single:true, optional}. product_id = section.wq_product_id || opts.product_id (the WeQuote "supply & install
  // per estimate" product — WQ-PRODUCTS-NEEDED #30); with neither, the line is listed under unmapped and the push is refused.
  function wqPlan(est, opts) {
    opts = opts || {}; var flat = [], rooms = [], unmapped = [], totals = { lines: 0, wqLines: 0, qty: 0, mapped: 0, unmapped: 0, fallback: 0, cost: 0, sell: 0, mode: 'single' };
    (est.sections || []).forEach(function (s, si) {
      var core = 0, cost = 0, hasCost = true, lines = [], pid = s.wq_product_id || opts.product_id || null, area = '§' + String(si + 1).padStart(2, '0') + ' ' + clientLabel(s.title);
      function add(label, sell, cst, optional) {
        sell = Math.round(sell * 100) / 100; var ln = { area: area, label: label, qty: 1, unit: 'each', sell: sell, cost: cst, total_sell: sell, total_cost: cst, single: true, optional: optional, kind: optional ? 'device-opt' : 'device', section: s.key, service_nn: s.service_nn || null };
        flat.push(ln); totals.lines++; totals.qty++; totals.sell += optional ? 0 : sell; if (cst != null && !optional) totals.cost += cst;
        if (!pid) { unmapped.push({ kind: 'estimate', label: label, qty: 1, unit: 'each' }); totals.unmapped++; return; }
        ln.product_id = Number(pid); ln.name = label; ln.basis = label; totals.wqLines++; totals.mapped++; lines.push(ln);
      }
      (s.rows || []).forEach(function (r) {
        if (r.hidden || r.existing) return; var sell = r.sell_ex != null ? num(r.sell_ex) : rowInc(r) / (1 + VAT);
        if (s.optional || r.optional) { add('OPTIONAL — ' + rowLabel(r) + ' · per estimate', sell, r.cost_ex != null ? num(r.cost_ex) : null, true); return; }
        core += sell; if (r.cost_ex != null) cost += num(r.cost_ex); else hasCost = false;
      });
      if (core > 0) add(clientLabel(s.title) + (opts.suffix || ' — supply and install per estimate'), core, hasCost ? Math.round(cost * 100) / 100 : null, false);
      if (lines.length || !pid) rooms.push({ name: area, code: s.key, archRef: '', items: [], lines: lines });
    });
    totals.sell = Math.round(totals.sell * 100) / 100;
    return { version: 'estimate-1', mode: 'smart-home', modeAuto: false, generated: new Date().toISOString(),
      project: { ref: opts.ref || '', name: opts.name || '' }, quote: opts.quote || null,
      floors: [{ name: opts.floor || 'Estimate', code: 'EST', rooms: rooms, unassigned: [], unassignedLines: [] }], scaffold: [], lines: flat, derived: null,
      unmapped: unmapped, unmappedShades: [], totals: totals, estimate_id: est.id || null, rev: est.rev || 1,
      source: { app: 'estimate-' + (est.kind || ''), engine: 'sonor-estimate ' + VERSION } };
  }
  function products(est, lib) {
    var seen = {}, out = [];
    (est.sections || []).forEach(function (s) { (s.rows || []).forEach(function (r) {
      if (!r.model_id || r.hidden || seen[r.model_id]) return; var p = lib ? (typeof lib === 'function' ? lib(r.model_id) : lib[r.model_id]) : null; if (!p) return; seen[r.model_id] = 1;
      var specs = []; if (p.specs) Object.keys(p.specs).slice(0, 5).forEach(function (k) { specs.push([k, String(p.specs[k])]); });
      out.push({ model_id: r.model_id, title: [p.make, p.model].filter(Boolean).join(' '), make: p.make || '', model: p.model || '', category: p.category || '', image: p.hero_image || null, blurb: p.description || '', specs: specs, qty: num(r.qty, 1), section: s.title, service_nn: s.service_nn || null, hex: hexOf(s), optional: !!(s.optional || r.optional) });
    }); });
    return out;
  }

  // ── PDF ───────────────────────────────────────────────────────────────────────────────────────────
  function lxOf() { return global.SonorPdfLuxury; }
  function fit(F, s, size, w) { s = String(s == null ? '' : s); while (s.length > 3 && F.widthOfTextAtSize(s, size) > w) s = s.slice(0, -2).replace(/\s+$/, ''); return s; }
  function goldCard(P, F, lx, x, top, w, h, label, value, note) { var C = lx.COL; P.rectB(x, top, w, h, C.GOLD, 0.8, 0.9); P.tracked(String(label).toUpperCase(), x + 12, top + 12, 6.2, F.r, C.GOLD, 1.4); P.text(fit(F.b, value, 13, w - 24), x + 12, top + 27, 13, F.b, C.INK); if (note) P.text(fit(F.r, note, 7.6, w - 24), x + 12, top + 48, 7.6, F.r, C.MUT); }
  function cards(P, F, lx, b, x, y, W) {
    var cw = (W - 16) / 3;
    goldCard(P, F, lx, x, y, cw, 62, 'Core', 'about ' + money(b.core_inc), 'everything not marked option · inc. VAT');
    if (b.options_inc) goldCard(P, F, lx, x + cw + 8, y, cw, 62, 'With options', 'about ' + money(b.core_inc + b.options_inc), '+ ' + money(b.options_inc) + ' · all options');
    if (b.allowance_inc) goldCard(P, F, lx, x + (cw + 8) * 2, y, cw, 62, 'Of which allowances', money(b.allowance_inc), 'priced before order · see Basis');
    return y + 62;
  }
  function drawBasis(P, F, lx, b, x, y, colW, withFlags) {
    var C = lx.COL;
    if (b.basis && b.basis.length) { P.tracked('BASIS', x, y, 6.5, F.r, C.MUT, 1.5); P.hline(x, x + colW, y + 11, C.GOLD, 0.8, 0.75); y += 24; b.basis.slice(0, 9).forEach(function (t) { var ls = lx.wrap(String(t), F.r, 8.4, colW - 18).slice(0, 2); P.dot(x + 3, y - 4, 2.2, C.GOLD); ls.forEach(function (ln, i) { P.text(ln, x + 14, y - 9 + i * 11, 8.4, F.r, C.INK2); }); y += 14 + (ls.length - 1) * 11; }); }
    if (withFlags !== false) (b.flags || []).forEach(function (f) { var rgb = lx.hexRgb(f.hex || '#ec6061'); y += 4; P.rect(x, y - 12, 4, 40, rgb, 1); P.rect(x + 4, y - 12, colW - 4, 40, rgb, 0.08); P.tracked(String(f.label || '').toUpperCase(), x + 14, y - 2, 6.2, F.r, rgb, 1.4); P.text(fit(F.b, f.text, 8.6, colW - 28), x + 14, y + 9, 8.6, F.b, C.INK); y += 44; });
    return y;
  }
  // THE shared Preliminary budget page — byte-for-byte the Stretched Fabric v0.4.2 secBudget layout.
  // opts: { doc: 'CINEMA ESTIMATE', head: 'PRELIMINARY BUDGET', eyebrow, title, intro, basis: true|false (draw Basis + flags at the foot) }
  // budgetPages(b, opts) — the same page, continued over as many pages as the sections need (1.1.0: a whole house runs to ~80 rows)
  // 1.2.0 (Bryn 2026-11-09: "make everything one service per row on a3 … a4 portrait and a3 landscape will be the options"): ONE service per
  // row on both formats. A3 landscape = a full-width band per service (title, total and note on the left; its lines in two balanced columns
  // on the right). A4 portrait = the same band stacked (title + total on one line, the lines below in one column).
  function bLayout(lx) {
    var A4 = lx.A4, M = lx.M, W = A4.w - M * 2, land = A4.w > A4.h;
    GAP = land ? 7 : 5; GH = land ? 14 : 12;   // sub-group gap + label height (set per format; read by bItems / colH / drawCol)
    return land ? { land: true, W: W, RH: 15, FS: 9.6, TS: 13.5, headW: 250, gap: 30, sub: 2, bottom: A4.h - 62 }
                : { land: false, W: W, RH: 12.6, FS: 8.4, TS: 11.5, headW: 0, gap: 0, sub: 1, bottom: A4.h - 60 };
  }
  // the section's lines as items: a small gap + group label wherever the sub-group changes (only when the section has 2+ groups)
  var GAP = 7, GH = 14;
  function bItems(rows, L) {
    var gset = {}; rows.forEach(function (r) { if (r.group) gset[r.group] = 1; }); var multi = Object.keys(gset).length > 1, out = [], prev;
    rows.forEach(function (r) { var g = r.optional ? '__opt' : (r.group || ''); if (multi && g !== prev) { out.push({ k: 'h', label: g === '__opt' ? 'Options' : (r.group || 'Other'), h: GAP + GH }); prev = g; } out.push({ k: 'r', row: r, h: L.RH }); });
    return out;
  }
  // split items into n columns, balanced by height; a group label never ends a column; no leading gap at a column top
  function bCols(items, n) {
    if (n < 2) return [items];
    var H = items.reduce(function (a, it) { return a + it.h; }, 0), acc = 0, cut = items.length;
    for (var i = 0; i < items.length; i++) { if (acc + items[i].h / 2 > H / 2) { cut = i; break; } acc += items[i].h; }
    if (cut > 0 && items[cut - 1].k === 'h') cut--;
    var a = items.slice(0, cut), b = items.slice(cut);
    if (b.length && b[0].k === 'r') { for (var j = a.length - 1; j >= 0; j--) if (a[j].k === 'h') { b.unshift({ k: 'h', label: a[j].label, h: GAP + GH, cont: true }); break; } }
    return [a, b];
  }
  function colH(items) { return items.reduce(function (a, it, i) { return a + (i === 0 && it.k === 'h' ? GH : it.h); }, 0); }
  function bSecH(sec, L, F, lx) {
    var cs = bCols(bItems(sec.rows || [], L), L.sub), n = 0, rowsH = Math.max.apply(null, cs.map(colH));
    if (L.land) {
      var noteL = sec.note ? lx.wrap(String(sec.note), F.r, 7.8, L.headW - 24).slice(0, 3).length : 0;
      var titleL = lx.wrap(String(sec.title || ''), F.b, L.TS, L.headW - 46).slice(0, 2).length;
      var headH = 4 + titleL * (L.TS + 3) + (sec.total != null ? 20 : 0) + (sec.options_inc ? 13 : 0) + noteL * 10.5 + 4;
      return Math.max(headH, rowsH) + 18;
    }
    return 22 + rowsH + (sec.note ? 12 : 0) + 16;
  }
  function bBasisH(b) { return 20 + Math.min((b.basis || []).length, 9) * 14 + (b.flags || []).length * 44; }
  function budgetPages(b, opts) {
    opts = opts || {}; if (!b || !b.sections || !b.sections.length) return [];
    var lx = lxOf(), L = bLayout(lx), F = opts.F || null;
    var hOf = function (sec) { return F ? bSecH(sec, L, F, lx) : (L.land ? Math.max(70, Math.ceil((sec.rows || []).length / 2) * L.RH) + 22 : 22 + (sec.rows || []).length * L.RH + 28); };
    var top0 = 248, topN = 180, capFirst = L.bottom - top0, capNext = L.bottom - topN, cap = capFirst, used = 0, cur = [], chunks = [];
    b.sections.forEach(function (sec) { var h = hOf(sec); if (cur.length && used + h > cap) { chunks.push(cur); cur = []; used = 0; cap = capNext; } cur.push(sec); used += h; });
    chunks.push(cur);
    var basisFits = opts.basis === false || used + bBasisH(b) <= cap;
    var si0 = 0;
    return chunks.map(function (secs, i) { var o = Object.assign({}, opts, { cont: i > 0, si0: si0, totals: b, basis: i === chunks.length - 1 && basisFits ? opts.basis : false }); si0 += secs.length; return budgetPage(Object.assign({}, b, { sections: secs }), o); });
  }
  function budgetPage(b, opts) {
    opts = opts || {}; if (!b || !b.sections || !b.sections.length) return null;
    return function (P, F, pageNo, TOTAL) {
      var lx = lxOf(), M = lx.M, A4 = lx.A4, COL = lx.COL, L = bLayout(lx), W = L.W;
      lx.pageHead(P, F, opts.head || 'PRELIMINARY BUDGET', pageNo, TOTAL, opts.doc || 'ESTIMATE', { brand: 'large' });
      var y0 = Math.max(lx.sectionHead(P, F, opts.cont ? 'BUDGET · CONTINUED' : (opts.eyebrow || 'BUDGET · NOT A QUOTATION'), opts.title || 'Preliminary budget', opts.cont ? null : (b.intro || opts.intro || 'Allowances by system, including VAT. The quotation carries the detail; options are shown as the change they make.')), 170);
      if (!opts.cont) cards(P, F, lx, opts.totals || b, M, y0, W);
      var y = y0 + (opts.cont ? 10 : 78), RH = L.RH, FS = L.FS, withBasis = opts.basis !== false;
      function rowAt(r, x, w, yy) {
        var tg = [r.existing ? 'EXISTING' : null, r.optional ? 'OPTION' : null, r.allowance ? 'ALLOWANCE' : null].filter(Boolean).join(' · '), tgW = tg ? F.r.widthOfTextAtSize(tg, 5.8) + 14 : 0;
        var lab = fit(F.r, r.label, FS, w - 78 - tgW);
        P.text(lab, x, yy - 2, FS, F.r, COL.INK2);
        if (tg) P.tracked(tg, x + F.r.widthOfTextAtSize(lab, FS) + 6, yy + 1, 5.8, F.r, r.optional ? COL.GOLD : COL.MUT, 1.2);
        if (r.existing) P.right('retained', x + w, yy - 2, FS, F.r, COL.MUT); else P.right(r.optional ? signed(r.inc) : money(r.inc), x + w, yy - 2, FS, F.r, COL.INK);
      }
      function drawCol(items, x, w, yy) {
        items.forEach(function (it, i) {
          if (it.k === 'h') { if (i > 0) yy += GAP; P.tracked(String(it.label).toUpperCase() + (it.cont ? ' · CONTINUED' : ''), x, yy, 5.8, F.r, COL.MUT, 1.3); yy += GH; return; }
          rowAt(it.row, x, w, yy); yy += RH;
        });
        return yy;
      }
      b.sections.forEach(function (sec, si) {
        var rows = sec.rows || [], hex = lx.hexRgb(hexOf(sec)), secTop = y, nn = '§' + String(si + 1 + (opts.si0 || 0)).padStart(2, '0');
        if (L.land) {
          // left: § · title · total · options · note
          var hx = M + 14, hw = L.headW - 14, yy = y;
          P.tracked(nn, hx, yy + 1, 7.2, F.r, hex, 2.2);
          lx.wrap(String(sec.title || ''), F.b, L.TS, hw - 32).slice(0, 2).forEach(function (ln, i) { P.text(ln, hx + 32, yy - 3 + i * (L.TS + 3), L.TS, F.b, COL.INK); });
          yy += lx.wrap(String(sec.title || ''), F.b, L.TS, hw - 32).slice(0, 2).length * (L.TS + 3) + 4;
          if (sec.optional) { var lw0 = F.b.widthOfTextAtSize('OPTION', 6.5) + 24; P.rrect(hx + 32, yy - 4, lw0, 13, 2, COL.GOLD, 0.8, 0.9); P.tracked('OPTION', hx + 39, yy, 6.5, F.b, COL.GOLD, 1.4); yy += 16; }
          if (sec.total != null) { P.text(money(sec.total), hx + 32, yy + 3, 12, F.b, COL.INK); yy += 20; }
          if (sec.options_inc) { P.text('options ' + signed(sec.options_inc), hx + 32, yy + 1, 7.8, F.r, COL.GOLD); yy += 13; }
          if (sec.note) lx.wrap(String(sec.note), F.r, 7.8, hw - 32).slice(0, 3).forEach(function (ln) { P.text(ln, hx + 32, yy - 4, 7.8, F.r, COL.MUT); yy += 10.5; });
          // right: the lines, two balanced columns
          var rx = M + L.headW + L.gap, rw = W - L.headW - L.gap, cw = (rw - L.gap) / 2, cs = bCols(bItems(rows, L), 2), hR = 0;
          cs.forEach(function (items, c) { hR = Math.max(hR, drawCol(items, rx + c * (cw + L.gap), cw, y + 1) - y - 1); });
          var h = Math.max(yy - y, hR);
          P.rect(M, secTop - 6, 3, h + 4, hex);   // service colour bar (Takeover pattern)
          y += h + 8; P.hline(M + 14, M + W, y - 2, COL.GOLD, 0.4, 0.45); y += 10;
        } else {
          P.tracked(nn, M + 12, y + 1, 7, F.r, hex, 2.2);
          var tw = sec.total != null ? F.b.widthOfTextAtSize(money(sec.total), 11) + 16 : 0;
          var t1 = fit(F.b, sec.title, L.TS, W - 42 - tw - (sec.optional ? 60 : 0)); P.text(t1, M + 42, y - 2, L.TS, F.b, COL.INK);
          if (sec.optional) { var lw1 = F.b.widthOfTextAtSize('OPTION', 6.5) + 24, px1 = M + 42 + F.b.widthOfTextAtSize(t1, L.TS) + 10; P.rrect(px1, y - 3, lw1, 13, 2, COL.GOLD, 0.8, 0.9); P.tracked('OPTION', px1 + 7, y + 1, 6.5, F.b, COL.GOLD, 1.4); }
          if (sec.total != null) P.right(money(sec.total), M + W, y - 2, 11, F.b, COL.INK);
          y += 20;
          y = drawCol(bItems(rows, L), M + 12, W - 12, y);
          if (sec.note) { P.text(fit(F.r, sec.note, 7.4, W - 12), M + 12, y - 1, 7.4, F.r, COL.MUT); y += 12; }
          P.rect(M, secTop - 4, 3, y - secTop - 4, hex);
          y += 4; P.hline(M + 12, M + W, y - 2, COL.GOLD, 0.4, 0.45); y += 12;
        }
      });
      if (withBasis) drawBasis(P, F, lx, b, M, y + 4, L.land ? W / 2 : W, true);
      lx.pageFoot(P, F);
    };
  }

  // ── the one-pack estimate PDF ─────────────────────────────────────────────────────────────────────
  // m = { budget (budget() output), doc: 'Cinema estimate', title, subtitle, client, project, ref, date,
  //       sections: ['cover','overview','products','budget','basis','rear'], paper: 'A3'|'A4', orient: 'landscape'|'portrait',
  //       base (asset dir with fonts/ + cover), coverUrl, cediaUrl, overview: {intro, rows:[[label,value]], points:[]}, products: [], basisExtra: {included:[], excluded:[]},
  //       returnBytes, filename }
  // Drawn on the A3-landscape canvas for landscape (A4 = scaled 1/√2 at page level) and the A4 canvas for portrait (A3 = scaled √2) — the LED Calc paper rule.
  async function generate(m) {
    var lx = lxOf(), PL = global.PDFLib; if (!lx || !PL) throw new Error('SonorPdfLuxury + PDFLib must be loaded');
    var land = m.orient !== 'portrait', paper = m.paper === 'A4' ? 'A4' : 'A3';
    var canvas = land ? 'A3-landscape' : 'A4', scale = land ? (paper === 'A4' ? 1 / Math.SQRT2 : 1) : (paper === 'A3' ? Math.SQRT2 : 1);
    var prevSheet = lx.sheet(); lx.sheet(canvas); lx.theme('neutral');
    var DOC = String(m.doc || 'Estimate').toUpperCase(), want = m.sections || ['cover', 'overview', 'products', 'budget', 'basis', 'rear'];
    var has = function (k) { return want.indexOf(k) >= 0; };
    var doc = await PL.PDFDocument.create(); doc.setTitle((m.doc || 'Estimate') + ' — ' + (m.title || '')); doc.setAuthor('Sonor Ltd');
    var base = m.base || '../data/', F = await lx.makeFonts(doc, base), b = m.budget;
    lx.footerMode('minimal', m.project || m.title || '');
    var hero = null, heroArt = false, cedia = null, fadeImg = null;
    try { if (m.heroUrl) hero = await lx.loadImage(doc, m.heroUrl); } catch (e) {}
    if (!hero) { try { hero = await lx.loadCoverArt(doc, m.coverUrl || (base + 'estimate-cover.jpg'), land); heroArt = true; } catch (e) { try { hero = await lx.loadCoverArt(doc, base + 'contract-hero.jpg', land); heroArt = true; } catch (e2) {} } }
    try { cedia = await lx.loadImage(doc, m.cediaUrl || (base + 'cedia-member-stacked.png')); } catch (e) {}
    try { var fd = lx.fadePngDataUrl(); if (fd) fadeImg = await doc.embedPng(await lx.fetchBytes(fd)); } catch (e) {}
    var prodImgs = {};
    if (has('products')) for (var i = 0; i < (m.products || []).length; i++) { var pr = m.products[i]; if (pr.image && !prodImgs[pr.image]) { try { prodImgs[pr.image] = await lx.loadImage(doc, pr.image); } catch (e) {} } }

    var pages = [];
    if (has('overview')) pages.push(pageOverview(m, b, DOC));
    if (has('products') && (m.products || []).length) { var per = land ? 8 : 4; for (var k = 0; k < m.products.length; k += per) pages.push(pageProducts(m, m.products.slice(k, k + per), DOC, prodImgs, k > 0)); }
    if (has('budget') && b && b.sections.length) budgetPages(b, { doc: DOC, basis: !has('basis'), F: F }).forEach(function (pg) { pages.push(pg); });
    if (has('basis')) pages.push(pageBasis(m, b, DOC));
    var withCover = has('cover'), TOTAL = pages.length + (withCover ? 1 : 0) + (has('rear') ? 1 : 0);
    if (withCover) {
      var p1 = doc.addPage([lx.A4.w, lx.A4.h]), cw3 = (lx.A4.w - lx.M * 2) / 3 - 18;
      lx.cover(lx.mk(p1, doc), F, { layout: heroArt ? 'art' : undefined, hero: hero, fadeImg: fadeImg, cediaImg: cedia, brandLarge: true, airy: true, footLogos: [],
        eyebrow: DOC, title: m.title || 'Your home', subtitle: m.subtitle || 'Preliminary budget',
        info: [['PREPARED FOR', fit(F.b, m.client || '—', 12.5, cw3)], ['PROJECT', fit(F.b, m.project || '—', 12.5, cw3)], ['REFERENCE', [m.ref, m.date].filter(Boolean).join('  ·  ') || '—']] });
    }
    pages.forEach(function (draw, idx) { var pg = doc.addPage([lx.A4.w, lx.A4.h]); var P = lx.mk(pg, doc); P.rect(0, 0, lx.A4.w, lx.A4.h, lx.COL.CREAM); draw(P, F, idx + (withCover ? 2 : 1), TOTAL); });
    if (has('rear')) { var pr2 = doc.addPage([lx.A4.w, lx.A4.h]); lx.rearPage(lx.mk(pr2, doc), F, { cediaImg: cedia }); }
    if (scale !== 1) doc.getPages().forEach(function (pg) { pg.scale(scale, scale); });
    var bytes = await doc.save();
    lx.sheet(prevSheet); lx.theme('luxury'); lx.footerMode('classic', '');
    if (m.returnBytes) return bytes;
    var blob = new Blob([bytes], { type: 'application/pdf' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = m.filename || 'sonor-estimate.pdf'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return true;
  }
  function pageOverview(m, b, DOC) {
    return function (P, F, pageNo, TOTAL) {
      var lx = lxOf(), M = lx.M, A4 = lx.A4, C = lx.COL, W = A4.w - M * 2, ov = m.overview || {}, land = A4.w > A4.h;
      lx.pageHead(P, F, 'OVERVIEW', pageNo, TOTAL, DOC, { brand: 'large' });
      var y = Math.max(lx.sectionHead(P, F, ov.eyebrow || 'AT A GLANCE', ov.title || m.title || 'Your project', ov.intro || null), 170);
      if (b) y = cards(P, F, lx, b, M, y, land ? W * 0.62 : W) + 28;
      var colW = land ? (W - 40) / 2 : W, x2 = land ? M + colW + 40 : M, yL = y, yR = land ? y : null;
      if ((ov.rows || []).length) { P.tracked(ov.rowsHead || 'THE ROOM', M, yL, 6.5, F.r, C.MUT, 1.5); P.hline(M, M + colW, yL + 11, C.GOLD, 0.8, 0.75); yL = lx.specRows(P, F, ov.rows, M, yL + 24, colW); }
      var y2 = land ? yR : yL + 12;
      if (b && b.sections.length) { P.tracked('BY SYSTEM · INC. VAT', x2, y2, 6.5, F.r, C.MUT, 1.5); P.hline(x2, x2 + colW, y2 + 11, C.GOLD, 0.8, 0.75); y2 += 26;
        b.sections.forEach(function (s, i) { var hex = lx.hexRgb(hexOf(s)); P.rect(x2, y2 - 4, 3, 16, hex); P.tracked('§' + String(i + 1).padStart(2, '0'), x2 + 10, y2 + 1, 6.5, F.r, hex, 2); P.text(fit(F.b, s.title, 10.5, colW - 140), x2 + 36, y2 - 1, 10.5, F.b, C.INK);
          P.right(s.total != null ? money(s.total) : 'option', x2 + colW, y2 - 1, 10, F.r, C.INK); if (s.options_inc && s.total != null) P.right('+ ' + money(s.options_inc) + ' options', x2 + colW, y2 + 11, 7, F.r, C.GOLD); y2 += 26; }); }
      var yP = Math.max(yL, y2 || 0) + 10;
      if ((ov.points || []).length) { P.tracked('GOOD TO KNOW', M, yP, 6.5, F.r, C.MUT, 1.5); P.hline(M, A4.w - M, yP + 11, C.GOLD, 0.8, 0.75); yP += 24; ov.points.slice(0, 6).forEach(function (t) { lx.wrap(String(t), F.r, 9.2, lx.TW() - 18).slice(0, 2).forEach(function (ln, li) { if (!li) P.dot(M + 3, yP - 4, 2.2, C.GOLD); P.text(ln, M + 14, yP - 9, 9.2, F.r, C.INK2); yP += 13; }); yP += 3; }); }
      lx.pageFoot(P, F, { pageNo: pageNo });
    };
  }
  function pageProducts(m, list, DOC, imgs, cont) {
    return function (P, F, pageNo, TOTAL) {
      var lx = lxOf(), M = lx.M, A4 = lx.A4, C = lx.COL, W = A4.w - M * 2, land = A4.w > A4.h;
      lx.pageHead(P, F, 'THE PRODUCTS', pageNo, TOTAL, DOC, { brand: 'large' });
      var y = Math.max(lx.sectionHead(P, F, cont ? 'THE PRODUCTS · CONTINUED' : 'THE PRODUCTS', cont ? 'The products' : 'What goes in', cont ? null : 'The main products in this estimate, as named. An equivalent of the same standard may be offered at quotation.'), 160);
      var cols = land ? 4 : 2, gap = 18, cw = (W - gap * (cols - 1)) / cols, rowsN = Math.ceil(list.length / cols), ch = Math.min(300, (A4.h - 80 - y - gap * (rowsN - 1)) / rowsN);
      list.forEach(function (p, i) {
        var cx = M + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap), hex = lx.hexRgb(p.hex || '#ad9978'), img = p.image && imgs[p.image];
        P.rectB(cx, cy, cw, ch, C.GOLD, 0.8, 0.9); P.rect(cx, cy, 3, ch, hex);
        var ih = ch * 0.48;
        if (img) { var s = Math.min((cw - 30) / img.width, (ih - 16) / img.height), dw = img.width * s, dh = img.height * s; P.image(img, cx + (cw - dw) / 2, cy + 8 + (ih - 16 - dh) / 2, dw, dh, 1); }
        else { P.logo(cx + cw / 2 - 12, cy + ih / 2 - 12, 24, C.LINE); }
        var ty = cy + ih + 6;
        P.tracked(String(p.section || p.category || '').toUpperCase() + (p.optional ? '  ·  OPTION' : ''), cx + 14, ty, 6, F.r, p.optional ? C.GOLD : C.MUT, 1.4);
        P.text(fit(F.b, (p.qty > 1 ? p.qty + ' × ' : '') + p.title, 11.5, cw - 28), cx + 14, ty + 11, 11.5, F.b, C.INK);
        var sy = ty + 32; (p.specs || []).slice(0, Math.max(1, Math.floor((cy + ch - sy - 8) / 12))).forEach(function (r) { P.text(fit(F.r, r[0], 7.4, cw * 0.36), cx + 14, sy, 7.4, F.r, C.MUT); P.right(fit(F.r, r[1], 7.4, cw * 0.56), cx + cw - 14, sy, 7.4, F.r, C.INK2); sy += 12; });
      });
      lx.pageFoot(P, F, { pageNo: pageNo });
    };
  }
  function pageBasis(m, b, DOC) {
    return function (P, F, pageNo, TOTAL) {
      var lx = lxOf(), M = lx.M, A4 = lx.A4, C = lx.COL, W = A4.w - M * 2, land = A4.w > A4.h, x = m.basisExtra || {};
      lx.pageHead(P, F, 'BASIS', pageNo, TOTAL, DOC, { brand: 'large' });
      var y = Math.max(lx.sectionHead(P, F, 'WHAT THE BUDGET ASSUMES', 'Basis', 'What the figures include and leave out. The quotation that follows the survey governs.'), 170);
      var colW = land ? (W - 40) / 2 : W, yL = drawBasis(P, F, lx, b || { basis: [], flags: [] }, M, y, colW, true);
      var x2 = land ? M + colW + 40 : M, y2 = land ? y : yL + 16;
      [['INCLUDED', x.included], ['NOT INCLUDED', x.excluded]].forEach(function (pair) { var items = pair[1] || []; if (!items.length) return; P.tracked(pair[0], x2, y2, 6.5, F.r, C.MUT, 1.5); P.hline(x2, x2 + colW, y2 + 11, C.GOLD, 0.8, 0.75); y2 += 24; items.forEach(function (t) { lx.wrap(String(t), F.r, 8.6, colW - 18).slice(0, 3).forEach(function (ln, li) { if (!li) P.dot(x2 + 3, y2 - 4, 2.2, C.GOLD); P.text(ln, x2 + 14, y2 - 9, 8.6, F.r, C.INK2); y2 += 12; }); y2 += 4; }); y2 += 10; });
      lx.pageFoot(P, F, { pageNo: pageNo });
    };
  }

  var API = { VERSION: VERSION, VAT: VAT, r10: r10, money: money, signed: signed, clientLabel: clientLabel, rowInc: rowInc, rowLabel: rowLabel, hexOf: hexOf,
    budget: budget, totals: totals, evalQty: evalQty, priceOf: priceOf, fromTemplate: fromTemplate, fromTakeoff: fromTakeoff, fromDesignBudget: fromDesignBudget, gardenRows: gardenRows, takeoffCounts: takeoffCounts, pickLinked: pickLinked, inputsFromSummaries: inputsFromSummaries, SOURCES: SOURCES, readsOf: readsOf, sourceAt: sourceAt, sourceLabel: sourceLabel, sourceStamps: sourceStamps, staleSources: staleSources, logEntry: logEntry, summaryEntry: summaryEntry, mergeSummary: mergeSummary, defaultsOf: defaultsOf, derive: derive, record: record, wqPlan: wqPlan, products: products,
    pdf: { budgetPage: budgetPage, budgetPages: budgetPages, generate: generate, cards: cards, basis: drawBasis } };
  global.SonorEstimate = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
