/**
 * sonor-rack-calc.js — the rack ENGINEERING NUMBERS, pure and shared (sonor-kit, B-484 tranche 2b, 2026-09-29).
 * Bryn: "rack build front side and rear views based on real data from Library for dims and BTU etc plus UPS calc and
 * power calc and all of that". Every figure comes from Library device_catalogue rows (u_size, watts, btu_hr, weight_kg,
 * depth_mm, metadata.outlet_count / max_amps / va_rating / runtime_min / poe_budget_w / poe_powered / rack_mount) — the
 * app maps its rows to the SPEC shape below and this module does the maths once for Engineering, Project Master, PDFs.
 *
 * SPEC (per racked item)  { id, label, u, watts, btu, kg, depth, outlets, maxAmps, isPdu, isUps, ups:{va, w, runtimeFullMin,
 *                          batteryWh}, poeBudgetW, poeDraw, hasPower, side:'front'|'rear', accessory, mount }
 * OFF-RACK PoE loads      opts.poeLoads = [{ label, watts }]   (WAPs, cameras, touch panels fed by the rack switches)
 * RACK                    opts.rack = { heightU, depthMm, maxLoadKg, wallMount, ownKg, ambientC }
 * OPTIONS                 volts (230), pf (0.9), diversity (1.0), breakerSeries [6,10,13,16,20,32], warmU per amp (1)
 *
 * compute(items, opts) → { space, power, poe, heat, weight, depth, outlets, ups, data, warnings:[{level, code, text}] }
 * All estimates say so: UPS runtime uses the Library runtime_min / battery Wh when present, otherwise a line-interactive
 * curve (full-load minutes scaled by (capacity/load)^1.25) — labelled "estimate" in .ups.basis.
 */
