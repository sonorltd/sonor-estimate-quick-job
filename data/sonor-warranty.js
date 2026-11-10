/* ═══════════════════════════════════════════════════════════════════════
   SonorWarranty — the ONE warranty display for every Sonor app (v1.0.0, 2026-11-05)
   ROOT MASTER: ~/Code/Sonor/data/sonor-warranty.js — apps carry byte-identical copies in data/ (sync-everything.sh).
   Bryn 2026-11-05: "show warranties as progress bars, make this baked across all apps nothing hard coded,
   everything always shared across workspace".

   NOTHING here is a setting. Where things come from:
     • states, labels, client wording, colours  → brand_config 'warranty_states'   (category 'warranty')
     • the "expiring" window (days)              → brand_config 'warranty_expiring_days' (also read by v_asset_warranty)
     • months / terms / cover / provider          → the Library (device_catalogue.metadata.warranty_*) via
                                                    v_asset_warranty or sonor_client_warranty()
   The DEFAULTS below are only what is drawn before load() resolves or if the database can't be reached.

   Usage:
     await SonorWarranty.load(supabaseClient);           // once per page (cached; safe to call again)
     el.innerHTML = SonorWarranty.bar(row);               // row = a v_asset_warranty row or a sonor_client_warranty line
     SonorWarranty.bar(row, { compact: true })            // thin table-row version
     SonorWarranty.bar(row, { client: true })             // client wording ("Covered until March 2028")
     SonorWarranty.state(row) → 'in_warranty' | 'expiring' | 'expired' | 'unknown' | 'lifetime' | 'provider'
     SonorWarranty.label(key, { client, provider }) · SonorWarranty.colour(key) · SonorWarranty.days()
     SonorWarranty.statusOptions()                        // [{value,label}] for a status filter <select>
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var VERSION = '1.0.0';
  var DEFAULTS = {
    days: 90,
    states: {
      in_warranty: { label: 'In warranty', client: 'Covered', colour: '#78ba57' },
      expiring:    { label: 'Expiring', client: 'Ending soon', colour: '#E8A317' },
      expired:     { label: 'Expired', client: 'Warranty ended', colour: '#ec6061' },
      unknown:     { label: 'No warranty date', client: 'Being registered', colour: '#8f8574' },
      lifetime:    { label: 'Lifetime', client: 'Lifetime cover', colour: '#ad9978' },
      provider:    { label: 'Provider cover', client: 'Covered by {provider}', colour: '#4bb9d3' }
    }
  };
  var CFG = { days: DEFAULTS.days, states: JSON.parse(JSON.stringify(DEFAULTS.states)), loaded: false };
  var loading = null;

  function pickClient(sb) {
    return sb || global.sonorSupabase || (global.SonorDB && (global.SonorDB.client || global.SonorDB.c)) ||
      (global.supaDb && (global.supaDb.client || global.supaDb.c)) || null;
  }
  function load(sb) {
    if (CFG.loaded) return Promise.resolve(CFG);
    if (loading) return loading;
    var c = pickClient(sb);
    if (!c || !c.from) return Promise.resolve(CFG);
    loading = Promise.resolve(c.from('brand_config').select('key,value').eq('category', 'warranty')).then(function (r) {
      (r && r.data || []).forEach(function (row) {
        if (row.key === 'warranty_expiring_days' && /^\d+$/.test(String(row.value))) CFG.days = Number(row.value);
        if (row.key === 'warranty_states') {
          try { var s = JSON.parse(row.value); Object.keys(s).forEach(function (k) { CFG.states[k] = Object.assign({}, CFG.states[k] || {}, s[k]); }); } catch (e) { /* keep defaults */ }
        }
      });
      CFG.loaded = true;
      try { global.dispatchEvent(new CustomEvent('sonor:warranty-settings', { detail: CFG })); } catch (e) {}
      return CFG;
    }, function () { return CFG; });
    return loading;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(x) { if (!x) return null; var d = x instanceof Date ? x : new Date(String(x).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? null : d; }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addMonths(d, m) { var x = new Date(d); x.setMonth(x.getMonth() + m); return x; }

  // Normalise either shape: v_asset_warranty row (warranty_start/_end/_cover…) or client line (first_start/first_end/cover…)
  function norm(r) {
    r = r || {};
    var end = day(r.warranty_end || r.first_end || r.end), start = day(r.warranty_start || r.first_start || r.start);
    var months = Number(r.warranty_months || r.months) || null;
    if (!start && end && months) start = addMonths(end, -months);
    return { start: start, end: end, months: months, cover: r.warranty_cover || r.cover || null, provider: r.warranty_provider || r.provider || null,
             status: r.warranty_status || null, terms: r.warranty_terms || r.terms || '',
             count: Number(r.count) || null, unknown: Number(r.unknown) || 0, expired: Number(r.expired) || 0 };
  }
  function state(r) {
    var n = norm(r);
    if (n.cover === 'lifetime') return 'lifetime';
    if (n.cover === 'provider') return 'provider';
    if (!n.end) return n.expired && n.count && n.expired === n.count ? 'expired' : 'unknown';
    var left = Math.round((n.end - today()) / 864e5);
    if (left < 0) return 'expired';
    if (left < CFG.days) return 'expiring';
    return 'in_warranty';
  }
  function st(key) { return CFG.states[key] || CFG.states.unknown || DEFAULTS.states.unknown; }
  function label(key, o) {
    o = o || {}; var s = st(key), t = (o.client ? s.client : s.label) || s.label || key;
    return t.replace('{provider}', o.provider || 'the provider');
  }
  function colour(key) { return st(key).colour || '#8f8574'; }
  function left(n) {
    var ms = n.end - today(); if (ms < 0) return '';
    var m = Math.floor(ms / (864e5 * 30.44)); if (m < 1) return Math.max(1, Math.round(ms / 864e5)) + ' days left';
    var y = Math.floor(m / 12), mm = m % 12;
    return (y ? y + ' yr' + (mm ? ' ' : '') : '') + (mm ? mm + ' mo' : '') + ' left';
  }
  function monthYear(d) { return d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : ''; }
  function pct(r) {
    var n = norm(r), k = state(r);
    if (k === 'lifetime' || k === 'provider') return 100;
    if (!n.end) return 0;
    var t = today(); if (n.end <= t) return 0;
    if (!n.start || n.start >= n.end) return 100;
    return Math.max(2, Math.min(100, Math.round((n.end - t) / (n.end - n.start) * 100)));
  }

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('sonor-warranty-css')) return;
    var css =
      '.sw{--c:#8f8574;display:grid;gap:5px;min-width:0}' +
      '.sw-track{position:relative;height:8px;border-radius:99px;background:rgba(140,130,115,.18);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}' +
      '.sw-fill{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 70%,transparent),var(--c));' +
        'box-shadow:0 0 10px color-mix(in srgb,var(--c) 65%,transparent);transform-origin:left;animation:swGrow .9s cubic-bezier(.2,.8,.2,1) both}' +
      '.sw-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.35) 50%,transparent 70%);background-size:220% 100%;animation:swShine 2.8s ease-in-out 1s infinite}' +
      '.sw[data-s="unknown"] .sw-track{background:repeating-linear-gradient(-45deg,rgba(140,130,115,.16) 0 6px,rgba(140,130,115,.06) 6px 12px)}' +
      '.sw[data-s="expired"] .sw-track{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 55%,transparent)}' +
      '.sw[data-s="expiring"] .sw-fill{animation:swGrow .9s cubic-bezier(.2,.8,.2,1) both,swPulse 1.8s ease-in-out .9s infinite}' +
      '.sw-meta{display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.25;min-width:0}' +
      '.sw-state{color:var(--c);font-weight:600;white-space:nowrap}' +
      '.sw-left{opacity:.7;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.sw.compact{gap:3px;min-width:120px}.sw.compact .sw-track{height:5px}.sw.compact .sw-meta{font-size:11px}' +
      '.sw:hover .sw-fill{filter:brightness(1.15);box-shadow:0 0 16px color-mix(in srgb,var(--c) 80%,transparent)}' +
      '@keyframes swGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}' +
      '@keyframes swShine{0%{background-position:120% 0}60%,100%{background-position:-120% 0}}' +
      '@keyframes swPulse{50%{box-shadow:0 0 18px var(--c)}}' +
      '@media (prefers-reduced-motion:reduce){.sw-fill,.sw-fill::after{animation:none}}';
    var el = document.createElement('style'); el.id = 'sonor-warranty-css'; el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  // bar(row, {compact, client, title}) → HTML string
  function bar(r, o) {
    o = o || {}; injectCss();
    var n = norm(r), k = state(r), c = colour(k), p = pct(r);
    var lab = label(k, { client: o.client, provider: n.provider });
    var meta;
    if (k === 'lifetime' || k === 'provider') meta = o.client ? '' : (n.terms || '');
    else if (k === 'unknown') meta = o.client ? 'Dates set once installed' : 'Set when installed';
    else if (k === 'expired') meta = 'Ended ' + monthYear(n.end);
    else if (o.client && k === 'in_warranty') { lab = label(k, { client: true }) + ' until ' + monthYear(n.end); meta = left(n); }
    else meta = (o.client ? 'Until ' : '') + monthYear(n.end) + ' · ' + left(n);
    var tip = o.title || [lab, meta, n.terms].filter(Boolean).join(' · ');
    return '<div class="sw' + (o.compact ? ' compact' : '') + '" data-s="' + k + '" style="--c:' + c + '" title="' + esc(tip) + '">' +
      '<div class="sw-track"><span class="sw-fill" style="width:' + p + '%"></span></div>' +
      '<div class="sw-meta"><span class="sw-state">' + esc(lab) + '</span>' + (meta ? '<span class="sw-left">' + esc(meta) + '</span>' : '') + '</div></div>';
  }

  global.SonorWarranty = {
    VERSION: VERSION,
    load: load,
    settings: function () { return CFG; },
    days: function () { return CFG.days; },
    state: state, label: label, colour: colour, pct: pct, bar: bar, injectCss: injectCss,
    keys: function () { return Object.keys(CFG.states); },
    statusOptions: function () {
      return ['in_warranty', 'expiring', 'expired', 'unknown'].map(function (k) {
        return { value: k, label: k === 'expiring' ? label(k) + ' ≤ ' + CFG.days + ' d' : label(k) };
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
