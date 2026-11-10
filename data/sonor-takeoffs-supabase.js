/**
 * Sonor Takeoffs — Supabase persistence layer (canonical master)
 *
 * Workspace-shared module per Spine S-4.2. Edit at workspace root, then run
 *   bash sync-everything.sh
 * to propagate to APP - Takeoffs/data/.
 *
 * NEVER edit the per-app copy at APP - Takeoffs/data/sonor-takeoffs-supabase.js.
 *
 * Dependencies (must be loaded before this file):
 *   - @supabase/supabase-js v2 CDN (provides window.supabase.createClient)
 *
 * Exports: window.SonorTakeoffsSupabase. API:
 *   .init({ url, anon, client? }) → { ready: bool, client }
 *   .ready() → bool
 *   .getClient() → SupabaseClient | null
 *
 *   PROJECT METADATA
 *   .loadProjectViewDefaults(projectId)
 *   .saveProjectViewDefaults(projectId, defaults)
 *   .createProject(payload)
 *   .updateProject(projectId, payload)
 *
 *   PLAN REVISIONS (Supabase Storage + takeoffs_floor_plans table)
 *   .uploadPlanRevision({ projectId, floorId, source, filename, mime, ... })
 *   .listPlanRevisions(projectId, floorId)
 *   .signPlanUrl(storagePath, ttlSeconds)
 *   .loadActivePlanRevision(projectId, floorId)
 *   .setActivePlanRevision(projectId, floorId, revisionId)
 *
 *   PORTAL OVERLAYS (read-only consumer pattern)
 *   .loadPortalOverlays(projectId) → { snags, photos }
 *
 *   TAKEOFF REVISIONS (named project snapshots)
 *   .saveRevision({ projectId, label, snapshot, takeoffVersion, kind, counts })
 *   .fetchRevisions(projectId, limit?)
 *   .fetchRevisionById(revisionId)
 *   .markRevisionAsBuilt(revisionId, asBuilt)
 *   .fetchActiveAsBuiltRevision(projectId)
 *
 *   APP VERSION REPORTING
 *   .reportAppVersion({ appKey, version, name, repo })  → app_versions(app_key, version, app_name, repo)
 *
 * All methods are async (Promise<...>) and return either the data or a
 * documented shape on failure. Failures are logged via console.warn and
 * never throw — callers can rely on graceful degradation.
 *
 * Last extracted from sonor-takeoffs.html v2.4.4 → v2.5.0 (2026-04-28).
 */
