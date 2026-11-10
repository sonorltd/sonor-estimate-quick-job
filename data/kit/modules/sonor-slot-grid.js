/**
 * sonor-slot-grid.js — <sonor-slot-grid>: ONE slot-grid engine for racks (U, bottom-up), DIN-rail enclosures (TE, rows,
 * left-to-right) and patch panels (ports). Kit master (sonor-kit/src), B-484 / B-485, 2026-09-29.
 *
 * Why it exists: the Engineering rack, the lighting-panel builder and the patch-panel editor each had their own
 * "things in slots" code on HTML5 drag-and-drop (browser ghost, neighbours shove on drop, no touch). This is the
 * from-scratch replacement every app uses — vanilla or React 19 (custom element: attributes + properties + events).
 *
 * MODEL (pure, unit-tested)
 *   grid  = { orientation: 'vertical'|'horizontal', rows, size, unit }        rack: vertical, rows 1, size 42, unit 22px
 *   item  = { id, start, size, row, side?, kind?, label?, sub?, colour?, image?, locked?, meta? }
 *           start = 0-based slot in LOGICAL order (rack: 0 = U1 at the bottom · DIN: 0 = leftmost TE of the row)
 *   canPlace(grid, items, item, start, row) → true | 'out' | 'collide'
 *   place(items, item, start, row, {shove})   → new items[] (immutable) or null when refused
 *   autoLayout(grid, items, opts)             → new items[] (first-fit; rack: heavy-first from the bottom, gaps under amps)
 *   stats(grid, items)                        → { used, free, perRow: [{row, used, free, items}] }
 *   toSvg(grid, items, opts)                  → SVG string — the same drawing for screen and PDF
 *
 * ELEMENT
 *   <sonor-slot-grid orientation="vertical" rows="1" size="42" unit="22" label-origin="1"></sonor-slot-grid>
 *   el.items = [...]  (property, re-renders)      el.rules = { canPlace(item, start, row, items) → bool|string }
 *   el.renderItem = (item) => HTMLElement|string  (optional faceplate renderer)
 *   el.beginExternalDrag(item, pointerEvent)      start a drag from ANY palette (vanilla or React) into this grid
 *   el.undo() / el.redo() / el.select(ids) / el.remove(ids) / el.autoLayout()
 *   events (bubbles, composed): sonor:change {items, stats, reason}  sonor:select {ids}  sonor:hover {slot|null}
 *                               sonor:refused {item, start, row, why}  sonor:activate {item} (double-click / Enter)
 *   attributes: readonly · shove (default: refuse — hold Alt while dropping to shove) · snap (slots, default 1)
 *   Pointer Events (mouse / touch / pen), styled ghost, snap-to-slot, refuse (red) / shove (Alt), hover + selected
 *   states as data-state on tokens, keyboard (arrows nudge, Delete, ⌘Z / ⇧⌘Z, Esc), prefers-reduced-motion.
 */
