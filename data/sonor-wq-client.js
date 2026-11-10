/*!
 * SonorWQClient v1.4.0 (2026-10-22 — proposalPdf()/latestTemplate(): the client-facing WeQuote proposal PDF via wq-proxy v5; v1.2.1 2026-10-15 X-Sonor-Source on every proxy call; setSource(name)) — workspace-shared READ-ONLY WeQuote client (B-444g, 2026-09-10).
 * v1.2.0 (2026-10-06, sonor-platform §29 — Bryn: "do all this on the basis that there is a future WQ MCP connector coming"):
 *   ONE TRANSPORT. Every WeQuote read in the workspace ends here, and `get()` hands the actual call to a pluggable
 *   transport: `setTransport(async (endpoint, params) => data)`. Today the transport is the wq-proxy edge function;
 *   when the WeQuote MCP connector lands it is registered here (browser: a thin bridge; Claude sessions: the MCP tool)
 *   and nothing else in the workspace changes. SonorWqSync.apiFetch delegates to this client when it is on the page.
 * ---------------------------------------------------------------------------
 * ROOT MASTER: /sonor-wq-client.js → synced to every app's data/ by sync-everything.sh.
 * Edit the root master only; never a per-app copy (S-4.3).
 *
 * Sonor law: WeQuote is the priced SSOT; nothing is ever written back. wq-proxy v2
 * is GET-only with an allowlist of /(project|quote|customer)/(list|get|find)* (B-340).
 * The WQ Api-Key is resolved SERVER-SIDE by the proxy; the browser never sees it.
 *
 * Data path:  app → wq-proxy edge fn (?endpoint=/quote/list_product&search=…) → WeQuote
 * Config:     public.wq_config (proxy_url / api_base / proxy_enabled) — one row, read once.
 *
 * Extracted from APP - Service Contracts/data/service-contracts-wq.js (SonorSvcWQ) and
 * APP - Library/data/sonor-wq-price.js (SonorWQPrice) — identical init/_get/_arr cores.
 * Consumers: SonorSvcWQ (delegates, v0.2.0). SonorWQPrice keeps its own copy until its
 * next version (Library follow-on) — the matching logic there stays app-specific.
 *
 * Usage:
 *   await SonorWQClient.init(supabaseClient);            // reads wq_config once
 *   const rows = await SonorWQClient.searchProducts('maintenance');
 *   const lines = await SonorWQClient.quoteLines(268809);
 *   const raw = await SonorWQClient.get('/project/list', { page: 1 });   // any allowlisted GET
 */
