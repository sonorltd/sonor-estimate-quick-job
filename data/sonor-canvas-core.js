/* sonor-canvas-core.js — MASTER DRAWING ENGINE (data + math layer)
 * =============================================================================
 * B-252 Phase 1 — workspace-shared capability layer for every Sonor app
 * that touches a canvas. Owns the data model, world-coord invariant,
 * serialisation, and (later) snap / selection / undo / routing.
 *
 * NEVER touches the DOM. NEVER imports anything app-specific. NEVER
 * decides what something looks like — that's the per-app adapter's job
 * (sonor-canvas-fabric-adapter.js for Takeoffs, sonor-canvas-svg-adapter.js
 * for Cinema apps, sonor-canvas-react-adapter.js for Network Map, etc.).
 *
 * THE CAPABILITY / APPEARANCE SPLIT (HARMONY law per B-252):
 *   - canvas-core: data model, math, transforms, snap algorithms, routing,
 *     undo/redo, selection model, serialisation. Shared workspace-wide.
 *   - adapters: rendering, styling, decorations, UI chrome, gestures.
 *     App-owned, freely restylable, never shared.
 *
 * THE WORLD-COORD INVARIANT (Phase 0 lesson — B-249):
 *   Every position is stored in world coordinates. No "local" coords, no
 *   pathOffset, no centroid-localisation, no group-transform layering.
 *   Render-time projection is the adapter's problem.
 *
 * ADAPTER INVARIANTS — REQUIRED READING BEFORE WRITING ANY ADAPTER:
 *   See `ADAPTER_INVARIANTS.md` at workspace root. Eleven rules every
 *   adapter MUST enforce (pathOffset=0, identity transforms, world-coord-
 *   only storage, deterministic library-cascade fields, boot self-test,
 *   schema-in-version-control, etc.). Skipping any one of them silently
 *   reintroduces a known bug class (B-249, B-280, room snap-back, LED
 *   whole-group drift, mix-block shift). Drawing-audit 2026-05-22 fix F4
 *   lifted these rules from the Takeoffs fabric-adapter into a shared
 *   document so the next adapter doesn't rediscover them the hard way.
 *
 * Loading: vanilla HTML apps `<script src="../sonor-canvas-core.js">`,
 * React/Vite apps import via the Vite alias defined per-app, Node tests
 * import via dynamic ESM wrapping.
 *
 * Spine: §20 (canvas-core contract). Rule S-4.20 enforces the
 * capability/appearance split — any PR adding DOM/styling/UI code to
 * this file fails review.
 *
 * Reference test: tests/canvas-core.smoke.mjs (workspace root).
 * =============================================================================
 */

