// @ts-check
/**
 * Sonor Takeoffs — Persistence module
 * ===================================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-takeoffs-persistence.js by
 * sync-everything.sh; never hand-edit the per-app copy.
 *
 * @version 1.7.0   (Sonor Takeoffs v5.244.0 — 2026-10-13 — soft-delete floors: deleteFloorCloud(); pullFloors skips deleted_at rows;
 *                  pushFloors never re-saves a deleted floor)
 * @version 1.6.0   (Sonor Takeoffs v5.244.0 — 2026-10-13 — pushFloors refuses to INSERT a floor id that belongs to another
 *                  project saved in the last 30 days: cross-project leak guard, reason "cross-project")
 * @version 1.2.0   (Sonor Takeoffs v5.46.1 — 2026-07-06 — added 'buildingOutline' to
 *                   FLOOR_BUCKETS. ROOT-CAUSE of "outline doesn't persist": the module
 *                   keeps its OWN bucket list; registerKind('buildingOutline') pushed
 *                   into floor.buildingOutline which captureFloor never seeded → every
 *                   capture threw "reading 'push'" into the per-kind catch, silently.
 *                   LESSON: a new persistence kind = registerKind + BOTH bucket lists
 *                   (host FLOOR_BUCKETS + THIS module's) — see host FLOOR_BUCKETS note.)
 * @version 1.1.0   (Sonor Takeoffs v3.5.0 — 2026-04-30 — added 'dimensions' to FLOOR_BUCKETS)
 * @license proprietary — Sonor Smart Homes
 *
 * Owns the persistence architecture for Sonor Takeoffs:
 *
 *   - FLOOR_BUCKETS — single source of truth for the per-floor data shape.
 *     Adding a new persistence kind = ONE row here + ONE registerKind call.
 *
 *   - Per-kind registry — capture / restore / filter functions registered
 *     by the host page. Replaces the 13 hand-coded if/else branches in
 *     _captureFloorPayload / _applyFloorPayload / _serialiseHistoryState.
 *
 *   - LWW (Last-Write-Wins) cloud-vs-local arbitration with explicit
 *     `version` integer + `updated_at` timestamp + 2 s clock-skew tolerance.
 *     Replaces the v3.0.7 "skip overlay when local fresh" guard which
 *     mis-engaged when cloud had newer data.
 *
 *   - Quota-bust sentinel — when localStorage hits QuotaExceededError
 *     the sentinel is set and the next boot forces a cloud overlay,
 *     guaranteeing recovery from silent staleness.
 *
 *   - Single boot entry point — bootRestore() replaces the dual
 *     `loadState()` + `_switchToProject({safeBootOverlay:true})` race.
 *
 *   - Dev-mode round-trip assert — when window.__SONOR_DEV__ is true,
 *     every save runs floor → row → floor and asserts identity per bucket.
 *     Catches FLOOR_BUCKETS regressions before they reach Supabase.
 *
 *   - Trace logging — when window.__SONOR_TRACE__ is true, capture / persist
 *     / apply paths emit phase-tagged logs (PHASE 0 LIVE, PHASE 1 CAPTURED,
 *     PHASE 2 PERSISTED, PHASE 3 IN-MEMORY, PHASE 4 PAINTED) — the diagnostic
 *     protocol from .claude/skills/persistence-debugging/SKILL.md.
 *
 * The module does NOT own per-kind canvas paint/draw code. That stays in
 * the host page until v3.6.0's render-* extractions. The host registers
 * its restorer functions during boot via SonorPersistence.registerKind().
 *
 * Public API summary
 * ------------------
 *   FLOOR_BUCKETS                       -- frozen string[]
 *   LS_KEY, LS_KEY_QUOTA_BUST,
 *   QUOTA_PRESTRIP_BYTES, SAVE_DEBOUNCE_MS, SKEW_TOLERANCE_MS
 *
 *   registerKind(name, opts)           -- host wires per-kind capture/restore
 *   emptyFloor(name, opts)             -- new floor with every bucket = []
 *   makeFloorId()                      -- random ID
 *   deriveFloorCode(name)              -- "Ground Floor" -> "GF"
 *
 *   captureFloor(canvas, floor, ctx)   -- canvas -> floor.* (mutates floor)
 *   applyFloor(canvas, floor, ctx)     -- floor -> canvas; Promise<{ok, kindStats}>
 *
 *   floorToRow(floor, projectId, seq, appVersion)
 *   rowToFloor(row, localBgByFloorId)
 *   pullFloors(supa, projectId, localBgByFloorId)
 *   pushFloors(supa, projectId, floors, opts)
 *
 *   persistEnvelope(env, opts)         -- write LS; on quota -> sentinel + cb
 *   loadEnvelope()                     -- { floors, savedAt, version, hasQuotaBust }
 *   clearQuotaBust()
 *
 *   serialiseHistory(canvas, ctx)      -- JSON string of every bucket
 *   applyHistory(canvas, json, ctx)    -- paint canvas from JSON
 *
 *   resolveBoot({local, cloud, skewMs, hasQuotaBust})  -- 'cloud' | 'local'
 *   bootRestore(opts)                  -- single boot entry point
 *
 *   setTrace(on), setDevAssert(on)
 *   assertRoundTrip(floor)
 *   __version
 *
 * Both ES module exports and a window.SonorPersistence pin are emitted.
 * Tests + legacy callers can use either surface interchangeably.
 */