(function (global) {
  'use strict';
  const VERSION = '0.1.1';

  // ── pure model ───────────────────────────────────────────────────────────────────────────────────────────────
  function overlaps(a, b) { return a.row === b.row && a.start < b.start + b.size && b.start < a.start + a.size; }
  function canPlace(grid, items, item, start, row) {
    row = row == null ? (item.row || 0) : row;
    if (start < 0 || row < 0 || row >= (grid.rows || 1) || start + item.size > grid.size) return 'out';
    const probe = { ...item, start, row };
    const hit = items.find((o) => o.id !== item.id && (o.side || null) === (item.side || null) && overlaps(o, probe));
    return hit ? 'collide' : true;
  }
  function place(grid, items, item, start, row, opts) {
    if (row && typeof row === 'object') { opts = row; row = null; }   // place(grid, items, item, start, {shove})
    opts = opts || {}; row = row == null ? (item.row || 0) : row;
    const ok = canPlace(grid, items, item, start, row);
    if (ok === true) return items.filter((o) => o.id !== item.id).concat([{ ...item, start, row }]);
    if (ok === 'out' || !opts.shove) return null;
    // shove: the dropped item is fixed; any neighbour it overlaps is pushed away (in the direction it already sits, the
    // other way if that hits the edge), and pushed items push in turn — settled when nothing overlaps; refused when a
    // locked item is in the way or something would leave the grid.
    const moved = { ...item, start, row };
    let next = items.filter((o) => o.id !== item.id).map((o) => ({ ...o }));
    const same = (o) => (o.side || null) === (item.side || null) && (o.row || 0) === row;
    const fits = (o, st) => st >= 0 && st + o.size <= grid.size;
    const rank = { [moved.id]: 0 }; let seq = 1; let guard = next.length * 8 + 8;   // rank: who settled first wins a clash
    let all = next.concat([moved]);
    while (guard-- > 0) {
      let conflict = null;
      for (const p of all) { if (rank[p.id] == null) continue; for (const o of all) { if (o === p || !same(o) || !same(p) || !overlaps(o, p)) continue; if (rank[o.id] != null && rank[o.id] < rank[p.id]) continue; conflict = [p, o]; break; } if (conflict) break; }
      if (!conflict) return all;
      const [p, o] = conflict; if (o.locked) return null;
      const goUp = (o.start + o.size / 2) >= (p.start + p.size / 2);
      // slide o past p AND every already-settled item in that direction (so pushed items never bounce back)
      const clear = (st) => fits(o, st) && !all.some((q) => q !== o && rank[q.id] != null && same(q) && overlaps(q, { ...o, start: st }));
      const scan = (dir) => { let st = dir > 0 ? p.start + p.size : p.start - o.size; while (fits(o, st)) { if (clear(st)) return st; st += dir; } return null; };
      let pick = scan(goUp ? 1 : -1); if (pick == null) pick = scan(goUp ? -1 : 1);
      if (pick == null) return null;
      o.start = pick; rank[o.id] = seq++;
    }
    return null;
  }
  // first-fit; vertical racks fill from the bottom, heaviest first (weightRank: higher = heavier); optional gap after items with .vent
  function autoLayout(grid, items, opts) {
    opts = opts || {};
    const fixed = items.filter((i) => i.locked); let out = fixed.map((i) => ({ ...i }));
    const loose = items.filter((i) => !i.locked).slice().sort((a, b) => (b.weightRank || 0) - (a.weightRank || 0) || b.size - a.size || String(a.label || a.id).localeCompare(String(b.label || b.id)));
    for (const it of loose) {
      let done = false;
      for (let row = 0; row < (grid.rows || 1) && !done; row++) {
        for (let s = 0; s + it.size <= grid.size && !done; s++) {
          if (canPlace(grid, out, it, s, row) === true) { out.push({ ...it, start: s, row }); if (it.vent && opts.ventGap !== false && s + it.size < grid.size) out.push({ id: '__gap_' + it.id, start: s + it.size, size: 1, row, kind: 'gap', ghostOnly: true }); done = true; }
        }
      }
      if (!done) out.push({ ...it, start: -1, row: 0, unplaced: true });
    }
    return out.filter((i) => !i.ghostOnly);
  }
  function stats(grid, items) {
    const perRow = []; let used = 0;
    for (let r = 0; r < (grid.rows || 1); r++) { const its = items.filter((i) => i.row === r && !i.unplaced); const u = its.reduce((s, i) => s + i.size, 0); used += u; perRow.push({ row: r, used: u, free: grid.size - u, items: its.length }); }
    return { used, free: (grid.rows || 1) * grid.size - used, perRow, unplaced: items.filter((i) => i.unplaced).length };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // SVG: unit = px per slot; vertical = U stacked bottom-up; horizontal = rows of TE left-to-right
  function toSvg(grid, items, opts) {
    opts = opts || {}; const unit = opts.unit || grid.unit || 20, V = grid.orientation !== 'horizontal';
    const w = V ? (opts.width || 300) : grid.size * unit, rowH = V ? grid.size * unit : (opts.rowHeight || unit * 3), gap = V ? 0 : (opts.rowGap || unit);
    const h = V ? rowH : (grid.rows || 1) * (rowH + gap) - gap, pad = opts.pad == null ? 24 : opts.pad;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}" font-family="DM Sans, system-ui, sans-serif" font-size="9">`;
    s += `<rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="${opts.frame || '#1A1F28'}" rx="4"/>`;
    for (let r = 0; r < (grid.rows || 1); r++) {
      const oy = pad + (V ? 0 : r * (rowH + gap));
      for (let k = 0; k < grid.size; k++) {
        if (V) { const y = oy + (grid.size - 1 - k) * unit; s += `<line x1="${pad}" y1="${y}" x2="${pad + w}" y2="${y}" stroke="rgba(255,255,255,.08)"/><text x="${pad - 4}" y="${y + unit - 5}" text-anchor="end" fill="#64748B">${k + (opts.labelOrigin == null ? 1 : opts.labelOrigin)}</text>`; }
        else { const x = pad + k * unit; s += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + rowH}" stroke="rgba(255,255,255,.08)"/>`; }
      }
      if (!V) s += `<rect x="${pad}" y="${oy + rowH / 2 - 3}" width="${w}" height="6" fill="#94A3B8"/>`;   // the DIN rail
    }
    items.filter((i) => !i.unplaced).forEach((i) => {
      const r = i.row || 0, oy = pad + (V ? 0 : r * (rowH + gap));
      const x = V ? pad + 2 : pad + i.start * unit + 1, y = V ? oy + (grid.size - i.start - i.size) * unit + 1 : oy + 2;
      const iw = V ? w - 4 : i.size * unit - 2, ih = V ? i.size * unit - 2 : rowH - 4;
      s += `<g><rect x="${x}" y="${y}" width="${iw}" height="${ih}" rx="2" fill="${i.colour || '#334155'}" stroke="rgba(0,0,0,.35)"/>`;
      s += `<text x="${x + 6}" y="${y + Math.min(ih, 14)}" fill="#F4F5F8" font-weight="700">${esc(i.label || i.id)}</text>`;
      if (i.sub && ih > 22) s += `<text x="${x + 6}" y="${y + Math.min(ih - 4, 26)}" fill="#CBD5E1">${esc(i.sub)}</text>`;
      s += `</g>`;
    });
    return s + '</svg>';
  }

  // ── element ──────────────────────────────────────────────────────────────────────────────────────────────────
  const CSS = `
:host{display:block;--unit:22px;--rail:#94A3B8;--frame:var(--surface-deep,#151A22);--slot:rgba(255,255,255,.04);--slot-line:rgba(255,255,255,.08);--ink:var(--surface-text,#F4F5F8);--muted:#8E96A3;--accent:var(--accent,#2d718b);--ok:#22C55E;--bad:#DC2626;--dur:var(--dur-fast,120ms);--ease:var(--ease,cubic-bezier(.2,.7,.2,1));--r:var(--r-sm,4px);font:12px/1.3 var(--font-ui,'DM Sans',system-ui,sans-serif);color:var(--ink);user-select:none;-webkit-user-select:none;touch-action:none;position:relative}
:host([hidden]){display:none}
.wrap{display:flex;gap:8px;align-items:flex-start}
.frame{position:relative;background:var(--frame);border-radius:var(--r-md,6px);padding:6px;box-shadow:var(--shadow-md,0 6px 18px rgba(15,23,42,.14));outline:2px solid transparent;transition:outline-color var(--dur) var(--ease)}
.frame[data-over=valid]{outline-color:var(--ok)}.frame[data-over=invalid]{outline-color:var(--bad)}
.labels{display:grid;color:var(--muted);font-size:10px;text-align:right;padding:6px 0}
.labels span{height:var(--unit);line-height:var(--unit);padding-right:4px}
.row{display:grid;position:relative;background:var(--slot);border-radius:var(--r)}
.row.v{grid-template-rows:repeat(var(--size),var(--unit));grid-template-columns:1fr;width:var(--width,260px)}
.row.h{grid-template-columns:repeat(var(--size),var(--unit));grid-template-rows:var(--row-h,66px);margin-bottom:var(--row-gap,10px)}
.row.h::after{content:"";position:absolute;left:0;right:0;top:50%;height:6px;margin-top:-3px;background:var(--rail);opacity:.7;pointer-events:none;border-radius:2px}
.slot{border:0 solid var(--slot-line);position:relative}
.row.v .tile{grid-column:1}.row.h .tile{grid-row:1}
.row.v .slot{border-top-width:1px}.row.h .slot{border-left-width:1px}
.slot[data-state=hover]{background:rgba(255,255,255,.08)}.slot[data-state=valid]{background:rgba(34,197,94,.22)}.slot[data-state=invalid]{background:repeating-linear-gradient(45deg,rgba(220,38,38,.25) 0 4px,transparent 4px 8px)}
.tile{position:relative;z-index:1;margin:1px;border-radius:var(--r);background:var(--tile,#334155);color:#F4F5F8;padding:3px 6px;overflow:hidden;cursor:grab;display:flex;flex-direction:column;justify-content:center;gap:1px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 1px 2px rgba(0,0,0,.35);transition:transform var(--dur) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease);outline:none}
.tile b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
.tile small{font-size:9.5px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .ears{position:absolute;inset:0;pointer-events:none;border-left:3px solid rgba(0,0,0,.35);border-right:3px solid rgba(0,0,0,.35);border-radius:inherit}
.tile .led{position:absolute;right:8px;top:6px;width:5px;height:5px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok)}
.tile[data-state=hover]{box-shadow:0 0 0 2px var(--accent),0 6px 16px rgba(0,0,0,.4);transform:translateY(-1px)}
.tile[data-state=selected]{box-shadow:0 0 0 2px #F5D05C,0 6px 16px rgba(0,0,0,.4)}
.tile[data-state=dragging]{opacity:.35;cursor:grabbing}
.tile[data-narrow]{padding:2px 0;align-items:center;justify-content:flex-start}.tile[data-narrow] b{writing-mode:vertical-rl;transform:rotate(180deg);font-size:9.5px;letter-spacing:.02em;max-height:calc(100% - 8px)}.tile[data-narrow] small{display:none}
.tile[data-locked]{cursor:default}.tile[data-locked]::after{content:"🔒";position:absolute;right:6px;bottom:4px;font-size:9px;opacity:.7}
.tile .img{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.9;pointer-events:none}
.tile .img+b,.tile .img+b+small{position:relative;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.ghost{position:fixed;z-index:9999;pointer-events:none;border-radius:var(--r);background:var(--tile,#334155);color:#fff;padding:3px 6px;font-size:11px;font-weight:700;box-shadow:0 12px 32px rgba(0,0,0,.45);opacity:.92;transform:translate(-50%,-50%) scale(1.02);outline:2px solid transparent}
.ghost[data-valid=no]{outline-color:var(--bad);background:#7f1d1d}
.stats{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary,#475161);margin-top:6px}.stats b{color:var(--text-primary,#1A1F28)}
.stats i{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--accent);margin-right:4px;vertical-align:-1px}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;pointer-events:none}
@media (prefers-reduced-motion:reduce){.tile,.frame,.ghost{transition:none}}`;

  const Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};   // node (unit tests) has no DOM — the pure model still loads
  class SonorSlotGrid extends Base {
    static get observedAttributes() { return ['orientation', 'rows', 'size', 'unit', 'label-origin', 'readonly', 'shove', 'snap', 'width', 'row-height']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._items = []; this._sel = new Set(); this._hist = []; this._redo = []; this._drag = null; this._hover = null;
      this.rules = null; this.renderItem = null; this.stats = () => stats(this.grid, this._items);
      this._onKey = this._onKey.bind(this);
    }
    get grid() { return { orientation: this.getAttribute('orientation') || 'vertical', rows: Number(this.getAttribute('rows')) || 1, size: Number(this.getAttribute('size')) || 42, unit: Number(this.getAttribute('unit')) || 22 }; }
    get items() { return this._items.map((i) => ({ ...i })); }
    set items(v) { this._items = Array.isArray(v) ? v.map((i) => ({ row: 0, ...i })) : []; this._hist = []; this._redo = []; this.render(); }
    get selection() { return Array.from(this._sel); }
    connectedCallback() { this.setAttribute('tabindex', this.getAttribute('tabindex') || '0'); this.addEventListener('keydown', this._onKey); this.render(); }
    disconnectedCallback() { this.removeEventListener('keydown', this._onKey); }
    attributeChangedCallback() { if (this.shadowRoot) this.render(); }

    // ── public API ──
    commit(items, reason) { this._hist.push(this._items); if (this._hist.length > 100) this._hist.shift(); this._redo = []; this._items = items; this.render(); this._emit('sonor:change', { items: this.items, stats: this.stats(), reason: reason || 'edit' }); }
    undo() { if (!this._hist.length) return false; this._redo.push(this._items); this._items = this._hist.pop(); this.render(); this._emit('sonor:change', { items: this.items, stats: this.stats(), reason: 'undo' }); return true; }
    redo() { if (!this._redo.length) return false; this._hist.push(this._items); this._items = this._redo.pop(); this.render(); this._emit('sonor:change', { items: this.items, stats: this.stats(), reason: 'redo' }); return true; }
    select(ids, opts) { const arr = Array.isArray(ids) ? ids : (ids == null ? [] : [ids]); if (!(opts && opts.add)) this._sel.clear(); arr.forEach((id) => this._sel.add(id)); this.render(); this._emit('sonor:select', { ids: this.selection }); }
    remove(ids) { const arr = Array.isArray(ids) ? ids : [ids]; if (!arr.length) return; this.commit(this._items.filter((i) => !arr.includes(i.id)), 'remove'); arr.forEach((id) => this._sel.delete(id)); }
    autoLayout(opts) { this.commit(autoLayout(this.grid, this._items, opts), 'auto-layout'); }
    canPlace(item, start, row) { const base = canPlace(this.grid, this._items, item, start, row); if (base !== true) return base; if (this.rules && typeof this.rules.canPlace === 'function') { const r = this.rules.canPlace(item, start, row, this.items); if (r !== true && r !== undefined) return r || 'rule'; } return true; }
    toSvg(opts) { return toSvg(this.grid, this._items, Object.assign({ labelOrigin: Number(this.getAttribute('label-origin') || 1) }, opts || {})); }
    // start a drag from any external palette: item = template (no start yet); ev = the pointerdown event
    beginExternalDrag(item, ev) { if (this.hasAttribute('readonly')) return; this._startDrag({ ...item, row: item.row || 0, start: item.start == null ? -1 : item.start }, ev, true); }

    // ── render ──
    render() {
      const g = this.grid, V = g.orientation !== 'horizontal', root = this.shadowRoot, origin = Number(this.getAttribute('label-origin') || 1);
      if (!root.querySelector('style')) { const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); const wrap = document.createElement('div'); wrap.className = 'wrap'; wrap.innerHTML = '<div class="labels"></div><div class="frame"></div>'; root.appendChild(wrap); const stt = document.createElement('div'); stt.className = 'stats'; root.appendChild(stt); this._wire(); }
      const frame = root.querySelector('.frame'), labels = root.querySelector('.labels');
      this.style.setProperty('--unit', g.unit + 'px'); this.style.setProperty('--size', g.size);
      if (this.getAttribute('width')) this.style.setProperty('--width', this.getAttribute('width') + 'px');
      if (this.getAttribute('row-height')) this.style.setProperty('--row-h', this.getAttribute('row-height') + 'px');
      labels.style.display = V ? '' : 'none';
      if (V) labels.innerHTML = Array.from({ length: g.size }, (_, k) => `<span>${g.size - k - 1 + origin}</span>`).join('');
      let h = '';
      for (let r = 0; r < g.rows; r++) {
        h += `<div class="row ${V ? 'v' : 'h'}" data-row="${r}">`;
        for (let k = 0; k < g.size; k++) { const slot = V ? g.size - 1 - k : k; h += `<div class="slot" data-slot="${slot}" data-row="${r}" style="grid-${V ? 'row' : 'column'}:${k + 1}"></div>`; }
        this._items.filter((i) => (i.row || 0) === r && !i.unplaced).forEach((i) => {
          const a = V ? g.size - i.start - i.size + 1 : i.start + 1;
          const st = this._drag && this._drag.item.id === i.id ? 'dragging' : (this._sel.has(i.id) ? 'selected' : 'idle');
          h += `<div class="tile" role="option" tabindex="-1" aria-label="${esc((i.label || i.id) + ', ' + (V ? 'U ' : 'position ') + (i.start + origin) + (i.size > 1 ? ' to ' + (i.start + i.size - 1 + origin) : ''))}" data-id="${esc(i.id)}" data-state="${st}" ${i.locked ? 'data-locked' : ''}${!V && i.size * g.unit < 40 ? ' data-narrow' : ''} style="grid-${V ? 'row' : 'column'}:${a}/span ${i.size};${i.colour ? '--tile:' + i.colour : ''}">${this._tileHtml(i)}</div>`;
        });
        h += '</div>';
      }
      if (!this._items.length && !this.hasAttribute('readonly')) h += '<div class="empty">Drop items here</div>';
      frame.innerHTML = h;
      const s = this.stats(); root.querySelector('.stats').innerHTML = (g.rows > 1 ? s.perRow.map((p) => `<span><i></i>Row ${p.row + 1}: <b>${p.used}</b>/${g.size}</span>`).join('') : '') + `<span>Used <b>${s.used}</b> · free <b>${s.free}</b>${s.unplaced ? ` · <b style="color:var(--bad)">${s.unplaced} unplaced</b>` : ''}</span>`;
    }
    _tileHtml(i) {
      if (typeof this.renderItem === 'function') { const r = this.renderItem(i); if (r instanceof HTMLElement) return r.outerHTML; if (typeof r === 'string') return r; }
      return (i.image ? `<div class="img" style="background-image:url('${esc(i.image)}')"></div>` : '') + `<b>${esc(i.label || i.id)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}${i.kind === 'device' || i.kind === 'rack' ? '<div class="ears"></div><div class="led"></div>' : ''}`;
    }
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }

    // ── interaction ──
    _wire() {
      const frame = this.shadowRoot.querySelector('.frame');
      frame.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 && ev.pointerType === 'mouse') return;
        const tile = ev.target.closest('.tile'); if (!tile) { if (!ev.shiftKey) this.select([]); return; }
        const item = this._items.find((i) => i.id === tile.dataset.id); if (!item) return;
        if (ev.shiftKey) { this.select(item.id, { add: !this._sel.has(item.id) }); return; }
        if (!this._sel.has(item.id)) this.select(item.id);
        if (item.locked || this.hasAttribute('readonly')) return;
        this._startDrag(item, ev, false);
      });
      frame.addEventListener('dblclick', (ev) => { const tile = ev.target.closest('.tile'); if (!tile) return; const item = this._items.find((i) => i.id === tile.dataset.id); if (item) this._emit('sonor:activate', { item: { ...item } }); });
      frame.addEventListener('pointerover', (ev) => { const tile = ev.target.closest('.tile'); if (this._drag) return; frame.querySelectorAll('.tile[data-state=hover]').forEach((t) => t.dataset.state = this._sel.has(t.dataset.id) ? 'selected' : 'idle'); if (tile && tile.dataset.state === 'idle') tile.dataset.state = 'hover'; const slot = ev.target.closest('.slot'); const hs = slot ? { slot: Number(slot.dataset.slot), row: Number(slot.dataset.row) } : null; if (JSON.stringify(hs) !== JSON.stringify(this._hover)) { this._hover = hs; this._emit('sonor:hover', hs); } });
      frame.addEventListener('pointerleave', () => { if (this._drag) return; frame.querySelectorAll('.tile[data-state=hover]').forEach((t) => t.dataset.state = this._sel.has(t.dataset.id) ? 'selected' : 'idle'); if (this._hover) { this._hover = null; this._emit('sonor:hover', null); } });
    }
    _slotAt(clientX, clientY) {
      const g = this.grid, V = g.orientation !== 'horizontal';
      const rows = Array.from(this.shadowRoot.querySelectorAll('.row'));
      for (const rowEl of rows) {
        const rc = rowEl.getBoundingClientRect(); const row = Number(rowEl.dataset.row);
        const inside = V ? (clientX >= rc.left - 40 && clientX <= rc.right + 40) : (clientY >= rc.top - 6 && clientY <= rc.bottom + 6);
        if (!inside) continue;
        if (V) { const k = Math.floor((clientY - rc.top) / g.unit); if (k < -1 || k > g.size) continue; return { row, slot: g.size - 1 - Math.max(0, Math.min(g.size - 1, k)) }; }
        const k = Math.floor((clientX - rc.left) / g.unit); if (k < -1 || k > g.size) continue; return { row, slot: Math.max(0, Math.min(g.size - 1, k)) };
      }
      return null;
    }
    _startDrag(item, ev, external) {
      ev.preventDefault();
      const g = this.grid, V = g.orientation !== 'horizontal';
      const ghost = document.createElement('div'); ghost.className = 'ghost'; ghost.textContent = item.label || item.id;
      ghost.style.width = (V ? (this.shadowRoot.querySelector('.row') ? this.shadowRoot.querySelector('.row').getBoundingClientRect().width - 4 : 200) : item.size * g.unit - 2) + 'px';
      ghost.style.height = (V ? item.size * g.unit - 2 : (this.shadowRoot.querySelector('.row') ? this.shadowRoot.querySelector('.row').getBoundingClientRect().height - 4 : 60)) + 'px';
      if (item.colour) ghost.style.setProperty('--tile', item.colour);
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      this.shadowRoot.appendChild(ghost);
      // grab offset so the tile keeps its position under the pointer
      const tileEl = external ? null : this.shadowRoot.querySelector(`.tile[data-id="${CSS_escape(item.id)}"]`);
      let offset = 0; if (tileEl) { const r = tileEl.getBoundingClientRect(); offset = V ? Math.floor((ev.clientY - r.top) / g.unit) : Math.floor((ev.clientX - r.left) / g.unit); }
      this._drag = { item, ghost, external, offset, target: null, valid: false, alt: !!ev.altKey };
      this.render();
      const snap = Math.max(1, Number(this.getAttribute('snap')) || 1);
      const move = (e) => {
        const d = this._drag; if (!d) return; d.alt = !!e.altKey;
        ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
        const at = this._slotAt(e.clientX, e.clientY);
        this.shadowRoot.querySelectorAll('.slot[data-state]').forEach((s) => s.removeAttribute('data-state'));
        const frame = this.shadowRoot.querySelector('.frame');
        if (!at) { d.target = null; d.valid = false; ghost.dataset.valid = 'no'; frame.removeAttribute('data-over'); return; }
        let start = V ? at.slot - (item.size - 1 - d.offset) : at.slot - d.offset;   // vertical: pointer slot is near the TOP of the tile
        start = Math.round(start / snap) * snap; start = Math.max(0, Math.min(g.size - item.size, start));
        const ok = this.canPlace(item, start, at.row);
        const valid = ok === true || (ok === 'collide' && (d.alt || this.hasAttribute('shove')));
        d.target = { start, row: at.row }; d.valid = valid; d.why = ok;
        ghost.dataset.valid = valid ? 'yes' : 'no'; frame.dataset.over = valid ? 'valid' : 'invalid';
        for (let k = start; k < start + item.size; k++) { const s = this.shadowRoot.querySelector(`.slot[data-row="${at.row}"][data-slot="${k}"]`); if (s) s.dataset.state = valid ? 'valid' : 'invalid'; }
      };
      const end = (e) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc);
        const d = this._drag; this._drag = null; ghost.remove();
        this.shadowRoot.querySelectorAll('.slot[data-state]').forEach((s) => s.removeAttribute('data-state')); this.shadowRoot.querySelector('.frame').removeAttribute('data-over');
        if (!d || !d.target || e.type === 'pointercancel') { this.render(); return; }
        if (!d.valid) { this.render(); this._emit('sonor:refused', { item: { ...item }, start: d.target.start, row: d.target.row, why: d.why }); return; }
        const next = place(g, this._items, item, d.target.start, d.target.row, { shove: d.alt || this.hasAttribute('shove') });
        if (!next) { this.render(); this._emit('sonor:refused', { item: { ...item }, start: d.target.start, row: d.target.row, why: 'shove-blocked' }); return; }
        if (d.external) this.select(item.id);
        this.commit(next, d.external ? 'add' : 'move');
      };
      const cancel = (e) => end({ type: 'pointercancel' });
      const esc = (e) => { if (e.key === 'Escape') cancel(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc);
      move(ev);
    }
    _onKey(e) {
      if (this.hasAttribute('readonly')) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (!this._sel.size) return;
      const ids = this.selection; const g = this.grid, V = g.orientation !== 'horizontal';
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(ids.filter((id) => { const i = this._items.find((x) => x.id === id); return i && !i.locked; })); return; }
      if (e.key === 'Enter') { const it = this._items.find((i) => i.id === ids[0]); if (it) this._emit('sonor:activate', { item: { ...it } }); return; }
      const dir = { ArrowUp: V ? 1 : 0, ArrowDown: V ? -1 : 0, ArrowLeft: V ? 0 : -1, ArrowRight: V ? 0 : 1 }[e.key];
      const rowDir = { ArrowUp: V ? 0 : -1, ArrowDown: V ? 0 : 1 }[e.key] || 0;
      if (dir === undefined && !rowDir) return;
      e.preventDefault();
      let items = this._items; const step = e.shiftKey ? 5 : 1;
      for (const id of ids) { const it = items.find((i) => i.id === id); if (!it || it.locked) continue; const next = place(g, items, it, it.start + (dir || 0) * step, (it.row || 0) + rowDir, { shove: e.altKey }); if (next) items = next; }
      if (items !== this._items) this.commit(items, 'nudge');
    }
  }
  function CSS_escape(s) { return (global.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'); }

  if (typeof customElements !== 'undefined' && !customElements.get('sonor-slot-grid')) customElements.define('sonor-slot-grid', SonorSlotGrid);
  global.SonorSlotGrid = { VERSION, canPlace, place, autoLayout, stats, toSvg, overlaps, Element: SonorSlotGrid };
})(typeof window !== 'undefined' ? window : globalThis);
