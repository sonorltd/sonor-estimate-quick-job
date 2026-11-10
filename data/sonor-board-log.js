/**
 * sonor-board-log.js — CANONICAL MASTER (sonor-platform §22 — the client-interaction contract)
 * v1.3.0 · 2026-10-17 — ONE contact model across the apps (Bryn: "everything should be 2 way, ssot somewhere, no islands … in
 *   harmony with wq and the crm there"): way out_third (↗ we contacted a third party — booking emails, chasers), entries may
 *   carry contact_id (public.contacts — providers / subcontractors / trade) or wq_contact_id (WeQuote customer contact — clients);
 *   logThird(client, projectId, opts) = logContact with party 'third'. The PEOPLE live in one place each (clients → WeQuote
 *   customer + contacts; everyone else → public.contacts); this log is where every CONVERSATION lands.
 * v1.2.0 · 2026-10-17 — contacts carry a DIRECTION + PARTY (Bryn: "a boards category for incoming from 3rd parties as well as
 *   client contact outgoing"): contacts[] entries gain dir ('out' we contacted · 'in' they contacted us), party ('client' |
 *   'third' — a provider / subcontractor / supplier) and who (free text, e.g. "Beth · Moore Secure Ltd"). Only CLIENT contacts
 *   move contact_on / contact_kind / contact_note (the "last client interaction" every reader uses); a third-party contact lands
 *   in history and in third_on / third_who / third_note instead. History keeps the last 20. CONTACT_WAYS + wayOf(entry) + thirdOf(p).
 * v1.1.1 · 2026-10-02 — actions carry a `kind` (call · email · quote · chase · visit · service · install · order · invoice · other)
 * v1.1.0 · 2026-10-02 — NEXT ACTIONS are a list: board.actions = [{ id, text, by, set_at, done_on, done_via, done_note }] (last 30);
 *   board.next / board.by always MIRROR the first open action so every reader of `next` keeps working. addAction · doneAction ·
 *   openActions · logContact({ done_action: id }) ticks the action off as part of logging the contact.
 * v1.0.2 · 2026-10-02 — lastSent counts accepted / complete / expired quotes and v2+ reworks (quote_date = issue date)
 * v1.0.1 · 2026-10-01 — touchedAt ignores WeQuote sync writes (metadata.wequote_synced_at + wequote_touched_before)
 * v1.0.0 · 2026-09-30
 *
 * ONE place every Sonor app reads and writes "where is this project with the client":
 *   projects.metadata.board = {
 *     star, priority (1|2|3), rank,                  — Board ordering (v1.3)
 *     next, by, set_at,                              — the CURRENT next action + chase date (mirror of actions[0] open — v1.1)
 *     actions: [{ id, text, kind, by, set_at, done_on, done_via, done_note }],  — the list (open first), last 30 kept
 *     enquiry_on,                                    — enquiry date override (v1.6)
 *     contact_on, contact_kind, contact_note,        — LAST client interaction (v1.6)
 *     contacts: [{ on, kind, note, source, dir, party, who, contact_id, wq_contact_id }], — history, last 20 (v1.2 dir/party/who · v1.3 ids)
 *     third_on, third_who, third_note,              — LAST third-party contact (v1.2) — never counts as client contact
 *     saved_at, touched_before                       — so Board writes don't count as a human "touch"
 *   (projects.metadata.wequote_synced_at + wequote_touched_before do the same for WeQuote sync writes — v1.0.1)
 *   }
 * Written ONLY through sonor_merge_project_metadata (merge-only law) via SonorBoardLog.* — never a
 * metadata rewrite, never a per-app copy of these rules. Sources that know a client was contacted
 * (Leads enquiry follow-ups, Follow-Up Portal emails / cold calls, Tasks site logs, WeQuote sends,
 * the Board itself) all call logContact(); the Board only ever DISPLAYS.
 *
 * Classic script (no export). Needs a supabase-js client (SonorDB().client or window.supabase.createClient).
 * Load AFTER sonor-db.js. Synced to every app's data/ by sync-everything.sh — edit the root master only.
 *
 * API
 *   SonorBoardLog.CONTACT_KINDS                        { call:'📞', email:'✉️', whatsapp:'💬', site:'🏠', meeting:'🤝' }
 *   SonorBoardLog.boardOf(project)                     → board object or {}
 *   SonorBoardLog.contactOf(project, quotes?)          → { on:'YYYY-MM-DD', kind, note, src:'logged'|'quote' } | null
 *   SonorBoardLog.enquiryOf(project, enquiries?)       → { on, src }
 *   SonorBoardLog.touchedAt(project)                   → ISO of the last HUMAN touch (ignores Board writes)
 *   await SonorBoardLog.save(client, projectId, patch, project?)          — generic board patch (keeps the rest)
 *   await SonorBoardLog.logContact(client, projectId, { kind, on?, note?, source, dir?, party?, who? }, project?)
 *   SonorBoardLog.CONTACT_WAYS                         { out_client, in_client, in_third } → { dir, party, icon, label }
 *   SonorBoardLog.wayOf(entry)                         → one of CONTACT_WAYS (old entries = out_client)
 *   SonorBoardLog.thirdOf(project)                     → { on, who, note } | null
 *   await SonorBoardLog.setEnquiryDate(client, projectId, iso|null, project?)
 *   await SonorBoardLog.findProjectId(client, { id?, ref?, wqNo?, email?, phone? })   → uuid | null
 */
