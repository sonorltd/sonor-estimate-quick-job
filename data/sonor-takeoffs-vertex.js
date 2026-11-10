// =============================================================================
// sonor-takeoffs-vertex.js — VERTEX EDITING drawing skill (canonical master)
// =============================================================================
// Workspace-shared module per Spine S-4.2. Edit at workspace root, then run
//   bash sync-everything.sh
// to propagate to APP - Takeoffs/data/. NEVER edit the per-app copy.
//
// v1.0.0 (2026-07-12, Bryn: "building outline points should be better visible
// and use same drawing skills as rooms like double click to add or delete a
// point, make this a shared module drawing skill"). ONE place owns the
// per-vertex editing mechanic for every polygon/polyline kind:
//
//   .init({ positionHandler, actionHandler, anchorWrapper, resolveChild,
//           getWorldPoints })          — host injects its proven fabric
//                                        transform handlers (group-aware,
//                                        pathOffset-safe) + world-point reader
//   .registerKind({ key, match(t), closed, minPoints, style, setPoints(t,pts),
//                   [getPoints(t)] })  — one registration per drawable kind
//   .attach(target) -> bool            — builds styled per-vertex fabric
//                                        controls (HIGH-VISIBILITY handles)
//   .handleDblclick(target, worldPt, [opts]) -> true | 'min' | false
//        near a VERTEX  (<= 9 world px) -> delete it (guarded by minPoints)
//        near an EDGE   (<= 7 world px) -> insert a vertex at the projection
//   .nearestVertex(pts, p) / .nearestEdge(pts, p, closed) — pure, unit-tested
//
// Handle styles (the visibility fix):
//   room     — 12px white-filled circle, 2.5px stroke ring in the room colour
//   outline  — 13px charcoal diamond with white ring (reads over any plan ink)
//   endpoint — filled circle in stroke colour (polyline start/end)
//   interior — white square with stroke-colour border (polyline bends)
//
// Pure logic + fabric.Control construction only — no DOM, no app globals.
// =============================================================================
(function () {
  'use strict';

  var H = { positionHandler: null, actionHandler: null, anchorWrapper: null,
            resolveChild: null, getWorldPoints: null };
  var KINDS = [];

  function init(handlers) {
    for (var k in handlers) if (Object.prototype.hasOwnProperty.call(handlers, k)) H[k] = handlers[k];
  }
  function registerKind(spec) { if (spec && typeof spec.match === 'function') KINDS.push(spec); }
  function kindOf(t) {
    for (var i = 0; i < KINDS.length; i++) { try { if (KINDS[i].match(t)) return KINDS[i]; } catch (_) {} }
    return null;
  }
  function ready() {
    return !!(H.positionHandler && H.actionHandler && H.anchorWrapper && KINDS.length);
  }

  // ---- pure geometry -------------------------------------------------------
  function nearestVertex(pts, p) {
    var best = -1, d = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var dd = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
      if (dd < d) { d = dd; best = i; }
    }
    return { index: best, dist: d };
  }
  function nearestEdge(pts, p, closed) {
    var best = null, bd = Infinity;
    var lim = pts.length - (closed ? 0 : 1);
    for (var i = 0; i < lim; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var ex = b.x - a.x, ey = b.y - a.y;
      var len2 = ex * ex + ey * ey;
      if (len2 < 1) continue;
      var t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2;
      if (t < 0.05 || t > 0.95) continue;   // too close to a vertex — a delete zone
      var px = a.x + t * ex, py = a.y + t * ey;
      var d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = { edgeIndex: i, x: px, y: py, dist: d }; }
    }
    return best;
  }

  // ---- high-visibility handle renders --------------------------------------
  function _strokeOf(obj) {
    if (!obj) return '#c04d8c';
    if (obj.stroke) return obj.stroke;
    if (obj._objects && obj._objects[0] && obj._objects[0].stroke) return obj._objects[0].stroke;
    return '#c04d8c';
  }
  function _shadow(ctx) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 3; }
  var RENDER = {
    room: function (ctx, left, top, _s, obj) {
      ctx.save(); _shadow(ctx);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = _strokeOf(obj); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(left, top, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
    outline: function (ctx, left, top, _s, _obj) {
      ctx.save(); _shadow(ctx);
      ctx.translate(left, top); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#2C2218'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      var r = 5.5;
      ctx.fillRect(-r, -r, 2 * r, 2 * r); ctx.strokeRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
    },
    endpoint: function (ctx, left, top, _s, obj) {
      ctx.save(); _shadow(ctx);
      ctx.fillStyle = _strokeOf(obj); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(left, top, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
    interior: function (ctx, left, top, _s, obj) {
      ctx.save(); _shadow(ctx);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = _strokeOf(obj); ctx.lineWidth = 1.5;
      var s = 5;
      ctx.fillRect(left - s, top - s, s * 2, s * 2); ctx.strokeRect(left - s, top - s, s * 2, s * 2);
      ctx.restore();
    }
  };

  // ---- control building ----------------------------------------------------
  function attach(target) {
    if (!target || !ready() || typeof fabric === 'undefined') return false;
    var kind = kindOf(target);
    if (!kind) return false;
    var child = H.resolveChild ? H.resolveChild(target) : target;
    if (!child || !Array.isArray(child.points)) return false;
    var last = child.points.length - 1;
    var style = kind.style || 'room';
    target.controls = child.points.reduce(function (acc, _pt, idx) {
      var isEndpoint = (style === 'polyline') && (idx === 0 || idx === last);
      var render = (style === 'polyline')
        ? (isEndpoint ? RENDER.endpoint : RENDER.interior)
        : (RENDER[style] || RENDER.room);
      acc['p' + idx] = new fabric.Control({
        positionHandler: H.positionHandler,
        actionHandler: H.anchorWrapper(idx > 0 ? idx - 1 : last, H.actionHandler),
        actionName: kind.closed === false ? 'modifyPolyline' : 'modifyPolygon',
        pointIndex: idx,
        sizeX: 18, sizeY: 18, touchSizeX: 26, touchSizeY: 26,   // generous hit area
        render: render
      });
      return acc;
    }, {});
    if (typeof target.setControlVisible === 'function') target.setControlVisible('mtr', false);
    if (typeof target.setCoords === 'function') target.setCoords();
    return true;
  }

  // ---- dblclick insert / delete --------------------------------------------
  function handleDblclick(target, worldPt, opts) {
    if (!target || !worldPt) return false;
    var kind = kindOf(target);
    if (!kind || typeof kind.setPoints !== 'function') return false;
    var getPts = kind.getPoints || H.getWorldPoints;
    var pts = null;
    try { pts = getPts(target); } catch (_) {}
    if (!Array.isArray(pts) || pts.length < 2) return false;
    var closed = kind.closed !== false;
    var vTol = (opts && opts.vertexTolPx) || 9;
    var eTol = (opts && opts.edgeTolPx) || 7;
    var minP = kind.minPoints || (closed ? 3 : 2);

    var nv = nearestVertex(pts, worldPt);
    if (nv.index >= 0 && nv.dist <= vTol) {
      if (pts.length <= minP) return 'min';
      var del = pts.slice(); del.splice(nv.index, 1);
      kind.setPoints(target, del.map(function (p) { return { x: p.x, y: p.y }; }));
      return true;
    }
    var ne = nearestEdge(pts, worldPt, closed);
    if (ne && ne.dist <= eTol) {
      var ins = pts.slice();
      ins.splice(ne.edgeIndex + 1, 0, { x: ne.x, y: ne.y });
      kind.setPoints(target, ins.map(function (p) { return { x: p.x, y: p.y }; }));
      return true;
    }
    return false;
  }

  window.SonorVertexEdit = {
    VERSION: '1.0.0',
    init: init, registerKind: registerKind, attach: attach,
    handleDblclick: handleDblclick, kindOf: kindOf,
    nearestVertex: nearestVertex, nearestEdge: nearestEdge,
    get ready() { return ready(); }
  };
})();
