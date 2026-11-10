/* sonor-survey-link.js — SHARED SURVEY SEAM (canonical master at workspace root, synced to every app's data/)
 * v1.0.0 (2026-10-12, Survey v0.8.0 / Garden Lighting v0.3.0) — HARMONY §3: ONE way for any app to pull what the
 * Survey app recorded on site, and ONE way to jump into Survey for the same project.
 *   Bryn: "wire this to the garden lighting app too so we can seamlessly pull between, and sort it so this can be useful
 *   to other apps too in future. it should be modular like all others and sharing methods where possible."
 * Reads only (survey_sessions · survey_pages · the public site-photos bucket). No writes, no DOM unless you ask for the card.
 *
 *   SonorSurveyLink.load(supa, projectId)            → { sessions, pages, photos, pins, devicesByFloor, tags, url }
 *       photos:  [{ id, tag:'P3', url, path, title, room, floor, w, h, session_id, page_id, plan_pin, category:'survey'|'pre-visit'|'received'|'existing', credit:{from, via}|null, taken_at }]  (report order)
 *       pins:    [{ id, pin:'rfi'|…, n, label:'RFI 3', text, to, floor, page_id, session_id, x, y }]
 *       devicesByFloor: { GF: [{ code, label, nn, block_code, n }] }   (service order)
 *   SonorSurveyLink.url(projectId, { session?, page?, source? })   → deep link into Survey (hosted by default)
 *   SonorSurveyLink.fetchFile(photo)                 → File (jpeg) for apps that keep their own copy (Garden Lighting zones…)
 *   SonorSurveyLink.renderCard(host, { supa, projectId, title?, onPickPhoto?, pick? })  → a themed card: sessions · photos grid ·
 *       pins · devices · "Open in Survey ↗" · "＋ New survey ↗"; with onPickPhoto the photos become pick buttons (pick:'multi' adds ☑ + Use selected)
 *   SonorSurveyLink.ink(supa, projectId, floorCode)  → survey_pages rows (ink) for that floor's plan pages — paint with SonorInk.drawInk
 * Consumers: Garden Lighting (photos → zones, plan ↔ survey), PM brief (Site surveys card), Takeoffs (survey layer already on SonorInk),
 * Tasks (snag pins), Portal. Edit THIS master; `bash sync-everything.sh --only sonor-survey-link.js`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.SonorSurveyLink = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.1', BUCKET = 'site-photos', HOSTED = 'https://apps.sonor.co.uk/sonor-survey/', LOCAL = '../APP - Survey/dashboard/sonor-survey.html';
  var PIN_LABEL = { rfi: 'RFI', snag: 'SNAG', client: 'CLIENT', note: 'NOTE', dim: 'DIM' };
  var PIN_NAME = { rfi: 'RFI / query', snag: 'Snag', client: 'Client comment', note: 'Site note', dim: 'Measurement' };

  function base(source) { try { var B = (typeof window !== 'undefined') && window.SonorBrand; var u = B && B.appUrls && B.appUrls[source === 'local' ? 'local' : 'hosted'] && B.appUrls[source === 'local' ? 'local' : 'hosted'].survey; if (u) return u; } catch (e) { } return source === 'local' ? LOCAL : HOSTED; }
  function url(pid, o) { o = o || {}; var q = new URLSearchParams(); if (pid) q.set('pid', pid); if (o.session) q.set('session', o.session); if (o.page) q.set('page', o.page); if (o.action) q.set('action', o.action); var s = q.toString(); return base(o.source) + (s ? '?' + s : ''); }
  function publicUrl(supa, path) { try { return supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return null; } }

  // the same numbering the Survey app + report use (SonorInk.photoTags when present; identical fallback otherwise)
  function photoTags(pages) {
    if (typeof window !== 'undefined' && window.SurveyInk && window.SurveyInk.photoTags) return window.SurveyInk.photoTags(pages);
    var live = {}, tag = {}, pinnedBy = {}, n = 0;
    pages.forEach(function (p) { live[p.id] = p; });
    pages.forEach(function (p) { (((p.ink || {}).marks) || []).forEach(function (m) { var id = m.photo_page_id; if (!id || !live[id] || live[id].kind !== 'photo' || tag[id]) return; tag[id] = 'P' + (++n); pinnedBy[id] = { pageId: p.id, markId: m.id }; }); });
    pages.forEach(function (p) { if (p.kind !== 'photo' || tag[p.id]) return; tag[p.id] = 'P' + (++n); var pin = p.metadata && p.metadata.plan_pin; if (pin && pin.page_id && live[pin.page_id]) pinnedBy[p.id] = { pageId: pin.page_id, markId: pin.mark_id || null }; });
    return { tag: tag, pinnedBy: pinnedBy, count: n };
  }

  async function load(supa, pid) {
    var s = await supa.from('survey_sessions').select('id,title,kind,status,engineer,started_at,ended_at').eq('project_id', pid).order('started_at', { ascending: false });
    var p = await supa.from('survey_pages').select('id,session_id,kind,seq,title,floor_code,room,photo_path,ink,metadata,plan_ref,created_at').eq('project_id', pid).order('created_at');
    var sessions = s.error ? [] : s.data, order = {}; sessions.forEach(function (x, i) { order[x.id] = i; });
    var pages = (p.error ? [] : p.data).filter(function (x) { return !(x.metadata && x.metadata.hidden); })
      .sort(function (a, b) { return (order[b.session_id] || 0) - (order[a.session_id] || 0) || (a.seq || 0) - (b.seq || 0); });   // newest session first, strip order within
    var photos = [], pins = [], dev = {}, byId = {}; pages.forEach(function (x) { byId[x.id] = x; });
    // tags are per session (the report numbers within a survey)
    var tags = {}; sessions.forEach(function (ss) { var sp = pages.filter(function (x) { return x.session_id === ss.id; }); var t = photoTags(sp); Object.keys(t.tag).forEach(function (k) { tags[k] = t.tag[k]; }); });
    pages.forEach(function (x) {
      if (x.kind === 'photo' && x.photo_path) photos.push({ id: x.id, tag: tags[x.id] || null, url: publicUrl(supa, x.photo_path), path: x.photo_path, title: x.title || null, room: x.room || null, floor: x.floor_code || null, w: (x.metadata || {}).w || (x.ink && x.ink.space && x.ink.space.w) || null, h: (x.metadata || {}).h || (x.ink && x.ink.space && x.ink.space.h) || null, session_id: x.session_id, page_id: x.id, plan_pin: (x.metadata || {}).plan_pin || null, category: (x.metadata || {}).category || 'survey', credit: (x.metadata || {}).credit || null, taken_at: x.created_at, has_ink: !!(x.ink && ((x.ink.strokes || []).length || (x.ink.objects || []).length)) });
      ((x.ink && x.ink.marks) || []).forEach(function (m) {
        if (m.kind === 'pin') pins.push({ id: m.id, pin: m.pin, n: m.n || null, label: (PIN_LABEL[m.pin] || 'PIN') + (m.n ? ' ' + m.n : ''), name: PIN_NAME[m.pin] || 'Pin', text: m.text || '', to: m.to || null, floor: x.floor_code || null, page_id: x.id, page_title: x.title || null, session_id: x.session_id, x: m.x, y: m.y, c: m.c || null });
        else if (m.kind === 'block') { var f = x.floor_code || (x.kind === 'plan' ? 'Plan' : 'Notes'); dev[f] = dev[f] || {}; var k = m.code || m.label; if (!dev[f][k]) dev[f][k] = { code: m.code, label: m.label || m.code, nn: m.nn || null, block_code: m.block_code || null, c: m.c || null, n: 0 }; dev[f][k].n++; }
      });
    });
    var devicesByFloor = {}; Object.keys(dev).forEach(function (f) { devicesByFloor[f] = Object.keys(dev[f]).map(function (k) { return dev[f][k]; }).sort(function (a, b) { return String(a.nn || '99').localeCompare(String(b.nn || '99')) || String(a.label).localeCompare(String(b.label)); }); });
    return { sessions: sessions, pages: pages, photos: photos, pins: pins, devicesByFloor: devicesByFloor, tags: tags, url: url(pid), byId: byId };
  }
  async function ink(supa, pid, floorCode) {
    var q = supa.from('survey_pages').select('id,session_id,title,floor_code,ink,plan_ref,updated_at').eq('project_id', pid).eq('kind', 'plan');
    if (floorCode) q = q.eq('floor_code', floorCode);
    var r = await q; return r.error ? [] : r.data.filter(function (x) { return !(x.metadata && x.metadata.hidden); });
  }
  async function fetchFile(photo) {
    var r = await fetch(photo.url); if (!r.ok) throw new Error('photo ' + r.status);
    var b = await r.blob(); var name = ((photo.tag ? photo.tag + ' ' : '') + (photo.title || photo.room || 'survey photo')).replace(/[^\w\- ]+/g, '').trim() + '.jpg';
    return new File([b], name, { type: b.type || 'image/jpeg' });
  }

  // ---------- card ----------
  var CSS = '.ssl-card{border:1px solid var(--border,#333);border-radius:10px;background:var(--card,#1c1c1e);color:var(--text-primary,#eee);padding:12px 14px;font:13px/1.4 "DM Sans",system-ui,sans-serif}' +
    '.ssl-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}.ssl-h b{font-size:14px}.ssl-h .ssl-grow{flex:1}.ssl-card .ssl-btn{font:inherit;font-size:12.5px;min-height:34px;padding:5px 10px;border-radius:7px;border:1px solid var(--border,#444);background:var(--body,#141416);color:var(--text-primary,#eee)!important;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}.ssl-btn.pri{background:var(--accent,#3A8AA8);border-color:var(--accent,#3A8AA8);color:#fff}' +
    '.ssl-sess{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}.ssl-card .ssl-sess a{font-size:12px;padding:3px 8px;border-radius:999px;border:1px solid var(--border,#444);color:var(--text-primary,#eee)!important;text-decoration:none}.ssl-sess a.done{opacity:.7}' +
    '.ssl-sec{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#999);margin:10px 0 6px}' +
    '.ssl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}.ssl-ph{position:relative;border:1px solid var(--border,#444);border-radius:8px;overflow:hidden;background:#111;aspect-ratio:4/3;padding:0;cursor:pointer;display:block}.ssl-ph img{width:100%;height:100%;object-fit:cover;display:block}.ssl-ph .tag{position:absolute;left:5px;top:5px;background:#1C1C1E;color:#fff;font:700 10px/1 "DM Sans",system-ui,sans-serif;padding:3px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.7)}.ssl-ph .cap{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:10.5px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}.ssl-ph.sel{outline:3px solid var(--accent,#3A8AA8);outline-offset:-3px}.ssl-ph .tick{position:absolute;right:5px;top:5px;width:20px;height:20px;border-radius:50%;background:var(--accent,#3A8AA8);color:#fff;font-size:12px;display:none;align-items:center;justify-content:center}.ssl-ph.sel .tick{display:flex}' +
    '.ssl-pins{display:flex;flex-direction:column;gap:4px}.ssl-pin{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}.ssl-pin .lab{font-weight:700;min-width:64px;color:var(--pc,#ccc)}.ssl-pin .to{color:var(--text-muted,#999)}' +
    '.ssl-dev{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px}.ssl-dev .f{font-weight:700;margin-right:4px}.ssl-dev .d{display:inline-flex;align-items:center;gap:4px}.ssl-dev .dot{width:14px;height:14px;border-radius:50%;background:var(--dc,#888);display:inline-block}' +
    '.ssl-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}.ssl-empty{color:var(--text-muted,#999)}';
  function injectCss() { if (typeof document === 'undefined' || document.getElementById('ssl-css')) return; var st = document.createElement('style'); st.id = 'ssl-css'; st.textContent = CSS; document.head.appendChild(st); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); } catch (e) { return ''; } }
  async function renderCard(host, o) {
    injectCss(); host.innerHTML = '<div class="ssl-card"><div class="ssl-empty">Loading site surveys…</div></div>';
    var d; try { d = await load(o.supa, o.projectId); } catch (e) { host.innerHTML = '<div class="ssl-card"><div class="ssl-empty">Survey data unavailable (' + esc(e.message) + ')</div></div>'; return null; }
    var card = document.createElement('div'); card.className = 'ssl-card', host.innerHTML = ''; host.appendChild(card);
    var picking = typeof o.onPickPhoto === 'function', multi = picking && o.pick === 'multi', sel = {};
    var h = '<div class="ssl-h"><b>' + esc(o.title || 'Site surveys') + '</b><span class="ssl-grow"></span><a class="ssl-btn" href="' + esc(url(o.projectId)) + '" target="_blank" rel="noopener">Open in Survey ↗</a><a class="ssl-btn" href="' + esc(url(o.projectId, { action: 'new' })) + '" target="_blank" rel="noopener">＋ New survey ↗</a></div>';
    if (!d.sessions.length) h += '<div class="ssl-empty">No survey yet for this project — start one in Survey (photos, plan markup, devices and RFIs come straight back here).</div>';
    else {
      var shown = d.sessions.slice(0, 8), more = d.sessions.length - shown.length;   // the newest eight; the rest are a tap away in Survey
      h += '<div class="ssl-sess">' + shown.map(function (s) { return '<a class="' + (s.status === 'closed' ? 'done' : '') + '" href="' + esc(url(o.projectId, { session: s.id })) + '" target="_blank" rel="noopener">' + (s.status === 'closed' ? '✓ ' : '') + esc(s.title || 'Survey') + ' · ' + fmt(s.started_at) + (s.engineer ? ' · ' + esc(s.engineer) : '') + '</a>'; }).join('') + (more > 0 ? '<a href="' + esc(url(o.projectId)) + '" target="_blank" rel="noopener">+' + more + ' more</a>' : '') + '</div>';
      if (d.photos.length) {
        h += '<div class="ssl-sec">Photos · ' + d.photos.length + (picking ? ' — tap to use' : '') + '</div><div class="ssl-grid">' + d.photos.map(function (p, i) {
          var cap = [p.tag, p.title || p.room || null, p.floor, p.category !== 'survey' ? (p.category + (p.credit && p.credit.from ? ' · ' + p.credit.from : '')) : null].filter(Boolean).join(' · ');
          var inner = '<img loading="lazy" alt="" src="' + esc(p.url) + '">' + (p.tag ? '<span class="tag">' + esc(p.tag) + '</span>' : '') + '<span class="tick">✓</span>' + (cap ? '<span class="cap">' + esc(cap) + '</span>' : '');
          return picking ? '<button type="button" class="ssl-ph" data-i="' + i + '" title="' + esc(cap) + '">' + inner + '</button>' : '<a class="ssl-ph" href="' + esc(url(o.projectId, { session: p.session_id, page: p.page_id })) + '" target="_blank" rel="noopener" title="' + esc(cap) + '">' + inner + '</a>';
        }).join('') + '</div>';
      }
      if (d.pins.length) h += '<div class="ssl-sec">Pins &amp; RFIs · ' + d.pins.length + '</div><div class="ssl-pins">' + d.pins.map(function (q) { return '<div class="ssl-pin"><span class="lab" style="--pc:' + esc(q.c || '#ccc') + '">' + esc(q.label) + '</span><span>' + esc(q.text || '—') + (q.to ? ' <span class="to">→ ' + esc(q.to) + '</span>' : '') + (q.floor ? ' <span class="to">· ' + esc(q.floor) + '</span>' : '') + '</span></div>'; }).join('') + '</div>';
      var floors = Object.keys(d.devicesByFloor);
      if (floors.length) h += '<div class="ssl-sec">Devices marked</div><div class="ssl-dev">' + floors.map(function (f) { return '<span><span class="f">' + esc(f) + '</span>' + d.devicesByFloor[f].map(function (x) { return '<span class="d"><span class="dot" style="--dc:' + esc(x.c || '#888') + '"></span>' + esc(x.label) + ' ×' + x.n + '</span>'; }).join(' ') + '</span>'; }).join('') + '</div>';
    }
    if (multi) h += '<div class="ssl-foot"><button type="button" class="ssl-btn pri ssl-use" disabled>Use selected</button></div>';
    card.innerHTML = h;
    if (picking) {
      Array.prototype.forEach.call(card.querySelectorAll('.ssl-ph'), function (b) { b.onclick = function () { var p = d.photos[+b.dataset.i]; if (!multi) return o.onPickPhoto([p], d); if (sel[p.id]) { delete sel[p.id]; b.classList.remove('sel'); } else { sel[p.id] = p; b.classList.add('sel'); } var u = card.querySelector('.ssl-use'); if (u) { var n = Object.keys(sel).length; u.disabled = !n; u.textContent = n ? 'Use ' + n + ' selected' : 'Use selected'; } }; });
      var use = card.querySelector('.ssl-use'); if (use) use.onclick = function () { o.onPickPhoto(Object.keys(sel).map(function (k) { return sel[k]; }), d); };
    }
    return d;
  }
  return { VERSION: VERSION, url: url, load: load, ink: ink, fetchFile: fetchFile, renderCard: renderCard, photoTags: photoTags, PIN_LABEL: PIN_LABEL, PIN_NAME: PIN_NAME };
}));
