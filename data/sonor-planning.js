// sonor-planning.js — v1.0.0 (2026-10-07) — SHARED planning-portal resolver (sonor-platform §30).
// ONE place that turns {authority, ref} into a link straight to the application page on the
// council's own portal — never the council's general planning page, never a Google search when
// the council is known. Council registry = the Leads scraper registry (window.__LEADS_CONFIG__.councils
// when Leads has loaded it; the inline mirror below otherwise — keep both in step: Leads
// data/leads-config.js is the master, this mirror follows it).
//
// Consumers: Board 🏛 Planning link (sonor-master/board.html), PM brief Planning card
// (APP - Project Master/brief.html), Leads promote (APP - Leads/data/leads-promote.js writes
// metadata.planning.url). A future WeQuote / council MCP connector slots in behind resolve().
//
// Contract: metadata.planning = { ref, authority, status, url, documents_url, prior_refusal, … }
//   resolve(pl) → { url, kind: 'saved' | 'built' | 'search', council, ref } | null
//   'saved'  = pl.url / pl.portal_url as stored (Leads promote stores the scraper's canonical page)
//   'built'  = from the registry: authority + ref (ref falls back to prior_refusal)
//   'search' = unknown council → web search on the ref (last resort, labelled as such)
//   A saved url on a DEAD host (portal retired / redirects to the general site) is rebuilt.
(function (global) {
  'use strict';
  const VERSION = '1.0.0';

  // Mirror of APP - Leads/data/leads-config.js councils (portalBase + scraperType + idoxPath).
  const MIRROR = {
    'cheshire-east':  { name: 'Cheshire East',           shortName: 'CE',           portalBase: 'https://pa.cheshireeast.gov.uk',                     scraperType: 'custom' },
    'cheshire-west':  { name: 'Cheshire West & Chester', shortName: 'CW&C',        portalBase: 'https://pa.cheshirewestandchester.gov.uk',            scraperType: 'idox' },
    'conwy':          { name: 'Conwy County Borough',    shortName: 'Conwy',       portalBase: 'https://npe.conwy.gov.uk',                           scraperType: 'northgate' },
    'wirral':         { name: 'Wirral',                  shortName: 'Wirral',      portalBase: 'https://online.wirral.gov.uk',                        scraperType: 'custom' },
    'liverpool':      { name: 'Liverpool',               shortName: 'Liverpool',   portalBase: 'https://lar.liverpool.gov.uk',                        scraperType: 'custom' },
    'sefton':         { name: 'Sefton (Southport)',      shortName: 'Sefton',      portalBase: 'https://pa.sefton.gov.uk',                            scraperType: 'idox' },
    'denbighshire':   { name: 'Denbighshire',            shortName: 'Denbighshire',portalBase: 'https://developments.denbighshire.gov.uk',           scraperType: 'custom', idoxPath: '' },
    'flintshire':     { name: 'Flintshire',              shortName: 'Flintshire',  portalBase: 'https://planning.agileapplications.co.uk/flintshire', scraperType: 'agile' },
    'trafford':       { name: 'Trafford',                shortName: 'Trafford',    portalBase: 'https://pa.trafford.gov.uk',                          scraperType: 'idox' },
    'stockport':      { name: 'Stockport',               shortName: 'Stockport',   portalBase: 'https://planning.stockport.gov.uk',                   scraperType: 'idox', idoxPath: '/PlanningData-live' },
    'wrexham':        { name: 'Wrexham',                 shortName: 'Wrexham',     portalBase: 'https://register.wrexham.gov.uk',                     scraperType: 'arcus' },
    'warrington':     { name: 'Warrington',              shortName: 'Warrington',  portalBase: 'https://online.warrington.gov.uk',                    scraperType: 'custom' },
    'gwynedd':        { name: 'Gwynedd',                 shortName: 'Gwynedd',     portalBase: 'https://amg.gwynedd.llyw.cymru',                      scraperType: 'custom' },
    'powys':          { name: 'Powys',                   shortName: 'Powys',       portalBase: 'https://pa.powys.gov.uk',                             scraperType: 'idox' }
  };
  // Extra spellings seen on real applications / statements → registry key.
  const ALIASES = {
    'cheshire east council': 'cheshire-east', 'cec': 'cheshire-east',
    'cheshire west and chester': 'cheshire-west', 'cheshire west': 'cheshire-west', 'cwac': 'cheshire-west', 'cw&c': 'cheshire-west',
    'wirral council': 'wirral', 'wirral metropolitan borough council': 'wirral', 'wirral mbc': 'wirral',
    'liverpool city council': 'liverpool', 'sefton council': 'sefton', 'southport': 'sefton',
    'conwy': 'conwy', 'conwy county borough council': 'conwy',
    'denbighshire county council': 'denbighshire', 'flintshire county council': 'flintshire',
    'trafford council': 'trafford', 'stockport council': 'stockport', 'stockport mbc': 'stockport',
    'wrexham county borough council': 'wrexham', 'warrington borough council': 'warrington',
    'gwynedd council': 'gwynedd', 'cyngor gwynedd': 'gwynedd', 'powys county council': 'powys'
  };
  // Portals that no longer answer with the application (redirect to the general planning site).
  const DEAD_HOSTS = ['planning.cheshireeast.gov.uk'];

  function councils() {
    const ext = global.__LEADS_CONFIG__ && global.__LEADS_CONFIG__.councils;
    return ext && Object.keys(ext).length ? ext : MIRROR;
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9&\s-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function councilKey(name) {
    const c = councils(); const n = norm(name); if (!n) return null;
    if (c[n]) return n;
    if (ALIASES[n]) return ALIASES[n];
    for (const k of Object.keys(c)) { const v = c[k]; if (norm(v.name) === n || norm(v.shortName) === n) return k; }
    const bare = n.replace(/\b(metropolitan|borough|city|county|district|council|mbc|cbc)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (bare !== n) { if (c[bare]) return bare; if (ALIASES[bare]) return ALIASES[bare]; for (const k of Object.keys(c)) { const v = c[k]; if (norm(v.name) === bare || norm(v.shortName) === bare || norm(v.name).split(/[( ]/)[0] === bare) return k; } }
    for (const k of Object.keys(c)) { if (n.indexOf(k.replace(/-/g, ' ')) === 0) return k; }
    return null;
  }
  function councilName(key) { const c = councils()[key]; return c ? c.name : null; }

  // Straight to the application. Per portal family (same shapes the Leads scraper uses):
  //   Idox Public Access  → simpleSearchResults.do?searchCriteria.reference=<ref> (one hit → the application)
  //   Idox cloud (custom) → /planning/index.html?fa=getApplication&ref=<ref>
  //   Agile Applications  → /search-applications/results?criteria={"query":ref}
  //   Northgate / Arcus   → no ref deep-link exists; the register search page (kind stays 'built', .exact=false)
  function applicationUrl(ref, authority) {
    const key = councilKey(authority); if (!key || !ref) return null;
    const c = councils()[key]; const base = c.portalBase; const t = c.scraperType; const idox = c.idoxPath == null ? '/online-applications' : c.idoxPath;
    const r = encodeURIComponent(String(ref).trim());
    if (t === 'idox') return { url: base + idox + '/simpleSearchResults.do?action=firstPage&searchCriteria.reference=' + r, exact: true, key };
    if (t === 'agile') return { url: base + '/search-applications/results?criteria=' + encodeURIComponent(JSON.stringify({ query: String(ref).trim() })) + '&page=1', exact: true, key };
    if (t === 'northgate') return { url: base + '/pig/public/PlanningExplorer/GeneralSearch.page', exact: false, key };
    if (t === 'arcus') return { url: base + '/pr/s/register-view?c__r=Arcus_BE_Public_Register&language=en_GB', exact: false, key };
    return { url: base + '/planning/index.html?fa=getApplication&ref=' + r, exact: true, key };
  }
  function searchUrl(ref, authority) { return 'https://www.google.com/search?q=' + encodeURIComponent(String(ref || '').trim() + ' planning application' + (authority ? ' ' + authority : '')); }
  function isDead(u) { try { const h = new URL(u).hostname.toLowerCase(); return DEAD_HOSTS.some(d => h === d); } catch (e) { return false; } }

  // The one entry point. pl = metadata.planning (or any {ref, authority, url, …}).
  function resolve(pl) {
    if (!pl) return null;
    const ref = pl.ref || pl.prior_refusal || null;
    const saved = pl.url || pl.portal_url || null;
    if (saved && !isDead(saved)) return { url: saved, kind: 'saved', exact: true, council: councilName(councilKey(pl.authority)) || pl.authority || null, ref, refKind: pl.ref ? 'ref' : (pl.prior_refusal ? 'prior refusal' : null) };
    if (!ref) return null;
    const built = applicationUrl(ref, pl.authority);
    if (built) return { url: built.url, kind: 'built', exact: built.exact, council: councilName(built.key), ref, refKind: pl.ref ? 'ref' : 'prior refusal' };
    return { url: searchUrl(ref, pl.authority), kind: 'search', exact: false, council: pl.authority || null, ref, refKind: pl.ref ? 'ref' : 'prior refusal' };
  }
  function title(r) {
    if (!r) return '';
    const bits = ['Planning' + (r.ref ? ' ' + r.ref : '') + (r.refKind === 'prior refusal' ? ' (prior refusal)' : '')];
    if (r.council) bits.push(r.council);
    if (r.kind === 'search') bits.push('council not in the registry — searches for it');
    else if (!r.exact) bits.push('portal has no direct link — opens its register search');
    else bits.push('opens the application');
    return bits.join(' · ');
  }

  global.SonorPlanning = { VERSION, councils, councilKey, councilName, applicationUrl, searchUrl, resolve, title, DEAD_HOSTS };
})(typeof window !== 'undefined' ? window : globalThis);
