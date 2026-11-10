// sonor-cctv.js — CANONICAL MASTER (Spine v1.2.5 §16 family)
//
// Encapsulates every CCTV camera + cone behaviour in one focused module
// so debugging doesn't require grepping a 17.5k-line HTML. Bryn directive
// 2026-04-28: "make this as a module so its not hardcoded, and anything
// else you can make more efficient as troubleshooting big code eats
// tokens and time".
//
// Owns:
//   - Camera detection (_isCameraBlock predicate)
//   - Lens table (focal_mm → range_m + hfov_deg)
//   - Cone path math (pie-slice + wall-clipped variants)
//   - Cone z-order placement (above plan, below interactive layers)
//   - Rotation handler that rotates ONLY the cone (not the body/label)
//     per Bryn pivot v1.62.0
//   - Bearing persistence on sym.viewCone.bearing_deg (additionally
//     mirrored to sym.angle for back-compat with v1.46.x save format)
//
// Does NOT own:
//   - Symbol Group construction (placeSymbol / _restoreSymbol)
//   - Save/persistence path (saveState / _captureFloorPayload)
//   - Library glyph/shape resolution (_effectiveGlyphText)
//
// Loading patterns:
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
//   <script src="data/sonor-drawing-core.js"></script>
//   <script src="data/sonor-cctv.js"></script>
//   <script>
//     SonorCctv.init({
//       canvas: fabricCanvas,
//       servicesArray: SERVICES,
//       getRoomSegments: () => allRoomSegments,   // optional, for wall-clip
//       onAfterRebuild: () => {},                  // optional
//       debugFlag: '__SONOR_DEBUG_CCTV__'
//     });
//   </script>
//
// Then for each placed camera Group, the host code calls:
//   SonorCctv.attachCamera(group);   // wires rotation handler + initial cone
//   SonorCctv.rebuildCone(group);    // explicit rebuild on demand
//   SonorCctv.removeCone(group);     // cleanup on group removed
//
// Namespace: window.SonorCctv
//
// Version: 1.0.0 — initial extraction (2026-04-28 / Takeoffs v1.62.0)
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.SonorCctv && window.SonorCctv.__version) {
    return;
  }

  // ============================================================
  // INTERNAL STATE
  // ============================================================
  let _canvas = null;
  let _services = null;          // [{ key, nn, name, colour, ... }]
  let _getRoomSegments = null;   // optional () => [{ax,ay,bx,by}]
  let _onAfterRebuild = null;
  let _debugFlag = '__SONOR_DEBUG_CCTV__';
  let _scalePxPerMRef = null;    // optional () => number — current scale

  // ============================================================
  // LENS TABLE — focal length in mm → typical range + horizontal FoV
  // ============================================================
  // Standardised values for dome/bullet IP cameras. The host can override
  // by passing custom lensTable in init opts; otherwise these defaults
  // apply. Range in metres at recognisable-detection threshold.
  const DEFAULT_LENS_TABLE = [
    { id: '2.8', label: '2.8 mm wide',  focal_mm: 2.8, range_m: 8,  hfov_deg: 110 },
    { id: '4',   label: '4 mm standard', focal_mm: 4,   range_m: 14, hfov_deg: 85  },
    { id: '6',   label: '6 mm tele',    focal_mm: 6,   range_m: 22, hfov_deg: 55  },
    { id: '8',   label: '8 mm long',    focal_mm: 8,   range_m: 30, hfov_deg: 40  },
    { id: '12',  label: '12 mm zoom',   focal_mm: 12,  range_m: 45, hfov_deg: 28  },
    { id: 'fisheye', label: 'Fisheye 360°', focal_mm: 1.27, range_m: 12, hfov_deg: 360 },
    { id: 'doorbell', label: 'Doorbell wide', focal_mm: 1.55, range_m: 6, hfov_deg: 160 }
  ];
  let _lensTable = DEFAULT_LENS_TABLE.slice();
  function _lensById(id) {
    return _lensTable.find(l => String(l.id) === String(id)) || null;
  }

  // Per-camera-type default lens (by short_code). Host can override.
  const DEFAULT_TYPE_LENS = {
    BS: '4',     // Bullet Standard
    BL: '6',     // Bullet Long
    PT: '2.8',   // PTZ wide initial
    FS: 'fisheye',
    DB: 'doorbell',
    DM: '4'      // Dome (default)
  };
  let _typeLens = Object.assign({}, DEFAULT_TYPE_LENS);

  // ============================================================
  // CAMERA DETECTION
  // ============================================================
  function isCameraBlock(sym) {
    if (!sym) return false;
    return sym.service_nn === '08' && sym.service_sub === '1';
  }

  // ============================================================
  // EFFECTIVE VIEW CONE — resolve {enabled, lens, range, angle, bearing}
  // ============================================================
  function effectiveViewCone(sym) {
    if (!sym) return null;
    const stored = sym.viewCone || {};
    const sc = (sym.short_code || '').toUpperCase();
    const lensId = stored.lens_id || _typeLens[sc] || '4';
    const lens = _lensById(lensId) || _lensById('4') || _lensTable[0];
    return {
      enabled:      (stored.enabled !== false),
      lens_id:      lens.id,
      lens_label:   lens.label,
      focal_mm:     lens.focal_mm,
      range_m:      (Number(stored.radius_m)  > 0) ? Number(stored.radius_m)  : lens.range_m,
      angle_deg:    (Number(stored.angle_deg) > 0) ? Number(stored.angle_deg) : lens.hfov_deg,
      bearing_deg:  Number(stored.bearing_deg) || 0
    };
  }

  // ============================================================
  // PATH MATH — pie-slice + wall-clipped variants
  // ============================================================
  function viewConePathD(cx, cy, radius_px, angle_deg, bearing_deg) {
    if (!isFinite(radius_px) || radius_px <= 0) return '';
    if (angle_deg >= 360) {
      return `M ${cx-radius_px} ${cy} a ${radius_px} ${radius_px} 0 1 0 ${radius_px*2} 0 a ${radius_px} ${radius_px} 0 1 0 ${-radius_px*2} 0 Z`;
    }
    const half = (angle_deg / 2) * Math.PI / 180;
    const baseRad = (bearing_deg - 90) * Math.PI / 180;  // 0° = up (north)
    const startA = baseRad - half;
    const endA   = baseRad + half;
    const sx = cx + radius_px * Math.cos(startA);
    const sy = cy + radius_px * Math.sin(startA);
    const ex = cx + radius_px * Math.cos(endA);
    const ey = cy + radius_px * Math.sin(endA);
    const largeArc = (angle_deg > 180) ? 1 : 0;
    return `M ${cx} ${cy} L ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius_px} ${radius_px} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} Z`;
  }

  function _rayHitSegment(ox, oy, dx, dy, ax, ay, bx, by) {
    const sx = bx - ax, sy = by - ay;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-9) return Infinity;
    const ax2 = ax - ox, ay2 = ay - oy;
    const t = (ax2 * sy - ay2 * sx) / denom;
    const u = (ax2 * dy - ay2 * dx) / denom;
    if (t < 1e-6) return Infinity;
    if (u < 0 || u > 1) return Infinity;
    return t;
  }

  function viewConeClippedPathD(cx, cy, radius_px, angle_deg, bearing_deg, segments) {
    if (!isFinite(radius_px) || radius_px <= 0) return null;
    if (!Array.isArray(segments) || !segments.length) return null;
    const samples = Math.min(240, Math.max(8, Math.round(angle_deg)));
    const isFull = angle_deg >= 360;
    const half = (angle_deg / 2) * Math.PI / 180;
    const baseRad = (bearing_deg - 90) * Math.PI / 180;
    const startA = isFull ? 0 : (baseRad - half);
    const stepA = isFull ? (2 * Math.PI / samples) : ((angle_deg * Math.PI / 180) / samples);
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const a = startA + i * stepA;
      const dx = Math.cos(a), dy = Math.sin(a);
      let tMin = radius_px;
      for (let j = 0; j < segments.length; j++) {
        const s = segments[j];
        const t = _rayHitSegment(cx, cy, dx, dy, s.ax, s.ay, s.bx, s.by);
        if (t < tMin) tMin = t;
      }
      pts.push({ x: cx + dx * tMin, y: cy + dy * tMin });
    }
    if (isFull) {
      const head = pts[0];
      let d = `M ${head.x.toFixed(2)} ${head.y.toFixed(2)}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
      return d + ' Z';
    }
    let d = `M ${cx.toFixed(2)} ${cy.toFixed(2)}`;
    pts.forEach(p => { d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`; });
    return d + ' Z';
  }

  // ============================================================
  // Z-ORDER — place cone immediately above the plan image
  // ============================================================
  function placeConeAbovePlan(cone) {
    if (!cone || !_canvas) return;
    try {
      const objs = _canvas.getObjects();
      let planIdx = -1;
      for (let i = 0; i < objs.length; i++) {
        if (objs[i] && objs[i].sonorPlan) { planIdx = i; break; }
      }
      if (planIdx >= 0) _canvas.moveTo(cone, planIdx + 1);
      else              _canvas.sendToBack(cone);
    } catch (e) { /* never block on z-order */ }
  }

  // ============================================================
  // REBUILD CONE — main entry point
  // ============================================================
  function rebuildCone(group) {
    if (!group || !group.sonorSymbol || !_canvas) return null;
    if (!isCameraBlock(group.sonorSymbol)) return null;
    // Strip any existing cone
    if (group._sonorViewCone) {
      try { _canvas.remove(group._sonorViewCone); } catch (e) {}
      group._sonorViewCone = null;
    }
    const sym = group.sonorSymbol;
    const eff = effectiveViewCone(sym);
    if (!eff || !eff.enabled) return null;
    const cp = group.getCenterPoint ? group.getCenterPoint() : { x: group.left || 0, y: group.top || 0 };
    const pxPerM = (typeof _scalePxPerMRef === 'function') ? Number(_scalePxPerMRef() || 30) : 30;
    const radius_px = eff.range_m * pxPerM;
    // v1.62.0 — bearing comes ONLY from sym.viewCone.bearing_deg.
    // The legacy sym.angle field is the v1.46–v1.61 path that was
    // entangled with the group's own angle (which we now keep at 0).
    // Read viewCone first; fall back to sym.angle for legacy data.
    const bearing = (typeof eff.bearing_deg === 'number' && eff.bearing_deg !== 0)
      ? eff.bearing_deg
      : (Number(sym.angle) || 0);
    const segments = (typeof _getRoomSegments === 'function') ? _getRoomSegments() : [];
    let d = viewConeClippedPathD(cp.x, cp.y, radius_px, eff.angle_deg, bearing, segments);
    if (!d) d = viewConePathD(cp.x, cp.y, radius_px, eff.angle_deg, bearing);
    if (!d) return null;
    const svc = (Array.isArray(_services) && _services.find(s => s.key === 'security')) || { colour: '#ad9978' };
    const path = new fabric.Path(d, {
      fill: svc.colour, stroke: svc.colour, strokeWidth: 0.5, opacity: 0.08,
      selectable: false, evented: false, hoverCursor: 'default', objectCaching: false
    });
    path._sonorViewCone = true;
    path._sonorViewConeOwner = group;
    _canvas.add(path);
    placeConeAbovePlan(path);
    group._sonorViewCone = path;
    if (typeof window !== 'undefined' && window._cctvViewsHidden) path.visible = false;
    if (typeof _onAfterRebuild === 'function') {
      try { _onAfterRebuild(group, path); } catch (e) {}
    }
    return path;
  }

  function removeCone(group) {
    if (!group) return;
    if (group._sonorViewCone && _canvas) {
      try { _canvas.remove(group._sonorViewCone); } catch (e) {}
      group._sonorViewCone = null;
    }
  }

  // ============================================================
  // ROTATION HANDLER (Bryn pivot v1.62.0)
  // ============================================================
  // Rotate ONLY the cone, not the camera body or label. Strategy:
  //   1. Capture the angle Fabric tried to apply
  //   2. Persist as sym.viewCone.bearing_deg (also mirror to sym.angle
  //      for back-compat with older save formats)
  //   3. Reset group.angle to 0 — body + label stay upright
  //   4. Rebuild cone with the captured bearing
  //
  // Fabric will recompute t.angle on the next mousemove from startAngle
  // + cursor delta, so resetting to 0 each tick is safe — we're only
  // suppressing the visual application.
  function _onRotating(t) {
    if (!t || !t.sonorSymbol || !isCameraBlock(t.sonorSymbol)) return;
    const captured = (typeof t.angle === 'number') ? t.angle : 0;
    const sym = t.sonorSymbol;
    sym.angle = captured;                                 // legacy mirror
    if (!sym.viewCone) sym.viewCone = {};
    sym.viewCone.bearing_deg = captured;
    if (Math.abs(captured) > 0.01) {
      t.set({ angle: 0 });
      t.setCoords();
    }
    rebuildCone(t);
    _dbg('rotating', t, { capturedBearing: captured });
  }

  function _dbg(label, t, extra) {
    if (typeof window === 'undefined' || !window[_debugFlag]) return;
    try {
      const sym = t && t.sonorSymbol || {};
      const vc = sym.viewCone || {};
      console.log('[CCTV/' + label + ']',
        'group.angle=' + ((t && t.angle != null) ? Number(t.angle).toFixed(1) : 'null'),
        'bearing=' + (vc.bearing_deg != null ? Number(vc.bearing_deg).toFixed(1) : 'null'),
        'sym.angle=' + (sym.angle != null ? Number(sym.angle).toFixed(1) : 'null'),
        extra || '');
    } catch (e) {}
  }

  // ============================================================
  // ATTACH — wire one camera Group's per-instance event handlers
  // ============================================================
  function attachCamera(group) {
    if (!group || !group.sonorSymbol) return;
    if (!isCameraBlock(group.sonorSymbol)) return;
    // Idempotent — don't attach twice
    if (group._sonorCctvAttached) return;
    group._sonorCctvAttached = true;
    group.on('moving',   () => rebuildCone(group));
    group.on('removed',  () => removeCone(group));
    rebuildCone(group);
  }

  // ============================================================
  // BULK SWEEP — re-attach + re-render every camera on canvas
  // ============================================================
  function resyncAll() {
    if (!_canvas) return 0;
    let touched = 0;
    _canvas.getObjects().slice().forEach(o => {
      if (o && o.sonorSymbol && isCameraBlock(o.sonorSymbol)) {
        attachCamera(o);
        rebuildCone(o);
        touched++;
      }
    });
    // Drop orphan cones (owner gone)
    _canvas.getObjects().slice().forEach(o => {
      if (o && o._sonorViewCone === true) {
        const owner = o._sonorViewConeOwner;
        if (!owner || _canvas.getObjects().indexOf(owner) === -1) {
          try { _canvas.remove(o); } catch (e) {}
        }
      }
    });
    return touched;
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(opts) {
    if (!opts || !opts.canvas) {
      console.warn('[SonorCctv] init: missing required canvas option');
      return;
    }
    _canvas = opts.canvas;
    _services = opts.services || opts.servicesArray || null;
    _getRoomSegments = (typeof opts.getRoomSegments === 'function') ? opts.getRoomSegments : null;
    _onAfterRebuild = (typeof opts.onAfterRebuild === 'function') ? opts.onAfterRebuild : null;
    _scalePxPerMRef = (typeof opts.scalePxPerM === 'function') ? opts.scalePxPerM : null;
    if (opts.lensTable && Array.isArray(opts.lensTable)) _lensTable = opts.lensTable.slice();
    if (opts.typeLens && typeof opts.typeLens === 'object') _typeLens = Object.assign({}, _typeLens, opts.typeLens);
    if (opts.debugFlag) _debugFlag = String(opts.debugFlag);
    // Canvas-level rotation handler — single source of truth. Replaces
    // the per-group 'rotating' chain that v1.46.x → v1.61 patched repeatedly.
    _canvas.on('object:rotating', e => _onRotating(e && e.target));
    // Sweep at init in case cameras were placed before init() ran
    resyncAll();
  }

  // ============================================================
  // EXPORT
  // ============================================================
  const api = {
    init,
    isCameraBlock,
    effectiveViewCone,
    viewConePathD,
    viewConeClippedPathD,
    placeConeAbovePlan,
    rebuildCone,
    removeCone,
    attachCamera,
    resyncAll,
    // Lens table accessors
    getLensTable: () => _lensTable.slice(),
    setLensTable: (t) => { if (Array.isArray(t)) _lensTable = t.slice(); },
    // Debug
    setDebug: (on) => { try { window[_debugFlag] = !!on; } catch (e) {} },
    __version: '1.0.0'
  };
  if (typeof window !== 'undefined') window.SonorCctv = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
