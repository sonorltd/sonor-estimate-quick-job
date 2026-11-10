// sonor-library.js — CANONICAL MASTER (Spine v1.2 §15)
//
// ════════════════════════════════════════════════════════════════════════
// CONSUMER API CONTRACT — APP - Library/CONSUMER-API.md
// Read that file BEFORE writing any consumer integration. It documents
// every method, return shape, schema model, and rename-resolution rules.
// Updates to this file MUST also update CONSUMER-API.md in the same
// commit (single source of truth for cross-app integration).
// ════════════════════════════════════════════════════════════════════════
//
// Shared Sonor library data layer — fetches v_sonor_library from Supabase,
// caches to localStorage, falls back through 4 tiers, exposes a small API
// every consumer app uses identically (Takeoffs, Packs, Project Master,
// Network Map, Cinema Design, Portal).
//
// Source of truth: Supabase table `sonor_blocks` (152 rows), exposed as
// view `v_sonor_library` LEFT-JOIN device_catalogue + wq_product_skus.
// Writes go back to sonor_blocks. RLS allows anon SELECT/INSERT/UPDATE,
// never DELETE (enforced server-side per CLAUDE.md DB protection rules).
//
// Propagated to `APP - */data/sonor-library.js` by sync-everything.sh (S-4.2).
// NEVER hand-edit the per-app copies — edit this master and re-run the sync.
//
// Namespace: window.SonorLibrary
//
// Usage:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="data/sonor-library.js"></script>
//   <script>
//     SonorLibrary.init({ inlineSeed: [...] });          // optional
//     const { tier, library, symbols } = await SonorLibrary.load();
//     const sym = SonorLibrary.rowToSymbol(library[0]);
//     await SonorLibrary.save([{ block_code: 'CL-...', label: 'New name' }]);
//   </script>
//
// Exports:
//   init(opts)           — { supabaseClient?, supabaseUrl?, anonKey?, lsKey?, inlineSeed?, services? }
//   load()               — Promise<{ tier, rows, library, symbols }>
//   save(patches)        — Promise<{ ok, fail, errors[] }> — patches: [{ block_code, ...fields }]
//   insert(rows)         — Promise<{ ok, fail, errors[] }>
//   getLibrary()         — current cached LIBRARY (active rows only)
//   getAllRows()         — current cached rows (incl. discontinued)
//   getSymbols()         — current cached SYMBOLS (palette projection)
//   rowToSymbol(row)     — derive { block_code, code, service, label, glyph } from row
//   isBlank(v)           — null/empty helper used by overwrite guards
//   subscribe(fn)        — register a change handler; called after every successful load/save
//   unsubscribe(fn)      — remove a handler
//   getSupabaseClient()  — returns the underlying Supabase client (for ad-hoc queries)
//   getCableDrawables    — cable categories + packages as drawing-tool entries (Takeoffs palette)
//
// v2.0.0 (Library v1.12.0 R74-R77) — Tier 1 consumer-readiness surface:
//   expandPackage(pkgId) — Promise<MaterialsList[]> — flat materials for a package
//   getCables(opts)      — Promise<row[]> — pm_cable_types (opts.topCategory filter)
//   getConnectors(opts)  — Promise<row[]> — pm_cable_types where top_category='connector'
//   getAccessories(opts) — Promise<row[]> — pm_cable_types where top_category='accessory'
//   getFaceplates(opts)  — Promise<row[]> — pm_faceplate_types
//   getBackboxes(opts)   — Promise<row[]> — pm_backbox_types
//   getLightingControl(opts) — Promise<row[]> — pm_lighting_control_types (v2.4.0)
//   getPortsMeta(kind, id)         — Promise<{ports:[], _needs_review}> — read metadata.ports
//   savePortsMeta(kind, id, ports) — Promise<void> — write metadata.ports (merge, preserve siblings)
//   markVerified(kind, id)         — Promise<void> — strip metadata._needs_review (v2.5.0)
//   getSchematicMeta(blockCode)    — Promise<row>  — v_library_schematic (engine-neutral) (v2.5.0)
//   getPortKindStyles()            — Promise<row[]> — pm_port_kind_styles (Library SSOT, v3.1.0)
//   getConnectionPatterns(opts)    — Promise<row[]> — sonor_connection_patterns Phase 2 (v2.6.0)
//   validateConnection(conn)       — Promise<{matches_pattern,suggested_cable,pattern,warnings}> (v2.6.0)
//   savePattern(pattern)           — Promise<row> — upsert via unique constraint (v2.7.0)
//   deletePattern(idOrIdentity)    — Promise<void> — soft-delete via active=false (v2.7.0)
//   getPackages(opts)    — Promise<row[]> — v_cable_packages
//   getDevices(opts)     — Promise<row[]> — device_catalogue (rack gear)
//   getMisc(opts)        — Promise<row[]> — misc_catalogue (non-rack)
//   resolveId(kind, id)  — Promise<string> — walks sonor_catalogue_aliases
//   getFull(opts)        — Promise<row[]> — v_sonor_library_full (UNIONed kinds)
//   validateIds(refs)    — Promise<Array<{kind,id,ok,current_id,alias_hit}>>
//                          batch FK-check with alias-walking — v1.12.3 R80
//   subscribe(kind, fn)  — realtime channel per catalogue table — v1.12.2 R79
//   exportSnapshot(opts) — Promise<{generated_at, library_version, kinds: {block: [...], ...}}>
//                          bundled point-in-time dump — v1.12.4 R81
//   describeKind(kind)   — Promise<{kind, table, columns: [{name,type,nullable,default,ordinal}]}>
//                          schema introspection — v1.12.5 R82

// v3.1.0 — SL.expandPackage now emits per-line connector entries alongside
// each cable line when head_connector_id / device_connector_id are set on
// cable_package_lines (Library v1.35.0 FK columns). Each connector entry
// carries metadata._from_line=true so consumers can distinguish per-line
// connectors from the bulked end-group entries (metadata.device_end /
// head_end) that still appear for backwards compatibility. Precedence rule
// for consumers: per-line > bulked arrays > heuristic. The cable entry
// metadata now carries head_connector_id + device_connector_id back-refs.
// Also fixes a latent bug where expandPackage read ln.qty (undefined on a
// direct cable_package_lines fetch — the qty alias only exists in the view);
// now reads ln.quantity with ln.qty as a graceful fallback.
// v3.0.3 — Added SL.getShades() (shades_catalogue accessor). Library has
// a dedicated Shades tab with Roller / Roman / Venetian / Curtain Track /
// Velux / Roof Blind variants — Takeoffs Shade picker reads via this
// accessor. Additive.
// v3.0.2 — Added SL.getLedStrips() (pm_led_strip_types accessor). Library
// has a dedicated LED Strips tab with COB / Pixel / Neon / RGBW / etc.
// variants — consumer apps (Takeoffs LED Run palette) now read it via
// this accessor instead of guessing from sonor_blocks. Additive.
// v3.0.1 — _setRows() normalises v_sonor_library projection back to CONSUMER-API §5
// (metadata.default_cable_package / default_cable_run_m). Restores the cable-schedule
// seam for every consumer (Takeoffs, Cinema Takeoff, Packs, PM). HARMONY no-fork.
// v3.2.2 — SL.resequenceSubgroups(service_nn): renumber a service's sub-groups
// so service_sub follows display order (member blocks moved in lockstep by the
// resequence_subgroups Postgres function). Used by the Library Sub-group
// Manager so reordering renumbers 1..N.
// v3.2.1 — SL.save now keeps the view-promoted mirror columns
// (default_cable_package / default_cable_run_m) + block_metadata alias in sync
// with the merged metadata after a write. Fixes the "cable package won't clear
// to none" in-session revert (DB was correct; local cache re-promoted the old
// top-level value via _setRows).
// v3.2.0 — (1) short_code + short_description added to SAFE_COLUMNS so they
// persist on save/insert (fixes Library Edit-panel short_code not saving +
// Add-panel NOT NULL failures). (2) Sub-group management API: getSubgroups /
// createSubgroup / renameSubgroup / reorderSubgroups, backed by new table
// sonor_block_subgroups. See CONSUMER-API.md §Subgroups.
// v3.9.0 — LABOUR seam (Library v2.11.0, 2026-09-27; Bryn: "build labour elements in to the library so we can
//   use in future … wherever we use we can toggle labour displays on and off"): getSetting(key) / setSetting(key,
//   value) on library_settings ('show_labour' = the GLOBAL display toggle), getLabourTypes(), and labourFor(row)
//   → { phases, block_mins, by } from sonor_blocks.metadata.labour (minutes only; rates/prices stay in WeQuote).
// v3.8.0 — AV device seam for consumers (CONSUMER-API §26): getAvCatalogue
// (the §0 canonical deduped product view, cached), getDeviceAliases /
// resolveDeviceId (§25 device clone-merge renames), deviceMatchesBlock (the
// §22.2+§22.4 category∩role∩domain match rule — the ONE predicate every
// consumer must share), getDeviceOptionsForBlock (§22 render source:
// device_options[] else candidate sweep, default implicit member),
// getAllProductAccessories / getProductAccessories (§20 parent-linked
// accessory options). First consumer: Takeoffs v5.174.0 device dropdowns +
// Device Schedule.
window.SONOR_LIBRARY_VERSION = '3.10.0';
window.SonorLibrary = window.SonorLibrary || {};

