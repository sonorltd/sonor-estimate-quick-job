// sonor-project-stats.js — v1.0.0 (2026-10-07) — SHARED project-stat rules (sonor-platform §22 addendum "project stats are SSOT").
// The NUMBERS come from the DB views (v_tasks_project_rollup · v_tasks_gcal_time · v_travel_by_project); the RULES that turn
// a project's quotes + rollup into "the quoted labour" live here once, so the Board's Site line and Tasks' Site Time table
// can never disagree. Pure functions, no DOM, no fetch. Consumers: sonor-master/board.html, APP - Tasks/sonor-tasks.html.
(function (global) {
  'use strict';
  const VERSION = '1.0.0';
  const QUOTE_WON = ['accepted', 'won', 'approved', 'complete'];
  const QUOTE_DEAD = ['declined', 'lost', 'expired', 'cancelled'];
  const QUOTE_DONE = QUOTE_WON.concat(QUOTE_DEAD);
  const st = q => String((q && (q.stage || q.status)) || '').toLowerCase();

  // quotes: the project's WeQuote quotes (metadata.wequote_quotes as wq-sync 1.7.0 keeps them — labour_hours / labour_cost /
  // labour_price / quote_no / stage). rollup: the v_tasks_project_rollup row (quoted_labour_hours = Takeoffs' pulled figure).
  // Rule: a pulled figure wins; else the labour "on the table" = every quote that is won OR still live (dead ones drop out) —
  // a job's hours are spent across its accepted AND in-progress quotes, so the accepted one alone over-reads.
  function quotedLabour(quotes, rollup) {
    if (rollup && Number(rollup.quoted_labour_hours)) return { hours: Number(rollup.quoted_labour_hours), basis: 'pulled', no: rollup.quote_no || null, cost: null, price: null };
    const qs = (quotes || []).filter(q => q && q.labour_hours != null); if (!qs.length) return null;
    const use = qs.filter(q => QUOTE_WON.includes(st(q)) || !QUOTE_DONE.includes(st(q))); if (!use.length) return null;
    const won = use.filter(q => QUOTE_WON.includes(st(q))).length;
    const sum = k => use.reduce((a, q) => a + (Number(q[k]) || 0), 0);
    return { hours: sum('labour_hours'), basis: won === use.length ? 'won' : (won ? 'won + live' : 'quoted'), no: use.map(q => q.quote_no).filter(Boolean).join(', '), cost: sum('labour_cost') || null, price: sum('labour_price') || null };
  }
  // % of the quoted labour used by on-site hours → traffic light (§23): ok < 85 · amber 85–100 · bad > 100
  function usage(siteHours, ql) {
    if (!ql || !ql.hours) return null;
    const pct = (Number(siteHours) || 0) / ql.hours * 100;
    return { pct, remaining: ql.hours - (Number(siteHours) || 0), tone: pct > 100 ? 'bad' : pct >= 85 ? 'amber' : 'ok' };
  }
  global.SonorProjectStats = { VERSION, QUOTE_WON, QUOTE_DEAD, QUOTE_DONE, quotedLabour, usage };
})(typeof window !== 'undefined' ? window : globalThis);
