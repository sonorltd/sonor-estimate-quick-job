/**
 * sonor-contacts.js — CANONICAL MASTER · v1.0.0 · 2026-10-17
 * ONE place every Sonor app goes for PEOPLE and for logging a conversation with them.
 * Bryn 2026-10-17: "make sure all this sort of contacts thing is piped throughout all apps … everything should be 2 way, ssot
 * somewhere, no islands rule … in harmony with wq and the crm there … even if not possible for current wq api, make the functions
 * because this will hopefully become possible soon via mcp, so prepare for this but only use what we can".
 *
 * WHERE EACH KIND OF PERSON LIVES (one source each — never a copy that can drift):
 *   clients + their people  → the WeQuote customer + its contacts (WeQuote is the client CRM). Read through SonorWQClient
 *                             (wq-proxy, read-only); added through SonorWqPush.addContact (wq-push 1.5.0 add_contact).
 *   providers, subcontractors, trade, partners → public.contacts (Leads · Follow-Up Portal · Master Hub Subcontractors).
 *                             Service-contract providers are two-way synced with their company contact by DB triggers
 *                             (_svc_provider_contact_sync / _svc_contact_provider_sync); their people carry metadata.provider_id
 *                             (v_provider_people). metadata.booking marks the person booking emails go to.
 *   every conversation      → projects.metadata.board.contacts via SonorBoardLog (way: ↗ we → client · ↘ client → us ·
 *                             ⇲ third party → us · ⇱ we → third party; who; contact_id / wq_contact_id).
 *
 * WEQUOTE CAPABILITIES (wq_config.metadata.caps — read once; the ONLY switch):
 *   read_customers · read_contacts · add_contact           — live today (API)
 *   create_customer                                        — in the API, not wired yet
 *   update_customer · update_contact · remove_contact      — need the WeQuote MCP. The functions below exist now; until the
 *       capability is true AND a write transport is plugged in (setWriteTransport) they return
 *       { ok:false, unsupported:true, todo:'Change it in WeQuote', url } so the app shows a link instead of failing.
 *
 * Classic script. Load AFTER sonor-db.js, sonor-board-log.js, sonor-wq-client.js and sonor-wq-push.js (all optional —
 * each function degrades when its dependency is missing). Synced to every app's data/ by sync-everything.sh.
 *
 * API
 *   await SonorContacts.init(supa)                                  → caps
 *   SonorContacts.caps()                                            → { add_contact:true, update_contact:false, … }
 *   SonorContacts.setWriteTransport(async (op, args) => result)     — the MCP plug point (op: create_customer · update_customer ·
 *                                                                     update_contact · remove_contact · add_contact)
 *   // providers / subcontractors / trade (public.contacts)
 *   await SonorContacts.providerPeople(supa, providerId?)           → rows of v_provider_people
 *   SonorContacts.bookingContact(people)                            → the person booking emails go to (booking + email, else company)
 *   await SonorContacts.addPerson(supa, { name, company, email, phone, role, provider_id?, booking?, subcontractor?, tags? })
 *   await SonorContacts.updatePerson(supa, contactId, patch)        — top-level fields; metadata keys merged (contacts_patch_metadata)
 *   await SonorContacts.projectsForProvider(supa, providerId)       → [project uuid] with an open contract using the provider
 *   // clients (WeQuote CRM)
 *   await SonorContacts.clientPeople(customerId)                    → WeQuote contacts of the customer
 *   await SonorContacts.addClientPerson(supa, customerId, { first_name, surname, email, phone, mobile, job_title }, {dry})
 *   await SonorContacts.updateClientPerson(contactId, patch)        — MCP-ready, unsupported today
 *   await SonorContacts.removeClientPerson(contactId)               — MCP-ready, unsupported today
 *   await SonorContacts.createCustomer(fields)                      — wired when caps.create_customer
 *   await SonorContacts.updateCustomer(customerId, patch)           — MCP-ready, unsupported today
 *   SonorContacts.wqCustomerUrl(customerId)                         → WeQuote web link (where the change is made today)
 *   // conversations
 *   await SonorContacts.log(supa, projectId, { way, kind, on, note, who, contact_id, wq_contact_id, source })
 *        way: 'out_client' | 'in_client' | 'in_third' | 'out_third' (SonorBoardLog.CONTACT_WAYS)
 *   await SonorContacts.logForProvider(supa, providerId, opts)      — one third-party conversation onto every project that uses them
 */