(function (root) {
  'use strict';

  var CFG = { proxyUrl: null, apiBase: 'https://app.wequote.cloud/external', proxyEnabled: true, anonKey: null, ready: false, source: 'none' };
  var _cache = {};
  var CACHE_MS = 5 * 60 * 1000;
  var _initP = null;
  // v1.2.1 — who is calling (wq_api_log / the per-source burst guard): SonorWQClient.setSource('board') wins, else the page's
  // <html data-app> / SonorApp key / the hosted path segment ("sonor-takeoffs"), else 'app-unknown'.
  var _source = null;
  function sourceName() {
    if (_source) return _source;
    try {
      var d = root.document;
      var k = (d && d.documentElement && d.documentElement.getAttribute('data-app')) || (root.SonorApp && (root.SonorApp.key || root.SonorApp.appKey)) || root.APP_KEY || null;
      if (!k && root.location) { var m = String(root.location.pathname || '').match(/\/(sonor-[a-z0-9-]+)/); k = m ? m[1] : null; }
      return String(k || 'app-unknown').slice(0, 60);
    } catch (e) { return 'app-unknown'; }
  }
  function setSource(name) { _source = String(name || '').slice(0, 60) || null; }
  var _transport = null;   // v1.2.0 — async (endpoint, params) → data; null = the proxy fetch below
  function setTransport(fn, label) { _transport = typeof fn === 'function' ? fn : null; CFG.transport = fn ? (label || 'custom') : 'proxy'; _cache = {}; }

  // Pass a Supabase client (SonorDB.client or supabase.createClient(...)). Idempotent.
  function init(supa, opts) {
    opts = opts || {};
    if (opts.anonKey) CFG.anonKey = opts.anonKey;
    if (opts.proxyUrl) CFG.proxyUrl = opts.proxyUrl;
    if (!CFG.anonKey && root.SONOR_SUPABASE_ANON) CFG.anonKey = root.SONOR_SUPABASE_ANON;
    if (!CFG.anonKey && root.__SONOR_BRAND__ && root.__SONOR_BRAND__.supabase) CFG.anonKey = root.__SONOR_BRAND__.supabase.anonKey || CFG.anonKey;
    if (_initP && !opts.force) return _initP;
    _initP = (async function () {
      try {
        if (supa && supa.from) {
          var res = await supa.from('wq_config').select('api_base, proxy_url, proxy_enabled').limit(1).single();
          var cfg = res && res.data;
          if (cfg) {
            if (cfg.proxy_url) CFG.proxyUrl = cfg.proxy_url;
            if (cfg.api_base) CFG.apiBase = cfg.api_base;
            CFG.proxyEnabled = cfg.proxy_enabled !== false;
          }
        }
      } catch (e) { console.warn('[SonorWQClient] wq_config read failed', e); }
      CFG.ready = !!(CFG.proxyEnabled && CFG.proxyUrl);
      CFG.source = CFG.ready ? 'proxy' : 'none';
      return CFG.ready;
    })();
    return _initP;
  }
  function configure(opts) { Object.assign(CFG, opts || {}); CFG.ready = !!(CFG.proxyEnabled && CFG.proxyUrl); return status(); }
  function status() { return { ready: CFG.ready, proxyUrl: CFG.proxyUrl, source: CFG.source, anon: !!CFG.anonKey, transport: CFG.transport || 'proxy' }; }

  // Low-level GET through the proxy (canonical ?endpoint= contract). Cached 5 min per URL.
  async function get(endpoint, params, opts) {
    opts = opts || {};
    if (!CFG.ready) throw new Error('WeQuote proxy not configured (wq_config.proxy_url / proxy_enabled)');
    if (!/^\/(project|quote|customer)\/(list|get|find)[a-z0-9_]*$/i.test(endpoint)) throw new Error('WQ endpoint not on the read-only allowlist: ' + endpoint);
    var u = new URL(CFG.proxyUrl);
    u.searchParams.set('endpoint', endpoint);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    });
    var headers = { 'Accept': 'application/json', 'X-Sonor-Source': sourceName() };   // v1.2.1 — every caller named (wq-api skill §2: the burst guard is per source)
    if (CFG.anonKey) { headers['apikey'] = CFG.anonKey; headers['Authorization'] = 'Bearer ' + CFG.anonKey; }
    var key = u.toString();
    var c = _cache[key];
    if (!opts.force && c && (Date.now() - c.at) < CACHE_MS) return c.data;
    if (_transport) { var td = await _transport(endpoint, params || {}); _cache[key] = { at: Date.now(), data: td }; return td; }   // v1.2.0 — MCP / any other transport
    var resp = await fetch(key, { method: 'GET', headers: headers });
    var text = await resp.text();
    var data; try { data = JSON.parse(text); } catch (e) { data = text; }
    if (!resp.ok) throw new Error('WQ ' + endpoint + ' HTTP ' + resp.status + ': ' + (typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)));
    _cache[key] = { at: Date.now(), data: data };
    return data;
  }
  // v1.4.0 (2026-10-22, Takeover mirror) — the client-facing proposal PDF WeQuote publishes for a quote template (quote/get →
  // templates[] {id, secure_token, pdfLink}). wq-proxy v5 streams it (endpoint=/public/print_quote_template — no Api-Key, no quota).
  // Returns an ArrayBuffer. list_quote_lines carries NO labour pricing, so the per-area Net Totals the client sees live only here.
  async function proposalPdf(templateId, token, opts) {
    opts = opts || {};
    if (!CFG.ready) throw new Error('WeQuote proxy not configured');
    var u = new URL(CFG.proxyUrl); u.searchParams.set('endpoint', '/public/print_quote_template'); u.searchParams.set('id', templateId); u.searchParams.set('token', token); if (opts.force) u.searchParams.set('nocache', '1');
    var headers = { 'Accept': 'application/pdf', 'X-Sonor-Source': sourceName() };
    if (CFG.anonKey) { headers['apikey'] = CFG.anonKey; headers['Authorization'] = 'Bearer ' + CFG.anonKey; }
    var resp = await fetch(u.toString(), { method: 'GET', headers: headers });
    if (resp.status === 403) { var e403 = new Error('wq-proxy does not serve the proposal PDF yet (needs v5)'); e403.code = 'proxy_no_pdf'; throw e403; }
    if (!resp.ok) throw new Error('WQ proposal PDF HTTP ' + resp.status);
    return await resp.arrayBuffer();
  }
  // the newest published template of a quote (quote/get result) — null when none has been generated in WeQuote yet
  function latestTemplate(quote) { var ts = (quote && quote.templates) || []; return ts.slice().sort(function (a, b) { return String(b.updated_datetime || '').localeCompare(String(a.updated_datetime || '')); })[0] || null; }
  function arr(d) { return Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []); }
  function one(d) { return Array.isArray(d) ? d[0] : (d && d.data && !Array.isArray(d.data) ? d.data : d); }
  function clearCache(prefix) { if (!prefix) { _cache = {}; return; } Object.keys(_cache).forEach(function (k) { if (k.indexOf(prefix) >= 0) delete _cache[k]; }); }

  // ── common lookups (all GET, all allowlisted) ─────────────────────────────
  async function searchProducts(term) { return arr(await get('/quote/list_product', { search: term })); }
  async function getProduct(sku, catalogueId) { return one(await get('/quote/get_product', { sku: sku, catalogue_id: catalogueId })); }
  async function listQuotes(page) { return arr(await get('/quote/list', { page: page || 1 })); }
  async function getQuote(quoteId) { return one(await get('/quote/get', { id: quoteId })); }   // WQ wants `id` here (quote_id on list_quote_lines)
  async function quoteLines(quoteId, force) { return arr(await get('/quote/list_quote_lines', { quote_id: quoteId }, { force: !!force })); }
  async function listProjects(page) { return arr(await get('/project/list', { page: page || 1 })); }
  async function findCustomer(term) { return arr(await get('/customer/find', { search: term })); }
  async function getProject(id) { return one(await get('/project/get_project', { id: id })); }        // WQ internal id → {id, project_no, description, customer_name, status}
  async function getCustomer(id) { return one(await get('/customer/get', { id: id })); }
  // 1.3.0 (2026-10-17) — the WeQuote customer's PEOPLE (WeQuote is the client CRM SSOT): find_contact with only customer_id lists them
  async function findContacts(customerId, q, force) { q = q || {}; var p = { customer_id: customerId }; if (q.email) p.contact_email = q.email; if (q.first_name) p.contact_first_name = q.first_name; if (q.surname) p.contact_surname = q.surname; return arr(await get('/customer/find_contact', p, { force: !!force })); }
  async function getContact(id) { return one(await get('/customer/get_contact', { id: id })); }
  // Full own-catalogue map (~900 rows, cached 5 min) — quote lines only carry product_id, so this is how they get names.
  async function productMap(force) { var rows = arr(await get('/quote/list_product', {}, { force: !!force })); var m = {}; rows.forEach(function (p) { m[p.id] = p; }); return m; }
  async function quoteLinesResolved(quoteId, force) { var lines = await quoteLines(quoteId, force); var pm = await productMap(); return lines.map(function (l) { var p = pm[l.product_id] || {}; return Object.assign({}, l, { sku: p.sku || '', short_description: p.short_description || '', long_description: p.long_description || '', model: p.model || '', manufacturer_name: p.manufacturer_name || '', category_description: p.category_description || '', sell_price: l.unit_price != null && Number(l.unit_price) ? l.unit_price : p.sell_price, cost_price: l.unit_cost != null && Number(l.unit_cost) ? l.unit_cost : p.cost_price }); }); }

  // 1.3.1 — the ONE WeQuote-linked mark (class .wq-pill in data/sonor-components.css): small "WQ" pill in WeQuote red
  function pill(o) { o = o || {}; var e = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var cls = 'wq-pill' + (o.off ? ' wq-off' : ''), t = o.title ? ' title="' + e(o.title) + '"' : '';
    return o.href ? '<a class="' + cls + '" href="' + e(o.href) + '" target="_blank" rel="noopener"' + t + '>WQ</a>' : '<span class="' + cls + '"' + t + '>WQ</span>'; }
  var WQ_WEB = 'https://app.wequote.cloud/sonor-ltd';
  function webUrl(kind, id) { return id ? WQ_WEB + '/' + ({ quote: 'quotes', project: 'projects', customer: 'customers' }[kind] || kind) + '/' + encodeURIComponent(id) : WQ_WEB; }
  root.SonorWQClient = {
    VERSION: '1.4.0', proposalPdf: proposalPdf, latestTemplate: latestTemplate, pill: pill, webUrl: webUrl, findContacts: findContacts, getContact: getContact, init: init, configure: configure, status: status, setTransport: setTransport, setSource: setSource, source: sourceName,
    get: get, arr: arr, one: one, clearCache: clearCache,
    searchProducts: searchProducts, getProduct: getProduct, listQuotes: listQuotes, getQuote: getQuote,
    quoteLines: quoteLines, quoteLinesResolved: quoteLinesResolved, productMap: productMap, listProjects: listProjects, findCustomer: findCustomer, getProject: getProject, getCustomer: getCustomer
  };
})(typeof window !== 'undefined' ? window : this);
