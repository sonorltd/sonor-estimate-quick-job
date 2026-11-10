/**
 * Sonor Takeoffs — Revision Clouds primitive (canonical master)
 *
 * Workspace-shared module per Spine S-4.2. Edit at workspace root, then run
 *   bash sync-everything.sh
 * to propagate to APP - Takeoffs/data/.
 *
 * NEVER edit the per-app copy at APP - Takeoffs/data/sonor-takeoffs-clouds.js.
 *
 * Exposes window.SonorTakeoffsClouds. Pure-logic API:
 *   .STATUS                                  — { added, changed, removed, rfi } status taxonomy
 *   .scallopedPath(x, y, w, h)               — SVG path string for cloud silhouette
 *   .nextId(canvas, floors, status, activeFloorId)
 *                                            — next CLD-{A|C|R|RFI}-NNN auto-id
 *   .countByStatus(canvas, floors, activeFloorId)
 *                                            — { added, changed, removed, rfi }
 *   .collectFlat(canvas, floors, activeFloorId)
 *                                            — flat list across project
 *   .buildCloud(meta)                        — { path, noteText, chip:null }
 *                                              fabric Path + paired note Text
 *   .recolour(path, statusKey)               — restyle path + sync note text
 *
 * Dependencies:
 *   - fabric.js v5+ (window.fabric) for buildCloud/recolour
 *
 * Pure logic only — no DOM, no app-specific globals. Modal orchestration
 * (open/save/delete) stays inline in sonor-takeoffs.html as adapters.
 *
 * Last extracted from sonor-takeoffs.html v2.9.2 → v3.0.0 (2026-04-29).
 */
