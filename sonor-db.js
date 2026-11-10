// ═══════════════════════════════════════════════════════════
// sonor-db.js — Shared Supabase client for all Sonor apps
// ═══════════════════════════════════════════════════════════
//
// Usage (script tag):
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="../sonor-db.js"></script>
//   <script>
//     const db = new SonorDB();
//     const projects = await db.projects.list();
//   </script>
//
// Usage (ES module):
//   import { SonorDB } from './sonor-db.js';
//   const db = new SonorDB();
//
// ═══════════════════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────────────
// Replace these after creating your Supabase project
const SONOR_SUPABASE_URL  = 'https://ysmvklstkzodlocttspy.supabase.co';
const SONOR_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbXZrbHN0a3pvZGxvY3R0c3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc0OTMsImV4cCI6MjA4OTM0MzQ5M30.08kRS_dtbwz0rSYezNGMJHnOU_st8GKZseQPefcMEMc';

// ── SERVICE MAP (mirrors brand-core.xml) ────────────────
const SERVICES = {
  '01_cinema':         { nn:'01', brand:'Home Cinema',      client:'Cinema & Media',          core:'01 Cinema',         badge:'Cinema',    hex:'#8058a1' },
  '02_audio':          { nn:'02', brand:'Multiroom Audio',   client:'Multiroom Audio',         core:'02 Audio',          badge:'Audio',     hex:'#4bb9d3' },
  '03_video':          { nn:'03', brand:'TV Everywhere',     client:'TV & Video',              core:'03 Video',          badge:'Video',     hex:'#78ba57' },
  '04_lighting':       { nn:'04', brand:'Smart Lighting',    client:'Smart Lighting',          core:'04 Lighting',       badge:'Lighting',  hex:'#f5d05c' },
  '05_automation':     { nn:'05', brand:'Home Automation',   client:'Home Automation',         core:'05 Automation',     badge:'Automation',hex:'#e37c59' },
  '06_hvac':           { nn:'06', brand:'Climate',           client:'Climate',                 core:'06 HVAC',           badge:'Climate',   hex:'#ec6061' },
  '07_control':        { nn:'07', brand:'Control',           client:'Control',                 core:'07 Control',        badge:'Control',   hex:'#e67eb1' },
  '08_security':       { nn:'08', brand:'CCTV & Security',   client:'CCTV, Security & Access', core:'08 Security',       badge:'Security',  hex:'#ad9978' },
  '09_network':        { nn:'09', brand:'Whole Home WiFi',   client:'WiFi & Data',             core:'09 Network',        badge:'WiFi',      hex:'#b7b1a7' },
  '10_infrastructure': { nn:'10', brand:'Design & Cabling',  client:'Infrastructure',          core:'10 Infrastructure', badge:'Structure', hex:'#302f2e' },
};

// ── HELPER: Supabase init ───────────────────────────────
function _initClient() {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    return supabase.createClient(SONOR_SUPABASE_URL, SONOR_SUPABASE_ANON);
  }
  throw new Error('Supabase JS not loaded. Add: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>');
}

// ── MAIN CLASS ──────────────────────────────────────────
class SonorDB {
  constructor(url, anonKey) {
    this.url = url || SONOR_SUPABASE_URL;
    this.anon = anonKey || SONOR_SUPABASE_ANON;
    this.client = _initClient();
    this.SERVICES = SERVICES;
    // 2026-09-30 (sonor-platform §16/§18): register the live instance so kit modules (SonorSortable, SonorRackData…)
    // can find ONE Supabase client without every app wiring it by hand. Apps keep their own variable as before.
    try { SonorDB.current = this; if (typeof window !== 'undefined' && !window.sonorDb) window.sonorDb = this; } catch (_) {}

    // Sub-modules
    this.projects       = new ProjectsAPI(this.client);
    this.devices        = new DevicesAPI(this.client);
    this.connections    = new ConnectionsAPI(this.client);
    this.rooms          = new RoomsAPI(this.client);
    this.rams           = new RamsAPI(this.client);
    this.contacts       = new ContactsAPI(this.client);
    this.leads          = new LeadsAPI(this.client);
    this.tasks          = new TasksAPI(this.client);
    this.versions       = new VersionsAPI(this.client);
    this.brand          = new BrandAPI(this.client);
    this.costs          = new CostsAPI(this.client);
    this.staffRates     = new StaffRatesAPI(this.client);
    this.costCategories = new CostCategoriesAPI(this.client);
    this.creditCards    = new CreditCardsAPI(this.client);
  }

  // Convenience: get service info by id
  service(id) { return SERVICES[id] || null; }

  // Convenience: get hex colour for a service
  hex(id) { return SERVICES[id]?.hex || '#8B7D6B'; }

  // Health check
  async ping() {
    const { data, error } = await this.client.from('brand_config').select('key').limit(1);
    return !error;
  }
}


// ── PROJECTS ────────────────────────────────────────────
class ProjectsAPI {
  constructor(client) { this.c = client; }

