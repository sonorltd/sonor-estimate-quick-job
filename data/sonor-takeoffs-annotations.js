/**
 * Sonor Takeoffs — Annotations primitive (canonical master)
 *
 * Workspace-shared module per Spine S-4.2. Edit at workspace root, then run
 *   bash sync-everything.sh
 * to propagate to APP - Takeoffs/data/.
 *
 * NEVER edit the per-app copy at APP - Takeoffs/data/sonor-takeoffs-annotations.js.
 *
 * Sixth canonical-master extraction (after sidebar / pdf / supabase / clouds /
 * containment). Encapsulates Text Box + Leader/Callout primitives shipped in
 * v3.1.0. Pure-logic + Fabric-construction helpers only — DOM-touching
 * orchestrators (modal open/save, mode click handlers, canvas mutations) stay
 * inline in sonor-takeoffs.html as delegate-with-fallback adapters.
 *
 * Exposes window.SonorTakeoffsAnnotations. API:
 *
 *   Text Box primitives
 *   ────────────────────
 *   .nextTextBoxId(canvas, floors, activeFloorId)
 *                                  — next 'NNN' three-digit id (zero-padded)
 *   .buildTextBox(point, opts)     — fabric.Textbox (wrapping, v5.161.0) with sonorTextBox metadata
 *
 *   Leader primitives
 *   ─────────────────
 *   .nextLeaderId(canvas, floors, activeFloorId)
 *                                  — next 'NNN' three-digit id (zero-padded)
 *   .isLeaderTarget(obj)           — predicate: true iff sonorTextBox || sonorRevCloud
 *   .computeTargetCentroid(obj)    — { x, y } from getBoundingRect, or null
 *   .makeLeaderArrow(tip, next)    — fabric.Polygon arrowhead at tip pointing
 *                                    toward `next`
 *   .buildLeaderPolyline(planAnchor, dogLeg, target, opts)
 *                                  — { line, arrow } where line is fabric.Polyline
 *                                    with sonorLeader metadata + arrow is the
 *                                    matching arrowhead. Caller adds both to
 *                                    canvas + cross-links via _sonorLeaderArrow /
 *                                    _sonorLeaderRef.
 *   .updateLeaderEndpoint(line, target)
 *                                  — mutates line.points[last] + rebuilds the
 *                                    arrowhead. Returns the new arrow polygon
 *                                    (caller swaps canvas.remove(oldArrow) +
 *                                    canvas.add(newArrow) + relinks). Returns
 *                                    null if target is invalid.
 *
 * Dependencies:
 *   - fabric.js v5+ (window.fabric) for buildXxx, makeLeaderArrow, updateLeaderEndpoint
 *
 * Last extracted from sonor-takeoffs.html v3.1.0 → v3.1.1 (2026-04-29).
 *
 * v3.2.1 (2026-04-29) — Leader UX corrections per Bryn:
 *   (a) Leader line is no longer the selectable handle. Line is selectable:false
 *       evented:false. The arrow polygon IS the user-facing handle:
 *       selectable:true, evented:true, hasControls:false, locked scale/rotation.
 *   (b) Leader colour inherits from target — revision clouds use status colour
 *       (added=#78ba57 / changed=#e37c59 / removed=#ec6061 / rfi=#8058a1 —
 *       RFI added 2026-07-12), text boxes default
 *       to charcoal #2C2218. New helper resolveLeaderColour(target).
 *       buildLeaderPolyline + makeLeaderArrow accept opts.colour. Caller
 *       (recolourLeadersForTarget — adapter inline in HTML) re-applies on
 *       cloud status flip.
 */
