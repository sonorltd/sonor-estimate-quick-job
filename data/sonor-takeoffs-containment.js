/**
 * Sonor Takeoffs — Containment primitive (canonical master)
 *
 * Workspace-shared module per Spine S-4.2. Edit at workspace root, then run
 *   bash sync-everything.sh
 * to propagate to APP - Takeoffs/data/.
 *
 * NEVER edit the per-app copy at APP - Takeoffs/data/sonor-takeoffs-containment.js.
 *
 * Exposes window.SonorTakeoffsContainment. Pure-logic API:
 *   .TYPES               — canonical sub-type registry (5 entries)
 *   .COLOUR              — Service-10 Infrastructure charcoal hex
 *   .MATERIALS           — material slugs (ordering canonical)
 *   .MOUNTS              — mount slugs
 *   .typeById(id)        — TYPES row by id, with safe default fallback
 *   .visualOpts(typeId)  — { strokeWidth, dash, rounded } per sub-type
 *   .lengthPx(points)    — polyline pixel length
 *   .lengthM(points, scalePxPerM)
 *                        — polyline metres (rounded 2dp; 0 if uncalibrated)
 *   .recomputeLength(target, scalePxPerM)
 *                        — mutates target.sonorContainment.{length_m, lenPx}
 *   .buildGroup(pts, sonorContainment)
 *                        — fabric.Polyline tagged with sonorContainment
 *   .collectReport(canvas, floors, activeFloorId, activeFloorName)
 *                        — { headers, rows, align, totalsAlign, containmentMeta }
 *
 * Dependencies:
 *   - fabric.js v5+ (window.fabric) for buildGroup
 *   - SonorDrawingCore (window.SonorDrawingCore) for fast lengthPx (optional;
 *     inline fallback if unavailable)
 *
 * Pure logic only — no DOM, no app-specific globals. Modal orchestration
 * (open/save/delete), picker chips, and finalise() stay inline in
 * sonor-takeoffs.html as adapters that call into this module.
 *
 * Last extracted from sonor-takeoffs.html v2.9.2 → v3.0.0 (2026-04-29).
 */