(function (root) {
  'use strict';
  var VERSION = '1.0.0';
  var DEFAULT_CAPS = { read_customers: true, read_contacts: true, add_contact: true, create_customer: false, update_customer: false, update_contact: false, remove_contact: false };
  var _caps = Object.assign({}, DEFAULT_CAPS), _writeTransport = null, _supa = null;
  var WQ_WEB = 'https://app.wequote.cloud/sonor-ltd';

  async function init(supa) {
    _supa = supa || _supa;
    try { var r = await _supa.from('wq_config').select('metadata').limit(1).maybeSingle(); var c = r.data && r.data.metadata && r.data.metadata.caps; if (c) _caps = Object.assign({}, DEFAULT_CAPS, c); } catch (_) { /* defaults */ }
    return caps();
  }
  function caps() { return Object.assign({}, _caps, { write_transport: !!_writeTransport }); }
  function setWriteTransport(fn) { _writeTransport = typeof fn === 'function' ? fn : null; }
  function wqCustomerUrl(customerId) { return customerId ? WQ_WEB + '/customers/' + encodeURIComponent(customerId) : WQ_WEB; }
  function unsupported(op, customerId) { return { ok: false, unsupported: true, op: op, todo: 'Change it in WeQuote — the WeQuote API cannot ' + op.replace('_', ' ') + ' yet (ready for the MCP)', url: wqCustomerUrl(customerId) }; }
  async function viaTransport(op, args, customerId) {
    if (!_caps[op] || !_writeTransport) return unsupported(op, customerId);
    try { var r = await _writeTransport(op, args); return Object.assign({ ok: true }, r || {}); } catch (e) { return { ok: false, op: op, error: e && e.message || String(e) }; }
  }

  // ── providers / subcontractors / trade — public.contacts ──
  async function providerPeople(supa, providerId) {
    supa = supa || _supa; var q = supa.from('v_provider_people').select('*'); if (providerId) q = q.eq('provider_id', providerId);
    var r = await q; if (r.error) throw r.error; return r.data || [];
  }
  function bookingContact(people) {
    people = people || [];
    return people.find(function (p) { return p.booking && p.email && !p.is_company; }) || people.find(function (p) { return p.is_company && p.email; }) || people.find(function (p) { return p.booking; }) || people[0] || null;
  }
  async function addPerson(supa, p) {
    supa = supa || _supa; p = p || {};
    if (!String(p.name || '').trim()) throw new Error('name required');
    var md = Object.assign({}, p.metadata || {}, { creationSource: p.source || 'sonor-contacts' });
    if (p.provider_id) md.provider_id = p.provider_id; if (p.role) md.role = p.role; if (p.booking) md.booking = true; if (p.subcontractor) md.subcontractor = true;
    var row = { name: String(p.name).trim(), company: p.company || null, type: p.type || 'other', email: p.email || null, phone: p.phone || null, website: p.website || null, source: p.source || 'sonor-contacts', notes: p.notes || null, tags: p.tags || (p.provider_id ? ['provider'].concat(p.subcontractor ? ['subcontractor'] : []) : null), metadata: md };
    var r = await supa.from('contacts').insert(row).select().single(); if (r.error) throw r.error; return r.data;
  }
  async function updatePerson(supa, contactId, patch) {
    supa = supa || _supa; patch = Object.assign({}, patch || {});
    var md = patch.metadata; delete patch.metadata;
    if (Object.keys(patch).length) { var r = await supa.from('contacts').update(patch).eq('id', contactId); if (r.error) throw r.error; }
    if (md && Object.keys(md).length) { var m = await supa.rpc('contacts_patch_metadata', { p_contact_id: contactId, p_patch: md }); if (m.error) throw m.error; }   // atomic merge — CONTACTS-ARCHITECTURE.md
    return true;
  }
  async function projectsForProvider(supa, providerId) {
    supa = supa || _supa; var r = await supa.rpc('sonor_provider_projects', { p_provider: providerId }); if (r.error) throw r.error;
    return (r.data || []).map(function (x) { return typeof x === 'string' ? x : (x.sonor_provider_projects || x.project_id || x); });
  }

  // ── clients — the WeQuote customer CRM ──
  async function clientPeople(customerId) {
    if (!customerId || !root.SonorWQClient || !root.SonorWQClient.findContacts) return [];
    return root.SonorWQClient.findContacts(customerId);
  }
  async function addClientPerson(supa, customerId, person, opts) {
    if (!_caps.add_contact) return unsupported('add_contact', customerId);
    if (_writeTransport) return viaTransport('add_contact', Object.assign({ customer_id: customerId }, person), customerId);   // MCP first when plugged in
    if (!root.SonorWqPush || !root.SonorWqPush.addContact) return { ok: false, error: 'sonor-wq-push.js 1.2.0+ not loaded' };
    var r = await root.SonorWqPush.addContact(Object.assign({ customer_id: customerId }, person), { supa: supa || _supa, dry: opts && opts.dry });
    if (r && r.ok && root.SonorWQClient && root.SonorWQClient.clearCache) root.SonorWQClient.clearCache('/customer/');
    return r;
  }
  function updateClientPerson(contactId, patch, customerId) { return viaTransport('update_contact', { id: contactId, patch: patch }, customerId); }
  function removeClientPerson(contactId, customerId) { return viaTransport('remove_contact', { id: contactId }, customerId); }
  function createCustomer(fields) { return viaTransport('create_customer', fields || {}, null); }
  function updateCustomer(customerId, patch) { return viaTransport('update_customer', { id: customerId, patch: patch }, customerId); }

  // ── conversations — SonorBoardLog ──
  async function log(supa, projectId, o) {
    var B = root.SonorBoardLog; if (!B || !projectId) return null; o = o || {};
    var w = (B.CONTACT_WAYS || {})[o.way || 'out_client'] || { dir: 'out', party: 'client' };
    return B.logContact(supa || _supa, projectId, { kind: o.kind || 'call', on: o.on, note: o.note, who: o.who, source: o.source, dir: o.dir || w.dir, party: o.party || w.party, contact_id: o.contact_id, wq_contact_id: o.wq_contact_id, done_action: o.done_action }, o.project);
  }
  async function logForProvider(supa, providerId, o) {
    var ids = []; try { ids = await projectsForProvider(supa, providerId); } catch (_) { return 0; }
    for (var i = 0; i < ids.length; i++) { try { await log(supa, ids[i], Object.assign({ way: 'in_third' }, o || {})); } catch (_) { /* best effort */ } }
    return ids.length;
  }

  root.SonorContacts = { VERSION: VERSION, init: init, caps: caps, setWriteTransport: setWriteTransport, wqCustomerUrl: wqCustomerUrl,
    providerPeople: providerPeople, bookingContact: bookingContact, addPerson: addPerson, updatePerson: updatePerson, projectsForProvider: projectsForProvider,
    clientPeople: clientPeople, addClientPerson: addClientPerson, updateClientPerson: updateClientPerson, removeClientPerson: removeClientPerson,
    createCustomer: createCustomer, updateCustomer: updateCustomer, log: log, logForProvider: logForProvider };
})(typeof window !== 'undefined' ? window : globalThis);