(function (SL) {
  'use strict';

  // ── Defaults ──────────────────────────────────────────────────────────────
  const DEFAULT_URL  = 'https://ysmvklstkzodlocttspy.supabase.co';
  const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbXZrbHN0a3pvZGxvY3R0c3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc0OTMsImV4cCI6MjA4OTM0MzQ5M30.08kRS_dtbwz0rSYezNGMJHnOU_st8GKZseQPefcMEMc';
  const DEFAULT_LS_KEY = 'sonor-library-cache-v1';

  // Service taxonomy mirrors brand-core.xml positional order.
  const DEFAULT_SERVICES = [
    { nn: '01', key: 'cinema',     name: 'Cinema & Media',   colour: '#8058a1' },
    { nn: '02', key: 'audio',      name: 'Multiroom Audio',  colour: '#4bb9d3' },
    { nn: '03', key: 'video',      name: 'TV & Video',       colour: '#78ba57' },
    { nn: '04', key: 'lighting',   name: 'Smart Lighting',   colour: '#f5d05c' },
    { nn: '05', key: 'automation', name: 'Home Automation',  colour: '#e37c59' },
    { nn: '06', key: 'climate',    name: 'Climate',          colour: '#ec6061' },
    { nn: '07', key: 'control',    name: 'Control',          colour: '#e67eb1' },
    { nn: '08', key: 'security',   name: 'CCTV & Security',  colour: '#ad9978' },
    { nn: '09', key: 'network',    name: 'WiFi & Data',      colour: '#b7b1a7' },
    { nn: '10', key: 'infra',      name: 'Infrastructure',   colour: '#302f2e' }
  ];

  // Last-resort minimal palette — keeps the app usable if every other tier fails.
  const DEFAULT_INLINE_SEED = [
    { block_code: 'SEED-01-SP-L',  service_key: 'cinema',     service_nn: '01', label: 'LCR Speaker',     glyph: 'L' },
    { block_code: 'SEED-01-SUB',   service_key: 'cinema',     service_nn: '01', label: 'Subwoofer',       glyph: '⬤' },
    { block_code: 'SEED-02-CLG',   service_key: 'audio',      service_nn: '02', label: 'Ceiling Speaker', glyph: '○' },
    { block_code: 'SEED-03-TV',    service_key: 'video',      service_nn: '03', label: 'TV',              glyph: 'T' },
    { block_code: 'SEED-04-DL',    service_key: 'lighting',   service_nn: '04', label: 'Downlight',       glyph: '◌' },
    { block_code: 'SEED-05-HUB',   service_key: 'automation', service_nn: '05', label: 'Processor / Hub', glyph: 'H' },
    { block_code: 'SEED-06-STAT',  service_key: 'climate',    service_nn: '06', label: 'Thermostat',      glyph: '°' },
    { block_code: 'SEED-07-TP',    service_key: 'control',    service_nn: '07', label: 'Touch Panel',     glyph: '▢' },
    { block_code: 'SEED-08-CAM',   service_key: 'security',   service_nn: '08', label: 'Camera',          glyph: '◎' },
    { block_code: 'SEED-09-WAP',   service_key: 'network',    service_nn: '09', label: 'WAP',             glyph: '⌬' },
    { block_code: 'SEED-10-RACK',  service_key: 'infra',      service_nn: '10', label: 'Rack Location',   glyph: 'R' }
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    client: null,
    lsKey: DEFAULT_LS_KEY,
    inlineSeed: DEFAULT_INLINE_SEED,
    services: DEFAULT_SERVICES,
    allRows: [],            // every row from last successful fetch (incl. discontinued)
    library: [],            // active rows only (enabled !== false && !discontinued)
    symbols: [],            // placement-palette projection
    lastTier: null,
    lastFetchedAt: null,
    handlers: new Set()
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  SL.init = function (opts) {
    opts = opts || {};
    if (opts.supabaseClient) {
      state.client = opts.supabaseClient;
    } else {
      const url  = opts.supabaseUrl || DEFAULT_URL;
      const anon = opts.anonKey     || DEFAULT_ANON;
      try {
        if (window.supabase && window.supabase.createClient) {
          state.client = window.supabase.createClient(url, anon);
        }
      } catch (e) {
        console.warn('[SonorLibrary] Supabase client init failed:', e);
      }
    }
    if (opts.lsKey)      state.lsKey      = opts.lsKey;
    if (opts.inlineSeed) state.inlineSeed = opts.inlineSeed;
    if (opts.services)   state.services   = opts.services;
    return SL;
  };

  // Lazy auto-init for callers that just call load() without init().
  function _ensureInit() {
    if (state.client === null) SL.init();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  SL.isBlank = function (v) {
    return v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  };

  // v1.1.0 (2026-04-22) — carry service_sub / sub_name / shape / sizeable /
  // sort_order through to consumers. Previously stripped these fields, which
  // meant palettes bucketed every block under "OTHER" (Takeoffs regression
  // spotted when Cinema's 26 blocks all collapsed into "01 · OTHER" despite
  // the Edit table correctly showing 01.3 · Audio / 01.4 · Acoustics sections).
  // Consumers that just want block_code/code/service/label/glyph keep working
  // — additional fields are optional tails on the returned shape.
  SL.rowToSymbol = function (row) {
    const block_code = row.block_code || row.code;
    const tail = (block_code || '').split('-').slice(-2).join('-') || block_code;
    return {
      block_code,
      code: tail,
      service: row.service_key || row.service,
      service_nn: row.service_nn || '',
      service_sub: row.service_sub || '',
      sub_name:    row.sub_name    || '',
      label: row.label || tail || block_code,
      glyph: row.glyph || '●',
      shape:    row.shape    || null,
      sizeable: !!row.sizeable,
      sort_order: row.sort_order != null ? Number(row.sort_order) : null
    };
  };

  function _fire(eventName, payload) {
    state.handlers.forEach(h => {
      try { h({ event: eventName, ...payload }); }
      catch (e) { console.warn('[SonorLibrary] handler error:', e); }
    });
  }

  function _setRows(rows, tier) {
    // v2.1.0 — CONSUMER-API.md §5 contract normalisation.
    // The Supabase view `v_sonor_library` renames the JSONB column
    // `sonor_blocks.metadata` to `block_metadata` and promotes
    // `default_cable_package` + `default_cable_run_m` to top-level
    // columns. CONSUMER-API.md §5 guarantees every consumer reads at
    // `row.metadata.default_cable_package` / `.default_cable_run_m`.
    // Without this normalisation, every consumer (Takeoffs cable
    // schedule, Cinema Takeoff palette wiring, Packs procurement,
    // PM cable totals) silently reads `undefined` after a Supabase
    // load tier. The four tiers project different shapes:
    //   - tier 1 (supabase): view → block_metadata + flat columns
    //   - tier 2 (snapshot): generator emits whatever it captured
    //   - tier 3 (localStorage): cached tier-1 shape
    //   - tier 4 (inline-seed): hand-written, may or may not have metadata
    // We normalise here so every consumer sees the same shape regardless
    // of which tier hydrated the rows. HARMONY no-fork: one patch fixes
    // every downstream reader.
    rows.forEach(r => {
      if (!r || typeof r !== 'object') return;
      // 1. Restore `metadata` from `block_metadata` if the view renamed it.
      if (r.metadata == null && r.block_metadata != null) {
        r.metadata = r.block_metadata;
      }
      if (r.metadata == null) r.metadata = {};
      // 2. Promote view-flattened columns back into metadata for the
      //    CONSUMER-API.md §5 path. Only when metadata doesn't already
      //    carry the key (snapshot/inline seed may already have it).
      if (r.default_cable_package != null && r.metadata.default_cable_package == null) {
        r.metadata.default_cable_package = r.default_cable_package;
      }
      if (r.default_cable_run_m != null && r.metadata.default_cable_run_m == null) {
        r.metadata.default_cable_run_m = r.default_cable_run_m;
      }
    });
    state.allRows = rows.slice();
    state.library = rows.filter(r => r.enabled !== false && !r.discontinued);
    state.symbols = state.library.map(SL.rowToSymbol);
    state.lastTier = tier;
    state.lastFetchedAt = new Date().toISOString();
  }

  // ── Load (4-tier fallback) ────────────────────────────────────────────────
  SL.load = async function () {
    _ensureInit();
    let rows = null;
    let tier = 'inline';

    // Tier 1 — Supabase v_sonor_library
    if (state.client) {
      try {
        const res = await state.client
          .from('v_sonor_library')
          .select('*')
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('block_code', { ascending: true });
        if (res.error) throw res.error;
        if (Array.isArray(res.data) && res.data.length > 0) {
          rows = res.data;
          tier = 'supabase';
          try {
            localStorage.setItem(state.lsKey, JSON.stringify({
              fetched_at: new Date().toISOString(),
              rows
            }));
          } catch (e) { /* quota — silent */ }
        }
      } catch (e) {
        console.warn('[SonorLibrary] Supabase fetch failed, trying fallbacks:', e.message || e);
      }
    }

    // Tier 2 — generated JS snapshot (if a host preloads window.__SONOR_LIBRARY_SEED__)
    if (!rows && window.__SONOR_LIBRARY_SEED__) {
      try {
        rows = window.__SONOR_LIBRARY_SEED__.rows || window.__SONOR_LIBRARY_SEED__;
        tier = 'snapshot';
      } catch (e) {}
    }

    // Tier 3 — localStorage cache (last good Supabase fetch)
    if (!rows) {
      try {
        const raw = localStorage.getItem(state.lsKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.rows) && parsed.rows.length) {
            rows = parsed.rows;
            tier = 'localStorage (' + (parsed.fetched_at || 'unknown') + ')';
          }
        }
      } catch (e) {}
    }

    // Tier 4 — inline seed
    if (!rows) {
      rows = state.inlineSeed.map(s => ({
        ...s,
        sizeable: false, enabled: true, discontinued: false
      }));
      tier = 'inline-seed';
    }

    _setRows(rows, tier);
    _fire('load', { tier, count: rows.length });
    console.log(`[SonorLibrary] tier=${tier} rows=${rows.length} active=${state.library.length}`);
    return { tier, rows, library: state.library, symbols: state.symbols };
  };

  // ── Save (patches → sonor_blocks UPDATE) ──────────────────────────────────
  // Only writes whitelisted columns; view-only joined fields (device_*, wq_*
  // joined columns) are silently stripped.
  // v3.2.0 — short_code + short_description added to the whitelist. They were
  // absent, so SL.save()/SL.insert() silently stripped them: Edit-panel
  // short_code changes never persisted, and Add-panel inserts violated the
  // NOT NULL short_code constraint server-side. Restoring them here fixes the
  // Add, Edit, and CSV-import paths in one shared edit (HARMONY no-fork).
  const SAFE_COLUMNS = ['service_key','service_nn','service_sub','sub_name','label','glyph','shape','sizeable',
                        'short_code','short_description',
                        'default_width_mm','default_height_mm','device_model_id','wq_sku',
                        'enabled','discontinued','sort_order'];

  // ── Metadata write API (v1.2.0 — opt-in, B-211) ──
  // Two mutually-exclusive opt-in keys for writing the metadata JSONB column
  // (which is otherwise stripped by SAFE_COLUMNS, preserving server-side state):
  //
  //   patch.metadata           — SHALLOW MERGE patch object into the row's
  //                              existing metadata. Top-level keys present in
  //                              the patch overwrite same-named existing keys.
  //                              Explicit null deletes the matching top-level
  //                              key. Missing keys are preserved untouched.
  //                              Autosave-safe: the 1.4s debounce can fire on
  //                              any partial change without risk of wiping
  //                              sibling keys (default_cable_package edits
  //                              do not touch draw_color, etc).
  //
  //   patch.metadata_replace   — REPLACE the entire metadata JSONB blob with
  //                              this exact object. Caller takes full
  //                              responsibility for preserving anything they
  //                              still want kept. Use only for rare full-blob
  //                              overwrites or "clear all metadata".
  //
  // Patches that include neither key behave exactly as v1.1.x (metadata
  // untouched server-side). Mixing both keys in one patch is rejected.
  function _mergeMetadata(existing, patch) {
    const merged = (existing && typeof existing === 'object') ? { ...existing } : {};
    Object.keys(patch || {}).forEach(k => {
      if (patch[k] === null) { delete merged[k]; }
      else { merged[k] = patch[k]; }
    });
    return merged;
  }

  SL.save = async function (patches) {
    _ensureInit();
    if (!state.client) return { ok: 0, fail: patches.length, errors: ['offline'] };
    let ok = 0, fail = 0; const errors = [];
    for (const p of patches) {
      const bc = p.block_code;
      if (!bc) { fail++; errors.push({ row: p, error: 'missing block_code' }); continue; }

      // Reject ambiguous metadata intent — mixing merge + replace in one patch
      // would create a "which wins?" race that depends on object key order.
      if (Object.prototype.hasOwnProperty.call(p, 'metadata') &&
          Object.prototype.hasOwnProperty.call(p, 'metadata_replace')) {
        fail++;
        errors.push({ row: p, error: 'metadata + metadata_replace are mutually exclusive' });
        continue;
      }

      const safe = {};
      Object.keys(p).forEach(k => { if (SAFE_COLUMNS.includes(k)) safe[k] = p[k]; });

      // Opt-in metadata writes
      const cached = state.allRows.find(r => r.block_code === bc);
      let mergedMetadata; // undefined unless metadata write requested
      if (Object.prototype.hasOwnProperty.call(p, 'metadata_replace')) {
        // Full replace — null is permitted (clears column to JSON null)
        mergedMetadata = (p.metadata_replace == null) ? null : p.metadata_replace;
        safe.metadata = mergedMetadata;
      } else if (Object.prototype.hasOwnProperty.call(p, 'metadata')) {
        // Shallow merge — null at top level deletes that key
        if (p.metadata == null) {
          // Caller passed metadata: null on the merge path → treat as no-op
          // rather than silent destructive replace; if the intent is "clear
          // everything", use metadata_replace: null explicitly.
          // (Skip metadata write entirely.)
        } else {
          // v1.13.5 R89 — the Library app loads rows from v_sonor_library
          // which renames metadata → block_metadata + extracts a handful
          // of top-level columns. Falling back to cached.block_metadata
          // means the merge base is correct regardless of loader tier
          // (Supabase view, JS snapshot, localStorage, inline seed).
          // Without the fallback, the merge starts from {} → save
          // overwrites the entire metadata blob, wiping existing
          // cable_style / package_style / members / etc.
          const cachedMeta = (cached && (cached.metadata || cached.block_metadata)) || {};
          mergedMetadata = _mergeMetadata(cachedMeta, p.metadata);
          safe.metadata = mergedMetadata;
        }
      }

      if (!Object.keys(safe).length) continue;
      try {
        // v0.23.19 / Library v1.x.x — request `.select()` so Postgres
        // returns the rows actually affected. Previously `.update().eq()`
        // with NO matching row returned `{error: null, data: undefined}`,
        // looking exactly like a successful update. Engineering's
        // pushToLibrary then showed a green "Pushed" toast even though
        // zero rows were written. Caller now sees a real
        // "block_code not in library" error and can offer to insert.
        const res = await state.client.from('sonor_blocks')
          .update(safe).eq('block_code', bc).select('block_code');
        if (res.error) throw res.error;
        const affected = Array.isArray(res.data) ? res.data.length : 0;
        if (affected === 0) {
          throw new Error(`block_code "${bc}" not found in sonor_blocks — insert it first`);
        }
        // Update local cache in-place — metadata column kept consistent so the
        // next debounced save merges from a correct base.
        if (cached) Object.assign(cached, safe);
        // v3.2.1 — when a metadata write happened, keep the view-PROMOTED
        // mirror columns (default_cable_package / default_cable_run_m) and the
        // block_metadata alias in lock-step with the freshly-merged metadata.
        // Without this, clearing one of those fields to "none" reverted
        // in-session: the cached row still held the OLD top-level value and
        // _setRows()'s re-promotion (§ "Promote view-flattened columns") copied
        // it straight back into metadata on the next render — so the Edit panel
        // re-showed the old package even though the DB row was already cleared.
        if (cached && Object.prototype.hasOwnProperty.call(safe, 'metadata')) {
          const mm = cached.metadata || {};
          if ('block_metadata' in cached) cached.block_metadata = mm;
          cached.default_cable_package = (mm.default_cable_package != null) ? mm.default_cable_package : null;
          cached.default_cable_run_m   = (mm.default_cable_run_m   != null) ? mm.default_cable_run_m   : null;
        }
        ok++;
      } catch (e) {
        console.warn('[SonorLibrary] save failed for', bc, e.message || e);
        errors.push({ row: p, error: e.message || String(e) });
        fail++;
      }
    }
    // v1.13.8 R92 — strip any prior '+local' suffix before re-appending so
    // the tier string doesn't grow with every autosave. Was emitting
    // "supabase+local+local+local+..." after a few debounced saves.
    const baseTier = (state.lastTier || 'unknown').replace(/(\+local)+$/, '');
    _setRows(state.allRows, baseTier + '+local');
    _persistCache();
    _fire('save', { ok, fail });
    return { ok, fail, errors };
  };

  // ── Save device-catalogue patches (v0.23.24) ────────────────────────────
  //
  // Engineering's "Push to library" for AV devices (Triad amps, AVPs,
  // switches, projectors, etc.) MUST target `device_catalogue` keyed by
  // `model_id` — NOT `sonor_blocks` (which is the Takeoffs block library).
  //
  // Pre-v0.23.24 the push went to sonor_blocks via SL.save, found no
  // matching block_code, 0 rows were affected, and the push silently
  // failed for every AV-library device — exactly the bug Bryn caught with
  // TS-PAMP4-100 ("no change in library").
  //
  // This writer mirrors SL.save's contract:
  //   - patches: [{ model_id, label?, metadata?, metadata_replace? }, ...]
  //   - metadata is shallow-merged onto the existing row's metadata
  //   - metadata_replace performs a full replace
  //   - returns { ok, fail, errors } in the same shape
  //
  // The Engineering pushToLibrary handler tries this writer FIRST (since
  // model_id is the dominant case for any device dragged from the AV
  // library) and falls back to SL.save only when no device_catalogue
  // row matches.
  SL.saveDeviceCatalogue = async function (patches) {
    _ensureInit();
    if (!state.client) return { ok: 0, fail: patches.length, errors: ['offline'] };
    let ok = 0, fail = 0; const errors = [];
    for (const p of patches) {
      const id = p.model_id;
      if (!id) { fail++; errors.push({ row: p, error: 'missing model_id' }); continue; }
      if (Object.prototype.hasOwnProperty.call(p, 'metadata') &&
          Object.prototype.hasOwnProperty.call(p, 'metadata_replace')) {
        fail++;
        errors.push({ row: p, error: 'metadata + metadata_replace are mutually exclusive' });
        continue;
      }
      // Read existing metadata so we can shallow-merge.
      let existingMeta = {};
      try {
        const { data: row } = await state.client.from('device_catalogue')
          .select('metadata').eq('model_id', id).maybeSingle();
        existingMeta = (row && row.metadata) || {};
      } catch { /* keep existingMeta = {} */ }

      const safe = {};
      // SAFE COLUMNS for device_catalogue. Whitelist only fields the
      // Engineering push should ever update — nothing about pricing
      // (msrp_gbp), discontinuation, or commercial data should ever
      // flow upstream from a project canvas.
      const ALLOWED = ['make', 'model', 'category', 'service_nn', 'description',
        'u_size', 'watts', 'btu_hr', 'weight_kg', 'depth_mm', 'width_mm', 'height_mm',
        'schematic_status'];
      Object.keys(p).forEach((k) => { if (ALLOWED.includes(k)) safe[k] = p[k]; });

      // Engineering pushes a label — map it onto the `model` column when
      // present (legacy mirror) but never blank-out existing fields.
      if (p.label && !safe.model) safe.model = p.label;

      // Metadata merge (or replace)
      if (Object.prototype.hasOwnProperty.call(p, 'metadata_replace')) {
        safe.metadata = (p.metadata_replace == null) ? null : p.metadata_replace;
      } else if (Object.prototype.hasOwnProperty.call(p, 'metadata') && p.metadata != null) {
        // Shallow merge — ports, schematic, etc. inherit from existing
        // siblings (cable_packages, panel_layout, …) so Engineering's
        // partial push doesn't blow away Library-only metadata.
        safe.metadata = Object.assign({}, existingMeta, p.metadata);
      }

      // Engineering pushes graduate the device from 'pending' →
      // 'confirmed' so the Library port-editor's "not in schematic"
      // hint flips off. v0.23.25 — the constraint is
      // device_catalogue_draw_io_status_check which only allows
      // 'pending' / 'confirmed' / 'blocked'. 'engineering' triggers
      // a CHECK violation and aborts the entire row update.
      if (!safe.schematic_status && safe.metadata && safe.metadata.schematic) {
        safe.schematic_status = 'confirmed';
      }

      if (!Object.keys(safe).length) continue;
      try {
        const res = await state.client.from('device_catalogue')
          .update(safe).eq('model_id', id).select('model_id');
        if (res.error) throw res.error;
        const affected = Array.isArray(res.data) ? res.data.length : 0;
        if (affected === 0) {
          throw new Error(`model_id "${id}" not found in device_catalogue`);
        }
        ok++;
      } catch (e) {
        console.warn('[SonorLibrary] saveDeviceCatalogue failed for', id, e.message || e);
        errors.push({ row: p, error: e.message || String(e) });
        fail++;
      }
    }
    _fire('save', { ok, fail, scope: 'device_catalogue' });
    return { ok, fail, errors };
  };

  // ── Insert new device_catalogue rows (v0.23.24a) ────────────────────────
  //
  // Companion to saveDeviceCatalogue for the "not found, create it"
  // path. Engineering's pushToLibrary calls this when a device on the
  // canvas has a libBlockCode that doesn't exist in device_catalogue
  // yet — typically a Triad / Lutron / Sonance model whose Pipeline
  // CSV row hasn't been synced into Supabase.
  //
  // Strict allowlist: only the columns Engineering actually has data
  // for. make / model / category default sensibly from label so a
  // freshly-pushed row is always visible in the Library UI even if
  // Engineering had partial metadata.
  SL.insertDeviceCatalogue = async function (rows) {
    _ensureInit();
    if (!state.client) return { ok: 0, fail: rows.length, errors: ['offline'] };
    let ok = 0, fail = 0; const errors = [];
    for (const r of rows) {
      const id = r.model_id;
      if (!id) { fail++; errors.push({ row: r, error: 'missing model_id' }); continue; }
      const ALLOWED = ['make', 'model', 'category', 'service_nn', 'description',
        'u_size', 'watts', 'btu_hr', 'weight_kg', 'depth_mm', 'width_mm', 'height_mm',
        'schematic_status', 'metadata'];
      const safe = { model_id: id };
      Object.keys(r).forEach((k) => { if (ALLOWED.includes(k)) safe[k] = r[k]; });
      // Sensible defaults — every device_catalogue row needs make + model
      // + category to render in the Library UI. Pull from label when
      // Engineering didn't pass them explicitly.
      if (!safe.make) safe.make = r.make || '';
      if (!safe.model) safe.model = r.label || id;
      if (!safe.category) safe.category = r.category || 'device';
      // v0.23.25 — Constraint allows 'pending' | 'confirmed' | 'blocked'.
      // Engineering pushes ARE the confirmation, so default to 'confirmed'.
      if (!safe.schematic_status) safe.schematic_status = 'confirmed';
      try {
        const res = await state.client.from('device_catalogue').insert(safe).select('model_id');
        if (res.error) throw res.error;
        ok++;
      } catch (e) {
        console.warn('[SonorLibrary] insertDeviceCatalogue failed for', id, e.message || e);
        errors.push({ row: r, error: e.message || String(e) });
        fail++;
      }
    }
    _fire('save', { ok, fail, scope: 'device_catalogue' });
    return { ok, fail, errors };
  };

  // ── Insert (new rows → sonor_blocks INSERT) ───────────────────────────────
  // v1.3.0 (2026-04-25) — accepts an optional `metadata` object passed
  // through verbatim (no merge — INSERT defines the full initial state).
  // Anything outside SAFE_COLUMNS + 'metadata' is silently dropped.
  SL.insert = async function (rows) {
    _ensureInit();
    if (!state.client) return { ok: 0, fail: rows.length, errors: ['offline'] };
    let ok = 0, fail = 0; const errors = [];
    for (const r of rows) {
      const safe = { block_code: r.block_code };
      Object.keys(r).forEach(k => { if (SAFE_COLUMNS.includes(k)) safe[k] = r[k]; });
      // Derive service_nn from service_key if missing
      if (!safe.service_nn && safe.service_key) {
        const svc = state.services.find(s => s.key === safe.service_key);
        if (svc) safe.service_nn = svc.nn;
      }
      // Opt-in metadata pass-through (full object, no merge — this is INSERT)
      if (Object.prototype.hasOwnProperty.call(r, 'metadata') && r.metadata != null) {
        safe.metadata = r.metadata;
      }
      try {
        const res = await state.client.from('sonor_blocks').insert(safe);
        if (res.error) throw res.error;
        state.allRows.push(safe);
        ok++;
      } catch (e) {
        console.warn('[SonorLibrary] insert failed for', r.block_code, e.message || e);
        errors.push({ row: r, error: e.message || String(e) });
        fail++;
      }
    }
    // v1.13.8 R92 — strip prior '+local' suffix (see SL.save).
    const baseTier = (state.lastTier || 'unknown').replace(/(\+local)+$/, '');
    _setRows(state.allRows, baseTier + '+local');
    _persistCache();
    _fire('insert', { ok, fail });
    return { ok, fail, errors };
  };

  // ── Cable drawables (v1.4.0 — Takeoffs / consumer contract) ───────────────
  // Pure-JS derivation of the same shape v_sonor_cable_drawables exposes
  // server-side, computed from the cached state.allRows so consumers work
  // offline (Tier 2/3/4 fallbacks too). Same column shape as the view —
  // single canonical contract.
  //
  // Shape per drawable (stable — Takeoffs and any future drawing surface
  // depend on these field names):
  //   { id, kind, label, short_code, colour, dash, sort_order,
  //     enabled, tooltip, member_count, members_summary, block_code }
  //
  // - id is the STABLE join key. Renaming creates a new id and orphans
  //   every prior placement that referenced the old one.
  // - dash is a JSON-string array (e.g. "[10,5]") — caller JSON.parse's it
  //   for SVG stroke-dasharray.
  // - enabled folds together (style.enabled !== false) AND row.enabled
  //   AND !row.discontinued, so a single boolean signals "show in toolbar".
  SL.getCableDrawables = function (opts) {
    opts = opts || {};
    const includeDisabled = !!opts.includeDisabled;
    const out = [];

    state.allRows.forEach(r => {
      const m = r.metadata || {};
      const rowEnabled = (r.enabled !== false) && !r.discontinued;

      // Cable category
      if (m.cable_style && m.cable_style.id) {
        const s = m.cable_style;
        const enabled = (s.enabled !== false) && rowEnabled;
        if (enabled || includeDisabled) {
          out.push({
            id:               s.id,
            kind:             'category',
            label:            r.label || s.id,
            short_code:       s.short || '',
            // v1.5.0 R26 — Takeoffs toolbar shorthand. Falls through:
            // explicit draw_tool_name → short → first word of label.
            draw_tool_name:   s.draw_tool_name || s.short || (String(r.label || s.id).split(' ')[0]),
            colour:           s.colour || '#aaa',
            dash:             s.dash || '[]',
            sort_order:       (s.order != null) ? Number(s.order) : 999,
            enabled:          enabled,
            tooltip:          s.tooltip || r.label || s.id,
            member_count:     0,
            members_summary:  null,
            members:          [],
            default_takeoff_metres: null,
            block_code:       r.block_code
          });
        }
      }

      // Cable package
      if (m.package_style && m.package_style.id) {
        const s = m.package_style;
        const enabled = (s.enabled !== false) && rowEnabled;
        if (enabled || includeDisabled) {
          const members = Array.isArray(m.members) ? m.members : [];
          // Auto-derive members_summary like the SQL view does:
          //   "1×HDMI + 1×CAT6 + 1×COAX" — qty desc, then alpha
          const sortedMembers = members.slice().sort((a, b) => {
            const qd = (Number(b.qty) || 0) - (Number(a.qty) || 0);
            if (qd !== 0) return qd;
            return String(a.cable_code || '').localeCompare(String(b.cable_code || ''));
          });
          const summary = sortedMembers
            .map(x => (Number(x.qty) || 0) + '×' + String(x.cable_code || '').slice(0, 4).toUpperCase())
            .join(' + ');
          // v1.7.0 R46 — default_takeoff_metres on package rows (number,
          // default 25). Takeoffs uses this to seed cable totals before a
          // run length is measured: total per cable = metres × member.qty.
          const defaultMetres = (m.default_takeoff_metres != null && Number.isFinite(Number(m.default_takeoff_metres)))
            ? Number(m.default_takeoff_metres) : 25;
          out.push({
            id:               s.id,
            kind:             'package',
            label:            r.label || s.id,
            short_code:       s.short || '',
            draw_tool_name:   s.draw_tool_name || s.short || (String(r.label || s.id).split(' ')[0]),
            colour:           s.colour || '#aaa',
            dash:             s.dash || '[]',
            sort_order:       (s.order != null) ? Number(s.order) : 999,
            enabled:          enabled,
            tooltip:          s.tooltip || summary || r.label || s.id,
            member_count:     members.length,
            members_summary:  summary || null,
            default_takeoff_metres: defaultMetres,
            // v1.6.0 — structured members for fan-out (Takeoffs uses this
            // for per-cable totals breakdown when a package run is
            // tallied). Same shape as cable_blocks.metadata.members[].
            members:          members
              .map(m => ({
                cable_code: String((m && m.cable_code) || '').trim(),
                qty:        (Number.isFinite(Number(m && m.qty)) && Number(m.qty) > 0) ? Math.round(Number(m.qty)) : 1
              }))
              .filter(m => m.cable_code),
            block_code:       r.block_code
          });
        }
      }
    });

    // Sort: kind (category before package), then sort_order, then id
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'category' ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.id).localeCompare(String(b.id));
    });
    return out;
  };

  // Convenience: lookup a single drawable by id (resolves both cats + pkgs)
  SL.getCableDrawable = function (id) {
    if (!id) return null;
    return SL.getCableDrawables({ includeDisabled: true }).find(d => d.id === id) || null;
  };

  // Parse a stored dash string into an SVG stroke-dasharray-ready array.
  // Centralised here so every consumer interprets dash the same way.
  SL.parseCableDash = function (dashStr) {
    if (!dashStr || dashStr === '[]') return [];
    try {
      const arr = JSON.parse(dashStr);
      return Array.isArray(arr) ? arr.filter(n => Number.isFinite(+n)).map(Number) : [];
    } catch (e) { return []; }
  };

  function _persistCache() {
    try {
      localStorage.setItem(state.lsKey, JSON.stringify({
        fetched_at: new Date().toISOString(),
        rows: state.allRows
      }));
    } catch (e) {}
  }

  // ── Accessors ─────────────────────────────────────────────────────────────
  SL.getLibrary  = function () { return state.library.slice(); };
  SL.getAllRows  = function () { return state.allRows.slice(); };
  SL.getSymbols  = function () { return state.symbols.slice(); };
  SL.getServices = function () { return state.services.slice(); };
  SL.getMeta     = function () { return { tier: state.lastTier, fetched_at: state.lastFetchedAt }; };

  // ── v3.7.0 (B-410) — library status pill ─────────────────────────────────
  // Surfaces WHICH tier the app is actually running on (supabase / snapshot /
  // localStorage / seed) + data age + module version. The 2026-07-14 view
  // outage silently dropped every app to snapshot data with only a console
  // warn. Opt-in mount: give any app an element with id "sonor-library-pill"
  // (or call SL.renderStatusPill(el) explicitly). Fully guarded — no-op when
  // no host exists. Refreshes every 60s while mounted.
  SL.renderStatusPill = function (target) {
    try {
      const host = (typeof target === 'string') ? document.querySelector(target)
                 : (target || document.getElementById('sonor-library-pill'));
      if (!host) return false;
      const m = SL.getMeta() || {};
      const tier = String(m.tier || 'not loaded');
      const live = /supabase/i.test(tier);
      let ageMs = null;
      if (m.fetched_at) { const t = Date.parse(m.fetched_at); if (!isNaN(t)) ageMs = Date.now() - t; }
      const stale = ageMs != null && ageMs > 24 * 3600 * 1000;
      const ageTxt = ageMs == null ? '' : (ageMs < 90000 ? 'just now' : ageMs < 3600000 ? Math.round(ageMs / 60000) + 'm ago' : ageMs < 86400000 ? Math.round(ageMs / 3600000) + 'h ago' : Math.round(ageMs / 86400000) + 'd ago');
      const col = live && !stale ? { bg:'#f0fdf4', fg:'#065f46', bd:'#86efac', dot:'#22c55e' }
                : stale          ? { bg:'#fef2f2', fg:'#991b1b', bd:'#fca5a5', dot:'#ef4444' }
                :                  { bg:'#fffbeb', fg:'#92400e', bd:'#fcd34d', dot:'#f59e0b' };
      host.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:10px;font:600 10px \'DM Sans\',sans-serif;background:' + col.bg + ';color:' + col.fg + ';border:1px solid ' + col.bd + ';white-space:nowrap;" title="Library data tier: ' + tier + (ageTxt ? ' · fetched ' + ageTxt : '') + ' · sonor-library v' + (window.SONOR_LIBRARY_VERSION || '?') + '">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + col.dot + ';display:inline-block;"></span>' +
        'LIB ' + (live ? 'live' : tier.split(' ')[0]) + (ageTxt ? ' · ' + ageTxt : '') + '</span>';
      if (!state._pillTimer) state._pillTimer = setInterval(function () { SL.renderStatusPill(host); }, 60000);
      return true;
    } catch (e) { return false; }
  };
  // Auto-mount attempt (opt-in host) — try now-ish and once more after load
  // has had time to settle. Silent no-ops when the host id is absent.
  if (typeof document !== 'undefined') {
    setTimeout(function () { SL.renderStatusPill(); }, 1500);
    setTimeout(function () {
      SL.renderStatusPill();
      try {
        const m = SL.getMeta() || {};
        if (m.tier && !/supabase/i.test(String(m.tier))) {
          console.warn('[SonorLibrary] ⚠ running on tier "' + m.tier + '" — library data may be stale (B-410)');
        }
      } catch (e) {}
    }, 5000);
  }
  SL.getSupabaseClient = function () { _ensureInit(); return state.client; };

  // ── Sub-group management (v3.2.0) ─────────────────────────────────────────
  // Backed by table `sonor_block_subgroups` — one row per (service_nn,
  // service_sub) giving a sub-group its canonical display name + order,
  // independent of whether any block currently sits in it. Blocks still
  // carry service_sub + sub_name; renameSubgroup mirrors the new name onto
  // every block in the group so consumers reading block.sub_name stay
  // correct. RLS allows no DELETE — retire a group via enabled=false.
  //
  //   getSubgroups(opts)          — opts: { service_nn?, includeDisabled? }
  //   createSubgroup(def)         — def: { service_nn, service_sub?, sub_name, sort_order? }
  //                                 service_sub auto-derives next free number when omitted.
  //   renameSubgroup(nn,sub,name) — { propagateToBlocks?: true } mirrors onto sonor_blocks.
  //   reorderSubgroups(patches)   — [{ id|service_nn+service_sub, sort_order }]
  SL.getSubgroups = async function (opts) {
    opts = opts || {};
    _ensureInit();
    if (!state.client) return [];
    let q = state.client.from('sonor_block_subgroups').select('*');
    if (opts.service_nn) q = q.eq('service_nn', opts.service_nn);
    if (!opts.includeDisabled) q = q.eq('enabled', true);
    q = q.order('service_nn', { ascending: true }).order('sort_order', { ascending: true });
    const res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  };

  SL.createSubgroup = async function (def) {
    def = def || {};
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.createSubgroup: offline');
    const service_nn = def.service_nn;
    const sub_name   = (def.sub_name || '').trim();
    if (!service_nn || !sub_name) throw new Error('createSubgroup: service_nn and sub_name are required');
    // Auto-derive the next free service_sub number for this service when omitted.
    let sub = def.service_sub;
    let existing = null;
    if (sub == null || sub === '') {
      existing = await SL.getSubgroups({ service_nn, includeDisabled: true });
      const nums = existing.map(g => parseInt(g.service_sub, 10)).filter(n => Number.isFinite(n));
      sub = String((nums.length ? Math.max.apply(null, nums) : 0) + 1);
    }
    let so = def.sort_order;
    if (so == null) {
      if (!existing) existing = await SL.getSubgroups({ service_nn, includeDisabled: true });
      so = existing.reduce((m, g) => Math.max(m, Number(g.sort_order) || 0), 0) + 10;
    }
    const res = await state.client.from('sonor_block_subgroups')
      .insert({ service_nn, service_sub: String(sub), sub_name, sort_order: so })
      .select('*');
    if (res.error) throw res.error;
    _fire('subgroups', { event: 'create', row: res.data && res.data[0] });
    return res.data && res.data[0];
  };

  SL.renameSubgroup = async function (service_nn, service_sub, newName, opts) {
    opts = opts || {};
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.renameSubgroup: offline');
    const sub = (service_sub == null) ? '' : String(service_sub);
    newName = (newName || '').trim();
    if (!service_nn || sub === '' || !newName) {
      throw new Error('renameSubgroup: service_nn, service_sub and newName are required');
    }
    const res = await state.client.from('sonor_block_subgroups')
      .update({ sub_name: newName, updated_at: new Date().toISOString() })
      .eq('service_nn', service_nn).eq('service_sub', sub).select('*');
    if (res.error) throw res.error;
    // Mirror onto blocks (default true) so block.sub_name stays consistent.
    if (opts.propagateToBlocks !== false) {
      const upd = await state.client.from('sonor_blocks')
        .update({ sub_name: newName })
        .eq('service_nn', service_nn).eq('service_sub', sub);
      if (upd.error) throw upd.error;
    }
    _fire('subgroups', { event: 'rename', service_nn, service_sub: sub, sub_name: newName });
    return res.data && res.data[0];
  };

  SL.reorderSubgroups = async function (patches) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.reorderSubgroups: offline');
    let ok = 0, fail = 0; const errors = [];
    for (const p of (patches || [])) {
      try {
        let q = state.client.from('sonor_block_subgroups')
          .update({ sort_order: p.sort_order, updated_at: new Date().toISOString() });
        if (p.id) q = q.eq('id', p.id);
        else q = q.eq('service_nn', p.service_nn).eq('service_sub', String(p.service_sub));
        const res = await q.select('id');
        if (res.error) throw res.error;
        ok++;
      } catch (e) { fail++; errors.push({ row: p, error: e.message || String(e) }); }
    }
    _fire('subgroups', { event: 'reorder', ok, fail });
    return { ok, fail, errors };
  };

  // v3.2.2 — renumber a service's sub-groups so service_sub follows the
  // current display order (sort_order): the '0' bucket keeps 0, every named
  // sub-group becomes 1..N top-to-bottom. Member blocks are moved in lockstep
  // by the Postgres function (atomic, collision-safe two-phase), so nothing is
  // orphaned. Call AFTER reorderSubgroups so the new sort_order is in place.
  SL.resequenceSubgroups = async function (service_nn) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.resequenceSubgroups: offline');
    if (!service_nn) throw new Error('resequenceSubgroups: service_nn is required');
    const res = await state.client.rpc('resequence_subgroups', { p_service_nn: service_nn });
    if (res.error) throw res.error;
    _fire('subgroups', { event: 'resequence', service_nn });
    return true;
  };

  // ── Subscribe ─────────────────────────────────────────────────────────────
  //
  // v1.0.x: subscribe(fn) — fires on every successful sonor_blocks load/save.
  // v2.0.x (Library v1.12.2 R79): subscribe(kind, fn) — Supabase realtime
  //         channels per catalogue table. Lazily opened on first subscribe,
  //         closed when the last subscriber unsubscribes. kind ∈
  //         { 'blocks', 'cables', 'packages', 'backboxes', 'faceplates',
  //           'devices', 'misc', 'aliases' }.
  //
  // Backward compat: subscribe(fn) without a kind still fires on blocks
  // change for legacy callers. (Same semantics as v1.0.x.)
  //
  // Returns: an unsubscribe function. Calling it removes the handler and,
  // when the last handler for a kind is removed, closes the realtime
  // channel so we don't leak Supabase websocket capacity.

  const REALTIME_KIND_TABLE = {
    blocks:     'sonor_blocks',
    cables:     'pm_cable_types',
    packages:   'cable_packages',
    backboxes:  'pm_backbox_types',
    faceplates: 'pm_faceplate_types',
    devices:    'device_catalogue',
    misc:       'misc_catalogue',
    aliases:    'sonor_catalogue_aliases'
  };

  // Per-kind subscriber sets + open realtime channel handles.
  const realtimeHandlers = new Map();   // kind → Set<fn>
  const realtimeChannels = new Map();   // kind → Supabase RealtimeChannel

  function _openRealtimeChannel(kind) {
    const table = REALTIME_KIND_TABLE[kind];
    if (!table || !state.client) return null;
    if (realtimeChannels.has(kind)) return realtimeChannels.get(kind);

    const channel = state.client
      .channel('sl-' + kind)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const handlers = realtimeHandlers.get(kind);
        if (!handlers) return;
        handlers.forEach(h => {
          try { h({ kind, event: payload.eventType, new: payload.new, old: payload.old }); }
          catch (e) { console.warn('[SonorLibrary] realtime handler error (' + kind + '):', e); }
        });
      })
      .subscribe();
    realtimeChannels.set(kind, channel);
    return channel;
  }

  function _closeRealtimeChannel(kind) {
    const channel = realtimeChannels.get(kind);
    if (!channel) return;
    try { state.client && state.client.removeChannel(channel); }
    catch (e) { /* tolerate cleanup errors */ }
    realtimeChannels.delete(kind);
  }

  SL.subscribe = function (kindOrFn, maybeFn) {
    // Legacy shape — subscribe(fn) → blocks load/save events (state.handlers).
    if (typeof kindOrFn === 'function') {
      state.handlers.add(kindOrFn);
      return () => state.handlers.delete(kindOrFn);
    }
    // New shape — subscribe(kind, fn) → Supabase realtime per-table channel.
    const kind = kindOrFn;
    const fn   = maybeFn;
    if (!REALTIME_KIND_TABLE[kind]) {
      throw new Error('SonorLibrary.subscribe: unknown kind "' + kind + '" — must be one of ' + Object.keys(REALTIME_KIND_TABLE).join(' / '));
    }
    if (typeof fn !== 'function') throw new Error('SonorLibrary.subscribe: handler must be a function');
    _ensureInit();
    if (!realtimeHandlers.has(kind)) realtimeHandlers.set(kind, new Set());
    realtimeHandlers.get(kind).add(fn);
    _openRealtimeChannel(kind);                  // idempotent — no-op if already open
    return () => {                                // unsubscribe
      const handlers = realtimeHandlers.get(kind);
      if (!handlers) return;
      handlers.delete(fn);
      if (handlers.size === 0) {                  // last subscriber → close channel
        realtimeHandlers.delete(kind);
        _closeRealtimeChannel(kind);
      }
    };
  };
  SL.unsubscribe = function (fn) { state.handlers.delete(fn); };   // legacy — blocks-only

  // ════════════════════════════════════════════════════════════════════════
  // v1.2.0 — Tier 1 consumer-readiness API surface (Library v1.12.0 R74-R77)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Bryn 2026-05-10: "does anything else need optimising to library for
  // other apps like pm and takeoffs to reference from it?" — answer was a
  // four-item Tier 1 batch surfaced here so PM / Takeoffs / Packs / Portal
  // / Network Map / RAMS / IG Cards all stop reimplementing the same
  // catalogue-fetch logic.
  //
  // Every helper below is async + Supabase-backed. They do NOT touch
  // state.allRows / state.library / state.symbols — those remain
  // sonor_blocks-scoped (the Library app's primary store). Catalogue
  // fetches return fresh rows from Supabase each call. Caching is the
  // caller's responsibility (or comes later).
  //
  // Common option: `opts.includeInactive` — defaults to false (only
  // active rows returned, matching the Library's own tab filters).
  //
  // Common return shape: an array of row objects. Errors throw — wrap in
  // try/catch on the caller. No promise rejection swallowing.

  // ── B-244 / R74 — SL.expandPackage(pkgId) ───────────────────────────────
  // Given a package id (or block_code for sonor_blocks-stored packages),
  // return the flat materials list — every cable line × qty + every
  // device-end / head-end connector / faceplate / backbox / accessory ×
  // qty. Single source of truth for "what's in a package", so PM cable
  // schedules, Takeoffs per-run material lists, and Packs procurement
  // totals stop independently parsing cable_package_lines + JSONB
  // metadata (each was parsing the JSONB shape slightly differently).
  //
  // Returns a Promise<Array<{
  //   kind: 'cable' | 'connector' | 'faceplate' | 'backbox' | 'accessory',
  //   end:  'device' | 'head' | null,    // null for cable lines (run across both ends)
  //   id:   string,                       // pm_cable_types.id / pm_backbox_types.id / etc.
  //   name: string,                       // resolved label
  //   qty:  number,                       // integer ≥ 1
  //   metadata: object                    // pass-through (colour / purpose / sku / etc.)
  // }>>
  //
  // Edge cases:
  // - Unknown / missing references resolve to { name: '(unknown)' } not skipped.
  // - Legacy flat metadata.connectors[] / metadata.backboxes[] (pre-v1.10.0
  //   shape) is treated as device-end.
  // - Cable lines come from cable_package_lines (relational), end-groups
  //   come from cable_packages.package_metadata (JSONB). Both are loaded
  //   in one parallel fetch.
  SL.expandPackage = async function (pkgId) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.expandPackage: no Supabase client');
    if (!pkgId) throw new Error('SonorLibrary.expandPackage: pkgId is required');

    // Parallel fetch — package row (with metadata), lines, and all four
    // end-group catalogue tables for resolving names from the saved ids.
    const [pkgRes, linesRes, cablesRes, backboxesRes, faceplatesRes] = await Promise.all([
      state.client.from('cable_packages').select('*').eq('id', pkgId).maybeSingle(),
      state.client.from('cable_package_lines').select('*').eq('package_id', pkgId).order('sort_order', { ascending: true }),
      state.client.from('pm_cable_types').select('id,name,top_category,category,sku,manufacturer,msrp_gbp,colours,install_mins,metadata'),
      state.client.from('pm_backbox_types').select('id,name,category,sku,manufacturer,msrp_gbp,install_mins,metadata'),
      state.client.from('pm_faceplate_types').select('id,name,category,sku,manufacturer,msrp_gbp,install_mins,metadata')
    ]);

    if (pkgRes.error)        throw pkgRes.error;
    if (linesRes.error)      throw linesRes.error;
    if (cablesRes.error)     throw cablesRes.error;
    if (backboxesRes.error)  throw backboxesRes.error;
    if (faceplatesRes.error) throw faceplatesRes.error;

    const pkg   = pkgRes.data;
    if (!pkg) throw new Error('SonorLibrary.expandPackage: package "' + pkgId + '" not found');
    const lines = linesRes.data || [];

    // Resolver maps — id → row, kept per-table so a single id collision
    // across tables is unambiguous (pm_cable_types vs pm_backbox_types).
    const cableMap     = new Map();   cablesRes.data.forEach(r => cableMap.set(r.id, r));
    const backboxMap   = new Map();   backboxesRes.data.forEach(r => backboxMap.set(r.id, r));
    const faceplateMap = new Map();   faceplatesRes.data.forEach(r => faceplateMap.set(r.id, r));

    const out = [];

    // 1) Cable lines — kind='cable', end=null (a cable line spans both ends).
    // v3.1.0 — also emits per-line connector entries (kind='connector') when
    // head_connector_id / device_connector_id are set on the line. Qty mirrors
    // the cable line (one connector per run per end). Flagged _from_line=true
    // so consumers can distinguish from the bulked end-group entries in §2.
    // Also fixes latent qty bug: table column is `quantity`; `qty` is only the
    // view alias. Both are tried for graceful fallback.
    lines.forEach(ln => {
      const cable   = cableMap.get(ln.cable_id) || {};
      const lineQty = Number.isFinite(Number(ln.quantity)) ? Number(ln.quantity)
                    : Number.isFinite(Number(ln.qty))      ? Number(ln.qty) : 1;
      out.push({
        kind:     'cable',
        end:      null,
        id:       ln.cable_id,
        name:     cable.name || ln.cable_name || '(unknown cable)',
        qty:      lineQty,
        metadata: {
          colour:              ln.colour || null,
          purpose:             ln.purpose || null,
          sku:                 ln.sku || cable.sku || null,
          manufacturer:        cable.manufacturer || null,
          msrp_gbp:            cable.msrp_gbp || null,
          category:            cable.category || ln.cable_cat || null,
          top_category:        cable.top_category || null,
          install_mins:        cable.install_mins || null,
          // v3.1.0 — back-refs so consumers can cross-reference connector entries
          head_connector_id:   ln.head_connector_id   || null,
          device_connector_id: ln.device_connector_id || null
        }
      });
      // v3.1.0 — per-line connector entries (one per end where connector is set)
      ['head', 'device'].forEach(function (end) {
        var cnId = end === 'head' ? ln.head_connector_id : ln.device_connector_id;
        if (!cnId) return;
        var r = cableMap.get(cnId) || {};
        out.push({
          kind:     'connector',
          end:      end,
          id:       cnId,
          name:     r.name || '(unknown connector)',
          qty:      lineQty,
          metadata: {
            sku:          r.sku          || null,
            manufacturer: r.manufacturer || null,
            msrp_gbp:     r.msrp_gbp    || null,
            category:     r.category    || null,
            install_mins: r.install_mins || null,
            _from_line:   true   // distinguishes per-line FK from end-group JSONB
          }
        });
      });
    });

    // 2) End-group entries — connectors / faceplates / backboxes / accessories
    //    × { device, head }. Connectors + accessories live in pm_cable_types
    //    (top_category filter); faceplates + backboxes have their own tables.
    const meta = pkg.package_metadata || {};
    const ENDS = ['device', 'head'];
    const TYPES = [
      { listKey: 'connectors',  kind: 'connector',  resolver: cableMap     },
      { listKey: 'faceplates',  kind: 'faceplate',  resolver: faceplateMap },
      { listKey: 'backboxes',   kind: 'backbox',    resolver: backboxMap   },
      { listKey: 'accessories', kind: 'accessory',  resolver: cableMap     }
    ];

    ENDS.forEach(end => {
      // Modern shape: meta.{device,head}_end.{connectors,faceplates,backboxes,accessories}
      // Legacy shape: meta.connectors / meta.backboxes flat at metadata root → device-end only
      const src = (meta[end + '_end']) ||
                  (end === 'device' ? { connectors: meta.connectors, backboxes: meta.backboxes } : {});
      TYPES.forEach(t => {
        const list = Array.isArray(src[t.listKey]) ? src[t.listKey] : [];
        list.forEach(it => {
          const r = t.resolver.get(it.id) || {};
          out.push({
            kind:     t.kind,
            end:      end,
            id:       it.id,
            name:     r.name || '(unknown ' + t.kind + ')',
            qty:      Number.isFinite(Number(it.qty)) ? Number(it.qty) : 1,
            metadata: {
              sku:          r.sku || null,
              manufacturer: r.manufacturer || null,
              msrp_gbp:     r.msrp_gbp || null,
              category:     r.category || null,
              install_mins: r.install_mins || null
            }
          });
        });
      });
    });

    return out;
  };

  // ── B-245 / R75 — get<Set>() API parity ────────────────────────────────
  // Concept-named accessors so consumer apps stop knowing Supabase table
  // names. A future schema rename (cf. v1.11.4 R70 connector unification)
  // stays inside sonor-library.js — every caller of SL.getConnectors()
  // continues to work without edit.
  //
  // Each helper returns a Promise<Array<row>>. All apply the same default
  // active-only filter the Library tabs apply; pass `{ includeInactive: true }`
  // for the full set.

  // Internal — applies the standard active-only filter unless overridden.
  function _applyActiveFilter(q, table, opts) {
    if (opts && opts.includeInactive) return q;
    // Soft-delete columns by table — mirrors sonor-library.html's
    // _SET_SOFT_DELETE_FLAGS map. Kept here as data, not duplicated logic.
    const ACTIVE_COL = {
      'pm_cable_types':     'active',
      'pm_backbox_types':   'active',
      'pm_faceplate_types': 'active',
      'pm_led_strip_types': 'active',
      'shades_catalogue':   'enabled',
      'acoustic_products':  'enabled',
      'fabric_types':       'enabled',
      'furniture_types':    'enabled',
      'sonor_finishes':     'enabled',
      'shade_systems':      'enabled',
      'shade_textiles':     'enabled',
      'rack_models':        'enabled'
      // device_catalogue / misc_catalogue / cable_packages use `discontinued` (inverse)
    };
    const NEGATED_COL = {
      'device_catalogue': 'discontinued',
      'misc_catalogue':   'discontinued'
    };
    if (ACTIVE_COL[table])  q = q.eq(ACTIVE_COL[table], true);
    if (NEGATED_COL[table]) q = q.eq(NEGATED_COL[table], false);
    return q;
  }

  async function _fetchTable(table, opts) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.' + table + ': no Supabase client');
    let q = state.client.from(table).select('*');
    q = _applyActiveFilter(q, table, opts);
    if (opts && opts.orderBy) {
      (opts.orderBy || []).forEach(([col, asc]) => { q = q.order(col, { ascending: asc !== false }); });
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // Cables — pm_cable_types. Optional opts.topCategory filters to one
  // sub-mode (bulk / interconnect / connector / containment / accessory).
  SL.getCables = function (opts) {
    opts = opts || {};
    return _fetchTable('pm_cable_types', opts).then(rows => {
      if (opts.topCategory) rows = rows.filter(r => r.top_category === opts.topCategory);
      return rows;
    });
  };
  // Convenience wrappers — pre-filter pm_cable_types by top_category.
  SL.getConnectors  = function (opts) { return SL.getCables(Object.assign({}, opts, { topCategory: 'connector'  })); };
  SL.getAccessories = function (opts) { return SL.getCables(Object.assign({}, opts, { topCategory: 'accessory'  })); };
  // Faceplates / backboxes — own tables.
  SL.getFaceplates  = function (opts) { return _fetchTable('pm_faceplate_types', opts); };
  SL.getBackboxes   = function (opts) { return _fetchTable('pm_backbox_types',   opts); };
  // Lighting control — own table (v1.15.0 R100). Control4 catalogue with
  // per-row metadata.ports array (see APP - Library/CONNECTIONS-PLAN.md).
  SL.getLightingControl = function (opts) { return _fetchTable('pm_lighting_control_types', opts); };
  // v3.0.2 (2026-05-11) — LED strips — pm_led_strip_types. Library has a
  // dedicated "LED Strips" tab with 15+ strip variants (COB / Pixel /
  // Neon Flex / RGBW / High Efficacy / Single Colour at various Kelvin).
  // Row shape: { id, label, watts_per_metre, volts, dmx_channels,
  // kelvin, cri, ip_rating, notes, sort_order, metadata: { line_style,
  // display_colour, default_cable_run_m, default_cable_package } }.
  // Consumers (Takeoffs LED Run palette) iterate this list to build
  // their drawable LED chip rail. Active-only filter applied; pass
  // opts.includeInactive: true for the full set.
  SL.getLedStrips = function (opts) { return _fetchTable('pm_led_strip_types', opts); };
  // v3.0.3 (2026-05-11) — Shades — shades_catalogue. Library has a
  // dedicated "Shades" tab with Roller / Roman / Venetian / Curtain
  // Track / Velux / Roof Blind variants. Row shape: { id (uuid), label,
  // shade_type, textile, motor_side, system_type, hem_bar, side_mask,
  // header_type, cabling, outlet, q_est, notes, sort_order, enabled,
  // metadata: { line_style, display_colour, … } }. Consumers (Takeoffs
  // Shade picker, Cinema Design fabric track tab) iterate this list.
  // Note: shades_catalogue uses `enabled` (not `active`) for the live
  // filter — handled by _fetchTable's per-table column map at line 854+.
  SL.getShades = function (opts) { return _fetchTable('shades_catalogue', opts); };

  // ── v3.3.0 (2026-07-07) — Finishes master + block-options resolver ────────
  //
  // `sonor_finishes` is the ONE canonical registry of plate/keypad finishes
  // (white-std default, screwless, brushed steel, matt black, brushed brass,
  // C4 keypad Lux range, …). Blocks with a plate-finish dimension reference
  // it from metadata.options.<key> = { label, ref:'sonor_finishes', group,
  // default } instead of embedding value arrays — edit the registry once,
  // every dropdown follows. Contract: APP - Library/CONSUMER-API.md §11.
  //
  // getFinishes(opts) → [{id, label, finish_group, is_default, sort_order}]
  //   opts.group filters to one finish_group ('plate' | 'keypad' | future).
  SL.getFinishes = function (opts) {
    opts = opts || {};
    return _fetchTable('sonor_finishes', Object.assign({
      orderBy: [['finish_group', true], ['sort_order', true]]
    }, opts)).then(rows => opts.group ? rows.filter(r => r.finish_group === opts.group) : rows);
  };

  // ── v3.4.0 (2026-07-10) — Shade systems registry ──────────────────────────
  // `shade_systems` = SSOT of shade drive systems (Lutron QS, Somfy 4-core /
  // io / RTS, LV wired). Shade VARIANTS stay generic; the chosen system
  // carries default_cable_package + default_cable_run_m + accessory notes.
  // Contract: CONSUMER-API.md §14.
  SL.getShadeSystems = function (opts) {
    return _fetchTable('shade_systems', Object.assign({
      orderBy: [['sort_order', true]]
    }, opts || {}));
  };

  // v3.4.2 — `shade_textiles` = SSOT of textile types (Blackout, Day Screen
  // 3%, Voile…). The per-shade SWATCH (specific fabric ref) is free text on
  // the placement (placement.opts.swatch) — the registry only governs the
  // type dropdown. Contract: CONSUMER-API.md §15.3.
  SL.getShadeTextiles = function (opts) {
    return _fetchTable('shade_textiles', Object.assign({
      orderBy: [['sort_order', true]]
    }, opts || {}));
  };

  // ── v3.5.0 (2026-07-12, B-378) — alias-aware block-code resolution ────────
  // Renames land in `sonor_catalogue_aliases` (entity_type='block'). These
  // helpers let every consumer follow old → new chains transparently, so a
  // legacy placement code (e.g. a pre-2026-07-11 pm-<uuid>) never dangles.
  let _aliasMap = null;       // { old_id: new_id }
  let _aliasPromise = null;
  SL.getBlockAliases = function (force) {
    if (_aliasMap && !force) return Promise.resolve(_aliasMap);
    if (_aliasPromise && !force) return _aliasPromise;
    _ensureInit();
    if (!state.client) return Promise.resolve({});
    _aliasPromise = state.client
      .from('sonor_catalogue_aliases')
      .select('old_id,new_id')
      .eq('entity_type', 'block')
      .then(function (res) {
        if (res.error) throw res.error;
        const m = {};
        (res.data || []).forEach(function (r) { m[r.old_id] = r.new_id; });
        _aliasMap = m;
        return m;
      })
      .catch(function (e) {
        _aliasPromise = null;   // retry next call
        console.warn('[SonorLibrary] alias fetch failed:', e.message || e);
        return {};
      });
    return _aliasPromise;
  };
  // Follow the alias chain to the current terminal code (max 10 hops).
  SL.resolveBlockCode = async function (code) {
    if (!code) return code;
    const m = await SL.getBlockAliases();
    let cur = code, hops = 0;
    while (m[cur] && hops < 10) { cur = m[cur]; hops++; }
    return cur;
  };
  // Alias-aware row lookup over the loaded library (any fallback tier).
  SL.findBlock = async function (code) {
    if (!code) return null;
    const rows = state.allRows || [];
    let hit = rows.find(function (r) { return r.block_code === code; });
    if (hit) return hit;
    const resolved = await SL.resolveBlockCode(code);
    if (resolved !== code) {
      hit = rows.find(function (r) { return r.block_code === resolved; });
    }
    return hit || null;
  };
  // ── v3.6.2 (2026-07-12, §19.1) — AUTO-CHILDREN resolution ─────────────────
  // A parent block (rack, lighting panel, …) declares child blocks that must
  // auto-insert with it: metadata.auto_children = [{block, qty, role}].
  // First role: 'elec_requirement' (11.0 Sonor Requirements bundles).
  // Legacy fallbacks folded in: metadata.required_elec, metadata.required_block.
  // Returns [{row, qty, role, block_code}] with codes alias-resolved; children
  // whose code no longer resolves are returned with row:null (flag, don't drop).
  SL.getAutoChildren = async function (blockCode) {
    const parent = await SL.findBlock(blockCode);
    if (!parent) return [];
    const m = parent.metadata || parent.block_metadata || {};
    const specs = [];
    if (Array.isArray(m.auto_children)) {
      m.auto_children.forEach(function (c) {
        if (c && c.block) specs.push({ block: c.block, qty: c.qty || 1, role: c.role || 'child' });
      });
    } else {
      if (m.required_elec)  specs.push({ block: m.required_elec,  qty: 1, role: 'elec_requirement' });
      if (m.required_block) specs.push({ block: m.required_block, qty: 1, role: 'required_block' });
    }
    const out = [];
    for (const spec of specs) {
      const row = await SL.findBlock(spec.block);
      out.push({ block_code: spec.block, row: row || null, qty: spec.qty, role: spec.role });
    }
    return out;
  };

  // "Where is this used?" — count_sonor_block_references RPC (v2: matches the
  // whole alias FAMILY, covers takeoffs floors+placements, packs, cinema,
  // shade variant/system required_block).
  SL.getBlockRefs = function (code) {
    _ensureInit();
    if (!state.client) return Promise.reject(new Error('SonorLibrary.getBlockRefs: no Supabase client'));
    return state.client.rpc('count_sonor_block_references', { p_block_code: code })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
  };

  // ── v3.6.0 (2026-07-12, B-382) — versioned library releases ───────────────
  // `library_releases` = IMMUTABLE snapshots (blocks + packages + registries
  // + shades). Projects pin a rev (projects.metadata.library_rev) so historic
  // takeoffs render exactly as priced. Contract: CONSUMER-API.md §17.
  SL.getLibraryReleases = function () {
    _ensureInit();
    if (!state.client) return Promise.resolve([]);
    return state.client.from('library_releases')
      .select('rev,label,notes,created_by,block_count,checksum,created_at')
      .order('rev', { ascending: false })
      .then(function (res) { if (res.error) throw res.error; return res.data || []; });
  };
  SL.getLibraryRelease = function (rev) {   // full snapshot — large payload
    _ensureInit();
    if (!state.client) return Promise.reject(new Error('no client'));
    return state.client.from('library_releases').select('*').eq('rev', rev).single()
      .then(function (res) { if (res.error) throw res.error; return res.data; });
  };
  SL.publishLibraryRelease = function (label, notes, by) {
    _ensureInit();
    if (!state.client) return Promise.reject(new Error('no client'));
    return state.client.rpc('publish_library_release',
      { p_label: label || null, p_notes: notes || null, p_by: by || 'app' })
      .then(function (res) { if (res.error) throw res.error; return res.data; });
  };
  SL.diffLibraryReleases = function (fromRev, toRev) {
    _ensureInit();
    if (!state.client) return Promise.reject(new Error('no client'));
    return state.client.rpc('diff_library_releases', { p_from: fromRev, p_to: toRev })
      .then(function (res) { if (res.error) throw res.error; return res.data; });
  };

  // v3.6.1 (2026-07-12) — `rack_models` = SSOT of rack cabinets (Sanus /
  // All-Rack / Middle Atlantic / Penn Elcom; mount floor|wall, u_height,
  // depth_mm). Generic Floor/Wall Rack blocks carry
  // options.rack_model = {ref:'rack_models', group:'floor'|'wall'} — the
  // chosen model's U/depth flow through placements to Packs/Engineering.
  SL.getRackModels = function (opts) {
    return _fetchTable('rack_models', Object.assign({
      orderBy: [['sort_order', true]]
    }, opts || {}));
  };

  // resolveBlockOptions(optionsMeta) → Promise<resolved>
  // Takes a block's metadata.options object and returns the same shape with
  // every {ref:'sonor_finishes'} entry expanded to concrete
  // { label, values:[{id,label}], default } using the live registry.
  // Inline (non-ref) entries pass through with values normalised to
  // [{id:value, label:value}] so consumers render one shape.
  SL.resolveBlockOptions = async function (optionsMeta) {
    if (!optionsMeta || typeof optionsMeta !== 'object') return {};
    const out = {};
    let finishes = null;
    let shadeSystems = null;
    let shadeTextiles = null;
    let rackModels = null;
    for (const key of Object.keys(optionsMeta)) {
      const def = optionsMeta[key] || {};
      if (def.ref === 'rack_models') {
        // v3.6.1 — rack model dropdown; def.group filters mount floor|wall.
        // Values carry u_height / depth_mm / brand so consumers (Takeoffs
        // labels, Packs rack builder, Engineering elevations) inherit the
        // cabinet parameters from the placement's chosen model.
        if (!rackModels) rackModels = await SL.getRackModels();
        const wanted = def.group ? rackModels.filter(function (r) { return r.mount === def.group; }) : rackModels;
        out[key] = {
          label:   def.label || 'Rack Model',
          values:  wanted.map(function (r) {
            return { id: r.id, label: r.label, brand: r.brand, mount: r.mount,
                     u_height: r.u_height, depth_mm: r.depth_mm };
          }),
          default: def.default || null
        };
        continue;
      }
      if (def.ref === 'shade_textiles') {
        // v3.4.2 — textile TYPE from the registry; the specific fabric
        // swatch is a free-text companion field (placement.opts.swatch).
        if (!shadeTextiles) shadeTextiles = await SL.getShadeTextiles();
        out[key] = {
          label:   def.label || 'Textile',
          values:  shadeTextiles.map(r => ({ id: r.id, label: r.label, swatch: r.swatch || null })),
          default: def.default || null,
          // hint for consumers: render a paired free-text input
          companion_text: { key: 'swatch', label: 'Swatch', placeholder: 'e.g. Louvolite Carnival Blackout FR — manual entry' }
        };
        continue;
      }
      if (def.ref === 'shade_systems') {
        // v3.4.0 — system dropdown resolves from the shade_systems registry;
        // values carry the system's cable package so consumers can swap the
        // placement's first-fix expansion when the system changes.
        if (!shadeSystems) shadeSystems = await SL.getShadeSystems();
        out[key] = {
          label:   def.label || 'System',
          values:  shadeSystems.map(r => ({
            id: r.id, label: r.label,
            default_cable_package: r.default_cable_package || null,
            default_cable_run_m:   r.default_cable_run_m   || null,
            // v3.4.1 — trade ownership + required block. RTS has NO cable
            // run (battery) but requires a fused-spur BLOCK SYMBOL placed
            // at the shade (CL-SON-11-3-SPUR); install_by 'electrical' =
            // rendered on electrical plans / BY OTHERS, never the Sonor
            // cable schedule.
            install_by:     (r.metadata && r.metadata.install_by) || 'sonor',
            required_block: (r.metadata && r.metadata.required_block) || null
          })),
          default: def.default || (shadeSystems.find(r => r.is_default) || shadeSystems[0] || {}).id || null
        };
        continue;
      }
      if (def.ref === 'sonor_finishes') {
        if (!finishes) finishes = await SL.getFinishes();
        // v3.3.1 — def.groups[] unions multiple registry groups into one
        // dropdown (e.g. sockets list Click Deco + Click Define together).
        // def.group (string) still supported; neither = whole registry.
        const wanted = Array.isArray(def.groups) ? def.groups : (def.group ? [def.group] : null);
        const rows = wanted ? finishes.filter(r => wanted.includes(r.finish_group)) : finishes;
        out[key] = {
          label:   def.label || key,
          values:  rows.map(r => ({ id: r.id, label: r.label })),
          default: def.default || (rows.find(r => r.is_default) || rows[0] || {}).id || null
        };
      } else {
        out[key] = {
          label:   def.label || key,
          values:  (def.values || []).map(v => ({ id: v, label: v })),
          default: def.default || (def.values || [])[0] || null
        };
      }
    }
    return out;
  };

  // ── Ports + Schematic helpers (v2.5.0 — Library v1.16.0 R101) ─────────────
  //
  // Library is the SSOT for "what does this device connect to and how".
  // These helpers wrap the canonical metadata.ports[] shape (defined in
  // APP - Library/CONNECTIONS-PLAN.md) and the engine-neutral
  // v_library_schematic view.
  //
  // Kind → table mapping for ports helpers.
  const _PORTS_TABLE_FOR_KIND = {
    lighting:         'pm_lighting_control_types',
    lighting_control: 'pm_lighting_control_types',
    rack:             'device_catalogue',
    device:           'device_catalogue',
    block:            'sonor_blocks',
  };
  const _PORTS_ID_FOR_KIND = {
    lighting:         'id',
    lighting_control: 'id',
    rack:             'model_id',
    device:           'model_id',
    block:            'block_code',
  };

  SL.getPortsMeta = async function (kind, id) {
    const table  = _PORTS_TABLE_FOR_KIND[kind];
    const idCol  = _PORTS_ID_FOR_KIND[kind];
    if (!table || !idCol) throw new Error(`getPortsMeta: unknown kind '${kind}'`);
    _ensureInit();
    if (!state.client) throw new Error('getPortsMeta: Supabase client not initialised');
    const { data, error } = await state.client.from(table).select('metadata').eq(idCol, id).maybeSingle();
    if (error) throw error;
    const meta = (data && data.metadata) || {};
    return {
      ports:         Array.isArray(meta.ports) ? meta.ports : [],
      _needs_review: !!meta._needs_review,
      metadata:      meta,
    };
  };

  // savePortsMeta(kind, id, ports) — writes metadata.ports only.
  //
  // LIMITATION: this function only saves metadata.ports[]. It does NOT
  // write metadata.schematic.* (capability flags: hasPower, poePowered,
  // hasNetwork, hasWifi, hasPowerOutputs, etc.). When capability flags
  // must be saved alongside ports in the same write (e.g. from Library's
  // Ports panel via _portsState.caps), callers MUST do a full direct
  // db.update({ metadata: newMeta }) instead of going through this helper.
  // See _savePorts() in sonor-library.html for the reference implementation.
  SL.savePortsMeta = async function (kind, id, ports) {
    const table  = _PORTS_TABLE_FOR_KIND[kind];
    const idCol  = _PORTS_ID_FOR_KIND[kind];
    if (!table || !idCol) throw new Error(`savePortsMeta: unknown kind '${kind}'`);
    _ensureInit();
    if (!state.client) throw new Error('savePortsMeta: Supabase client not initialised');
    // Read-modify-write: preserve other metadata keys around ports[].
    const { data: existing, error: readErr } = await state.client.from(table).select('metadata').eq(idCol, id).maybeSingle();
    if (readErr) throw readErr;
    const newMeta = Object.assign({}, (existing && existing.metadata) || {}, { ports: Array.isArray(ports) ? ports : [] });
    // v3.7.0 (B-409) — zero-row update = loud error, same guard as SL.save /
    // saveDeviceCatalogue. .update().eq() matching no row returns ok silently.
    const wres = await state.client.from(table).update({ metadata: newMeta }).eq(idCol, id).select(idCol);
    if (wres.error) throw wres.error;
    if (!Array.isArray(wres.data) || wres.data.length === 0) {
      throw new Error(`savePortsMeta: ${idCol} "${id}" not found in ${table} — nothing written`);
    }
  };

  SL.markVerified = async function (kind, id) {
    const table  = _PORTS_TABLE_FOR_KIND[kind];
    const idCol  = _PORTS_ID_FOR_KIND[kind];
    if (!table || !idCol) throw new Error(`markVerified: unknown kind '${kind}'`);
    _ensureInit();
    if (!state.client) throw new Error('markVerified: Supabase client not initialised');
    const { data: existing, error: readErr } = await state.client.from(table).select('metadata').eq(idCol, id).maybeSingle();
    if (readErr) throw readErr;
    const meta = Object.assign({}, (existing && existing.metadata) || {});
    delete meta._needs_review;
    // v3.7.0 (B-409) — zero-row guard (see savePortsMeta).
    const wres = await state.client.from(table).update({ metadata: meta }).eq(idCol, id).select(idCol);
    if (wres.error) throw wres.error;
    if (!Array.isArray(wres.data) || wres.data.length === 0) {
      throw new Error(`markVerified: ${idCol} "${id}" not found in ${table} — nothing written`);
    }
  };

  // Connection patterns (v2.6.0 — Library v1.18.0 R105).
  // Phase 2 of CONNECTIONS-PLAN.md. Returns the typical wiring patterns
  // for one or both endpoints of a connection.
  //
  // Opts:
  //   from_kind, from_id, from_port  — match the source endpoint
  //   to_kind,   to_id,   to_port    — match the target endpoint
  //   typical (bool)                  — restrict to typical=true (default true)
  //   includeInactive (bool)          — include active=false rows
  //
  // Any combination of filters is allowed. Empty opts = all active typical
  // patterns (use sparingly — could be a large set).
  SL.getConnectionPatterns = async function (opts) {
    opts = opts || {};
    _ensureInit();
    if (!state.client) throw new Error('getConnectionPatterns: Supabase client not initialised');
    let q = state.client.from('sonor_connection_patterns').select('*');
    if (opts.from_kind) q = q.eq('from_kind', opts.from_kind);
    if (opts.from_id)   q = q.eq('from_id',   opts.from_id);
    if (opts.from_port) q = q.eq('from_port', opts.from_port);
    if (opts.to_kind)   q = q.eq('to_kind',   opts.to_kind);
    if (opts.to_id)     q = q.eq('to_id',     opts.to_id);
    if (opts.to_port)   q = q.eq('to_port',   opts.to_port);
    if (opts.typical !== false) q = q.eq('typical', true);
    if (!opts.includeInactive)  q = q.eq('active',  true);
    q = q.order('typical', { ascending: false }).order('from_port');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  // Write a connection pattern — insert if no id, update if id present.
  // Engine-neutral. Consumer apps (Engineering, Cinema Design) and the
  // Library's own pattern editor share this single write path so the
  // unique constraint + RLS + soft-delete semantics are honoured.
  //
  // Pattern shape:
  //   { id?, from_kind, from_id, from_port, to_kind, to_id, to_port,
  //     cable?, cable_qty?, typical?, bidirectional?, notes?, active? }
  //
  // Returns the saved row (with id + timestamps).
  SL.savePattern = async function (pattern) {
    if (!pattern || !pattern.from_kind || !pattern.from_id || !pattern.from_port ||
                    !pattern.to_kind   || !pattern.to_id   || !pattern.to_port) {
      throw new Error('savePattern: requires from_kind/from_id/from_port/to_kind/to_id/to_port');
    }
    _ensureInit();
    if (!state.client) throw new Error('savePattern: Supabase client not initialised');
    // Build a clean payload — drop undefined keys so DB defaults apply.
    const payload = {};
    ['from_kind','from_id','from_port','to_kind','to_id','to_port',
     'cable','cable_qty','typical','bidirectional','notes','active'].forEach(k => {
      if (pattern[k] !== undefined) payload[k] = pattern[k];
    });
    if (pattern.id) {
      const { data, error } = await state.client.from('sonor_connection_patterns')
        .update(payload).eq('id', pattern.id).select().maybeSingle();
      if (error) throw error;
      // v3.7.0 (B-409) — maybeSingle() returns null when the id matched no
      // row, which looked exactly like a successful update.
      if (!data) throw new Error(`savePattern: id "${pattern.id}" not found — nothing written`);
      return data;
    } else {
      // Use UPSERT on the unique constraint so a re-add of an existing
      // pairing updates the existing row instead of erroring out.
      const { data, error } = await state.client.from('sonor_connection_patterns')
        .upsert(payload, {
          onConflict: 'from_kind,from_id,from_port,to_kind,to_id,to_port'
        }).select().maybeSingle();
      if (error) throw error;
      return data;
    }
  };

  // Soft-delete a connection pattern (active=false). No DELETE per
  // global Sonor DB law. Pass {id} or the full from→to identity.
  SL.deletePattern = async function (idOrIdentity) {
    _ensureInit();
    if (!state.client) throw new Error('deletePattern: Supabase client not initialised');
    let q = state.client.from('sonor_connection_patterns').update({ active: false });
    if (typeof idOrIdentity === 'string') {
      q = q.eq('id', idOrIdentity);
    } else if (idOrIdentity && idOrIdentity.id) {
      q = q.eq('id', idOrIdentity.id);
    } else if (idOrIdentity) {
      const p = idOrIdentity;
      q = q.eq('from_kind', p.from_kind).eq('from_id', p.from_id).eq('from_port', p.from_port)
            .eq('to_kind',   p.to_kind  ).eq('to_id',   p.to_id  ).eq('to_port',   p.to_port  );
    } else {
      throw new Error('deletePattern: requires id or identity');
    }
    const { error } = await q;
    if (error) throw error;
  };

  // Validate a proposed connection against the typical patterns library.
  // Returns { matches_pattern, suggested_cable, pattern, warnings[] } so
  // consumer apps (Engineering app, Cinema Design) can show "✓ matches
  // Sonor pattern" / "⚠ atypical pairing" hints when users draw cables.
  SL.validateConnection = async function (conn) {
    if (!conn || !conn.from_kind || !conn.from_id || !conn.from_port ||
                  !conn.to_kind   || !conn.to_id   || !conn.to_port) {
      throw new Error('validateConnection: requires {from_kind,from_id,from_port,to_kind,to_id,to_port}');
    }
    _ensureInit();
    if (!state.client) throw new Error('validateConnection: Supabase client not initialised');
    // Try direct match first (from→to).
    let { data, error } = await state.client.from('sonor_connection_patterns').select('*')
      .eq('from_kind', conn.from_kind).eq('from_id', conn.from_id).eq('from_port', conn.from_port)
      .eq('to_kind',   conn.to_kind  ).eq('to_id',   conn.to_id  ).eq('to_port',   conn.to_port  )
      .eq('active', true).limit(1);
    if (error) throw error;
    let pattern = (data || [])[0] || null;
    let warnings = [];
    // If no direct match, try the bidirectional reverse.
    if (!pattern) {
      const r = await state.client.from('sonor_connection_patterns').select('*')
        .eq('from_kind', conn.to_kind  ).eq('from_id', conn.to_id  ).eq('from_port', conn.to_port  )
        .eq('to_kind',   conn.from_kind).eq('to_id',   conn.from_id).eq('to_port',   conn.from_port)
        .eq('active', true).eq('bidirectional', true).limit(1);
      if (r.error) throw r.error;
      pattern = (r.data || [])[0] || null;
      if (pattern) warnings.push('Matched via bidirectional reverse');
    }
    if (!pattern) warnings.push('No typical pattern — verify cable + ports');
    return {
      matches_pattern: !!pattern,
      suggested_cable: pattern && pattern.cable,
      pattern: pattern || null,
      warnings: warnings
    };
  };

  // v2.9.0 — Schematic category registry (Library v1.22.3 R120).
  // Returns every active schematic category with its typical signal
  // in/out defaults. Use for category dropdowns + "Suggest from
  // category" pre-fill flows in consumer-app UIs.
  SL.getSchematicCategories = async function (opts) {
    opts = opts || {};
    _ensureInit();
    if (!state.client) throw new Error('getSchematicCategories: Supabase client not initialised');
    let q = state.client.from('sonor_schematic_categories').select('*');
    if (!opts.includeInactive) q = q.eq('active', true);
    q = q.order('sort_order').order('id');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  // v2.8.0 — Signal type registry (Library v1.22.0 R117). Returns
  // every active signal type, sorted by category + sort_order. Use
  // for chip pickers in consumer apps that surface signal_in_types
  // / signal_out_types editing. Each row carries a default_cable_id
  // hint so cable pickers can auto-suggest.
  SL.getSignalTypes = async function (opts) {
    opts = opts || {};
    _ensureInit();
    if (!state.client) throw new Error('getSignalTypes: Supabase client not initialised');
    let q = state.client.from('sonor_signal_types').select('*');
    if (!opts.includeInactive) q = q.eq('active', true);
    q = q.order('category').order('sort_order').order('id');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  // ── v3.9.0 — LABOUR seam ────────────────────────────────────────────────
  SL.LABOUR_PHASES = ['first_fix', 'second_fix', 'commission', 'programming'];
  SL.getSetting = async function (key, fallback) {
    _ensureInit();
    if (!state.client) return fallback;
    const { data, error } = await state.client.from('library_settings').select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    return data.value;
  };
  SL.setSetting = async function (key, value, updatedBy) {
    _ensureInit();
    if (!state.client) throw new Error('setSetting: Supabase client not initialised');
    const { error } = await state.client.from('library_settings').upsert({ key, value, updated_by: updatedBy || null, updated_at: new Date().toISOString() });
    if (error) throw error;
  };
  SL.getLabourTypes = async function (opts) {
    _ensureInit();
    if (!state.client) return [];
    let q = state.client.from('labour_types').select('*').order('sort_order');
    if (!(opts && opts.includeInactive)) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };
  // Pure: block row (any tier — metadata or block_metadata) → labour minutes per phase.
  // Cable-pull minutes are NOT included: read them from the first-fix package (expandPackage / install_mins).
  SL.labourFor = function (row) {
    const meta = (row && (row.metadata || row.block_metadata)) || {};
    const lab = meta.labour || {};
    const phases = {}; let block_mins = 0;
    SL.LABOUR_PHASES.forEach(p => { const n = Number(lab[p + '_mins']); phases[p] = (isFinite(n) && n > 0) ? n : 0; block_mins += phases[p]; });
    return { phases, block_mins, by: lab.by || 'sonor' };
  };

  // v3.1.0 (Library v1.34.0 R136) — port kind styles. Fetches pm_port_kind_styles
  // so consumer apps (Network Map, Takeoffs, Cinema Design) can override the hardcoded
  // PORT_KIND_DEFS colours + shapes at runtime. Library is the SSOT; consumers call
  // this once at boot and patch their local PORT_KIND_MAP.
  SL.getPortKindStyles = async function () {
    if (!state.client) throw new Error('getPortKindStyles: Supabase client not initialised');
    const { data, error } = await state.client
      .from('pm_port_kind_styles')
      .select('kind_id,label,glyph_shape,glyph_colour,sort_order,metadata')
      .order('sort_order');
    if (error) throw error;
    return data || [];
  };

  // v3.0.0 (Library v1.23.0 R121) — schematic context now returns the
  // STRUCTURED shape: schematic_power (jsonb), schematic_network (jsonb),
  // schematic_inputs (jsonb array of {type,qty}), schematic_outputs (same).
  // Legacy signal_in_types / signal_out_types arrays still returned for
  // backward compat (derived from inputs/outputs).
  //
  // Engine-neutral surface over v_library_schematic — re-point the view
  // and this helper still works.
  SL.getSchematicMeta = async function (blockCode) {
    if (!state.client) return null;
    const { data, error } = await state.client
      .from('v_library_schematic')
      .select('block_code,schematic_category,schematic_template_name,signal_in_types,signal_out_types,schematic_ready,schematic_confidence,schematic_notes,device_model_id,schematic_power,schematic_network,schematic_inputs,schematic_outputs,power_voltage,network_ethernet,network_poe_in,network_poe_out_qty,network_wan,network_wireless')
      .eq('block_code', blockCode)
      .maybeSingle();
    if (error) { console.warn('[SonorLibrary] getSchematicMeta:', error.message); return null; }
    return data || null;
  };
  // Packages — v_cable_packages aggregates package + lines, so callers
  // get the lines[] array materialised on each row without a second
  // fetch. expandPackage(pkgId) is still the right call when you need
  // the FULL materials list including JSONB end-groups.
  SL.getPackages = function (opts) {
    _ensureInit();
    // v1.13.4 R88 — was `throw Promise.reject(...)` which is nonsensical
    // (throw expects an Error, not a promise) and caused the call to
    // throw a Promise object that was then never resolved. The block
    // editor's Default Cable Package dropdown call to getPackages()
    // never reached .then() so the live optgroup was silently empty.
    if (!state.client) return Promise.reject(new Error('SonorLibrary.getPackages: no Supabase client'));
    let q = state.client.from('v_cable_packages').select('*');
    // v_cable_packages doesn't expose discontinued — filter on the
    // base cable_packages.discontinued via the view if needed later.
    return q.then(({ data, error }) => {
      if (error) throw error;
      return (data || []).map(r => ({
        ...r,
        lines: Array.isArray(r.lines) ? r.lines : (typeof r.lines === 'string' ? JSON.parse(r.lines) : [])
      }));
    });
  };
  // Devices / misc — non-rack gear was split off in v1.10.5 R58.
  SL.getDevices = function (opts) { return _fetchTable('device_catalogue', opts); };
  SL.getMisc    = function (opts) { return _fetchTable('misc_catalogue',   opts); };

  // ── v3.8.0 (CONSUMER-API §0/§20/§22/§25 → §26) — AV catalogue + block↔device seam ──
  // `av_catalogue` VIEW is THE canonical deduped product read surface (one row
  // per model_id, device_catalogue ⋈ misc_catalogue, metadata merged onto the
  // spec-family template, carries spec_family + source_tables). New consumers
  // read it — never the two base tables (duplicates + half-filled rows).
  SL.getAvCatalogue = function (opts) {
    opts = opts || {};
    if (!state.client) return Promise.reject(new Error('SonorLibrary.getAvCatalogue: no Supabase client'));
    if (state._avCache && !opts.force) return Promise.resolve(state._avCache.slice());
    let q = state.client.from('av_catalogue').select('*');
    if (!opts.includeDiscontinued) q = q.or('discontinued.is.null,discontinued.eq.false');
    return q.then(({ data, error }) => {
      if (error) throw error;
      state._avCache = data || [];
      return state._avCache.slice();
    });
  };

  // Device rename/clone-merge aliases (§25 — entity_type='device'). Same idiom
  // as getBlockAliases: cached old model_id → new model_id map.
  SL.getDeviceAliases = function (force) {
    if (state._devAliasMap && !force) return Promise.resolve(state._devAliasMap);
    if (!state.client) return Promise.resolve({});
    return state.client.from('sonor_catalogue_aliases')
      .select('old_id, new_id').eq('entity_type', 'device')
      .then(({ data, error }) => {
        if (error) return {};
        const map = {};
        (data || []).forEach(r => { if (r && r.old_id) map[r.old_id] = r.new_id; });
        state._devAliasMap = map;
        return map;
      })
      .catch(() => ({}));
  };
  SL.resolveDeviceId = async function (id) {
    if (!id) return id;
    const map = await SL.getDeviceAliases();
    let cur = String(id);
    const seen = {};
    for (let i = 0; i < 10; i++) {
      if (seen[cur]) break;
      seen[cur] = true;
      const next = map[cur];
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };

  // §22.2 + §22.4 match rule — the ONE offered-for-block predicate. Every
  // consumer MUST use this (or implement it identically):
  //   device.category ∈ block.device_categories
  //   ∧ (device_roles empty ∨ device untagged ∨ caps(device) ∩ device_roles ≠ ∅)
  //       caps(device) = [metadata.speaker_role] ∪ metadata.mount_type[]
  //   ∧ domain: service 01 ctx accepts cinema+both, 02 accepts smart_home+both,
  //     untagged devices always show. Other services: no domain constraint.
  SL.deviceMatchesBlock = function (dev, blockRow) {
    if (!dev || !blockRow) return false;
    const md = blockRow.block_metadata || blockRow.metadata || {};
    const cats = md.device_categories;
    if (!Array.isArray(cats) || !cats.length) return false;
    if (cats.indexOf(dev.category) === -1) return false;
    const roles = md.device_roles;
    if (Array.isArray(roles) && roles.length) {
      const dm = dev.metadata || {};
      let caps = [];
      if (dm.speaker_role) caps.push(String(dm.speaker_role));
      if (Array.isArray(dm.mount_type)) caps = caps.concat(dm.mount_type.map(String));
      else if (dm.mount_type) caps.push(String(dm.mount_type));
      if (caps.length && !caps.some(c => roles.indexOf(c) !== -1)) return false;
    }
    const nn = String(blockRow.service_nn || md.service_nn || '');
    const ctx = nn === '01' ? 'cinema' : (nn === '02' ? 'smart_home' : null);
    const dom = (dev.metadata && dev.metadata.domain) || null;
    if (ctx && dom && dom !== 'both' && dom !== ctx) return false;
    return true;
  };

  // v3.10.0 (2026-11-09) — SPEAKER CLASSIFICATION + PLACEMENT CHECK.
  // SSOT: library_settings.speaker_classification = { types:[{key,label,mount}],
  // uses:[{key,label}], external, location_rules:{outdoor_floor_codes,
  // outdoor_room_words, wet_room_words} }. Every speaker / sub / soundbar has
  //   metadata.speaker_role = TYPE (in_ceiling, in_wall, floorstanding …)
  //   metadata.domain       = USE  (cinema · smart_home = multiroom · both)
  //   metadata.external     = outdoor rated (adds 'outdoor' to mount_type[])
  // SQL twin: speaker_placement_issues(project) / v_speaker_placement_issues —
  // keep the two rule sets identical.
  SL.getSpeakerClassification = function (force) {
    if (state._spkClass && !force) return Promise.resolve(state._spkClass);
    if (!state.client) return Promise.resolve(null);
    return state.client.from('library_settings').select('value').eq('key', 'speaker_classification').maybeSingle()
      .then(({ data }) => { state._spkClass = (data && data.value) || null; return state._spkClass; })
      .catch(() => null);
  };
  SL.speakerTypeLabel = function (key) {
    const t = ((state._spkClass && state._spkClass.types) || []).find(x => x.key === key);
    return t ? t.label : (key ? String(key).replace(/_/g, ' ') : '');
  };
  SL.speakerUseLabel = function (key) {
    const u = ((state._spkClass && state._spkClass.uses) || []).find(x => x.key === key);
    return u ? u.label : (key || '');
  };
  // ctx = { floorCode, roomName, outdoor?:bool, wet?:bool } — outdoor / wet are
  // worked out from the shared location_rules when not given. Returns
  // [{ severity:'error'|'warning', issue, message }] — empty = fine.
  SL.locationFlags = function (ctx) {
    ctx = ctx || {};
    const r = (state._spkClass && state._spkClass.location_rules) || {};
    const room = String(ctx.roomName || '').toLowerCase();
    const fc = String(ctx.floorCode || '').toUpperCase();
    const outdoor = ctx.outdoor != null ? !!ctx.outdoor
      : ((r.outdoor_floor_codes || []).indexOf(fc) !== -1 || (r.outdoor_room_words || []).some(w => room.indexOf(w) !== -1));
    const wet = ctx.wet != null ? !!ctx.wet
      : (r.wet_room_words || []).some(w => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(room));
    return { outdoor, wet };
  };
  SL.checkPlacement = function (dev, blockRow, ctx) {
    const out = [];
    if (!blockRow) return out;
    const md = blockRow.block_metadata || blockRow.metadata || {};
    const cats = Array.isArray(md.device_categories) ? md.device_categories : [];
    const audio = cats.some(c => c === 'speaker' || c === 'subwoofer' || c === 'soundbar');
    if (!dev) { if (audio) out.push({ severity: 'error', issue: 'no_device', message: 'No device chosen and the block has no default' }); return out; }
    const dm = dev.metadata || {};
    const name = ((dev.make || '') + ' ' + (dev.model || dev.model_id || '')).trim();
    if (cats.length && cats.indexOf(dev.category) === -1)
      out.push({ severity: 'error', issue: 'wrong_category', message: name + ' is a ' + dev.category + ' — this block takes ' + cats.join(' / ') });
    const roles = Array.isArray(md.device_roles) ? md.device_roles : [];
    let caps = [];
    if (dm.speaker_role) caps.push(String(dm.speaker_role));
    if (Array.isArray(dm.mount_type)) caps = caps.concat(dm.mount_type.map(String));
    if (roles.length && caps.length && !caps.some(c => roles.indexOf(c) !== -1))
      out.push({ severity: 'error', issue: 'wrong_type', message: name + ' is ' + SL.speakerTypeLabel(dm.speaker_role) + ' — this block takes ' + roles.map(SL.speakerTypeLabel).join(' / ') });
    if (audio) {
      const loc = SL.locationFlags(ctx);
      const ext = dm.external === true || dm.external === 'true';
      if (loc.outdoor && !ext)
        out.push({ severity: 'error', issue: 'not_external', message: name + ' is not outdoor rated but sits outside' + (ctx && ctx.roomName ? ' (' + ctx.roomName + ')' : '') });
      else if (loc.wet && !ext)
        out.push({ severity: 'warning', issue: 'wet_room', message: name + ' is not moisture / outdoor rated — ' + ((ctx && ctx.roomName) || 'this room') + ' is a wet area' });
      const nn = String(blockRow.service_nn || md.service_nn || '');
      const want = nn === '01' ? 'cinema' : (nn === '02' ? 'smart_home' : null);
      if (want && (dm.domain === 'cinema' || dm.domain === 'smart_home') && dm.domain !== want)
        out.push({ severity: 'warning', issue: 'wrong_use', message: name + ' is tagged ' + SL.speakerUseLabel(dm.domain) + ' — this is a ' + SL.speakerUseLabel(want) + ' block' });
    }
    return out;
  };

  // §22 render source: curated device_options[] (alias-resolved), FALLBACK to
  // the full candidate sweep when empty. Default (device_model_id) is always
  // an implicit member. Returns { options:[row], default, source }.
  SL.getDeviceOptionsForBlock = async function (blockRow, opts) {
    if (!blockRow) return { options: [], default: null, source: 'none' };
    const md = blockRow.block_metadata || blockRow.metadata || {};
    const [av] = await Promise.all([SL.getAvCatalogue(opts), SL.getDeviceAliases()]);
    const byId = {};
    av.forEach(r => { byId[r.model_id] = r; });
    const canon = async (id) => SL.resolveDeviceId(id);
    const def = blockRow.device_model_id ? await canon(blockRow.device_model_id) : null;
    let ids = Array.isArray(md.device_options) ? await Promise.all(md.device_options.map(canon)) : [];
    let source = 'options';
    if (!ids.length) {
      source = 'candidates';
      ids = av.filter(d => SL.deviceMatchesBlock(d, blockRow)).map(d => d.model_id);
    }
    if (def && ids.indexOf(def) === -1) ids.unshift(def);
    const seen = {};
    const options = [];
    ids.forEach(id => {
      if (!id || seen[id]) return;
      seen[id] = true;
      options.push(byId[id] || { model_id: id, make: '', model: id, _missing: true });
    });
    await SL.getSpeakerClassification();
    options.forEach(o => { if (!o._missing) { const iss = SL.checkPlacement(o, blockRow, (opts && opts.ctx) || { outdoor: false, wet: false }); if (iss.length) o._issues = iss; } });
    options.sort((a, b) => String(a.make || '').localeCompare(String(b.make || ''))
      || String(a.model || '').localeCompare(String(b.model || '')));
    return { options, default: def, source };
  };

  // §20 — product accessories (mounts/stands/grilles/…) for a parent model.
  // One cached fetch of the whole enabled table (small), filtered client-side.
  SL.getAllProductAccessories = function (opts) {
    opts = opts || {};
    if (state._accCache && !opts.force) return Promise.resolve(state._accCache.slice());
    if (!state.client) return Promise.reject(new Error('SonorLibrary.getAllProductAccessories: no Supabase client'));
    let q = state.client.from('product_accessories').select('*');
    if (!opts.includeInactive) q = q.eq('enabled', true);
    return q.order('kind').order('sort_order').then(({ data, error }) => {
      if (error) throw error;
      state._accCache = data || [];
      return state._accCache.slice();
    });
  };
  SL.getProductAccessories = async function (modelId, opts) {
    if (!modelId) return [];
    const id = await SL.resolveDeviceId(modelId);
    const all = await SL.getAllProductAccessories(opts);
    return all.filter(a => Array.isArray(a.compatible_model_ids)
      && a.compatible_model_ids.indexOf(id) !== -1);
  };

  // ── B-246 / R76 — Unified alias resolution ─────────────────────────────
  // SL.resolveId(kind, id) walks the sonor_catalogue_aliases table to find
  // the current id for a (kind, id) pair that may have been renamed.
  //
  // kind ∈ { 'block', 'cable', 'backbox', 'faceplate', 'package', 'device', 'misc' }
  // Returns: Promise<string> — the resolved id, or the input id if no
  // alias exists. Never throws on miss; throws only on db error.
  //
  // Used by consumer apps that store catalogue ids in their own tables
  // (PM project devices, packs configs, takeoff revisions). After a rename
  // via Library's Rename ID button, resolveId('cable', oldId) returns
  // newId so the consumer can update its reference transparently.
  //
  // Walks chains — if A → B → C, resolveId('cable', 'A') returns 'C'.
  // Detects cycles via a visited set (defensive — shouldn't happen in
  // practice but a corrupt aliases table won't hang the app).
  SL.resolveId = async function (kind, id) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.resolveId: no Supabase client');
    if (!kind || !id)  return id;
    let current = String(id);
    const seen  = new Set([current]);
    for (let i = 0; i < 10; i++) {                 // hard cap; no infinite loops
      const { data, error } = await state.client
        .from('sonor_catalogue_aliases')
        .select('new_id')
        .eq('entity_type', kind)
        .eq('old_id', current)
        .maybeSingle();
      if (error) {
        if (error.code === 'PGRST116') return current;   // table missing → no resolution
        throw error;
      }
      if (!data || !data.new_id) return current;        // no alias for this id → resolved
      if (seen.has(data.new_id))   return current;      // cycle guard → bail
      seen.add(data.new_id);
      current = data.new_id;
    }
    return current;
  };

  // ── v1.12.3 R80 — Cross-table FK validation helper ─────────────────────
  // Consumer apps that persist catalogue ids (PM cable schedules, Packs
  // rack configs, Takeoffs floor plan symbols) need to ask "are these N
  // stored ids still alive?" in one round-trip. Polling every id one at a
  // time hits the rate-limit on a busy project page.
  //
  // SonorLibrary.validateIds(refs) where refs = [{ kind, id }, ...]
  //
  // Returns: Promise<Array<{
  //   kind,
  //   id,                 // input id (unchanged)
  //   ok,                 // true if found (directly or via alias)
  //   current_id,         // current id — may differ from input if renamed
  //   alias_hit           // true if resolved via sonor_catalogue_aliases
  // }>>
  //
  // Strategy: group refs by kind, fire one IN-list query per kind for the
  // base lookup, then a single batched alias query for the misses. Returns
  // results in the same order as the input.
  //
  // Recommended call pattern in a consumer app:
  //   const refs = project.cable_lines.map(l => ({ kind: 'cable', id: l.cable_id }));
  //   const res  = await SonorLibrary.validateIds(refs);
  //   const stale = res.filter(r => r.alias_hit);
  //   stale.forEach(r => { /* update consumer-side storage to r.current_id */ });
  //   const broken = res.filter(r => !r.ok);
  //   if (broken.length) console.warn('Broken refs:', broken);
  const VALIDATE_TABLE_FOR_KIND = {
    'block':     { table: 'sonor_blocks',       idCol: 'block_code' },
    'cable':     { table: 'pm_cable_types',     idCol: 'id' },
    'backbox':   { table: 'pm_backbox_types',   idCol: 'id' },
    'faceplate': { table: 'pm_faceplate_types', idCol: 'id' },
    'package':   { table: 'cable_packages',     idCol: 'id' },
    'device':    { table: 'device_catalogue',   idCol: 'model_id' },
    'misc':      { table: 'misc_catalogue',     idCol: 'model_id' }
  };

  SL.validateIds = async function (refs) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.validateIds: no Supabase client');
    if (!Array.isArray(refs) || refs.length === 0) return [];

    // Group input by kind for batch lookup.
    const byKind = new Map();
    refs.forEach(r => {
      if (!r || !r.kind || !r.id) return;
      if (!byKind.has(r.kind)) byKind.set(r.kind, new Set());
      byKind.get(r.kind).add(String(r.id));
    });

    // One round-trip per kind for direct hits.
    const directHits = new Map();   // 'kind|id' → true
    await Promise.all([...byKind.entries()].map(async ([kind, idSet]) => {
      const cfg = VALIDATE_TABLE_FOR_KIND[kind];
      if (!cfg) return;
      const ids = [...idSet];
      const { data, error } = await state.client.from(cfg.table)
        .select(cfg.idCol)
        .in(cfg.idCol, ids);
      if (error) throw error;
      (data || []).forEach(r => directHits.set(kind + '|' + r[cfg.idCol], true));
    }));

    // Misses → one batched alias query covering every (kind, id) miss.
    const misses = refs.filter(r =>
      r && r.kind && r.id && !directHits.has(r.kind + '|' + r.id) && VALIDATE_TABLE_FOR_KIND[r.kind]
    );
    const aliasResolved = new Map();    // 'kind|input_id' → current_id

    if (misses.length) {
      // sonor_catalogue_aliases has a composite key (entity_type, old_id).
      // Supabase doesn't accept a paired-IN filter directly, so we OR the
      // (kind, id) tuples. v1.13.2 R86 — chunked at 50 per request to
      // stay well under Supabase's URL length limit (≈16KB); a PM
      // project with hundreds of stale refs would otherwise build a
      // single OR-filter that could be truncated mid-clause.
      const CHUNK = 50;
      for (let i = 0; i < misses.length; i += CHUNK) {
        const slice = misses.slice(i, i + CHUNK);
        const orFilter = slice.map(r =>
          `and(entity_type.eq.${r.kind},old_id.eq.${r.id})`
        ).join(',');
        const { data, error } = await state.client.from('sonor_catalogue_aliases')
          .select('entity_type,old_id,new_id')
          .or(orFilter);
        if (error && error.code !== 'PGRST116') throw error;
        (data || []).forEach(a => aliasResolved.set(a.entity_type + '|' + a.old_id, a.new_id));
      }

      // Second pass: alias targets (new_ids) that weren't in the original
      // direct-lookup batch need their own existence check, otherwise
      // ok=true via alias would be a lie when the target row was itself
      // deleted. Group resolved new_ids by kind, fire one query per kind.
      const targetsByKind = new Map();
      aliasResolved.forEach((newId, key) => {
        const kind = key.split('|')[0];
        if (!directHits.has(kind + '|' + newId)) {
          if (!targetsByKind.has(kind)) targetsByKind.set(kind, new Set());
          targetsByKind.get(kind).add(newId);
        }
      });
      await Promise.all([...targetsByKind.entries()].map(async ([kind, idSet]) => {
        const cfg = VALIDATE_TABLE_FOR_KIND[kind];
        if (!cfg) return;
        const { data: trgData, error: trgErr } = await state.client.from(cfg.table)
          .select(cfg.idCol)
          .in(cfg.idCol, [...idSet]);
        if (trgErr) throw trgErr;
        (trgData || []).forEach(r => directHits.set(kind + '|' + r[cfg.idCol], true));
      }));
    }

    // Build result in input order, preserving duplicates.
    return refs.map(r => {
      if (!r || !r.kind || !r.id || !VALIDATE_TABLE_FOR_KIND[r.kind]) {
        return { kind: r && r.kind, id: r && r.id, ok: false, current_id: null, alias_hit: false };
      }
      const key = r.kind + '|' + r.id;
      if (directHits.has(key)) {
        return { kind: r.kind, id: r.id, ok: true, current_id: r.id, alias_hit: false };
      }
      if (aliasResolved.has(key)) {
        const newId = aliasResolved.get(key);
        // Was the alias target itself a direct hit? If yes → ok via alias.
        // If no → mark not-ok (alias points to a removed row — edge case).
        const aliasKey = r.kind + '|' + newId;
        return { kind: r.kind, id: r.id, ok: directHits.has(aliasKey), current_id: newId, alias_hit: true };
      }
      return { kind: r.kind, id: r.id, ok: false, current_id: null, alias_hit: false };
    });
  };

  // ── B-247 / R77 — v_sonor_library_full (consolidated catalogue) ────────
  // Fetches the UNIONed Supabase view that exposes every catalogue row
  // (blocks + cables + packages + backboxes + faceplates + devices +
  // misc) with a `kind` discriminator and a common projection
  // (id, name, category, sku, service_nn). One fetch instead of seven
  // for any app doing global search / SKU lookup / cross-kind UI.
  //
  // opts.kinds — optional array of strings to filter the result by kind
  // (e.g. { kinds: ['cable', 'package'] }).
  // opts.includeInactive — defaults to false.
  SL.getFull = function (opts) {
    _ensureInit();
    if (!state.client) return Promise.reject(new Error('SonorLibrary.getFull: no Supabase client'));
    opts = opts || {};
    let q = state.client.from('v_sonor_library_full').select('*');
    if (Array.isArray(opts.kinds) && opts.kinds.length) q = q.in('kind', opts.kinds);
    if (!opts.includeInactive) q = q.eq('active', true);
    return q.then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    });
  };

  // ── v1.12.5 R82 — describeKind (Tier 3 #2) ─────────────────────────────
  // Schema introspection helper. Returns the column list + types for a
  // given catalogue kind so consumer apps can build generic editors,
  // CSV importers, form generators, validation, etc. without hardcoding
  // column names. Backed by the sonor_describe_kind(kind) Postgres
  // function (SECURITY DEFINER, granted to anon).
  //
  // Returns: Promise<{
  //   kind:    string,
  //   table:   string,                       // resolved Supabase table name
  //   columns: Array<{
  //     name:     string,
  //     type:     string,                    // postgres data_type
  //     nullable: boolean,
  //     default:  string | null,             // pg default expression
  //     ordinal:  integer                    // declared order
  //   }>
  // }>
  //
  // Unknown kind → returns { kind, table: null, columns: [] }.
  const DESCRIBE_TABLE_FOR_KIND = {
    block:     'sonor_blocks',
    cable:     'pm_cable_types',
    backbox:   'pm_backbox_types',
    faceplate: 'pm_faceplate_types',
    package:   'cable_packages',
    device:    'device_catalogue',
    misc:      'misc_catalogue'
  };
  SL.describeKind = async function (kind) {
    _ensureInit();
    if (!state.client) throw new Error('SonorLibrary.describeKind: no Supabase client');
    if (!kind) throw new Error('SonorLibrary.describeKind: kind is required');
    const { data, error } = await state.client.rpc('sonor_describe_kind', { p_kind: kind });
    if (error) throw error;
    const cols = (data || []).map(r => ({
      name:     r.column_name,
      type:     r.data_type,
      nullable: r.is_nullable === 'YES',
      default:  r.column_default,
      ordinal:  r.ordinal_position
    }));
    return {
      kind,
      table:   DESCRIBE_TABLE_FOR_KIND[kind] || null,
      columns: cols
    };
  };

  // ── v1.12.4 R81 — exportSnapshot (Tier 3 #1) ───────────────────────────
  // Bundled point-in-time catalogue dump for build pipelines, external
  // tooling, DR proofs, snapshot tests. Pure read — no side effects, no
  // db writes, no localStorage updates. Same active-only filter as the
  // get<Kind>() accessors unless { includeInactive: true }.
  //
  // opts.kinds — optional Array<string> to limit which kinds are bundled.
  //              Default: every kind exposed by the consumer API.
  // Returns: Promise<{
  //   generated_at:    ISO string,
  //   library_version: window.SONOR_LIBRARY_VERSION,
  //   kinds: {
  //     block: [...],
  //     cable: [...],
  //     ...
  //   }
  // }>
  //
  // Note: blocks come from the in-memory state.allRows cache (already
  // hydrated by SL.load()). Every other kind goes through the matching
  // get<Kind>() accessor — one round-trip per kind in parallel.
  SL.exportSnapshot = async function (opts) {
    opts = opts || {};
    const ALL_KINDS = ['block', 'cable', 'package', 'backbox', 'faceplate', 'device', 'misc', 'lighting_control'];
    const kinds = Array.isArray(opts.kinds) && opts.kinds.length
      ? opts.kinds.filter(k => ALL_KINDS.indexOf(k) >= 0)
      : ALL_KINDS;
    const passthrough = { includeInactive: !!opts.includeInactive };

    const fetchers = {
      block:     () => Promise.resolve(state.allRows.slice()),
      cable:     () => SL.getCables(passthrough),
      package:   () => SL.getPackages(passthrough),
      backbox:   () => SL.getBackboxes(passthrough),
      faceplate: () => SL.getFaceplates(passthrough),
      device:    () => SL.getDevices(passthrough),
      misc:      () => SL.getMisc(passthrough),
      lighting_control: () => SL.getLightingControl(passthrough)
    };

    const results = await Promise.all(kinds.map(k => fetchers[k]().then(rows => [k, rows])));
    const bundle = {
      generated_at:    new Date().toISOString(),
      library_version: window.SONOR_LIBRARY_VERSION || null,
      kinds: {}
    };
    results.forEach(([kind, rows]) => { bundle.kinds[kind] = rows; });
    return bundle;
  };

})(window.SonorLibrary);