  async list(opts = {}) {
    let q = this.c.from('projects').select('*');
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.service) q = q.contains('services', [opts.service]);
    q = q.order('updated_at', { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async get(id) {
    const { data, error } = await this.c.from('projects').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  async getByRef(ref) {
    const { data, error } = await this.c.from('projects').select('*').eq('ref', ref).single();
    if (error) throw error;
    return data;
  }

  async create(project) {
    const { data, error } = await this.c.from('projects').insert(project).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('projects').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.c.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  async summary() {
    const { data, error } = await this.c.from('v_project_summary').select('*');
    if (error) throw error;
    return data;
  }

  // Full project with devices, rooms, connections, rams, tasks
  async getFull(id) {
    const [project, devices, rooms, connections, rams, tasks] = await Promise.all([
      this.get(id),
      this.c.from('devices').select('*').eq('project_id', id).then(r => r.data),
      this.c.from('rooms').select('*').eq('project_id', id).then(r => r.data),
      this.c.from('connections').select('*').eq('project_id', id).then(r => r.data),
      this.c.from('rams_documents').select('*').eq('project_id', id).then(r => r.data),
      this.c.from('tasks').select('*').eq('project_id', id).order('sort_order').then(r => r.data),
    ]);
    return { ...project, devices, rooms, connections, rams, tasks };
  }
}


// ── DEVICES ─────────────────────────────────────────────
class DevicesAPI {
  constructor(client) { this.c = client; }

  async list(projectId, opts = {}) {
    let q = this.c.from('devices').select('*').eq('project_id', projectId);
    if (opts.service) q = q.eq('service', opts.service);
    if (opts.category) q = q.eq('category', opts.category);
    q = q.order('service').order('location');
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(device) {
    const { data, error } = await this.c.from('devices').insert(device).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('devices').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.c.from('devices').delete().eq('id', id);
    if (error) throw error;
  }

  async inventory() {
    const { data, error } = await this.c.from('v_device_inventory').select('*');
    if (error) throw error;
    return data;
  }
}


// ── CONNECTIONS ─────────────────────────────────────────
class ConnectionsAPI {
  constructor(client) { this.c = client; }

  async list(projectId) {
    const { data, error } = await this.c.from('connections').select('*').eq('project_id', projectId);
    if (error) throw error;
    return data;
  }

  async create(conn) {
    const { data, error } = await this.c.from('connections').insert(conn).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.c.from('connections').delete().eq('id', id);
    if (error) throw error;
  }
}


// ── ROOMS ───────────────────────────────────────────────
class RoomsAPI {
  constructor(client) { this.c = client; }

  async list(projectId) {
    const { data, error } = await this.c.from('rooms').select('*').eq('project_id', projectId).order('floor').order('name');
    if (error) throw error;
    return data;
  }

  async create(room) {
    const { data, error } = await this.c.from('rooms').insert(room).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('rooms').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.c.from('rooms').delete().eq('id', id);
    if (error) throw error;
  }
}


// ── RAMS ────────────────────────────────────────────────
class RamsAPI {
  constructor(client) { this.c = client; }

  async list(projectId) {
    let q = this.c.from('rams_documents').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    q = q.order('updated_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(doc) {
    const { data, error } = await this.c.from('rams_documents').insert(doc).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('rams_documents').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
}


// ── CONTACTS ────────────────────────────────────────────
class ContactsAPI {
  constructor(client) { this.c = client; }

  async list(opts = {}) {
    let q = this.c.from('contacts').select('*');
    if (opts.type) q = q.eq('type', opts.type);
    if (opts.search) q = q.or(`name.ilike.%${opts.search}%,company.ilike.%${opts.search}%`);
    q = q.order('updated_at', { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(contact) {
    const { data, error } = await this.c.from('contacts').insert(contact).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('contacts').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.c.from('contacts').delete().eq('id', id);
    if (error) throw error;
  }
}


// ── LEADS ───────────────────────────────────────────────
class LeadsAPI {
  constructor(client) { this.c = client; }

  async list(opts = {}) {
    let q = this.c.from('leads').select('*');
    if (opts.council) q = q.eq('council', opts.council);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.minScore) q = q.gte('score', opts.minScore);
    q = q.order('score', { ascending: false }).order('scraped_at', { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(lead) {
    const { data, error } = await this.c.from('leads').insert(lead).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('leads').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async upsertByRef(lead) {
    // Upsert by council + reference (for scraper re-runs)
    const { data, error } = await this.c.from('leads')
      .upsert(lead, { onConflict: 'council,reference' })
      .select().single();
    if (error) throw error;
    return data;
  }

  async pipeline() {
    const { data, error } = await this.c.from('v_leads_pipeline').select('*');
    if (error) throw error;
    return data;
  }
}


// ── TASKS ───────────────────────────────────────────────
class TasksAPI {
  constructor(client) { this.c = client; }

  async list(projectId, opts = {}) {
    let q = this.c.from('tasks').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    if (opts.status) q = q.eq('status', opts.status);
    q = q.order('priority').order('sort_order');
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(task) {
    const { data, error } = await this.c.from('tasks').insert(task).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    const { data, error } = await this.c.from('tasks').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async complete(id) {
    return this.update(id, { status: 'complete', completed_at: new Date().toISOString() });
  }
}


// ── APP VERSIONS ────────────────────────────────────────
// Each app self-reports its version on load.
// Master Hub reads from this table to show live versions.
class VersionsAPI {
  constructor(client) { this.c = client; }

  // Get all app versions
  async list() {
    const { data, error } = await this.c.from('app_versions').select('*').order('app_key');
    if (error) throw error;
    return data;
  }

  // Get a single app's version
  async get(appKey) {
    const { data, error } = await this.c.from('app_versions').select('*').eq('app_key', appKey).single();
    if (error) throw error;
    return data;
  }

  // Report this app's version (upsert — call on every load)
  async report(appKey, version, appName, repo) {
    const row = {
      app_key:   appKey,
      version:   version,
      app_name:  appName || appKey,
      repo:      repo || null,
      url:       typeof window !== 'undefined' ? window.location.href : null,
      last_seen: new Date().toISOString(),
    };
    const { data, error } = await this.c.from('app_versions')
      .upsert(row, { onConflict: 'app_key' })
      .select().single();
    if (error) throw error;
    return data;
  }

  // Get versions as a simple key→version map
  async map() {
    const rows = await this.list();
    return rows.reduce((acc, r) => { acc[r.app_key] = r.version; return acc; }, {});
  }
}


// ── BRAND CONFIG ────────────────────────────────────────
class BrandAPI {
  constructor(client) { this.c = client; }

  async getAll() {
    const { data, error } = await this.c.from('brand_config').select('*');
    if (error) throw error;
    // Return as key-value object
    return data.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
  }

  async get(key) {
    const { data, error } = await this.c.from('brand_config').select('value').eq('key', key).single();
    if (error) throw error;
    return data.value;
  }

  async getByCategory(category) {
    const { data, error } = await this.c.from('brand_config').select('*').eq('category', category);
    if (error) throw error;
    return data.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
  }
}


// ── COSTS (Accounts app) ─────────────────────────────────
class CostsAPI {
  constructor(client) { this.c = client; }

  async list(opts = {}) {
    let q = this.c.from('costs').select('*');
    if (opts.category) q = q.eq('category', opts.category);
    if (opts.frequency) q = q.eq('frequency', opts.frequency);
    q = q.order('name', { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(cost) {
    const { data, error } = await this.c.from('costs').insert(cost).select().single();
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    changes.updated_at = new Date().toISOString();
    const { data, error } = await this.c.from('costs').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async upsertByName(cost) {
    const { data, error } = await this.c.from('costs').upsert(cost, { onConflict: 'name' }).select().single();
    if (error) throw error;
    return data;
  }

  async categories() {
    const { data, error } = await this.c.from('costs').select('category');
    if (error) throw error;
    return [...new Set(data.map(r => r.category))].sort();
  }

  async summary() {
    const { data, error } = await this.c.from('costs').select('amount, frequency, weekly_value, category, end_date');
    if (error) throw error;
    const now = new Date();
    const active = data.filter(c => !c.end_date || new Date(c.end_date) > now);
    const totalWeekly = active.reduce((s, c) => s + Number(c.weekly_value || 0), 0);
    return { total: data.length, active: active.length, totalWeekly: Math.round(totalWeekly * 100) / 100, totalMonthly: Math.round(totalWeekly * 52 / 12 * 100) / 100, totalAnnual: Math.round(totalWeekly * 52 * 100) / 100 };
  }
}


// ── STAFF RATES (Accounts app) ──────────────────────────
class StaffRatesAPI {
  constructor(client) { this.c = client; }

  async list() {
    const { data, error } = await this.c.from('staff_rates').select('*').order('name');
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    changes.updated_at = new Date().toISOString();
    const { data, error } = await this.c.from('staff_rates').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
}


// ── COST CATEGORIES (Accounts app) ──────────────────────
class CostCategoriesAPI {
  constructor(client) { this.client = client; }

  async list() {
    const { data, error } = await this.client.from('cost_categories').select('*').order('sort_order');
    if (error) { console.error('[SonorDB] cost_categories list error:', error); return []; }
    return data || [];
  }
}


// ── CREDIT CARDS (Accounts app) ─────────────────────────
class CreditCardsAPI {
  constructor(client) { this.c = client; }

  async list() {
    const { data, error } = await this.c.from('credit_cards').select('*').order('name');
    if (error) throw error;
    return data;
  }

  async update(id, changes) {
    changes.updated_at = new Date().toISOString();
    const { data, error } = await this.c.from('credit_cards').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
}


// ── REALTIME SUBSCRIPTIONS ──────────────────────────────
// Usage: db.subscribe('projects', (payload) => console.log(payload))
SonorDB.prototype.subscribe = function(table, callback) {
  return this.client
    .channel(`sonor_${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
    .subscribe();
};

// Unsubscribe
SonorDB.prototype.unsubscribe = function(channel) {
  this.client.removeChannel(channel);
};


// ── EXPORT ──────────────────────────────────────────────
// Works as both script tag and ES module
if (typeof window !== 'undefined') {
  window.SonorDB = SonorDB;
  window.SONOR_SERVICES = SERVICES;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SonorDB, SERVICES };
}
