/**
 * sonor-links.js — cross-app links UI: "which version of each app this is linked / locked to" + "upstream changed"
 * warnings (sonor-kit v0.9.0, 2026-10-21). Owner 2026-10-21: "warnings should also be in place if something changed
 * from another app and which version in each app is linked and locked to".
 * Design: audit/engineering-wiring/XAPP-LINKS-DESIGN-2026-10-21.md §5. A THIN DOM shell over window.SonorRevisions ≥ 1.1.0
 * (root master sonor-revisions.js — the model, the wording, the storage). Engineering renders the same model in React.
 *
 *   <sonor-links-banner app="packs" sources="engineering,library" [project-id]>    under the tab bar
 *   <sonor-links-button app="packs" sources="engineering,library" [project-id]>    in the tab-bar actions rail
 *     project-id falls back to SonorProjectBar.getActiveId(); both reload on sonor:project-changed.
 *   el.onUpdate  = async (status) => { …re-read upstream…; return { fp, counts } }   → then link(…, {via:'update'})
 *   el.onReview  = (status) => {}                                                    (default: kit modal listing status.delta)
 *   el.ctx       = {…}    passed to SonorRevisions delta fns · el.blockCodes = [...] scopes the Library check
 *   el.refresh()
 *   events (bubble): sonor:links-status {statuses} · sonor:links-update / -review / -lock / -unlock / -ack {source,status}
 *     sonor:links-update is cancelable: preventDefault() + call detail.done(opts) when the host has applied the change.
 *   SonorLinks.{controller(app, pid, sources), bannerModel(statuses), dotState(statuses), resolveRevisions(), VERSION}
 *
 * Banner: one row per moved, un-acked, un-locked source (> 2 → "N upstream changes" + expand). Locked + moved → muted
 * chip "Takeoffs locked at A3 · now A5". Unreachable → grey chip, never a warning. Exports are never blocked.
 * Light DOM; styles in sonor-links.css (kit.css, sonor-kit layer). Tokens only. Lucide via SonorIcons, emoji fallback.
 */
