// @ts-check
/**
 * Sonor Takeoffs — SonorElement module (Group-with-centered-origin contract)
 * ==========================================================================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-element.js by sync-everything.sh;
 * never hand-edit the per-app copy.
 *
 * @version 1.0.0   (introduced in Sonor Takeoffs v3.6.0 — 2026-04-30)
 * @license proprietary — Sonor Smart Homes
 *
 * THE PROBLEM (verbatim from research, 2026-04-30)
 *
 * Sonor stored rotatable shapes as a fabric.Polyline + a sibling
 * fabric.Text label, coupled by JS reference (`poly._sonorLabel`),
 * with the polyline's geometry baked in absolute world coordinates
 * and the label position captured at the pre-rotation bbox midpoint.
 *
 * Every rotate / vertex-edit / save loop had to re-derive a single
 * transform from this dual-truth geometry — and the re-derivation was
 * the bug surface (label drift, rotation pivot drift, "TV resizes
 * after refresh"). Symptoms reported by Bryn on v3.5.5 production:
 *  - TV widthMm changes after rotate + refresh
 *  - Label rotation doesn't persist
 *  - Rotate then rotate back leaves shape in wrong position
 *
 * The research surveyed six independent codebases (tldraw, Excalidraw,
 * Penpot, Konva, Fabric.js maintainer recommendation, AutoCAD/DXF) and
 * found unanimous agreement on the canonical pattern.
 *
 * THE CONTRACT (canonical per the research)
 *
 *   Every drawable element is ONE fabric.Group. Children (geometry,
 *   label, accessory glyphs) live in GROUP-LOCAL coordinates with
 *   originX/originY = 'center'. The group OWNS the world transform —
 *   { left, top, angle, scaleX, scaleY }. Persistence saves
 *   { pointsLocal[], transform, meta } — points NEVER bake rotation;
 *   the transform is the single source of truth.
 *
 * Vertex-edit on a rotated shape projects the screen pointer through
 * fabric.util.invertTransform(group.calcTransformMatrix()) before
 * mutating the polyline's local points. After mutation, group rebounds
 * via addWithUpdate() — keeping the transform contract intact.
 *
 * REFERENCES (each fetched + read 2026-04-30)
 *
 *   - Steve Ruiz / tldraw — "Fixing the Drift in Shape Rotations":
 *     https://www.steveruiz.me/posts/rotating-shapes
 *   - Excalidraw element types (LocalPoint + angle: Radians):
 *     https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts
 *   - tldraw shape transforms doc:
 *     https://tldraw.dev/sdk-features/shape-transforms
 *   - Fabric.js Group docs:
 *     https://fabricjs.com/api/classes/group/
 *   - Fabric discussion #9721 (group + centered origin):
 *     https://github.com/fabricjs/fabric.js/discussions/9721
 *   - ezdxf — Object Coordinate System (DXF/AutoCAD canonical):
 *     https://ezdxf.readthedocs.io/en/stable/concepts/ocs.html
 *   - Penpot data model:
 *     https://help.penpot.app/technical-guide/developer/data-model/
 *
 * PUBLIC API (v1.0.0)
 *
 *   create({ kind, geometry, label?, glyph?, transform?, meta? })
 *     → fabric.Group   — single Group with all children at originX/Y=center
 *
 *   serialise(group)
 *     → { kind, pointsLocal, transform, meta }
 *
 *   restore(record, fabricRef?)
 *     → fabric.Group   — reverse of create + serialise round-trip
 *
 *   projectPointer(group, pointerWorld, fabricRef?)
 *     → { x, y }      — screen pointer projected to group-local coords
 *                        (use this in vertex-edit handlers on rotated shapes)
 *
 *   applyTransform(group, transform)
 *     → void          — sets group's { left, top, angle, scaleX, scaleY }
 *
 *   computeCentroid(points) → { x, y }   — utility
 *   localiseGeometry(worldPoints, centroid) → localPoints[]   — world → local
 *   isLegacyShape(record) → boolean   — true if record uses pre-v3.6.0 shape
 *   migrateLegacyShape(record, kind) → record (new shape) — read-only upgrade
 *
 *   __version
 *
 * Both ES module exports and a window.SonorElement pin are emitted.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorElement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  const __version = '1.3.0';   // v1.3.0 — per-pixel hit-testing for line-like kinds in create() (Takeoffs v5.183.1 selection fix). v1.2.0 — worldPointsThroughMatrix + normaliseCaptureRecord (shade/TV/PJ capture-drift root cause, Takeoffs v5.181.1). v1.1.0 — _sonorLabel stamp in create() (label-parity fix)

  // ============================================================
  // FABRIC RESOLUTION
  // ============================================================
  // The host page passes window.fabric directly, OR we look it up.
  // Defensive — module works even if fabric loads after this module
  // (the API functions take a fabricRef? second arg in places where
  // this matters).

  function _fabric(fabricRef) {
    return fabricRef || (typeof window !== 'undefined' ? window.fabric : null);
  }

  // ============================================================
  // GEOMETRY HELPERS
  // ============================================================

  /**
   * Compute centroid of a points array.
   * @param {{x:number, y:number}[]} points
   * @returns {{x:number, y:number}}
   */
  function computeCentroid(points) {
    if (!Array.isArray(points) || !points.length) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of points) {
      sx += Number(p.x) || 0;
      sy += Number(p.y) || 0;
    }
    return { x: sx / points.length, y: sy / points.length };
  }

  /**
   * Compute BOUNDING-BOX CENTRE of a points array. Use this instead of
   * computeCentroid when the result is being used as the localisation
   * origin for a fabric.Polyline / fabric.Polygon child.
   *
   * Why: Fabric's polyline/polygon `pathOffset` is computed from the
   * bbox (min+max)/2, NOT the centroid (sum/N). For asymmetric shapes
   * (L-runs, polylines with corners weighted to one side, rooms with
   * notches) centroid ≠ bbox-centre. Localising to centroid puts
   * pathOffset at a non-zero local coord, which makes round-trip
   * read/write through getRoomWorldPoints / getPolylineWorldPoints
   * drift on every save/load cycle.
   *
   * Bbox-centre localisation guarantees pathOffset = (0, 0) and
   * round-trip is exact. v5.4.62 fixed rooms + cables/LEDs; v5.4.64
   * extends the fix to containment + shades + TVs + PJ screens.
   *
   * @param {{x:number, y:number}[]} points
   * @returns {{x:number, y:number}}
   */
  function computeBboxCentre(points) {
    if (!Array.isArray(points) || !points.length) return { x: 0, y: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const x = Number(p.x) || 0, y = Number(p.y) || 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /**
   * Re-express a world-space points array in group-local coords.
   * After this transform, the centroid of the local points is at (0,0).
   * @param {{x:number, y:number}[]} worldPoints
   * @param {{x:number, y:number}} centroid
   * @returns {{x:number, y:number}[]}
   */
  function localiseGeometry(worldPoints, centroid) {
    if (!Array.isArray(worldPoints)) return [];
    const cx = centroid ? Number(centroid.x) || 0 : 0;
    const cy = centroid ? Number(centroid.y) || 0 : 0;
    return worldPoints.map(p => ({
      x: (Number(p.x) || 0) - cx,
      y: (Number(p.y) || 0) - cy,
    }));
  }

  // ============================================================
  // CORE API — create / serialise / restore
  // ============================================================

  /**
   * Build a SonorElement Group.
   *
   * @param {object} opts
   * @param {string} opts.kind       — 'shade' | 'tv' | 'pjScreen' | future kinds
   * @param {fabric.Object} opts.geometry — typically a fabric.Polyline / Polygon /
   *                                       Path / Line. Will be re-positioned to
   *                                       originX/Y=center, left/top=0 (with
   *                                       points pre-localised relative to centroid).
   * @param {fabric.Object} [opts.label] — optional label (typically fabric.Text).
   *                                       Positioned at group-local (0,0) by default.
   * @param {fabric.Object} [opts.glyph] — optional accessory glyph (motor/AT/pattress).
   * @param {object} [opts.transform]    — { left, top, angle?, scaleX?, scaleY? }.
   *                                       Owns the group's world placement.
   *                                       Defaults to { left:0, top:0, angle:0, scaleX:1, scaleY:1 }.
   * @param {object} [opts.meta]         — sonorMeta payload (pointsLocal echoed here too).
   * @param {object} [opts.fabricRef]    — fabric reference (defaults to window.fabric).
   * @returns {fabric.Group}
   */
  function create(opts) {
    const o = opts || {};
    const fabric = _fabric(o.fabricRef);
    if (!fabric || !fabric.Group) throw new Error('[SonorElement] fabric.Group unavailable');

    const kind = o.kind || 'unknown';
    const transform = Object.assign({
      left: 0, top: 0, angle: 0, scaleX: 1, scaleY: 1,
    }, o.transform || {});
    const meta = Object.assign({}, o.meta || {}, { kind });

    // Force every child to originX/Y=center, left/top=0 — the contract.
    // Geometry's own `points` array is the local-space geometry; the
    // child fabric.Object's left/top is the OFFSET from group centre,
    // which we always set to (0,0) so the child centroid sits at the
    // group centre.
    const children = [];
    if (o.geometry) {
      o.geometry.set({
        originX: 'center', originY: 'center',
        left: 0, top: 0,
        objectCaching: false,
      });
      children.push(o.geometry);
    }
    if (o.label) {
      o.label.set({
        originX: 'center', originY: 'center',
        left: 0, top: 0,
      });
      children.push(o.label);
    }
    if (o.glyph) {
      o.glyph.set({
        originX: 'center', originY: 'center',
        left: 0, top: 0,
      });
      children.push(o.glyph);
    }

    const group = new fabric.Group(children, {
      originX: 'center', originY: 'center',
      left: transform.left, top: transform.top,
      angle: transform.angle || 0,
      scaleX: transform.scaleX || 1,
      scaleY: transform.scaleY || 1,
      // sub-target hit-testing lets vertex-edit pick the polyline child
      // even when other children (label, glyph) overlap.
      subTargetCheck: true,
      // Default: rotation handle visible, no scale handles. Per-kind
      // wiring can override (e.g. shades may want scale handles).
      hasControls: true,
      lockScalingFlip: true,
    });
    // v1.3.0 (Takeoffs v5.183.1 — Bryn: "the line has a full box select
    // boundary, this was similar in the rooms drawing but was fixed to be
    // single lines. make sure all selections for everything dont hinder
    // selection of blocks behind") — LINE-LIKE kinds hit-test PER-PIXEL:
    // clicks land only on drawn ink (stroke / label / glyph pixels, padded
    // by the canvas targetFindTolerance), so the empty interior of a long
    // cable / shade / TV / PJ / containment bounding box falls through to
    // whatever is really underneath — the same medicine rooms got in
    // v5.122.0. Symbols keep whole-box hits (compact icons want the easy
    // grab).
    if (kind !== 'symbol') group.perPixelTargetFind = true;
    // Stash meta + kind on the group for capture/restore parity.
    group.sonorElement = meta;
    group.sonorElement.kind = kind;
    // v1.1.0 (2026-06-12, Takeoffs v5.15.0 label-parity fix) — stamp the
    // label child on `group._sonorLabel`. The ~90 label reader sites
    // (relabel, label-scale slider, Labels visibility toggle, rotation
    // follow) all resolve labels through `_sonorLabel`; without this stamp
    // every SonorElement-built kind (shade / TV / PJ screen) had labels
    // INVISIBLE to all of them — Bryn report 2026-06-12: "labels for tvs
    // and shades not changing size with other blocks when adjusting".
    // NOTE: the label here is a group CHILD (unlike blocks/cables/LEDs
    // whose labels are top-level siblings) — readers must mark the PARENT
    // group dirty after mutating it (see _setSonorLabelProps in the host).
    group._sonorLabel = o.label || null;
    return group;
  }

  /**
   * Serialise a SonorElement Group to a persistence record.
   *
   * @param {fabric.Group} group
   * @returns {{kind:string, pointsLocal:Array, transform:object, meta:object}}
   */
  function serialise(group) {
    if (!group) return null;
    const meta = group.sonorElement || {};
    const kind = meta.kind || 'unknown';

    // Pull pointsLocal from the geometry child (first child by convention).
    let pointsLocal = [];
    try {
      const geom = (group._objects || group.getObjects && group.getObjects() || [])[0];
      if (geom && Array.isArray(geom.points)) {
        pointsLocal = geom.points.map(p => ({
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
        }));
      }
    } catch (_) {}

    return {
      kind,
      pointsLocal,
      transform: {
        left:   Number(group.left) || 0,
        top:    Number(group.top) || 0,
        angle:  Number(group.angle) || 0,
        scaleX: Number(group.scaleX) || 1,
        scaleY: Number(group.scaleY) || 1,
      },
      meta: Object.assign({}, meta),
    };
  }

  /**
   * Reverse of create + serialise. The host supplies a builder fn that
   * produces the fabric children given the meta + pointsLocal.
   *
   * @param {object} record  — output of serialise()
   * @param {Function} builder — (meta, pointsLocal, fabricRef) => { geometry, label, glyph }
   * @param {object} [fabricRef]
   * @returns {fabric.Group}
   */
  function restore(record, builder, fabricRef) {
    if (!record || typeof builder !== 'function') return null;
    const fabric = _fabric(fabricRef);
    if (!fabric || !fabric.Group) throw new Error('[SonorElement] fabric.Group unavailable');

    const built = builder(record.meta || {}, record.pointsLocal || [], fabric) || {};
    return create({
      kind: record.kind,
      geometry: built.geometry,
      label: built.label,
      glyph: built.glyph,
      transform: record.transform,
      meta: record.meta,
      fabricRef: fabric,
    });
  }

  /**
   * Project a screen-space pointer into group-local coords. Use this in
   * vertex-edit handlers when the SonorElement may be rotated. After
   * projection, the returned point can be assigned directly to the
   * geometry child's `points[idx]`.
   *
   * @param {fabric.Group} group
   * @param {{x:number, y:number}} pointerWorld
   * @param {object} [fabricRef]
   * @returns {{x:number, y:number}}
   */
  function projectPointer(group, pointerWorld, fabricRef) {
    if (!group || !pointerWorld) return { x: 0, y: 0 };
    const fabric = _fabric(fabricRef);
    if (!fabric || !fabric.util) return { x: pointerWorld.x, y: pointerWorld.y };

    try {
      const matrix = group.calcTransformMatrix();
      const inv = fabric.util.invertTransform(matrix);
      const local = fabric.util.transformPoint(pointerWorld, inv);
      return { x: local.x, y: local.y };
    } catch (e) {
      // Defensive — return raw pointer rather than throw.
      return { x: pointerWorld.x, y: pointerWorld.y };
    }
  }

  /**
   * Apply a transform to a group. Sets left/top/angle/scaleX/scaleY in
   * one call + recalcs coords. Convenience wrapper.
   */
  function applyTransform(group, transform) {
    if (!group || !transform) return;
    try {
      group.set({
        left:   Number(transform.left) || 0,
        top:    Number(transform.top) || 0,
        angle:  Number(transform.angle) || 0,
        scaleX: Number(transform.scaleX) || 1,
        scaleY: Number(transform.scaleY) || 1,
      });
      if (typeof group.setCoords === 'function') group.setCoords();
    } catch (_) {}
  }

  // ============================================================
  // BACKWARD COMPAT — read pre-v3.6.0 records
  // ============================================================
  //
  // Pre-v3.6.0 saves use the legacy shape:
  //
  //   { x: o.left, y: o.top, angle: o.angle, sonorTv: { points: [world coords] } }
  //
  // The v3.6.0 schema is:
  //
  //   { kind, pointsLocal: [...], transform: {left,top,angle}, meta: {...} }
  //
  // isLegacyShape() detects the old format. migrateLegacyShape() converts
  // a legacy record into the new shape so the host can paint either via
  // the same restore() path. Migration is one-way: once a record is
  // saved in the new shape, it can't be downgraded.

  function isLegacyShape(record) {
    if (!record) return false;
    // New shape has explicit `kind` + `pointsLocal` + `transform`. Legacy
    // has `sonorXxx` metadata bag with world-space `points`.
    if (typeof record.kind === 'string' && Array.isArray(record.pointsLocal)) return false;
    // Legacy detector: any sonor* metadata bag at top level
    for (const k of Object.keys(record)) {
      if (k.startsWith('sonor') && record[k] && typeof record[k] === 'object') return true;
    }
    return false;
  }

  /**
   * Convert a legacy record to the v3.6.0 shape.
   *
   * @param {object} record  — legacy { x, y, angle?, sonorXxx: { points: [world] } }
   * @param {string} kind    — 'shade' | 'tv' | 'pjScreen' (caller knows the bucket)
   * @returns {{kind, pointsLocal, transform, meta}}
   */
  function migrateLegacyShape(record, kind) {
    if (!record) return null;
    const metaBag = record['sonor' + kind.charAt(0).toUpperCase() + kind.slice(1)] ||
                    record.sonorTv || record.sonorShade || record.sonorPjScreen ||
                    record.sonorContainment || record.sonorRevCloud || {};
    const worldPts = Array.isArray(metaBag.points) ? metaBag.points : [];
    // The legacy record's (x, y) was the polyline's left/top using
    // originX/Y='left'/'top'. The polyline's points were RELATIVE to that
    // anchor (Fabric stores points minus pathOffset internally). For the
    // v3.6.0 contract we need pointsLocal centred on (0,0) and the group's
    // (left, top) at the centroid in world space.
    const centroidLocalToAnchor = computeCentroid(worldPts);
    const pointsLocal = localiseGeometry(worldPts, centroidLocalToAnchor);
    // World centroid = (anchor + centroid offset). Anchor = (record.x, record.y).
    // For a fabric.Polyline with originX/Y='left'/'top', `left/top` is the
    // top-left of the un-rotated bounding box, NOT the centroid. We must
    // reconstruct the centroid in world coords. But the polyline's points
    // ARE local to the polyline's pathOffset (which equals the bbox origin).
    // So world centroid = record.x + centroidLocalToAnchor.x + bboxOffset.
    //
    // Since pre-v3.6.0 records didn't store the bbox offset, we make a
    // best-effort assumption: treat record.x/y as the world centroid.
    // This is correct when the polyline was always drawn with left=0,
    // top=0 (which the host did for shades/tvs/pjs — points were the
    // world coords directly). The legacy capture used o.left, o.top which
    // for shade/tv/pj polylines was always 0,0 since points were absolute.
    return {
      kind,
      pointsLocal,
      transform: {
        left:   centroidLocalToAnchor.x + (Number(record.x) || 0),
        top:    centroidLocalToAnchor.y + (Number(record.y) || 0),
        angle:  Number(record.angle) || 0,
        scaleX: 1,
        scaleY: 1,
      },
      meta: Object.assign({}, metaBag, { kind }),
    };
  }

  // ============================================================
  // v1.2.0 — CAPTURE NORMALISATION (Takeoffs v5.181.1 drift root cause)
  // ============================================================
  // Bryn 2026-07-21: "some shades are drifting again". The shade/TV/PJ
  // persistence record stores WORLD points + a group-transform x/y. Those
  // two truths disagree after a VERTEX EDIT: the host's object:modified
  // resync writes true world points into the meta bag, but the group's
  // left/top stays pinned at the BUILD-TIME centre (the v5.5.51 anti-drift
  // invariant). Capture then saved {x: o.left, y: o.top} — the stale
  // centre — while restore rebuilds at centroid(points) and OVERRIDES to
  // the stale x/y (the v5.1.1 drag fix). Net: every reload translates the
  // element by (stale centre − new centroid) — exactly half of every
  // endpoint stretch. Same class as v5.63.1's block drift; same medicine:
  // SELECTION-NORMALISED CAPTURE. Derive world points through the LIVE
  // matrix at capture time, store x/y = centroid(worldPts) — precisely
  // where the rebuild will put the group — so the restore-time override
  // becomes a no-op. angle is baked into the projected points and stored
  // as 0 (record-canonical world points; also kills the latent
  // double-rotation when a toolbar-rotated element later resyncs).
  // Pure functions — no fabric dependency — unit-tested in
  // tests/unit/capturedrift.test.mjs.

  /**
   * Project child-local polyline points to WORLD coords through a fabric
   * 2×3 transform matrix [a, b, c, d, e, f] (calcTransformMatrix() shape),
   * subtracting the child's pathOffset first (fabric stores polyline
   * points relative to pathOffset). Mirrors the host resync handler and
   * fabric.util.transformPoint exactly.
   * @param {{x:number, y:number}[]} childPoints
   * @param {{x:number, y:number}|null} pathOffset
   * @param {number[]} m  fabric 2×3 matrix
   * @returns {{x:number, y:number}[]}
   */
  function worldPointsThroughMatrix(childPoints, pathOffset, m) {
    if (!Array.isArray(childPoints) || !Array.isArray(m) || m.length < 6) return [];
    const ox = (pathOffset && Number(pathOffset.x)) || 0;
    const oy = (pathOffset && Number(pathOffset.y)) || 0;
    return childPoints.map(p => {
      const lx = (Number(p.x) || 0) - ox;
      const ly = (Number(p.y) || 0) - oy;
      return {
        x: m[0] * lx + m[2] * ly + m[4],
        y: m[1] * lx + m[3] * ly + m[5],
      };
    });
  }

  /**
   * Build a persistence capture record whose x/y and meta-bag points agree
   * BY CONSTRUCTION: points = the supplied true world points, x/y = their
   * centroid (what the group rebuild derives), angle = 0 (rotation is baked
   * into the world points). Refreshes legacy x1/y1/x2/y2 endpoint mirrors
   * when the bag carries them (shade records do; _saveShadeEdit keeps them
   * in sync on its path).
   * @param {string} bagKey    'sonorShade' | 'sonorTv' | 'sonorPjScreen'
   * @param {object} bag       the live meta bag (spread-copied, not mutated)
   * @param {{x:number, y:number}[]} worldPts
   * @returns {object|null}    capture record, or null when worldPts unusable
   */
  function normaliseCaptureRecord(bagKey, bag, worldPts) {
    if (!bagKey || !bag) return null;
    if (!Array.isArray(worldPts) || worldPts.length < 2) return null;
    for (const p of worldPts) {
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
    }
    const pts = worldPts.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    const c = computeCentroid(pts);
    const outBag = Object.assign({}, bag, { points: pts });
    if ('x1' in outBag || 'y1' in outBag || bagKey === 'sonorShade') {
      outBag.x1 = pts[0].x;
      outBag.y1 = pts[0].y;
      outBag.x2 = pts[pts.length - 1].x;
      outBag.y2 = pts[pts.length - 1].y;
    }
    if ('angle' in outBag) outBag.angle = 0;
    const rec = { x: c.x, y: c.y, angle: 0 };
    rec[bagKey] = outBag;
    return rec;
  }

  // ============================================================
  // EXPORTS
  // ============================================================

  return {
    create,
    serialise,
    restore,
    projectPointer,
    applyTransform,
    computeCentroid,
    computeBboxCentre,
    localiseGeometry,
    isLegacyShape,
    migrateLegacyShape,
    worldPointsThroughMatrix,
    normaliseCaptureRecord,
    __version,
  };
});