(function () {
  'use strict';

  var DEFAULT_LABEL_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var DEFAULT_INK = '#2C2218';
  var DEFAULT_TEXTBOX_BG = 'rgba(255,255,255,0.85)';
  var DEFAULT_LEADER_STROKE = '#2C2218';
  var DEFAULT_LEADER_WIDTH = 1.5;
  var ARROW_SIZE = 9;
  var ARROW_WING_ANGLE = Math.PI / 6; // 30°

  // ---------- Text Box primitives ----------

  // Walk every floor's textBoxes[] + the live canvas to avoid collisions
  // when user switches floors mid-session. Returns zero-padded 3-digit
  // string suitable for 'TXT-' prefixing by the caller.
  function nextTextBoxId(canvas, floors, activeFloorId) {
    var n = 0;
    try {
      if (canvas && typeof canvas.getObjects === 'function') {
        canvas.getObjects().forEach(function (o) {
          if (o && o.sonorTextBox) n++;
        });
      }
    } catch (_) {}
    try {
      if (Array.isArray(floors)) {
        floors.forEach(function (f) {
          if (f && f.id !== activeFloorId && Array.isArray(f.textBoxes)) {
            n += f.textBoxes.length;
          }
        });
      }
    } catch (_) {}
    return String(n + 1).padStart(3, '0');
  }

  function buildTextBox(point, opts) {
    if (!window.fabric) return null;
    opts = opts || {};
    // v5.167.0 TEXT-BOX METRICS ROOT CAUSE (the whole "text outside the box /
    // caret wrong" saga): fabric measures text at a normalised 400px and
    // scales down (charWidthsCache), but macOS `system-ui` (SF Pro) is
    // OPTICALLY SIZED — small sizes use wider Text-grade glyphs than the
    // Display-grade metrics measured at 400px, so real renders ran ~10%
    // wider than every fabric measurement (box too narrow, caret drifting
    // right). Headless Linux probes could never reproduce (no optical
    // sizing there). Text boxes therefore use a METRICS-STABLE stack —
    // single-master faces whose advances scale geometrically.
    var fontFamily = opts.fontFamily || "'Helvetica Neue', Helvetica, Arial, sans-serif";
    var fill = opts.fill || DEFAULT_INK;
    var bg = opts.backgroundColor || DEFAULT_TEXTBOX_BG;
    var fontSize = opts.fontSize || 14;
    var initialText = (typeof opts.text === 'string') ? opts.text : 'Click to edit';
    var id = opts.id || ('TXT-' + (opts.idSuffix || '001'));
    // v3.7.10 — atomic-kind contract conformance. TextBoxes are
    // fabric.IText (atomic — not a composite of multiple primitives),
    // so the SonorElement.create() Group-wrap pattern doesn't apply.
    // Instead, the IText IS the canonical element; its native angle/
    // scaleX/scaleY/left/top properties already form a transform-
    // canonical record. We stamp `sonorElement = { kind: 'textBox' }`
    // contract metadata alongside the legacy `sonorTextBox` proxy so
    // unified canvas walks (`if (o.sonorElement?.kind === 'textBox')`)
    // can discover textboxes consistently with Group-wrapped kinds.
    var sonorTextBox = opts.sonorTextBox || {
      id: id,
      createdAt: new Date().toISOString()
    };
    // v5.161.0 (Bryn: "the box still hasnt wrapped") — fabric.Textbox, not
    // IText: fixed width with word WRAP, side handles re-flow the text live.
    // opts.width honoured (round-trip); no width → natural single-line width
    // so legacy records restore looking identical.
    var text = new fabric.Textbox(initialText, {
      // no stored width → measure UNWRAPPED first (huge width), shrink after
      // (calcTextWidth on a narrow Textbox returns the WRAPPED longest line —
      // legacy notes would wrap at their longest word; probe-caught v5.161.0).
      width: opts.width || 100000,
      left: point.x,
      top: point.y,
      fontSize: fontSize,
      fontFamily: fontFamily,
      fill: fill,
      backgroundColor: bg,
      padding: opts.padding != null ? opts.padding : 6,
      angle: opts.angle || 0,
      scaleX: opts.scaleX || 1,
      scaleY: opts.scaleY || 1,
      originX: 'left',
      originY: 'top',
      selectable: true,
      evented: true,
      // v5.160.0 (Bryn: "sizing not fixed" — scaled text boxes clipped their
      // last glyphs): the cache bitmap is sized from measured dims; any
      // measure/render drift on a scaled box truncates. Text boxes are few —
      // draw them uncached so glyphs can never clip.
      objectCaching: false,
      sonorTextBox: sonorTextBox,
      // Contract-metadata stamp. Mirrors `sonorTextBox` fields so both
      // accessors return the same identity. Kind is the discriminator
      // for unified contract walks (per docs/SONOR-ELEMENT-MIGRATION-PLAN.md
      // Phase F atomic-kind conformance, v3.7.10).
      sonorElement: {
        kind: 'textBox',
        id: sonorTextBox.id,
        createdAt: sonorTextBox.createdAt
      }
    });
    if (!opts.width) {
      try {
        text.set({ width: Math.max(40, Math.ceil(text.calcTextWidth()) + 8) });
        text.initDimensions();
      } catch (_) {}
    }
    return text;
  }

  // ---------- Leader / Callout primitives ----------

  function nextLeaderId(canvas, floors, activeFloorId) {
    var n = 0;
    try {
      if (canvas && typeof canvas.getObjects === 'function') {
        canvas.getObjects().forEach(function (o) {
          if (o && o.sonorLeader) n++;
        });
      }
    } catch (_) {}
    try {
      if (Array.isArray(floors)) {
        floors.forEach(function (f) {
          if (f && f.id !== activeFloorId && Array.isArray(f.leaders)) {
            n += f.leaders.length;
          }
        });
      }
    } catch (_) {}
    return String(n + 1).padStart(3, '0');
  }

  function isLeaderTarget(o) {
    return !!(o && (o.sonorTextBox || o.sonorRevCloud));
  }

  // Use Fabric's bounding rect for a robust centre — works regardless of
  // origin (textBox uses topleft, cloud uses centre, etc.).
  function computeTargetCentroid(o) {
    if (!o) return null;
    if (typeof o.getBoundingRect === 'function') {
      var r = o.getBoundingRect(true, true);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: o.left || 0, y: o.top || 0 };
  }

  // v3.3.1 — Edge-magnet endpoint resolution. Returns the point on the
  // target's bounding box that's nearest to fromPoint along the line from
  // fromPoint to the target's centroid. Per Bryn 2026-04-29 — leader should
  // terminate at the nearest edge of the target block, not the centre.
  function computeTargetEdgePoint(target, fromPoint) {
    if (!target || !fromPoint) return computeTargetCentroid(target);
    var r;
    if (typeof target.getBoundingRect === 'function') {
      r = target.getBoundingRect(true, true);
    } else {
      r = {
        left: target.left || 0, top: target.top || 0,
        width: (target.width || 0) * (target.scaleX || 1),
        height: (target.height || 0) * (target.scaleY || 1)
      };
    }
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = cx - fromPoint.x;
    var dy = cy - fromPoint.y;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var slabs = [
      { t: dx !== 0 ? (r.left - fromPoint.x) / dx : Infinity },
      { t: dx !== 0 ? (r.left + r.width - fromPoint.x) / dx : Infinity },
      { t: dy !== 0 ? (r.top - fromPoint.y) / dy : Infinity },
      { t: dy !== 0 ? (r.top + r.height - fromPoint.y) / dy : Infinity }
    ];
    var valid = slabs.filter(function (s) { return s.t > 0 && s.t <= 1; });
    if (!valid.length) return { x: cx, y: cy };
    var closest = valid.reduce(function (a, b) { return a.t < b.t ? a : b; });
    return {
      x: fromPoint.x + dx * closest.t,
      y: fromPoint.y + dy * closest.t
    };
  }

  // v3.2.1 — Resolve leader colour from target. Revision clouds use status
  // colour; text boxes default to charcoal. Falls back to charcoal for any
  // unknown target kind.
  function resolveLeaderColour(target) {
    if (target && target.sonorRevCloud) {
      var st = target.sonorRevCloud.status;
      if (st === 'added')   return '#78ba57';
      if (st === 'changed') return '#e37c59';
      if (st === 'removed') return '#ec6061';
      if (st === 'rfi')     return '#8058a1';   // 2026-07-12 — purple RFI cloud
    }
    return DEFAULT_INK;
  }

  // Compute the angle from the next-point back to the tip — this is the
  // direction the arrow head points (toward the plan anchor).
  // v3.2.1 — accepts opts.colour for fill (inherits from target via
  // resolveLeaderColour). Arrow is now the SELECTABLE/MOVABLE handle —
  // selectable:true, evented:true, controls + scaling + rotation all locked
  // so the engineer can ONLY translate it (= move the leader's plan-anchor
  // end). Inline-HTML adapter wires the object:moving handler that updates
  // the line's first point to follow.
  function makeLeaderArrow(tip, next, opts) {
    if (!window.fabric) return null;
    opts = opts || {};
    var fillColour = opts.colour || DEFAULT_INK;
    var dx = tip.x - next.x;
    var dy = tip.y - next.y;
    var angle = Math.atan2(dy, dx);
    var x1 = tip.x - ARROW_SIZE * Math.cos(angle - ARROW_WING_ANGLE);
    var y1 = tip.y - ARROW_SIZE * Math.sin(angle - ARROW_WING_ANGLE);
    var x2 = tip.x - ARROW_SIZE * Math.cos(angle + ARROW_WING_ANGLE);
    var y2 = tip.y - ARROW_SIZE * Math.sin(angle + ARROW_WING_ANGLE);
    return new fabric.Polygon(
      [{ x: tip.x, y: tip.y }, { x: x1, y: y1 }, { x: x2, y: y2 }],
      {
        fill: fillColour,
        stroke: '',
        // v3.2.1 — Arrow IS the user handle.
        selectable: true,
        evented: true,
        hasControls: false,
        hasBorders: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        objectCaching: false,
        _sonorLeaderArrow: true
      }
    );
  }

  // Builds the polyline + arrow pair. Caller adds both to canvas and
  // cross-links them via _sonorLeaderArrow / _sonorLeaderRef.
  // v3.2.1 — Line is now selectable:false / evented:false (arrow is the
  // handle); colour resolves from target via resolveLeaderColour, can be
  // overridden via opts.colour.
  function buildLeaderPolyline(planAnchor, dogLeg, target, opts) {
    if (!window.fabric) return null;
    // v3.3.1 — edge-magnet: use nearest-edge point as the target end (not
    // centroid). The "from" reference for the edge calc is the dogLeg if
    // present, otherwise the planAnchor.
    var fromPoint = dogLeg || planAnchor;
    var targetEnd = computeTargetEdgePoint(target, fromPoint);
    if (!targetEnd) return null;
    opts = opts || {};
    var points = [{ x: planAnchor.x, y: planAnchor.y }];
    if (dogLeg) points.push({ x: dogLeg.x, y: dogLeg.y });
    points.push({ x: targetEnd.x, y: targetEnd.y });

    var id = opts.id || ('LDR-' + (opts.idSuffix || '001'));
    var meta = opts.sonorLeader || {
      id: id,
      planAnchor: { x: planAnchor.x, y: planAnchor.y },
      dogLeg: dogLeg ? { x: dogLeg.x, y: dogLeg.y } : null,
      targetId: (target.sonorTextBox && target.sonorTextBox.id) ||
                (target.sonorRevCloud && target.sonorRevCloud.id) || null,
      targetKind: target.sonorTextBox ? 'textBox'
                : (target.sonorRevCloud ? 'cloud' : 'unknown')
    };

    var resolvedColour = opts.colour || resolveLeaderColour(target);
    var line = new fabric.Polyline(points, {
      stroke: opts.stroke || resolvedColour,
      strokeWidth: opts.strokeWidth || DEFAULT_LEADER_WIDTH,
      fill: '',
      // v3.2.1 — line is non-interactive; arrow is the handle.
      selectable: false,
      evented: false,
      objectCaching: false,
      sonorLeader: meta
    });
    // v3.7.14 — atomic-kind contract metadata stamp (Phase F). Leaders
    // are a line+arrow pair with the line carrying the leader payload
    // and the arrow as the user-facing translation handle. The line's
    // points are deterministically reproduced from planAnchor / dogLeg
    // / target — no dual-truth-geometry. Contract conformance is the
    // kind tag for unified contract walks.
    line.sonorElement = {
      kind: 'leader',
      id: meta.id,
      targetId: meta.targetId,
      targetKind: meta.targetKind
    };
    var next = points[1] || points[2];
    var arrow = makeLeaderArrow(planAnchor, next, { colour: resolvedColour });
    return { line: line, arrow: arrow };
  }

  // Mutates line.points so its endpoint follows the target's current centroid.
  // Returns a NEW arrow polygon that the caller should add to the canvas
  // (after removing the old one). Returns null on failure.
  // v3.2.1 — accepts opts.colour (so caller can pass a fresh resolved colour
  // when the target's status flipped); falls back to current line.stroke.
  function updateLeaderEndpoint(line, target, opts) {
    if (!line || !target) return null;
    // v3.3.1 — edge-magnet: resolve target end to the nearest edge point.
    // "from" reference is the dogLeg if present, else the planAnchor.
    var pts = (line.points || []).map(function (p) { return { x: p.x, y: p.y }; });
    if (pts.length < 2) return null;
    var fromPoint = pts.length >= 3 ? pts[1] : pts[0];
    var c = computeTargetEdgePoint(target, fromPoint) || computeTargetCentroid(target);
    if (!c) return null;
    pts[pts.length - 1] = { x: c.x, y: c.y };
    line.set({ points: pts });
    // Force Fabric to recompute its dimensions for the new point list.
    if (typeof line._setPositionDimensions === 'function') {
      line._setPositionDimensions({});
    }
    if (typeof line.setCoords === 'function') line.setCoords();
    var sl = line.sonorLeader || {};
    var next = pts[1] || pts[2];
    var colour = (opts && opts.colour) || line.stroke || DEFAULT_INK;
    return makeLeaderArrow(sl.planAnchor || pts[0], next, { colour: colour });
  }

  // ---------- Public API ----------
  window.SonorTakeoffsAnnotations = {
    // Text Box
    nextTextBoxId: nextTextBoxId,
    buildTextBox: buildTextBox,
    // Leader
    nextLeaderId: nextLeaderId,
    isLeaderTarget: isLeaderTarget,
    computeTargetCentroid: computeTargetCentroid,
    computeTargetEdgePoint: computeTargetEdgePoint,
    makeLeaderArrow: makeLeaderArrow,
    buildLeaderPolyline: buildLeaderPolyline,
    updateLeaderEndpoint: updateLeaderEndpoint,
    // v3.2.1
    resolveLeaderColour: resolveLeaderColour
  };
})();
