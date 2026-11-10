/**
 * sonor-led-engineering.js — CANONICAL MASTER (workspace root → data/ in every app via sync-everything)
 * v1.0.0 · 2026-10-16 — Bryn: "what do we have for calcing led strips and drivers and cable feed points etc, does this need
 *   more work? and outputting to pdf schedule needs perfecting."
 *
 * ONE LED engineering calc for the whole workspace. Takeoffs (LED Schedule aspect + cable schedule feeds), Lighting Design
 * (LED & Drivers step + proposal PDF) and anything else that sizes a strip run call THIS — never a local 80 % rule.
 *
 *   SonorLedEng.run(run, stripType, opts)      → one engineered run (segments, feeds, driver, cable, flags)
 *   SonorLedEng.project(runs, stripsById, opts) → every run engineered + totals (strip m by type +waste, drivers by size,
 *                                                  controller channels, feed cable by csa) + schedule rows for a PDF
 *   SonorLedEng.driverFor(loadW, opts)        → { driver_w, drivers, loaded_pct }
 *   SonorLedEng.feedCable(loadW, volts, lengthM, opts) → { csa, amps, drop_v, drop_pct, ok }
 *   1.3.0 — SonorLedEng.load(supabaseClient) → reads the Library (v_led_catalogue + library_settings.led_engineering);
 *            SonorLedEng.pickDriver(loadW, {kind,volts,current_ma,control,minIp,prefer,driverProductId}) → a real Library driver;
 *            SonorLedEng.strips() / drivers() / strip(id) / fromTakeoffsFloors(floors). App UI: APP - LED Calc (sonor-led-calc).
 *   1.5.0 — run.location 'head-end' | 'local' (rule driverLocation), run.headEnd (opts.headEnds [{id,label,location,floor}]);
 *            project().electrical = { boards, spurs, dimmer, nodes, rows, totals } — what the electrician provides (head-end radials on
 *            type C MCBs sized from PSU INPUT watts, dimmed feeds per triac circuit, fused spurs at local drivers). Takeoffs' Electrical
 *            Requirements page, Engineering and LED Calc all read this one shape (published as projects.metadata.led_spec.electrical).
 *   1.4.0 — generic house strip types are the master; supplier products hang under them (lighting_items.metadata.led.strip_types):
 *            SonorLedEng.supplyOptions(typeId, {minIp,style}) / supplyFor(type, {productId,minIp}) — default = stripSupply.style (COB) from the
 *            first supplier in stripSupply.supplierOrder (UltraLEDs, AliExpress, other). Control kit from pm_lighting_control_types.metadata.led:
 *            decoders (per room zone), DMX interfaces / Art-Net nodes (opts.nodes [{id,label,productId}], run.node → own universes per node;
 *            Art-Net default = Sonor custom ESP32 node), pixel controllers (every pixel run = own controller output).
 *
 * Inputs (all plain objects, no DOM):
 *   run  = { id, label, floor, room, metres, ledId, feeds: [m, m, …] | null, feedCableM: number | [per feed], driverAt: text,
 *            custom_feed_interval_m, dimming: 'dmx'|'0-10v'|'pwm'|'dali'|null }
 *   stripType (pm_led_strip_types row) = { id, label, watts_per_metre, volts, dmx_channels, kelvin, ip_rating,
 *            metadata: { max_single_feed_m?, lm_per_m?, default_cable_run_m?, default_cable_package? } }
 *
 * Engineering rules (Sonor house, 2026-08-20 lighting research + Bryn 2026-05-11 feed markers):
 *   · Load = metres × W/m. Driver ≥ load ÷ 0.8 (20 % headroom), next STANDARD size up (30 60 100 150 200 240 320 W);
 *     above the biggest → split into n drivers; a run never shares a driver across rooms.
 *   · Feed points: a strip is fed at most every MAX_SINGLE_FEED m (per type; default by W/m and V — see maxFeedM) so the
 *     far end holds ≥ 97 % of nominal volts. Manual markers win; otherwise ceil(metres / interval) evenly spaced from 0.
 *   · Feed cable: copper, two-core, voltage drop = 2 × L × I × ρ ÷ A with ρ = 0.0175 Ω·mm²/m; target ≤ 3 % (24 V ≈ 0.72 V),
 *     hard limit 5 %. csa from the trade sizes 0.75 / 1.0 / 1.5 / 2.5 / 4.0 / 6.0 mm². Each feed carries the load of the
 *     strip either side of it up to half-way to the next feed.
 *   · Controller channels: dmx_channels per strip type (RGBW 4, TW 2, SC 1, pixel ≥ 10 → data, not channels) → decoders
 *     sized at 4 ch per decoder (configurable), 1 per room group.
 *   · Waste: strip metres +10 % and rounded up to the 5 m reel (configurable).
 */