(function () {
  'use strict';

  var TYPES = [
    { id: 'cable_tray', label: 'Cable Tray', short: 'CT', strokeWidth: 4, dash: [],     doubleStroke: true,  rounded: false, endCaps: false },
    { id: 'trunking',   label: 'Trunking',   short: 'TR', strokeWidth: 5, dash: [],     doubleStroke: false, rounded: false, endCaps: false },
    { id: 'conduit',    label: 'Conduit',    short: 'CO', strokeWidth: 3, dash: [],     doubleStroke: false, rounded: true,  endCaps: false },
    { id: 'riser',      label: 'Riser',      short: 'RI', strokeWidth: 3, dash: [],     doubleStroke: false, rounded: false, endCaps: true  },
    { id: 'raceway',    label: 'Raceway',    short: 'RW', strokeWidth: 4, dash: [8, 4], doubleStroke: false, rounded: false, endCaps: false }
  ];

  var COLOUR = '#302F2E';   // Service-10 Infrastructure charcoal
  var MATERIALS = ['galv', 'pvc', 'copper', 'aluminium', 'steel'];
  var MOUNTS    = ['ceiling', 'wall', 'floor', 'surface', 'recessed'];

  function typeById(id) {
    return TYPES.find(function (c) { return c.id === id; }) || TYPES[0];
  }

  function visualOpts(typeId) {
    var ct = typeById(typeId);
    return {
      strokeWidth: ct.strokeWidth,
      dash: (ct.dash && ct.dash.length) ? ct.dash : null,
      rounded: !!ct.rounded
    };
  }

  function lengthPx(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    if (typeof window.SonorDrawingCore !== 'undefined' &&
        typeof window.SonorDrawingCore.polylineLengthPx === 'function') {
      return window.SonorDrawingCore.polylineLengthPx(points);
    }
    var len = 0;
    for (var i = 1; i < points.length; i++) {
      var dx = points[i].x - points[i - 1].x;
      var dy = points[i].y - points[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  function lengthM(points, scalePxPerM) {
    if (!scalePxPerM) return 0;
    return Number((lengthPx(points) / scalePxPerM).toFixed(2));
  }

  function recomputeLength(target, scalePxPerM) {
    if (!target || !target.sonorContainment) return;
    var pts = target.sonorContainment.points || [];
    var lenPx = lengthPx(pts);
    target.sonorContainment.length_m = scalePxPerM
      ? Number((lenPx / scalePxPerM).toFixed(2))
      : 0;
    target.sonorContainment.lenPx = lenPx;
  }

  // Build the visual fabric.Group for a containment run. Single primitive
  // builder used by both finaliseContainment + _restoreContainment.
  //
  // v3.7.7 — Returns a SonorElement Group containing the polyline as
  // geometry child. Pre-v3.7.7 returned just the polyline; the
  // post-v3.7.7 contract is one Group per element with children at
  // originX/Y='center', group owns the world transform, points stored
  // in group-local space (centroid-localised). Phase D vertex-edit
  // foundation (v3.7.6) handles points read/write through the polyline
  // child via _resolvePolylineChild.
  //
  // Backward-compat: legacy records pass world-coord points; this
  // function centroid-localises them and positions the group at the
  // centroid. New saves write the canonical shape.
  //
  // Conventions stamped on the Group:
  //   - group.sonorContainment = sonorContainment (proxy alias for the
  //     50+ canvas-walking reader sites)
  //   - group._sonorPolyChild = polyline (fast lookup for Phase D
  //     vertex-edit handlers; falls back to _objects[0] anyway)
  //   - The label is stamped by the caller as group._sonorLabel after
  //     canvas.add — preserves the 90+ _sonorLabel reader sites.
  function buildGroup(pts, sonorContainment) {
    if (typeof fabric === 'undefined') return null;
    var ct = typeById(sonorContainment && sonorContainment.type);
    var colour = (sonorContainment && sonorContainment.colour) || COLOUR;
    // v5.4.65 — REVERTED to centroid (sum/N). v5.4.64's bbox-centre
    // change caused vertex-drag geometry corruption — Bryn report
    // 2026-05-10 ("room drawing still goes crazy") showed deformed
    // polygons + scattered vertex handles. Root cause is an unfixed
    // mismatch in _polyActionHandler that doesn't shift group.left/top
    // alongside the pathOffset shifts that _setPositionDimensions
    // triggers post-vertex-drag. Centroid keeps a small per-asymmetric
    // drift on save/load but is stable under the existing handler.
    var sx = 0, sy = 0;
    for (var i = 0; i < pts.length; i++) {
      sx += Number(pts[i].x) || 0;
      sy += Number(pts[i].y) || 0;
    }
    var cx = pts.length ? sx / pts.length : 0;
    var cy = pts.length ? sy / pts.length : 0;
    var localPts = pts.map(function (p) {
      return { x: (Number(p.x) || 0) - cx, y: (Number(p.y) || 0) - cy };
    });
    var mainPoly = new fabric.Polyline(localPts, {
      fill: '',
      stroke: colour,
      strokeWidth: ct.strokeWidth,
      strokeDashArray: (ct.dash && ct.dash.length) ? ct.dash : null,
      strokeLineCap: ct.rounded ? 'round' : 'butt',
      strokeLineJoin: 'round',
      hasControls: false,
      selectable: true,
      evented: true,
      objectCaching: false,
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0
    });
    // Build via SonorElement.create when available (gains the contract
    // metadata `kind: 'containment'`). Defensive fallback to a plain
    // fabric.Group when the module is missing — same architecture, just
    // no contract tag.
    var group;
    if (typeof window !== 'undefined' && window.SonorElement &&
        typeof window.SonorElement.create === 'function') {
      group = window.SonorElement.create({
        kind: 'containment',
        geometry: mainPoly,
        transform: { left: cx, top: cy, angle: 0, scaleX: 1, scaleY: 1 },
        meta: sonorContainment
      });
      // Override SonorElement.create's default hasControls:true. Containment
      // doesn't get bbox-rotation handles — vertex-edit attaches its own
      // controls per Phase D, and lockRotation prevents accidental rotate.
      group.set({ hasControls: false, selectable: true, evented: true });
    } else {
      group = new fabric.Group([mainPoly], {
        originX: 'center',
        originY: 'center',
        left: cx,
        top: cy,
        subTargetCheck: true,
        hasControls: false,
        selectable: true,
        evented: true
      });
    }
    // Stamp `o.sonorContainment` proxy so the 50+ canvas-walking reader
    // sites keep working unchanged. Same pattern used for sonorTv /
    // sonorShade / sonorPjScreen / sonorSymbol since v3.7.0.
    group.sonorContainment = sonorContainment;
    // Fast lookup for Phase D vertex-edit handlers (avoids _objects[0]
    // walks per-event).
    group._sonorPolyChild = mainPoly;
    return group;
  }

  // Schedule collector — feeds Full Document Containment Schedule + standalone
  // PDF/CSV. Mirrors _collectCablesReport shape.
  function collectReport(canvas, floors, activeFloorId, activeFloorName) {
    var headers = ['ID', 'Floor', 'Type', 'Size mm', 'Material', 'Mount', 'Length m', 'Notes'];
    var rows = [];
    var align = ['left', 'left', 'centre', 'right', 'centre', 'centre', 'right', 'left'];
    var grandM = 0;
    var typeTotals = {};
    var floorSubtotals = {};
    var afn = activeFloorName || '—';

    if (canvas && typeof canvas.getObjects === 'function') {
      canvas.getObjects().forEach(function (o) {
        if (!o || !o.sonorContainment) return;
        var m = o.sonorContainment;
        var ct = typeById(m.type);
        var lenN = Number(m.length_m) || 0;
        grandM += lenN;
        typeTotals[m.type] = typeTotals[m.type] || { count: 0, length_m: 0, label: ct.label };
        typeTotals[m.type].count += 1;
        typeTotals[m.type].length_m += lenN;
        floorSubtotals[afn] = (floorSubtotals[afn] || 0) + lenN;
        rows.push([m.id || '', afn, m.product_name || ct.label, String(m.size_mm || ''), m.material || '', m.mount || '', lenN.toFixed(2), m.notes || '']);
      });
    }

    if (Array.isArray(floors)) {
      floors.forEach(function (f) {
        if (!f || f.id === activeFloorId) return;
        var fname = f.name || ('Floor ' + f.id);
        (f.containment || []).forEach(function (c) {
          var m = c.sonorContainment || c;
          var ct = typeById(m.type);
          var lenN = Number(m.length_m) || 0;
          grandM += lenN;
          typeTotals[m.type] = typeTotals[m.type] || { count: 0, length_m: 0, label: ct.label };
          typeTotals[m.type].count += 1;
          typeTotals[m.type].length_m += lenN;
          floorSubtotals[fname] = (floorSubtotals[fname] || 0) + lenN;
          rows.push([m.id || '', fname, m.product_name || ct.label, String(m.size_mm || ''), m.material || '', m.mount || '', lenN.toFixed(2), m.notes || '']);
        });
      });
    }

    rows.sort(function (a, b) {
      return String(a[1]).localeCompare(String(b[1]))
          || String(a[2]).localeCompare(String(b[2]))
          || String(a[0]).localeCompare(String(b[0]));
    });

    return {
      headers: headers,
      rows: rows,
      align: align,
      totalsAlign: align.slice(),
      containmentMeta: { grandM: grandM, typeTotals: typeTotals, floorSubtotals: floorSubtotals, totalRuns: rows.length }
    };
  }

  window.SonorTakeoffsContainment = {
    TYPES: TYPES,
    COLOUR: COLOUR,
    MATERIALS: MATERIALS,
    MOUNTS: MOUNTS,
    typeById: typeById,
    visualOpts: visualOpts,
    lengthPx: lengthPx,
    lengthM: lengthM,
    recomputeLength: recomputeLength,
    buildGroup: buildGroup,
    collectReport: collectReport
  };
})();
