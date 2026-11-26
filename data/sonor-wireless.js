/* sonor-wireless.js v1.5.0 (2026-11-25) — the ONE wireless toolkit for every Sonor app (window.SonorWireless, or require()).
 * Wi-Fi ↔ Zigbee channel maths, the mesh systems and their maker codes, RF / Zigbee hub guidance, the probe grades,
 * the RF frequencies and the Sonor probe HTTP paths. Used by Network Scanner (page, Pi agent, Android agent) and meant
 * for Takeoffs' wireless planning layer, Site and Remotes, so a channel, a grade or a hub tip means the same everywhere.
 * Workspace master: ~/Code/Sonor/sonor-wireless.js → sync-everything.sh copies it to every APP - * /data/ (and public/data/
 * for the Scanner and Remotes). Never hand-edit a copy. Rule ids in comments refer to wifi-rf-rules.json (research thread).
 */
(function (root) {
  'use strict';
  // ── Zigbee / Thread (802.15.4) channels 11–26 sit in the 2.4 GHz Wi-Fi band: 2405 + 5 × (k − 11) MHz, 2 MHz wide ──
const ZB = Array.from({ length: 16 }, (_, i) => i + 11);
const zbFreq = (k) => 2405 + 5 * (k - 11);
const wifiFreq24 = (c) => (c === 14 ? 2484 : 2407 + 5 * c);
const rfW = (rssi) => (rssi == null || rssi < -90 ? 0 : Math.pow(10, (rssi + 95) / 10));   // wifi.score.algorithm weight
function zigbeeLoad(nets) {   // per Zigbee channel: Wi-Fi spans covering its centre ±1 MHz (zb.overlap.math, zb.pick.algorithm)
  return ZB.map((k) => { const f = zbFreq(k); let mw = 0, score = 0; const who = [];
    for (const n of nets) { if (n.band !== '2.4 GHz' || n.signal == null) continue; const w = n.width || 20; const cf = n.centerFreq || (wifiFreq24(n.channel) + (w >= 40 ? 10 : 0)); const half = w / 2 + 1;
      if (Math.abs(f - cf) < half + 1) { mw += Math.pow(10, n.signal / 10); score += rfW(n.signal); who.push(n); } }
    return { ch: k, freq: f, dbm: mw ? Math.round(10 * Math.log10(mw)) : null, score, who: who.sort((a, b) => b.signal - a.signal) }; });
}
  const ZB_C4 = [15, 20, 25];   // c4.zigbee.channels
  // Each Zigbee (802.15.4) system runs its own mesh on one channel. k = key used in stored settings and uploads.
  // Heatmiser neo is NOT here: it is its own 868 MHz + 2.4 GHz mesh with no channel to set (neo.not_zigbee, v1.3.0).
const ZB_SYS = [
  { k: 'c4', name: 'Control4', pref: [15, 20, 25], from: 'Composer › Network › Zigbee' },
  { k: 'hue', name: 'Hue', pref: [11, 15, 20, 25], from: 'Hue app › Settings › Bridge' },
  { k: 'other', name: 'Other (Thread / Matter, Lutron Type X…)', pref: null, from: 'the hub' },
];
const ZB_LEVELS = { solid: -75, marginal: -85 };   // draft, calibrate on the first unit (Zigbee receivers reach about -100 dBm)
const zbVerdict = (rssi) => (rssi == null ? ['—', ''] : rssi >= ZB_LEVELS.solid ? ['Solid', 'ok'] : rssi >= ZB_LEVELS.marginal ? ['Marginal', 'warn'] : ['Fail', 'bad']);
const ZB_OUI = [[/^00:0F:FF/i, 'c4', 'Control4'], [/^00:17:88/i, 'hue', 'Philips Hue'], [/^EC:1B:BD|^00:0B:57|^90:FD:9F/i, 'other', 'Silicon Labs module']];
const zbMaker = (m) => { const o = ZB_OUI.find(([re]) => re.test(m.ext || '')); return o ? { sys: o[1], name: o[2] } : null; };



  // ── Live Wi-Fi channel load (v1.4.0, wifi.mon.*): one scan → how busy each 20 MHz channel is, weighted by signal (rfW) ──
  const CH24 = Array.from({ length: 13 }, (_, i) => i + 1);
  const CH5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
  const isDfs = (c) => c >= 52 && c <= 144;
  function span(ch, width, band) {   // the 20 MHz channels one network covers
    ch = Number(ch); const w = Number(width) || 20;
    if (band === '2.4 GHz' || ch <= 14) { const lo = w >= 40 ? (ch > 7 ? ch - 6 : ch - 2) : ch - 2; const hi = w >= 40 ? (ch > 7 ? ch + 2 : ch + 6) : ch + 2; return CH24.filter((c) => c >= lo && c <= hi); }
    const k = Math.max(1, Math.round(w / 20)); const base = ch < 100 ? 36 : ch < 149 ? 100 : 149; const start = base + Math.floor((ch - base) / (4 * k)) * 4 * k;
    return CH5.filter((c) => c >= start && c < start + 4 * k);
  }
  // aps: [{ ch | channel, rssi | signal, width?, band?, ssid, bssid }] → { b24: [{ ch, n, score, lvl, top, co, coTop, ovTop, grade }], b5: [...] }
  //   co-channel = the network sits on this 20 MHz (wide networks are co-channel on every 20 MHz they cover, wifi.mon.span);
  //   2.4 GHz neighbours count by spectral-mask overlap (22 − 5n) / 22 for n channels apart (wifi.mon.adjacent); 5 GHz 20 MHz channels don't overlap.
  //   score = Σ rfW × weight · lvl = 10·log10(score) (display; one network at −85 dBm ≈ 10, at −67 ≈ 28) · top = loudest dBm heard on it
  //   grade (wifi.mon.grade, wifi.mon.contenders): Clear = no co-channel network ≥ −85 dBm and no overlapping one ≥ −62;
  //   Crowded = more contenders ≥ −85 than the band allows (2.4: 2, 5: 1), or a co-channel one ≥ −67, or an overlapping one ≥ −62; else Busy.
  const adjW = (n) => Math.max(0, (22 - 5 * n) / 22);
  const CONTENDER = { dbm: -85, strong: -67, overlap: -62, limit24: 2, limit5: 1 };
  function wifiChannelLoad(aps) {
    const mk = (list) => list.map((ch) => ({ ch, n: 0, score: 0, top: null, dfs: isDfs(ch), co: 0, coTop: null, ovTop: null }));
    const b24 = mk(CH24), b5 = mk(CH5);
    for (const a of aps || []) { const ch = Number(a.ch != null ? a.ch : a.channel); const r = a.rssi != null ? a.rssi : a.signal; if (!ch || r == null) continue;
      const band = a.band || (ch <= 14 ? '2.4 GHz' : '5 GHz'); if (band === '6 GHz') continue; const tbl = band === '2.4 GHz' ? b24 : b5;
      let wOf;
      if (band === '2.4 GHz') { const w = Number(a.width) || 20; const lo = w >= 40 ? Math.min(ch, ch > 7 ? ch - 4 : ch + 4) : ch, hi = w >= 40 ? Math.max(ch, ch > 7 ? ch - 4 : ch + 4) : ch;
        wOf = (c) => (c >= lo && c <= hi ? 1 : adjW(c < lo ? lo - c : c - hi)); }
      else { const cover = span(ch, a.width, band); wOf = (c) => (cover.includes(c) ? 1 : 0); }
      for (const t of tbl) { const w = wOf(t.ch); if (!w) continue; t.score += rfW(r) * w; if (t.top == null || r > t.top) t.top = r;
        if (w === 1) { if (t.ch === ch) t.n += 1; if (r >= CONTENDER.dbm) t.co += 1; if (t.coTop == null || r > t.coTop) t.coTop = r; } else if (t.ovTop == null || r > t.ovTop) t.ovTop = r; } }
    for (const [tbl, limit] of [[b24, CONTENDER.limit24], [b5, CONTENDER.limit5]]) for (const t of tbl) { t.lvl = t.score > 1 ? Math.round(10 * Math.log10(t.score)) : 0;
      const ovHot = t.ovTop != null && t.ovTop >= CONTENDER.overlap; t.grade = t.co > limit || (t.coTop != null && t.coTop >= CONTENDER.strong) || ovHot ? 2 : t.co === 0 && !ovHot ? 0 : 1; }
    return { b24, b5 };
  }
  const GRADES = [['Clear', 'ok'], ['Busy', 'warn'], ['Crowded', 'bad']];
  // lvl-only fallback (no per-network detail): wifi.mon.grade — busy ≥ 10 (one at −85 dBm), crowded ≥ 28 (one at −67)
  const LOAD_LEVELS = { busy: 10, crowded: 28 };
  const loadVerdict = (lvl) => (lvl >= LOAD_LEVELS.crowded ? GRADES[2] : lvl >= LOAD_LEVELS.busy ? GRADES[1] : GRADES[0]);
  // Smoothing (wifi.mon.smoothing): median of the last 5 sightings per BSSID, dropped after 3 missed scans. keep = {} per place, reused.
  function smoothAps(keep, aps) {
    const seen = new Set();
    for (const a of aps || []) { const k = a.bssid || `${a.ssid}|${a.ch}`; seen.add(k); const e = keep[k] = keep[k] || { r: [], miss: 0 }; e.ap = a; e.miss = 0; e.r.push(a.rssi != null ? a.rssi : a.signal); if (e.r.length > 5) e.r.shift(); }
    for (const [k, e] of Object.entries(keep)) if (!seen.has(k) && ++e.miss >= 3) delete keep[k];
    return Object.values(keep).map((e) => { const s = e.r.slice().sort((x, y) => x - y); return { ...e.ap, rssi: s[Math.floor(s.length / 2)] }; });
  }
  // Whole-site pick from many places at once: the channel whose WORST spot is quietest (2.4 GHz from 1 / 6 / 11; 5 GHz non-DFS first)
  // wifi.mon.pick: minimax — the channel whose worst place is best (grade first, then lvl), tie-break on the sum over places.
  // Advise a change only when it beats the current channel's worst place by a grade or 6 dB lvl, held for 10 minutes (the page checks the hold).
  function sitePick(loads) {
    const at = (l, band, ch) => (l[band] || []).find((x) => x.ch === ch) || { lvl: 0, grade: 0 };
    const rate = (band, ch) => { const v = loads.map((l) => at(l, band, ch)); return { ch, worst: Math.max(0, ...v.map((x) => x.lvl)), grade: Math.max(0, ...v.map((x) => x.grade || 0)), sum: v.reduce((a, x) => a + x.lvl, 0), dfs: isDfs(ch) }; };
    const order = (a, b) => (a.grade - b.grade) || (a.worst - b.worst) || (a.sum - b.sum);
    return { b24: [1, 6, 11].map((ch) => rate('b24', ch)).sort(order), b5: CH5.map((ch) => rate('b5', ch)).sort((a, b) => (a.dfs - b.dfs) || order(a, b)) };
  }
  const betterBy = (cand, cur) => !!cand && !!cur && (cand.grade < cur.grade || cur.worst - cand.worst >= 6);


  // ── Node battery (node.battery, node.charger, heuristic): Li-ion 18650, 85 % usable; mV from /info (−1 = USB) ──
  const BATT = { mAh: 3000, usable: 0.85, mA: { continuous: 130, sampling: 34, probe: 90 } };
  const battPct = (mv) => (mv == null || mv < 0 ? null : Math.max(0, Math.min(100, Math.round(((mv - 3300) / (4150 - 3300)) * 100))));
  function battHours(mv, mode) { const p = battPct(mv); if (p == null) return null; const mA = BATT.mA[mode] || BATT.mA.probe; return Math.round((BATT.mAh * BATT.usable * (p / 100)) / mA); }

  // ── Zigbee probe energy sweep grades (zbm.grade.energy): max = bursts, median = background ──
  const ZB_ENERGY = { clear: -85, bad: -70, minMarginDb: 10 };
  const energyVerdict = (dbm) => (dbm == null ? ['—', ''] : dbm < ZB_ENERGY.clear ? ['Clear', 'ok'] : dbm <= ZB_ENERGY.bad ? ['Busy', 'warn'] : ['Bad', 'bad']);

  // ── LAN signatures of radio hubs (disc.*): what the scanner's discovery looks for ──
  const LAN = {
    mdns: ['_lutron._tcp', '_hue._tcp', '_ihsp._tcp', '_kizbox._tcp', '_kizboxdev._tcp', '_bond._tcp', '_shelly._tcp', '_meshcop._udp', '_matter._tcp', '_matterc._udp', '_hap._tcp', '_sonor-rf._tcp', '_sonor-zb._tcp'],
    oui: { '000FFF': 'Control4', '001788': 'Philips Hue', F8811A: 'Somfy', '3C6A2C': 'Bond', F44E38: 'Bond', '24FD5B': 'SmartThings', D052A8: 'SmartThings', '286D97': 'SmartThings', '683A48': 'SmartThings' },
    lutronDevclass: { '081B0101': 'RadioRA 3 processor', '08040100': 'Caseta Smart Bridge', '08050100': 'Caseta Smart Bridge Pro', '080E0401': 'RA2 Select main repeater' },
    neohubSeek: { port: 19790, payload: 'hubseek' },   // UDP broadcast; reply hubseek{"ip":..,"device_id":mac}
    tcp: { neohub: [4242, 4243], lutron: [8081, 8083], dirigera: [8443] },
  };

  // ── Auto-match (zbm.auto.flow): which system is each mesh the probe heard? ──
  // found: probe /scan meshes · lan: { hue: ch } channels read from hubs · thread: [{ xp, nn, vn }] from _meshcop._udp
  // Order: a channel read from a hub wins; then Thread by ext PAN; then the maker OUI hint; else a pre-filled dropdown.
  function autoMatch(found, lan, thread) {
    lan = lan || {}; thread = thread || [];
    return (found || []).map((m) => {
      for (const [sys, ch] of Object.entries(lan)) if (ch && Number(ch) === m.ch) return { ...m, sys, how: 'channel read from the hub' };
      if (m.kind === 'thread') { const t = thread.find((x) => x.xp && m.ext && x.xp.replace(/[^0-9a-f]/gi, '').toLowerCase() === m.ext.replace(/[^0-9a-f]/gi, '').toLowerCase()) || (thread.length === 1 ? thread[0] : null);
        return { ...m, sys: 'other', how: t ? `Thread network ${t.nn || ''}${t.vn ? ' (' + t.vn + ')' : ''}` : 'Thread (no payload in the beacon)', thread: t || null }; }
      const mk = zbMaker(m); if (mk) return { ...m, sys: mk.sys, how: 'maker code (hint)' };
      return { ...m, sys: null, how: 'pick the system' };
    });
  }

  // ── Sub-GHz RF + Zigbee hub guidance (zb: true = a Zigbee coordinator, shown on the Zigbee tab) ──
const RF_GUIDE = [
  { test: (d) => /bond/i.test(d.make), band: '300–450 MHz RF (learns the existing remotes) · Wi-Fi to the LAN', tips: ['Central and high, out of racks and metal boxes, in line of sight of as many motors as practical.', 'One Bond covers a typical floor; add a second per floor where the probe shows marginal results.', 'Give it a DHCP reservation; Control4 drives it over the Bond local API.'] },
  { test: (d) => /somfy/i.test(d.make), band: 'RTS 433.42 MHz (one-way) and io-homecontrol 868 MHz (two-way)', tips: ['RTS reaches about 20 m with no more than two internal walls (Somfy quotes 65 ft).', 'RTS is one-way: a missed command looks like a stuck blind, so probe-test every motor from where the transmitter will live; failures need it moved or an extra transmitter.', 'Local API (port 8443) only after Developer Mode is turned on in the Somfy account.'] },
  { test: (d) => /lutron/i.test(d.make), band: 'Clear Connect Type A (UK/EU 868 MHz, US 434 MHz) or Type X (RA3, 2.4 GHz 802.15.4)', tips: ['Every device within 9 m of the processor or a repeater; repeaters within 18 m of each other (Lutron).', 'Never in a metal enclosure or rack.', 'UK systems are 868 MHz: a 433 MHz probe will not measure them; read the frequency on the model label.'] },
  { zb: true, test: (d) => /hue/i.test(d.make) || /hue bridge/i.test(d.kind), band: 'Zigbee 2.4 GHz (channel 11, 15, 20 or 25)', tips: ['Pick the Hue Zigbee channel away from the busiest Wi-Fi (the Zigbee tab shows the clearest channels here).', 'Mains-powered bulbs and plugs repeat: keep some always powered.'] },
  { zb: true, test: (d) => /control4/i.test(d.make) && /controller|director|core|ea-|ca-/i.test(`${d.kind} ${d.model}`), band: 'Zigbee 2.4 GHz mesh (Control4 lighting, keypads, remotes)', tips: ['Zigbee on 15, 20 or 25, picked on the Zigbee tab; never left on the default.', 'Mesh controller never in the rack (secondary controller centrally, or the C4-AK-3M antenna kit) and never on Wi-Fi; every AP at least 5 m away.', 'Max 70 nodes per mesh; 5–9 m between Zigbee devices.'] },
  { test: (d) => /heatmiser/i.test(d.make) || /neohub/i.test(d.kind), band: 'Heatmiser neo mesh (its own radio, 868 MHz + 2.4 GHz, not Zigbee)', tips: ['Not Zigbee: neo is Heatmiser\'s own mesh with no channel to pick, so it is not on the Zigbee 11–26 plan and the Control4 / Hue channels do not affect it (neo.not_zigbee).', 'About 40 m in open space; plan each hop at about 15 m through no more than two internal walls (neo.range_open, neo.range_plan). Up to 32 devices per neoHub (neo.max_devices).', 'The neoHub is the coordinator, wired to the LAN, central and out of the rack. Mains neoStats, neoPlug and Boost are repeaters; battery neoAir is an end device only and never repeats, so put a repeater on every floor and between the hub and far neoAirs (neo.routers, neo.end, neo.per_floor).', 'Control4 drives it over the neoHub local API (port 4242 legacy, 4243 websocket); give it a DHCP reservation.'] },
  { test: (d) => /shelly/i.test(d.make), band: 'Wi-Fi 2.4 GHz', tips: ['Shelly relays sit in back boxes: check Wi-Fi at the box with the walk test before plastering.'] },
];

  // ── Radio role per device (Takeoffs wireless contract v1, SonorWireless 1.4.0; APP - Takeoffs/docs/WIRELESS-CONTRACT.md) ──
  // Same ids and the same built-in table as Takeoffs, so a device is a Repeater or an End device in every app.
  // Precedence: the placement (sonorSymbol.radio = { system, role }) → the Library (sonor_blocks.metadata.radio = { system, role }
  // or { none: true }) → the built-in guess below. radio.off / radio.none = not a radio.
  const SYSTEMS = {
    c4: { label: 'Control4 Zigbee', short: 'C4 ZB', tech: '802.15.4', band: '2.4 GHz', mesh: true, channelled: true },
    hue: { label: 'Philips Hue', short: 'Hue', tech: '802.15.4', band: '2.4 GHz', mesh: true, channelled: true },
    thread: { label: 'Thread / Matter', short: 'Thread', tech: '802.15.4', band: '2.4 GHz', mesh: true, channelled: true },
    lutron_x: { label: 'Lutron Type X', short: 'LX', tech: '802.15.4', band: '2.4 GHz', mesh: true, channelled: true },
    neo: { label: 'Heatmiser neo', short: 'neo', tech: 'neo mesh (not Zigbee)', band: '868 MHz + 2.4 GHz', mesh: true, channelled: false, range_open_m: 40, hop_m: 15, max_nodes: 32 },
    lutron_a: { label: 'Lutron Clear Connect A', short: 'CCA', tech: 'Clear Connect A', band: '868 MHz (UK)', mesh: true, channelled: false },
    rts: { label: 'Somfy RTS', short: 'RTS', tech: 'OOK one-way', band: '433.42 MHz', mesh: false, channelled: false },
    io: { label: 'Somfy io', short: 'io', tech: 'FSK two-way', band: '868 MHz', mesh: false, channelled: false },
    rako: { label: 'Rako wireless', short: 'Rako', tech: 'Rakom coded FM', band: '433.9 MHz', mesh: false, channelled: false },
    bond: { label: 'Bond (learned RF)', short: 'Bond', tech: 'OOK/ASK learned', band: '300–450 MHz', mesh: false, channelled: false },
    wifi: { label: 'Wi-Fi', short: 'Wi-Fi', tech: '802.11', band: '2.4 / 5 GHz', mesh: false, channelled: true },
  };
  // router = REPEATER (mains powered, relays the mesh) · end = END DEVICE ONLY (battery / sleepy, never relays)
  const ROLES = { coordinator: 'Coordinator', router: 'Repeater', end: 'End device only', tx: 'One-way transmitter', rx: 'Receiver', bridge: 'Bridge', ap: 'Access point' };
  // Built-in guess, copied from Takeoffs (sonor-takeoffs-wireless.js BUILTIN). First match wins: m = device model id, b = block code, l = label text.
  const RADIO_BUILTIN = [
    { m: /^C4-(L-KCB|SKCB|KEYPAD-BUS|KCB)/, none: true },
    { m: /^C4-(CORE\d|CA\d+|EA\d)/, system: 'c4', role: 'coordinator' },
    { m: /^C4-(L-(KC|KDS|CDSW|FSW|MDIM|NNDSW|SW|TV|UDIM)|SKC|SAPD|SDAPD|SDSW|SSW|DIM|SW|KD|APD)/, system: 'c4', role: 'router' },
    { m: /^C4-SR\d+/, system: 'c4', role: 'end' },
    { l: /control4.*(zigbee|wireless)|\bsr-?260\b/, system: 'c4', role: 'end' },
    { m: /^HM-NEO-HUB/, system: 'neo', role: 'coordinator' },
    { m: /^HM-NEO-(STAT|PLUG|ULTRA)|^HM-BOOST/, system: 'neo', role: 'router' },
    { m: /^HM-NEO-AIR/, system: 'neo', role: 'end' },
    { m: /^HM-(RF-SWITCH|UH8-RF)/, system: 'neo', role: 'rx' },
    { b: /^CL-HM-06-NEO(HUB)/, system: 'neo', role: 'coordinator' },
    { b: /^CL-HM-06-NEO(STAT|PLUG)/, system: 'neo', role: 'router' },
    { b: /^CL-HM-06-NEOAIR/, system: 'neo', role: 'end' },
    { l: /\bboost\b.*heatmiser|heatmiser.*\bboost\b/, system: 'neo', role: 'router' },
    { l: /neohub/, system: 'neo', role: 'coordinator' },
    { l: /neoair/, system: 'neo', role: 'end' },
    { l: /neostat|neoplug|neoultra/, system: 'neo', role: 'router' },
    { m: /^BOND-/, system: 'bond', role: 'bridge' },
    { b: /BOND/, system: 'bond', role: 'bridge' },
    { l: /tahoma|connexoon/, system: 'rts', role: 'bridge' },
    { l: /\brts\b.*(transmitter|tx|remote)|somfy.*(telis|situo|smoove|transmitter)/, system: 'rts', role: 'tx' },
    { l: /\bio\b.*(transmitter|remote)|somfy.*\bio\b/, system: 'io', role: 'tx' },
    { m: /^RAKO-RAMPI/, none: true },
    { m: /^RAKO-WRB/, system: 'rako', role: 'router' },
    { m: /^RAKO-(RK-HUB|RX-LINK)/, system: 'rako', role: 'bridge' },
    { m: /^RAKO-(RCM|RNC|RK-MOD|RK-EOS|RK-PIR|RAVIR|RMR-VF|RAMVR)/, system: 'rako', role: 'tx' },
    { m: /^RAKO-(RMT|RML|RMS|RDA|RLED|RSR)/, system: 'rako', role: 'rx' },
    { m: /^LUT-PICO/, system: 'lutron_a', role: 'tx' },
    { l: /lutron.*(hybrid )?repeater/, system: 'lutron_a', role: 'router' },
    { l: /\b(ra2|ra3|radiora|caseta|caséta)\b.*(processor|main repeater|hub|bridge)/, system: 'lutron_a', role: 'coordinator' },
    { l: /lutron.*type x|athena.*wireless/, system: 'lutron_x', role: 'router' },
    { l: /hue bridge|philips hue.*bridge/, system: 'hue', role: 'coordinator' },
    { l: /\bhue\b.*(bulb|lamp|light|strip|plug)/, system: 'hue', role: 'router' },
    { l: /thread border router|matter.*(hub|controller)/, system: 'thread', role: 'coordinator' },
  ];
  const _num = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
  const _out = (r, source) => ({ system: r.system, role: r.role || 'end', roleLabel: ROLES[r.role || 'end'] || r.role, systemLabel: SYSTEMS[r.system].label, range_m: _num(r.range_m), source });
  // radioOf(placement, libRow, opts) → { system, role, roleLabel, systemLabel, range_m, source: placement|library|builtin } | null (not a radio)
  //   placement: a Takeoffs symbol (or { sonorSymbol }) with .radio, .block_code, .device_model_id, .label — or a scanned device { make, kind, model }
  //   libRow: the sonor_blocks row (metadata.radio, device_model_id, block_code, label) · opts.isWap → Wi-Fi access point
  function radioOf(placement, libRow, opts) {
    opts = opts || {}; const sym = (placement && placement.sonorSymbol) || placement || {};
    const o = sym.radio;
    if (o && (o.off || o.none)) return null;
    if (o && o.system && SYSTEMS[o.system]) return _out(o, 'placement');
    const meta = (libRow && (libRow.metadata || libRow.block_metadata)) || {};
    const lr = meta.radio;
    if (lr && (lr.none || lr.off)) return null;
    if (lr && lr.system && SYSTEMS[lr.system]) return _out(lr, 'library');
    if (opts.isWap) return _out({ system: 'wifi', role: 'ap' }, 'builtin');
    const model = String((libRow && libRow.device_model_id) || sym.device_model_id || '').toUpperCase();
    const bc = String(sym.block_code || (libRow && libRow.block_code) || '').toUpperCase();
    const label = [sym.label, libRow && libRow.label, meta.brand, meta.model_no, sym.make, sym.kind, sym.model].map((x) => String(x == null ? '' : x).toLowerCase()).join(' ');
    for (const r of RADIO_BUILTIN) if ((r.m && model && r.m.test(model)) || (r.b && r.b.test(bc)) || (r.l && r.l.test(label))) return r.none ? null : _out(r, 'builtin');
    return null;
  }
  const isRepeater = (r) => !!r && (r.role === 'router' || r.role === 'coordinator');
  const guideFor = (d) => RF_GUIDE.find((g) => g.test(d)) || null;
  // rf.probe.grades (heuristic: calibrate on the first unit): graded on the worse of level and margin
const RF_LEVELS = { solid: { dbm: -80, margin: 20 }, marginal: { dbm: -95, margin: 10 } };
const rfVerdict = (m, peak) => { if (m == null) return ['—', '']; const p = peak == null ? 0 : peak; if (p >= RF_LEVELS.solid.dbm && m >= RF_LEVELS.solid.margin) return ['Solid', 'ok']; if (p >= RF_LEVELS.marginal.dbm && m >= RF_LEVELS.marginal.margin) return ['Marginal', 'warn']; return ['Fail', 'bad']; };
  const RF_FREQS = [
    { mhz: 433.42, label: '433.42 MHz · Somfy RTS', match: /somfy/i },
    { mhz: 433.92, label: '433.92 MHz · most 433 remotes, Bond', match: /bond/i },
    { mhz: 315, label: '315 MHz · US fans / blinds', match: null },
    { mhz: 868.3, label: '868.3 MHz · Somfy io (868 module)', match: null },
  ];
  // The RF frequency to start on, from the hubs a scan found (null = leave the engineer's choice)
  const rfFreqFor = (devices) => { const t = (devices || []).map((d) => `${d.make} ${d.kind}`).join(' '); const f = RF_FREQS.find((x) => x.match && x.match.test(t)); return f ? f.mhz : null; };

  // ── Sonor probes on the site Wi-Fi (rf-probe/: ESP32 + CC1101, zb-probe/: ESP32-C6) ──
  const PROBES = {
    rf: { service: '_sonor-rf._tcp', kind: 'Sonor RF probe', hotspot: 'Sonor-RF-Probe' },
    zb: { service: '_sonor-zb._tcp', kind: 'Sonor Zigbee probe', hotspot: 'Sonor-ZB-Probe' },
  };
  // ONE node scheme for every Sonor site node (RF probe, Zigbee probe, IR/RF capture node, future ones):
  //   mDNS _sonor-node._tcp (plus the older per-kind type), TXT id (MAC, 12 hex), kind, caps (comma list), spot
  //   GET /info → { v, kind, board, caps[], id, name, spot, battery (mV, -1 = USB), ssid, wifiRssi, uptime }
  //   GET /identify → blink 5 s · GET /spot?name=<room or device> → remember where it is (from the Takeoffs room list)
  // The site agent (Pi in the rack or a laptop) finds nodes locally and the page talks to them through it; no cloud table.
  // v1.4.0 (2026-11-25, Bryn: "multi node with all capabilities to place in various areas and monitor the whole environment"):
  //   kind multi = one Sonor site node whose board decides its caps. Caps: wifi-scan (2.4 GHz) · wifi-scan-5 (ESP32-C5) ·
  //   zb-scan / zb-energy / zb-meter · rf433-rssi / rf868-rssi · rf433-rx / rf433-tx · ir-rx / ir-tx · sleep (wakes on a timer).
  //   GET /aps → { v, at, age_ms, band, aps:[{ ssid, bssid, ch, rssi, sec }], stats?:[{ ch, airtime_pct, noise }] } from the node's last
  //   background scan (never blocks). stats come from nodes that sniff (ESP32-C5): airtime = Σ frame airtimes / dwell (node.wifi.airtime,
  //   undercounts non-Wi-Fi energy), noise = the radio's noise_floor (node.wifi.measure). Rules: capture-spectrum-node-rules.json (node.*, sp.*).
  //   GET /spectrum?f0=<MHz>&f1=<MHz>&step=<kHz>&dwell=<µs> (cap rf-sweep, CC1101) → { v:1, at, src:'cc1101', f0:<Hz>, step:<Hz>, n, dbm:[…], floor, peak:{ f, dbm } }
  //   Firmware: one PlatformIO project, one env per board, radios behind build flags (HAS_IR_RX/TX, HAS_CC1101, HAS_ZB, HAS_WIFI_SCAN) —
  //   APP - IR RF Capture/firmware (shared with this repo's rf-probe / zb-probe until they fold in).
  //   (/wifi?ssid=&pass= stays the "join the site Wi-Fi" call on every node.)
  const NODE = { service: '_sonor-node._tcp', kinds: { rf: 'Sonor RF probe', zigbee: 'Sonor Zigbee probe', ircap: 'IR & RF capture node', multi: 'Sonor site node' },
    caps: { 'wifi-scan': 'Wi-Fi 2.4 GHz scan', 'wifi-scan-5': 'Wi-Fi 5 GHz scan', 'zb-scan': 'Zigbee mesh scan', 'zb-energy': 'Zigbee energy sweep', 'zb-meter': 'Zigbee meter', 'rf433-rssi': '433 MHz level', 'rf868-rssi': '868 MHz level', 'rf433-rx': '433 MHz capture', 'rf433-tx': '433 MHz send', 'ir-rx': 'IR capture', 'ir-tx': 'IR send', 'rf-sweep': 'sub-GHz spectrum sweep', 'rf868-rx': '868 MHz capture', sleep: 'battery sleep' },
    // per kind: what it can do and which app owns it (kinds stays plain names for labels)
    info: { ircap: { name: 'IR & RF capture node', caps: ['ir-rx', 'ir-tx', 'rf433-rx', 'rf433-tx'], hotspot: 'Sonor-Capture-XXXX', port: 80, app: 'ir-rf', appPort: 8052 } } };
  // HTTP path + timeout for one probe call; the Pi agent, the Android agent and any page use the same table.
  function probePath(kind, a) {
    a = a || {};
    // node identity, same on every probe (v1.2): info · identify (blink 5 s) · spot (save where it is)
    if (a.op === 'info') return { path: 'info', timeout: 1500 };
    if (a.op === 'identify') return { path: 'identify', timeout: 1500 };
    if (a.op === 'spot') return { path: 'spot?name=' + encodeURIComponent(String(a.spot || '').slice(0, 60)), timeout: 1500 };
    if (a.op === 'aps') return { path: 'aps', timeout: 4000 };   // v1.4.0 Wi-Fi scan from any node with caps wifi-scan
    if (kind === 'rf') return { path: a.mhz ? 'freq?mhz=' + encodeURIComponent(a.mhz) : 'rssi', timeout: 2000 };
    if (kind === 'zb') { const op = a.op || 'listen'; if (op === 'scan') return { path: 'scan', timeout: 9000 }; if (op === 'energy') return { path: 'energy', timeout: 9000 };
      return { path: 'listen?' + (a.ch ? 'ch=' + Number(a.ch) : '') + (a.reset ? '&reset=1' : ''), timeout: 2000 }; }
    throw new Error('unknown probe kind ' + kind);
  }
  const probeKindOf = (d) => (isProbe(d, 'zb') ? 'zb' : isProbe(d, 'rf') ? 'rf' : null);
  const isProbe = (d, kind) => new RegExp(PROBES[kind].kind.replace('Sonor ', ''), 'i').test((d && d.kind) || '');

  // Research rules (wifi-rf-rules.json): load once, then API.rules[id] = { text, sources, strength, rule? }
  async function loadRules(url) { try { const r = await fetch(url || 'data/wifi-rf-rules.json'); const j = await r.json(); const list = Array.isArray(j) ? j : j.rules || []; API.rules = Object.fromEntries(list.map((x) => [x.id, x])); } catch (e) { API.rules = API.rules || {}; } return API.rules; }

  const API = { VERSION: '1.5.0', ZB, ZB_C4, zbFreq, wifiFreq24, rfW, zigbeeLoad, ZB_SYS, ZB_LEVELS, zbVerdict, ZB_OUI, zbMaker,
    ZB_ENERGY, energyVerdict, LAN, autoMatch, RF_GUIDE, guideFor, RF_LEVELS, rfVerdict, RF_FREQS, rfFreqFor, PROBES, NODE, probePath, isProbe, probeKindOf, loadRules, rules: {},
    SYSTEMS, ROLES, RADIO_BUILTIN, radioOf, isRepeater,
    CH24, CH5, isDfs, wifiSpan: span, wifiChannelLoad, LOAD_LEVELS, loadVerdict, sitePick, GRADES, CONTENDER, adjW, smoothAps, betterBy, BATT, battPct, battHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SonorWireless = API;
})(typeof window !== 'undefined' ? window : globalThis);