(function (global) {
  'use strict';
  var VERSION = '1.3.0';
  var CONTACT_KINDS = { call: '📞', email: '✉️', whatsapp: '💬', site: '🏠', meeting: '🤝' };
  // v1.2.0 — who started the conversation and who it was with
  var CONTACT_WAYS = {
    out_client: { dir: 'out', party: 'client', icon: '↗', label: 'We contacted the client' },
    in_client:  { dir: 'in',  party: 'client', icon: '↘', label: 'Client got in touch' },
    in_third:   { dir: 'in',  party: 'third',  icon: '⇲', label: 'Third party got in touch' },
    out_third:  { dir: 'out', party: 'third',  icon: '⇱', label: 'We contacted a third party' }   // v1.3.0
  };
  function wayOf(h) { h = h || {}; var party = h.party === 'third' ? 'third' : 'client'; if (party === 'third') return h.dir === 'out' ? CONTACT_WAYS.out_third : CONTACT_WAYS.in_third; return h.dir === 'in' ? CONTACT_WAYS.in_client : CONTACT_WAYS.out_client; }
  var DONE = ['accepted', 'won', 'approved', 'complete', 'declined', 'lost', 'expired', 'cancelled'];   // WeQuote stage vocabulary + older mirror names

  function isoDay(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  function boardOf(p) { return (p && p.metadata && p.metadata.board && typeof p.metadata.board === 'object') ? p.metadata.board : {}; }

  // v1.0.2 — "sent" = the quote has been in front of the client: stage sent / accepted / complete / won / approved / expired /
  // declined / lost (WeQuote's quote_date is the issue date — there is no separate sent stamp in the API), OR an in-progress
  // quote at revision 2+ (v1 was issued on quote_date; v2 is the rework after the client saw it).
  var SEEN = ['sent', 'accepted', 'won', 'approved', 'complete', 'expired', 'declined', 'lost'];
  function lastSent(quotes) {
    var best = null;
    (quotes || []).forEach(function (q) {
      var st = String(q.stage || '').toLowerCase(); var rev = Number(q.revision) || 1;
      var seen = SEEN.indexOf(st) >= 0 || (rev > 1 && q.quote_date);
      if (!seen) return;
      var d = isoDay(q.quote_date || q.sent_at || q.since);
      if (d && (!best || d > best.on)) best = { on: d, no: q.quote_no, stage: st, rev: rev, prior: SEEN.indexOf(st) < 0 };
    });
    return best;
  }
  function contactOf(p, quotes) {
    var b = boardOf(p);
    var c = b.contact_on ? { on: isoDay(b.contact_on), kind: b.contact_kind || 'call', note: b.contact_note || '', src: 'logged' } : null;
    var sn = lastSent(quotes);
    var q = sn ? { on: sn.on, kind: 'quote', note: '#' + sn.no + (sn.prior ? ' v' + (sn.rev - 1) + ' sent' : ' sent'), src: 'quote' } : null;
    if (c && q) return c.on >= q.on ? c : q;
    return c || q;
  }
  function enquiryOf(p, enquiries) {
    var b = boardOf(p), m = (p && p.metadata) || {};
    if (b.enquiry_on) return { on: isoDay(b.enquiry_on), src: 'set on the Board' };
    if (m.enquiry_date) return { on: isoDay(m.enquiry_date), src: 'project enquiry_date' };
    var e = (enquiries || []).find(function (e) { var em = e.metadata || {}; return em.project_id === p.id || em.projectId === p.id || (p.ref && (em.project_ref === p.ref || em.projectRef === p.ref)); });
    if (e && e.enquiry_date) return { on: isoDay(e.enquiry_date), src: 'enquiries log' + (e.channel ? ' · ' + e.channel : '') };
    if (m.first_seen) return { on: isoDay(m.first_seen), src: 'first seen' };
    return { on: isoDay(p.created_at), src: 'project created' };
  }
  function touchedAt(p) {
    var b = boardOf(p), m = (p && p.metadata) || {};
    if (b.saved_at && b.touched_before && Math.abs(new Date(p.updated_at) - new Date(b.saved_at)) < 15000) return b.touched_before;
    // v1.0.1 — a WeQuote sync (sonor-wq-sync.js v1.1.0) is not a human touch either: it stamps wequote_touched_before
    if (m.wequote_synced_at && m.wequote_touched_before && Math.abs(new Date(p.updated_at) - new Date(m.wequote_synced_at)) < 120000) return m.wequote_touched_before;
    return p.updated_at;
  }

  async function fetchProject(client, id) {
    var r = await client.from('projects').select('id,ref,metadata,updated_at').eq('id', id).maybeSingle();
    if (r.error) throw r.error; return r.data;
  }
  // generic patch: keeps everything else in board, drops null/false keys, stamps saved_at/touched_before
  async function save(client, projectId, patch, project) {
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId);
    if (!p) throw new Error('project not found: ' + projectId);
    var cur = boardOf(p); var nowIso = new Date().toISOString();
    var keepBefore = cur.saved_at && cur.touched_before && Math.abs(new Date(p.updated_at) - new Date(cur.saved_at)) < 15000;
    var next = Object.assign({}, cur, patch, { saved_at: nowIso, touched_before: keepBefore ? cur.touched_before : (p.updated_at || nowIso) });
    Object.keys(next).forEach(function (k) { if (next[k] == null || next[k] === false) delete next[k]; });
    var r = await client.rpc('sonor_merge_project_metadata', { p_project_id: projectId, p_patch: { board: next } });
    if (r.error) throw r.error;
    if (project && project.id === projectId) { project.metadata = Object.assign({}, project.metadata || {}, { board: next }); project.updated_at = nowIso; }
    return next;
  }
  // the one call every app makes when a client was spoken to / written to / visited
  async function logContact(client, projectId, opts, project) {
    opts = opts || {};
    var kind = CONTACT_KINDS[opts.kind] ? opts.kind : 'call';
    var on = isoDay(opts.on) || new Date().toISOString().slice(0, 10);
    var note = opts.note ? String(opts.note).slice(0, 160) : null;
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId);
    if (!p) throw new Error('project not found: ' + projectId);
    var cur = boardOf(p); var hist = Array.isArray(cur.contacts) ? cur.contacts : [];
    var party = opts.party === 'third' ? 'third' : 'client';
    var dir = (opts.dir === 'in' || opts.dir === 'out') ? opts.dir : (party === 'third' ? 'in' : 'out');   // v1.3.0 — an explicit dir always wins
    var who = opts.who ? String(opts.who).slice(0, 80) : null;
    var entry = { on: on, kind: kind, note: note, source: opts.source || null, dir: dir, party: party, who: who, contact_id: opts.contact_id || null, wq_contact_id: opts.wq_contact_id || null };
    Object.keys(entry).forEach(function (k) { if (entry[k] == null) delete entry[k]; });
    // de-dupe: same day + kind + source → don't stack (Follow-Up Portal can fire twice)
    if (hist.some(function (h) { return h.on === on && h.kind === kind && (h.source || null) === (opts.source || null) && (h.note || null) === note && (h.party || 'client') === party; })) return cur;
    var contacts = hist.concat([entry]).slice(-20);
    var patch = { contacts: contacts };
    if (opts.done_action) {   // v1.1.0 — the contact WAS the next action: tick it off in the same write
      var list = actionsOf(p).map(function (x) { return x.id === opts.done_action ? Object.assign({}, x, { id: x.id === 'legacy' ? newId() : x.id, done_on: on, done_via: 'contact:' + kind, done_note: note }) : (x.id === 'legacy' ? Object.assign({}, x, { id: newId() }) : x); });
      Object.assign(patch, mirror(list));
    }
    if (party === 'third') { if (!cur.third_on || on >= isoDay(cur.third_on)) { patch.third_on = on; patch.third_who = who; patch.third_note = note; } }
    else if (!cur.contact_on || on >= isoDay(cur.contact_on)) { patch.contact_on = on; patch.contact_kind = kind; patch.contact_note = note; }
    return save(client, projectId, patch, p);
  }
  // ── v1.1.0 next actions ──
  function logThird(client, projectId, opts, project) { return logContact(client, projectId, Object.assign({}, opts || {}, { party: 'third' }), project); }   // v1.3.0
  function thirdOf(p) { var b = boardOf(p); return b.third_on ? { on: isoDay(b.third_on), who: b.third_who || '', note: b.third_note || '' } : null; }
  function actionsOf(p) { var b = boardOf(p); var a = Array.isArray(b.actions) ? b.actions : []; if (!a.length && b.next) a = [{ id: 'legacy', text: b.next, by: b.by || null, set_at: b.set_at || null }]; return a; }
  function openActions(p) { return actionsOf(p).filter(function (a) { return !a.done_on; }).sort(function (x, y) { return String(x.by || '9999') < String(y.by || '9999') ? -1 : 1; }); }
  function mirror(actions) { var open = actions.filter(function (a) { return !a.done_on; }).sort(function (x, y) { return String(x.by || '9999') < String(y.by || '9999') ? -1 : 1; }); var f = open[0]; return { actions: actions.slice(-30), next: f ? f.text : null, by: f ? (f.by || null) : null, set_at: f ? (f.set_at || null) : null }; }
  function newId() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  async function addAction(client, projectId, a, project) {
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId); if (!p) throw new Error('project not found: ' + projectId);
    var list = actionsOf(p).map(function (x) { return x.id === 'legacy' ? Object.assign({}, x, { id: newId() }) : x; });
    list.push({ id: newId(), text: String(a.text || '').slice(0, 160), by: a.by ? isoDay(a.by) : null, kind: a.kind || null, set_at: new Date().toISOString(), source: a.source || null });
    return save(client, projectId, mirror(list), p);
  }
  async function editAction(client, projectId, actionId, patch, project) {
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId); if (!p) throw new Error('project not found: ' + projectId);
    var list = actionsOf(p).map(function (x) { return x.id === 'legacy' ? Object.assign({}, x, { id: actionId === 'legacy' ? 'legacy' : newId() }) : x; });
    list = list.map(function (x) { return x.id === actionId ? Object.assign({}, x, { text: patch.text != null ? String(patch.text).slice(0, 160) : x.text, by: patch.by !== undefined ? (patch.by ? isoDay(patch.by) : null) : x.by, kind: patch.kind !== undefined ? (patch.kind || null) : (x.kind || null) }, x.id === 'legacy' ? { id: newId() } : {}) : x; });
    return save(client, projectId, mirror(list), p);
  }
  async function doneAction(client, projectId, actionId, opts, project) {
    opts = opts || {};
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId); if (!p) throw new Error('project not found: ' + projectId);
    var list = actionsOf(p).map(function (x) { return x.id === actionId ? Object.assign({}, x, { id: x.id === 'legacy' ? newId() : x.id, done_on: isoDay(opts.on) || new Date().toISOString().slice(0, 10), done_via: opts.via || 'board', done_note: opts.note ? String(opts.note).slice(0, 120) : null }) : (x.id === 'legacy' ? Object.assign({}, x, { id: newId() }) : x); });
    return save(client, projectId, mirror(list), p);
  }
  async function removeAction(client, projectId, actionId, project) {
    var p = project && project.id === projectId ? project : await fetchProject(client, projectId); if (!p) throw new Error('project not found: ' + projectId);
    var list = actionsOf(p).filter(function (x) { return x.id !== actionId; }).map(function (x) { return x.id === 'legacy' ? Object.assign({}, x, { id: newId() }) : x; });
    return save(client, projectId, mirror(list), p);
  }
  async function setEnquiryDate(client, projectId, iso, project) {
    return save(client, projectId, { enquiry_on: iso ? isoDay(iso) : null }, project);
  }
  // resolve a project from whatever the caller has: id · ref · WeQuote number · client email · phone
  async function findProjectId(client, k) {
    k = k || {};
    if (k.id) return k.id;
    var q = client.from('projects').select('id,ref,client_email,client_phone');
    var r;
    if (k.ref) { r = await q.eq('ref', k.ref).maybeSingle(); if (r.data) return r.data.id; }
    if (k.wqNo) { r = await client.from('projects').select('id,ref').ilike('ref', String(k.wqNo) + ' - %').limit(1); if (r.data && r.data[0]) return r.data[0].id; }
    if (k.email) { r = await client.from('projects').select('id').ilike('client_email', String(k.email).trim()).order('updated_at', { ascending: false }).limit(1); if (r.data && r.data[0]) return r.data[0].id; }
    if (k.phone) { var digits = String(k.phone).replace(/\D/g, '').slice(-9); if (digits.length >= 9) { r = await client.from('projects').select('id,client_phone').not('client_phone', 'is', null).limit(500); var hit = (r.data || []).find(function (p) { return String(p.client_phone || '').replace(/\D/g, '').slice(-9) === digits; }); if (hit) return hit.id; } }
    return null;
  }

  global.SonorBoardLog = { VERSION: VERSION, actionsOf: actionsOf, openActions: openActions, addAction: addAction, editAction: editAction, doneAction: doneAction, removeAction: removeAction, CONTACT_KINDS: CONTACT_KINDS, CONTACT_WAYS: CONTACT_WAYS, wayOf: wayOf, thirdOf: thirdOf, logThird: logThird, boardOf: boardOf, contactOf: contactOf, enquiryOf: enquiryOf, touchedAt: touchedAt, lastSent: lastSent, isoDay: isoDay, save: save, logContact: logContact, setEnquiryDate: setEnquiryDate, findProjectId: findProjectId };
})(typeof window !== 'undefined' ? window : this);