(function (root, factory) {
  // UMD-ish: writes to window.SonorCanvasCore in browsers, module.exports
  // in Node (for smoke tests + future server-side validators).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SonorCanvasCore = factory();
    root.SONOR_CANVAS_CORE_VERSION = '0.3.2'; // B-414 — was frozen at '0.1.0' while VERSION advanced; keep in lock-step with VERSION below
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.3.2';

  // ===========================================================================
  // PRIMITIVE TYPES — Block / Shape / Link
  // ===========================================================================
  // The three things any Sonor canvas can hold. Every adapter projects these
  // to whatever rendering primitive it likes (fabric.Group, <svg> element,
  // React component, or any future canvas surface).

  /**
   * BLOCK — point object with optional anchors.
   * Used for: placed devices (Takeoffs symbols), speakers (Cinema Design),
   * labels (any), markers (LED feed points, dimension endpoints).
   *
   * Anchors are named connection points relative to the block — Engineering's
   * port-aware routing lands here in Phase 3. Phase 1 just defines them.
   *
   * @typedef {Object} Block
   * @property {string} id           - stable UUID-ish identifier
   * @property {string} type         - app-defined kind ('cinema-amp', 'led-feed', 'room-label')
   * @property {{x:number,y:number}} position_world - world coords, NEVER local
   * @property {number} rotation     - degrees, 0-360, never matrices
   * @property {Array<Anchor>} anchors - optional connection points
   * @property {Object} metadata     - app-specific bag (block_code, name, etc.)
   */

  /**
   * @typedef {Object} Anchor
   * @property {string} id           - per-block-unique anchor name ('input-1', 'output-rear')
   * @property {{x:number,y:number}} offset - position relative to block's position_world
   * @property {string} [role]       - optional semantic ('input', 'output', 'speaker-back')
   */

  function createBlock(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('createBlock: opts required');
    if (typeof opts.type !== 'string' || !opts.type) throw new Error('createBlock: type required');
    const pos = opts.position_world;
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      throw new Error('createBlock: position_world {x,y} required (numbers)');
    }
    return {
      kind: 'block',
      id: opts.id || _newId('blk'),
      type: opts.type,
      position_world: { x: Number(pos.x), y: Number(pos.y) },
      rotation: _normaliseAngle(opts.rotation),
      anchors: Array.isArray(opts.anchors) ? opts.anchors.map(_validateAnchor) : [],
      metadata: (opts.metadata && typeof opts.metadata === 'object') ? { ...opts.metadata } : {},
    };
  }

  /**
   * SHAPE — open polyline OR closed polygon.
   * Used for: rooms (closed), cable runs / LED strips / shades / fabric tracks
   * / sightlines / walls (open).
   *
   * @typedef {Object} Shape
   * @property {string} id
   * @property {string} type           - app-defined ('room', 'cable-run', 'led-strip', 'shade')
   * @property {Array<{x:number,y:number}>} points_world - world coords, length >= 2
   * @property {boolean} closed        - true = polygon, false = polyline
   * @property {Object} metadata
   */
  function createShape(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('createShape: opts required');
    if (typeof opts.type !== 'string' || !opts.type) throw new Error('createShape: type required');
    if (!Array.isArray(opts.points_world) || opts.points_world.length < 2) {
      throw new Error('createShape: points_world array (length >= 2) required');
    }
    if (opts.closed && opts.points_world.length < 3) {
      throw new Error('createShape: closed shape requires >= 3 points');
    }
    return {
      kind: 'shape',
      id: opts.id || _newId('shp'),
      type: opts.type,
      points_world: opts.points_world.map(p => ({ x: Number(p.x), y: Number(p.y) })),
      closed: !!opts.closed,
      metadata: (opts.metadata && typeof opts.metadata === 'object') ? { ...opts.metadata } : {},
    };
  }

  /**
   * LINK — connection between two block anchors (or block centroids if no anchor).
   * Geometry is DERIVED by the router at render time; only `waypoints_world`
   * persists when routing === 'manual'.
   *
   * Used for: cables (Takeoffs), signal chain (Engineering), sightlines (Cinema).
   *
   * @typedef {Object} Link
   * @property {string} id
   * @property {string} type           - app-defined ('cable', 'signal', 'sightline')
   * @property {LinkEnd} from
   * @property {LinkEnd} to
   * @property {'straight'|'orthogonal'|'astar'|'manual'} routing
   * @property {Array<{x:number,y:number}>} [waypoints_world] - present iff routing === 'manual'
   * @property {Object} metadata
   */

  /**
   * @typedef {Object} LinkEnd
   * @property {string} blockId
   * @property {string} [anchor]       - optional anchor id within the block
   */
  function createLink(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('createLink: opts required');
    if (typeof opts.type !== 'string' || !opts.type) throw new Error('createLink: type required');
    const from = _validateLinkEnd(opts.from, 'from');
    const to = _validateLinkEnd(opts.to, 'to');
    const routing = opts.routing || 'straight';
    if (!['straight', 'orthogonal', 'astar', 'manual'].includes(routing)) {
      throw new Error(`createLink: routing must be straight|orthogonal|astar|manual, got "${routing}"`);
    }
    const link = {
      kind: 'link',
      id: opts.id || _newId('lnk'),
      type: opts.type,
      from,
      to,
      routing,
      metadata: (opts.metadata && typeof opts.metadata === 'object') ? { ...opts.metadata } : {},
    };
    if (routing === 'manual') {
      if (!Array.isArray(opts.waypoints_world)) {
        throw new Error('createLink: routing="manual" requires waypoints_world array');
      }
      link.waypoints_world = opts.waypoints_world.map(p => ({ x: Number(p.x), y: Number(p.y) }));
    } else if (Array.isArray(opts.waypoints_world)) {
      // Defensive — non-manual routing ignores waypoints.
      link.waypoints_world = opts.waypoints_world.map(p => ({ x: Number(p.x), y: Number(p.y) }));
    }
    return link;
  }

  // ===========================================================================
  // CANVAS STATE — the in-memory container every app's adapter projects from.
  // ===========================================================================
  // Holds Blocks/Shapes/Links keyed by id. Pure data — no rendering, no events.
  // Adapters subscribe to changes via the optional listener pattern (Phase 1b).

  function createState() {
    const blocks = new Map();
    const shapes = new Map();
    const links = new Map();
    let version = 0;
    let lastModified = null;

    function _bump() {
      version += 1;
      lastModified = new Date().toISOString();
    }

    return {
      get version() { return version; },
      get lastModified() { return lastModified; },

      // ----- write -----
      addBlock(opts) {
        const b = createBlock(opts);
        if (blocks.has(b.id)) throw new Error(`addBlock: duplicate id "${b.id}"`);
        blocks.set(b.id, b);
        _bump();
        return b;
      },
      addShape(opts) {
        const s = createShape(opts);
        if (shapes.has(s.id)) throw new Error(`addShape: duplicate id "${s.id}"`);
        shapes.set(s.id, s);
        _bump();
        return s;
      },
      addLink(opts) {
        const l = createLink(opts);
        if (links.has(l.id)) throw new Error(`addLink: duplicate id "${l.id}"`);
        // Validate referenced blocks exist (cheap consistency guard).
        if (!blocks.has(l.from.blockId)) {
          throw new Error(`addLink: from.blockId "${l.from.blockId}" does not exist`);
        }
        if (!blocks.has(l.to.blockId)) {
          throw new Error(`addLink: to.blockId "${l.to.blockId}" does not exist`);
        }
        links.set(l.id, l);
        _bump();
        return l;
      },
      removeById(id) {
        if (blocks.delete(id)) {
          // Cascade: drop any links referencing the removed block.
          for (const [lid, l] of links) {
            if (l.from.blockId === id || l.to.blockId === id) links.delete(lid);
          }
          _bump();
          return true;
        }
        if (shapes.delete(id)) { _bump(); return true; }
        if (links.delete(id))  { _bump(); return true; }
        return false;
      },
      updateById(id, patch) {
        // Returns the new object or null if id not found. Spreads patch over
        // current state; world-coord arrays/objects are deep-copied to avoid
        // shared-reference bugs.
        const target = blocks.get(id) || shapes.get(id) || links.get(id);
        if (!target) return null;
        if (target.kind === 'block') {
          const next = createBlock({ ...target, ...patch, id: target.id });
          blocks.set(id, next); _bump(); return next;
        }
        if (target.kind === 'shape') {
          const next = createShape({ ...target, ...patch, id: target.id });
          shapes.set(id, next); _bump(); return next;
        }
        if (target.kind === 'link') {
          const next = createLink({ ...target, ...patch, id: target.id });
          links.set(id, next); _bump(); return next;
        }
        return null;
      },

      // ----- read -----
      getById(id) {
        return blocks.get(id) || shapes.get(id) || links.get(id) || null;
      },
      listBlocks(filter) {
        const arr = Array.from(blocks.values());
        return typeof filter === 'function' ? arr.filter(filter) : arr;
      },
      listShapes(filter) {
        const arr = Array.from(shapes.values());
        return typeof filter === 'function' ? arr.filter(filter) : arr;
      },
      listLinks(filter) {
        const arr = Array.from(links.values());
        return typeof filter === 'function' ? arr.filter(filter) : arr;
      },
      count() {
        return { blocks: blocks.size, shapes: shapes.size, links: links.size };
      },

      // ----- bulk -----
      clear() {
        blocks.clear(); shapes.clear(); links.clear();
        _bump();
      },

      // ----- serialise (round-trip identity is THE invariant) -----
      toJSON() {
        return {
          schemaVersion: VERSION,
          version,
          lastModified,
          blocks: Array.from(blocks.values()),
          shapes: Array.from(shapes.values()),
          links: Array.from(links.values()),
        };
      },
    };
  }

  /**
   * Rebuilds a CanvasState from a JSON object produced by toJSON().
   * Round-trip is BIT-IDENTICAL by contract — any drift is a bug.
   */
  function fromJSON(json) {
    if (!json || typeof json !== 'object') throw new Error('fromJSON: object required');
    const state = createState();
    if (Array.isArray(json.blocks)) json.blocks.forEach(b => state.addBlock(b));
    if (Array.isArray(json.shapes)) json.shapes.forEach(s => state.addShape(s));
    if (Array.isArray(json.links))  json.links.forEach(l => state.addLink(l));
    return state;
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  function _newId(prefix) {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}-${crypto.randomUUID()}`;
      }
    } catch (_) { /* fall through */ }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function _normaliseAngle(a) {
    if (a == null) return 0;
    let v = Number(a) || 0;
    v = v % 360;
    if (v < 0) v += 360;
    return v;
  }

  function _validateAnchor(a, idx) {
    if (!a || typeof a !== 'object') throw new Error(`anchor[${idx}]: object required`);
    if (typeof a.id !== 'string' || !a.id) throw new Error(`anchor[${idx}]: id required`);
    const off = a.offset || { x: 0, y: 0 };
    return {
      id: a.id,
      offset: { x: Number(off.x) || 0, y: Number(off.y) || 0 },
      role: typeof a.role === 'string' ? a.role : undefined,
    };
  }

  function _validateLinkEnd(end, label) {
    if (!end || typeof end !== 'object') throw new Error(`${label}: object required`);
    if (typeof end.blockId !== 'string' || !end.blockId) {
      throw new Error(`${label}.blockId required`);
    }
    const out = { blockId: end.blockId };
    if (typeof end.anchor === 'string' && end.anchor) out.anchor = end.anchor;
    return out;
  }

  // ===========================================================================
  // SNAP LIBRARY — pure math, threshold-based, returns snapped point or null.
  // ===========================================================================
  // Adapters call these during drag/draw to compute "snapped" positions.
  // Adapter decides what triggers a snap (mouse move, drop, mid-drag) and what
  // visual feedback to show — canvas-core just does the math.

  function _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /** Round a world point to the nearest grid intersection. */
  function snapToGrid(pt, gridSize) {
    if (!pt || !Number.isFinite(gridSize) || gridSize <= 0) return pt;
    return {
      x: Math.round(pt.x / gridSize) * gridSize,
      y: Math.round(pt.y / gridSize) * gridSize,
    };
  }

  /** Find nearest vertex within threshold across a list of candidate points.
   *  @returns {{x,y, idx, sourceId?}|null} */
  function snapToVertex(pt, candidates, threshold) {
    if (!pt || !Array.isArray(candidates) || candidates.length === 0) return null;
    const t = Number.isFinite(threshold) ? threshold : 8;
    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const d = _dist(pt, c);
      if (d <= t && (!best || d < best.d)) {
        best = { x: c.x, y: c.y, idx: i, sourceId: c.sourceId, d };
      }
    }
    return best ? { x: best.x, y: best.y, idx: best.idx, sourceId: best.sourceId } : null;
  }

  /** Project pt onto segment ab — returns nearest point on the line + clamped
   *  scalar t in [0,1]. Used by snapToEdge + snapToMidpoint. */
  function _projectPointToSegment(pt, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: a.x, y: a.y, t: 0 };
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy, t };
  }

  /** Snap to nearest point on any segment within threshold.
   *  segments = Array<{a:{x,y}, b:{x,y}, sourceId?}> */
  function snapToEdge(pt, segments, threshold) {
    if (!pt || !Array.isArray(segments) || segments.length === 0) return null;
    const t = Number.isFinite(threshold) ? threshold : 8;
    let best = null;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const proj = _projectPointToSegment(pt, s.a, s.b);
      const d = _dist(pt, proj);
      if (d <= t && (!best || d < best.d)) {
        best = { x: proj.x, y: proj.y, idx: i, sourceId: s.sourceId, t: proj.t, d };
      }
    }
    return best ? { x: best.x, y: best.y, idx: best.idx, sourceId: best.sourceId, t: best.t } : null;
  }

  /** Snap to nearest segment midpoint within threshold. */
  function snapToMidpoint(pt, segments, threshold) {
    if (!pt || !Array.isArray(segments) || segments.length === 0) return null;
    const mids = segments.map((s, i) => ({
      x: (s.a.x + s.b.x) / 2,
      y: (s.a.y + s.b.y) / 2,
      sourceId: s.sourceId,
      idx: i,
    }));
    const hit = snapToVertex(pt, mids, threshold);
    return hit; // already has idx + sourceId fields
  }

  /** Snap to any intersection of two segments within threshold.
   *  O(N²) — caller responsible for filtering down to a reasonable candidate set. */
  function snapToIntersection(pt, segments, threshold) {
    if (!pt || !Array.isArray(segments) || segments.length < 2) return null;
    const t = Number.isFinite(threshold) ? threshold : 8;
    const ixs = [];
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const ix = _segmentIntersection(segments[i], segments[j]);
        if (ix) ixs.push(ix);
      }
    }
    return snapToVertex(pt, ixs, t);
  }

  function _segmentIntersection(s1, s2) {
    const x1 = s1.a.x, y1 = s1.a.y, x2 = s1.b.x, y2 = s1.b.y;
    const x3 = s2.a.x, y3 = s2.a.y, x4 = s2.b.x, y4 = s2.b.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    const tt = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const uu = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if (tt < 0 || tt > 1 || uu < 0 || uu > 1) return null;
    return { x: x1 + tt * (x2 - x1), y: y1 + tt * (y2 - y1) };
  }

  /** Snap to the nearest block anchor (world position = block.position_world + anchor.offset). */
  function snapToAnchor(pt, blocks, threshold) {
    if (!pt || !Array.isArray(blocks) || blocks.length === 0) return null;
    const t = Number.isFinite(threshold) ? threshold : 8;
    let best = null;
    for (const b of blocks) {
      if (!b || !Array.isArray(b.anchors)) continue;
      for (const a of b.anchors) {
        const wx = b.position_world.x + a.offset.x;
        const wy = b.position_world.y + a.offset.y;
        const d = _dist(pt, { x: wx, y: wy });
        if (d <= t && (!best || d < best.d)) {
          best = { x: wx, y: wy, blockId: b.id, anchor: a.id, d };
        }
      }
    }
    return best ? { x: best.x, y: best.y, blockId: best.blockId, anchor: best.anchor } : null;
  }

  // ===========================================================================
  // SELECTION MODEL — view-layer Set<id>, never mutates state.
  // ===========================================================================

  function createSelection() {
    const ids = new Set();
    return {
      add(id)      { if (typeof id === 'string') ids.add(id); return this; },
      remove(id)   { ids.delete(id); return this; },
      toggle(id)   { ids.has(id) ? ids.delete(id) : ids.add(id); return this; },
      clear()      { ids.clear(); return this; },
      contains(id) { return ids.has(id); },
      list()       { return Array.from(ids); },
      size()       { return ids.size; },
      isEmpty()    { return ids.size === 0; },
      // Replace the selection wholesale (e.g. marquee select).
      set(idArray) {
        ids.clear();
        if (Array.isArray(idArray)) for (const id of idArray) if (typeof id === 'string') ids.add(id);
        return this;
      },
    };
  }

  // ===========================================================================
  // UNDO / REDO — ring buffer of JSON snapshots, wraps a CanvasState.
  // ===========================================================================
  // Snapshots are full state JSON (cheap given typical Sonor project sizes).
  // For very large projects a future optimisation can swap to JSON-patch diffs
  // without changing the public API. Cap defaults to 100 to keep memory bounded.

  function createHistory(state, opts) {
    if (!state || typeof state.toJSON !== 'function') {
      throw new Error('createHistory: state with toJSON() required');
    }
    const cap = (opts && Number.isFinite(opts.cap) && opts.cap > 0) ? opts.cap : 100;
    const undoStack = [];   // newest at end
    const redoStack = [];   // newest at end
    // Seed with current state.
    undoStack.push(JSON.stringify(state.toJSON()));

    function _restore(json) {
      // The state object is the SAME reference held by the caller. Mutate
      // in place by clearing + re-adding from the snapshot.
      const parsed = JSON.parse(json);
      state.clear();
      if (Array.isArray(parsed.blocks)) parsed.blocks.forEach(b => state.addBlock(b));
      if (Array.isArray(parsed.shapes)) parsed.shapes.forEach(s => state.addShape(s));
      if (Array.isArray(parsed.links))  parsed.links.forEach(l => state.addLink(l));
    }

    return {
      /** Call AFTER a logical state mutation. Pushes snapshot, clears redo. */
      capture() {
        undoStack.push(JSON.stringify(state.toJSON()));
        if (undoStack.length > cap) undoStack.shift();
        redoStack.length = 0;
      },
      canUndo() { return undoStack.length > 1; },
      canRedo() { return redoStack.length > 0; },
      undo() {
        if (undoStack.length <= 1) return false;
        const current = undoStack.pop();
        redoStack.push(current);
        _restore(undoStack[undoStack.length - 1]);
        return true;
      },
      redo() {
        if (redoStack.length === 0) return false;
        const next = redoStack.pop();
        undoStack.push(next);
        _restore(next);
        return true;
      },
      depth() { return { undo: Math.max(0, undoStack.length - 1), redo: redoStack.length }; },
      clear() { undoStack.length = 0; redoStack.length = 0; undoStack.push(JSON.stringify(state.toJSON())); },
    };
  }

  // ===========================================================================
  // ROUTING — Link geometry derivation. Phase 1b ships straight + orthogonal.
  // ===========================================================================
  // Phase 3 will add A* (obstacle-aware) and richer orthogonal variants.

  /**
   * Resolve a LinkEnd to its world position via the block (+anchor) lookup.
   * @param {LinkEnd} end
   * @param {Function} getBlock - (id) => Block|null
   */
  function resolveLinkEndWorld(end, getBlock) {
    const b = getBlock(end.blockId);
    if (!b) return null;
    if (end.anchor) {
      const a = (b.anchors || []).find(x => x.id === end.anchor);
      if (a) return { x: b.position_world.x + a.offset.x, y: b.position_world.y + a.offset.y };
    }
    return { x: b.position_world.x, y: b.position_world.y };
  }

  /**
   * Returns the array of world points the renderer should draw for this link.
   * Always starts with the from-end world coord and ends with the to-end.
   *
   * @param {Link} link
   * @param {Function} getBlock - (id) => Block|null
   * @returns {Array<{x,y}>}
   */
  function routeLink(link, getBlock) {
    const a = resolveLinkEndWorld(link.from, getBlock);
    const b = resolveLinkEndWorld(link.to,   getBlock);
    if (!a || !b) return [];
    switch (link.routing) {
      case 'manual': {
        const waypoints = Array.isArray(link.waypoints_world) ? link.waypoints_world : [];
        return [a, ...waypoints, b];
      }
      case 'orthogonal':
        // L-shape via single bend at intermediate corner. Picks the bend
        // that produces the cleaner line — horizontal-then-vertical by
        // default; flip if vertical-then-horizontal is shorter total path.
        // Both have identical Manhattan length but the chosen bend can
        // matter for visual readability. Phase 3 will offer offset variants.
        return [a, { x: b.x, y: a.y }, b];
      case 'astar': {
        // Phase 3 (v0.3.0) — real obstacle-aware A*. Obstacles come from
        // `link.metadata.obstacles` (Array<Shape>) when the adapter wants
        // to pass them; otherwise falls back to straight. Resolution +
        // padding configurable via link.metadata.routing_opts.
        const obstacles = (link.metadata && Array.isArray(link.metadata.obstacles))
          ? link.metadata.obstacles : [];
        if (!obstacles.length) return [a, b];   // no obstacles → straight
        const opts = (link.metadata && link.metadata.routing_opts) || {};
        const path = aStarRoute(a, b, obstacles, opts);
        return path && path.length >= 2 ? path : [a, b];
      }
      case 'straight':
      default:
        return [a, b];
    }
  }

  // ===========================================================================
  // OUTLIER DETECTION — identify stray vertices in a polygon/polyline.
  // ===========================================================================
  // The right algorithm per B-83: a vertex is a stray iff BOTH neighbour
  // distances (to vertex i-1 and i+1 in polygon order) are >> the median
  // edge length. This catches genuinely stray vertices while leaving
  // legitimate corners of asymmetric L-shapes alone (where ONE neighbour
  // edge is long but the OTHER is normal).
  //
  // Returns an Array<{index, edgeIn, edgeOut, medianEdge}> sorted by
  // worst-first. Empty array = no strays detected.
  //
  // @param shape - {points_world: [{x,y}], closed: bool} or any object with
  //                a points_world array. Closed shapes wrap (i+1 from last
  //                = first, i-1 from first = last).
  // @param opts - { factor: 3 } — vertex is stray if BOTH edges > factor × median
  function detectOutlierVertices(shape, opts) {
    if (!shape || !Array.isArray(shape.points_world)) return [];
    const pts = shape.points_world;
    const closed = !!shape.closed;
    const N = pts.length;
    if (N < 3) return [];
    const factor = (opts && Number.isFinite(opts.factor) && opts.factor > 0) ? opts.factor : 3;

    // Compute edge lengths (per-vertex, i → i+1)
    const edges = [];
    const lastIdx = closed ? N : N - 1;
    for (let i = 0; i < lastIdx; i++) {
      const j = (i + 1) % N;
      edges.push(Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y));
    }
    if (edges.length === 0) return [];

    // Median edge length
    const sorted = edges.slice().sort((a, b) => a - b);
    const medianEdge = sorted[Math.floor(sorted.length / 2)];
    if (medianEdge <= 0) return [];

    const threshold = medianEdge * factor;
    const strays = [];
    for (let i = 0; i < N; i++) {
      // edgeIn = edge from prev to this; edgeOut = edge from this to next
      let edgeIn, edgeOut;
      if (closed) {
        edgeIn = Math.hypot(pts[i].x - pts[(i - 1 + N) % N].x, pts[i].y - pts[(i - 1 + N) % N].y);
        edgeOut = Math.hypot(pts[(i + 1) % N].x - pts[i].x, pts[(i + 1) % N].y - pts[i].y);
      } else {
        if (i === 0) { continue; }                 // first endpoint can't be a stray
        if (i === N - 1) { continue; }             // last endpoint can't be a stray
        edgeIn = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        edgeOut = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      if (edgeIn > threshold && edgeOut > threshold) {
        strays.push({ index: i, edgeIn, edgeOut, medianEdge });
      }
    }
    // Worst-first (largest min-of-edges) so caller can prioritise display
    strays.sort((a, b) => Math.min(b.edgeIn, b.edgeOut) - Math.min(a.edgeIn, a.edgeOut));
    return strays;
  }

  // ===========================================================================
  // A* — obstacle-aware pathfinding on a grid (B-252 Phase 3 main item).
  // ===========================================================================
  // Engineering uses A* for cable routing; this is the canvas-core port.
  // Pure JS, no DOM. Caller passes:
  //   - from / to: world points
  //   - obstacles: Array<Shape> (closed polygons treated as impassable)
  //   - opts:
  //     - gridSize (default 20px): resolution of the search grid
  //     - padding (default gridSize): inflate obstacles by this many px so
  //       routes don't graze walls
  //     - smooth (default true): post-process Bresenham line-of-sight smoothing
  //     - maxNodes (default 20000): safety cap before falling back to straight
  //
  // Returns Array<{x,y}> of world waypoints (always starts with from, ends
  // with to) or null if unreachable / over maxNodes.
  //
  // For Sonor's typical cable-route problem (cinema cable from amp to speaker
  // around a wall), this finds a path in < 100ms even on a 2000×1500 canvas.
  function aStarRoute(from, to, obstacles, opts) {
    const gridSize = (opts && Number.isFinite(opts.gridSize) && opts.gridSize > 0) ? opts.gridSize : 20;
    const padding = (opts && Number.isFinite(opts.padding) && opts.padding >= 0) ? opts.padding : gridSize;
    const smooth = (opts && opts.smooth === false) ? false : true;
    const maxNodes = (opts && Number.isFinite(opts.maxNodes) && opts.maxNodes > 0) ? opts.maxNodes : 20000;

    // Compute search bounds = union of from/to/obstacles bbox, inflated by padding.
    let minX = Math.min(from.x, to.x), minY = Math.min(from.y, to.y);
    let maxX = Math.max(from.x, to.x), maxY = Math.max(from.y, to.y);
    for (const obs of obstacles) {
      if (!obs || !Array.isArray(obs.points_world)) continue;
      for (const p of obs.points_world) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
    const pad2 = padding * 2;
    minX -= pad2; minY -= pad2; maxX += pad2; maxY += pad2;
    const cols = Math.ceil((maxX - minX) / gridSize) + 1;
    const rows = Math.ceil((maxY - minY) / gridSize) + 1;
    if (cols * rows > maxNodes) return null;

    // Snap from/to to grid.
    const fromCell = { c: Math.round((from.x - minX) / gridSize), r: Math.round((from.y - minY) / gridSize) };
    const toCell   = { c: Math.round((to.x   - minX) / gridSize), r: Math.round((to.y   - minY) / gridSize) };
    const cellWorld = (c, r) => ({ x: minX + c * gridSize, y: minY + r * gridSize });

    // Precompute obstacle blocked-cells (inflated by padding) via per-cell
    // point-in-polygon checks. For each cell, mark blocked if its world
    // centre is inside any obstacle expanded by padding.
    const blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = cellWorld(c, r);
        for (const obs of obstacles) {
          if (!obs || !Array.isArray(obs.points_world) || obs.points_world.length < 3) continue;
          if (_pointInInflatedPolygon(w, obs.points_world, padding)) {
            blocked[r * cols + c] = 1; break;
          }
        }
      }
    }
    // Unblock from/to cells so even if the user picks a point near a wall
    // the route can still start/end.
    blocked[fromCell.r * cols + fromCell.c] = 0;
    blocked[toCell.r * cols + toCell.c] = 0;

    // A* with 8-way neighbours, Octile heuristic (admissible for 8-way).
    const SQRT2 = Math.SQRT2;
    const idx = (c, r) => r * cols + c;
    const inBounds = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
    const heuristic = (c, r) => {
      const dc = Math.abs(c - toCell.c), dr = Math.abs(r - toCell.r);
      return (dc + dr) + (SQRT2 - 2) * Math.min(dc, dr);
    };
    const g = new Float64Array(cols * rows).fill(Infinity);
    const f = new Float64Array(cols * rows).fill(Infinity);
    const cameFrom = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const open = [];   // min-heap of cell indices, ordered by f-score

    function heapPush(cellIdx) {
      open.push(cellIdx);
      let i = open.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (f[open[parent]] <= f[open[i]]) break;
        [open[parent], open[i]] = [open[i], open[parent]];
        i = parent;
      }
    }
    function heapPop() {
      const top = open[0];
      const last = open.pop();
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r2 = i * 2 + 2; let smallest = i;
          if (l < open.length && f[open[l]] < f[open[smallest]]) smallest = l;
          if (r2 < open.length && f[open[r2]] < f[open[smallest]]) smallest = r2;
          if (smallest === i) break;
          [open[smallest], open[i]] = [open[i], open[smallest]];
          i = smallest;
        }
      }
      return top;
    }

    const startIdx = idx(fromCell.c, fromCell.r);
    const goalIdx = idx(toCell.c, toCell.r);
    g[startIdx] = 0;
    f[startIdx] = heuristic(fromCell.c, fromCell.r);
    heapPush(startIdx);
    let visited = 0;
    const NB = [[1,0],[ -1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

    while (open.length) {
      const cur = heapPop();
      if (cur === goalIdx) {
        // Reconstruct
        const cells = [];
        let n = cur;
        while (n !== -1) { cells.unshift(n); n = cameFrom[n]; }
        const pts = cells.map(i => {
          const r = Math.floor(i / cols), c = i - r * cols;
          return cellWorld(c, r);
        });
        // Replace first/last with exact from/to to avoid grid-snap visual jump.
        pts[0] = { x: from.x, y: from.y };
        pts[pts.length - 1] = { x: to.x, y: to.y };
        return smooth ? _smoothPath(pts, obstacles, padding) : pts;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      visited++;
      if (visited > maxNodes) return null;
      const cr = Math.floor(cur / cols), cc = cur - cr * cols;
      for (const [dc, dr] of NB) {
        const nc = cc + dc, nr = cr + dr;
        if (!inBounds(nc, nr)) continue;
        const ni = idx(nc, nr);
        if (blocked[ni] || closed[ni]) continue;
        // For diagonals, require both orthogonal neighbours to be passable
        // (no corner-cutting through walls).
        if (dc !== 0 && dr !== 0) {
          if (blocked[idx(cc + dc, cr)] && blocked[idx(cc, cr + dr)]) continue;
        }
        const step = (dc !== 0 && dr !== 0) ? SQRT2 : 1;
        const tentative = g[cur] + step;
        if (tentative < g[ni]) {
          cameFrom[ni] = cur;
          g[ni] = tentative;
          f[ni] = tentative + heuristic(nc, nr);
          heapPush(ni);
        }
      }
    }
    return null;   // unreachable
  }

  // Point-in-polygon with an inflation radius. A point counts as "inside"
  // if it's inside the polygon OR within `inflate` px of any edge.
  function _pointInInflatedPolygon(pt, polyPoints, inflate) {
    if (_pointInPolygonRaw(pt, polyPoints)) return true;
    if (inflate <= 0) return false;
    for (let i = 0; i < polyPoints.length; i++) {
      const j = (i + 1) % polyPoints.length;
      const a = polyPoints[i], b = polyPoints[j];
      // Distance from pt to segment ab.
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) continue;
      let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projx = a.x + t * dx, projy = a.y + t * dy;
      const d = Math.hypot(pt.x - projx, pt.y - projy);
      if (d <= inflate) return true;
    }
    return false;
  }

  function _pointInPolygonRaw(pt, polyPoints) {
    let inside = false;
    for (let i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
      const xi = polyPoints[i].x, yi = polyPoints[i].y;
      const xj = polyPoints[j].x, yj = polyPoints[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-10) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Path smoothing — string-pull obvious zigzags via line-of-sight.
  // Walks the path and drops intermediate points where a straight line
  // from the previous kept point to the next-next point doesn't hit any
  // obstacle. Keeps Manhattan grid-paths looking like clean diagonals.
  function _smoothPath(pts, obstacles, padding) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      // Find the FARTHEST j such that the line from pts[i] to pts[j]
      // has line-of-sight (doesn't pass through any obstacle's inflated zone).
      while (j > i + 1) {
        if (_lineOfSight(pts[i], pts[j], obstacles, padding)) break;
        j--;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  function _lineOfSight(a, b, obstacles, padding) {
    // Sample along the segment and check each point against obstacles.
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    const steps = Math.max(2, Math.ceil(len / Math.max(1, padding / 2)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const pt = { x: a.x + dx * t, y: a.y + dy * t };
      for (const obs of obstacles) {
        if (!obs || !Array.isArray(obs.points_world) || obs.points_world.length < 3) continue;
        if (_pointInInflatedPolygon(pt, obs.points_world, padding)) return false;
      }
    }
    return true;
  }

  // ===========================================================================
  // LINE JUMPS — T1 from Engineering (B-252 Phase 3 first item).
  // ===========================================================================
  // When two paths cross, the upper path gets a small 180° arc over the lower.
  // Pure post-process on already-routed paths — adapter renders the arcs
  // however it likes (svg path arc commands, fabric.Path, canvas curves).

  /**
   * @typedef {Object} PathSegment
   * @property {'line'|'arc'} kind
   * @property {{x,y}} a              - line start, arc start
   * @property {{x,y}} b              - line end,   arc end
   * @property {number} [radius]      - arc only
   * @property {{x,y}} [centre]       - arc only
   * @property {boolean} [over]       - arc only — true if jumping OVER (upper path)
   */

  /**
   * Convert N paths (each = Array<{x,y}>) into N path-segment lists with
   * line-jump arcs at every crossing. Earlier paths in the input are LOWER
   * in z-order; later paths jump over earlier ones.
   *
   * @param {Array<Array<{x,y}>>} paths
   * @param {Object} [opts]
   * @param {number} [opts.radius=4]   - jump arc radius
   * @returns {Array<Array<PathSegment>>}
   */
  function emitPathsWithJumps(paths, opts) {
    const radius = (opts && Number.isFinite(opts.radius)) ? opts.radius : 4;
    if (!Array.isArray(paths) || paths.length === 0) return [];

    // 1. Convert each path to a segment list (lines only, no arcs yet).
    const out = paths.map(pts => _pathToLines(pts));

    // 2. For each LATER path, walk its segments and find crossings against
    //    EARLIER paths. Replace each crossing with three sub-segments:
    //    line up to (cross - radius), arc over, line from (cross + radius).
    for (let i = 1; i < out.length; i++) {
      const upper = out[i];
      for (let j = 0; j < i; j++) {
        const lower = out[j];
        out[i] = _insertJumpsAgainst(upper, lower, radius);
      }
    }
    return out;
  }

  function _pathToLines(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return [];
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      segs.push({ kind: 'line', a: { x: pts[i - 1].x, y: pts[i - 1].y }, b: { x: pts[i].x, y: pts[i].y } });
    }
    return segs;
  }

  function _insertJumpsAgainst(upperSegs, lowerSegs, radius) {
    const out = [];
    for (const seg of upperSegs) {
      if (seg.kind !== 'line') { out.push(seg); continue; }
      // Collect crossings against lower path lines, ordered along the upper seg.
      const crosses = [];
      for (const lo of lowerSegs) {
        if (lo.kind !== 'line') continue;
        const ix = _segmentIntersection({ a: seg.a, b: seg.b }, { a: lo.a, b: lo.b });
        if (!ix) continue;
        const t = _projectPointToSegment(ix, seg.a, seg.b).t;
        crosses.push({ ix, t });
      }
      if (crosses.length === 0) { out.push(seg); continue; }
      crosses.sort((p, q) => p.t - q.t);

      // Walk the segment placing line-arc-line triples at each crossing.
      const len = _dist(seg.a, seg.b);
      const dx = (seg.b.x - seg.a.x) / len;
      const dy = (seg.b.y - seg.a.y) / len;
      let cursor = { x: seg.a.x, y: seg.a.y };
      for (const c of crosses) {
        const before = { x: c.ix.x - dx * radius, y: c.ix.y - dy * radius };
        const after  = { x: c.ix.x + dx * radius, y: c.ix.y + dy * radius };
        // Skip degenerate cases where the crossing is too close to the segment end.
        if (_dist(cursor, before) > 0.5) {
          out.push({ kind: 'line', a: cursor, b: before });
        }
        out.push({
          kind: 'arc', a: before, b: after,
          radius, centre: c.ix, over: true,
        });
        cursor = after;
      }
      if (_dist(cursor, seg.b) > 0.5) {
        out.push({ kind: 'line', a: cursor, b: seg.b });
      }
    }
    return out;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  return {
    VERSION,
    // primitive factories
    createBlock,
    createShape,
    createLink,
    // state container
    createState,
    fromJSON,
    // snap library
    snapToGrid,
    snapToVertex,
    snapToEdge,
    snapToMidpoint,
    snapToIntersection,
    snapToAnchor,
    // selection model
    createSelection,
    // history
    createHistory,
    // routing
    resolveLinkEndWorld,
    routeLink,
    aStarRoute,                 // v0.3.0 — obstacle-aware pathfinder
    // outlier detection (v0.3.1)
    detectOutlierVertices,
    // line-jumps (T1)
    emitPathsWithJumps,
  };
}));