(function (global) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = global.document;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(name, emoji) { var I = global.SonorIcons; return I && I.svg && (!I.has || I.has(name)) ? I.svg(name, { size: 14 }) : '<span aria-hidden="true">' + emoji + '</span>'; }
  function list(v) { return String(v || '').split(/[\s,]+/).filter(Boolean); }

  // ── pure model (unit-tested) ────────────────────────────────────────────────────────────────────────────────
  /** statuses (SonorRevisions.checkLinks) → what the banner shows. */
  function bannerModel(statuses, o) {
    o = o || {};
    var st = Array.isArray(statuses) ? statuses : [];
    var rows = st.filter(function (s) { return s && s.attention; });
    var chips = st.filter(function (s) { return s && !s.attention && ((s.locked && s.moved) || s.why === 'source-unavailable'); })
      .map(function (s) { return { source: s.source, tone: s.why === 'source-unavailable' ? 'muted' : 'locked', text: s.text }; });
    var collapsed = rows.length > 2 && !o.expanded;
    return { rows: collapsed ? [] : rows, all: rows, chips: chips, collapsed: collapsed, count: rows.length,
      summary: rows.length > 2 ? rows.length + ' upstream changes' : '', empty: !rows.length && !chips.length };
  }
  /** One dot for the button: 'moved' (amber) > 'locked' > 'unavailable' > 'ok' > 'none'. */
  function dotState(statuses) {
    var st = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
    if (!st.length) return 'none';
    if (st.some(function (s) { return s.attention; })) return 'moved';
    if (st.some(function (s) { return s.locked; })) return 'locked';
    if (st.some(function (s) { return s.why === 'source-unavailable'; })) return 'unavailable';
    return 'ok';
  }
  function statusCell(s) {
    if (s.why === 'source-unavailable') return { tone: 'muted', text: 'not reachable' };
    if (s.why === 'not-linked') return { tone: 'muted', text: 'not linked' };
    if (s.locked) return { tone: 'locked', text: 'locked' + (s.link && s.link.locked_by ? ' by ' + s.link.locked_by : '') + (s.moved ? ' · behind' : '') };
    if (s.moved && s.acked) return { tone: 'muted', text: 'kept as is' };
    if (s.moved && s.minor) return { tone: 'muted', text: 'edited, no device change' };
    if (s.moved) return { tone: 'warn', text: (s.delta && s.delta.text) || (s.why === 'edited-since' ? 'edited' : 'changed') };
    return { tone: 'ok', text: 'current' };
  }

  // ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
  function resolveRevisions() {
    var R = global.SonorRevisions;
    if (!R || typeof R.checkLinks !== 'function') return null;           // needs sonor-revisions.js ≥ 1.1.0 on the page
    if (!R._linksConfigured) {
      try {
        if (typeof SONOR_SUPABASE_URL !== 'undefined' && typeof SONOR_SUPABASE_ANON !== 'undefined') R.configure({ url: SONOR_SUPABASE_URL, key: SONOR_SUPABASE_ANON });
        else if (global.SonorDB && global.SonorDB.current && global.SonorDB.current.url && global.SonorDB.current.key) R.configure({ url: global.SonorDB.current.url, key: global.SonorDB.current.key });
      } catch (_) { }
      R._linksConfigured = true;
    }
    return R;
  }
  function resolveClient() {
    try { if (global.SonorDB && global.SonorDB.current && global.SonorDB.current.client) return global.SonorDB.current.client; } catch (_) { }
    try { if (global.sonorDb && global.sonorDb.client) return global.sonorDb.client; } catch (_) { }
    return null;                                                          // no realtime → SonorRevisions.watch polls + focus
  }
  function activeProject(el) {
    var a = el.getAttribute('project-id'); if (a) return a;
    try { return (global.SonorProjectBar && global.SonorProjectBar.getActiveId && global.SonorProjectBar.getActiveId()) || null; } catch (_) { return null; }
  }

  /** One controller per (app, project, sources): banner + button on the same page share one check + one watch. */
  var controllers = {};
  function controller(app, pid, sources) {
    var id = app + '|' + pid + '|' + (sources || []).join(',');
    if (controllers[id]) return controllers[id];
    var R = resolveRevisions();
    var c = { app: app, pid: pid, sources: sources || [], statuses: [], usedBy: [], subs: [], ctx: {}, blockCodes: null, unwatch: null };
    c.emit = function () { c.subs.forEach(function (fn) { try { fn(c); } catch (e) { console.warn('[SonorLinks]', e); } }); };
    c.refresh = function () {
      if (!R || !pid) { c.statuses = []; c.emit(); return Promise.resolve([]); }
      return Promise.all([
        R.checkLinks(app, pid, { keys: c.sources.length ? c.sources : null, ctx: c.ctx, blockCodes: c.blockCodes }),
        R.usedBy(pid, app),
      ]).then(function (r) { c.statuses = r[0] || []; c.usedBy = r[1] || []; c.emit(); return c.statuses; }, function (e) { console.warn('[SonorLinks]', e); return c.statuses; });
    };
    c.subscribe = function (fn) {
      c.subs.push(fn);
      if (c.subs.length === 1) { c.refresh(); if (R && pid) c.unwatch = R.watch(pid, c.sources, function (s) { c.statuses = s; c.emit(); }, { app: app, client: resolveClient(), ctx: c.ctx, blockCodes: c.blockCodes }); }
      else fn(c);
      return function () { c.subs = c.subs.filter(function (x) { return x !== fn; }); if (!c.subs.length) { if (c.unwatch) c.unwatch(); delete controllers[id]; } };
    };
    c.act = function (el, kind, s, extra) {
      if (!R) return Promise.resolve();
      var p;
      if (kind === 'lock') p = R.lock(app, pid, s.source, { by: extra && extra.by, note: extra && extra.note });
      else if (kind === 'unlock') p = R.unlock(app, pid, s.source);
      else if (kind === 'ack') p = R.ack(app, pid, s.source, s.current);
      else if (kind === 'relink') p = R.link(app, pid, s.source, s.current, extra || {});
      return Promise.resolve(p).then(c.refresh);
    };
    controllers[id] = c;
    return c;
  }

  function fire(el, name, detail, cancelable) {
    var ev; try { ev = new CustomEvent(name, { bubbles: true, cancelable: !!cancelable, detail: detail }); } catch (_) { return true; }
    return el.dispatchEvent(ev);
  }
  function doUpdate(el, c, s) {
    var done = function (o) { o = o || {}; return c.act(el, 'relink', s, { via: 'update', fp: o.fp, counts: o.counts, linkedBy: o.linkedBy, appVersion: o.appVersion }); };
    if (typeof el.onUpdate === 'function') return Promise.resolve(el.onUpdate(s)).then(function (o) { if (o !== false) return done(o); });
    var handled = !fire(el, 'sonor:links-update', { source: s.source, status: s, done: done }, true);
    if (!handled) console.warn('[SonorLinks] Update needs el.onUpdate or a sonor:links-update listener that calls detail.done() — nothing applied.');
  }
  function doReview(el, s) {
    if (typeof el.onReview === 'function') return el.onReview(s);
    if (!fire(el, 'sonor:links-review', { source: s.source, status: s }, true)) return;
    var d = s.delta || {}, items = [];
    ['added', 'removed', 'changed'].forEach(function (k) {
      var v = d[k]; if (v == null) return;
      items.push('<li><strong>' + esc(k) + '</strong> ' + esc(Array.isArray(v) ? v.length + ': ' + v.slice(0, 20).map(function (x) { return x && (x.label || x.id) || x; }).join(', ') : v) + '</li>');
    });
    var html = '<p>' + esc(s.text) + '</p>' + (items.length ? '<ul class="slk-delta">' + items.join('') + '</ul>' : '<p class="slk-muted">No detail from this app — open the source to compare.</p>');
    var M = global.SonorModal;
    if (M && M.create) { var b = doc.createElement('div'); b.innerHTML = html; M.create({ title: s.label + ' — what changed', body: b, actions: [{ label: 'Close', kind: 'secondary' }] }); }
    else global.alert && global.alert(s.text);
  }

  // ── <sonor-links-banner> ────────────────────────────────────────────────────────────────────────────────────
  var Base = typeof HTMLElement !== 'undefined' ? HTMLElement : function () { };
  function Linked(Super) {
    return class extends Super {
      static get observedAttributes() { return ['app', 'sources', 'project-id']; }
      connectedCallback() {
        this.classList.add('slk');
        this._onProject = () => this._bind();
        if (doc) doc.addEventListener('sonor:project-changed', this._onProject);
        this._bind();
      }
      disconnectedCallback() { if (doc) doc.removeEventListener('sonor:project-changed', this._onProject); if (this._unsub) this._unsub(); this._unsub = null; }
      attributeChangedCallback() { if (this.isConnected) this._bind(); }
      refresh() { return this._c ? this._c.refresh() : Promise.resolve([]); }
      _bind() {
        if (this._unsub) this._unsub();
        this._unsub = null; this._c = null;
        var app = this.getAttribute('app'), pid = activeProject(this);
        if (!app || !pid || !resolveRevisions()) { this.hidden = true; this.innerHTML = ''; return; }
        var c = this._c = controller(app, pid, list(this.getAttribute('sources')));
        if (this.ctx) c.ctx = this.ctx;
        if (this.blockCodes) c.blockCodes = this.blockCodes;
        this._unsub = c.subscribe(() => { this._render(c); fire(this, 'sonor:links-status', { statuses: c.statuses }); });
      }
      _act(kind, source, extra) {
        var c = this._c; if (!c) return;
        var s = c.statuses.filter(function (x) { return x.source === source; })[0]; if (!s) return;
        if (kind === 'update') return doUpdate(this, c, s);
        if (kind === 'review') return doReview(this, s);
        if (!fire(this, 'sonor:links-' + kind, { source: source, status: s }, true)) return;
        return c.act(this, kind, s, extra);
      }
      _wire() {
        var self = this;
        Array.prototype.forEach.call(this.querySelectorAll('[data-slk-act]'), function (b) {
          b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self._act(b.getAttribute('data-slk-act'), b.getAttribute('data-slk-src')); });
        });
      }
    };
  }

  class Banner extends Linked(Base) {
    _render(c) {
      var m = bannerModel(c.statuses, { expanded: this._expanded });
      this.hidden = m.empty;
      if (m.empty) { this.innerHTML = ''; return; }
      this.setAttribute('role', 'status'); this.setAttribute('aria-live', 'polite');
      var rows = m.rows.map(function (s) {
        return '<div class="slk-row" data-slk-row="' + esc(s.source) + '"><span class="slk-ico">' + icon('triangle-alert', '⚠') + '</span>'
          + '<span class="slk-text">' + esc(s.text) + '</span><span class="slk-acts">'
          + '<button type="button" class="slk-btn" data-slk-act="review" data-slk-src="' + esc(s.source) + '">Review</button>'
          + '<button type="button" class="slk-btn slk-primary" data-slk-act="update" data-slk-src="' + esc(s.source) + '">Update</button>'
          + '<button type="button" class="slk-btn" data-slk-act="lock" data-slk-src="' + esc(s.source) + '" title="Keep using the linked version and stop warning">Keep locked</button>'
          + '<button type="button" class="slk-x" data-slk-act="ack" data-slk-src="' + esc(s.source) + '" aria-label="Keep as is for this change" title="Keep as is (warns again on the next change)">' + icon('x', '✕') + '</button>'
          + '</span></div>';
      }).join('');
      var sum = m.collapsed ? '<div class="slk-row"><span class="slk-ico">' + icon('triangle-alert', '⚠') + '</span><span class="slk-text">' + esc(m.summary) + '</span><span class="slk-acts"><button type="button" class="slk-btn" data-slk-expand>Show</button></span></div>' : '';
      var chips = m.chips.length ? '<div class="slk-chips">' + m.chips.map(function (ch) { return '<span class="slk-chip slk-' + ch.tone + '">' + (ch.tone === 'locked' ? icon('lock', '🔒') : icon('cloud-off', '·')) + ' ' + esc(ch.text) + '</span>'; }).join('') + '</div>' : '';
      this.innerHTML = '<div class="slk-banner' + (m.count ? ' slk-has-warn' : '') + '">' + sum + rows + chips + '</div>';
      var ex = this.querySelector('[data-slk-expand]');
      if (ex) ex.addEventListener('click', () => { this._expanded = true; this._render(c); });
      this._wire();
    }
  }

  // ── <sonor-links-button> + popover ──────────────────────────────────────────────────────────────────────────
  class Button extends Linked(Base) {
    connectedCallback() {
      super.connectedCallback();
      this._onDoc = (ev) => { if (this._open && !this.contains(ev.target)) this._toggle(false); };
      this._onKey = (ev) => { if (this._open && ev.key === 'Escape') { this._toggle(false); var b = this.querySelector('.slk-trigger'); if (b) b.focus(); } };
      if (doc) { doc.addEventListener('pointerdown', this._onDoc); doc.addEventListener('keydown', this._onKey); }
    }
    disconnectedCallback() { super.disconnectedCallback(); if (doc) { doc.removeEventListener('pointerdown', this._onDoc); doc.removeEventListener('keydown', this._onKey); } }
    _toggle(v) { this._open = v == null ? !this._open : !!v; if (this._c) this._render(this._c); }
    _render(c) {
      this.hidden = false;
      var dot = dotState(c.statuses), R = resolveRevisions();
      var trig = '<button type="button" class="slk-trigger" aria-haspopup="dialog" aria-expanded="' + (this._open ? 'true' : 'false') + '" title="Which version of each app this is linked to">'
        + icon('link', '🔗') + ' Linked to <span class="slk-dot slk-dot-' + dot + '" aria-label="' + dot + '">' + (dot === 'locked' ? icon('lock', '🔒') : '') + '</span></button>';
      var pop = '';
      if (this._open) {
        var body = c.statuses.map(function (s) {
          var st = statusCell(s), l = s.link || {};
          var linkedAt = l.linked_at ? ' · ' + (R && R.ago ? R.ago(l.linked_at) : l.linked_at) : '';
          var acts = [];
          if (s.moved && !s.locked) acts.push('<button type="button" class="slk-btn slk-primary" data-slk-act="update" data-slk-src="' + esc(s.source) + '">Update</button>');
          if (s.moved && s.delta) acts.push('<button type="button" class="slk-btn" data-slk-act="review" data-slk-src="' + esc(s.source) + '">Review</button>');
          if (s.link) acts.push(s.locked ? '<button type="button" class="slk-btn" data-slk-act="unlock" data-slk-src="' + esc(s.source) + '">Unlock</button>' : '<button type="button" class="slk-btn" data-slk-act="lock" data-slk-src="' + esc(s.source) + '">Lock</button>');
          return '<tr><th scope="row">' + esc(s.label) + '</th><td>' + esc(s.linked || '—') + '<span class="slk-muted">' + esc(linkedAt) + '</span></td>'
            + '<td>' + esc(s.now || '—') + (s.ago ? '<span class="slk-muted"> · ' + esc(s.ago) + '</span>' : '') + '</td>'
            + '<td><span class="slk-chip slk-' + st.tone + '">' + (st.tone === 'locked' ? icon('lock', '🔒') + ' ' : st.tone === 'warn' ? icon('triangle-alert', '⚠') + ' ' : st.tone === 'ok' ? icon('check', '✓') + ' ' : '') + esc(st.text) + '</span></td>'
            + '<td class="slk-acts">' + acts.join('') + '</td></tr>';
        }).join('');
        var used = (c.usedBy || []).map(function (u) {
          var s = u.status || {};
          return '<li>' + esc(u.label || u.consumer) + ' → ' + esc(s.linked || '—') + (s.moved ? ' <span class="slk-chip slk-warn">now ' + esc(s.now) + ', behind</span>' : ' <span class="slk-chip slk-ok">' + icon('check', '✓') + ' current</span>') + (s.locked ? ' ' + icon('lock', '🔒') : '') + '</li>';
        }).join('');
        var links = {}; c.statuses.forEach(function (s) { if (s.link) links[s.source] = s.link; });
        var next = R && R.builtFromText ? R.builtFromText(links) : '';
        pop = '<div class="slk-pop" role="dialog" aria-label="Linked to">'
          + (body ? '<table class="slk-table"><thead><tr><th>Source</th><th>Linked</th><th>Now</th><th>Status</th><th></th></tr></thead><tbody>' + body + '</tbody></table>'
            : '<p class="slk-muted">Not linked to any other app yet.</p>')
          + (used ? '<div class="slk-sub">Used by</div><ul class="slk-used">' + used + '</ul>' : '')
          + (next ? '<div class="slk-foot">Next revision will record: ' + esc(next.replace(/^From /, '')) + '</div>' : '')
          + '</div>';
      }
      this.innerHTML = trig + pop;
      this.querySelector('.slk-trigger').addEventListener('click', () => this._toggle());
      this._wire();
    }
  }

  if (typeof customElements !== 'undefined') {
    if (!customElements.get('sonor-links-banner')) customElements.define('sonor-links-banner', Banner);
    if (!customElements.get('sonor-links-button')) customElements.define('sonor-links-button', Button);
  }
  global.SonorLinks = { VERSION: VERSION, controller: controller, bannerModel: bannerModel, dotState: dotState, statusCell: statusCell, resolveRevisions: resolveRevisions };
})(typeof window !== 'undefined' ? window : globalThis);
