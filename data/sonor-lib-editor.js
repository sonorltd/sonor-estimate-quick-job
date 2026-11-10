// sonor-lib-editor.js — CANONICAL MASTER (Spine v1.2 §15 sibling)
//
// The Sonor library grid editor — mounts an inline-edit table that mirrors
// the v_sonor_library Supabase view. Used by every app that needs to view
// or edit the central block library (Takeoffs, Packs, Project Master, etc.).
//
// This is the third leg of the Sonor "in-house CAD" stack:
//   1. SonorLibrary         — data layer (fetch / cache / save)
//   2. SonorOverwriteGuard  — explicit-confirmation primitive for bulk writes
//   3. SonorLibEditor       — this file — UI surface for read+edit
//   (4. SonorTakeoffCanvas  — future — drawing primitives shared cross-app)
//
// Internally uses SonorLibrary for data and SonorOverwriteGuard for CSV import
// so any app loading this module gets the full read/edit/import flow with one
// `mount()` call. Hosts only need to supply the container element.
//
// Propagated to `APP - */data/sonor-lib-editor.js` by sync-everything.sh
// (S-4.2). NEVER hand-edit per-app copies — edit this master and re-sync.
//
// Namespace: window.SonorLibEditor
//
// Usage:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="data/sonor-library.js"></script>
//   <script src="data/sonor-overwrite-guard.js"></script>
//   <script src="data/sonor-lib-editor.js"></script>
//   <script>
//     SonorLibrary.init();
//     await SonorLibrary.load();
//     SonorLibEditor.mount({
//       container: document.getElementById('libraryHost'),
//       onChange: () => myApp.rebuildPalette()
//     });
//   </script>
//
// Exports:
//   mount(opts)   — { container, columns?, onChange?, debounceMs? }
//   refresh()     — re-read from SonorLibrary and re-render
//   destroy()     — unwire and remove the editor DOM

window.SONOR_LIB_EDITOR_VERSION = '1.0.1';   // 2026-09-29 — CSV import/export controls hidden (sonor-platform §4)
window.SonorLibEditor = window.SonorLibEditor || {};