(function () {
  'use strict';

  var STATUS = {
    added:   { label: 'Added',   short: '+', letter: 'A', colour: '#78ba57' },
    changed: { label: 'Changed', short: '~', letter: 'C', colour: '#e37c59' },
    removed: { label: 'Removed', short: '-', letter: 'R', colour: '#ec6061' },
    // 2026-07-12 (Bryn directive) — RFI clouds: purple query cloud for
    // "Request For Information" regions. Service-01 purple #8058a1.
    // Letter 'RFI' keeps the id prefix self-describing (CLD-RFI-NNN)
    // and avoids the 'R' collision with removed.
    rfi:     { label: 'RFI',     short: '?', letter: 'RFI', colour: '#8058a1' },
    // 2026-07-16 (Bryn: "we need a note cloud too, for just general info,
    // charcoal color") — NOTE clouds: plain informational region, workspace
    // charcoal #302f2e (contents leaders / svc-10 swatch — brand SSOT, not
    // invented). Prefix NOTE-NNN, no legacy scheme.
    note:    { label: 'Note',    short: 'i', letter: 'NOTE', colour: '#302f2e' }
  };

  // Scalloped path generator. Given a rect (x, y, w, h), emits the SVG
  // path string for a closed cloud silhouette: cubic Beziers along each
  // edge. 2026-07-12 (Bryn: "clouds need to have smaller ripples, more
  // like standard cad") — wavelength 25→12, bulge 10→4. 2026-07-13
  // (Bryn: "still need a lighter stroke and more ripples like proper
  // cad") — wavelength 12→9, bulge 4→3, stroke 1.5→1. WAVELENGTH/BULGE
  // are exported so consumers (bbox→rect compensation in the host) stay
  // in sync instead of hard-coding stale copies.
  var WAVELENGTH = 9;
  var BULGE = 3;
  function scallopedPath(x, y, w, h) {
    if (!isFinite(x) || !isFinite(y) || w <= 0 || h <= 0) return '';
    var wavelength = WAVELENGTH;
    var bulge = BULGE;
    function bezierEdge(sx, sy, ex, ey, nx, ny) {
      var len = Math.hypot(ex - sx, ey - sy);
      var n = Math.max(2, Math.ceil(len / wavelength));
      var dx = (ex - sx) / n;
      var dy = (ey - sy) / n;
      var d = '';
      for (var i = 0; i < n; i++) {
        var ax = sx + dx * i,        ay = sy + dy * i;
        var bx = sx + dx * (i + 1),  by = sy + dy * (i + 1);
        var c1x = ax + dx * 0.32 + nx * bulge;
        var c1y = ay + dy * 0.32 + ny * bulge;
        var c2x = ax + dx * 0.68 + nx * bulge;
        var c2y = ay + dy * 0.68 + ny * bulge;
        d += ' C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ', '
                   + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ', '
                   + bx.toFixed(2)  + ' ' + by.toFixed(2);
      }
      return d;
    }
    var d = 'M ' + x.toFixed(2) + ' ' + y.toFixed(2);
    d += bezierEdge(x, y, x + w, y, 0, -1);                 // top
    d += bezierEdge(x + w, y, x + w, y + h, 1, 0);          // right
    d += bezierEdge(x + w, y + h, x, y + h, 0, 1);          // bottom
    d += bezierEdge(x, y + h, x, y, -1, 0);                 // left
    d += ' Z';
    return d;
  }

  // Auto-ID per status, scoped per project. Walks every floor's
  // revisionClouds[] AND the live canvas so newly-added clouds are
  // counted before their floor payload is captured.
  function nextId(canvas, floors, status) {
    // v5.138.0 (Bryn: "CLD still appears as a prefix in the setup here") —
    // the CLD- namespace is RETIRED: new ids are RFI-001 / A-001 / C-001 /
    // R-001. Max-scan accepts BOTH schemes so legacy CLD-* clouds keep the
    // sequence monotonic (CLD-RFI-002 exists -> next is RFI-003).
    // v5.148.0 (Bryn: "use ADD, MOV, REM, for the other revision type
    // prefixes") — readable 3-letter prefixes; RFI- unchanged. The
    // max-scan accepts EVERY historical scheme (ADD-/MOV-/REM-, the
    // v5.138 single letters A-/C-/R-, and CLD-* wrappers) so sequences
    // stay monotonic across renames.
    var prefix = status === 'changed' ? 'MOV-'
              : status === 'removed'  ? 'REM-'
              : status === 'rfi'      ? 'RFI-'
              : status === 'note'     ? 'NOTE-'   // v5.165.0 — note clouds
              : 'ADD-';
    var _LEGACY = status === 'changed' ? ['C-']
                : status === 'removed' ? ['R-']
                : status === 'rfi'     ? []
                : status === 'note'    ? []
                : ['A-'];
    var _numOf = function (id) {
      id = String(id || '');
      if (id.indexOf('CLD-') === 0) id = id.slice(4);
      var pfx = null;
      if (id.indexOf(prefix) === 0) pfx = prefix;
      else {
        for (var li = 0; li < _LEGACY.length; li++) {
          if (id.indexOf(_LEGACY[li]) === 0) { pfx = _LEGACY[li]; break; }
        }
      }
      if (!pfx) return 0;
      var rest = id.slice(pfx.length);
      // sequence isolation: 'RFI-' must not match under 'R-'/'REM-' etc.
      if (!/^[0-9]+$/.test(rest)) return 0;
      return parseInt(rest, 10) || 0;
    };
    var maxN = 0;
    if (Array.isArray(floors)) {
      floors.forEach(function (f) {
        (f && f.revisionClouds || []).forEach(function (c) {
          var n = _numOf((c && c.sonorRevCloud && c.sonorRevCloud.id) || '');
          if (n > maxN) maxN = n;
        });
      });
    }
    if (canvas && typeof canvas.getObjects === 'function') {
      canvas.getObjects().forEach(function (o) {
        if (!o || !o.sonorRevCloud || o.__sonorRevCloudIsChip) return;
        var n = _numOf(o.sonorRevCloud.id || '');
        if (n > maxN) maxN = n;
      });
    }
    // v5.154.0 (Bryn: "need an option to mark a note as an RFI, so it ends
    // up in the list and count with an ID") — plan-note RFIs share THIS
    // sequence; scan their reserved ids so clouds and note-RFIs never
    // collide.
    if (status === 'rfi') {
      try {
        if (typeof window !== 'undefined' && typeof window._planNotesRfiMax === 'function') {
          var nm = Number(window._planNotesRfiMax()) || 0;
          if (nm > maxN) maxN = nm;
        }
      } catch (_) {}
    }
    return prefix + String(maxN + 1).padStart(3, '0');
  }

  // Project-wide cloud counts grouped by status. Walks every floor's
  // saved revisionClouds[] AND the live canvas (active floor) so the
  // active-floor counts update without re-saving first.
  function countByStatus(canvas, floors, activeFloorId) {
    // v5.136.0 — registry-driven zeroes: any future STATUS key is counted
    // automatically (feeds the registry-driven pill panel).
    var out = {};
    Object.keys(STATUS).forEach(function (k) { out[k] = 0; });
    if (Array.isArray(floors)) {
      floors.forEach(function (f) {
        if (!f || f.id === activeFloorId) return;
        (f.revisionClouds || []).forEach(function (c) {
          var s = (c && c.sonorRevCloud && c.sonorRevCloud.status) || 'added';
          if (out[s] != null) out[s] += 1;
        });
      });
    }
    if (canvas && typeof canvas.getObjects === 'function') {
      canvas.getObjects().forEach(function (o) {
        if (!o || !o.sonorRevCloud || o.__sonorRevCloudIsChip) return;
        var s = o.sonorRevCloud.status || 'added';
        if (out[s] != null) out[s] += 1;
      });
    }
    // v5.154.0 — plan-note RFIs count with the clouds (Bryn: "ends up in
    // the list and count").
    try {
      if (typeof window !== 'undefined' && typeof window._planNotesRfis === 'function') {
        out.rfi = (out.rfi || 0) + (window._planNotesRfis().length || 0);
      }
    } catch (_) {}
    return out;
  }

  // Flat list of every cloud across the project, with the floor name
  // stamped onto each so PM/PDF Revisions Schedule can render them
  // in floor order.
  function collectFlat(canvas, floors, activeFloorId) {
    var out = [];
    function pushFloor(floorName, list) {
      (list || []).forEach(function (c) {
        var m = (c && c.sonorRevCloud) || c || {};
        out.push({
          id: m.id || '',
          status: m.status || 'added',
          note: m.note || '',
          revisionId: m.revisionId || null,
          revisionLabel: m.revisionLabel || '',
          rect: m.rect || null,
          floor: floorName || ''
        });
      });
    }
    if (Array.isArray(floors)) {
      floors.forEach(function (f) {
        if (!f || f.id === activeFloorId) return;
        pushFloor(f.name || ('Floor ' + f.id), f.revisionClouds || []);
      });
    }
    var activeName = '—';
    if (Array.isArray(floors)) {
      var af = floors.find(function (x) { return x && x.id === activeFloorId; });
      if (af) activeName = af.name || ('Floor ' + af.id);
    }
    if (canvas && typeof canvas.getObjects === 'function') {
      canvas.getObjects().forEach(function (o) {
        if (!o || !o.sonorRevCloud || o.__sonorRevCloudIsChip) return;
        var m = o.sonorRevCloud;
        out.push({
          id: m.id || '',
          status: m.status || 'added',
          note: m.note || '',
          revisionId: m.revisionId || null,
          revisionLabel: m.revisionLabel || '',
          rect: m.rect || null,
          floor: activeName
        });
      });
    }
    return out;
  }

  // v5.135.0 — canonical note text: the cloud ID auto-prefixes the note
  // (Bryn: "the ID of the RFI or rev-ADD etc auto added at the beginning...
  // everything is linked throughout, for IDs, tasks etc"). meta.note stays
  // CLEAN (no id baked in) — the prefix is derived at render, so the same
  // id threads the canvas, the Notes RFI list, the glance page and the
  // copy-paste bullets without ever drifting.
  function noteDisplayText(m) {
    m = m || {};
    var note = String(m.note || '').trim();
    // 2026-07-14 Bryn: "dont need CLD in the prefix" — display as
    // RFI-002 / A-014 etc.; the FULL id stays canonical everywhere else.
    var idTxt = String(m.id || '').replace(/^CLD-/, '');
    return (idTxt ? idTxt + (note ? ' — ' : '') : '') + note;
  }

  // v5.135.0 — pose the note inside the cloud rect per meta.note_align:
  // 'top' (default) / 'centre' / 'bottom', always 8px inset + wrapped to
  // the inner width. Height read AFTER the width is set so centre/bottom
  // account for the wrapped line count.
  function poseNote(t, r, align) {
    if (!t || !r || !(r.w > 0)) return;
    try {
      t.set({ left: r.x + 5, width: Math.max(40, r.w - 10) });   // v5.143.0 — tighter inset (Bryn: "less padding")
      if (typeof t.initDimensions === 'function') t.initDimensions();
      var th = Number(t.height) || 0;
      var a = String(align || 'top').toLowerCase();
      var top = r.y + 5;
      if (a === 'centre' || a === 'center' || a === 'c') top = r.y + Math.max(5, (r.h - th) / 2);
      else if (a === 'bottom' || a === 'b') top = r.y + Math.max(5, r.h - th - 5);
      t.set({ top: top });
      t.setCoords();
    } catch (_) {}
  }

  // Build the canvas objects for a revision cloud. Returns
  // { path, noteText, chip } — chip retained as nullable back-compat
  // slot for callers, always null post-v2.6.1.
  function buildCloud(meta) {
    if (typeof fabric === 'undefined') return { path: null, noteText: null, chip: null };
    var m = meta || {};
    var rect = m.rect || { x: 0, y: 0, w: 100, h: 60 };
    var status = STATUS[m.status] || STATUS.added;
    var colour = m.colour || status.colour;
    var d = scallopedPath(rect.x, rect.y, rect.w, rect.h);
    var path = new fabric.Path(d, {
      fill: colour + '14',           // ~8% alpha
      stroke: colour,
      strokeWidth: 1,                // v2026-07-13 — lighter, proper-CAD lineweight

      selectable: true,
      evented: true,
      hasBorders: true,
      hasControls: true,             // v2.6.1 — resizable
      lockRotation: true,            // keep cloud axis-aligned
      lockScalingFlip: true,
      objectCaching: false
    });
    path.sonorRevCloud = m;
    // v3.7.13 — atomic-kind contract metadata stamp (Phase F). Revision
    // clouds are atomic fabric.Path with bbox-resize handles + an
    // independent sibling note text. The path IS the canonical element;
    // its native angle/scaleX/scaleY/left/top/width/height already form
    // a transform-canonical record. The sibling chip (noteText) tracks
    // the cloud via _sonorCloudNoteOf reference, kept in sync by
    // recolour() + the existing label-follow handler.
    path.sonorElement = {
      kind: 'revisionCloud',
      id: m.id,
      status: m.status,
      colour: m.colour || (status && status.colour)
    };
    // v5.134.0 (Bryn: "cloud text needs to be smaller, wrap and be at the
    // internal top edge of a cloud to avoid clashes") — fabric.Textbox
    // (word-wraps at the cloud's inner width), pinned top-left with an
    // 8px inset, 7px / weight 300 / status colour (v5.129.0 tint kept).
    var noteText = new fabric.Textbox(noteDisplayText(m), {
      left: rect.x + 8,
      top:  rect.y + 8,
      width: Math.max(40, rect.w - 16),
      // v5.137.0 (Bryn: "cloud text needs to be more prominent... but
      // actually make it a little smaller") — 5px but BOLD + a soft white
      // highlight behind each line (CAD-callout treatment): reads clearly
      // over dense plan linework without taking more space.
      fontSize: 5,
      lineHeight: 1.3,
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontWeight: '700',
      fill: colour,
      textBackgroundColor: 'rgba(255,255,255,0.78)',
      textAlign: 'left',
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      editable: false,
      // v5.143.0 (Bryn: "dont allow clouds text to be moveable, just keep
      // locked with cloud position") — belt-and-braces immovability: even
      // if something programmatically selects it, it cannot translate.
      lockMovementX: true,
      lockMovementY: true,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'default',
      excludeFromExport: false
    });
    noteText._sonorCloudNote = true;
    noteText._sonorCloudNoteOf = m.id || null;
    path._sonorNoteText = noteText;
    poseNote(noteText, rect, m.note_align);   // v5.135.0 — top/centre/bottom
    return { path: path, noteText: noteText, chip: null };
  }

  // Re-paint a cloud's path after a status / colour change. Caller
  // must call canvas.requestRenderAll() afterwards.
  function recolour(path) {
    if (!path || !path.sonorRevCloud) return;
    var meta = path.sonorRevCloud;
    var status = STATUS[meta.status] || STATUS.added;
    var colour = status.colour;
    meta.colour = colour;
    if (typeof path.set === 'function') {
      path.set({ stroke: colour, fill: colour + '14' });
    }
    var t = path._sonorNoteText;
    if (t && typeof t.set === 'function') {
      // v5.129.0 — note tracks the status colour; v5.135.0 — ID prefix +
      // re-pose per note_align (modal save routes through here).
      t.set({ text: noteDisplayText(meta), fill: colour });
      if (meta.rect) poseNote(t, meta.rect, meta.note_align);
      t.dirty = true;
    }
  }

  window.SonorTakeoffsClouds = {
    STATUS: STATUS,
    WAVELENGTH: WAVELENGTH,
    BULGE: BULGE,
    noteDisplayText: noteDisplayText,
    poseNote: poseNote,
    scallopedPath: scallopedPath,
    nextId: nextId,
    countByStatus: countByStatus,
    collectFlat: collectFlat,
    buildCloud: buildCloud,
    recolour: recolour
  };
})();
