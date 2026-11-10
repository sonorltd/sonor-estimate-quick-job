// sonor-overwrite-guard.js — CANONICAL MASTER (Spine v1.2 §15 sibling)
//
// Generic overwrite-guard primitive. Use this whenever a Sonor app is about to
// land structured data (CSV import, WQ API pull, cross-app push, scheduled
// sync, JSON paste, file drop) into rows that may already hold values.
//
// Policy (Sonor CAD principle: explicit > silent on data loss):
//   - blank cells   → auto-fill (no friction, no surprises)
//   - matching cells → no-op
//   - filled cells with a different incoming value → require explicit user
//     choice via a modal dialog with three apply modes:
//       1. Only fill blanks  (safe default, never destroys data)
//       2. Overwrite all     (one-click bulk, with secondary confirm)
//       3. Review each       (per-cell Keep/Replace toggles)
//
// Direct in-grid edits BYPASS this guard — the user typed the value, intent
// is clear. The guard exists for inbound bulk operations where the operator
// may not have seen every cell that's about to change.
//
// Propagated to `APP - */data/sonor-overwrite-guard.js` by sync-everything.sh
// (S-4.2). NEVER hand-edit per-app copies — edit this master and re-sync.
//
// Namespace: window.SonorOverwriteGuard
//
// Usage:
//   <script src="data/sonor-overwrite-guard.js"></script>
//   <script>
//     SonorOverwriteGuard.run({
//       incoming: [{ block_code: 'CL-...', label: 'New', glyph: 'X' }, ...],
//       current:  [{ block_code: 'CL-...', label: 'Old', glyph: '●' }, ...],
//       keyField: 'block_code',
//       source:   'CSV import (152 rows)',
//       onApply:  async (patches) => { await SonorLibrary.save(patches); }
//     });
//   </script>
//
// The modal HTML auto-mounts to <body> on first run if a host hasn't already
// provided #sonorGuardModal. To use a custom modal DOM, pass { modalId: 'myId' }
// to mount() before the first run().
//
// Exports:
//   mount(opts?)       — { modalId? } — pre-mount with a custom DOM hook (optional)
//   run(opts)          — { incoming, current, keyField, source, onApply, autoApplyIfNoOverwrites? }
//   isBlank(v)         — null/empty helper (mirrors SonorLibrary.isBlank)

window.SONOR_OVERWRITE_GUARD_VERSION = '1.0.0';
window.SonorOverwriteGuard = window.SonorOverwriteGuard || {};