(function (global) {
  'use strict';
  const VERSION = '0.1.0';
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const round = (v, d) => { const m = Math.pow(10, d == null ? 1 : d); return Math.round(v * m) / m; };
  const BREAKERS = [6, 10, 13, 16, 20, 32];
  const BTU_PER_W = 3.412;

  function breakerFor(amps, series) { const s = series || BREAKERS; const need = amps * 1.25; return s.find((b) => b >= need) || s[s.length - 1]; }

  // UPS runtime model: exact when Library gives runtime at full load or battery Wh; otherwise a typical line-interactive curve
  function upsRuntimeMin(ups, loadW) {
    if (!ups || loadW <= 0) return null;
    const capW = num(ups.w) || num(ups.va) * 0.9;
    if (!capW) return null;
    const ratio = capW / loadW;
    if (ratio < 1) return 0;
    if (num(ups.batteryWh) > 0) return round((num(ups.batteryWh) * 0.85 / loadW) * 60, 0);          // usable ≈ 85 % of nameplate Wh
    const full = num(ups.runtimeFullMin) || (capW >= 2500 ? 5 : capW >= 1200 ? 6 : 7);                   // typical full-load minutes
    return round(Math.min(full * Math.pow(ratio, 1.25), full * ratio * 1.1), 0);                            // light loads: bounded by the battery's energy, not the curve
  }

  function compute(items, opts) {
    opts = opts || {}; const volts = opts.volts || 230, pf = opts.pf || 0.9, div = opts.diversity || 1;
    const rack = opts.rack || {}; const warnings = [];
    const racked = (items || []).filter((i) => i && !i.unplaced);
    const front = racked.filter((i) => i.side !== 'rear'), rear = racked.filter((i) => i.side === 'rear');
    const usedU = (side) => side.filter((i) => !i.vertical).reduce((s, i) => s + num(i.u), 0);
    const space = { heightU: num(rack.heightU), frontU: usedU(front), rearU: usedU(rear), usedU: Math.max(usedU(front), usedU(rear)), freeU: Math.max(0, num(rack.heightU) - Math.max(usedU(front), usedU(rear))) };

    // power — consumers only (PDU / UPS own draw counts; their outlets don't). Unknown watts are counted and flagged.
    const consumers = racked.filter((i) => i.hasPower !== false && !i.accessory);
    const noWatts = consumers.filter((i) => !(num(i.watts) > 0));
    const loadW = consumers.reduce((s, i) => s + num(i.watts), 0);
    const poeLoads = (opts.poeLoads || []).map((p) => ({ label: p.label, watts: num(p.watts) }));
    const poeDrawW = poeLoads.reduce((s, p) => s + p.watts, 0) + racked.reduce((s, i) => s + num(i.poeDraw), 0);
    const poeBudgetW = racked.reduce((s, i) => s + num(i.poeBudgetW), 0);
    const totalW = (loadW + poeDrawW) * div;
    const amps = totalW / volts / pf;
    const power = { loadW: round(loadW, 0), poeW: round(poeDrawW, 0), totalW: round(totalW, 0), amps: round(amps, 1), va: round(totalW / pf, 0), breakerA: breakerFor(amps), volts, pf, diversity: div, unknown: noWatts.map((i) => i.label) };
    if (noWatts.length) warnings.push({ level: 'info', code: 'watts-missing', text: `${noWatts.length} device${noWatts.length === 1 ? '' : 's'} with no wattage in the Library — total is low` });

    // PoE
    const poe = { drawW: round(poeDrawW, 0), budgetW: round(poeBudgetW, 0), loads: poeLoads.length, headroomW: round(poeBudgetW - poeDrawW, 0) };
    if (poeBudgetW > 0 && poeDrawW > poeBudgetW) warnings.push({ level: 'error', code: 'poe-over', text: `PoE draw ${round(poeDrawW, 0)} W exceeds the switch budget ${round(poeBudgetW, 0)} W` });
    else if (poeBudgetW > 0 && poeDrawW > poeBudgetW * 0.8) warnings.push({ level: 'warn', code: 'poe-tight', text: `PoE at ${Math.round(poeDrawW / poeBudgetW * 100)} % of budget — leave headroom for adds` });
    if (poeDrawW > 0 && !poeBudgetW) warnings.push({ level: 'info', code: 'poe-budget-missing', text: 'PoE devices present but no switch PoE budget in the Library (metadata.poe_budget_w)' });

    // heat — Library BTU when present, else W × 3.412 (electrical → heat, worst case)
    const btu = racked.reduce((s, i) => s + (num(i.btu) > 0 ? num(i.btu) : num(i.watts) * BTU_PER_W), 0);
    const heat = { btuHr: round(btu, 0), watts: round(btu / BTU_PER_W, 0), fromLibrary: racked.filter((i) => num(i.btu) > 0).length, ventilation: btu > 3400 ? 'active cooling (fan tray + vented door) — >1 kW of heat' : btu > 1700 ? 'fan tray recommended in a closed cabinet' : 'passive venting is fine' };
    if (btu > 3400) warnings.push({ level: 'warn', code: 'heat-high', text: `${round(btu, 0)} BTU/h — plan active cooling` });

    // weight — devices + rack own weight vs the rack's rating (wall racks: 50 kg unless the Library says otherwise)
    const kg = racked.reduce((s, i) => s + num(i.kg), 0);
    const noKg = racked.filter((i) => !(num(i.kg) > 0) && !i.accessory).length;
    const limit = num(rack.maxLoadKg) || (rack.wallMount ? 50 : 0);
    const weight = { devicesKg: round(kg, 1), rackKg: round(num(rack.ownKg), 1), totalKg: round(kg + num(rack.ownKg), 1), limitKg: limit || null, unknown: noKg };
    if (limit && kg > limit) warnings.push({ level: 'error', code: 'weight-over', text: `${round(kg, 0)} kg of equipment exceeds the ${limit} kg rating${rack.wallMount ? ' (wall rack)' : ''}` });
    else if (limit && kg > limit * 0.85) warnings.push({ level: 'warn', code: 'weight-tight', text: `Equipment at ${Math.round(kg / limit * 100)} % of the rack's ${limit} kg rating` });
    // heavy kit low: any item over 15 kg above the lower third
    racked.filter((i) => num(i.kg) >= 15 && num(rack.heightU) > 0 && num(i.start) > num(rack.heightU) / 3).forEach((i) => warnings.push({ level: 'warn', code: 'heavy-high', text: `${i.label} (${round(num(i.kg), 0)} kg) sits high — heavy kit belongs in the bottom third` }));

    // depth — deepest device vs usable rack depth (rack depth − 60 mm for rear cable clearance)
    const deepest = racked.reduce((m, i) => num(i.depth) > num(m.depth) ? i : m, { depth: 0 });
    const usable = num(rack.depthMm) ? num(rack.depthMm) - 60 : 0;
    const tooDeep = usable ? racked.filter((i) => num(i.depth) > usable) : [];
    const depth = { deepestMm: round(num(deepest.depth), 0), deepest: deepest.label || null, rackMm: num(rack.depthMm) || null, usableMm: usable || null, tooDeep: tooDeep.map((i) => i.label), unknown: racked.filter((i) => !(num(i.depth) > 0) && !i.accessory).length };
    tooDeep.forEach((i) => warnings.push({ level: 'error', code: 'too-deep', text: `${i.label} is ${round(num(i.depth), 0)} mm deep — rack allows ${usable} mm with cable clearance` }));

    // outlets — every powered device wants a socket; PDUs / UPS supply them
    const supplied = racked.filter((i) => i.isPdu || i.isUps).reduce((s, i) => s + num(i.outlets), 0);
    const wanted = consumers.filter((i) => !i.isPdu).length;
    const pduAmps = racked.filter((i) => i.isPdu).reduce((s, i) => s + num(i.maxAmps), 0);
    const outlets = { wanted, supplied, spare: supplied - wanted, pduMaxAmps: pduAmps || null };
    if (wanted > supplied) warnings.push({ level: supplied ? 'warn' : 'info', code: 'outlets-short', text: supplied ? `${wanted} devices need power, ${supplied} outlets on the PDU(s) — ${wanted - supplied} short` : `${wanted} devices need power — no PDU in the rack` });
    if (pduAmps && amps > pduAmps) warnings.push({ level: 'error', code: 'pdu-over', text: `Load ${round(amps, 1)} A exceeds the PDU rating ${pduAmps} A` });

    // UPS — the UPS carries the protected load (everything unless items say ups:false); runtime estimate
    const upsUnits = racked.filter((i) => i.isUps && i.ups);
    const protectedW = consumers.filter((i) => i.onUps !== false && !i.isUps).reduce((s, i) => s + num(i.watts), 0) + poeDrawW;
    const cap = upsUnits.reduce((s, i) => s + (num(i.ups.w) || num(i.ups.va) * 0.9), 0);
    const capVa = upsUnits.reduce((s, i) => s + (num(i.ups.va) || num(i.ups.w) / 0.9), 0);
    const runtime = upsUnits.length ? upsRuntimeMin({ w: cap, va: capVa, runtimeFullMin: upsUnits[0].ups.runtimeFullMin, batteryWh: upsUnits.reduce((s, i) => s + num(i.ups.batteryWh), 0) || null }, protectedW) : null;
    const exact = upsUnits.some((i) => num(i.ups.batteryWh) > 0 || num(i.ups.runtimeFullMin) > 0);
    const ups = { units: upsUnits.map((i) => i.label), capacityW: round(cap, 0), capacityVa: round(capVa, 0), protectedW: round(protectedW, 0), loadPct: cap ? Math.round(protectedW / cap * 100) : null, runtimeMin: runtime, basis: upsUnits.length ? (exact ? 'Library battery data' : 'estimate — typical line-interactive curve; set runtime_min or battery_wh on the UPS in the Library for exact') : 'no UPS in the rack', recommendVa: round(Math.ceil((protectedW / 0.9) * 1.25 / 100) * 100, 0) };
    if (upsUnits.length && cap && protectedW > cap) warnings.push({ level: 'error', code: 'ups-over', text: `Protected load ${round(protectedW, 0)} W exceeds the UPS capacity ${round(cap, 0)} W` });
    else if (upsUnits.length && cap && protectedW > cap * 0.8) warnings.push({ level: 'warn', code: 'ups-tight', text: `UPS at ${Math.round(protectedW / cap * 100)} % — runtime will be short` });
    if (!upsUnits.length && protectedW > 0) warnings.push({ level: 'info', code: 'ups-none', text: `No UPS — ${ups.recommendVa} VA would carry ${round(protectedW, 0)} W with 25 % headroom` });

    const data = { items: racked.length, complete: racked.filter((i) => num(i.watts) > 0 && num(i.kg) > 0 && num(i.u) > 0).length, missing: { watts: noWatts.length, kg: noKg, depth: depth.unknown } };
    return { version: VERSION, space, power, poe, heat, weight, depth, outlets, ups, data, warnings };
  }

  // Library device_catalogue row (or Engineering palette template) → SPEC. Handles both shapes.
  function specFromLibrary(row, extra) {
    const m = (row && (row.metadata || row.libMetadata || row.raw?.metadata)) || {};
    const cat = String(row.category || row.subName || '').toLowerCase();
    const label = row.label || row.model || row.model_id || '';
    const isUps = m.ups === true || cat === 'ups' || /\bups\b/i.test(label);
    const isPdu = !isUps && (cat === 'pdu' || /pdu|wattbox|power (strip|distribution)/i.test(label) || num(m.outlet_count) > 0);
    return Object.assign({
      id: row.id || row.model_id, label, u: num(row.u_size ?? row.heightU), watts: isUps ? Math.round((num(m.capacity_w) || num(row.watts ?? row.powerW)) * 0.03) : num(row.watts ?? row.powerW), btu: isUps ? 0 : num(row.btu_hr ?? row.btuHr),   // UPS: Library watts = OUTPUT capacity; its own draw ≈ 3 % losses kg: num(row.weight_kg ?? row.weightKg),
      depth: num(row.depth_mm ?? row.depthMm) || num(m.physical_dims && m.physical_dims.depth_mm), outlets: num(m.outlet_count ?? m.outlets ?? row.outletCount), maxAmps: num(m.max_amps ?? m.max_load_a),
      isPdu, isUps, ups: isUps ? { va: num(m.va_rating ?? m.capacity_va), w: num(m.capacity_w) || num(row.watts ?? row.powerW), runtimeFullMin: num(m.runtime_min), batteryWh: num(m.battery_wh) } : null,
      poeBudgetW: num(m.poe_budget_w ?? (m.schematic && m.schematic.poeBudgetW) ?? row.poeBudgetW), poePowered: m.poe_powered === true || (m.schematic && m.schematic.poePowered === true) || row.poePowered === true,
      hasPower: (m.schematic && m.schematic.hasPower === false) ? false : true, mount: m.rack_mount || row.rackMount || null,
    }, extra || {});
  }

  global.SonorRackCalc = { VERSION, compute, specFromLibrary, breakerFor, upsRuntimeMin, BREAKERS };
})(typeof window !== 'undefined' ? window : globalThis);
