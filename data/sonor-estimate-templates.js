/* sonor-estimate-templates.js — CANONICAL MASTER (workspace root data/; synced to every estimate consumer's data/)
   v1.1.0 · 2026-11-09 · B-809 · sonor-platform §67 (1.1.0: Whole house estimate read from Takeoffs).  window.__SONOR_ESTIMATE_TEMPLATES__ = { <kind>: template }
   The SAME JSON is seeded into Supabase `estimate_templates` (template column) — the table wins when it loads; this file is
   the offline tier and the seed source. Edit here, re-seed (sonor-master/supabase/estimates-*.sql), sync.

   template = { kind, title (document name), cover (covers.json key), progress[] (design apps it hands off to; param 'project' adds &project=<uuid> for apps that read it as the project id — Garden Lighting / Stretched Fabric / Seating read ?project= as a title, so they get ?pid= only),
                inputs[{key,label,unit,default,step,min,max,kind:'num'|'bool'}],
                defaults{margin, labourSell, labourCost, contingency},
                sections[{key, service_nn | hex, title, note, optional, when, labour_label,
                          rows[{label, model_id, qty (expr), unit, labour_h (expr), sell_ex (number | expr — house price ex VAT,
                                from the latest WeQuote quote), optional, allowance, when (expr)}]}],
                basis[], flags[], included[], excluded[], overview{points[]} }
   Expressions use the input keys only (w, d, h in metres derived from *_mm; see SonorEstimate.evalQty). Sections run in
   Sonor service order (01 → 10); a section with a gold hex (fabric, joinery) sits where the job reads best.
   House prices = WeQuote #2805 rev 1 (1410, 2026-11-09) and the ENQ-MW01 R4 cost check (2026-11-09) until the WeQuote price
   mirror carries sell prices (gap — wq_products has no price columns today).
*/
(function (global) {
  'use strict';
  var GOLD = '#ad9978';
  var T = {};

  // ── CINEMA ESTIMATE ────────────────────────────────────────────────────────────────────────────────
  T.cinema = {
    kind: 'cinema', title: 'Cinema estimate', cover: 'cinema', app: 'estimate-cinema', version: '1.1.0',
    progress: [{ app: 'takeoffs', label: 'Takeoffs', param: 'project' }, { app: 'cinemaDesign', label: 'Cinema Design', param: 'project' }, { app: 'stretchedFabric', label: 'Stretched Fabric', param: 'pid' }, { app: 'ledCalc', label: 'LED Calc', param: 'project' }, { app: 'seating', label: 'Seating', param: 'pid' }, { app: 'estimate-whole-home', label: 'Whole House Estimate', param: 'project' }],
    inputs: [
      { key: 'w_mm', label: 'Room width', unit: 'mm', default: 5000, step: 50 },
      { key: 'd_mm', label: 'Room depth', unit: 'mm', default: 6000, step: 50 },
      { key: 'h_mm', label: 'Ceiling height', unit: 'mm', default: 2400, step: 10 },
      { key: 'screen_in', label: 'Screen size', unit: 'in', default: 120, step: 5 },
      { key: 'projector', label: 'Projector (0 = TV)', unit: '', default: 1, kind: 'bool' },
      { key: 'seats', label: 'Seats', unit: '', default: 4, step: 1, min: 0 },
      { key: 'heights', label: 'Height speakers', unit: '', default: 4, step: 2, min: 0 },
      { key: 'fabric', label: 'Fabric walls', unit: '', default: 1, kind: 'bool' },
      { key: 'fabric_walls', label: 'Fabric walls (of 4)', unit: '', default: 4, step: 1, min: 0, max: 4 },
      { key: 'shades', label: 'Motorised blinds / curtains', unit: '', default: 0, step: 1, min: 0 }
    ],
    defaults: { margin: 0.3, labourSell: 62, labourCost: 31, contingency: 0 },
    sections: [
      { key: 'av', service_nn: '01', title: 'AV system', note: 'Speaker positions on the design drawings.', rows: [
        { model_id: 'SONY-XW5100ES', label: 'Sony VPL-XW5100ES 4K laser projector', when: 'projector', qty: 1, sell_ex: 5499, labour_h: 4 },
        { label: 'Acoustically transparent screen — {screen_in}-inch', when: 'projector', qty: 1, sell_ex: 'screen_in * 22', labour_h: 3, allowance: true },
        { label: 'Television — {screen_in}-inch', when: '!projector', qty: 1, sell_ex: 'screen_in * 30', labour_h: 1, allowance: true },
        { model_id: 'SANUS-VLF728', label: 'Sanus full-motion TV mount and fixings', when: '!projector', qty: 1, sell_ex: 265.95, labour_h: 1 },
        { model_id: 'YAMAHA-RX-A6A', label: 'Yamaha A6A Aventage AV receiver', qty: 1, sell_ex: 2333.6, labour_h: 2 },
        { model_id: 'MA-W2M', label: 'Monitor Audio W2M in-wall speakers — left, centre, right', qty: 3, sell_ex: 500, labour_h: 1.5 },
        { model_id: 'MA-W180', label: 'Monitor Audio W180 in-wall speakers — surrounds', qty: 'seats > 4 ? 4 : 2', sell_ex: 208.33, labour_h: 1 },
        { label: 'In-ceiling height speakers', qty: 'heights', sell_ex: 240, labour_h: 1 },
        { model_id: 'REL-T9X', label: 'REL T/9x subwoofer with wireless adapter', qty: 'seats > 6 ? 2 : 1', sell_ex: 1343.2, labour_h: 0.5 }
      ] },
      { key: 'seating', service_nn: '01', title: 'Cinema seating', when: 'seats', rows: [
        { label: 'Cinema recliners — {seats} seats', qty: 'seats', unit: 'seat', showQty: false, sell_ex: 1250, labour_h: 0.5, allowance: true }
      ] },
      { key: 'fabric', hex: GOLD, title: 'Stretched fabric walls', when: 'fabric', note: 'Acoustic stretched fabric over concealed track; per-wall figures follow the design.', labour: false, rows: [
        { label: 'Acoustic stretched fabric — walls', qty: '((w + d) * 2 * fabric_walls / 4) * h', unit: 'm²', sell_ex: 165, allowance: true },
        { label: 'Trim and builder works', qty: 1, sell_ex: '((w + d) * 2 * fabric_walls / 4) * 45', allowance: true }
      ] },
      { key: 'lighting', service_nn: '04', title: 'Lighting', rows: [
        { label: 'LED — perimeter and feature strips', qty: '(w + d) * 2', unit: 'm', sell_ex: 95, allowance: true, labour_h: 0.4 },
        { label: 'Dimming interface for the control system', qty: 1, sell_ex: 583.33, allowance: true }
      ] },
      { key: 'shades', service_nn: '05', title: 'Shades', when: 'shades', rows: [
        { label: 'Motorised blind or curtain', qty: 'shades', sell_ex: 900, labour_h: 2, allowance: true },
        { label: 'Bond Bridge with Control4 driver', qty: 1, sell_ex: 314.27, labour_h: 1 }
      ] },
      { key: 'control', service_nn: '07', title: 'Control system', labour_label: 'Programming and commissioning', rows: [
        { model_id: 'C4-CORE1', label: 'Control4 CORE 1 controller', qty: 1, sell_ex: 807, labour_h: 2 },
        { model_id: 'C4-HALO-TOUCH', label: 'Control4 Halo Touch remote', qty: 1, sell_ex: 852, labour_h: 0.6 },
        { model_id: 'C4-HALO-TOUCH', label: 'Second Halo Touch remote', qty: 1, sell_ex: 494, optional: true }
      ] },
      { key: 'infra', service_nn: '10', title: 'Cabling and first fix', rows: [
        { label: 'AV and speaker cabling, back boxes, conduit', qty: 1, sell_ex: 650, labour_h: 8, allowance: true }
      ] }
    ],
    basis: ['Room sizes as supplied; final quantities follow the survey and the design drawings.', 'Products as named, or an equivalent of the same standard.', 'Includes VAT at 20%; excludes decoration and anything not described.'],
    flags: [{ label: 'Electrical · by others', text: 'Electrical work is not included — supplies, circuits and connections by the site electrician.', hex: '#ec6061' }],
    included: ['Supply, installation and commissioning of the equipment listed.', 'Calibration of the sound system to the room.', 'Programming of the control system and a handover.'],
    excluded: ['Building, plastering and decorating, unless listed.', 'Electrical supplies and circuits (site electrician).', 'Furniture and soft furnishings beyond the seating listed.'],
    overview: { points: ['A preliminary budget to plan with — the design and a measured quotation follow.', 'Options are shown as the change they make and can be added at any stage.'] }
  };

  // ── MEDIA WALL ESTIMATE (ENQ-MW01 R4 pattern: build · finishes · lighting · electrical · fire · AV · making good, + 10 % contingency) ──
  T['media-wall'] = {
    kind: 'media-wall', title: 'Media wall estimate', cover: 'contract', app: 'estimate-media-wall', version: '1.1.0',
    progress: [{ app: 'takeoffs', label: 'Takeoffs', param: 'project' }, { app: 'mediaWall', label: 'Media Wall', param: 'project' }, { app: 'ledCalc', label: 'LED Calc', param: 'project' }, { app: 'estimate-whole-home', label: 'Whole House Estimate', param: 'project' }],
    inputs: [
      { key: 'w_mm', label: 'Wall width', unit: 'mm', default: 4500, step: 10 },
      { key: 'h_mm', label: 'Ceiling height', unit: 'mm', default: 2400, step: 10 },
      { key: 'depth_mm', label: 'Wall depth', unit: 'mm', default: 450, step: 10 },
      { key: 'screen_in', label: 'TV size', unit: 'in', default: 65, step: 5 },
      { key: 'fire', label: 'Electric fire', unit: '', default: 1, kind: 'bool' },
      { key: 'shelf_runs', label: 'Lit shelf runs', unit: '', default: 4, step: 1, min: 0 },
      { key: 'remove_fire', label: 'Remove existing fireplace', unit: '', default: 0, kind: 'bool' },
      { key: 'mdf', label: 'Sprayed MDF instead of stud', unit: '', default: 0, kind: 'bool' },
      { key: 'new_av', label: 'New TV + soundbar', unit: '', default: 0, kind: 'bool' }
    ],
    defaults: { margin: 0.3, labourSell: 62, labourCost: 31, contingency: 0.1 },
    sections: [
      { key: 'build', hex: GOLD, title: 'Construction and joinery', labour: false, rows: [
        { label: 'Full-height stud wall, plastered and skimmed, cupboards with painted MDF doors, shelves', qty: 1, sell_ex: 'w * h * 410', when: '!mdf' },
        { label: 'Built MDF cabinetry, spray finished', qty: 1, sell_ex: 'w * h * 630', when: 'mdf' },
        { label: 'Survey, protection and removing the existing fireplace', qty: 1, sell_ex: 650, when: 'remove_fire' },
        { label: 'Built MDF cabinetry, spray finished, instead of the stud wall', qty: 1, sell_ex: 'w * h * 220', optional: true, when: '!mdf' }
      ] },
      { key: 'finishes', hex: GOLD, title: 'Finishes and mouldings', labour: false, rows: [
        { label: 'Painting, cornice, skirting and picture rail', qty: 1, sell_ex: 'w * 460' }
      ] },
      { key: 'av', service_nn: '01', title: 'AV', rows: [
        { label: 'AV installation — your existing TV and soundbar', qty: 1, sell_ex: 250, when: '!new_av' },
        { label: 'New {screen_in}-inch TV and mount', qty: 1, sell_ex: 'screen_in * 15', labour_h: 2, when: 'new_av', allowance: true },
        { label: 'Soundbar to match your TV', qty: 1, sell_ex: 583, when: 'new_av', allowance: true },
        { label: 'Sonos Arc Ultra in place of the soundbar', qty: 1, sell_ex: 917, optional: true }
      ] },
      { key: 'lighting', service_nn: '04', title: 'Shelf lighting', when: 'shelf_runs', labour: false, rows: [
        { label: 'Continuous LED shelf runs with drivers and dimming', qty: 'shelf_runs', sell_ex: 162.5 }
      ] },
      { key: 'fire', service_nn: '06', title: 'Electric fire', when: 'fire', labour: false, rows: [
        { label: 'Linear electric fire — supply and fitting', qty: 1, sell_ex: 1800, allowance: true }
      ] },
      { key: 'electrical', service_nn: '10', title: 'Electrical work', labour: false, rows: [
        { label: 'Sockets and spurs for the TV, AV and fire, LED feed, testing', qty: 1, sell_ex: 900 },
        { label: 'Pendant left in place', qty: 1, sell_ex: -330, optional: true }
      ] }
    ],
    basis: ['Sizes as supplied; everything is measured at the survey.', 'Finishes and colours are confirmed from samples before anything is made.', 'Includes VAT at 20%.'],
    flags: null,   // the electrical work is in scope on media walls — no "by others" bar by default
    included: ['The wall built, finished and decorated as described.', 'Shelf lighting, electrical work, fire supply and fitting, and AV installation.'],
    excluded: ['Gas, flue, chimney or structural work.', 'Rewiring, a new consumer unit, or whole-room decorating.', 'New AV equipment, unless chosen from the options.'],
    overview: { points: ['A guide budget for the wall — a measured quotation follows the survey.', 'Changes are shown as the difference they make to the budget.'] }
  };

  // ── MEDIA ROOM ESTIMATE (the cinema pattern without the dedicated room: TV, sound, lighting, control) ──
  T['media-room'] = {
    kind: 'media-room', title: 'Media room estimate', cover: 'cinema', app: 'estimate-media-room', version: '1.1.0',
    progress: [{ app: 'takeoffs', label: 'Takeoffs', param: 'project' }, { app: 'cinemaDesign', label: 'Cinema Design', param: 'project' }, { app: 'mediaWall', label: 'Media Wall', param: 'project' }, { app: 'ledCalc', label: 'LED Calc', param: 'project' }, { app: 'estimate-whole-home', label: 'Whole House Estimate', param: 'project' }],
    inputs: [
      { key: 'w_mm', label: 'Room width', unit: 'mm', default: 4500, step: 50 },
      { key: 'd_mm', label: 'Room depth', unit: 'mm', default: 5000, step: 50 },
      { key: 'h_mm', label: 'Ceiling height', unit: 'mm', default: 2400, step: 10 },
      { key: 'screen_in', label: 'TV size', unit: 'in', default: 77, step: 5 },
      { key: 'surround', label: 'Surround channels (2 / 4)', unit: '', default: 2, step: 2, min: 0 },
      { key: 'heights', label: 'Height speakers', unit: '', default: 0, step: 2, min: 0 },
      { key: 'shades', label: 'Motorised blinds', unit: '', default: 0, step: 1, min: 0 }
    ],
    defaults: { margin: 0.3, labourSell: 62, labourCost: 31, contingency: 0 },
    sections: [
      { key: 'av', service_nn: '01', title: 'AV system', rows: [
        { label: 'Television — {screen_in}-inch', qty: 1, sell_ex: 'screen_in * 30', labour_h: 1, allowance: true },
        { model_id: 'SANUS-VLF728', label: 'Sanus full-motion TV mount and fixings', qty: 1, sell_ex: 265.95, labour_h: 1 },
        { model_id: 'YAMAHA-RX-A6A', label: 'Yamaha A6A Aventage AV receiver', qty: 1, sell_ex: 2333.6, labour_h: 2 },
        { model_id: 'MA-W2M', label: 'Monitor Audio W2M in-wall speakers — left, centre, right', qty: 3, sell_ex: 500, labour_h: 1.5 },
        { model_id: 'MA-W180', label: 'Monitor Audio W180 in-wall speakers — surrounds', qty: 'surround', sell_ex: 208.33, labour_h: 1 },
        { label: 'In-ceiling height speakers', qty: 'heights', sell_ex: 240, labour_h: 1 },
        { model_id: 'REL-T9X', label: 'REL T/9x subwoofer with wireless adapter', qty: 1, sell_ex: 1343.2, labour_h: 0.5 }
      ] },
      { key: 'lighting', service_nn: '04', title: 'Lighting', rows: [
        { label: 'LED — feature strips', qty: '(w + d)', unit: 'm', sell_ex: 95, allowance: true, labour_h: 0.4 },
        { label: 'Dimming interface for the control system', qty: 1, sell_ex: 583.33, allowance: true }
      ] },
      { key: 'shades', service_nn: '05', title: 'Shades', when: 'shades', rows: [
        { label: 'Motorised blind', qty: 'shades', sell_ex: 900, labour_h: 2, allowance: true }
      ] },
      { key: 'control', service_nn: '07', title: 'Control system', labour_label: 'Programming and commissioning', rows: [
        { model_id: 'C4-CORE1', label: 'Control4 CORE 1 controller', qty: 1, sell_ex: 807, labour_h: 2 },
        { model_id: 'C4-HALO-TOUCH', label: 'Control4 Halo Touch remote', qty: 1, sell_ex: 852, labour_h: 0.6 }
      ] },
      { key: 'infra', service_nn: '10', title: 'Cabling and first fix', rows: [
        { label: 'AV and speaker cabling, back boxes, conduit', qty: 1, sell_ex: 450, labour_h: 6, allowance: true }
      ] }
    ],
    basis: ['Room sizes as supplied; final quantities follow the survey.', 'Products as named, or an equivalent of the same standard.', 'Includes VAT at 20%; excludes decoration and anything not described.'],
    flags: [{ label: 'Electrical · by others', text: 'Electrical work is not included — supplies, circuits and connections by the site electrician.', hex: '#ec6061' }],
    included: ['Supply, installation and commissioning of the equipment listed.', 'Programming of the control system and a handover.'],
    excluded: ['Building and decorating.', 'Electrical supplies and circuits (site electrician).'],
    overview: { points: ['A preliminary budget to plan with — the design and a measured quotation follow.'] }
  };

  // (2026-11-09: no separate garden estimate — APP - Garden Lighting is the garden tool; the Whole House reads its published design)
  // ── WHOLE HOUSE ESTIMATE (1.1.0, 2026-11-09 — Bryn: "a whole house estimate for all services … linked with takeoffs and other apps so it
  //    all syncs, essentially these are a front end export for what i held in the project via other apps") ──
  // Sections are READ from Takeoffs (projects.metadata.takeoff_summary — one row per symbol code, counted), priced per point at the
  // rates below, labour per point per service; a room that has its own estimate (Cinema, Media Wall, Media Room) replaces the raw
  // takeoff points of that service with that estimate's section totals. Nothing is typed: re-read after Takeoffs changes.
  // RATES = BUDGET RATES PER POINT ex VAT (product + cable + termination), first pass 2026-11-09 — Sonor to review against WeQuote.
  T['whole-home'] = {
    kind: 'whole-home', title: 'Whole house estimate', cover: 'scope', app: 'estimate-whole-home', version: '1.1.0', source: 'takeoff',
    progress: [{ app: 'takeoffs', label: 'Takeoffs', param: 'project' }, { app: 'cinemaDesign', label: 'Cinema Design', param: 'project' }, { app: 'estimate-cinema', label: 'Cinema Estimate', param: 'project' }, { app: 'ledCalc', label: 'LED Calc', param: 'project' }, { app: 'gardenLighting', label: 'Garden Lighting', param: 'pid' }],
    inputs: [
      { key: 'rooms', label: 'Rooms (from Takeoffs)', default: null, readonly: true },
      { key: 'floors', label: 'Floors (from Takeoffs)', default: null, readonly: true }
    ],
    defaults: { margin: 0.3, labourSell: 62, labourCost: 31, contingency: 0 },
    takeoff: {
      services: {
        '01': { title: 'Cinema room', per_point: 300, labour_h: 1.5, replaced_by: 'cinema', linked_title: 'Cinema room' },
        '02': { title: 'Multi-room audio', per_point: 250, labour_h: 1.0, groups: [{ label: 'Speakers', re: 'SPKR|SUB' }, { label: 'Amplifiers and sources', default: true }] },
        '03': { title: 'Video distribution and TVs', per_point: 200, labour_h: 1.5, groups: [{ label: 'TV supply and install', re: '^MNT-|TVPOINT|^TV' }, { label: 'Video distribution', default: true }] },
        '04': { title: 'Lighting and lighting control', per_point: 120, labour_h: 0.75, groups: [{ label: 'Lighting control', re: '^KP-|^LPNL|PIR|DMX-CL' }, { label: 'Lighting fixtures', default: true }, { label: 'LED', re: 'LED|^led_m$|DMX-DRV' }, { label: 'Garden lighting', re: '^garden:|^27-' }] },
        '05': { title: 'Shading and automation', per_point: 250, labour_h: 1.5, groups: [{ label: 'Shading', re: '^SHPNL|SHADE|BLIND|CURT' }, { label: 'Automation and sensors', default: true }] },
        '06': { title: 'Heating controls', per_point: 150, labour_h: 1.0, groups: [{ label: 'Thermostats and timeclocks', re: 'STAT|TC-' }, { label: 'Hubs and wiring centres', default: true }] },
        '07': { title: 'Control system', per_point: 400, labour_h: 2.0, groups: [{ label: 'Processor', re: 'PROC' }, { label: 'Touch panels and remotes', default: true }] },
        '08': { title: 'Security, CCTV and access', per_point: 200, labour_h: 1.25, groups: [{ label: 'CCTV', re: 'CAM|NVR' }, { label: 'Intercom and gates', re: 'ANSWER|GATE|DBELL|INTC' }, { label: 'Alarm', default: true }] },
        '09': { title: 'Network and Wi-Fi', per_point: 200, labour_h: 0.75, groups: [{ label: 'Wi-Fi', re: 'AP-|^WAP' }, { label: 'Wired network', default: true }] },
        '10': { title: 'Infrastructure and racks', per_point: 150, labour_h: 1.0, groups: [{ label: 'Racks and power', default: true }, { label: 'Aerial and satellite', re: 'AERIAL|IRS|SAT' }] },
        '11': { title: 'Electrical', exclude: true }
      },
      rates: {
        // 01 cinema (used only when the project has no Cinema estimate)
        'AMP': { label: 'Cinema AV processor / amplifier', sell_ex: 3200, labour_h: 2 }, 'PROJ-4K': { label: '4K projector', sell_ex: 6500, labour_h: 3 },
        '1-SUB-CIN': { label: 'Cinema subwoofer', sell_ex: 1300 }, 'RACK': { label: 'Cinema equipment rack', sell_ex: 450 }, 'FAB-TRACK-H': { skip: true },
        // 02 audio
        '3-SPKR-CEIL': { label: 'Ceiling speaker', sell_ex: 220 }, '3-SPKR-OUT': { label: 'Outdoor speaker', sell_ex: 260 }, '3-SUB': { label: 'Subwoofer', sell_ex: 900 },
        '4-TRIAD-PAMP8': { label: '8-channel power amplifier', sell_ex: 1450, labour_h: 1.5 }, '1-STREAMER': { label: 'Network streamer', sell_ex: 650 }, '2-SBAR-M': { label: 'Soundbar', sell_ex: 1100 },
        // 03 video
        'TVPOINT-4K': { label: 'TV point — 4K', sell_ex: 180 }, '3-MATRIX-8X8': { label: 'HDMI matrix 8 × 8', sell_ex: 3200, labour_h: 3 },
        'MNT-FIXED': { label: 'Fixed TV mount', sell_ex: 90, labour_h: 0.75 }, 'MNT-TILT': { label: 'Tilt TV mount', sell_ex: 120, labour_h: 0.75 }, 'MNT-FM': { label: 'Full-motion TV mount', sell_ex: 280, labour_h: 1 },
        // 04 lighting
        '21-SPOT': { label: 'Surface spotlight', sell_ex: 85 }, '22-STEP': { label: 'Step / plinth light', sell_ex: 75 }, '24-PEND': { label: 'Pendant — connection (fitting by client)', sell_ex: 40, labour_h: 0.5 },
        '24-PEND-LIN': { label: 'Linear pendant — connection (fitting by client)', sell_ex: 60, labour_h: 0.75 }, '4-LED-DRV': { label: 'LED driver', sell_ex: 120 },
        '5-DMX-CL': { label: 'DMX lighting interface', sell_ex: 650, labour_h: 1.5 }, '5-DMX-DRV': { label: 'DMX decoder and LED driver', sell_ex: 180 },
        '6-BATTEN': { label: 'Batten / strip light', sell_ex: 90 }, '6-WALL': { label: 'Wall light', sell_ex: 120 }, 'KP-LUXB': { label: 'Lighting keypad', sell_ex: 260, labour_h: 0.5 },
        'LPNL': { label: 'Lighting control panel (dimming modules)', sell_ex: 1800, labour_h: 6 }, '2-PIR': { label: 'Presence sensor', sell_ex: 140 },
        // 05 automation
        'SHPNL-QS': { label: 'Shade panel — Lutron QS', sell_ex: 1200, labour_h: 4 }, 'SHPNL-RLY': { label: 'Shade panel — relay', sell_ex: 650, labour_h: 3 },
        '6-GARAGE': { label: 'Garage door integration', sell_ex: 350 }, '4-PIR-CEIL': { label: 'Ceiling PIR', sell_ex: 120 }, '3-DOOR': { label: 'Door / window contact', sell_ex: 60, labour_h: 0.5 },
        // 06 heating
        'NEOSTAT': { label: 'Heatmiser neoStat (wired)', sell_ex: 140 }, 'NEOHUB': { label: 'Heatmiser neoHub', sell_ex: 180 }, 'UH8': { label: 'Heatmiser UH8 wiring centre', sell_ex: 220, labour_h: 2 },
        'UFH': { label: 'UFH manifold — controls connection (manifold by plumber)', sell_ex: 150 }, '1-TC-HW': { label: 'Hot water timeclock', sell_ex: 90, labour_h: 0.5 }, '1-TC-TOWEL': { label: 'Towel rail timeclock', sell_ex: 90, labour_h: 0.5 },
        // 07 control
        '1-PROC-MAIN': { label: 'Control processor', sell_ex: 2200, labour_h: 3 }, '2-TP-T4IW8': { label: '8-inch in-wall touch panel', sell_ex: 1650, labour_h: 1.5 }, '3-REM-HAND': { label: 'Handheld remote', sell_ex: 420, labour_h: 0.5 },
        // 08 security
        '1-CAM-TURRET': { label: 'CCTV turret camera', sell_ex: 380, labour_h: 1.5 }, '2-NVR-8': { label: 'NVR — 8 channel', sell_ex: 650, labour_h: 2 }, '4-ANSWER': { label: 'Intercom answer station', sell_ex: 520 },
        '4-GATE-INTC': { label: 'Gate intercom (video door station)', sell_ex: 900, labour_h: 2 }, '4-GATE-REL': { label: 'Gate release interface', sell_ex: 120 }, 'DBELL': { label: 'Video doorbell', sell_ex: 320 },
        'ALM-DOOR': { label: 'Alarm door contact', sell_ex: 45, labour_h: 0.5 }, 'ALM-MTN': { label: 'Alarm motion detector', sell_ex: 75, labour_h: 0.75 }, 'SIREN': { label: 'Alarm siren', sell_ex: 160 },
        // 09 network
        'WAP-CEIL': { label: 'Ceiling Wi-Fi access point', sell_ex: 320 }, '2-AP-OUT': { label: 'Outdoor Wi-Fi access point', sell_ex: 420, labour_h: 1.5 }, '3-DATA-TWIN': { label: 'Twin data point', sell_ex: 120 },
        '4-PATCH-24': { label: '24-port patch panel', sell_ex: 180, labour_h: 2 }, 'RTR': { label: 'Router / firewall', sell_ex: 450 }, 'SW-24-POE': { label: '24-port PoE switch', sell_ex: 950 }, 'SW-8-POE': { label: '8-port PoE switch', sell_ex: 320 },
        // 10 infrastructure
        '3-RACK-18U': { label: '18U comms rack', sell_ex: 650, labour_h: 3 }, '2-RACK-WALL': { label: 'Wall rack', sell_ex: 280, labour_h: 1.5 }, '1-UPS': { label: 'UPS', sell_ex: 550 },
        '7-AERIAL': { label: 'TV aerial', sell_ex: 250, labour_h: 2 }, '7-IRS-COMBO': { label: 'Satellite dish and aerial (IRS)', sell_ex: 850, labour_h: 4 },
        '8-BT-MASTER': { skip: true }, '8-ONT': { skip: true }, 'NODE-0': { skip: true }, 'NODE-1': { skip: true }
      },
      patterns: [
        { re: '^SPKR-', label: 'Cinema speaker', sell_ex: 450, labour_h: 1 }, { re: '^ACOUSTIC-', label: 'Acoustic treatment', sell_ex: 250, labour_h: 1 },
        { re: '^20-DL-', label: 'Downlight', sell_ex: 65, labour_h: 0.5 }, { re: '^23-', label: 'Wall light', sell_ex: 140 }, { re: '^27-', label: 'Exterior light', sell_ex: 160, labour_h: 1 }
      ],
      led_m: { label: 'LED strip, drivers and fitting', sell_ex: 45, labour_h: 0.25 },
      // the garden comes from APP - Garden Lighting's published design when there is one (it replaces the plan's 27- exterior points);
      // first-pass budget rates per fitting ex VAT incl. cable termination — Sonor to review with the garden catalogue's WeQuote prices
      garden: { nn: '04', replaces: '^27-', group: 'Garden lighting',
        kinds: { spike: { label: 'Spike light', sell_ex: 165, labour_h: 0.75 }, flood: { label: 'Flood light', sell_ex: 220, labour_h: 1 }, bollard: { label: 'Bollard light', sell_ex: 320, labour_h: 1.5 },
          wall: { label: 'Exterior wall light', sell_ex: 180, labour_h: 1 }, step: { label: 'Step light', sell_ex: 120, labour_h: 0.75 }, ground: { label: 'In-ground light', sell_ex: 260, labour_h: 1.25 },
          uplight: { label: 'Uplight', sell_ex: 150, labour_h: 0.75 }, feature: { label: 'Water feature light', sell_ex: 280, labour_h: 1 } },
        default: { sell_ex: 180, labour_h: 1 },
        driver: { label: 'Exterior LED driver (IP67)', sell_ex: 95, labour_h: 0.5 }, switch: { label: 'Switching per zone', sell_ex: 65, labour_h: 0.5 }, pir: { label: 'Garden PIR sensor', sell_ex: 120, labour_h: 0.5 },
        strip_m: { label: 'Exterior LED strip', sell_ex: 55, labour_h: 0.3 }, cable_m: { label: 'Exterior cable, ducting and joints', sell_ex: 12, labour_h: 0.1 } },
      programming: { nn: '07', h_per_point: 0.1, label: 'Programming and commissioning — whole house' }
    },
    basis: ['Points and quantities from the Takeoffs plan of the house; final figures follow the survey and design.', 'Budget rates per point include the product, cable and termination at a standard specification.', 'Rooms with their own estimate (for example the cinema) carry that estimate\'s figures.', 'Includes VAT at 20%; excludes building work, decoration and anything not described.'],
    flags: [{ label: 'Electrical · by others', text: 'Electrical work is not included — supplies, sockets, circuits and connections by the site electrician.', hex: '#ec6061' }],
    included: ['Supply, installation and commissioning of the systems listed.', 'Programming of the control system and a handover.', 'Cable and termination for every point shown.'],
    excluded: ['Building and decorating.', 'Electrical supplies, sockets and circuits (site electrician).', 'Light fittings chosen by the client unless listed.'],
    overview: { points: ['A preliminary budget for the whole house by system, read from the plan.', 'Each system can be designed and quoted in full from here.'] }
  };

  global.__SONOR_ESTIMATE_TEMPLATES__ = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