(function (SG) {
  'use strict';

  const DEFAULT_MODAL_ID = 'sonorGuardModal';
  const state = {
    modalId:    DEFAULT_MODAL_ID,
    mounted:    false,
    guardState: null,   // { incoming, fills[], overwrites[], newRows[], onApply, source }
    nodes:      null    // cached DOM refs once mounted
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  SG.isBlank = function (v) {
    return v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Modal DOM (auto-mounts to <body> if host hasn't provided it) ──────────
  // Style hooks: .modal-overlay, .modal, .guard-dialog-head, .guard-summary
  // .tile.fill, .tile.overwrite, .num, .lbl, .guard-review-list,
  // .guard-review-row, .guard-actions, .primary, .warn — these match the
  // sonor-components.css selectors so any host that links the shared CSS gets
  // the correct visuals automatically.
  const MODAL_HTML = function (id) { return `
<div class="modal-overlay" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
  <div class="modal" style="width: min(720px, 92vw);">
    <div class="guard-dialog-head">
      <h2 id="${id}-title">Review incoming changes</h2>
      <div class="sub" id="${id}-sub">Some rows already have values. Choose how to apply the incoming data.</div>
    </div>
    <div class="guard-summary">
      <div class="tile fill">
        <div class="num" id="${id}-fillNum">0</div>
        <div class="lbl">Blank cells → will fill</div>
      </div>
      <div class="tile overwrite">
        <div class="num" id="${id}-overNum">0</div>
        <div class="lbl">Cells with existing data → overwrite?</div>
      </div>
    </div>
    <div class="guard-review-list" id="${id}-reviewList" style="display:none;"></div>
    <div class="guard-actions">
      <button id="${id}-cancel">Cancel</button>
      <button id="${id}-review">Review each →</button>
      <button id="${id}-fillBlanks" class="primary">Only fill blanks</button>
      <button id="${id}-overwriteAll" class="warn">Overwrite all</button>
    </div>
  </div>
</div>`;
  };

  function _ensureMounted() {
    if (state.mounted) return state.nodes;
    let modal = document.getElementById(state.modalId);
    if (!modal) {
      const wrap = document.createElement('div');
      wrap.innerHTML = MODAL_HTML(state.modalId);
      document.body.appendChild(wrap.firstElementChild);
      modal = document.getElementById(state.modalId);
    }
    const id = state.modalId;
    // Resolve nodes — supports both the auto-mounted IDs (prefixed) and the
    // legacy host-provided IDs (unprefixed: guardTitle, guardSub, etc.) so
    // existing apps that already wrote the modal inline still work.
    const pick = (suffix, legacy) =>
      document.getElementById(id + '-' + suffix) || document.getElementById(legacy);
    state.nodes = {
      modal:        modal,
      title:        pick('title',        'guardTitle'),
      sub:          pick('sub',          'guardSub'),
      fillNum:      pick('fillNum',      'guardFillNum'),
      overNum:      pick('overNum',      'guardOverNum'),
      reviewList:   pick('reviewList',   'guardReviewList'),
      btnCancel:    pick('cancel',       'btnGuardCancel'),
      btnReview:    pick('review',       'btnGuardReview'),
      btnFill:      pick('fillBlanks',   'btnGuardFillBlanks'),
      btnOverwrite: pick('overwriteAll', 'btnGuardOverwriteAll')
    };
    _wireButtons();
    state.mounted = true;
    return state.nodes;
  }

  function _wireButtons() {
    const n = state.nodes;
    n.btnCancel.onclick = () => _close();
    n.btnFill.onclick = async () => {
      const toWrite = _buildWrites({ mode: 'fills-only' });
      _close();
      if (state.guardState && state.guardState.onApply) await state.guardState.onApply(toWrite);
    };
    n.btnOverwrite.onclick = async () => {
      const o = state.guardState.overwrites.length;
      if (!confirm('Overwrite ' + o + ' existing cell' + (o === 1 ? '' : 's') + '? This cannot be undone.')) return;
      const toWrite = _buildWrites({ mode: 'overwrite-all' });
      _close();
      if (state.guardState && state.guardState.onApply) await state.guardState.onApply(toWrite);
    };
    n.btnReview.onclick = _renderReview;
  }

  function _close() {
    if (state.nodes && state.nodes.modal) state.nodes.modal.classList.remove('open');
  }

  // ── Public: mount (optional pre-init with custom modal id) ────────────────
  SG.mount = function (opts) {
    opts = opts || {};
    if (opts.modalId) state.modalId = opts.modalId;
    _ensureMounted();
    return SG;
  };

  // ── Public: run the guard ─────────────────────────────────────────────────
  // opts:
  //   incoming:  array of objects keyed by `keyField`
  //   current:   array of current rows keyed by `keyField`
  //   keyField:  string key to match incoming↔current (default 'block_code')
  //   source:    short label shown in dialog header (e.g. 'CSV import')
  //   onApply:   async (patches) => void  — called with the patches the user accepted
  //   autoApplyIfNoOverwrites: bool — if true and no overwrites, skip dialog (default false)
  SG.run = function (opts) {
    const n = _ensureMounted();
    const incoming = opts.incoming || [];
    const current  = opts.current  || [];
    const keyField = opts.keyField || 'block_code';
    const source   = opts.source   || 'inbound data';

    const byKey = new Map(current.map(r => [r[keyField], r]));
    const fills = [];      // { key, field, newVal }
    const overwrites = []; // { key, field, curVal, newVal }
    const newRows = [];    // rows whose key isn't in `current`

    incoming.forEach(row => {
      const existing = byKey.get(row[keyField]);
      if (!existing) { newRows.push(row); return; }
      Object.keys(row).forEach(field => {
        if (field === keyField) return;
        const newVal = row[field];
        const curVal = existing[field];
        if (newVal === undefined) return;
        if (SG.isBlank(newVal) && SG.isBlank(curVal)) return;
        if (!SG.isBlank(newVal) && !SG.isBlank(curVal) && String(newVal) === String(curVal)) return;
        if (SG.isBlank(curVal)) {
          fills.push({ key: row[keyField], field, newVal });
        } else {
          overwrites.push({ key: row[keyField], field, curVal, newVal });
        }
      });
    });

    state.guardState = { incoming, fills, overwrites, newRows, onApply: opts.onApply, source, keyField };

    // No diff? Apply silently (or no-op).
    if (overwrites.length === 0 && fills.length === 0 && newRows.length === 0) {
      if (opts.onApply) opts.onApply([]);
      return { tier: 'no-op', fills: 0, overwrites: 0, newRows: 0 };
    }

    // Auto-apply path: caller asked, and there's nothing to confirm.
    if (overwrites.length === 0 && opts.autoApplyIfNoOverwrites) {
      const toWrite = _buildWrites({ mode: 'fills-only' });
      if (opts.onApply) opts.onApply(toWrite);
      return { tier: 'auto-apply', fills: fills.length, overwrites: 0, newRows: newRows.length };
    }

    // Populate header / summary
    n.title.textContent = 'Review incoming changes — ' + source;
    const subParts = [];
    if (newRows.length) subParts.push(newRows.length + ' new ' + (newRows.length === 1 ? 'row' : 'rows') + ' will be inserted');
    subParts.push(fills.length + ' blank cell' + (fills.length === 1 ? '' : 's') + ' will auto-fill');
    subParts.push(overwrites.length + ' cell' + (overwrites.length === 1 ? '' : 's') + ' already have values');
    n.sub.textContent = subParts.join(' · ');
    n.fillNum.textContent = fills.length + (newRows.length ? ' +' + newRows.length + ' new' : '');
    n.overNum.textContent = overwrites.length;

    // Reset button visibility from any prior Review-each state
    n.reviewList.style.display = 'none';
    n.reviewList.innerHTML = '';
    n.btnFill.style.display = '';
    n.btnOverwrite.style.display = '';
    n.btnReview.style.display = '';
    n.btnReview.textContent = 'Review each →';
    n.btnReview.onclick = _renderReview;

    if (overwrites.length === 0) {
      // Only blanks/new — still show summary, but one-click apply
      n.btnReview.style.display = 'none';
      n.btnOverwrite.style.display = 'none';
      const toWrite = _buildWrites({ mode: 'fills-only' });
      n.btnFill.textContent = 'Apply (' + toWrite.length + ' rows)';
    } else {
      n.btnFill.textContent = 'Only fill blanks';
    }

    n.modal.classList.add('open');
    return { tier: 'dialog', fills: fills.length, overwrites: overwrites.length, newRows: newRows.length };
  };

  // ── Build the patch list based on apply mode ──────────────────────────────
  function _buildWrites(opts) {
    const mode = opts.mode;        // 'fills-only' | 'overwrite-all' | 'review'
    const keep = opts.keep;        // for 'review': array aligned to overwrites[]
    const gs   = state.guardState;
    const kf   = gs.keyField;
    const patches = new Map();

    const patchFor = (key) => {
      if (!patches.has(key)) {
        const seed = {}; seed[kf] = key;
        patches.set(key, seed);
      }
      return patches.get(key);
    };

    // Always include new rows + blank-fills
    gs.newRows.forEach(r => Object.assign(patchFor(r[kf]), r));
    gs.fills.forEach(f => { patchFor(f.key)[f.field] = f.newVal; });

    if (mode === 'overwrite-all') {
      gs.overwrites.forEach(o => { patchFor(o.key)[o.field] = o.newVal; });
    } else if (mode === 'review') {
      gs.overwrites.forEach((o, i) => {
        if (keep && keep[i] === 'replace') patchFor(o.key)[o.field] = o.newVal;
      });
    }
    return Array.from(patches.values());
  }

  // ── Review-each per-cell UI ───────────────────────────────────────────────
  function _renderReview() {
    const n  = state.nodes;
    const gs = state.guardState;
    const keep = gs.overwrites.map(() => 'keep');
    n.reviewList.innerHTML = gs.overwrites.map((o, i) => `
      <div class="guard-review-row" data-i="${i}">
        <div class="field">${escapeHtml(o.key)}<br><span style="color:var(--muted); font-weight:400;">${escapeHtml(o.field)}</span></div>
        <div class="cur" title="Current value">${escapeHtml(String(o.curVal))}</div>
        <div class="new" title="Incoming value">→ ${escapeHtml(String(o.newVal))}</div>
        <div class="actions">
          <button class="keep on" data-act="keep">Keep</button>
          <button class="replace" data-act="replace">Replace</button>
        </div>
      </div>
    `).join('');
    n.reviewList.style.display = '';
    n.reviewList.onclick = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('.guard-review-row');
      const i = +row.dataset.i;
      keep[i] = btn.dataset.act;
      row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.act === keep[i]));
    };
    n.btnFill.style.display = 'none';
    n.btnOverwrite.style.display = 'none';
    n.btnReview.textContent = 'Apply review';
    n.btnReview.onclick = async () => {
      const toWrite = _buildWrites({ mode: 'review', keep });
      _close();
      if (gs.onApply) await gs.onApply(toWrite);
    };
  }

})(window.SonorOverwriteGuard);