(function (LE) {
  'use strict';

  // 15-column contract — must match SAFE_COLUMNS in sonor-library.js (one extra
  // for block_code which is the immutable key) and the CSV round-trip header.
  const DEFAULT_COLUMNS = [
    'block_code','service_nn','service_key','sub_name','label','glyph','shape','sizeable',
    'default_width_mm','default_height_mm','device_model_id','wq_sku',
    'enabled','discontinued','sort_order'
  ];

  const state = {
    container:   null,
    columns:     DEFAULT_COLUMNS.slice(),
    onChange:    null,
    debounceMs:  2000,
    saveTimer:   null,
    dirty:       {},   // { block_code: { field: newVal, ... } }
    libUnsub:    null,
    nodes:       null
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }

  // ── DOM template ──────────────────────────────────────────────────────────
  // Style hooks: .edit-mode-wrap, .edit-toolbar, table.edit-grid (sticky thead,
  // .dirty / .discontinued row states). These match sonor-components.css.
  const TEMPLATE = `
<div class="edit-mode-wrap" data-sonor-lib-editor>
  <div class="edit-toolbar">
    <input type="search" class="ed-search" placeholder="Search by code, label, sub…" />
    <select class="ed-filter">
      <option value="">All services</option>
    </select>
    <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px;">
      <input type="checkbox" class="ed-show-disc"> Show discontinued
    </label>
    <span style="flex:1;"></span>
    <button hidden data-csv-tool class="ed-import">Import CSV…</button>
    <button hidden data-csv-tool class="ed-export">Export CSV</button>
    <button class="ed-refresh">Refresh from Supabase</button>
    <span class="ed-count" style="color:var(--muted); font-size:12px; margin-left:8px;"></span>
    <span class="ed-state" style="color:var(--muted); font-size:12px; margin-left:8px;"></span>
    <input type="file" class="ed-file" accept=".csv,text/csv" hidden>
  </div>
  <div class="ed-grid-wrap">
    <table class="edit-grid">
      <thead><tr></tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>`;

  function _mountDom() {
    const wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE.trim();
    const root = wrap.firstElementChild;
    state.container.appendChild(root);
    state.nodes = {
      root:     root,
      search:   root.querySelector('.ed-search'),
      filter:   root.querySelector('.ed-filter'),
      showDisc: root.querySelector('.ed-show-disc'),
      btnImport: root.querySelector('.ed-import'),
      btnExport: root.querySelector('.ed-export'),
      btnRefresh: root.querySelector('.ed-refresh'),
      file:     root.querySelector('.ed-file'),
      count:    root.querySelector('.ed-count'),
      stateLbl: root.querySelector('.ed-state'),
      thead:    root.querySelector('thead tr'),
      tbody:    root.querySelector('tbody')
    };
    _renderHeader();
    _populateServiceFilter();
  }

  function _renderHeader() {
    state.nodes.thead.innerHTML = state.columns.map(c =>
      `<th>${escapeHtml(c)}</th>`
    ).join('');
  }

  function _populateServiceFilter() {
    const services = window.SonorLibrary ? SonorLibrary.getServices() : [];
    const cur = state.nodes.filter.value;
    state.nodes.filter.innerHTML = '<option value="">All services</option>' +
      services.map(s =>
        `<option value="${s.key}">${s.nn} ${escapeHtml(s.name)}</option>`
      ).join('');
    state.nodes.filter.value = cur;
  }

  // ── Cell input rendering ──────────────────────────────────────────────────
  function _cellInput(type, value, field, blockCode, extraAttr) {
    const v = value == null ? '' : value;
    const ea = extraAttr || '';
    if (type === 'checkbox') {
      const checked = v ? ' checked' : '';
      return `<input type="checkbox" class="ed-cell" data-bc="${escapeAttr(blockCode)}" data-field="${field}"${checked} ${ea}>`;
    }
    if (type === 'number') {
      return `<input type="number" class="ed-cell" data-bc="${escapeAttr(blockCode)}" data-field="${field}" value="${escapeAttr(v)}" ${ea}>`;
    }
    return `<input type="text" class="ed-cell" data-bc="${escapeAttr(blockCode)}" data-field="${field}" value="${escapeAttr(v)}" ${ea}>`;
  }

  // ── Filter + render ───────────────────────────────────────────────────────
  function _rowsForView() {
    const all = window.SonorLibrary ? SonorLibrary.getAllRows() : [];
    const q = (state.nodes.search.value || '').toLowerCase().trim();
    const f = state.nodes.filter.value || '';
    const showDisc = !!state.nodes.showDisc.checked;
    return all.filter(r => {
      if (!showDisc && r.discontinued) return false;
      if (f && r.service_key !== f) return false;
      if (q) {
        const hay = (r.block_code + ' ' + (r.label || '') + ' ' + (r.sub_name || '') + ' ' + (r.glyph || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function _isCheckbox(field) {
    return field === 'sizeable' || field === 'enabled' || field === 'discontinued';
  }
  function _isNumber(field) {
    return field === 'default_width_mm' || field === 'default_height_mm' || field === 'sort_order';
  }

  LE.refresh = function () {
    if (!state.nodes) return;
    _populateServiceFilter();
    const rows = _rowsForView();
    const isDirty = (bc) => !!state.dirty[bc];
    state.nodes.tbody.innerHTML = rows.map(r => {
      const cls = [];
      if (isDirty(r.block_code)) cls.push('dirty');
      if (r.discontinued) cls.push('discontinued');
      const cells = state.columns.map(col => {
        const val = r[col];
        // block_code is read-only (it's the key)
        if (col === 'block_code') {
          return `<td><code style="font-size:11px;">${escapeHtml(val || '')}</code></td>`;
        }
        if (_isCheckbox(col)) {
          // 'enabled' default is true when missing
          const v = (col === 'enabled') ? (val !== false) : !!val;
          return `<td style="text-align:center;">${_cellInput('checkbox', v, col, r.block_code)}</td>`;
        }
        if (_isNumber(col)) {
          return `<td>${_cellInput('number', val, col, r.block_code, 'style="width:66px;"')}</td>`;
        }
        // text — give wq_sku a wider input
        const extra = col === 'wq_sku' ? 'style="min-width:160px;"' :
                      col === 'label'  ? 'style="min-width:130px;"' :
                      col === 'glyph'  ? 'maxlength="3" style="width:44px; text-align:center; font-weight:700;"' : '';
        return `<td>${_cellInput('text', val, col, r.block_code, extra)}</td>`;
      }).join('');
      return `<tr class="${cls.join(' ')}" data-bc="${escapeAttr(r.block_code)}">${cells}</tr>`;
    }).join('');
    const meta = window.SonorLibrary ? SonorLibrary.getMeta() : {};
    state.nodes.count.textContent = rows.length + ' rows · tier=' + (meta.tier || '?');
    _updateStateLabel();
  };

  function _updateStateLabel() {
    const dirtyCount = Object.keys(state.dirty).length;
    if (!dirtyCount) {
      state.nodes.stateLbl.textContent = '';
      return;
    }
    state.nodes.stateLbl.textContent = dirtyCount + ' unsaved row' + (dirtyCount === 1 ? '' : 's') + '…';
  }

  // ── Inline edit save flow ─────────────────────────────────────────────────
  function _onCellChange(e) {
    const t = e.target.closest('.ed-cell');
    if (!t) return;
    const bc = t.dataset.bc;
    const field = t.dataset.field;
    if (!bc || !field) return;
    let val;
    if (t.type === 'checkbox') val = !!t.checked;
    else if (t.type === 'number') val = t.value === '' ? null : Number(t.value);
    else val = t.value;
    if (!state.dirty[bc]) state.dirty[bc] = { block_code: bc };
    state.dirty[bc][field] = val;
    // Mark row visually
    const row = t.closest('tr');
    if (row) row.classList.add('dirty');
    _updateStateLabel();
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(_flushSaves, state.debounceMs);
  }

  async function _flushSaves() {
    state.saveTimer = null;
    const patches = Object.values(state.dirty);
    if (!patches.length) return;
    state.dirty = {};
    _updateStateLabel();
    if (!window.SonorLibrary) {
      console.warn('[SonorLibEditor] SonorLibrary missing; cannot flush.');
      return;
    }
    state.nodes.stateLbl.textContent = 'Saving ' + patches.length + ' row' + (patches.length === 1 ? '' : 's') + '…';
    const res = await SonorLibrary.save(patches);
    if (res.fail) {
      state.nodes.stateLbl.textContent = res.ok + ' saved · ' + res.fail + ' failed';
      console.warn('[SonorLibEditor] save errors:', res.errors);
    } else {
      state.nodes.stateLbl.textContent = res.ok + ' saved · ' + new Date().toLocaleTimeString();
    }
    if (state.onChange) try { state.onChange({ kind: 'save', ok: res.ok, fail: res.fail }); } catch (_) {}
    LE.refresh();
  }

  // ── CSV round-trip ────────────────────────────────────────────────────────
  function _csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function _csvParse(text) {
    // Minimal RFC-4180 parser
    const rows = []; let cur = []; let buf = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { buf += '"'; i++; }
          else inQ = false;
        } else buf += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { cur.push(buf); buf = ''; }
        else if (c === '\n') { cur.push(buf); rows.push(cur); cur = []; buf = ''; }
        else if (c === '\r') { /* skip */ }
        else buf += c;
      }
    }
    if (buf.length || cur.length) { cur.push(buf); rows.push(cur); }
    return rows;
  }

  function _exportCsv() {
    const rows = _rowsForView();
    const header = state.columns.join(',');
    const lines = rows.map(r => state.columns.map(c => _csvEscape(r[c])).join(','));
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'sonor-library_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _importCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const grid = _csvParse(text).filter(r => r.length && r.some(c => c !== ''));
      if (!grid.length) { alert('CSV is empty.'); return; }
      const header = grid[0].map(s => String(s).trim());
      const idxBC = header.indexOf('block_code');
      if (idxBC < 0) { alert('CSV missing "block_code" column.'); return; }
      const incoming = grid.slice(1).map(cells => {
        const obj = {};
        header.forEach((col, i) => {
          if (i >= cells.length) return;
          let v = cells[i];
          if (_isCheckbox(col))  v = (v === 'true' || v === '1' || v === 'TRUE');
          else if (_isNumber(col)) v = (v === '' ? null : Number(v));
          else if (v === '') v = null;
          obj[col] = v;
        });
        return obj;
      }).filter(r => r.block_code);

      if (!window.SonorOverwriteGuard) {
        if (!confirm(incoming.length + ' rows incoming. SonorOverwriteGuard not loaded — apply directly?')) return;
        return SonorLibrary.save(incoming).then(res => {
          state.nodes.stateLbl.textContent = 'CSV: ' + res.ok + ' saved · ' + res.fail + ' failed';
          LE.refresh();
          if (state.onChange) state.onChange({ kind: 'csv', ok: res.ok, fail: res.fail });
        });
      }

      SonorOverwriteGuard.run({
        incoming: incoming,
        current:  SonorLibrary.getAllRows(),
        keyField: 'block_code',
        source:   'CSV import (' + incoming.length + ' rows)',
        onApply:  async (patches) => {
          if (!patches.length) { state.nodes.stateLbl.textContent = 'No changes applied.'; return; }
          // Split into inserts (new block_codes) vs updates
          const known = new Set(SonorLibrary.getAllRows().map(r => r.block_code));
          const inserts = patches.filter(p => !known.has(p.block_code));
          const updates = patches.filter(p =>  known.has(p.block_code));
          let okI = 0, failI = 0, okU = 0, failU = 0;
          if (inserts.length) {
            const r = await SonorLibrary.insert(inserts);
            okI = r.ok; failI = r.fail;
          }
          if (updates.length) {
            const r = await SonorLibrary.save(updates);
            okU = r.ok; failU = r.fail;
          }
          state.nodes.stateLbl.textContent =
            'CSV: ' + (okI + okU) + ' applied · ' + (failI + failU) + ' failed';
          LE.refresh();
          if (state.onChange) state.onChange({
            kind: 'csv',
            inserted: okI, updated: okU,
            failed: failI + failU
          });
        }
      });
    };
    reader.readAsText(file);
  }

  // ── Wire events ───────────────────────────────────────────────────────────
  function _wire() {
    const n = state.nodes;
    n.search.oninput = LE.refresh;
    n.filter.onchange = LE.refresh;
    n.showDisc.onchange = LE.refresh;
    n.btnRefresh.onclick = async () => {
      state.dirty = {};
      n.stateLbl.textContent = 'Refreshing…';
      await SonorLibrary.load();
      LE.refresh();
    };
    n.btnExport.onclick = _exportCsv;
    n.btnImport.onclick = () => n.file.click();
    n.file.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) _importCsv(f);
      n.file.value = '';
    };
    n.tbody.addEventListener('change', _onCellChange);
  }

  // ── Public ────────────────────────────────────────────────────────────────
  LE.mount = function (opts) {
    if (!opts || !opts.container) {
      throw new Error('[SonorLibEditor] mount() requires { container }');
    }
    if (state.container) LE.destroy();
    state.container  = opts.container;
    state.columns    = opts.columns ? opts.columns.slice() : DEFAULT_COLUMNS.slice();
    state.onChange   = opts.onChange || null;
    state.debounceMs = opts.debounceMs || 2000;
    _mountDom();
    _wire();
    LE.refresh();
    if (window.SonorLibrary && SonorLibrary.subscribe) {
      state.libUnsub = SonorLibrary.subscribe(() => LE.refresh());
    }
    return LE;
  };

  LE.destroy = function () {
    if (state.libUnsub) { try { state.libUnsub(); } catch (_) {} state.libUnsub = null; }
    if (state.nodes && state.nodes.root && state.nodes.root.parentNode) {
      state.nodes.root.parentNode.removeChild(state.nodes.root);
    }
    state.container = null;
    state.nodes = null;
    state.dirty = {};
  };

})(window.SonorLibEditor);