(function (global) {
  'use strict';
  var VERSION = '1.7.2';   // v1.7.2 2026-11-01 — the house pixel strip is 24 V (Library PIXEL; 5 V kept as PIXEL-5V) and pixel types are not held to the COB house style
  // was 1.7.1:   // v1.7.1 2026-11-01 — an outdoor strip's PSU at a HEAD END is an indoor (IP20) driver; IP65+ only when the PSU is local beside an outdoor strip
  // was 1.7.0:   // v1.7.0 2026-11-01 — CABLING kept apart from CONTROL and every cable type distinct (Bryn: "sepaate controls and cabling in tables and be distinct about the difff elements"): eng.cabling = LV field cable by role + core count (2C 24 V feed · nC decoder output = channels + common · 3C pixel V+ / data / 0 V) and csa, DMX data (link leads + 120 Ω terminators), Cat6 to the network, board wiring, and the 230 V circuits the electrical contractor provides; run.cable.cores / label
  // was 1.6.0:   // v1.6.0 2026-11-01 — every head-end item carries its Library MOUNT (metadata.mount → din | rack | surface; Bryn: "led panels are not necessarily din rail, they are psus and decoders mounted on the surface of 18mm ply usually. only make it din if a device has that property … a device is either din, racked or not") — SonorLedEng.mountOf(row)
  // was 1.5.0:   // v1.5.0 2026-11-01 — local drivers are fed by an FCU or a plug-in socket (Bryn: "local also needs options for plug-in or fcu which should be a criteria that carries through all apps" — run.localSupply 'fcu' | 'plug', rule localSupply) · head end or local per run (Bryn: "there should be a toggle for head end or local per circuit"), head-end boards, mains / dimmed-feed / fused-spur ELECTRICAL REQUIREMENTS shared with the other apps ("include electrical requirements which are linked with other apps") — SonorLedEng.electrical(); drawings in sonor-led-drawings.js
  // was 1.4.0:   // v1.4.0 2026-11-01 — generic strip types stay master, supplier products sit under each type (Bryn: "keep the library generic strip types as the master but make ultra leds an option for supplier of each type as a sub of it, ali express and other suppliers also"), default = COB from UltraLEDs (Bryn: "only use cob type strips from ultra leds"); DMX lines patch to Art-Net nodes / interfaces — several per project (Bryn: "option for which node a dmx line connects to, sometimes there will be multiple"), Art-Net default = Sonor custom ESP node · pixel strip = its own controller (Bryn: "single colour as triac dimmed psu, rgbw is dmx, pixel is own controller"); DMX decoders, DMX interfaces and pixel controllers are Library products (pm_lighting_control_types.metadata.led) picked per zone / universe / control system (Bryn: "include d4e and other dmx decoders and c4 edidio + artnet nodes")
  // was 1.3.1:   // v1.3.1 2026-10-31 — prefer matches a manufacturer OR a range / name (Bryn: "we usually use tagra drivers from ultra leds so default to those" → rule preferManufacturer = 'Tagra')
  // was 1.3.0:   // v1.3.0 2026-10-31 — Library SSOT: SonorLedEng.load() reads v_led_catalogue (house strip types + strip products + drivers) and library_settings.led_engineering (house rules); drivers are picked from real Library products by kind / V / mA / control / IP / preferred (Bryn: "we need a central ssot … yes everything library ssot"). Built-in sizes stay as the offline fallback.
  // was 1.2.0:   // v1.1.0 2026-10-16 — control method (DMX / triac / 0-10V / DALI / switched) + DMX addressing on xx1 blocks (Bryn: "RGBW led will be dmx controlled … main also have triac dimmable driver, need options for all this … including DMX channel assignment")

  var DEFAULTS = {
    headroom: 0.8,                                   // driver ≥ load / headroom
    driverSizes: [30, 60, 100, 150, 200, 240, 320],  // W — standard CV sizes stocked
    maxDriverPerRoom: 6,
    dropTargetPct: 3, dropLimitPct: 5,
    rho: 0.0175,                                     // Ω·mm²/m copper
    csaSizes: [0.75, 1.0, 1.5, 2.5, 4.0, 6.0],
    defaultFeedCableM: 10,
    wastePct: 10, reelM: 5,
    decoderChannels: 4,
    dmxUniverseSize: 512,                            // DMX512 — addresses 1…512 per universe
    dmxBlock: 10,                                    // Sonor house rule (Bryn 16.10.26): every device starts on an xx1 address — 001, 011, 021 … (10-address blocks; a device needing more spans blocks)
    pixelControllerOutputs: 4,                       // outputs per pixel controller (data runs)
    outdoorMinIp: 65,                                // 1.3.0 — outdoor runs only take drivers rated ≥ this
    controlSystem: 'artnet',                         // 1.4.0 — DMX interface family: artnet | control4 | lutron | rako (per project in LED Calc)
    preferManufacturer: null,                        // 1.3.0 — tie-break when two Library drivers share a size
    stripSupply: { style: 'cob', supplierOrder: ['ultraleds', 'aliexpress', 'other'] },   // 1.4.0 — supplier option picked under each generic strip type
    driverLocation: 'head-end',                      // 1.5.0 — where a run's PSU (and decoder) sits unless the run says: 'head-end' | 'local'
    headEndFeedCableM: null,                         // 1.5.0 — head-end feed cable when not drawn (null → defaultFeedCableM)
    localFeedCableM: 2,                              // 1.5.0 — local driver beside the strip (void / hatch)
    psuEfficiency: 0.9, powerFactor: 0.95, mainsV: 230,   // 1.5.0 — PSU input = load ÷ efficiency; A = W ÷ (V × pf)
    headEndCircuitA: 10, driversPerCircuit: 6,       // 1.5.0 — head-end radials: type C MCB, inrush caps drivers per circuit
    spurFuses: [3, 5, 13],                           // 1.5.0 — BS 1362 fuse for a local driver's FCU / plug top
    localSupply: 'fcu',                              // 1.5.0 — a local driver is fed by 'fcu' (fused connection unit) or 'plug' (plug-in PSU on a socket)
    maxFeedM: function (st) {                        // single-feed length by W/m and V when the type carries none
      var v = Number(st.volts) || 24, w = Number(st.watts_per_metre) || 10;
      if (v <= 5) return 3; if (v <= 12) return 5;
      if (w > 15) return 5; if (w > 10) return 7; return 10;
    }
  };
  function cfg(o) { var c = {}; Object.keys(DEFAULTS).forEach(function (k) { c[k] = DEFAULTS[k]; }); Object.keys(o || {}).forEach(function (k) { if (o[k] !== undefined) c[k] = o[k]; }); return c; }
  function num(x, d) { var n = Number(x); return isFinite(n) ? n : (d || 0); }
  function r1(x) { return Math.round(x * 10) / 10; }

  // ── control method ───────────────────────────────────────────────────────
  // run.control wins → strip metadata.control_default → house rule: data / pixel strips and anything with ≥ 2 channels
  // (RGB, RGBW, tunable white) are DMX; single-colour strips are on a TRIAC-dimmable CV driver (mains-dimmed from the
  // lighting panel). '0-10v' / 'dali' / 'switched' are explicit choices.
  var CONTROLS = {
    dmx:      { id: 'dmx',      label: 'DMX',               driver: 'CV driver + DMX decoder',            circuit: 'dmx' },
    triac:    { id: 'triac',    label: 'Triac dimmable',    driver: 'Triac-dimmable CV driver (mains-dimmed)', circuit: 'centralised' },
    '0-10v':  { id: '0-10v',    label: '0-10V',             driver: '0-10V dimmable CV driver',          circuit: '0-10v' },
    dali:     { id: 'dali',     label: 'DALI',              driver: 'DALI dimmable CV driver',           circuit: 'dali' },
    switched: { id: 'switched', label: 'Switched (on/off)', driver: 'CV driver, switched',               circuit: 'centralised' },
    pixel:    { id: 'pixel',    label: 'Pixel controller',  driver: 'CV PSU + pixel controller (data)', circuit: 'data' }   // 1.4.0
  };
  function controlFor(rn, st) {
    var ex = String((rn && rn.control) || '').toLowerCase(); if (CONTROLS[ex]) return CONTROLS[ex];
    var ch = num(st && st.dmx_channels, 1), data = ch >= 10 || /pixel|address/i.test(String((st && (st.label || st.id)) || ''));
    if (data) return CONTROLS.pixel;   // 1.4.0 — a pixel strip is always on its own controller unless the run itself says otherwise
    var md = (st && st.metadata && String(st.metadata.control_default || '').toLowerCase()) || ''; if (CONTROLS[md]) return CONTROLS[md];
    // house rule (Bryn 2026-11-01): single colour → triac-dimmed PSU · RGBW / tunable (≥ 2 ch) → DMX · pixel / addressable → its own controller
    return data ? CONTROLS.pixel : (ch >= 2 ? CONTROLS.dmx : CONTROLS.triac);
  }
  function stripMaxFeedM(st, c) { var m = st && st.metadata && Number(st.metadata.max_single_feed_m); return m > 0 ? m : c.maxFeedM(st || {}); }


  // ── Library catalogue (1.3.0) ────────────────────────────────────────────
  // ONE read seam: view v_led_catalogue (house strip types from pm_led_strip_types + strip products and drivers from
  // lighting_items.metadata.led) + library_settings key 'led_engineering' (house rules). Writers: the Library app only.
  var CAT = { strips: [], drivers: [], decoders: [], interfaces: [], pixelCtl: [], byId: {}, rules: null, source: 'built-in', loadedAt: null };
  var RULE_KEYS = ['controlSystem', 'headroom', 'dropTargetPct', 'dropLimitPct', 'rho', 'csaSizes', 'defaultFeedCableM', 'wastePct', 'reelM', 'decoderChannels',
    'dmxUniverseSize', 'dmxBlock', 'pixelControllerOutputs', 'maxDriverPerRoom', 'outdoorMinIp', 'preferManufacturer', 'stripSupply',
    'driverLocation', 'headEndFeedCableM', 'localFeedCableM', 'psuEfficiency', 'powerFactor', 'mainsV', 'headEndCircuitA', 'driversPerCircuit', 'spurFuses', 'localSupply'];
  var CACHE_KEY = 'sonor-led-catalogue-v1';
  function normStrip(r) {
    var md = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
    return { id: r.id, uid: r.uid || r.id, source: r.source || 'house', label: r.label, manufacturer: r.manufacturer || null,
      watts_per_metre: num(r.watts_per_metre, 10), volts: num(r.volts, 24), dmx_channels: num(r.dmx_channels, 1), kelvin: r.kelvin || null,
      cri: r.cri || null, ip_rating: r.ip || r.ip_rating || null, ip_num: num(r.ip_num, 0), img: r.img || null, sort_order: num(r.sort_order, 0),
      metadata: { max_single_feed_m: r.max_single_feed_m != null ? num(r.max_single_feed_m) : (md.max_single_feed_m != null ? num(md.max_single_feed_m) : undefined),
        lm_per_m: r.lm_per_m != null ? num(r.lm_per_m) : md.lm_per_m, reel_m: r.reel_m != null ? num(r.reel_m) : md.reel_m,
        control_default: r.control_default || md.control_default || undefined,
        default_cable_run_m: r.default_cable_run_m != null ? num(r.default_cable_run_m) : md.default_cable_run_m,
        default_cable_package: md.default_cable_package, display_colour: md.display_colour, default_product: md.default_product || null },
      // 1.4.0 — supplier product (lighting_items) → which generic types it can supply
      supply: r.source === 'product' ? { strip_types: (md.led && md.led.strip_types) || [], style: (md.led && md.led.style) || null, rank: num(md.led && md.led.rank, 9),
        supplier: String((md.led && md.led.supplier_key) || r.supplier || 'other').toLowerCase(), sku: (md.led && md.led.sku) || null, kelvins: (md.led && md.led.kelvins) || null,
        price_gbp: r.price_gbp != null ? num(r.price_gbp) : null, url: r.product_url || null } : null };
  }
  function normDriver(r) {
    var ctl = Array.isArray(r.control) ? r.control : (typeof r.control === 'string' ? (function () { try { return JSON.parse(r.control); } catch (_) { return [r.control]; } })() : []);
    return { id: r.id, label: r.label, manufacturer: r.manufacturer || null, kind: r.kind || null, volts: r.volts != null ? num(r.volts) : null,
      current_ma: r.current_ma != null ? num(r.current_ma) : null, current_max_ma: r.current_max_ma != null ? num(r.current_max_ma) : null,
      output_w: r.output_w != null ? num(r.output_w) : null, control: ctl.map(function (x) { return String(x).toLowerCase(); }),
      ip: r.ip || null, ip_num: num(r.ip_num, 0), preferred: !!r.preferred, family: !!r.family, range: r.range || (r.metadata && r.metadata.led && r.metadata.led.range) || null, needs_review: r.needs_review || null,
      img: r.img || null, sort_order: num(r.sort_order, 0), dims_mm: (r.metadata && r.metadata.led && r.metadata.led.dims_mm) || null, mount: mountOf(r) };
  }
  // 1.4.0 — control equipment (pm_lighting_control_types rows carrying metadata.led): decoders, DMX interfaces, pixel controllers
  function ledMeta(r) { return (r && r.metadata && r.metadata.led) || {}; }
  // 1.6.0 — the ONE mount rule (Library metadata.mount, also read by Engineering): DIN rail, racked (rack / shelf) or not (surface — screwed to the board / wall)
  function mountOf(r) { var m = String((r && r.metadata && (r.metadata.mount || (r.metadata.led && r.metadata.led.mount))) || (r && r.mount) || '').toLowerCase().replace(/[^a-z]/g, ''); return /^din/.test(m) ? 'din' : (/^(rack|shelf)/.test(m) ? 'rack' : 'surface'); }
  function normCtl(r) {
    var L = ledMeta(r);
    return { id: r.id, label: r.label, manufacturer: r.manufacturer || null, role: r.role, preferred: !!(r.preferred || L.preferred === true), family: r.family === true || L.family === true, brand: typeof L.family === 'string' ? L.family : null,
      sort_order: num(r.sort_order, 0), sku: L.sku || null, needs_review: L.needs_review || null,
      channels: num(L.channels, 0), amps_per_ch: num(L.amps_per_ch, 0), volts_min: num(L.volts_min, 5), volts_max: num(L.volts_max, 36), type: L.type || 'pwm', rdm: !!L.rdm,
      universes: num(L.universes, 0), dali_lines: num(L.dali_lines, 0), systems: (L.systems || []).map(function (x) { return String(x).toLowerCase(); }),
      outputs: num(L.outputs, 0), pixels_per_output: num(L.pixels_per_output, 0), protocol: L.protocol || null, ip: r.ip || null, dims_mm: L.dims_mm || null, mount: mountOf(r) };
  }
  function applyRules(rules) {
    if (!rules || typeof rules !== 'object') return;
    RULE_KEYS.forEach(function (k) { if (rules[k] !== undefined && rules[k] !== null) DEFAULTS[k] = rules[k]; });
    if (Array.isArray(rules.fallbackDriverSizes) && rules.fallbackDriverSizes.length) DEFAULTS.driverSizes = rules.fallbackDriverSizes.map(Number);
    CAT.rules = rules;
  }
  // rows = v_led_catalogue rows (any order); rules = library_settings.led_engineering value
  function useCatalogue(rows, rules, source) {
    CAT.strips = []; CAT.drivers = []; CAT.decoders = []; CAT.interfaces = []; CAT.pixelCtl = []; CAT.byId = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (r.role === 'strip') { var s = normStrip(r); CAT.strips.push(s); CAT.byId[s.id] = s; CAT.byId[String(s.id).toUpperCase()] = s; if (s.uid) CAT.byId[s.uid] = s; }
      else if (r.role === 'driver') CAT.drivers.push(normDriver(r));
      else if (r.role === 'decoder') CAT.decoders.push(normCtl(r));
      else if (r.role === 'interface') CAT.interfaces.push(normCtl(r));
      else if (r.role === 'pixel-controller') CAT.pixelCtl.push(normCtl(r));
    });
    CAT.strips.sort(function (a, b) { return (a.source === b.source ? 0 : a.source === 'house' ? -1 : 1) || a.sort_order - b.sort_order || String(a.label).localeCompare(String(b.label)); });
    applyRules(rules);
    CAT.source = source || 'library'; CAT.loadedAt = new Date().toISOString();
    return catalogueInfo();
  }
  function catalogueInfo() { return { source: CAT.source, strips: CAT.strips.length, drivers: CAT.drivers.length, decoders: CAT.decoders.length, interfaces: CAT.interfaces.length, pixelControllers: CAT.pixelCtl.length, loadedAt: CAT.loadedAt, rules: !!CAT.rules }; }
  // client = a supabase-js client (window.supabase client / SonorDB().client). 4-tier: Library → cached copy → built-in.
  function load(client) {
    var ls = null; try { ls = global.localStorage; } catch (_) {}
    function fromCache() { try { var c = ls && JSON.parse(ls.getItem(CACHE_KEY) || 'null'); if (c && c.rows) return useCatalogue(c.rows, c.rules, 'cache'); } catch (_) {} return catalogueInfo(); }
    if (!client || typeof client.from !== 'function') return Promise.resolve(fromCache());
    return Promise.all([
      client.from('v_led_catalogue').select('*'),
      client.from('library_settings').select('value').eq('key', 'led_engineering').maybeSingle()
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      var rules = res[1] && res[1].data ? res[1].data.value : null;
      try { ls && ls.setItem(CACHE_KEY, JSON.stringify({ rows: res[0].data || [], rules: rules, at: Date.now() })); } catch (_) {}
      var info = useCatalogue(res[0].data || [], rules, 'library');
      try { global.dispatchEvent && global.dispatchEvent(new CustomEvent('sonor-led-catalogue', { detail: info })); } catch (_) {}
      return info;
    }).catch(function () { return fromCache(); });
  }
  function strip(id) { if (id == null) return null; return CAT.byId[id] || CAT.byId[String(id).toUpperCase()] || CAT.byId['house:' + id] || CAT.byId['item:' + id] || null; }
  function stripsById() { var o = {}; CAT.strips.forEach(function (s) { o[s.id] = s; }); return o; }

  // ── supplier options under a generic strip type (1.4.0) ─────────────────
  // The house type (pm_led_strip_types) is the master; supplier products (lighting_items, metadata.led.strip_types ∋ type)
  // are its options. Default = the house style (COB) from the first supplier in stripSupply.supplierOrder, lowest rank,
  // whose IP suits the run (outdoor ≥ outdoorMinIp, indoor prefers IP20). Type metadata.default_product or run.productId wins.
  function supplyOptions(typeId, q, o) {
    var c = cfg(o); q = q || {}; var ss = c.stripSupply || {}, order = (ss.supplierOrder || []).map(function (x) { return String(x).toLowerCase(); });
    var style = q.style !== undefined ? q.style : ss.style, minIp = num(q.minIp, 0), id = String(typeId || '').toUpperCase();
    function sup(p) { var i = order.indexOf(p.supply.supplier); return i < 0 ? order.length : i; }
    return CAT.strips.filter(function (p) { return p.supply && p.supply.strip_types.some(function (t) { return String(t).toUpperCase() === id; }); })
      .map(function (p) { return { p: p, ipOk: minIp ? p.ip_num >= minIp : true, styleOk: !style || p.supply.style === style }; })
      .sort(function (a, b) {
        return (b.styleOk - a.styleOk) || (b.ipOk - a.ipOk) || (minIp ? 0 : ((a.p.ip_num >= 65) - (b.p.ip_num >= 65)))
          || sup(a.p) - sup(b.p) || a.p.supply.rank - b.p.supply.rank || String(a.p.label).localeCompare(String(b.p.label));
      })
      .map(function (x) { return x.p; });
  }
  function supplyFor(type, q, o) {
    q = q || {}; if (!type) return null;
    var force = q.productId || (type.metadata && type.metadata.default_product) || null;
    if (force) { var f = strip(force); if (f && f.supply) return f; }
    var c = cfg(o), ss = c.stripSupply || {}, opts = supplyOptions(type.id, q, c);
    var best = opts[0] || null;
    var dataType = num(type.dmx_channels, 0) >= 10 || /pixel|address/i.test(String(type.label || type.id || ''));   // 1.7.2 — pixel strip is never COB: house style does not apply
    if (best && ss.style && best.supply.style !== ss.style && !q.allowOtherStyle && !dataType) return null;   // house style only (COB) — no SMD fallback unless chosen
    if (best && q.minIp && !(best.ip_num >= num(q.minIp))) return null;
    return best;
  }
  // house type + supplier product → the strip the engine engineers: product electrics (W/m, V, lm/m, feed, reel), house name / colour
  function effectiveStrip(type, prod) {
    if (!prod) return type;
    var m = {}; Object.keys(type.metadata || {}).forEach(function (k) { m[k] = type.metadata[k]; });
    ['max_single_feed_m', 'lm_per_m', 'reel_m'].forEach(function (k) { if (prod.metadata && prod.metadata[k] != null) m[k] = prod.metadata[k]; });
    var e = {}; Object.keys(type).forEach(function (k) { e[k] = type[k]; });
    e.watts_per_metre = prod.watts_per_metre || type.watts_per_metre; e.volts = prod.volts || type.volts;
    e.dmx_channels = Math.max(num(type.dmx_channels, 1), num(prod.dmx_channels, 1)); e.ip_rating = prod.ip_rating || type.ip_rating; e.ip_num = prod.ip_num || type.ip_num;
    e.metadata = m;
    e.product = { id: prod.id, label: prod.label, manufacturer: prod.manufacturer, supplier: prod.supply.supplier, sku: prod.supply.sku, style: prod.supply.style, price_gbp: prod.supply.price_gbp, url: prod.supply.url, ip: prod.ip_rating, wpm: prod.watts_per_metre, reel_m: prod.metadata && prod.metadata.reel_m };
    return e;
  }

  // pick a driver for a load from the Library. q = { kind:'cv'|'cc', volts, current_ma, control, minIp, prefer, driverProductId }
  // → { driver_w, drivers, loaded_pct, product:{id,label,manufacturer,ip,control}|null, source:'library'|'fallback'|'forced' }
  function driverRank(q) {
    var pref = String(q.prefer || '').toLowerCase(), anyCtl = !q.control || q.control === 'dmx' || q.control === 'switched' || q.control === 'pixel';
    function pm(d) { return !!pref && (String(d.manufacturer || '').toLowerCase() === pref || String(d.range || '').toLowerCase() === pref || String(d.label || '').toLowerCase().indexOf(pref) >= 0); }
    return function (a, b) {
      return (b.preferred - a.preferred)
        || (pm(b) - pm(a))
        || (anyCtl ? ((b.control.indexOf('switched') >= 0) - (a.control.indexOf('switched') >= 0)) : 0)
        || (q.minIp ? 0 : ((a.ip_num >= 65) - (b.ip_num >= 65)))   // indoors: an indoor driver before an outdoor-rated one
        || a.sort_order - b.sort_order || String(a.label).localeCompare(String(b.label));
    };
  }
  function pickDriver(loadW, q, o) {
    var c = cfg(o); q = q || {}; loadW = num(loadW);
    var empty = { driver_w: 0, drivers: 0, loaded_pct: 0, product: null, source: 'library' };
    if (loadW <= 0) return empty;
    var minW = loadW / c.headroom, kind = q.kind || 'cv';
    function prod(d) { return d ? { id: d.id, label: d.label, manufacturer: d.manufacturer, ip: d.ip, control: d.control, dims_mm: d.dims_mm || null, mount: d.mount || 'surface' } : null; }
    if (q.driverProductId) {
      var f = CAT.drivers.filter(function (d) { return d.id === q.driverProductId; })[0];
      if (f && f.output_w > 0) { var nf = Math.max(1, Math.ceil(minW / f.output_w)); return { driver_w: f.output_w, drivers: nf, loaded_pct: Math.round(loadW / (f.output_w * nf) * 100), product: prod(f), source: 'forced' }; }
    }
    var ctl = q.control ? String(q.control).toLowerCase() : null, needCtl = ctl && ['dmx', 'switched', 'pixel'].indexOf(ctl) < 0;
    var cands = CAT.drivers.filter(function (d) {
      if (d.family || !(d.output_w > 0) || d.kind !== kind) return false;
      if (kind === 'cv' && q.volts && d.volts && num(d.volts) !== num(q.volts)) return false;
      if (kind === 'cc' && q.current_ma) { var lo = d.current_ma, hi = d.current_max_ma || d.current_ma; if (!(lo && num(q.current_ma) >= lo && num(q.current_ma) <= hi)) return false; }
      if (q.minIp && !(d.ip_num >= num(q.minIp))) return false;
      if (needCtl && d.control.indexOf(ctl) < 0) return false;
      return true;
    });
    if (!cands.length) {
      if (kind !== 'cv') return { driver_w: 0, drivers: 0, loaded_pct: 0, product: null, source: 'none' };
      var fb = driverFor(loadW, c); fb.product = null; fb.source = 'fallback'; return fb;
    }
    // 1.3.1 — preference before size: the preferred family (first picks matching the house prefer, e.g. Tagra) is tried
    // first, then any first pick, then everything; a lower tier is used only when the tier above has no single size that fits.
    var pref = String(q.prefer || '').toLowerCase();
    function pm(d) { return !!pref && (String(d.manufacturer || '').toLowerCase() === pref || String(d.range || '').toLowerCase() === pref || String(d.label || '').toLowerCase().indexOf(pref) >= 0); }
    var tiers = [cands.filter(function (d) { return d.preferred && pm(d); }), cands.filter(function (d) { return pm(d); }), cands.filter(function (d) { return d.preferred; }), cands];
    function sizeMap(list) { var m = {}; list.slice().sort(driverRank(q)).forEach(function (d) { if (!m[d.output_w]) m[d.output_w] = d; }); return m; }
    for (var t = 0; t < tiers.length; t++) {
      if (!tiers[t].length) continue;
      var bm = sizeMap(tiers[t]), sz = Object.keys(bm).map(Number).sort(function (a, b) { return a - b; });
      for (var i = 0; i < sz.length; i++) if (sz[i] >= minW) return { driver_w: sz[i], drivers: 1, loaded_pct: Math.round(loadW / sz[i] * 100), product: prod(bm[sz[i]]), source: 'library' };
    }
    var top = tiers.filter(function (l) { return l.length; })[0] || cands;   // nothing fits as one driver → split within the best tier
    var bySize = sizeMap(top);
    var sizes = Object.keys(bySize).map(Number).sort(function (a, b) { return a - b; });
    var big = sizes[sizes.length - 1], n = Math.ceil(minW / big), share = loadW / n / c.headroom, pick = big;
    for (var j = 0; j < sizes.length; j++) if (sizes[j] >= share) { pick = sizes[j]; break; }
    return { driver_w: pick, drivers: n, loaded_pct: Math.round(loadW / (pick * n) * 100), product: prod(bySize[pick]), source: 'library' };
  }

  // Takeoffs floors (takeoffs_floors.content) → engine runs. Feed-cable lengths come from the run's own
  // custom_cable_run_m; Takeoffs' LED Schedule adds drawn-path lengths on top when it runs in the editor.
  function fromTakeoffsFloors(floors) {
    var out = [];
    (floors || []).forEach(function (f) {
      var content = (f && (f.content || f)) || {}, code = (f && (f.code || f.floor_id)) || '';
      (content.leds || []).forEach(function (m, i) {
        if (!m || !(num(m.metres) > 0)) return;
        var feeds = m.manual_feed_distances_m;
        if (typeof feeds === 'string') feeds = feeds.split(/[,\s]+/).map(Number).filter(function (x) { return isFinite(x); });
        out.push({ id: (m.autoId && m.autoId.id) || m.id || (code + '-LED-' + (i + 1)), source: 'takeoffs', floor: (m.autoId && m.autoId.floorCode) || code,
          room: (m.autoId && m.autoId.roomName) || m.room || '', metres: num(m.metres), ledId: m.ledId, ledLabel: m.ledLabel,
          feeds: Array.isArray(feeds) && feeds.length ? feeds : null, custom_feed_interval_m: m.custom_feed_interval_m,
          feedCableM: num(m.custom_cable_run_m) > 0 ? num(m.custom_cable_run_m) : undefined, control: m.control || null,
          dmx_universe: m.dmx_universe || null, dmx_address: m.dmx_address || null, circuitId: m.circuitId || null, note: m.source && m.source.note || null,
          location: m.led_location || undefined, headEnd: m.led_head_end || undefined, localSupply: m.local_supply || undefined });   // 1.5.0 — Takeoffs' PSU-at choice
      });
    });
    return out;
  }

  // ── drivers ──────────────────────────────────────────────────────────────
  function driverFor(loadW, o) {
    var c = cfg(o); loadW = num(loadW); if (loadW <= 0) return { driver_w: 0, drivers: 0, loaded_pct: 0 };
    var minW = loadW / c.headroom, sizes = c.driverSizes.slice().sort(function (a, b) { return a - b; });
    for (var i = 0; i < sizes.length; i++) if (sizes[i] >= minW) return { driver_w: sizes[i], drivers: 1, loaded_pct: Math.round(loadW / sizes[i] * 100) };
    var big = sizes[sizes.length - 1], n = Math.ceil(minW / big);
    // a split run: re-pick the smallest standard size that still fits each share
    var share = loadW / n / c.headroom, pick = big; for (var j = 0; j < sizes.length; j++) if (sizes[j] >= share) { pick = sizes[j]; break; }
    return { driver_w: pick, drivers: n, loaded_pct: Math.round(loadW / (pick * n) * 100) };
  }

  // ── feed cable ───────────────────────────────────────────────────────────
  function feedCable(loadW, volts, lengthM, o) {
    var c = cfg(o); volts = num(volts, 24); lengthM = num(lengthM, c.defaultFeedCableM); loadW = num(loadW);
    var amps = volts > 0 ? loadW / volts : 0, out = null;
    for (var i = 0; i < c.csaSizes.length; i++) {
      var a = c.csaSizes[i], dropV = 2 * lengthM * amps * c.rho / a, pct = volts > 0 ? dropV / volts * 100 : 0;
      out = { csa: a, amps: r1(amps), drop_v: Math.round(dropV * 100) / 100, drop_pct: r1(pct), length_m: r1(lengthM), ok: pct <= c.dropTargetPct, limit: pct <= c.dropLimitPct };
      if (out.ok) return out;
    }
    return out;   // biggest size, still over — flagged by ok:false
  }

  // ── one run ──────────────────────────────────────────────────────────────
  function run(rn, st, o) {
    var c = cfg(o); st = st || {}; rn = rn || {};
    var metres = num(rn.metres), wpm = num(st.watts_per_metre, 10), volts = num(st.volts, 24);
    var load = metres * wpm, maxFeed = stripMaxFeedM(st, c), notes = [], flags = [];
    if (!(metres > 0)) return null;
    // feed points
    var feeds = Array.isArray(rn.feeds) && rn.feeds.length ? rn.feeds.map(num).filter(function (m) { return m >= 0 && m <= metres + 0.01; }).sort(function (a, b) { return a - b; }) : null;
    var manual = !!feeds;
    var interval = num(rn.custom_feed_interval_m) > 0 ? num(rn.custom_feed_interval_m) : maxFeed;
    if (!feeds) { var n = Math.max(1, Math.ceil(metres / interval)); feeds = []; for (var i = 0; i < n; i++) feeds.push(r1(n === 1 ? 0 : i * (metres / n))); }
    // coverage check: the far end and the gaps between feeds must each be inside maxFeed (a single feed covers maxFeed one way)
    var worst = 0;
    for (var k = 0; k < feeds.length; k++) {
      var prev = k === 0 ? null : feeds[k - 1], next = k === feeds.length - 1 ? null : feeds[k + 1];
      var reachBack = prev == null ? feeds[k] : (feeds[k] - prev) / 2, reachFwd = next == null ? metres - feeds[k] : (next - feeds[k]) / 2;
      worst = Math.max(worst, reachBack, reachFwd);
    }
    if (worst > maxFeed + 0.05) flags.push('UNDER-FED');
    if (worst > maxFeed + 0.05) notes.push('strip reach ' + r1(worst) + ' m from a feed — ' + (manual ? 'add a feed marker' : 'feed every ' + maxFeed + ' m') + ' (max ' + maxFeed + ' m at ' + volts + ' V / ' + wpm + ' W/m)');
    // load per feed = strip either side to half-way to the neighbour
    var perFeed = feeds.map(function (f, k) {
      var prev = k === 0 ? 0 : (feeds[k - 1] + f) / 2, next = k === feeds.length - 1 ? metres : (f + feeds[k + 1]) / 2;
      return r1((next - prev) * wpm);
    });
    // feed cable per feed
    var cableLens = Array.isArray(rn.feedCableM) ? rn.feedCableM : null;
    // 1.5.0 — head end or local: the run says; a Takeoffs remote DMX driver block is a head end, a placed local driver block is local
    var loc = rn.location === 'local' || rn.location === 'head-end' ? rn.location : (rn.driverRemote ? 'head-end' : (rn.source === 'takeoffs' && rn.driverAt ? 'local' : (c.driverLocation === 'local' ? 'local' : 'head-end')));
    var cableDef = num(rn.feedCableM) > 0 ? num(rn.feedCableM) : (loc === 'local' ? num(c.localFeedCableM, 2) : (num(st.metadata && st.metadata.default_cable_run_m) > 0 ? num(st.metadata.default_cable_run_m) : (num(c.headEndFeedCableM) > 0 ? num(c.headEndFeedCableM) : c.defaultFeedCableM)));
    var cables = feeds.map(function (f, k) { var L = cableLens ? num(cableLens[k], cableDef) : cableDef; return feedCable(perFeed[k], volts, L, c); });
    var worstCable = cables.reduce(function (a, b) { return !a || b.drop_pct > a.drop_pct ? b : a; }, null);
    if (worstCable && !worstCable.limit) { flags.push('VOLT DROP'); notes.push('feed cable drop ' + worstCable.drop_pct + ' % at ' + worstCable.csa + ' mm² — shorten the feed or move the driver'); }
    else if (worstCable && !worstCable.ok) notes.push('feed cable ' + worstCable.csa + ' mm² needed (' + worstCable.drop_pct + ' % drop)');
    var ch = num(st.dmx_channels, 1), data = ch >= 10 || /pixel|address/i.test(String(st.label || st.id || ''));
    var ctl = controlFor(rn, st);
    var outdoor = !!(rn.outdoor || (o && o.outdoor));
    var drvOut = outdoor && loc !== 'head-end';   // 1.7.1 — a head-end PSU sits indoors on the board: IP20, even when its strip is outside
    var drv = pickDriver(load, { kind: 'cv', volts: volts, control: ctl.id, minIp: drvOut ? c.outdoorMinIp : (rn.minIp || null), prefer: rn.preferManufacturer || c.preferManufacturer, driverProductId: rn.driverProductId || null }, c);   // 1.3.0 — a real Library product
    if (drv.source === 'fallback' && CAT.drivers.length) notes.push('no Library driver matches ' + volts + ' V / ' + ctl.label + (drvOut ? ' / IP' + c.outdoorMinIp + '+' : '') + ' — generic size shown');
    var dmxCh = ctl.id === 'dmx' ? (data ? 0 : Math.max(1, ch)) : 0;   // data strips take a pixel-controller output, not channels
    return {
      id: rn.id || rn.label || '', label: rn.label || rn.id || '', floor: rn.floor || '', room: rn.room || '',
      strip: { id: st.id || rn.ledId || '', label: st.label || rn.ledLabel || 'LED strip', volts: volts, wpm: wpm, channels: ch, data: data, kelvin: st.kelvin || null, ip: st.ip_rating || null, maxFeedM: maxFeed, reelM: num(st.metadata && st.metadata.reel_m) > 0 ? num(st.metadata.reel_m) : null, lmPerM: num(st.metadata && st.metadata.lm_per_m) || null, product: st.product || null, typeId: st.typeId || st.id || rn.ledId || '' },
      source: rn.source || null, outdoor: outdoor, lumens: num(st.metadata && st.metadata.lm_per_m) ? Math.round(metres * num(st.metadata.lm_per_m)) : null,
      metres: r1(metres), load_w: r1(load),
      feeds: feeds, feedsManual: manual, feedLoads_w: perFeed, cables: cables, cable: worstCable,
      location: loc, locationExplicit: rn.location === 'local' || rn.location === 'head-end', headEnd: loc === 'head-end' ? (rn.headEnd || null) : null,   // 1.5.0
      localSupply: loc === 'local' ? (rn.localSupply === 'plug' || rn.localSupply === 'fcu' ? rn.localSupply : (c.localSupply === 'plug' ? 'plug' : 'fcu')) : null,   // 1.5.0 — FCU or plug-in socket
      input_w: r1(load / Math.max(0.5, num(c.psuEfficiency, 0.9))),   // 1.5.0 — mains the PSU draws for this run
      driver: drv, driverAt: rn.driverAt || rn.driver_location || null, driverId: rn.driverId || null, driverRemote: !!rn.driverRemote,   // 1.2.0 — remote DMX driver block feeding the run dimming: rn.dimming || (data ? 'data' : (ch > 1 ? 'dmx' : null)),
      control: ctl.id, controlLabel: ctl.label, driverType: ctl.driver, circuitType: ctl.circuit, controlExplicit: !!(rn && rn.control),
      pixel: ctl.id === 'pixel' ? { output: null, controller: null } : null,   // 1.4.0
      perChannelA: ctl.id === 'dmx' && !data ? Math.round(load / volts / Math.max(1, ch) * 100) / 100 : null,   // 1.4.0 — load each decoder channel carries
      dmx: ctl.id === 'dmx' ? { channels: dmxCh, data: data, node: rn.node || rn.dmx_node || null, universe: num(rn.dmx_universe) > 0 ? num(rn.dmx_universe) : null, address: num(rn.dmx_address) > 0 ? num(rn.dmx_address) : null, manual: num(rn.dmx_address) > 0 } : null,
      flags: flags, notes: notes
    };
  }

  // ── control equipment (1.4.0) ─────────────────────────────────────────────
  function ctlRank(a, b) { return (b.preferred - a.preferred) || a.sort_order - b.sort_order || String(a.label).localeCompare(String(b.label)); }
  // decoders per DMX zone (floor · room): the smallest Library decoder that holds the zone's channels at the highest per-channel
  // load; when none holds them all, the decoder with the most channels that carries the current, × n. Remote DMX drivers need none.
  function chooseDecoders(out, c) {
    var list = CAT.decoders.filter(function (d) { return !d.family && d.type !== 'relay' && d.channels > 0; });
    if (!list.length) return { count: null, products: [] };
    var zones = {}, prod = {}, count = 0;
    out.forEach(function (e) {
      if (!e.dmx || e.dmx.data || e.driverRemote) return;
      var k = (e.location === 'local' ? 'local' : (e.headEnd || 'HE')) + ' | ' + (e.floor || '') + ' · ' + (e.room || ''); var z = zones[k] = zones[k] || { key: k, ch: 0, maxA: 0, volts: e.strip.volts, runs: [], location: e.location, headEnd: e.headEnd, floor: e.floor, room: e.room };   // 1.5.0 — a zone's decoder sits with its PSUs (head end or local)
      z.ch += e.dmx.channels; z.maxA = Math.max(z.maxA, num(e.perChannelA)); z.runs.push(e);
    });
    Object.keys(zones).forEach(function (k) {
      var z = zones[k], ok = list.filter(function (d) { return (!d.amps_per_ch || d.amps_per_ch >= z.maxA) && z.volts >= d.volts_min && z.volts <= d.volts_max; }).sort(ctlRank);
      var pick = null, n = 1;
      var fit = ok.filter(function (d) { return d.channels >= z.ch; }).sort(function (a, b) { return (b.preferred - a.preferred) || a.channels - b.channels || ctlRank(a, b); })[0];
      if (fit) pick = fit;
      else if (ok.length) { pick = ok.slice().sort(function (a, b) { return (b.preferred - a.preferred) || b.channels - a.channels; })[0]; n = Math.ceil(z.ch / pick.channels); }
      if (!pick) { z.runs.forEach(function (e) { e.flags.push('DECODER'); e.notes.push('no Library decoder carries ' + z.maxA + ' A a channel at ' + z.volts + ' V — split the run or add a power repeater'); }); return; }
      count += n;
      var p = prod[pick.id] = prod[pick.id] || { id: pick.id, label: pick.label, manufacturer: pick.manufacturer, channels: pick.channels, amps_per_ch: pick.amps_per_ch, qty: 0, zones: [] };
      p.qty += n; p.zones.push((z.floor || '') + ' · ' + (z.room || ''));
      z.runs.forEach(function (e) { e.decoder = { id: pick.id, label: pick.label, zone: k, qty: n, channels: pick.channels, dims_mm: pick.dims_mm || null, mount: pick.mount || 'surface' }; });
    });
    return { count: count, products: Object.keys(prod).map(function (k) { return prod[k]; }).sort(function (a, b) { return a.channels - b.channels; }) };
  }
  // DMX interface by lighting control system (Bryn 2026-10-16: Art-Net by default, Creative Lighting with Control4, the Lutron /
  // Rako DMX interface with those systems) — sized to the universes in use.
  function chooseInterface(universes, c) {
    var sys = String(c.controlSystem || 'artnet').toLowerCase();
    var list = CAT.interfaces.filter(function (d) { return !d.family && d.universes > 0 && d.systems.indexOf(sys) >= 0; });
    if (!list.length) return { system: sys, product: null, qty: Math.max(1, universes), note: 'no Library DMX interface for ' + sys };
    var fit = list.filter(function (d) { return d.universes >= universes; }).sort(function (a, b) { return (b.preferred - a.preferred) || a.universes - b.universes || ctlRank(a, b); })[0];
    var pick = fit || list.slice().sort(function (a, b) { return (b.preferred - a.preferred) || b.universes - a.universes; })[0];
    return { system: sys, product: { id: pick.id, label: pick.label, manufacturer: pick.manufacturer, universes: pick.universes, dims_mm: pick.dims_mm || null, mount: pick.mount || 'surface' }, qty: fit ? 1 : Math.ceil(universes / pick.universes) };
  }
  function pickPixelController(c) {
    var list = CAT.pixelCtl.filter(function (d) { return !d.family && d.outputs > 0; }).sort(ctlRank);
    return list[0] || null;
  }

  // ── a project ────────────────────────────────────────────────────────────
  function project(runs, stripsById, o) {
    var c = cfg(o); stripsById = stripsById || {};
    var out = [], byType = {}, drivers = {}, dprod = {}, channels = {}, cable = {}, rooms = {};
    (runs || []).forEach(function (rn) {
      var st = stripsById[rn.ledId] || stripsById[String(rn.ledId || '').toUpperCase()] || (rn.strip || null) || strip(rn.ledId) || { id: rn.ledId, label: rn.ledLabel, watts_per_metre: rn.wpm || 10, volts: rn.volts || 24, dmx_channels: rn.channels || 1 };
      // 1.4.0 — a generic house type takes its supplier option (default COB · UltraLEDs) and engineers on that product's spec
      var outdoorQ = !!(rn.outdoor || c.outdoor), noSupply = false;
      if (st && !st.supply && !st.product) {
        var prodSel = supplyFor(st, { productId: rn.productId || null, minIp: outdoorQ ? c.outdoorMinIp : (rn.minIp || null) }, c);
        if (prodSel) { var eff = effectiveStrip(st, prodSel); eff.typeId = st.id; st = eff; }
        else noSupply = CAT.strips.length > 0;
      }
      var e = run(rn, st, c); if (!e) return; out.push(e);
      if (noSupply) e.notes.push(['no', num(st.dmx_channels, 0) >= 10 ? '' : String((c.stripSupply && c.stripSupply.style) || '').toUpperCase(), outdoorQ ? 'IP' + c.outdoorMinIp + '+' : '', 'supplier option under'].filter(Boolean).join(' ') + ' ' + (st.label || st.id) + ' — add one in Library › LED Strips');
      var tk = (e.strip.typeId || e.strip.id || e.strip.label) + '|' + (e.strip.product ? e.strip.product.id : '');
      var t = byType[tk] = byType[tk] || { id: e.strip.typeId || e.strip.id, label: e.strip.label, volts: e.strip.volts, wpm: e.strip.wpm, reelM: e.strip.reelM, product: e.strip.product, metres: 0, runs: 0, load_w: 0 };
      t.metres += e.metres; t.runs++; t.load_w += e.load_w;
      var dk = e.driver.driver_w + ' W'; drivers[dk] = (drivers[dk] || 0) + e.driver.drivers;
      var pk = e.driver.product ? e.driver.product.id : ('generic-' + e.driver.driver_w); if (e.driver.drivers) { var dp = dprod[pk] = dprod[pk] || { id: e.driver.product ? e.driver.product.id : null, label: e.driver.product ? e.driver.product.label : ('Generic ' + e.driver.driver_w + ' W CV driver'), manufacturer: e.driver.product ? e.driver.product.manufacturer : null, size_w: e.driver.driver_w, qty: 0 }; dp.qty += e.driver.drivers; }
      if (e.dmx && !e.dmx.data && !e.driverRemote) { var rk = (e.floor || '') + ' · ' + (e.room || ''); rooms[rk] = (rooms[rk] || 0) + e.dmx.channels; }   // 1.4.0 — DMX runs only (was every non-data strip)
      e.cables.forEach(function (cb) { var ck = cb.csa + ' mm²'; cable[ck] = (cable[ck] || 0) + cb.length_m; });
    });
    Object.keys(byType).forEach(function (k) { var t = byType[k]; t.metres = r1(t.metres); t.load_w = r1(t.load_w); var reel = num(t.reelM) > 0 ? num(t.reelM) : c.reelM; t.order_m = Math.ceil(t.metres * (1 + c.wastePct / 100) / reel) * reel; t.reels = t.order_m / reel; t.cost_gbp = t.product && t.product.price_gbp ? Math.round(t.reels * t.product.price_gbp * 100) / 100 : null; });
    var decoders = 0; Object.keys(rooms).forEach(function (k) { decoders += Math.ceil(rooms[k] / c.decoderChannels); channels[k] = rooms[k]; });
    // ── DMX addressing (v1.1.0): manual addresses are honoured; the rest are packed in run order from the next free address,
    // one universe of 512 then the next. Data / pixel strips take pixel-controller outputs instead (PX1, PX2 …).
    // 1.4.0 — DMX lines patch to nodes (Art-Net nodes / system interfaces). opts.nodes = [{ id, label, productId }]; a run's
    // dmx.node (rn.node) picks its node, unassigned runs go to the first node. Every node owns its own universes (U1, U2 …)
    // and addresses restart per node universe.
    var nodes = (Array.isArray(c.nodes) && c.nodes.length ? c.nodes : [{ id: 'N1', label: 'Node 1' }]).map(function (n, i) { return { id: String(n.id || ('N' + (i + 1))), label: n.label || ('Node ' + (i + 1)), productId: n.productId || null, location: n.location || null }; });
    var nodeIds = nodes.map(function (n) { return n.id; });
    // 1.5.0 — head ends (lighting plant positions). opts.headEnds = [{ id, label, location, floor }]; head-end runs without one go to the first.
    var headEnds = (Array.isArray(c.headEnds) && c.headEnds.length ? c.headEnds : [{ id: 'HE1', label: 'Lighting head end' }]).map(function (h, i) { return { id: String(h.id || ('HE' + (i + 1))), label: h.label || ('Head end ' + (i + 1)), location: h.location || '', floor: h.floor || '' }; });
    var heIds = headEnds.map(function (h) { return h.id; });
    out.forEach(function (e) { if (e.location === 'head-end' && (!e.headEnd || heIds.indexOf(String(e.headEnd)) < 0)) e.headEnd = headEnds[0].id; });
    nodes.forEach(function (n, i) { var src = (c.nodes || [])[i] || {}; n.headEnd = src.headEnd === '' ? null : (src.headEnd && heIds.indexOf(String(src.headEnd)) >= 0 ? String(src.headEnd) : headEnds[0].id); });
    out.forEach(function (e) { if (e.dmx && !e.dmx.data) { if (!e.dmx.node || nodeIds.indexOf(String(e.dmx.node)) < 0) { if (e.dmx.node) e.notes.push('DMX node ' + e.dmx.node + ' not in this project — patched to ' + nodes[0].label); e.dmx.node = nodes[0].id; } else e.dmx.node = String(e.dmx.node); } });
    var used = {};   // node|universe → [[from,to]]
    function uk(n, u) { return n + '|' + u; }
    out.forEach(function (e) { if (e.dmx && !e.dmx.data && e.dmx.manual && e.dmx.channels) { var u = e.dmx.universe || 1; (used[uk(e.dmx.node, u)] = used[uk(e.dmx.node, u)] || []).push([e.dmx.address, e.dmx.address + e.dmx.channels - 1]); e.dmx.universe = u; } });
    // Zone-aware (Bryn 22:25: "based on rooms and zones, if there is one or 2 single channels in the same zone, they may
    // start at 007 or something"): runs are walked in floor · room groups; inside a group every MULTI-channel device
    // starts on a fresh xx1 block, and the group's SINGLE-channel devices pack straight after the last multi-channel
    // device (005, 006, 007 …) instead of each taking a block; a group of singles only starts on a fresh xx1 and packs.
    // The next room always starts on the next free xx1.
    var pxOut = 0, blk = Math.max(1, num(c.dmxBlock, 10));
    var pxCtl = pickPixelController(c), pxPer = pxCtl ? Math.max(1, pxCtl.outputs) : Math.max(1, num(c.pixelControllerOutputs, 4));
    function pxName(n) { return 'PX' + Math.ceil(n / pxPer) + '-' + (((n - 1) % pxPer) + 1); }
    out.forEach(function (e) { if (e.pixel) { pxOut++; e.pixel.output = pxName(pxOut); e.pixel.controller = pxCtl ? pxCtl.label : 'Pixel controller'; e.pixel.mount = pxCtl ? pxCtl.mount : 'surface'; e.pixel.dims_mm = pxCtl ? pxCtl.dims_mm : null; } });
    function snap(a) { return Math.floor((a - 1) / blk) * blk + 1; }
    function nextBlock(a) { return snap(a) === a ? a : snap(a) + blk; }
    nodes.forEach(function (nd) {
      var cur = { u: 1, a: 1 };
      function free(u, a, n) { var r = used[uk(nd.id, u)] || []; for (var i = 0; i < r.length; i++) { if (a <= r[i][1] && a + n - 1 >= r[i][0]) return false; } return true; }
      function take(e, n, wantBlock) {
        if (wantBlock) cur.a = nextBlock(cur.a);
        while (true) {
          if (cur.a + n - 1 > c.dmxUniverseSize) { cur.u++; cur.a = 1; }
          if (free(cur.u, cur.a, n)) break;
          cur.a = wantBlock ? nextBlock(cur.a + 1) : cur.a + 1;
        }
        e.dmx.universe = cur.u; e.dmx.address = cur.a; (used[uk(nd.id, cur.u)] = used[uk(nd.id, cur.u)] || []).push([cur.a, cur.a + n - 1]); cur.a += n;
      }
      var groups = [], gIdx = {};
      out.forEach(function (e) {
        if (!e.dmx || e.dmx.data || e.dmx.manual || e.dmx.node !== nd.id) return;
        var gk = (e.floor || '') + ' · ' + (e.room || '');
        if (gIdx[gk] == null) { gIdx[gk] = groups.length; groups.push({ key: gk, multi: [], single: [] }); }
        groups[gIdx[gk]][e.dmx.channels > 1 ? 'multi' : 'single'].push(e);
      });
      groups.forEach(function (g) {
        cur.a = nextBlock(cur.a);                                  // a new zone starts on a fresh xx1
        g.multi.forEach(function (e) { take(e, e.dmx.channels, true); });
        g.single.forEach(function (e, i) { take(e, 1, g.multi.length === 0 && i === 0); });   // singles pack after the zone's last multi-channel device (a singles-only zone opens its own xx1)
      });
    });
    out.forEach(function (e) { if (e.dmx && e.dmx.data) { pxOut++; e.dmx.universe = null; e.dmx.output = pxName(pxOut); } });
    var nodeLabel = {}; nodes.forEach(function (n) { nodeLabel[n.id] = n.label; });
    out.forEach(function (e) { if (e.dmx && !e.dmx.data) e.dmx.nodeLabel = nodes.length > 1 ? nodeLabel[e.dmx.node] : null; });
    out.forEach(function (e) { if (e.dmx && !e.dmx.data) e.dmx.zone = (e.floor || '') + ' · ' + (e.room || ''); });
    var dmxRuns = out.filter(function (e) { return e.dmx && !e.dmx.data; }), dmxCh = dmxRuns.reduce(function (a, e) { return a + e.dmx.channels; }, 0);
    var byControl = {}; out.forEach(function (e) { byControl[e.control] = (byControl[e.control] || 0) + 1; });
    var totalM = out.reduce(function (a, e) { return a + e.metres; }, 0), totalW = out.reduce(function (a, e) { return a + e.load_w; }, 0);
    var res = {
      version: VERSION, runs: out,
      totals: { runs: out.length, metres: r1(totalM), load_w: r1(totalW), drivers: Object.keys(drivers).reduce(function (a, k) { return a + drivers[k]; }, 0), feeds: out.reduce(function (a, e) { return a + e.feeds.length; }, 0), flagged: out.filter(function (e) { return e.flags.length; }).length },
      byType: Object.keys(byType).map(function (k) { return byType[k]; }).sort(function (a, b) { return b.metres - a.metres; }),
      stripCost: Object.keys(byType).reduce(function (a, k) { return a + (byType[k].cost_gbp || 0); }, 0) || null,   // 1.4.0
      drivers: Object.keys(drivers).sort(function (a, b) { return parseFloat(a) - parseFloat(b); }).map(function (k) { return { size: k, qty: drivers[k] }; }),
      driverProducts: Object.keys(dprod).map(function (k) { return dprod[k]; }).sort(function (a, b) { return a.size_w - b.size_w || String(a.label).localeCompare(String(b.label)); }),   // 1.3.0
      catalogue: catalogueInfo(),
      controllers: (function () {
        var dec = chooseDecoders(out, c), universes = Object.keys(used).length;
        var nodeOut = nodes.map(function (nd) {
          var rs = dmxRuns.filter(function (e) { return e.dmx.node === nd.id; }), us = Object.keys(used).filter(function (k) { return k.indexOf(nd.id + '|') === 0; }).length;
          var forced = nd.productId ? CAT.interfaces.filter(function (d) { return d.id === nd.productId; })[0] : null;
          var pick = forced ? { system: (forced.systems[0] || c.controlSystem), product: { id: forced.id, label: forced.label, manufacturer: forced.manufacturer, universes: forced.universes }, qty: forced.universes ? Math.max(1, Math.ceil(us / forced.universes)) : 1, forced: true } : (rs.length ? chooseInterface(us, c) : null);
          if (pick && pick.product && pick.product.universes && us > pick.product.universes * pick.qty) rs.forEach(function (e) { e.notes.push(nd.label + ' carries ' + us + ' universes — add a node'); });
          return { id: nd.id, label: nd.label, location: nd.location, runs: rs.length, channels: rs.reduce(function (a, e) { return a + e.dmx.channels; }, 0), universes: us, interface: pick };
        });
        var used1 = nodeOut.filter(function (n) { return n.runs; });
        var itf = used1.length ? (function () { var f = used1[0].interface || {}; var qty = used1.reduce(function (a, n) { return a + ((n.interface && n.interface.qty) || 0); }, 0); return { system: f.system, product: f.product || null, qty: qty, note: f.note, nodes: used1.length }; })() : null;
        var pxQty = Math.ceil(pxOut / pxPer);
        return { channelsByRoom: channels, decoders: dec.count != null ? dec.count : decoders, decoderChannels: c.decoderChannels,
        decoderProducts: dec.products, interface: itf, nodes: nodeOut,
        interfaceProducts: (function () { var m = {}; used1.forEach(function (n) { var it = n.interface; if (!it) return; var k = it.product ? it.product.id : 'none'; var x = m[k] = m[k] || { id: it.product ? it.product.id : null, label: it.product ? it.product.label : ('DMX interface (' + it.system + ')'), manufacturer: it.product ? it.product.manufacturer : null, qty: 0, nodes: [] }; x.qty += it.qty || 1; x.nodes.push(n.label); }); return Object.keys(m).map(function (k) { return m[k]; }); })(), controlSystem: c.controlSystem || 'artnet',
        pixel: { runs: out.filter(function (e) { return e.pixel; }).length, outputs: pxOut, controllers: pxQty, product: pxCtl ? { id: pxCtl.id, label: pxCtl.label, outputs: pxCtl.outputs } : null },
        dmx: { runs: dmxRuns.length, channels: dmxCh, universes: universes, decoders: dec.count != null ? dec.count : Math.ceil(dmxCh / c.decoderChannels), pixelOutputs: pxOut, pixelControllers: pxQty },
        byControl: byControl, triacDrivers: out.filter(function (e) { return e.control === 'triac'; }).reduce(function (a, e) { return a + e.driver.drivers; }, 0) }; })(),
      cable: Object.keys(cable).sort(function (a, b) { return parseFloat(a) - parseFloat(b); }).map(function (k) { return { csa: k, metres: Math.ceil(cable[k] * 1.15) }; }),   // +15 % like every other cable estimate
      schedule: out.map(scheduleRow),
      headEnds: headEnds
    };
    res.electrical = electrical(res, c);   // 1.5.0
    res.cabling = cabling(res, c);   // 1.7.0
    return res;
  }

  // ── cabling (1.7.0) — every cable type distinct, never mixed with the control kit ─────────────────────────
  // field  — the LV cable from the head end / local PSU to the strip, by what it carries: 24 V feed (2C), decoder output (channels + a common
  //          +V: 1 ch 2C, tunable 3C, RGB 4C, RGBW 5C, RGBCCT 6C) or pixel (3C V+ / data / 0 V; extra injection feeds are 2C). Metres per csa
  //          from the feed cables, + 15 %.
  // data   — DMX: one link lead per decoder (node → decoder → decoder daisy chain) + a 120 Ω terminator on the last decoder of each universe;
  //          Cat6 from the network switch to each node / pixel controller (PoE where the node takes it).
  // board  — short PSU → decoder / controller links on the board (count, cut on site).
  // mains  — the 230 V circuits, by the electrical contractor (radials, dimmed feeds, FCUs / sockets — see electrical()).
  function coresFor(e) { if (e.pixel) return 3; if (e.decoder && e.dmx && !e.dmx.data) return Math.max(1, num(e.dmx.channels, 1)) + 1; return 2; }
  function cableRole(e) { return e.pixel ? 'pixel' : (e.decoder ? 'decoder' : 'feed'); }
  function cabling(eng, c) {
    var field = {}, board = 0, dec = 0, buses = {}, cat6 = 0;
    (eng.runs || []).forEach(function (e) {
      var cores = coresFor(e), role = cableRole(e);
      (e.cables || []).forEach(function (cb, k) {
        var nC = role === 'pixel' && k > 0 ? 2 : cores, rl = role === 'pixel' && k > 0 ? 'feed' : role;
        cb.cores = nC; cb.label = nC + 'C ' + cb.csa + ' mm²';
        var key = rl + '|' + nC + '|' + cb.csa, f = field[key] = field[key] || { role: rl, cores: nC, csa: cb.csa, metres: 0, runs: [] };
        f.metres += num(cb.length_m); if (f.runs.indexOf(e.id) < 0) f.runs.push(e.id);
      });
      if (e.cable) { e.cable.cores = cores; e.cable.label = cores + 'C ' + e.cable.csa + ' mm²'; e.cable.role = role; }
      if (e.decoder || e.pixel) board++;
    });
    var ctl = eng.controllers || {};
    (ctl.decoderProducts || []).forEach(function (d) { dec += num(d.qty); });
    (eng.runs || []).forEach(function (e) { if (e.decoder && e.dmx && e.dmx.universe) buses[(e.dmx.node || '?') + '|' + e.dmx.universe] = 1; });
    (ctl.nodes || []).forEach(function (n) { if (n.runs) cat6 += Math.max(1, (n.interface && n.interface.qty) || 1); });
    cat6 += num(ctl.pixel && ctl.pixel.controllers);
    var ROLE = { feed: '24 V feed (PSU to strip)', decoder: 'Decoder output (decoder to strip)', pixel: 'Pixel strip (controller to strip)' };
    var CORES = { feed: 'V+ / 0 V', pixel: 'V+ / data / 0 V' };
    var fieldRows = Object.keys(field).map(function (k) { var f = field[k]; return { role: f.role, what: ROLE[f.role], cores: f.cores, csa: f.csa, label: f.cores + 'C ' + f.csa + ' mm²', conductors: f.role === 'decoder' ? 'common +V / ' + (f.cores - 1) + ' channel' + (f.cores === 2 ? '' : 's') : CORES[f.role], metres: Math.ceil(f.metres * 1.15), runs: f.runs }; })
      .sort(function (a, b) { var o = { feed: 0, decoder: 1, pixel: 2 }; return o[a.role] - o[b.role] || a.cores - b.cores || parseFloat(a.csa) - parseFloat(b.csa); });
    var el = eng.electrical || {}, t = el.totals || {};
    return {
      field: fieldRows,
      data: [].concat(dec ? [{ kind: 'dmx-link', what: 'DMX link lead (node → decoder → decoder)', spec: 'Screened DMX / Cat6 STP, RJ45 or terminal per decoder', qty: dec }] : [])
        .concat(Object.keys(buses).length ? [{ kind: 'dmx-term', what: 'DMX 120 Ω terminator', spec: 'On the last decoder of each universe', qty: Object.keys(buses).length }] : [])
        .concat(cat6 ? [{ kind: 'cat6', what: 'Cat6 to the network switch', spec: 'One per DMX node / pixel controller (PoE where the node takes it)', qty: cat6 }] : []),
      board: board ? [{ kind: 'board', what: 'PSU → decoder / controller link', spec: 'Short 2C on the board, cut on site', qty: board }] : [],
      mains: [].concat(t.circuits ? [{ kind: 'radial', what: 'Head-end radial', spec: 'Unswitched, ' + num(c.headEndCircuitA, 10) + ' A type C MCB at the DB, to a DP isolator on the board', qty: t.circuits }] : [])
        .concat(t.dimmedFeeds ? [{ kind: 'dimmed', what: 'Dimmed feed', spec: 'From the lighting control dimmer channel to a JB on the board / local driver', qty: t.dimmedFeeds }] : [])
        .concat(t.fcus ? [{ kind: 'fcu', what: 'Fused spur (FCU) for a local driver', spec: 'Accessible, beside the driver', qty: t.fcus }] : [])
        .concat(t.sockets ? [{ kind: 'socket', what: 'Socket for a plug-in local driver', spec: 'Accessible, beside the driver', qty: t.sockets }] : [])
    };
  }
  // ── electrical requirements (1.5.0) ───────────────────────────────────────
  // What the electrical contractor provides for the LED lighting, from the engineered project:
  //   boards — each head end: unswitched radial(s) on type C MCBs sized from the PSU INPUT watts of its constant-supply drivers
  //            (DMX / switched / 0-10V / DALI / pixel PSUs), ≤ driversPerCircuit drivers a circuit (inrush), plus one DIMMED feed
  //            per triac circuit from the lighting control system; decoders / nodes / pixel controllers are ELV inside the board.
  //   spurs  — each local driver: unswitched fused spur (BS 1362 fuse from input A × 1.25) or, for a triac driver, the dimmed live
  //            brought to the local driver position — accessible (void hatch / joinery), never buried.
  //   dimmer — one phase-dimmer channel per triac circuit, with its load (control system to provide the channel).
  // rows = the same, flattened for the Takeoffs Electrical Requirements page (kind / what / floor / room / req).
  function fuseFor(a, c) { var s = (c.spurFuses || [3, 5, 13]).slice().sort(function (x, y) { return x - y; }); var need = a * 1.25; for (var i = 0; i < s.length; i++) if (s[i] >= need) return s[i]; return s[s.length - 1]; }
  function electrical(eng, o) {
    var c = cfg(o); eng = eng || {};
    var V = num(c.mainsV, 230), pf = num(c.powerFactor, 0.95), amps = function (w) { return Math.round(w / (V * pf) * 100) / 100; };
    var heads = eng.headEnds || [{ id: 'HE1', label: 'Lighting head end' }], boards = {}, spurs = [], dimmer = [];
    heads.forEach(function (h) { boards[h.id] = { id: h.id, label: h.label, location: h.location || '', floor: h.floor || '', drivers: [], decoders: [], nodes: [], pixel: [], circuits: [], dimmedFeeds: [], input_w: 0, constant_w: 0, dimmed_w: 0 }; });
    var decSeen = {};
    (eng.runs || []).forEach(function (e) {
      var d = e.driver || {}; if (!d.drivers) return;
      var triac = e.control === 'triac', inW = num(e.input_w) || r1(e.load_w / num(c.psuEfficiency, 0.9));
      var drvItem = { run: e.id, floor: e.floor, room: e.room, label: d.product ? d.product.label : ('Generic ' + d.driver_w + ' W CV driver'), size_w: d.driver_w, qty: d.drivers, input_w: inW, control: e.control, dims_mm: (d.product && d.product.dims_mm) || null, mount: (d.product && d.product.mount) || 'surface', product: d.product ? d.product.id : null };
      if (e.location === 'head-end') {
        var b = boards[e.headEnd] || boards[heads[0].id];
        b.drivers.push(drvItem); b.input_w += inW;
        if (triac) { b.dimmed_w += inW; b.dimmedFeeds.push({ run: e.id, floor: e.floor, room: e.room, input_w: inW, load_w: e.load_w }); }
        else b.constant_w += inW;
        if (e.decoder && !decSeen[e.decoder.zone]) { decSeen[e.decoder.zone] = 1; b.decoders.push({ zone: e.decoder.zone, label: e.decoder.label, qty: e.decoder.qty || 1, channels: e.decoder.channels, dims_mm: e.decoder.dims_mm || null, mount: e.decoder.mount || 'surface' }); }
        if (e.pixel) b.pixel.push({ run: e.id, output: e.pixel.output, controller: e.pixel.controller, mount: e.pixel.mount || 'surface', dims_mm: e.pixel.dims_mm || null });
      } else {
        var ia = amps(inW), plug = e.localSupply === 'plug', round = plug && triac;
        var fuse = round ? fuseFor(ia, { spurFuses: [3, 5] }) : fuseFor(ia, c);   // dimmed plug-in = BS 546 round pin, BS 646 fused plug (3 A minimum for LED driver inrush) — 5 A = unfused on the 5 A circuit
        var where = ' beside the local driver — accessible (void hatch / joinery), not buried';
        spurs.push({ run: e.id, floor: e.floor, room: e.room, driver: drvItem.label, size_w: d.driver_w, qty: d.drivers, input_w: inW, input_a: ia, fuse_a: fuse, fuse_std: round ? (fuse < 5 ? 'BS 646' : 'circuit') : 'BS 1362', dimmed: triac, localSupply: plug ? 'plug' : 'fcu',
          kind: plug ? (triac ? 'LED DIMMED SOCKET' : 'LED SOCKET') : (triac ? 'LED DIMMED FCU' : 'LED FCU'),
          supply: plug ? (triac ? '5 A round-pin socket (BS 546) on the dimmed lighting circuit from the lighting control dimmer channel — plug-in driver on a ' + (fuse < 5 ? fuse + ' A fused round-pin plug (BS 646)' : '5 A round-pin plug (circuit-protected)') + where
                                : '13 A switched socket outlet for the plug-in driver — ' + fuse + ' A plug-top fuse (BS 1362)' + where)
                       : (triac ? 'Fused connection unit (FCU) with a ' + fuse + ' A fuse (BS 1362) on the dimmed live from the lighting control dimmer channel' + where
                                : 'Unswitched fused connection unit (FCU) with a ' + fuse + ' A fuse (BS 1362)' + where),
          decoder: e.decoder ? e.decoder.label : null });
      }
      if (triac) dimmer.push({ run: e.id, floor: e.floor, room: e.room, location: e.location, headEnd: e.location === 'head-end' ? e.headEnd : null, load_w: e.load_w, input_w: inW, driver: drvItem.label });
    });
    (eng.controllers && eng.controllers.nodes || []).forEach(function (n) { if (n.runs && n.headEnd !== null) { var b = boards[n.headEnd] || boards[heads[0].id]; if (b) b.nodes.push({ id: n.id, label: n.label, product: n.interface && n.interface.product ? n.interface.product.label : null, universes: n.universes, dims_mm: (n.interface && n.interface.product && n.interface.product.dims_mm) || null, mount: (n.interface && n.interface.product && n.interface.product.mount) || 'surface' }); } });
    var list = heads.map(function (h) { return boards[h.id]; }).filter(function (b) { return b.drivers.length || b.decoders.length || b.nodes.length; });
    list.forEach(function (b) {
      var constDrivers = b.drivers.filter(function (x) { return x.control !== 'triac'; }), ia = amps(b.constant_w), circuitA = num(c.headEndCircuitA, 10);
      var nCirc = constDrivers.length ? Math.max(Math.ceil(ia * 1.25 / circuitA), Math.ceil(constDrivers.reduce(function (a, x) { return a + x.qty; }, 0) / Math.max(1, num(c.driversPerCircuit, 6)))) : 0;
      if (!constDrivers.length && (b.decoders.length || b.nodes.length)) nCirc = 1;   // ELV kit still needs an unswitched supply
      // share drivers over the circuits, biggest first, lightest circuit next
      var circ = []; for (var i = 0; i < nCirc; i++) circ.push({ id: 'C' + (i + 1), mcb_a: circuitA, input_w: 0, drivers: [] });
      constDrivers.slice().sort(function (x, y) { return y.input_w - x.input_w; }).forEach(function (x) { var t = circ.slice().sort(function (p, q) { return p.input_w - q.input_w || p.drivers.length - q.drivers.length; })[0]; t.input_w += x.input_w; t.drivers.push(x.run); x.circuit = t.id; });
      circ.forEach(function (t) { t.input_w = r1(t.input_w); t.input_a = amps(t.input_w); });
      b.dimmedFeeds.forEach(function (f, i) { f.id = 'D' + (i + 1); var dx = b.drivers.filter(function (x) { return x.run === f.run; })[0]; if (dx) dx.circuit = f.id; });
      b.circuits = circ; b.input_w = r1(b.input_w); b.input_a = amps(b.input_w); b.constant_w = r1(b.constant_w); b.dimmed_w = r1(b.dimmed_w);
      b.supply = (nCirc ? nCirc + ' no. unswitched ' + circuitA + ' A type C radial' + (nCirc === 1 ? '' : 's') + ' (' + r1(b.constant_w) + ' W / ' + amps(b.constant_w) + ' A PSU input)' : '') +
        (b.dimmedFeeds.length ? (nCirc ? ' + ' : '') + b.dimmedFeeds.length + ' no. dimmed feed' + (b.dimmedFeeds.length === 1 ? '' : 's') + ' from the lighting control dimmer channels (' + r1(b.dimmed_w) + ' W)' : '') +
        ' — to the head-end board' + (b.location ? ' in ' + b.location : '') + ', accessible and ventilated';
    });
    var rows = [];
    list.forEach(function (b) { rows.push({ kind: 'LED HEAD END', what: b.label + ' — ' + b.drivers.length + ' driver' + (b.drivers.length === 1 ? '' : 's') + (b.decoders.length ? ', ' + b.decoders.reduce(function (a, x) { return a + x.qty; }, 0) + ' decoder(s)' : ''), floor: b.floor || '—', room: b.location || '—', req: b.supply }); });
    spurs.forEach(function (sp) { rows.push({ kind: sp.kind, what: sp.run + ' — ' + (sp.qty > 1 ? sp.qty + ' no. ' : '') + sp.size_w + ' W driver (' + sp.input_w + ' W in) · ' + (sp.fuse_std === 'circuit' ? 'no plug fuse' : sp.fuse_a + ' A fuse'), floor: sp.floor || '—', room: sp.room || '—', req: sp.supply }); });
    var totW = r1(list.reduce(function (a, b) { return a + b.input_w; }, 0) + spurs.reduce(function (a, x) { return a + x.input_w; }, 0));
    return { version: VERSION, boards: list, spurs: spurs, dimmer: dimmer, rows: rows,
      totals: { input_w: totW, input_a: amps(totW), boards: list.length, circuits: list.reduce(function (a, b) { return a + b.circuits.length; }, 0), dimmedFeeds: dimmer.length, spurs: spurs.filter(function (x) { return !x.dimmed; }).length, localDimmed: spurs.filter(function (x) { return x.dimmed; }).length,
        fcus: spurs.filter(function (x) { return x.localSupply === 'fcu'; }).length, sockets: spurs.filter(function (x) { return x.localSupply === 'plug'; }).length },
      basis: 'PSU input = LED load ÷ ' + num(c.psuEfficiency, 0.9) + ' efficiency; A = W ÷ (' + V + ' V × ' + pf + ' pf); head-end radials ' + num(c.headEndCircuitA, 10) + ' A type C, ≤ ' + num(c.driversPerCircuit, 6) + ' drivers a circuit (inrush); local drivers on an FCU or a plug-in socket (per run); fuse ≥ 1.25 × input A.' };
  }
  // one flat row per run for a schedule table (Takeoffs aspect / Lighting PDF) — strings, service order kept by the caller
  function scheduleRow(e) {
    var drv = e.driver.drivers ? ((e.driver.drivers > 1 ? e.driver.drivers + ' × ' : '') + e.driver.driver_w + ' W' + (e.driver.loaded_pct ? ' (' + e.driver.loaded_pct + ' %)' : '')) : '—';
    var feeds = e.feeds.length + (e.feedsManual ? ' (marked)' : '') + ' @ ' + e.feeds.map(function (m) { return m + 'm'; }).join(', ');
    var cab = e.cable ? e.cable.csa + ' mm² · ' + e.cable.length_m + ' m · ' + e.cable.drop_pct + ' %' : '—';
    return [e.floor || '—', e.id || '—', e.room || '—', e.strip.label + ' · ' + e.strip.volts + ' V · ' + e.strip.wpm + ' W/m', e.metres.toFixed(1), e.load_w.toFixed(0), feeds, drv, (e.driverAt ? e.driverAt + (e.location === 'local' ? ' · ' + (e.localSupply === 'plug' ? 'plug-in' : 'FCU') : '') : locText(e)), cab, e.controlLabel || '—', dmxText(e), (e.flags.length ? e.flags.join(' · ') + ' — ' : '') + e.notes.join('; ')];
  }
  function dmxText(e) {
    if (e.pixel) return 'pixel ' + (e.pixel.output || 'output');   // 1.4.0
    if (!e.dmx) return '—';
    if (e.dmx.data) return 'pixel ' + (e.dmx.output || 'output');
    if (!e.dmx.universe || !e.dmx.address) return e.dmx.channels + ' ch';
    var pad = function (n) { return ('00' + n).slice(-3); };
    return (e.dmx.nodeLabel ? e.dmx.nodeLabel + ' · ' : '') + 'U' + e.dmx.universe + ' · ' + pad(e.dmx.address) + (e.dmx.channels > 1 ? '–' + pad(e.dmx.address + e.dmx.channels - 1) : '') + (e.dmx.manual ? ' (set)' : '');
  }
  var SCHEDULE_HEADERS = ['Floor', 'ID', 'Room', 'Strip', 'Metres', 'Load W', 'Feeds', 'Driver', 'Driver at', 'Feed cable', 'Control', 'DMX', 'Notes'];
  function locText(e) { return e.location === 'local' ? 'local · ' + (e.localSupply === 'plug' ? 'plug-in' : 'FCU') : 'head end' + (e.headEnd ? ' ' + e.headEnd : ''); }

  global.SonorLedEng = { VERSION: VERSION, DEFAULTS: DEFAULTS, CONTROLS: CONTROLS, mountOf: mountOf,
    load: load, useCatalogue: useCatalogue, decoders: function () { return CAT.decoders.slice(); }, interfaces: function () { return CAT.interfaces.slice(); }, pixelControllers: function () { return CAT.pixelCtl.slice(); }, chooseInterface: function (u, o) { return chooseInterface(u, cfg(o)); }, electrical: function (eng, o) { return (eng && eng.electrical) || electrical(eng, o); }, locText: locText, supplyOptions: function (t, q, o) { return supplyOptions(t, q, o); }, supplyFor: function (t, q, o) { return supplyFor(typeof t === 'string' ? strip(t) : t, q, o); }, effectiveStrip: effectiveStrip, houseStrips: function () { return CAT.strips.filter(function (s) { return !s.supply; }); }, supplierProducts: function () { return CAT.strips.filter(function (s) { return s.supply; }); }, catalogue: catalogueInfo, strips: function () { return CAT.strips.slice(); }, drivers: function () { return CAT.drivers.slice(); }, strip: strip, stripsById: stripsById, pickDriver: pickDriver, fromTakeoffsFloors: fromTakeoffsFloors, rules: function () { return cfg(); }, controlFor: controlFor, dmxText: dmxText, run: run, project: project, driverFor: driverFor, feedCable: feedCable, stripMaxFeedM: function (st) { return stripMaxFeedM(st, cfg()); }, scheduleRow: scheduleRow, SCHEDULE_HEADERS: SCHEDULE_HEADERS };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
