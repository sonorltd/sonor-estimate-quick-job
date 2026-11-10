// sonor-drawing-core.js — CANONICAL MASTER (Spine v1.2.5 §16 / §19)
//
// Engine-agnostic pure-math primitives for every Sonor drawing app.
// Consumed by Takeoffs (Fabric.js), Cinema Takeoff (SVG), Network Map
// (React/Vite), Cinema Design (Fabric.js), and the in-house Schematic
// app — any surface that needs polygon math, snap-to-grid, ortho-snap,
// unit conversion, point-in-polygon tests, orthogonal edge routing, or
// SVG path emission.
//
// NON-NEGOTIABLE DESIGN RULES (the "no fork" charter):
//   1. Pure math ONLY. No fabric, no SVG mutation, no DOM, no DB calls.
//      Outputs are plain data (numbers, point arrays, string fragments)
//      that callers can render however they like.
//   2. Side-effect free. Every function returns a value; nothing mutates
//      shared state. Callers own their own state.
//   3. No app-specific knowledge. No references to sonorMeasure, CABLE_TYPES,
//      sonorSymbol, or any Takeoffs/Cinema-specific data shape. Inputs
//      are plain {x, y} points and numbers.
//   4. Additive-only. New helpers append to SonorDrawingCore; existing
//      signatures never change (breaking changes = new major version).
//
// Sourced file is: $SONOR_ROOT/sonor-drawing-core.js
// Propagated to:   APP - */sonor-drawing-core.js via sync-everything.sh
//
// Loading patterns:
//   <script src="sonor-drawing-core.js"></script>    (vanilla HTML — Takeoffs / Cinema Takeoff)
//   import './sonor-drawing-core.js'                  (concat / build step — Cinema Design)
//   (future) import { snap } from '@sonor/drawing-core'  (ESM — React/Vite apps)
//
// Namespace: window.SonorDrawingCore
//
// Version: 1.2.0 — adds orthogonal edge router + SVG path emitter +
//                  edge-crossing detector + parallel-edge offsets +
//                  port handle anchor (2026-05-12).
//   The "auto line drawing" foundation. Implementation matches the
//   aesthetic spec published in EasySchematic's ROUTING_RULES.md
//   (R1–R11), reimplemented fresh from algorithm description — no
//   code copied from any GPL/AGPL source.
//
//   v1.1.0 — adds snap registry + edge-mid + perpendicular + angle (2026-04-28)
//   v1.0.0 — initial extraction (2026-04-24 / Spine v1.2.5)
(function () {
  'use strict';

  // Idempotent export — a second script load is a no-op (allows apps
  // that bundle both an inline seed AND the propagated copy to survive
  // without double-definition warnings).
  if (typeof window !== 'undefined' && window.SonorDrawingCore && window.SonorDrawingCore.__version === '1.2.0') {
    return;
  }

  // ============================================================
  // DISTANCE + POINTS
  // ============================================================

  /** Euclidean distance between two {x, y} points. */
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ============================================================
  // SNAP + ORTHO
  // ============================================================

  /**
   * Snap a scalar value to the nearest multiple of `step`.
   * @param {number} v    — the value to snap
   * @param {number} step — grid spacing (must be > 0; returns v unchanged if not)
   */
  function snap(v, step) {
    if (!Number.isFinite(step) || step <= 0) return v;
    return Math.round(v / step) * step;
  }

  /**
   * Shift-held ortho lock — returns a new point constrained to the
   * dominant axis relative to `prev`. When shift is NOT held, returns `p`
   * unchanged. The returned object includes `ortho: true` when a lock
   * happened so callers can surface UI affordance (e.g. cursor hint).
   *
   * @param {{x:number, y:number}} prev — anchor point (typically the
   *        previous polyline vertex). Null/undefined returns `p`.
   * @param {{x:number, y:number}} p    — current cursor point
   * @param {boolean} shiftHeld         — whether the modifier is active
   */
  function orthoSnap(prev, p, shiftHeld) {
    if (!shiftHeld || !prev) return p;
    const dx = Math.abs(p.x - prev.x);
    const dy = Math.abs(p.y - prev.y);
    return (dx >= dy)
      ? { x: p.x, y: prev.y, ortho: true }
      : { x: prev.x, y: p.y, ortho: true };
  }

  /**
   * v1.1.0 — Snap a point to the midpoint of the nearest edge in `edges`.
   * Edges are pairs of {a:{x,y}, b:{x,y}} or [{x,y},{x,y}]. Returns
   * { x, y, snapped:true, kind:'edgeMid', edgeIndex } when the closest
   * midpoint is within `tolerance` px of `p`; returns `p` unchanged
   * otherwise.
   *
   * @param {{x:number, y:number}} p
   * @param {Array<{a:{x,y}, b:{x,y}} | [{x,y},{x,y}]>} edges
   * @param {number} tolerance — px (default 10)
   */
  function snapToEdgeMidpoint(p, edges, tolerance) {
    if (!p || !Array.isArray(edges) || edges.length === 0) return p;
    const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 10;
    let best = null;
    let bestD = tol + 1;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = Array.isArray(e) ? e[0] : e.a;
      const b = Array.isArray(e) ? e[1] : e.b;
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d <= tol && d < bestD) {
        bestD = d;
        best = { x: mx, y: my, edgeIndex: i };
      }
    }
    return best
      ? { x: best.x, y: best.y, snapped: true, kind: 'edgeMid', edgeIndex: best.edgeIndex }
      : p;
  }

  /**
   * v1.1.0 — Snap so a new line from `prev` → `p` would be perpendicular
   * to one of the supplied `edges`. For each edge, computes the edge
   * direction, projects the cursor onto the perpendicular line through
   * `prev`, and returns the projected point if within `tolerance` of the
   * cursor. Returns `p` unchanged if `prev` missing or no edge qualifies.
   *
   * Standard CAD "perpendicular snap" — engineers expect this when
   * connecting rooms, walls, or cable runs at right angles.
   */
  function snapPerpendicular(prev, p, edges, tolerance) {
    if (!prev || !p || !Array.isArray(edges) || edges.length === 0) return p;
    const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 10;
    let best = null;
    let bestD = tol + 1;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = Array.isArray(e) ? e[0] : e.a;
      const b = Array.isArray(e) ? e[1] : e.b;
      if (!a || !b) continue;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const eLen = Math.hypot(ex, ey);
      if (eLen < 1e-6) continue;
      const ux = ex / eLen;
      const uy = ey / eLen;
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      const proj = dx * ux + dy * uy;
      const tx = prev.x + (dx - proj * ux);
      const ty = prev.y + (dy - proj * uy);
      const d = Math.hypot(p.x - tx, p.y - ty);
      if (d <= tol && d < bestD) {
        bestD = d;
        best = { x: tx, y: ty, edgeIndex: i };
      }
    }
    return best
      ? { x: best.x, y: best.y, snapped: true, kind: 'perpendicular', edgeIndex: best.edgeIndex }
      : p;
  }

  /**
   * v1.1.0 — Soft angle lock. Constrains the line from `prev` → `p` to
   * the nearest multiple of `stepDeg` (default 15°). Like orthoSnap but
   * finer — useful for Shift+Ctrl as a 15° angle increment lock vs.
   * Shift's hard 90° ortho. Returns `p` if `prev` missing.
   */
  function snapAngle(prev, p, stepDeg) {
    if (!prev || !p) return p;
    const step = Number.isFinite(stepDeg) && stepDeg > 0 ? stepDeg : 15;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return p;
    const stepRad = step * Math.PI / 180;
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / stepRad) * stepRad;
    return {
      x: prev.x + r * Math.cos(snapped),
      y: prev.y + r * Math.sin(snapped),
      snapped: true,
      kind: 'angle',
      angleDeg: (snapped * 180 / Math.PI + 360) % 360
    };
  }

  /**
   * v1.1.0 — Snap result registry. Tries each candidate snap source in
   * priority order (vertex > edgeMid > perpendicular > grid > angle >
   * ortho) and returns the first match. Pure dispatcher — knows nothing
   * about Fabric, DOM, or sonor data shapes.
   */
  function snapResult(p, opts) {
    if (!p) return p;
    const o = opts || {};
    const tol = Number.isFinite(o.tolerance) && o.tolerance > 0 ? o.tolerance : 10;
    const modes = Array.isArray(o.modes) ? o.modes
      : ['vertex', 'edgeMid', 'perpendicular', 'grid', 'ortho'];

    if (modes.indexOf('vertex') >= 0 && Array.isArray(o.vertices) && o.vertices.length) {
      let best = null;
      let bestD = tol + 1;
      for (const v of o.vertices) {
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d <= tol && d < bestD) { best = v; bestD = d; }
      }
      if (best) {
        return {
          x: best.x, y: best.y, snapped: true, kind: 'vertex',
          isStart: best._isStart === true
        };
      }
    }

    if (modes.indexOf('edgeMid') >= 0 && Array.isArray(o.edges) && o.edges.length) {
      const r = snapToEdgeMidpoint(p, o.edges, tol);
      if (r && r.snapped) return r;
    }

    if (modes.indexOf('perpendicular') >= 0 && o.prev && Array.isArray(o.edges) && o.edges.length) {
      const r = snapPerpendicular(o.prev, p, o.edges, tol);
      if (r && r.snapped) return r;
    }

    if (modes.indexOf('grid') >= 0 && Number.isFinite(o.gridStep) && o.gridStep > 0) {
      return {
        x: snap(p.x, o.gridStep),
        y: snap(p.y, o.gridStep),
        snapped: true,
        kind: 'grid'
      };
    }

    if (modes.indexOf('angle') >= 0 && o.ctrlHeld && o.shiftHeld && o.prev) {
      return snapAngle(o.prev, p, 15);
    }

    if (modes.indexOf('ortho') >= 0 && o.shiftHeld && o.prev) {
      return orthoSnap(o.prev, p, true);
    }

    return p;
  }

  // ============================================================
  // POLYGON MATH
  // ============================================================

  /** Ray-casting point-in-polygon test. */
  function pointInPolygon(p, poly) {
    if (!p || !Array.isArray(poly) || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const hits = ((yi > p.y) !== (yj > p.y))
        && (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-9) + xi);
      if (hits) inside = !inside;
    }
    return inside;
  }

  /** Shoelace polygon area in pixel² — always positive. */
  function polygonAreaPx(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      a += points[i].x * points[j].y;
      a -= points[j].x * points[i].y;
    }
    return Math.abs(a) / 2;
  }

  /** Closed polygon perimeter in pixel units. */
  function polygonPerimeterPx(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let p = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      p += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return p;
  }

  /** Open polyline length in pixel units (cable runs, LED runs, line measurements). */
  function polylineLengthPx(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  }

  // ============================================================
  // UNIT CONVERSION
  // ============================================================

  const UNIT_TO_METRES = {
    m:  1,
    cm: 0.01,
    mm: 0.001,
    ft: 0.3048,
    in: 0.0254
  };

  function unitToMetres(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return null;
    const factor = UNIT_TO_METRES[String(unit || 'm').toLowerCase()];
    if (!Number.isFinite(factor)) return null;
    return v * factor;
  }

  function pxToMetres(px, scalePxPerM) {
    if (!Number.isFinite(scalePxPerM) || scalePxPerM <= 0) return null;
    if (!Number.isFinite(px)) return null;
    return px / scalePxPerM;
  }

  function metresToPx(metres, scalePxPerM) {
    if (!Number.isFinite(scalePxPerM) || scalePxPerM <= 0) return null;
    if (!Number.isFinite(metres)) return null;
    return metres * scalePxPerM;
  }

  function formatMetres(m) {
    if (m == null || !Number.isFinite(m)) return '—';
    if (m >= 1) return m.toFixed(2) + ' m';
    return Math.round(m * 1000) + ' mm';
  }

  // ============================================================
  // v1.2.0 — RECTANGLE HELPERS (for routing obstacles)
  // ============================================================

  /**
   * Return a new rect inflated by `pad` pixels on every side. Useful for
   * giving the router breathing room around device nodes so wires don't
   * skim the edge.
   * @param {{left:number, top:number, right:number, bottom:number}} r
   * @param {number} pad
   */
  function inflateRect(r, pad) {
    const p = Number.isFinite(pad) ? pad : 0;
    return { left: r.left - p, top: r.top - p, right: r.right + p, bottom: r.bottom + p, id: r.id };
  }

  /** True if two axis-aligned rects overlap (touching edges count as overlap). */
  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  /** True if a point is strictly inside (not on edge of) the rect. */
  function pointInRect(x, y, r) {
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }

  // ============================================================
  // v1.2.0 — MIN-HEAP PRIORITY QUEUE (for A*)
  // ============================================================
  //
  // Binary min-heap. Without this, A* on a 200×200 grid is dog-slow.
  // Pure JS, no deps, ~50 lines. Used internally by routeOrthogonalEdge.

  function _heapPush(heap, key, value) {
    heap.push({ key, value });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].key <= heap[i].key) break;
      const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
      i = parent;
    }
  }

  function _heapPop(heap) {
    if (heap.length === 0) return null;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      const n = heap.length;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let smallest = i;
        if (l < n && heap[l].key < heap[smallest].key) smallest = l;
        if (r < n && heap[r].key < heap[smallest].key) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i]; heap[i] = heap[smallest]; heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }

  // ============================================================
  // v1.2.0 — ORTHOGONAL EDGE ROUTER (A* on integer grid)
  // ============================================================
  //
  // The headline addition. Pure-math implementation of orthogonal A*
  // edge routing for AV signal-flow diagrams, network topology, cable
  // runs, and any other context where two ports/handles need to be
  // connected with a clean right-angle path that avoids device nodes
  // and respects parallel-edge spacing.
  //
  // Implements the aesthetic spec published in EasySchematic's
  // ROUTING_RULES.md (R1–R11). Algorithm reimplemented from the
  // documented specification, not copied from any GPL/AGPL source.
  //
  // ALGORITHM SUMMARY
  //   - Snap pixel-space inputs to an integer grid (default cell = 20 px).
  //   - Build obstacle list from caller's device rects, inflated by `pad`
  //     grid cells. Source and target nodes are excluded (callers pass
  //     their IDs in `excludeIds`).
  //   - A* state is (xi, yi, dir) where dir ∈ {0=R,1=D,2=L,3=U}. The
  //     direction component prevents the closed set from rejecting valid
  //     re-arrivals from a different direction (the #1 mistake in naive
  //     grid A*).
  //   - Cost = step-distance + turnPenalty × direction-changes
  //              + overlapPenalty × existing-edge-corridor-crossings
  //              + crossPenalty   × perpendicular-edge crossings.
  //   - Heuristic = Manhattan distance to goal cell (admissible).
  //   - Hard constraints:
  //       R1: never enter an obstacle cell;
  //       R2: arrival at goal must be horizontal (LEFT or RIGHT step);
  //       R3: only N/S/E/W moves (no diagonals — orthogonal only);
  //       R4: source/target stubs forced to horizontal by snapping the
  //           start/end positions outwards from the device side.
  //
  //   Output is a list of pixel-space waypoints suitable for direct
  //   rendering by any consumer (SVG <path>, fabric Polyline, Canvas
  //   moveTo/lineTo, etc.). Call `simplifyOrthogonalPath` to collapse
  //   collinear runs, then `emitOrthogonalSvgPath` for a rounded-corner
  //   SVG path string.
  //
  // API
  //   routeOrthogonalEdge(opts) → { found, waypoints, cost, iterations }
  //
  //   opts:
  //     source: { x, y, side? }     — pixel coords + side hint
  //                                  ('left' | 'right' | 'top' | 'bottom').
  //                                  side defaults to 'right'.
  //     target: { x, y, side? }     — side defaults to 'left'.
  //     obstacles: [{left, top, right, bottom, id?}]
  //     excludeIds: [string]         — obstacle IDs to skip (source/target
  //                                  device IDs go here so the router can
  //                                  exit/enter them).
  //     cellSize: 20                 — grid resolution in px.
  //     pad: 1                       — obstacle padding in grid cells.
  //     stub: 1                      — forced stub length in grid cells.
  //     escapeMargin: 4              — extra cells around bbox.
  //     turnPenalty: 7
  //     overlapPenalty: 20
  //     crossPenalty: 12
  //     existingEdges: []            — array of waypoint lists from
  //                                  already-routed edges (for separation +
  //                                  crossing accounting).
  //     existingEdgeSignalTypes: []  — same length as existingEdges; signal
  //                                  type per existing edge (for R11
  //                                  cross-type extra separation).
  //     signalType: 'hdmi'           — this edge's signal type (R11).
  //     crossTypeBonus: 1            — extra penalty cells when crossing a
  //                                  different-signal-type edge corridor.
  //     maxIterations: 80000         — safety. Returns found:false if hit.
  //
  // PERFORMANCE
  //   Typical Sonor schematic (30-40 devices, 400×600 px each, total
  //   canvas ~3000×2000 px → 150×100 cells = 15 000 cells) routes a
  //   single edge in ~5 000-20 000 iterations, ~1-5 ms on modern JS.
  //   100 edges → 100-500 ms total. Acceptable for interactive use
  //   when batched outside the input loop; for live drag-feedback,
  //   pre-route or use the simpler straight-stub path.

  const _DIR_DX = [1, 0, -1, 0];   // 0=R, 1=D, 2=L, 3=U
  const _DIR_DY = [0, 1, 0, -1];
  const _DIR_HORIZ = [true, false, true, false];

  function _sideToDir(side, isSource) {
    // Source exits AWAY from device side; target arrives TOWARD device side.
    // Both phrased as the direction the wire is travelling at that handle.
    switch (String(side || '').toLowerCase()) {
      case 'left':   return isSource ? 2 : 0;
      case 'right':  return isSource ? 0 : 2;
      case 'top':    return isSource ? 3 : 1;
      case 'bottom': return isSource ? 1 : 3;
      default:       return isSource ? 0 : 2; // default: exit-right, enter-from-left
    }
  }

  /**
   * Build a fast obstacle lookup. Returns a function `isBlocked(xi, yi)`
   * that's O(obstacles) per call but cheap for typical schematic sizes.
   * For larger scenes a spatial index (grid bucket) would be faster; kept
   * linear here for clarity since N is small in real Sonor projects.
   */
  function _buildObstacleQuery(obstacles, excludeIds, cellSize, pad) {
    const grid = obstacles
      .filter(r => !excludeIds || excludeIds.indexOf(r.id) < 0)
      .map(r => ({
        left:   Math.floor((r.left   - pad * cellSize) / cellSize),
        top:    Math.floor((r.top    - pad * cellSize) / cellSize),
        right:  Math.ceil ((r.right  + pad * cellSize) / cellSize),
        bottom: Math.ceil ((r.bottom + pad * cellSize) / cellSize),
      }));
    return function isBlocked(xi, yi) {
      for (let k = 0; k < grid.length; k++) {
        const g = grid[k];
        if (xi >= g.left && xi <= g.right && yi >= g.top && yi <= g.bottom) return true;
      }
      return false;
    };
  }

  /**
   * Build a "corridor" overlay for existing edges so the router can
   * apply OVERLAP_PENALTY when stepping into a cell that already
   * carries a wire of the same signal type, and CROSSING_PENALTY when
   * crossing perpendicular to one. Stored as two Maps keyed by
   * (yi * GRID_W + xi) for O(1) lookup.
   *
   * The structure stores per-cell:
   *   horizontal: how many existing horizontal segments pass through
   *   vertical:   how many existing vertical segments pass through
   *   signalSet:  Set of signalTypes present at this cell
   */
  function _buildEdgeCorridorMap(existingEdges, signalTypes, cellSize) {
    const m = new Map();
    function bump(xi, yi, isHoriz, sigType) {
      const k = xi + ',' + yi;
      let e = m.get(k);
      if (!e) { e = { h: 0, v: 0, sigs: [] }; m.set(k, e); }
      if (isHoriz) e.h++; else e.v++;
      if (sigType && e.sigs.indexOf(sigType) < 0) e.sigs.push(sigType);
    }
    if (!Array.isArray(existingEdges)) return m;
    for (let e = 0; e < existingEdges.length; e++) {
      const wps = existingEdges[e];
      const sig = (signalTypes && signalTypes[e]) || null;
      if (!Array.isArray(wps) || wps.length < 2) continue;
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        const axi = Math.round(a.x / cellSize), ayi = Math.round(a.y / cellSize);
        const bxi = Math.round(b.x / cellSize), byi = Math.round(b.y / cellSize);
        if (axi === bxi) {
          // vertical segment
          const y0 = Math.min(ayi, byi), y1 = Math.max(ayi, byi);
          for (let y = y0; y <= y1; y++) bump(axi, y, false, sig);
        } else if (ayi === byi) {
          // horizontal segment
          const x0 = Math.min(axi, bxi), x1 = Math.max(axi, bxi);
          for (let x = x0; x <= x1; x++) bump(x, ayi, true, sig);
        }
      }
    }
    return m;
  }

  /**
   * The main router. See block comment above for full API.
   */
  function routeOrthogonalEdge(opts) {
    const o = opts || {};
    const cellSize = Number.isFinite(o.cellSize) ? o.cellSize : 20;
    const pad      = Number.isFinite(o.pad)      ? o.pad      : 1;
    const stub     = Number.isFinite(o.stub)     ? o.stub     : 1;
    const margin   = Number.isFinite(o.escapeMargin) ? o.escapeMargin : 4;
    const turnPen  = Number.isFinite(o.turnPenalty)  ? o.turnPenalty  : 7;
    const overlapPen = Number.isFinite(o.overlapPenalty) ? o.overlapPenalty : 20;
    const crossPen   = Number.isFinite(o.crossPenalty)   ? o.crossPenalty   : 12;
    const crossTypeBonus = Number.isFinite(o.crossTypeBonus) ? o.crossTypeBonus : 1;
    const maxIter  = Number.isFinite(o.maxIterations) ? o.maxIterations : 80000;
    const obstacles = Array.isArray(o.obstacles) ? o.obstacles : [];
    const excludeIds = Array.isArray(o.excludeIds) ? o.excludeIds : [];
    const sigType = o.signalType || null;

    if (!o.source || !o.target) return { found: false, waypoints: [], cost: 0, iterations: 0 };

    // Build source/target endpoints in grid space, including the forced
    // horizontal stub to honour R2 + R4. We shift the start/end points
    // OUTWARDS from the device side by `stub` cells.
    const sDir = _sideToDir(o.source.side, true);
    const tDir = _sideToDir(o.target.side, false);
    const srcCellX = Math.round(o.source.x / cellSize);
    const srcCellY = Math.round(o.source.y / cellSize);
    const tgtCellX = Math.round(o.target.x / cellSize);
    const tgtCellY = Math.round(o.target.y / cellSize);
    const srcStubX = srcCellX + _DIR_DX[sDir] * stub;
    const srcStubY = srcCellY + _DIR_DY[sDir] * stub;
    const tgtStubX = tgtCellX - _DIR_DX[tDir] * stub; // step BACK from target along entry dir
    const tgtStubY = tgtCellY - _DIR_DY[tDir] * stub;

    // Bounding box for search (with margin) — A* never explores outside.
    const allX = [srcStubX, tgtStubX, srcCellX, tgtCellX];
    const allY = [srcStubY, tgtStubY, srcCellY, tgtCellY];
    for (const r of obstacles) {
      allX.push(Math.floor((r.left - pad * cellSize) / cellSize));
      allX.push(Math.ceil ((r.right + pad * cellSize) / cellSize));
      allY.push(Math.floor((r.top - pad * cellSize) / cellSize));
      allY.push(Math.ceil ((r.bottom + pad * cellSize) / cellSize));
    }
    const minX = Math.min.apply(null, allX) - margin;
    const maxX = Math.max.apply(null, allX) + margin;
    const minY = Math.min.apply(null, allY) - margin;
    const maxY = Math.max.apply(null, allY) + margin;

    const isBlocked = _buildObstacleQuery(obstacles, excludeIds, cellSize, pad);
    const corridors = _buildEdgeCorridorMap(o.existingEdges, o.existingEdgeSignalTypes, cellSize);

    // State key: xi * 4 + dir, ranged on yi. We use Map<string, ...>
    // keyed by `${xi},${yi},${dir}` for clarity over micro-opt.
    const gScore = new Map();
    const cameFrom = new Map();
    const open = []; // min-heap entries: { key: f, value: state }
    const startKey = srcStubX + ',' + srcStubY + ',' + sDir;
    gScore.set(startKey, 0);
    _heapPush(open, manhattan(srcStubX, srcStubY, tgtStubX, tgtStubY), {
      xi: srcStubX, yi: srcStubY, dir: sDir, g: 0
    });

    let iterations = 0;
    let found = null;
    while (open.length > 0 && iterations < maxIter) {
      iterations++;
      const cur = _heapPop(open).value;
      // Goal test: arrived at target stub cell, heading in the right dir
      if (cur.xi === tgtStubX && cur.yi === tgtStubY && cur.dir === tDir) {
        found = cur; break;
      }
      // Goal test (relaxed): same cell but any horizontal dir — we'll fix dir later
      if (cur.xi === tgtStubX && cur.yi === tgtStubY && _DIR_HORIZ[cur.dir]) {
        found = cur; break;
      }

      for (let nd = 0; nd < 4; nd++) {
        const nxi = cur.xi + _DIR_DX[nd];
        const nyi = cur.yi + _DIR_DY[nd];
        if (nxi < minX || nxi > maxX || nyi < minY || nyi > maxY) continue;
        if (isBlocked(nxi, nyi)) continue;

        let stepCost = 1;
        if (nd !== cur.dir) stepCost += turnPen;

        // Corridor penalties
        const cellKey = nxi + ',' + nyi;
        const corridor = corridors.get(cellKey);
        if (corridor) {
          const stepIsHoriz = _DIR_HORIZ[nd];
          if (stepIsHoriz && corridor.h > 0) stepCost += overlapPen;
          if (!stepIsHoriz && corridor.v > 0) stepCost += overlapPen;
          // perpendicular crossing
          if (stepIsHoriz && corridor.v > 0) stepCost += crossPen;
          if (!stepIsHoriz && corridor.h > 0) stepCost += crossPen;
          // cross-type extra separation (R11)
          if (sigType && corridor.sigs.length > 0 && corridor.sigs.indexOf(sigType) < 0) {
            stepCost += crossTypeBonus * (corridor.h + corridor.v);
          }
        }

        const newG = cur.g + stepCost;
        const stateKey = nxi + ',' + nyi + ',' + nd;
        if (gScore.has(stateKey) && gScore.get(stateKey) <= newG) continue;
        gScore.set(stateKey, newG);
        cameFrom.set(stateKey, cur.xi + ',' + cur.yi + ',' + cur.dir);
        const fScore = newG + manhattan(nxi, nyi, tgtStubX, tgtStubY);
        _heapPush(open, fScore, { xi: nxi, yi: nyi, dir: nd, g: newG });
      }
    }

    if (!found) return { found: false, waypoints: [], cost: 0, iterations };

    // Reconstruct waypoints (grid → pixel)
    const gridWaypoints = [];
    let cursor = found.xi + ',' + found.yi + ',' + found.dir;
    let safety = 0;
    while (cursor && safety++ < maxIter) {
      const parts = cursor.split(',');
      gridWaypoints.push({ xi: +parts[0], yi: +parts[1] });
      cursor = cameFrom.get(cursor);
    }
    gridWaypoints.reverse();

    const waypoints = [];
    waypoints.push({ x: o.source.x, y: o.source.y });
    for (const gp of gridWaypoints) {
      waypoints.push({ x: gp.xi * cellSize, y: gp.yi * cellSize });
    }
    waypoints.push({ x: o.target.x, y: o.target.y });

    // Force the source stub to be horizontal: insert/replace 2nd waypoint
    // so the first segment runs only in the source-exit direction.
    if (waypoints.length >= 2 && _DIR_HORIZ[sDir]) {
      waypoints[1] = { x: waypoints[1].x, y: o.source.y };
    } else if (waypoints.length >= 2) {
      waypoints[1] = { x: o.source.x, y: waypoints[1].y };
    }
    // Same for the target stub (force last segment horizontal/vertical).
    if (waypoints.length >= 2 && _DIR_HORIZ[tDir]) {
      waypoints[waypoints.length - 2] = { x: waypoints[waypoints.length - 2].x, y: o.target.y };
    } else if (waypoints.length >= 2) {
      waypoints[waypoints.length - 2] = { x: o.target.x, y: waypoints[waypoints.length - 2].y };
    }

    const simplified = simplifyOrthogonalPath(waypoints);
    return { found: true, waypoints: simplified, cost: found.g, iterations };
  }

  function manhattan(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  // ============================================================
  // v1.2.0 — ORTHOGONAL PATH SIMPLIFIER
  // ============================================================

  /**
   * Collapse collinear runs in an orthogonal path. The A* output usually
   * contains long runs of consecutive cells in the same direction; for
   * rendering we only need the corners. Pure function — never mutates
   * the input.
   * @param {Array<{x:number, y:number}>} waypoints
   * @returns {Array<{x:number, y:number}>}
   */
  function simplifyOrthogonalPath(waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 3) {
      return Array.isArray(waypoints) ? waypoints.slice() : [];
    }
    const out = [waypoints[0]];
    for (let i = 1; i < waypoints.length - 1; i++) {
      const a = out[out.length - 1];
      const b = waypoints[i];
      const c = waypoints[i + 1];
      const colinearH = (a.y === b.y) && (b.y === c.y);
      const colinearV = (a.x === b.x) && (b.x === c.x);
      if (!colinearH && !colinearV) out.push(b);
    }
    out.push(waypoints[waypoints.length - 1]);
    return out;
  }

  // ============================================================
  // v1.2.0 — SVG PATH EMITTER (with rounded corners)
  // ============================================================

  /**
   * Convert a list of orthogonal waypoints into an SVG `d` string with
   * rounded corners. Caller is responsible for wrapping in <path>.
   *
   * @param {Array<{x:number, y:number}>} waypoints
   * @param {object} opts
   *   - cornerRadius: number (default 8) — px
   * @returns {string} — SVG path data (e.g. "M 10 20 L 30 20 Q 35 20 35 25 ...")
   */
  function emitOrthogonalSvgPath(waypoints, opts) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) return '';
    const radius = Math.max(0, (opts && Number.isFinite(opts.cornerRadius)) ? opts.cornerRadius : 8);
    if (waypoints.length === 1) {
      return 'M ' + waypoints[0].x + ' ' + waypoints[0].y;
    }
    if (radius === 0 || waypoints.length === 2) {
      let d = 'M ' + waypoints[0].x + ' ' + waypoints[0].y;
      for (let i = 1; i < waypoints.length; i++) d += ' L ' + waypoints[i].x + ' ' + waypoints[i].y;
      return d;
    }
    let d = 'M ' + waypoints[0].x + ' ' + waypoints[0].y;
    for (let i = 1; i < waypoints.length - 1; i++) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      const c = waypoints[i + 1];
      // Determine clip distances (cap radius by half of shorter segment)
      const lenIn  = Math.hypot(b.x - a.x, b.y - a.y);
      const lenOut = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(radius, lenIn / 2, lenOut / 2);
      // Point on a→b at distance r before b
      const ux1 = (b.x - a.x) / (lenIn || 1);
      const uy1 = (b.y - a.y) / (lenIn || 1);
      // Point on b→c at distance r after b
      const ux2 = (c.x - b.x) / (lenOut || 1);
      const uy2 = (c.y - b.y) / (lenOut || 1);
      const p1x = b.x - ux1 * r;
      const p1y = b.y - uy1 * r;
      const p2x = b.x + ux2 * r;
      const p2y = b.y + uy2 * r;
      d += ' L ' + p1x + ' ' + p1y;
      d += ' Q ' + b.x + ' ' + b.y + ' ' + p2x + ' ' + p2y;
    }
    const last = waypoints[waypoints.length - 1];
    d += ' L ' + last.x + ' ' + last.y;
    return d;
  }

  // ============================================================
  // v1.2.0 — EDGE CROSSING DETECTOR (line-jump arc positions)
  // ============================================================

  /**
   * Find all pixel-coordinate points where edges in `setA` cross over
   * edges in `setB` perpendicularly. Use the returned points to render
   * "line-jump" arcs at intersections (a tiny semicircle over the
   * lower-layer wire). Same-direction overlap is not reported.
   *
   * @param {Array<Array<{x,y}>>} setA — array of waypoint lists
   * @param {Array<Array<{x,y}>>} setB — array of waypoint lists (can be == setA)
   * @returns {Array<{x:number, y:number, edgeA:number, edgeB:number}>}
   */
  function detectEdgeCrossings(setA, setB) {
    const out = [];
    if (!Array.isArray(setA) || !Array.isArray(setB)) return out;
    function segs(wps) {
      const r = [];
      if (!Array.isArray(wps)) return r;
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        if (a.x === b.x) r.push({ vertical: true, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
        else if (a.y === b.y) r.push({ vertical: false, y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
      }
      return r;
    }
    for (let i = 0; i < setA.length; i++) {
      const sa = segs(setA[i]);
      for (let j = 0; j < setB.length; j++) {
        if (setA[i] === setB[j]) continue; // skip same edge
        const sb = segs(setB[j]);
        for (const a of sa) {
          for (const b of sb) {
            if (a.vertical && !b.vertical) {
              if (a.x >= b.x0 && a.x <= b.x1 && b.y >= a.y0 && b.y <= a.y1) {
                out.push({ x: a.x, y: b.y, edgeA: i, edgeB: j });
              }
            } else if (!a.vertical && b.vertical) {
              if (b.x >= a.x0 && b.x <= a.x1 && a.y >= b.y0 && a.y <= b.y1) {
                out.push({ x: b.x, y: a.y, edgeA: i, edgeB: j });
              }
            }
          }
        }
      }
    }
    return out;
  }

  // ============================================================
  // v1.2.0 — PARALLEL EDGE OFFSET COMPUTER
  // ============================================================

  /**
   * Group edges whose vertical-segment centerX (or horizontal-segment
   * centerY) falls within `centerThreshold` of each other, and assign
   * each a perpendicular offset so their parallel segments don't stack.
   *
   * This is the function that prevents "10 speaker cables all running on
   * the same vertical line" — call it BEFORE final rendering and apply
   * each returned offset to the interior waypoints of the matching edge.
   *
   * @param {Array<{id:string|number, waypoints:Array<{x,y}>}>} edges
   * @param {object} opts
   *   - gap: number (default 12) — px between parallel edges
   *   - centerThreshold: number (default 15) — px
   *   - axis: 'x' | 'y' (default 'x' — group by vertical-segment centerX)
   * @returns {Map<id, {dx:number, dy:number}>}
   */
  function computeParallelEdgeOffsets(edges, opts) {
    const o = opts || {};
    const gap = Number.isFinite(o.gap) ? o.gap : 12;
    const thresh = Number.isFinite(o.centerThreshold) ? o.centerThreshold : 15;
    const axis = (o.axis === 'y') ? 'y' : 'x';
    const offsets = new Map();
    if (!Array.isArray(edges) || edges.length < 2) return offsets;

    // For each edge, compute its "center" (mid-point of the longest
    // segment along the chosen axis). Edges with similar centers form
    // a group.
    const summaries = edges.map(e => {
      const wps = e.waypoints || [];
      let center = 0;
      let length = 0;
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        if (axis === 'x' && a.x === b.x) {
          const len = Math.abs(b.y - a.y);
          if (len > length) { length = len; center = a.x; }
        } else if (axis === 'y' && a.y === b.y) {
          const len = Math.abs(b.x - a.x);
          if (len > length) { length = len; center = a.y; }
        }
      }
      return { id: e.id, center, length };
    });

    // Sort by center, then group adjacents within threshold.
    const sorted = summaries.slice().sort((a, b) => a.center - b.center);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && (sorted[j + 1].center - sorted[i].center) <= thresh) j++;
      const groupSize = j - i + 1;
      if (groupSize > 1) {
        // Spread group across gap × (groupSize - 1) centred on group mid.
        const total = gap * (groupSize - 1);
        const start = -total / 2;
        for (let k = i; k <= j; k++) {
          const offsetMagnitude = start + (k - i) * gap;
          offsets.set(sorted[k].id, axis === 'x'
            ? { dx: offsetMagnitude, dy: 0 }
            : { dx: 0, dy: offsetMagnitude });
        }
      }
      i = j + 1;
    }
    return offsets;
  }

  // ============================================================
  // v1.2.0 — PORT HANDLE ANCHOR
  // ============================================================

  /**
   * Compute the pixel position + side of a port handle on a device node.
   * Standard layout: ports stack vertically along the LEFT and RIGHT
   * sides of the device, evenly spaced. Inputs hang on the LEFT, outputs
   * on the RIGHT (caller can swap by passing side directly).
   *
   * @param {object} device — { x, y, width, height }
   * @param {object} portSpec — { index, total, side: 'left'|'right'|'top'|'bottom' }
   * @param {object} opts
   *   - headerHeight: number (default 40) — top of device reserved for label
   *   - portStride:   number (default 20) — px between ports
   *   - padding:      number (default 0)  — inset from device edge
   * @returns {{x:number, y:number, side:string}}
   */
  function portHandleAnchor(device, portSpec, opts) {
    const o = opts || {};
    const header = Number.isFinite(o.headerHeight) ? o.headerHeight : 40;
    const stride = Number.isFinite(o.portStride)   ? o.portStride   : 20;
    const pad    = Number.isFinite(o.padding)      ? o.padding      : 0;
    const side = (portSpec && portSpec.side) || 'left';
    const idx = (portSpec && Number.isFinite(portSpec.index)) ? portSpec.index : 0;
    const total = (portSpec && Number.isFinite(portSpec.total)) ? portSpec.total : 1;

    const dx = device.x, dy = device.y;
    const dw = device.width, dh = device.height;
    let x = dx, y = dy;
    if (side === 'left' || side === 'right') {
      y = dy + header + (idx + 0.5) * stride;
      x = (side === 'left') ? dx - pad : dx + dw + pad;
    } else {
      // top / bottom — distribute along width
      const spacing = dw / (total + 1);
      x = dx + spacing * (idx + 1);
      y = (side === 'top') ? dy - pad : dy + dh + pad;
    }
    return { x, y, side };
  }

  // ============================================================
  // EXPORT
  // ============================================================

  const api = {
    // Distance
    dist,
    // Snap + ortho
    snap,
    orthoSnap,
    // v1.1.0 — extended snap modes
    snapToEdgeMidpoint,
    snapPerpendicular,
    snapAngle,
    snapResult,
    // Polygon + polyline
    pointInPolygon,
    polygonAreaPx,
    polygonPerimeterPx,
    polylineLengthPx,
    // Unit conversion
    unitToMetres,
    pxToMetres,
    metresToPx,
    formatMetres,
    // v1.2.0 — Routing + rendering
    inflateRect,
    rectsOverlap,
    pointInRect,
    routeOrthogonalEdge,
    simplifyOrthogonalPath,
    emitOrthogonalSvgPath,
    detectEdgeCrossings,
    computeParallelEdgeOffsets,
    portHandleAnchor,
    // Constants (read-only)
    UNIT_TO_METRES: Object.freeze({ ...UNIT_TO_METRES }),
    // Default routing parameters — exposed so consumers can read/override
    // for app-specific tuning without changing the algorithm.
    ROUTING_DEFAULTS: Object.freeze({
      cellSize: 20,
      pad: 1,
      stub: 1,
      escapeMargin: 4,
      turnPenalty: 7,
      overlapPenalty: 20,
      crossPenalty: 12,
      crossTypeBonus: 1,
      maxIterations: 80000,
      cornerRadius: 8,
      parallelGap: 12,
      centerThreshold: 15,
    }),
    // Version marker for idempotent-load guard
    __version: '1.2.0'
  };

  if (typeof window !== 'undefined') {
    window.SonorDrawingCore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