(function (root, factory) {
  // UMD-ish wrapper: pin to window for legacy inline access; ES `export`
  // statements are present below for module consumers.
  const api = factory();
  if (typeof root !== 'undefined') {
    root.SonorPersistence = api;
  }
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const __version = '1.6.0';

  /**
   * The single source of truth for per-floor data shape. Adding a new
   * persistence kind requires:
   *   1. one row here
   *   2. one registerKind() call from the host
   *   3. (canvas-side: a builder that tags new objects with the right tag)
   *
   * No other site in the codebase should enumerate kinds.
   */
  const FLOOR_BUCKETS = Object.freeze([
    'symbols',         // every block placement
    'lengths',         // cable runs (sonorMeasure.kind='length')
    'areas',           // room polygons (sonorMeasure.kind='area')
    'leds',            // LED runs (sonorMeasure.kind='led')
    'shades',          // shades / blinds polylines (sonorShade)
    'tvs',             // TV / Display polylines (sonorTv)
    'pjScreens',       // PJ Screens (sonorPjScreen)
    'revisionClouds',  // revision-cloud annotations (sonorRevCloud)
    'containment',     // cable trays / trunking / conduit (sonorContainment)
    'annotations',     // pen-mode strokes (sonorAnnotation)
    'textBoxes',       // text-box annotations (sonorTextBox)
    'leaders',         // leader / callout polylines (sonorLeader)
    'pinSnags',        // pin-snag placements (Fieldwire-parity, Portal bridge)
    'dimensions',      // dimension annotations (sonorMeasure.kind='dimension') — added v3.4.16
    'buildingOutline', // building footprint outline (sonorBuildingOutline) — added v1.2.0 (app v5.46.1)
  ]);

  /** localStorage key for the v2 envelope. */
  const LS_KEY = 'sonor-takeoffs-state-v2';

  /**
   * Quota-bust sentinel. Set when _persistFloors hits QuotaExceededError.
   * Boot honours this BEFORE the freshness guard — when set, cloud overlay
   * runs unconditionally (cloud has the only complete state). Cleared on
   * the next successful local write OR after a successful cloud overlay.
   */
  const LS_KEY_QUOTA_BUST = 'sonor-takeoffs-quota-bust-v3.3.5';

  /**
   * Pre-strip threshold. When the envelope (with backgroundImage) is
   * larger than this, _persistFloors strips the background BEFORE writing
   * so the persistent state survives quota pressure. Lowered from v3.0.7's
   * 3.5 MB to 1 MB after Bryn's v3.0.x quota errors — earlier strip =
   * more headroom for placements.
   */
  const QUOTA_PRESTRIP_BYTES = 1_000_000;

  /** saveState() debounce — 350 ms matches v3.0.x cadence. */
  const SAVE_DEBOUNCE_MS = 350;

  /**
   * Cloud-vs-local clock-skew tolerance for LWW arbitration. Cloud must
   * be NEWER than local by at least this margin to win — prevents flapping
   * when local just-saved and cloud's `now()` hasn't caught up.
   */
  const SKEW_TOLERANCE_MS = 2_000;

  // ============================================================
  // PER-KIND REGISTRY
  // ============================================================
  //
  // The host registers each kind once at boot. Each entry tells the
  // module how to detect canvas objects of this kind, capture them into
  // the persisted record shape, and restore them back onto the canvas.
  //
  // Registry shape:
  //   {
  //     name:        'symbols' | 'lengths' | ...,
  //     tag:         'sonorSymbol' | 'sonorMeasure' | ...,
  //     filter?:     (o) => boolean,           // for sonorMeasure sub-kinds
  //     capture:     (o) => record,            // canvas obj -> persisted record
  //     captureExtras?: (o, rec) => rec,       // optional post-capture mutation
  //     restore:     (rec, ctx) => fabricObj?, // record -> add to canvas
  //     ephemeral?:  boolean                   // skip during capture? (mode overlays)
  //   }

  /** @type {Map<string, object>} */
  const _kinds = new Map();

  /**
   * Register a persistence kind. The host page calls this once per kind
   * during boot, supplying its existing capture / restore functions.
   *
   * @param {string} name - one of FLOOR_BUCKETS
   * @param {object} opts
   * @param {string} [opts.tag] - canvas object property key (e.g. 'sonorSymbol')
   * @param {Function} [opts.filter] - (o) => bool, narrows tag matches
   * @param {Function} opts.capture - (o) => record
   * @param {Function} opts.restore - (record, ctx) => fabric obj or void
   */
  function registerKind(name, opts) {
    if (!FLOOR_BUCKETS.includes(name)) {
      console.warn('[SonorPersistence] registerKind: unknown bucket "' + name + '". Add to FLOOR_BUCKETS first.');
    }
    _kinds.set(name, Object.assign({ name }, opts));
  }

  function getKind(name) {
    return _kinds.get(name) || null;
  }

  function listKinds() {
    return FLOOR_BUCKETS.map(k => _kinds.get(k)).filter(Boolean);
  }

  // ============================================================
  // EPHEMERAL FILTER (mode-overlay skip list)
  // ============================================================
  //
  // Mode-overlay objects (heatmaps, signal chips, view cones, etc.) are
  // visual derivatives that are rebuilt on demand when a mode is engaged.
  // They MUST NOT be persisted into the floor envelope. The host can
  // pass an ephemeral filter via setEphemeralFilter(); falls back to the
  // built-in tag list. Post v3.5.0 (modes module) this list is auto-derived
  // from MODES[].ephemeralTags.

  let _ephemeralFilter = null;

  function setEphemeralFilter(fn) {
    _ephemeralFilter = (typeof fn === 'function') ? fn : null;
  }

  function _isEphemeralBuiltin(o) {
    if (!o) return false;
    return !!(
      o._sonorWapHeatmap || o._sonorWapSignalChip ||
      o._sonorCctvCoverageHeatmap || o._sonorCctvBlindspot || o._sonorCctvIrRing ||
      o._sonorWifiChannel || o._sonorNetworkPort || o._sonorBackhaul ||
      o._sonorCircuitTopo || o._sonorWattsTally ||
      o._sonorAudioTopo || o._sonorAmpChannel || o._sonorListeningPos ||
      o._sonorMatrixOutput || o._sonorVideoBackhaul ||
      o._sonorCinemaRoomChip ||
      o._sonorAutomationRoomCount ||
      o._sonorClimateRoomChip || o._sonorClimateRoomCount ||
      o._sonorControlRoomCount || o._sonorInfraRoomCount ||
      o._sonorViewCone === true ||
      o._sonorEphemeral === true ||
      (o._sonorLeaderArrow === true && !o.sonorLeader)
    );
  }

  function isEphemeral(o) {
    if (_ephemeralFilter) {
      try { return !!_ephemeralFilter(o); } catch (_) { return _isEphemeralBuiltin(o); }
    }
    return _isEphemeralBuiltin(o);
  }

  // ============================================================
  // FLOOR LIFECYCLE
  // ============================================================

  /**
   * Generate a unique floor id matching the existing
   * `f${date36}${rand4}` convention.
   */
  function makeFloorId() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Derive a 2-character floor code from a name. Used for auto-ID tokens
   * (GF/1F/BA/LF/MZ/RF/CE/etc). Behaviour matches the host's
   * _deriveFloorCode (sonor-takeoffs.html ~line 11706) exactly so the
   * module can be the canonical source post-extraction.
   */
  function deriveFloorCode(name) {
    const raw = String(name || '').trim().toLowerCase();
    if (!raw) return 'F' + Math.floor(Math.random() * 9 + 1);
    // Explicit common names — match anywhere (handles "Floor 1",
    // "1st Floor", "First Storey" all in stride).
    if (/(^|\b)(g|ground|gf)\b/.test(raw))         return 'GF';
    if (/(^|\b)(basement|base|lower)\b/.test(raw)) return 'BA';
    if (/(^|\b)(cellar)\b/.test(raw))              return 'CE';
    if (/(^|\b)(mezzanine|mezz)\b/.test(raw))      return 'MZ';
    if (/(^|\b)(loft|attic)\b/.test(raw))          return 'LF';
    if (/(^|\b)(roof|rooftop)\b/.test(raw))        return 'RF';
    // Ordinal digits or words -> {N}F
    const num = raw.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
    if (num) return num[1] + 'F';
    const ord = raw.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
    if (ord) {
      const map = { first: '1F', second: '2F', third: '3F', fourth: '4F', fifth: '5F',
                    sixth: '6F', seventh: '7F', eighth: '8F', ninth: '9F', tenth: '10F' };
      return map[ord[1]];
    }
    // Fallback — first 2 letters stripped to alpha, upper
    const letters = raw.replace(/[^a-z]/g, '').toUpperCase();
    return (letters.slice(0, 2) || 'F1').padEnd(2, 'X').slice(0, 2);
  }

  /**
   * Create an empty floor with every FLOOR_BUCKETS key seeded as [].
   * Adding a new kind to FLOOR_BUCKETS automatically gets its empty array
   * here.
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {string} [opts.code]
   * @param {string} [opts.id]
   * @returns {object}
   */
  function emptyFloor(name, opts) {
    const o = opts || {};
    const resolvedName = name || 'Untitled Floor';
    const f = {
      id: o.id || makeFloorId(),
      name: resolvedName,
      code: o.code || deriveFloorCode(resolvedName),
      scalePxPerM: null,
      roomCounter: 0,
      activeCableId: 'cat6d',
      activeLedId: 'strip-w',
      backgroundImage: null,
      exportFrame: null,                           // v1.4.0 — PDF export frame rect {x,y,w,h} in world px, null = full canvas
      version: 1,                                  // LWW optimistic-concurrency counter
    };
    for (const k of FLOOR_BUCKETS) f[k] = [];
    return f;
  }

  // ============================================================
  // CAPTURE — canvas -> floor.*
  // ============================================================
  //
  // Walks canvas.getObjects() once. For each object:
  //   - skip if isEphemeral(o)
  //   - if a kind's filter+tag matches, push the kind.capture(o) record
  //     into floor[kind.name]
  //   - if it has a sonorPlan tag, capture the backgroundImage src
  //
  // Mutates `floor` in place (matches the existing _captureFloorPayload
  // contract). Returns counts for diagnostics.

  /**
   * @param {object} canvas - fabric.Canvas
   * @param {object} floor - target floor; mutated
   * @param {object} [ctx] - host context (not used by capture; kept for symmetry)
   * @returns {{ counts: object, ephemeralSkipped: number }}
   */
  function captureFloor(canvas, floor, ctx) {
    if (!floor) return { counts: {}, ephemeralSkipped: 0 };
    // Reset every bucket to []
    for (const k of FLOOR_BUCKETS) floor[k] = [];
    let backgroundImage = floor.backgroundImage || null;
    let ephemeralSkipped = 0;

    const objs = (canvas && canvas.getObjects) ? canvas.getObjects() : [];
    for (const o of objs) {
      if (!o) continue;
      if (isEphemeral(o)) { ephemeralSkipped++; continue; }
      if (o.sonorPlan) {
        try {
          backgroundImage = (o.getSrc && o.getSrc()) ||
                            (o._element && o._element.src) ||
                            backgroundImage;
        } catch (_) {}
        continue;
      }
      // Find the matching kind. Iterate registry; first match wins.
      let matched = false;
      for (const kind of listKinds()) {
        const tagOk = kind.tag ? !!o[kind.tag] : true;
        if (!tagOk) continue;
        if (kind.filter && !kind.filter(o)) continue;
        try {
          const rec = kind.capture(o);
          if (rec) floor[kind.name].push(rec);
        } catch (e) {
          console.warn('[SonorPersistence] capture failed for kind ' + kind.name + ':', e && e.message);
        }
        matched = true;
        break;
      }
      // unmatched objects are silently ignored (chrome, system overlays)
    }

    floor.backgroundImage = backgroundImage;

    if (typeof window !== 'undefined' && window.__SONOR_TRACE__) {
      const counts = {};
      for (const k of FLOOR_BUCKETS) counts[k] = floor[k].length;
      console.log('[Sonor PERSIST PHASE 1 CAPTURED]', { floor: floor.name, counts, ephemeralSkipped });
    }

    const counts = {};
    for (const k of FLOOR_BUCKETS) counts[k] = floor[k].length;
    return { counts, ephemeralSkipped };
  }

  // ============================================================
  // APPLY — floor -> canvas
  // ============================================================
  //
  // Resolves with { ok, kindStats, restoreFailures } once every kind has
  // been restored. Per-kind try/catch isolates failures (one bad row
  // doesn't kill the whole apply path).

  /**
   * @param {object} canvas - fabric.Canvas
   * @param {object} floor - source floor
   * @param {object} ctx - host context (passed to each kind.restore)
   * @returns {Promise<{ ok: boolean, kindStats: object, restoreFailures: array }>}
   */
  function applyFloor(canvas, floor, ctx) {
    return new Promise((resolve) => {
      if (!floor) { resolve({ ok: false, kindStats: {}, restoreFailures: [] }); return; }

      const _kindStats = {};
      const _restoreFailures = [];
      const _logKind = (kindName, total, ok, failures) => {
        _kindStats[kindName] = { total, ok, failed: total - ok };
        if (failures && failures.length) _restoreFailures.push({ kind: kindName, failures });
      };

      const startMeta = {
        floorName: floor.name,
        payload: {},
        hasBg: !!floor.backgroundImage,
        appliedAt: new Date().toISOString(),
      };
      for (const k of FLOOR_BUCKETS) startMeta.payload[k] = (floor[k] || []).length;

      const TRACE = (typeof window !== 'undefined') && window.__SONOR_TRACE__;
      if (TRACE) console.log('[Sonor PERSIST PHASE 3 APPLY START]', startMeta);

      const _doApply = () => {
        // Iterate FLOOR_BUCKETS in declared order. The host can rely on
        // textBoxes restoring before leaders (declared in that order).
        for (const k of FLOOR_BUCKETS) {
          const list = floor[k] || [];
          if (!list.length) { _logKind(k, 0, 0, []); continue; }
          const kind = getKind(k);
          if (!kind || typeof kind.restore !== 'function') {
            // No restorer registered — log and skip; future bucket
            // declared in FLOOR_BUCKETS but not wired by host yet.
            _logKind(k, list.length, 0, [{ idx: -1, err: 'no restore registered' }]);
            console.warn('[SonorPersistence] applyFloor: kind "' + k + '" has no registered restore — skipping ' + list.length + ' record(s)');
            continue;
          }
          let ok = 0; const fails = [];
          for (let i = 0; i < list.length; i++) {
            try { kind.restore(list[i], ctx); ok++; }
            catch (e) {
              fails.push({ idx: i, err: e && e.message });
              console.warn('[SonorPersistence] restore failed for ' + k + '[' + i + ']:', e && e.message);
            }
          }
          _logKind(k, list.length, ok, fails);
        }

        // Host-supplied post-apply hook (relabel, recalc, render).
        if (ctx && typeof ctx.afterApply === 'function') {
          try { ctx.afterApply(floor); }
          catch (e) { console.warn('[SonorPersistence] afterApply hook failed:', e && e.message); }
        }

        if (TRACE) {
          const objs = (canvas && canvas.getObjects) ? canvas.getObjects() : [];
          console.log('[Sonor PERSIST PHASE 4 APPLY END]', {
            floorName: floor.name,
            kindStats: _kindStats,
            restoreFailures: _restoreFailures,
            canvasObjectCount: objs.length,
            doneAt: new Date().toISOString(),
          });
        }

        resolve({ ok: true, kindStats: _kindStats, restoreFailures: _restoreFailures });
      };

      // Background image first (async via fabric.Image.fromURL when host
      // provides the loader). Host hands us a `loadBackground` function
      // that calls back when done.
      if (floor.backgroundImage && ctx && typeof ctx.loadBackground === 'function') {
        try {
          ctx.loadBackground(floor.backgroundImage, () => _doApply());
          return;
        } catch (e) {
          console.warn('[SonorPersistence] loadBackground threw — applying without bg:', e && e.message);
        }
      }
      _doApply();
    });
  }

  // ============================================================
  // CLOUD (Supabase) — push / pull / row mapping
  // ============================================================

  /**
   * Convert a floor object into a takeoffs_floors row. backgroundImage is
   * intentionally NOT included — the plan PNG lives in Supabase Storage
   * (takeoffs-plans bucket) keyed by floor_id, not in the row content.
   */
  function floorToRow(floor, projectId, seq, appVersion) {
    if (!floor || !projectId) return null;
    const content = {
      scalePxPerM:   floor.scalePxPerM ?? null,
      roomCounter:   floor.roomCounter ?? 0,
      activeCableId: floor.activeCableId || 'cat6d',
      activeLedId:   floor.activeLedId   || 'strip-w',
      backgroundImage: null,
      exportFrame:   floor.exportFrame || null,   // v1.4.0 — PDF export frame passthrough
      // v1.6.0 (2026-10-16) — floor-level scalars that are NOT buckets and were silently dropped on the cloud round trip:
      // the lighting circuit → type map (floor.circuitTypes, pairs.js _circuitTypesMapFor) and the mirrored-outline flags
      circuitTypes:  (floor.circuitTypes && typeof floor.circuitTypes === 'object') ? floor.circuitTypes : {},
      buildingOutlineOffset: floor.buildingOutlineOffset || null,
      buildingOutlineOptOut: floor.buildingOutlineOptOut ? true : null,
    };
    for (const k of FLOOR_BUCKETS) {
      content[k] = Array.isArray(floor[k]) ? floor[k] : [];
    }
    // v5.6.1 (drawing-audit F7) — Phase 2 dual-write commit. Populate the
    // canvas_core JSONB column alongside legacy `content` when the
    // SonorCanvasCore engine is loaded. The two columns carry the same
    // logical state in two encodings — content is the historical Takeoffs
    // shape (FLOOR_BUCKETS arrays per kind), canvas_core is the workspace-
    // shared canvas-core state shape. The parity audit task can finally
    // run against real data because both columns now populate together.
    //
    // Pre-v5.6.1: canvas_core existed since v5.5.45 but no writer touched
    // it. The audit flagged half-migrated state as P1. Committed here
    // (vs. dropping the column) because additive is safer than destructive.
    let canvasCorePayload = null;
    let canvasCoreVersion = null;
    try {
      if (typeof window !== 'undefined' &&
          window.SonorCanvasCore &&
          typeof window.SonorCanvasCore.floorToCoreState === 'function') {
        // The adapter MAY expose a fabric-aware floorToCoreState helper.
        // If not present, leave canvas_core null (engineless path stays
        // safe — content column remains canonical).
        canvasCorePayload = window.SonorCanvasCore.floorToCoreState(floor);
        canvasCoreVersion = window.SonorCanvasCore.__version || null;
      }
    } catch (_) {
      // Non-fatal — never block a save because of canvas-core encoder.
      canvasCorePayload = null;
    }

    const row = {
      project_id: projectId,
      floor_id: floor.id,
      code: floor.code || deriveFloorCode(floor.name || 'Floor'),
      name: floor.name || 'Untitled Floor',
      seq: Number.isFinite(seq) ? seq : 0,
      content,
      version: floor.version || 1,
      metadata: { app_version: appVersion || (typeof window !== 'undefined' && window.APP_VERSION) || 'unknown' },
    };
    if (canvasCorePayload) {
      row.canvas_core             = canvasCorePayload;
      row.canvas_core_version     = canvasCoreVersion;
      row.canvas_core_written_at  = new Date().toISOString();
    }
    return row;
  }

  /**
   * Convert a takeoffs_floors row back into an in-memory floor.
   * `localBgByFloorId` (optional) preserves per-floor backgroundImage from
   * the local envelope so plan PNGs survive cloud overlays even when the
   * cloud row carries no image.
   */
  function rowToFloor(row, localBgByFloorId) {
    if (!row) return null;
    const c = row.content || {};
    const f = {
      id: row.floor_id,
      name: row.name || 'Untitled Floor',
      code: row.code || deriveFloorCode(row.name || 'Floor'),
      scalePxPerM:   c.scalePxPerM ?? null,
      roomCounter:   c.roomCounter ?? 0,
      activeCableId: c.activeCableId || 'cat6d',
      activeLedId:   c.activeLedId   || 'strip-w',
      backgroundImage: (localBgByFloorId && localBgByFloorId[row.floor_id]) || null,
      exportFrame:   c.exportFrame || null,       // v1.4.0 — PDF export frame passthrough
      circuitTypes:  (c.circuitTypes && typeof c.circuitTypes === 'object') ? c.circuitTypes : {},   // v1.6.0
      buildingOutlineOffset: c.buildingOutlineOffset || null,
      buildingOutlineOptOut: c.buildingOutlineOptOut ? true : null,
      version: row.version || 1,
    };
    for (const k of FLOOR_BUCKETS) {
      f[k] = Array.isArray(c[k]) ? c[k] : [];
    }
    return f;
  }

  /**
   * Pull all floors for a project. Returns { rows, ok, newestCloudAt, error? }.
   */
  async function pullFloors(supa, projectId, localBgByFloorId) {
    if (!supa || !projectId) return { rows: [], ok: false, reason: 'not-wired' };
    try {
      let { data, error } = await supa
        .from('takeoffs_floors')
        .select('floor_id, code, name, seq, content, version, updated_at, deleted_at')
        .eq('project_id', projectId)
        .order('seq', { ascending: true });
      if (error) throw error;
      // v1.7.0 — soft-deleted floors stay deleted (and are reported so the boot merge never re-adds them from the local envelope)
      const deletedIds = (data || []).filter(r => r.deleted_at).map(r => r.floor_id);
      data = (data || []).filter(r => !r.deleted_at);
      const rows = (data || []).map(r => rowToFloor(r, localBgByFloorId || {}));
      let newestCloudAt = null;
      (data || []).forEach(r => {
        if (r.updated_at) {
          const t = new Date(r.updated_at).getTime();
          if (!newestCloudAt || t > newestCloudAt) newestCloudAt = t;
        }
      });
      return { rows, ok: true, newestCloudAt, deletedIds };
    } catch (err) {
      console.warn('[SonorPersistence] pullFloors failed:', err);
      return { rows: [], ok: false, error: err };
    }
  }

  /**
   * Upsert every in-memory floor as a takeoffs_floors row. Optimistic on
   * `version` — if a concurrent write advanced the cloud row, the upsert
   * still succeeds (last-write-wins by updated_at) but the local row's
   * `version` is incremented so the next save matches.
   */
  /**
   * v1.7.0 (2026-10-13, Bryn: "why did all the other ones come back after refresh?") — deleting a floor in the app only removed it
   * from memory; the cloud row stayed and pullFloors brought it back. There is no DELETE policy on takeoffs_floors (by design), so a
   * delete is a SOFT delete: deleted_at + deleted_reason on the row; pullFloors skips it, pushFloors never re-saves it.
   */
  async function deleteFloorCloud(supa, projectId, floorId, reason) {
    if (!supa || !projectId || !floorId) return { ok: false, reason: 'not-wired' };
    try {
      const { data, error } = await supa.from('takeoffs_floors')
        .update({ deleted_at: new Date().toISOString(), deleted_reason: reason || 'deleted in Takeoffs' })
        .eq('project_id', projectId).eq('floor_id', floorId).select('floor_id');
      if (error) throw error;
      return { ok: true, count: (data || []).length };
    } catch (err) { console.warn('[SonorPersistence] deleteFloorCloud failed:', err); return { ok: false, error: err }; }
  }

  async function pushFloors(supa, projectId, floors, opts) {
    const o = opts || {};
    const appVersion = o.appVersion || (typeof window !== 'undefined' && window.APP_VERSION) || 'unknown';
    if (!supa || !projectId || !Array.isArray(floors) || !floors.length) {
      return { ok: false, reason: 'not-wired' };
    }
    // v1.3.0 — COMPARE-AND-SWAP on `version` (optimistic concurrency). A floor
    // only lands if its cloud row still carries the version we loaded; any
    // concurrent write (another tab / session / device / out-of-band tool)
    // advances `version`, our conditional UPDATE matches 0 rows, and we report
    // a conflict instead of overwriting. Realtime-independent — correct with
    // any number of writers. Replaces the pre-v1.3.0 unconditional upsert
    // (LWW) that let a stale writer silently clobber newer cloud data.
    const conflicts = [];
    const crossProject = [];   // v1.6.0
    let count = 0;
    // v1.4.1 (audit A1) — seq threading. Hosts push CHANGED-FLOOR SUBSETS
    // (change-detection filter), so the loop index is NOT the floor's canonical
    // position: writing it as seq scrambled tab order on every incremental
    // save (all floors converge to seq 0). opts.seqByFloorId carries the true
    // full-array index; loop index remains the fallback for full-array pushes.
    const seqOf = (f, i) => {
      if (o.seqByFloorId && f && Number.isFinite(o.seqByFloorId[f.id])) return o.seqByFloorId[f.id];
      return i;
    };
    try {
      for (let i = 0; i < floors.length; i++) {
        const f = floors[i];
        if (!f) continue;
        const baseVersion = f.version || 1;
        // Probe existence to choose INSERT (new floor) vs CAS-UPDATE.
        const sel = await supa
          .from('takeoffs_floors')
          .select('version, deleted_at')
          .eq('project_id', projectId)
          .eq('floor_id', f.id)
          .limit(1);
        if (sel.error) throw sel.error;
        const existing = sel.data && sel.data[0];
        // v1.7.0 — a floor deleted in the app (soft delete) is never resurrected by a stale tab / in-memory copy.
        if (existing && existing.deleted_at) { console.warn('[SonorPersistence] skip save of deleted floor ' + f.id); continue; }
        if (!existing) {
          // v1.6.0 CROSS-PROJECT LEAK GUARD (2026-10-13: Greylands' 6 floors were INSERTED into Heybridge Cottage at 13:29 — the
          // in-memory floors belonged to the previous project while projectId was already the new one; an earlier wave in Apr–Sep
          // spread two template floors into 18 projects). A floor id that already lives in ANOTHER project which was saved in the
          // last 30 days is that project's floor, not a new one for this project — refuse the insert and report it.
          const other = await supa
            .from('takeoffs_floors')
            .select('project_id, updated_at')
            .eq('floor_id', f.id)
            .neq('project_id', projectId)
            .gte('updated_at', new Date(Date.now() - 30 * 864e5).toISOString())
            .limit(1);
          if (!other.error && other.data && other.data.length) {
            console.warn('[SonorPersistence] refused cross-project insert of floor ' + f.id + ' (' + (f.name || '') + ') into project ' + projectId
              + ' — it belongs to project ' + other.data[0].project_id);
            conflicts.push(f.id); crossProject.push(f.id); continue;
          }
          const insRow = floorToRow(f, projectId, seqOf(f, i), appVersion);
          if (!insRow) continue;
          insRow.version = 1;                     // fresh row starts at v1
          const { error } = await supa.from('takeoffs_floors').insert(insRow);
          if (error) {
            if (error.code === '23505') { conflicts.push(f.id); continue; }  // created by another writer
            throw error;
          }
          f.version = 1;
          count++;
        } else {
          const row = floorToRow(f, projectId, seqOf(f, i), appVersion);
          if (!row) continue;
          row.version = baseVersion + 1;          // SET the next version
          const { data, error } = await supa
            .from('takeoffs_floors')
            .update(row)
            .eq('project_id', projectId)
            .eq('floor_id', f.id)
            .eq('version', baseVersion)           // CAS predicate — only if unchanged since load
            .select('floor_id, version');
          if (error) throw error;
          if (!data || data.length === 0) { conflicts.push(f.id); continue; }  // cloud moved on
          f.version = baseVersion + 1;
          count++;
        }
      }
      if (crossProject.length && crossProject.length === conflicts.length) return { ok: false, reason: 'cross-project', conflicts, crossProject, count };
      if (conflicts.length) return { ok: false, reason: 'version-conflict', conflicts, crossProject, count };
      return { ok: true, count };
    } catch (err) {
      console.warn('[SonorPersistence] pushFloors failed:', err);
      return { ok: false, error: err };
    }
  }

  // ============================================================
  // LOCAL PERSISTENCE — localStorage + quota-bust sentinel
  // ============================================================

  /**
   * Write the envelope to localStorage. On QuotaExceededError:
   *   - set the bust sentinel
   *   - call onQuotaBust(reason, perBucketSizes) so the host can fire an
   *     immediate Supabase flush (cloud has the only complete state)
   *   - return { ok: false, quota: true } — caller knows it failed
   *
   * @param {object} envelope - { floors, activeFloorId, currentProjectId, savedAt, version, ... }
   * @param {object} [opts]
   * @param {Function} [opts.onQuotaBust] - (reason, perBucketSizes) => void
   * @returns {{ ok: boolean, bytes: number, quota?: boolean, reason?: string }}
   */
  function persistEnvelope(envelope, opts) {
    const o = opts || {};
    if (typeof localStorage === 'undefined') {
      return { ok: false, bytes: 0, reason: 'no-localStorage' };
    }
    let envCopy = envelope;

    // v1.6.0 (B-369a step 1) — the HOST's superior O(1) pre-strip, ported
    // (host _persistFloors carried two fixes the module lacked):
    //   (1) decide the strip from bg BYTE LENGTH before serialising — bg
    //       images run 4-8 MB, so the old path paid a full multi-MB
    //       JSON.stringify just to discover it must strip and stringify
    //       AGAIN (two stringifies on virtually every real-project save);
    //   (2) strip on SHALLOW floor copies — the caller's envelope/floors
    //       are NEVER mutated; only the persisted copy loses bg (bg
    //       persists in Supabase Storage `takeoffs-plans` regardless).
    let stripped = 0;
    const _stripBg = (env) => {
      const copy = Object.assign({}, env);
      copy.floors = (Array.isArray(env.floors) ? env.floors : []).map(f => {
        if (f && f.backgroundImage) {
          stripped++;
          return Object.assign({}, f, { backgroundImage: null, _bgStrippedReason: 'lsQuotaBudget' });
        }
        return f;
      });
      return copy;
    };
    const bgBytes = (envelope && Array.isArray(envelope.floors) ? envelope.floors : [])
      .reduce((s, f) => s + ((f && f.backgroundImage) ? f.backgroundImage.length : 0), 0);
    if (bgBytes >= QUOTA_PRESTRIP_BYTES / 2) envCopy = _stripBg(envelope);
    let json = JSON.stringify(envCopy);
    let bytes = json.length;
    if (bytes > QUOTA_PRESTRIP_BYTES && stripped === 0) {
      // Placement data alone over budget — strip bg as the last resort,
      // then re-serialise ONCE.
      envCopy = _stripBg(envCopy);
      json = JSON.stringify(envCopy);
      bytes = json.length;
    }
    if (stripped && typeof window !== 'undefined' && window.__SONOR_TRACE__) {
      console.log('[Sonor PERSIST] pre-stripped ' + stripped + ' bg image(s) — envelope now ' + (bytes / 1_000_000).toFixed(2) + ' MB');
    }

    try {
      localStorage.setItem(LS_KEY, json);
      // Successful write — clear any stale bust sentinel
      try { localStorage.removeItem(LS_KEY_QUOTA_BUST); } catch (_) {}
      if (typeof window !== 'undefined' && window.__SONOR_TRACE__) {
        console.log('[Sonor PERSIST PHASE 2 PERSISTED]', { bytes, key: LS_KEY });
      }
      return { ok: true, bytes };
    } catch (err) {
      const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
      if (isQuota) {
        const perBucketSizes = _perBucketSizes(envCopy);
        const sentinel = { at: Date.now(), reason: 'QuotaExceededError', perBucketSizes };
        try { localStorage.setItem(LS_KEY_QUOTA_BUST, JSON.stringify(sentinel)); } catch (_) {}
        console.error('[SonorPersistence] QUOTA exceeded — sentinel set; cloud will be authoritative on next boot. Per-bucket sizes:', perBucketSizes);
        if (typeof o.onQuotaBust === 'function') {
          try { o.onQuotaBust('quota', perBucketSizes); } catch (_) {}
        }
        return { ok: false, bytes, quota: true, reason: 'quota' };
      }
      console.warn('[SonorPersistence] persistEnvelope unknown error:', err);
      return { ok: false, bytes, reason: 'unknown', error: err };
    }
  }

  function _perBucketSizes(envelope) {
    const out = {};
    if (!envelope || !Array.isArray(envelope.floors)) return out;
    for (const f of envelope.floors) {
      if (!f) continue;
      out[f.id] = {};
      for (const k of FLOOR_BUCKETS) {
        try {
          out[f.id][k] = JSON.stringify(f[k] || []).length;
        } catch (_) { out[f.id][k] = -1; }
      }
      out[f.id].backgroundImage = f.backgroundImage ? f.backgroundImage.length : 0;
    }
    return out;
  }

  /**
   * Read the envelope from localStorage. Returns null when missing/corrupt.
   * Includes the bust sentinel so callers can branch correctly on boot.
   */
  function loadEnvelope() {
    if (typeof localStorage === 'undefined') return null;
    let parsed = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) {
      console.warn('[SonorPersistence] loadEnvelope parse failed:', e && e.message);
      return null;
    }
    if (!parsed) return null;
    let bust = null;
    try {
      const bustRaw = localStorage.getItem(LS_KEY_QUOTA_BUST);
      if (bustRaw) bust = JSON.parse(bustRaw);
    } catch (_) {}
    parsed.hasQuotaBust = !!bust;
    parsed.quotaBust = bust;
    return parsed;
  }

  // ============================================================
  // v1.5.0 (B-369c) — BOOT BACKUP STASH
  // ============================================================
  // When cloud wins boot arbitration the local envelope is overwritten.
  // Before that happens we stash it to <LS_KEY>_bootBackup so offline work
  // is RECOVERABLE (the session-open skill claimed this existed; it was
  // never built). Single slot — each cloud-win boot replaces the previous
  // stash; quota failures are non-fatal (stash is best-effort).
  function stashBootBackup(envelope, reason) {
    try {
      if (!envelope || !Array.isArray(envelope.floors) || !envelope.floors.length) return false;
      if (typeof localStorage === 'undefined') return false;
      const stash = { stashedAt: new Date().toISOString(), reason: reason || 'cloud-win', envelope };
      localStorage.setItem(LS_KEY + '_bootBackup', JSON.stringify(stash));
      return true;
    } catch (_) { return false; }
  }
  function loadBootBackup() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(LS_KEY + '_bootBackup');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  // v1.5.0 (B-369c) — LOCAL-ONLY FLOOR MERGE. A floor created offline has
  // no cloud row; cloud-win used to drop it silently. Returns the floors
  // it appended (same-project envelopes only — a stale envelope from a
  // DIFFERENT project must never leak floors across projects, the B-370
  // incident family).
  function mergeLocalOnlyFloors(cloudFloors, envelope, currentProjectId, deletedIds) {
    const appended = [];
    try {
      if (!envelope || !Array.isArray(envelope.floors)) return appended;
      if (!envelope.currentProjectId || !currentProjectId) return appended;
      if (String(envelope.currentProjectId) !== String(currentProjectId)) return appended;
      const cloudIds = new Set((cloudFloors || []).map(f => f && f.id));
      envelope.floors.forEach(lf => {
        if (lf && lf.id && !cloudIds.has(lf.id) && !(deletedIds || []).includes(lf.id)) {   // v1.7.0 — never revive a deleted floor
          cloudFloors.push(lf);
          appended.push(lf);
        }
      });
    } catch (_) {}
    return appended;
  }

  function clearQuotaBust() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(LS_KEY_QUOTA_BUST); } catch (_) {}
  }

  // ============================================================
  // CLOUD-VS-LOCAL ARBITRATION (LWW)
  // ============================================================
  //
  // The decision: on boot, who wins — local envelope or cloud rows?
  //
  // Rules:
  //   1. If quota-bust sentinel is set, cloud wins unconditionally
  //      (local cache is known-stale — local writes have been failing).
  //   2. Else if cloud is meaningfully newer than local (newest cloud
  //      updated_at > local savedAt + SKEW_TOLERANCE_MS), cloud wins.
  //   3. Else local wins, and the host should push up after boot.
  //
  // This replaces v3.0.7's "skip overlay when local fresh" logic that
  // mis-engaged when cloud had newer data (Cowork Hypothesis A).

  /**
   * @param {object} args
   * @param {object} args.local - envelope from loadEnvelope (or null)
   * @param {{ rows: array, newestCloudAt: number|null, ok: boolean }} args.cloud
   * @param {number} [args.skewMs=SKEW_TOLERANCE_MS]
   * @param {boolean} [args.hasQuotaBust]
   * @returns {{ winner: 'cloud'|'local'|'none', reason: string }}
   */
  function resolveBoot(args) {
    const a = args || {};
    const skew = (typeof a.skewMs === 'number') ? a.skewMs : SKEW_TOLERANCE_MS;
    const hasBust = !!(a.hasQuotaBust || (a.local && a.local.hasQuotaBust));
    const cloud = a.cloud || { rows: [], newestCloudAt: null, ok: false };
    const local = a.local || null;

    // 1. Quota bust: cloud is the only complete source
    if (hasBust && cloud.ok && cloud.rows.length) {
      return { winner: 'cloud', reason: 'quota-bust-sentinel' };
    }

    // 2. No local? Take whatever cloud has
    if (!local || !Array.isArray(local.floors) || !local.floors.length) {
      if (cloud.ok && cloud.rows.length) return { winner: 'cloud', reason: 'no-local' };
      return { winner: 'none', reason: 'no-data-anywhere' };
    }

    // 3. No cloud? Local wins
    if (!cloud.ok || !cloud.rows.length) {
      return { winner: 'local', reason: 'no-cloud' };
    }

    // v1.3.1 — version-primary: `version` is a monotonic per-floor write counter. If cloud carries a
    // strictly higher version than local for any shared floor, cloud has seen writes local hasn't (e.g.
    // an out-of-band or another-device write) -> cloud wins regardless of local wall-clock savedAt.
    // Stops a stale-but-recently-touched local cache shadowing newer cloud (the reload-banner loop).
    try {
      const lv = {}; (local.floors || []).forEach(f => { if (f && f.id != null) lv[f.id] = f.version || 1; });
      let cloudAhead = false;
      (cloud.rows || []).forEach(r => { const id = r && (r.id != null ? r.id : r.floor_id); if (id != null && (r.version || 1) > (lv[id] || 0)) cloudAhead = true; });
      if (cloudAhead) return { winner: 'cloud', reason: 'cloud-version-ahead' };
    } catch (_) {}

    // v1.4.1 (audit B3) — versions-equal short-circuit: when every cloud floor
    // exists locally at the SAME version, cloud holds nothing local hasn't
    // already seen (each cloud write was this client's own CAS push), so local
    // (a superset: may carry unpushed edits + local-only floors) wins
    // deterministically. Removes the wall-clock dependency for the common
    // same-device reload; cloud-ahead above covers the other direction.
    // Applies ONLY when version counters are explicitly present on BOTH sides
    // of every shared floor — legacy (pre-version) envelopes keep timestamp LWW.
    try {
      const lvEq = {};
      (local.floors || []).forEach(f => { if (f && f.id != null && Number.isFinite(f.version)) lvEq[f.id] = f.version; });
      const rowsEq = cloud.rows || [];
      if (rowsEq.length) {
        let allEqual = true;
        rowsEq.forEach(r => {
          const id = r && (r.id != null ? r.id : r.floor_id);
          if (id == null || !Number.isFinite(r && r.version) || lvEq[id] == null || r.version !== lvEq[id]) allEqual = false;
        });
        if (allEqual) return { winner: 'local', reason: 'versions-equal' };
      }
    } catch (_) {}

    // 4. Both present — LWW by timestamp + tolerance
    const localTs = local.savedAt ? new Date(local.savedAt).getTime() : 0;
    const cloudTs = cloud.newestCloudAt || 0;

    if (cloudTs > localTs + skew) {
      return { winner: 'cloud', reason: 'cloud-newer-by-' + ((cloudTs - localTs) / 1000).toFixed(1) + 's' };
    }
    return { winner: 'local', reason: 'local-newer-or-equal' };
  }

  // ============================================================
  // BOOT ORCHESTRATION — single entry point
  // ============================================================
  //
  // Replaces the dual `loadState() + _switchToProject({safeBootOverlay:true})`
  // race. ONE place to look for boot logic.
  //
  // Flow:
  //   1. initFloors (host-supplied) — populate floors[] from local envelope
  //      or seed a fresh "Ground Floor".
  //   2. If a project is linked, pull cloud and resolve LWW.
  //   3. If cloud wins, replace floors[] from cloud rows + apply.
  //   4. If local wins, just apply the active floor.
  //   5. Run host.afterBoot() once.

  /**
   * @param {object} opts
   * @param {object} opts.canvas - fabric.Canvas
   * @param {object} [opts.supa] - supabase-js client (optional)
   * @param {string} [opts.currentProjectId]
   * @param {object} opts.host - host adapter; see fields below
   * @param {Function} opts.host.initFloors - ({envelope}) => { floors, activeFloorId }
   * @param {Function} opts.host.setFloors - (floors, activeFloorId) => void
   * @param {Function} opts.host.activeFloor - () => floor | null
   * @param {Function} [opts.host.localBgByFloorId] - () => { [floorId]: bgUrl }
   * @param {Function} [opts.host.afterBoot] - ({ winner, reason, kindStats }) => void
   * @param {object} [opts.applyCtx] - context passed through to applyFloor
   * @returns {Promise<{ winner: string, reason: string, ok: boolean, kindStats: object }>}
   */
  async function bootRestore(opts) {
    const o = opts || {};
    const host = o.host || {};
    const canvas = o.canvas;
    if (!canvas) {
      console.error('[SonorPersistence] bootRestore: canvas required');
      return { winner: 'none', reason: 'no-canvas', ok: false, kindStats: {} };
    }

    // 1. Local envelope -> floors[]
    const envelope = loadEnvelope();
    let bootInfo = null;
    if (typeof host.initFloors === 'function') {
      bootInfo = host.initFloors({ envelope });
    } else {
      console.warn('[SonorPersistence] bootRestore: host.initFloors required');
    }

    // 2. Cloud (when wired)
    let cloudResult = { rows: [], ok: false, newestCloudAt: null };
    if (o.supa && o.currentProjectId) {
      const localBgMap = (typeof host.localBgByFloorId === 'function')
        ? (host.localBgByFloorId() || {})
        : {};
      cloudResult = await pullFloors(o.supa, o.currentProjectId, localBgMap);
    }

    // 3. Resolve LWW
    const decision = resolveBoot({
      local: envelope,
      cloud: cloudResult,
      hasQuotaBust: !!(envelope && envelope.hasQuotaBust),
    });

    if (typeof window !== 'undefined' && window.__SONOR_TRACE__) {
      console.log('[Sonor PERSIST PHASE 0 BOOT]', {
        envelope: envelope ? { floorCount: (envelope.floors || []).length, savedAt: envelope.savedAt, hasQuotaBust: envelope.hasQuotaBust } : null,
        cloud: { ok: cloudResult.ok, rowCount: cloudResult.rows.length, newestCloudAt: cloudResult.newestCloudAt ? new Date(cloudResult.newestCloudAt).toISOString() : null },
        decision,
      });
    }

    // 4. Apply the winner
    let kindStats = {};
    if (decision.winner === 'cloud') {
      // Cloud wins — replace floors[]
      const cloudFloors = cloudResult.rows;
      // v1.5.0 (B-369c) — stash the losing local envelope + merge floors
      // that exist ONLY locally (offline-created) into the winner list so
      // the next pushFloors INSERTs them instead of dropping the work.
      stashBootBackup(envelope, decision.reason);
      const _merged = mergeLocalOnlyFloors(cloudFloors, envelope, o.currentProjectId);
      if (_merged.length) {
        console.warn('[SonorPersistence v1.5.0 B-369c] merged ' + _merged.length
          + ' local-only floor(s) into the cloud-win list: '
          + _merged.map(f => f.name || f.id).join(', '));
      }
      const activeId = (cloudFloors[0] && cloudFloors[0].id) || null;
      if (typeof host.setFloors === 'function') {
        host.setFloors(cloudFloors, activeId);
      }
      // Clear bust sentinel — cloud overlay is the recovery
      clearQuotaBust();
      // Persist the new envelope so subsequent saves stay in sync
      try {
        const env = {
          version: 2,
          floors: cloudFloors,
          activeFloorId: activeId,
          currentProjectId: o.currentProjectId,
          savedAt: new Date().toISOString(),
        };
        persistEnvelope(env);
      } catch (_) {}
    }

    const active = (typeof host.activeFloor === 'function') ? host.activeFloor() : null;
    if (active) {
      const result = await applyFloor(canvas, active, o.applyCtx);
      kindStats = result.kindStats;
    }

    if (typeof host.afterBoot === 'function') {
      try { host.afterBoot({ winner: decision.winner, reason: decision.reason, kindStats }); }
      catch (e) { console.warn('[SonorPersistence] afterBoot threw:', e && e.message); }
    }

    return { winner: decision.winner, reason: decision.reason, ok: true, kindStats };
  }

  // ============================================================
  // HISTORY — undo/redo serialise/apply
  // ============================================================
  //
  // History is canvas-state-shaped, not floor-shaped. We capture a
  // pseudo-floor (every bucket present, plus scale/roomCounter/etc) and
  // round-trip it through JSON. applyHistory clears non-plan canvas
  // objects, restores the buckets via the kind registry.

  /**
   * Serialise the current canvas + globals into a history snapshot.
   * @param {object} canvas
   * @param {object} ctx - { scalePxPerM, roomCounter, activeCableId, activeLedId }
   * @returns {string} JSON
   */
  function serialiseHistory(canvas, ctx) {
    const c = ctx || {};
    const buckets = {};
    for (const k of FLOOR_BUCKETS) buckets[k] = [];
    const objs = (canvas && canvas.getObjects) ? canvas.getObjects() : [];
    for (const o of objs) {
      if (!o) continue;
      if (isEphemeral(o)) continue;
      for (const kind of listKinds()) {
        const tagOk = kind.tag ? !!o[kind.tag] : true;
        if (!tagOk) continue;
        if (kind.filter && !kind.filter(o)) continue;
        try {
          const rec = kind.capture(o);
          if (rec) buckets[kind.name].push(rec);
        } catch (_) {}
        break;
      }
    }
    return JSON.stringify(Object.assign({
      scalePxPerM:   c.scalePxPerM ?? null,
      roomCounter:   c.roomCounter ?? 0,
      activeCableId: c.activeCableId || 'cat6d',
      activeLedId:   c.activeLedId   || 'strip-w',
    }, buckets));
  }

  /**
   * Apply a history snapshot. Caller is responsible for setting
   * ctx._restoring=true outside this call (the wrapper handles it).
   */
  function applyHistory(canvas, json, ctx) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    const c = ctx || {};
    if (typeof c.setRestoring === 'function') c.setRestoring(true);
    try {
      // Strip the overlay, preserve the PDF plan underlay
      if (canvas && canvas.getObjects) {
        canvas.getObjects().slice().forEach(o => {
          if (!o.sonorPlan) canvas.remove(o);
        });
      }
      // Apply scalars via host hook
      if (typeof c.setScalars === 'function') c.setScalars({
        scalePxPerM:   s.scalePxPerM ?? null,
        roomCounter:   s.roomCounter ?? 0,
        activeCableId: s.activeCableId,
        activeLedId:   s.activeLedId,
      });
      // Iterate registry to restore each bucket
      for (const k of FLOOR_BUCKETS) {
        const list = s[k] || [];
        if (!list.length) continue;
        const kind = getKind(k);
        if (!kind || typeof kind.restore !== 'function') continue;
        for (let i = 0; i < list.length; i++) {
          try { kind.restore(list[i], c); }
          catch (e) { console.warn('[SonorPersistence] history restore fail ' + k + '[' + i + ']:', e && e.message); }
        }
      }
      if (canvas && typeof canvas.renderAll === 'function') canvas.renderAll();
      if (typeof c.recalc === 'function') {
        try { c.recalc(); } catch (_) {}
      }
    } finally {
      if (typeof c.setRestoring === 'function') c.setRestoring(false);
    }
  }

  // ============================================================
  // DEV-MODE ROUND-TRIP ASSERT
  // ============================================================
  //
  // When window.__SONOR_DEV__ is true, every save runs the round-trip and
  // console.assert()s identity per bucket. Catches FLOOR_BUCKETS regressions
  // (a future bucket added to capture but not toRow, or vice versa) at dev
  // time, before they reach Supabase.

  function assertRoundTrip(floor) {
    if (typeof window === 'undefined' || !window.__SONOR_DEV__) return;
    if (!floor) return;
    try {
      const row = floorToRow(floor, 'dev-assert', 0, 'dev');
      const round = rowToFloor(row);
      for (const k of FLOOR_BUCKETS) {
        const before = JSON.stringify(floor[k] || []);
        const after = JSON.stringify(round[k] || []);
        if (before !== after) {
          console.error('[SonorPersistence DEV] round-trip lost bucket "' + k + '" — before length ' + before.length + ', after length ' + after.length);
          console.assert(false, 'FLOOR_BUCKETS regression on ' + k);
        }
      }
    } catch (e) {
      console.warn('[SonorPersistence DEV] assertRoundTrip threw:', e && e.message);
    }
  }

  // ============================================================
  // DIAGNOSTICS
  // ============================================================

  function setTrace(on) {
    if (typeof window === 'undefined') return;
    window.__SONOR_TRACE__ = !!on;
  }
  function setDevAssert(on) {
    if (typeof window === 'undefined') return;
    window.__SONOR_DEV__ = !!on;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    __version,
    FLOOR_BUCKETS,
    LS_KEY,
    LS_KEY_QUOTA_BUST,
    QUOTA_PRESTRIP_BYTES,
    SAVE_DEBOUNCE_MS,
    SKEW_TOLERANCE_MS,

    // registry
    registerKind,
    getKind,
    listKinds,

    // ephemeral
    isEphemeral,
    setEphemeralFilter,

    // floor lifecycle
    emptyFloor,
    makeFloorId,
    deriveFloorCode,

    // canvas <-> floor
    captureFloor,
    applyFloor,

    // cloud
    floorToRow,
    rowToFloor,
    pullFloors,
    deleteFloorCloud,
    pushFloors,

    // local
    persistEnvelope,
    loadEnvelope,
    clearQuotaBust,

    // arbitration + boot
    resolveBoot,
    bootRestore,
    stashBootBackup,      // v1.5.0 (B-369c)
    loadBootBackup,       // v1.5.0 (B-369c)
    mergeLocalOnlyFloors, // v1.5.0 (B-369c)

    // history
    serialiseHistory,
    applyHistory,

    // diagnostics
    assertRoundTrip,
    setTrace,
    setDevAssert,
  };
});
