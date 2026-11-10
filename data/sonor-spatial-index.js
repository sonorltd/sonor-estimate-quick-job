// sonor-spatial-index.js — CANONICAL MASTER (Spine v1.2.5 §19 family)
//
// Engine-agnostic R-tree spatial index for every Sonor drawing app that
// needs fast "what's at point (x, y)?" or "what's in this bbox?" queries.
//
// Why this exists: pre-v1.0.0, Takeoffs walked every room linearly on
// every mouse move (12 hot-path call sites in sonor-takeoffs.html). On
// 30 rooms × 12 vertices × 60 fps that's 21,600 ray-cast iterations per
// second just for cursor tracking. This module wraps rbush to do bbox
// culling first (O(log N)), then runs pointInPolygon only on the
// survivors (typically 1–2). ~100× faster on real loads.
//
// NON-NEGOTIABLE DESIGN RULES:
//   1. No fabric, no SVG, no DOM. Pure data + rbush.
//   2. Side-effect free apart from the index itself.
//   3. Items are plain {minX, minY, maxX, maxY, payload} — payload is
//      whatever the caller wants (a fabric object, a sonorMeasure, a
//      symbol id, etc.). The index doesn't care.
//   4. Additive only. Existing API never breaks.
//
// Loads alongside SonorDrawingCore — both are pure-math modules. Cinema
// Takeoff and Network Map will inherit this for room/cell hit-testing
// without re-implementing.
//
// Sourced file is: $SONOR_ROOT/sonor-spatial-index.js
// Propagated to:   APP - */data/sonor-spatial-index.js via sync-everything.sh
//
// Loading patterns:
//   <script src="https://cdn.jsdelivr.net/npm/rbush@3.0.1/rbush.min.js"></script>
//   <script src="data/sonor-spatial-index.js"></script>     ← AFTER rbush
//
// Namespace: window.SonorSpatialIndex
//
// Version: 1.0.0 — initial extraction (2026-04-28 / Takeoffs v1.47.0)
(function () {
  'use strict';

  // Idempotent export.
  if (typeof window !== 'undefined' && window.SonorSpatialIndex && window.SonorSpatialIndex.__version) {
    return;
  }

  // ============================================================
  // RBUSH AVAILABILITY GUARD
  // ============================================================
  // Conservative fallback: if rbush isn't loaded (CDN miss / offline /
  // import-order bug), fall back to a brute-force linear search so the
  // app still works — just slower. Better than throwing on boot.

  function _hasRbush() {
    return typeof window !== 'undefined' && typeof window.rbush === 'function';
  }

  // ============================================================
  // CORE INDEX FACTORY
  // ============================================================

  /**
   * Create a fresh spatial index.
   *
   * @param {object} [opts]
   *   - nodeSize: number (default 9) — rbush max entries per node.
   *               Higher = faster insert, slower search.
   *   - mode:     'rbush' | 'linear' (default 'rbush' if available)
   * @returns {SpatialIndex}
   */
  function createIndex(opts) {
    const o = opts || {};
    const useRbush = (o.mode || (_hasRbush() ? 'rbush' : 'linear')) === 'rbush' && _hasRbush();
    const tree = useRbush ? new window.rbush(o.nodeSize || 9) : null;
    const linearStore = useRbush ? null : [];
    const mode = useRbush ? 'rbush' : 'linear';

    return {
      mode,

      /**
       * Insert one item. Item must have {minX, minY, maxX, maxY} bbox
       * keys; everything else is treated as payload (preserved on
       * search results).
       */
      insert(item) {
        if (!item) return;
        if (useRbush) {
          tree.insert(item);
        } else {
          linearStore.push(item);
        }
      },

      /**
       * Bulk-load an array of items. Per rbush docs, bulk insertion is
       * ~2-3× faster than per-item insert and gives 20-30% better query
       * perf afterwards. Use this on full rebuilds (after _restoreArea
       * for every room, after Phase 2 Supabase overlay completion).
       */
      load(items) {
        if (!Array.isArray(items) || items.length === 0) return;
        if (useRbush) {
          tree.load(items);
        } else {
          for (const it of items) linearStore.push(it);
        }
      },

      /**
       * Remove one item. rbush requires the same object reference (or
       * an equalsFn). Linear mode strips by reference equality.
       */
      remove(item, equalsFn) {
        if (!item) return;
        if (useRbush) {
          tree.remove(item, equalsFn);
        } else {
          const idx = equalsFn
            ? linearStore.findIndex(x => equalsFn(x, item))
            : linearStore.indexOf(item);
          if (idx >= 0) linearStore.splice(idx, 1);
        }
      },

      /**
       * Search for items whose bbox overlaps the query bbox.
       * @param {{minX, minY, maxX, maxY}} bbox
       * @returns {Array} matching items
       */
      search(bbox) {
        if (!bbox) return [];
        if (useRbush) {
          return tree.search(bbox);
        }
        return linearStore.filter(it =>
          it.minX <= bbox.maxX && it.maxX >= bbox.minX &&
          it.minY <= bbox.maxY && it.maxY >= bbox.minY
        );
      },

      /**
       * Search for items whose bbox contains a point. Helper that wraps
       * .search() with a degenerate bbox.
       * @param {{x, y}} pt
       */
      searchPoint(pt) {
        if (!pt) return [];
        return this.search({ minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y });
      },

      /**
       * Clear and re-bulk-load. Cheaper than per-remove-then-per-insert
       * for full rebuilds.
       */
      replace(items) {
        if (useRbush) {
          tree.clear();
        } else {
          linearStore.length = 0;
        }
        if (Array.isArray(items) && items.length) this.load(items);
      },

      clear() {
        if (useRbush) tree.clear();
        else linearStore.length = 0;
      },

      /**
       * For debugging — return a count of indexed items. rbush doesn't
       * expose a public size; we walk the root.
       */
      size() {
        if (useRbush) {
          // rbush internal: data.children gives top-level count, but
          // total leaves require recursion. For our use we expose
          // collected items via .all() count.
          return (tree.all() || []).length;
        }
        return linearStore.length;
      },

      /**
       * Return every indexed item — handy for serialisation / fallback
       * walks. rbush has .all(); linear is a slice.
       */
      all() {
        if (useRbush) return tree.all();
        return linearStore.slice();
      }
    };
  }

  // ============================================================
  // POLYGON-AWARE HELPER
  // ============================================================

  /**
   * Find the first polygon item at point pt. Bbox-cull via the index,
   * then run a precise pointInPolygon test on each survivor. Caller
   * supplies the pointInPolygonFn (typically SonorDrawingCore.pointInPolygon)
   * so this module stays free of math-primitive dependencies.
   *
   * Each indexed item must carry `payload.points = [{x,y},...]` (the
   * polygon vertices) for the precise test.
   *
   * @param {SpatialIndex} index
   * @param {{x:number, y:number}} pt
   * @param {Function} pointInPolygonFn — (pt, points) → boolean
   * @returns {object|null} the first matching item (with .payload), or null
   */
  function findPolygonAt(index, pt, pointInPolygonFn) {
    if (!index || !pt || typeof pointInPolygonFn !== 'function') return null;
    const candidates = index.searchPoint(pt);
    for (const c of candidates) {
      const pts = c.payload && c.payload.points;
      if (Array.isArray(pts) && pts.length >= 3 && pointInPolygonFn(pt, pts)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Compute a bbox from an array of {x,y} points. Returns null for
   * degenerate input (< 1 point). Useful for indexing rooms / cable
   * runs whose payload is a points array.
   */
  function bboxFromPoints(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }

  /**
   * Convenience: build an indexable item from a polygon payload.
   *   makeItem(roomFabricObj, roomFabricObj.sonorMeasure.points, roomFabricObj.sonorMeasure)
   * → { minX, minY, maxX, maxY, ref:fabricObj, payload:{points,...} }
   */
  function makeItem(ref, points, payload) {
    const bb = bboxFromPoints(points);
    if (!bb) return null;
    return Object.assign({}, bb, {
      ref,
      payload: payload || { points }
    });
  }

  // ============================================================
  // EXPORT
  // ============================================================

  const api = {
    createIndex,
    findPolygonAt,
    bboxFromPoints,
    makeItem,
    isRbushAvailable: _hasRbush,
    __version: '1.0.0'
  };

  if (typeof window !== 'undefined') {
    window.SonorSpatialIndex = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
