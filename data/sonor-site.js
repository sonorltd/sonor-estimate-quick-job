/* sonor-site.js — SHARED SITE SEAM (canonical master at workspace root, synced to every app's data/)
 * v1.3.0 (2026-11-10) — SNAGS = Tasks snags + the project's Portal snags (v_tasks_unified source portal-snag, samples hidden), each with
 *   source / priority / assignee / created_at and an `open` flag (one rule: SNAG_CLOSED); RFIs carry created_at + answer. v_site_project counts both.
 * v1.2.0 (2026-11-07) — Site is its own app (APP - Site, Bryn: "survey and site are diff apps … site is for engineers"): siteUrl → the Site
 *   app; devices carry loc (for SonorDeviceLinks), model and block_code — the engineers' level of detail.
 * v1.1.0 (2026-11-07) — WHO is the signed-in login: every RPC stamps by / created_by server side from the Cloudflare gateway's JWT
 *   (sonor_who()); `by` sent from a browser is only a fallback for server jobs. resolve() gains `extra` (merged into review); status 'applied'.
 * v1.0.0 (2026-11-07, Survey v0.12.0 Site mode) — Bryn: "we do need a site app to bridge it all, which incs snags and tasks etc
 * … make sure it always mirrors correct info for the project across apps, no monoliths".
 *
 * THE MIRROR RULE: Site owns ONE record (site_notes). Everything else it shows is READ LIVE from its owner and never copied:
 *   plan + revision ......... takeoffs_floors / takeoffs_floor_plans (Takeoffs)
 *   devices ................. punch_project_devices(project) — the same derivation punch_generate + the asset register use
 *   checks per device/stage . tasks_general (external_source 'punch') metadata.punch_list (Tasks)
 *   snags ................... tasks_general labelled 'snag' (Tasks)          RFIs ... projects.metadata.plan_notes (Takeoffs Plan Notes)
 *   counts .................. v_site_project (computed view — any app's card reads it)
 * Writes into another app's data happen ONLY through its single-writer RPC: punch_tick (one check, atomic),
 * site_note_resolve ('snag' → Tasks task · 'rfi' → plan_notes RFI · 'accept' / 'dismiss' / 'resolve' / 'reopen'),
 * site_note_upsert (the note itself, idempotent by id so an offline outbox can replay).
 * An app may cache a load() result for offline use (opts.cache) — the cache is a convenience, flagged `stale`, never a source.
 *
 *   SonorSite.load(supa, projectId, { cache?:{get(k),set(k,v)}, timeoutMs? }) →
 *     { project_id, at, stale, floors:[{id, floor_id, code, name, plan:{id, revision_label}|null}],
 *       stages:[{key,label,short}], devices:[{key, uid, name, floor, floor_id, room, room_name, nn, kind,
 *         checks:[{task_id, key, item, text, stage, done, at, by}], done, total, notes:[…]}],
 *       notes:[site_notes rows], snags:[{id,title,status,floor,service_nn,note_id}], rfis:[{id,rfi_id,text,status,floor}], summary:{v_site_project row} }
 *   SonorSite.byFloor(model)                          → [{ floor, devices:[…] }]  floors GF→1F→…→BA→EXT, devices in service order
 *   SonorSite.stageProgress(device, stageKey)         → { done, total }
 *   SonorSite.tick(supa, taskId, key, done, by)       → rpc punch_tick
 *   SonorSite.saveNote(supa, row)                     → rpc site_note_upsert (row.id made here if missing — keep it for replays)
 *   SonorSite.resolve(supa, noteId, action, by, note, extra) → rpc site_note_resolve  (actions: snag · rfi · accept · applied · dismiss · resolve · reopen)
 *   SonorSite.renderCard(host, { projectId, supa? | get?(restPath) })  → read-only Site card (checks bar · open notes · changes · snags · Open Site ↗)
 *   SonorSite.uuid()
 * Edit THIS master; `bash sync-everything.sh --only sonor-site.js`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.SonorSite = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.3.0';
  var SNAG_CLOSED = /^(done|cancelled|closed|resolved|verified)$/i, RFI_CLOSED = /^(closed|answered|resolved|done)$/i;
  var FLOOR_FALLBACK = ['GF', '1F', '2F', '3F', '4F', 'BA', 'EXT'];
  var KINDS = [['note', 'Note'], ['change', 'Change from plan'], ['photo', 'Photo'], ['question', 'Question (RFI)'], ['snag', 'Snag']];
  var CHANGES = [['moved', 'Moved'], ['added', 'Added'], ['omitted', 'Left out'], ['route', 'Cable route changed'], ['swapped', 'Different product'], ['other', 'Other']];

  function g() { return (typeof window !== 'undefined') ? window : {}; }
  function uuid() { var c = g().crypto || (typeof crypto !== 'undefined' ? crypto : null); if (c && c.randomUUID) return c.randomUUID(); return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) { var r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function timed(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || 9000); })]); }
  function floorRank(code) { var i = FLOOR_FALLBACK.indexOf(String(code || '').toUpperCase()); return i < 0 ? 99 : i; }
  function sortFloors(list) { var f = g().sonorSortFloors; if (typeof f === 'function') { try { return f(list); } catch (e) { } } return list.slice().sort(function (a, b) { return floorRank(a.code) - floorRank(b.code); }); }
  function svcRank(nn) { var f = g().sonorServiceRank; if (typeof f === 'function') { try { return f(String(nn).padStart(2, '0')); } catch (e) { } } return nn ? Number(nn) : 9999; }
  function chk(r, what) { if (r && r.error) throw new Error(what + ': ' + r.error.message); return r ? r.data : null; }

  async function fetchModel(supa, pid, ms) {
    var q = await Promise.all([
      timed(supa.from('takeoffs_floors').select('id,floor_id,code,name,seq').eq('project_id', pid).is('deleted_at', null).order('seq'), ms),
      timed(supa.from('takeoffs_floor_plans').select('id,floor_id,revision_label,created_at').eq('project_id', pid).eq('is_active', true), ms),
      timed(supa.rpc('punch_project_devices', { p_project: pid }), ms),
      timed(supa.from('tasks_general').select('id,title,status,priority,assignee,labels,service_nn,external_source,metadata,plan_pin,created_at,updated_at').eq('project_id', pid).or('external_source.eq.punch,labels.cs.{snag}'), ms),
      timed(supa.from('site_notes').select('*').eq('project_id', pid).order('created_at', { ascending: false }), ms),
      timed(supa.from('tasks_punch_stages').select('key,label,short,seq').order('seq'), ms),
      timed(supa.from('projects').select('metadata->plan_notes').eq('id', pid).maybeSingle(), ms),
      timed(supa.from('v_site_project').select('*').eq('project_id', pid).maybeSingle(), ms),
      timed(supa.from('v_tasks_unified').select('id,source_id,title,status,priority,assignee,service_nn,plan_pin,metadata,created_at,updated_at').eq('project_id', pid).eq('source_app', 'portal-snag'), ms).catch(function () { return { data: [] }; })
    ]);
    var floorsRaw = chk(q[0], 'floors') || [], plans = chk(q[1], 'plans') || [], devs = chk(q[2], 'devices') || [], tasks = chk(q[3], 'tasks') || [];
    var notes = chk(q[4], 'notes') || [], stages = chk(q[5], 'stages') || [], pnRow = chk(q[6], 'plan_notes'), summary = chk(q[7], 'summary') || null;
    var portal = ((q[8] && q[8].data) || []).filter(function (r) { return !(r.metadata && (r.metadata.is_sample === true || r.metadata.is_sample === 'true')); });

    var planBy = {}; plans.forEach(function (p) { planBy[p.floor_id] = { id: p.id, revision_label: p.revision_label }; });
    var floors = sortFloors(floorsRaw.map(function (f) { return { id: f.id, floor_id: f.floor_id, code: f.code, name: f.name, plan: planBy[f.floor_id] || planBy[f.id] || null }; }));
    var floorCodeById = {}; floors.forEach(function (f) { floorCodeById[f.floor_id] = f.code; floorCodeById[f.id] = f.code; });

    // checks: flatten every punch line, keyed by its device (dev key, uid when the line has one)
    var byDev = {}, uidByDev = {};
    tasks.forEach(function (t) {
      if (t.external_source !== 'punch') return;
      var md = t.metadata || {}, pu = md.punch || {}, stage = pu.stage || null;
      (Array.isArray(md.punch_list) ? md.punch_list : []).forEach(function (l) {
        if (!l || l.gone) return;
        var dk = l.dev || ('task:' + t.id);
        (byDev[dk] = byDev[dk] || []).push({ task_id: t.id, key: l.key, item: l.item, text: l.text, stage: stage, done: !!l.done, at: l.at || null, by: l.by || null });
        if (l.loc && l.loc.uid && !uidByDev[dk]) uidByDev[dk] = l.loc.uid;
      });
    });
    var notesByUid = {}, notesByKey = {};
    notes.forEach(function (n) { if (n.device_uid) (notesByUid[n.device_uid] = notesByUid[n.device_uid] || []).push(n); else if (n.device_key) (notesByKey[n.device_key] = notesByKey[n.device_key] || []).push(n); });

    var seen = {};
    var devices = devs.map(function (d) {
      var key = d.dev_key || d.dev_id, uid = (d.loc && d.loc.uid) || uidByDev[key] || null, checks = byDev[key] || []; seen[key] = 1;
      var fid = d.loc && d.loc.floor_id;
      return { key: key, uid: uid, name: d.name || key, floor: d.floor_code || floorCodeById[fid] || null, floor_id: fid || null, room: d.room_code || null,
        room_name: d.room_name || d.room_code || null, nn: d.service_nn || null, kind: d.kind_override || d.catalogue || d.takeoff_kind || d.eng_type || null, source: d.source,
        model: d.model_id || null, block_code: d.block_code || null, loc: Object.assign({}, d.loc || {}, uid ? { uid: uid } : {}),
        checks: checks, total: checks.length, done: checks.filter(function (c) { return c.done; }).length,
        notes: (uid && notesByUid[uid]) || notesByKey[key] || [] };
    });
    // checks whose device has no live row any more (removed from design, kept ticked) still show — never silently dropped
    Object.keys(byDev).forEach(function (k) { if (seen[k]) return; var c = byDev[k]; devices.push({ key: k, uid: uidByDev[k] || null, name: k, floor: null, floor_id: null, room: null, room_name: null, nn: null, kind: null, source: 'punch-only', checks: c, total: c.length, done: c.filter(function (x) { return x.done; }).length, notes: notesByKey[k] || [] }); });

    fillPlaces(devices);
    var snags = tasks.filter(function (t) { return (t.labels || []).indexOf('snag') >= 0; }).map(function (t) {
      return { id: t.id, source: 'tasks', title: String(t.title || '').replace(/^Snag · /, ''), status: t.status, open: !SNAG_CLOSED.test(t.status || ''), priority: t.priority || null, assignee: t.assignee || null,
        service_nn: t.service_nn, floor: (t.plan_pin && t.plan_pin.floor_code) || null, created_at: t.created_at, updated_at: t.updated_at, note_id: (t.metadata && t.metadata.site_note && t.metadata.site_note.id) || null };
    }).concat(portal.map(function (r) {
      return { id: r.source_id || r.id, source: 'portal', title: r.title, status: r.status, open: !SNAG_CLOSED.test(r.status || ''), priority: r.priority || null, assignee: r.assignee || null,
        service_nn: r.service_nn, floor: (r.plan_pin && r.plan_pin.floor_code) || null, created_at: r.created_at, updated_at: r.updated_at, note_id: null };
    })).sort(function (a, b) { return (b.open - a.open) || String(a.priority || 'p9').localeCompare(String(b.priority || 'p9')) || String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    var rfis = []; var pn = pnRow && (pnRow.plan_notes || pnRow);
    if (pn && pn.sections) Object.keys(pn.sections).forEach(function (s) { (Array.isArray(pn.sections[s]) ? pn.sections[s] : []).forEach(function (i) { if (i && i.is_rfi) rfis.push({ id: i.id, rfi_id: i.rfi_id, text: i.text, status: i.status || 'open', open: !RFI_CLOSED.test(i.status || 'open'), floor: i.floor || null, to: i.to || null, created_at: i.created_at || null, answer: i.answer || i.response || null }); }); });

    return { v: VERSION, project_id: pid, at: new Date().toISOString(), stale: false, floors: floors, stages: stages, devices: devices, notes: notes, snags: snags, rfis: rfis, summary: summary };
  }

  // v1.3.0 — a check whose device is no longer a live design row (punch-only) still says WHERE it is when its key carries the room code
  // (LS-1F-MBED-01, MBED-2, KIT-1 …): the code is matched against the rooms the live devices already name. Never guesses beyond that.
  function fillPlaces(devices) {
    var rooms = {}; devices.forEach(function (d) { if (d.room && d.floor && !rooms[d.room]) rooms[d.room] = { floor: d.floor, name: d.room_name || d.room }; });
    devices.forEach(function (d) {
      if (d.floor && d.room_name) return;
      var parts = String(d.key || '').toUpperCase().split(/[-_ ]/), fl = null, rm = null;
      parts.forEach(function (t) { if (!fl && FLOOR_FALLBACK.indexOf(t) >= 0) fl = t; if (!rm && rooms[t]) rm = t; });
      if (rm) { d.room = d.room || rm; d.room_name = d.room_name || rooms[rm].name; d.floor = d.floor || fl || rooms[rm].floor; } else if (fl && !d.floor) d.floor = fl;
    });
    return devices;
  }
  async function load(supa, pid, opts) {
    opts = opts || {}; var key = 'site:' + pid, cache = opts.cache;
    try {
      var m = await fetchModel(supa, pid, opts.timeoutMs);
      if (cache && cache.set) { try { await cache.set(key, m); } catch (e) { } }
      return m;
    } catch (e) {
      var c = cache && cache.get ? await cache.get(key) : null;
      if (c) { c.stale = true; c.error = String(e.message || e); return c; }
      throw e;
    }
  }

  function byFloor(model) {
    var groups = {}, order = [];
    (model.floors || []).forEach(function (f) { groups[f.code] = { floor: f, devices: [] }; order.push(f.code); });
    (model.devices || []).forEach(function (d) { var k = d.floor || '—'; if (!groups[k]) { groups[k] = { floor: { code: k, name: k === '—' ? 'Not on a floor' : k }, devices: [] }; order.push(k); } groups[k].devices.push(d); });
    return order.map(function (k) {
      var gr = groups[k]; gr.devices.sort(function (a, b) { return (svcRank(a.nn) - svcRank(b.nn)) || String(a.room_name || '').localeCompare(String(b.room_name || '')) || String(a.name).localeCompare(String(b.name)); });
      return gr;
    }).filter(function (gr) { return gr.devices.length; });
  }
  function stageProgress(d, stage) { var c = (d.checks || []).filter(function (x) { return !stage || x.stage === stage; }); return { done: c.filter(function (x) { return x.done; }).length, total: c.length }; }

  async function tick(supa, taskId, key, done, by) { var r = await supa.rpc('punch_tick', { p_task: taskId, p_key: key, p_done: !!done, p_by: by || null }); return chk(r, 'punch_tick'); }
  async function saveNote(supa, row) { if (!row.id) row.id = uuid(); var r = await supa.rpc('site_note_upsert', { p: row }); return chk(r, 'site_note_upsert'); }
  async function resolve(supa, id, action, by, note, extra) { var r = await supa.rpc('site_note_resolve', { p_id: id, p_action: action, p_by: by || null, p_note: note || null, p_extra: extra || {} }); return chk(r, 'site_note_resolve'); }

  // ---------- card (any app / page: PM Brief, Board, Hub) — counts from v_site_project + the latest open notes, live ----------
  function siteUrl(pid) { var B = g().__SONOR_BRAND__ || g().SonorBrand || {}, u = B.appUrls && B.appUrls.hosted && B.appUrls.hosted.site; return (u || 'https://apps.sonor.co.uk/sonor-site/') + '?pid=' + encodeURIComponent(pid); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function who(v) { try { return (g().SonorWho && g().SonorWho.label(v)) || String(v || '').split('@')[0]; } catch (e) { return String(v || '').split('@')[0]; } }
  var KIND_LABEL = {}; KINDS.forEach(function (k) { KIND_LABEL[k[0]] = k[1]; });
  function cardHtml(pid, sum, notes) {
    sum = sum || {}; var tot = Number(sum.checks_total) || 0, dn = Number(sum.checks_done) || 0, pc = tot ? Math.round(dn * 100 / tot) : 0;
    var stat = function (n, l) { return '<div style="flex:1 1 90px;min-width:90px"><div style="font-size:20px;font-weight:700">' + (Number(n) || 0) + '</div><div style="font-size:11px;opacity:.7">' + l + '</div></div>'; };
    var list = (notes || []).slice(0, 6).map(function (n) { return '<li style="margin:3px 0"><b style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">' + esc(KIND_LABEL[n.kind] || n.kind) + '</b> ' + esc(n.text || '') + ' <span style="opacity:.6;font-size:11px">· ' + esc([n.floor_code, n.room].filter(Boolean).join(' ')) + ' · ' + esc(who(n.created_by)) + ' · ' + esc(String(n.created_at || '').slice(0, 10)) + '</span></li>'; }).join('');
    return '<h2>Site <span class="k">live · checks from Tasks · notes from the Site app</span></h2>'
      + '<div style="margin:2px 0 10px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>Checks done</span><span>' + dn + ' / ' + tot + (tot ? ' · ' + pc + ' %' : '') + '</span></div>'
      + '<div style="height:6px;border-radius:3px;background:rgba(127,127,127,.25);overflow:hidden;margin-top:4px"><div style="height:100%;width:' + pc + '%;background:var(--green, #78ba57)"></div></div></div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">' + stat(sum.notes_open, 'open site notes') + stat(sum.changes_open, 'changes to review') + stat(sum.changes_accepted, 'accepted, to draw') + stat(sum.snags_open, 'open snags') + '</div>'
      + (list ? '<ul style="margin:10px 0 0;padding-left:16px;font-size:12.5px">' + list + '</ul>' : '<p class="note" style="margin-top:10px">No open site notes.</p>')
      + '<p style="margin:10px 0 0;font-size:12px"><a href="' + esc(siteUrl(pid)) + '" target="_blank" rel="noopener">Open Site ↗</a></p>';
  }
  //   SonorSite.renderCard(host, { projectId, supa? | get?(restPath) → Promise<json> })  — read-only, no writes
  async function renderCard(host, o) {
    if (!host || !o || !o.projectId) return; var pid = o.projectId, sum = null, notes = [];
    try {
      if (o.supa) {
        var a = await o.supa.from('v_site_project').select('*').eq('project_id', pid).maybeSingle(); sum = a.data;
        var b = await o.supa.from('site_notes').select('id,kind,text,floor_code,room,created_by,created_at,status').eq('project_id', pid).eq('status', 'open').order('created_at', { ascending: false }).limit(6); notes = b.data || [];
      } else if (o.get) {
        var r = await o.get('v_site_project?project_id=eq.' + pid + '&select=*'); sum = (r && r[0]) || null;
        notes = (await o.get('site_notes?project_id=eq.' + pid + '&status=eq.open&select=id,kind,text,floor_code,room,created_by,created_at,status&order=created_at.desc&limit=6')) || [];
      }
      host.innerHTML = cardHtml(pid, sum, notes);
    } catch (e) { host.innerHTML = '<h2>Site</h2><p class="note">Could not load: ' + esc(e && e.message) + '</p>'; }
  }

  return { VERSION: VERSION, KINDS: KINDS, CHANGES: CHANGES, load: load, fillPlaces: fillPlaces, renderCard: renderCard, cardHtml: cardHtml, siteUrl: siteUrl, byFloor: byFloor, stageProgress: stageProgress, tick: tick, saveNote: saveNote, resolve: resolve, uuid: uuid };
}));