(function() {
  'use strict';

  const PLANS_BUCKET = 'takeoffs-plans';
  const TAKEOFF_REV_FETCH_LIMIT = 200;

  let _client = null;
  let _ready = false;

  // -----------------------------------------------------------
  // Init
  // -----------------------------------------------------------
  function init(opts) {
    opts = opts || {};
    if (opts.client) {
      _client = opts.client;
      _ready = true;
      return { ready: true, client: _client };
    }
    if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient && opts.url && opts.anon) {
      try {
        _client = window.supabase.createClient(opts.url, opts.anon);
        _ready = true;
      } catch (e) {
        console.warn('[SonorTakeoffsSupabase] createClient failed:', e);
        _client = null;
        _ready = false;
      }
    }
    return { ready: _ready, client: _client };
  }

  function ready() { return _ready && !!_client; }
  function getClient() { return _client; }

  // -----------------------------------------------------------
  // Project metadata
  // -----------------------------------------------------------
  async function loadProjectViewDefaults(projectId) {
    if (!ready() || !projectId) return null;
    try {
      const { data, error } = await _client.from('projects')
        .select('metadata').eq('id', projectId).single();
      if (error) return null;
      return (data && data.metadata && data.metadata.viewing_defaults) || null;
    } catch (e) {
      console.warn('[SonorTakeoffsSupabase] loadProjectViewDefaults failed:', e);
      return null;
    }
  }

  async function saveProjectViewDefaults(projectId, defaults) {
    if (!ready() || !projectId) return { ok: false, reason: 'not-wired' };
    try {
      // 2026-10-17 — merge-only law: atomic server-side merge via the RPC; read-merge-write only if the RPC call fails.
      try {
        const { error: rpcErr } = await _client.rpc('sonor_merge_project_metadata', {
          p_project_id: projectId, p_patch: { viewing_defaults: defaults }
        });
        if (!rpcErr) return { ok: true };
      } catch (_) {}
      const { data: cur } = await _client.from('projects')
        .select('metadata').eq('id', projectId).single();
      const meta = (cur && cur.metadata && typeof cur.metadata === 'object') ? cur.metadata : {};
      meta.viewing_defaults = defaults;
      const { error } = await _client.from('projects')
        .update({ metadata: meta }).eq('id', projectId);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[SonorTakeoffsSupabase] saveProjectViewDefaults failed:', e);
      return { ok: false, error: e };
    }
  }

  async function createProject(payload) {
    if (!ready()) return { ok: false, reason: 'not-wired' };
    try {
      const { data, error } = await _client.from('projects')
        .insert(payload).select().single();
      if (error) throw error;
      return { ok: true, row: data };
    } catch (e) {
      console.warn('[SonorTakeoffsSupabase] createProject failed:', e);
      return { ok: false, error: e };
    }
  }

  async function updateProject(projectId, payload) {
    if (!ready() || !projectId) return { ok: false, reason: 'not-wired' };
    try {
      const { error } = await _client.from('projects')
        .update(payload).eq('id', projectId);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[SonorTakeoffsSupabase] updateProject failed:', e);
      return { ok: false, error: e };
    }
  }

  // -----------------------------------------------------------
  // Plan revisions (Supabase Storage + takeoffs_floor_plans)
  // -----------------------------------------------------------
  function _planStoragePath(projectId, floorId, revisionId, filename) {
    const safe = String(filename || 'plan').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    return `${projectId}/${floorId}/${revisionId}__${safe}`;
  }

  function _dataUrlToBlob(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    try {
      const [head, body] = dataUrl.split(',');
      const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
      const isB64 = /;base64/i.test(head);
      const bytes = isB64 ? atob(body) : decodeURIComponent(body);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      return new Blob([buf], { type: mime });
    } catch (e) { return null; }
  }

  async function uploadPlanRevision(opts) {
    if (!ready()) return { ok: false, reason: 'no-supabase' };
    opts = opts || {};
    const projectId = opts.projectId;
    const floorId = opts.floorId;
    if (!projectId || !floorId) return { ok: false, reason: 'no-project-or-floor' };

    const filename = opts.filename || 'plan';
    const mime = opts.mime || (opts.source && opts.source.type) || 'application/octet-stream';
    const pageCount = opts.pageCount || 1;
    const pageIndex = opts.pageIndex || 1;
    const label = opts.label || null;
    const notes = opts.notes || null;
    const uploadedBy = opts.uploadedBy || 'takeoffs';
    const carriedCount = Number.isFinite(opts.carriedCount) ? opts.carriedCount : 0;

    const revisionId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'rev-' + Math.random().toString(36).slice(2, 10);
    const path = _planStoragePath(projectId, floorId, revisionId, filename);

    let payload = opts.source;
    if (typeof payload === 'string') {
      payload = _dataUrlToBlob(payload);
      if (!payload) return { ok: false, reason: 'bad-source' };
    }
    if (!payload) return { ok: false, reason: 'no-source' };
    const byteSize = payload.size || null;

    try {
      const { error: upErr } = await _client.storage.from(PLANS_BUCKET).upload(path, payload, {
        cacheControl: '3600',
        upsert: false,
        contentType: mime
      });
      if (upErr) {
        console.warn('[SonorTakeoffsSupabase] storage upload failed:', upErr);
        return { ok: false, reason: 'storage-upload', error: upErr };
      }
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] storage upload threw:', err);
      return { ok: false, reason: 'storage-throw', error: err };
    }

    // Capture previous active revision id (for placements_carried_from_plan_id audit)
    let prevActiveId = null;
    try {
      const { data: prev } = await _client.from('takeoffs_floor_plans')
        .select('id')
        .eq('project_id', projectId)
        .eq('floor_id', floorId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      prevActiveId = (prev && prev.id) || null;
    } catch (e) { /* best-effort */ }

    // Mark every existing row inactive
    try {
      await _client.from('takeoffs_floor_plans')
        .update({ is_active: false })
        .eq('project_id', projectId)
        .eq('floor_id', floorId)
        .eq('is_active', true);
    } catch (e) { /* best-effort */ }

    // Insert the new revision row
    let revRow = null;
    try {
      const insertRow = {
        id: revisionId,
        project_id: projectId,
        floor_id: floorId,
        revision_label: label,
        filename: String(filename).slice(0, 200),
        mime_type: mime,
        page_count: pageCount,
        page_index: pageIndex,
        storage_path: path,
        byte_size: byteSize,
        notes: notes,
        is_active: true,
        uploaded_by: uploadedBy
      };
      if (prevActiveId && carriedCount > 0) {
        insertRow.placements_carried_from_plan_id = prevActiveId;
        insertRow.placements_carried_count = carriedCount;
        insertRow.placements_carried_at = new Date().toISOString();
      }
      const { data, error } = await _client.from('takeoffs_floor_plans')
        .insert(insertRow)
        .select()
        .single();
      if (error) throw error;
      revRow = data;
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] revision row insert failed:', err);
      return { ok: false, reason: 'row-insert', error: err };
    }

    let signedUrl = null;
    try {
      const { data, error } = await _client.storage.from(PLANS_BUCKET).createSignedUrl(path, 3600);
      if (!error && data && data.signedUrl) signedUrl = data.signedUrl;
    } catch (e) { /* best-effort */ }

    return { ok: true, revision: revRow, signedUrl };
  }

  async function listPlanRevisions(projectId, floorId) {
    if (!ready() || !projectId || !floorId) return { rows: [], ok: false };
    try {
      const { data, error } = await _client.from('takeoffs_floor_plans')
        .select('id, revision_label, filename, mime_type, page_count, page_index, storage_path, byte_size, notes, is_active, uploaded_by, created_at, placements_carried_from_plan_id, placements_carried_count, placements_carried_at')
        .eq('project_id', projectId)
        .eq('floor_id', floorId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { rows: data || [], ok: true };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] list revisions failed:', err);
      return { rows: [], ok: false, error: err };
    }
  }

  async function signPlanUrl(storagePath, ttlSeconds) {
    if (!ready() || !storagePath) return null;
    try {
      const { data, error } = await _client.storage.from(PLANS_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds || 3600);
      if (!error && data && data.signedUrl) return data.signedUrl;
    } catch (e) { /* fall through */ }
    return null;
  }

  async function loadActivePlanRevision(projectId, floorId) {
    if (!ready() || !projectId || !floorId) return null;
    try {
      const { data, error } = await _client.from('takeoffs_floor_plans')
        .select('id, storage_path, mime_type, filename, revision_label, page_count, page_index')
        .eq('project_id', projectId)
        .eq('floor_id', floorId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const url = await signPlanUrl(data.storage_path, 3600);
      return url ? Object.assign({}, data, { signedUrl: url }) : null;
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] load active plan failed:', err);
      return null;
    }
  }

  async function setActivePlanRevision(projectId, floorId, revisionId) {
    if (!ready() || !projectId || !floorId || !revisionId) return { ok: false };
    try {
      await _client.from('takeoffs_floor_plans')
        .update({ is_active: false })
        .eq('project_id', projectId)
        .eq('floor_id', floorId);
      const { data, error } = await _client.from('takeoffs_floor_plans')
        .update({ is_active: true })
        .eq('id', revisionId)
        .select('storage_path, mime_type, filename, revision_label')
        .single();
      if (error) throw error;
      const url = data ? await signPlanUrl(data.storage_path, 3600) : null;
      return { ok: true, row: data, signedUrl: url };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] set active failed:', err);
      return { ok: false, error: err };
    }
  }

  // -----------------------------------------------------------
  // Portal overlays (read-only)
  // -----------------------------------------------------------
  async function loadPortalOverlays(projectId) {
    if (!ready() || !projectId) return { snags: [], photos: [] };
    const [snagsRes, filesRes] = await Promise.allSettled([
      _client.from('portal_snags')
        .select('id, title, location, priority, status, type, due, ts_raised, raised_by, assignee, metadata, gps')
        .eq('project_id', projectId)
        .neq('status', 'closed')
        .order('ts_raised', { ascending: false }),
      _client.from('portal_files')
        .select('id, name, ext, by_person, ts, dropbox_path, metadata')
        .eq('project_id', projectId)
        .order('ts', { ascending: false })
    ]);
    // v5.272.0 — sample / test snags (metadata.is_sample, sonor-platform §28) are hidden here like every other app
    const snags = (snagsRes.status === 'fulfilled' && Array.isArray(snagsRes.value.data))
      ? snagsRes.value.data.filter(r => !(r && r.metadata && r.metadata.is_sample)) : [];
    const imgExts = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif']);
    const photos = (filesRes.status === 'fulfilled' && Array.isArray(filesRes.value.data))
      ? filesRes.value.data.filter(f => f && f.ext && imgExts.has(String(f.ext).toLowerCase()))
      : [];
    return { snags, photos };
  }

  // -----------------------------------------------------------
  // Takeoff revisions (named snapshots)
  // -----------------------------------------------------------
  async function saveRevision(opts) {
    if (!ready()) return { ok: false, reason: 'no-supa' };
    opts = opts || {};
    if (!opts.projectId) return { ok: false, reason: 'no-project' };
    const safeLabel = (opts.label || '').trim() || `Revision — ${new Date().toLocaleString('en-GB')}`;
    try {
      const { data, error } = await _client
        .from('takeoff_revisions')
        .insert({
          project_id: opts.projectId,
          label: safeLabel,
          snapshot: opts.snapshot || {},
          takeoff_version: opts.takeoffVersion || null,
          metadata: { counts: opts.counts || {}, kind: opts.kind || 'manual' }
        })
        .select('id, created_at')
        .single();
      if (error) throw error;
      return { ok: true, id: data && data.id, created_at: data && data.created_at, label: safeLabel };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] saveRevision failed:', err);
      return { ok: false, error: err };
    }
  }

  async function fetchRevisions(projectId, limit) {
    if (!ready() || !projectId) return { rows: [], ok: false };
    try {
      const { data, error } = await _client
        .from('takeoff_revisions')
        .select('id, label, takeoff_version, metadata, created_at, as_built, marked_as_built_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit || TAKEOFF_REV_FETCH_LIMIT);
      if (error) throw error;
      return { rows: data || [], ok: true };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] fetchRevisions failed:', err);
      return { rows: [], ok: false, error: err };
    }
  }

  async function fetchRevisionById(revisionId) {
    if (!ready() || !revisionId) return null;
    try {
      const { data, error } = await _client
        .from('takeoff_revisions')
        .select('id, label, snapshot, takeoff_version, created_at')
        .eq('id', revisionId)
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] fetchRevisionById failed:', err);
      return null;
    }
  }

  async function markRevisionAsBuilt(revisionId, asBuilt) {
    if (!ready() || !revisionId) return { ok: false, reason: 'no-supa' };
    try {
      const { data, error } = await _client
        .from('takeoff_revisions')
        .update({
          as_built: !!asBuilt,
          marked_as_built_at: asBuilt ? new Date().toISOString() : null
        })
        .eq('id', revisionId)
        .select('id, as_built, marked_as_built_at')
        .single();
      if (error) throw error;
      return { ok: true, row: data };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] markRevisionAsBuilt failed:', err);
      return { ok: false, error: err };
    }
  }

  async function fetchActiveAsBuiltRevision(projectId) {
    if (!ready() || !projectId) return null;
    try {
      const { data, error } = await _client
        .from('takeoff_revisions')
        .select('id, label, takeoff_version, marked_as_built_at, created_at')
        .eq('project_id', projectId)
        .eq('as_built', true)
        .order('marked_as_built_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] fetchActiveAsBuiltRevision failed:', err);
      return null;
    }
  }

  // -----------------------------------------------------------
  // App version reporting
  // -----------------------------------------------------------
  async function reportAppVersion(opts) {
    if (!ready()) return { ok: false, reason: 'not-wired' };
    opts = opts || {};
    if (!opts.appKey || !opts.version) return { ok: false, reason: 'no-key-or-version' };
    try {
      const { error } = await _client
        .from('app_versions')
        .upsert({
          app_key: opts.appKey,
          version: opts.version,
          app_name: opts.name || opts.appKey,   // 2026-09-30 db-schema-check: column is app_name (was `name` → upsert 400 for months)
          repo: opts.repo || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'app_key' });
      if (error) throw error;
      return { ok: true };
    } catch (err) {
      console.warn('[SonorTakeoffsSupabase] reportAppVersion failed:', err);
      return { ok: false, error: err };
    }
  }

  // -----------------------------------------------------------
  // Public API
  // -----------------------------------------------------------
  window.SonorTakeoffsSupabase = {
    init,
    ready,
    getClient,
    // project metadata
    loadProjectViewDefaults,
    saveProjectViewDefaults,
    createProject,
    updateProject,
    // plan revisions
    uploadPlanRevision,
    listPlanRevisions,
    signPlanUrl,
    loadActivePlanRevision,
    setActivePlanRevision,
    // portal overlays
    loadPortalOverlays,
    // takeoff revisions
    saveRevision,
    fetchRevisions,
    fetchRevisionById,
    markRevisionAsBuilt,
    fetchActiveAsBuiltRevision,
    // app version
    reportAppVersion,
    // constants exposed for callers that need them
    PLANS_BUCKET: PLANS_BUCKET
  };
})();
