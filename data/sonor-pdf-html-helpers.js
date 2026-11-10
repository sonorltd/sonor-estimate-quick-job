// =============================================================================
// sonor-pdf-html-helpers.js — pure utility helpers for HTML PDF cover modules
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root.
// One responsibility: stateless helpers used by every other module in the
// HTML cover stack (components, templates, orchestrator). Pure functions —
// no DOM, no fetch, no side effects.
//
// Public API (window.SonorPdfHtmlHelpers):
//   esc(text)              — HTML-escape a string for safe innerHTML interp
//   statusColour(status)   — Sonor canonical lifecycle → hex map
//   statusInkOn(fillHex)   — Pick #fff or #1a1f28 ink for a given fill
//   STATUS_PALETTE         — Frozen map of canonical status → hex (data,
//                              re-exported for any consumer that needs to
//                              render a swatch outside the cover)
//
//   sortFloors(floors)     — Canonical sort: GF → 1F → 2F → 3F+ → BA → EXT.
//                              Bake-in directive (Bryn 2026-05-08): wherever
//                              there are lists or schedules, GF goes first,
//                              then numbered floors ascending, then Basement,
//                              then Exterior. Stable sort. Pure — does not
//                              mutate input array.
//
// Versioning: bumped alongside the cover module. v1.1.0 (2026-05-08).

(function () {
  'use strict';

  const STATUS_PALETTE = Object.freeze({
    'AS-BUILT':        '#4bb9d3',
    'AS BUILT':        '#4bb9d3',
    'FOR INSTALL':     '#5a8b40',
    'FOR INSTALLATION':'#5a8b40',
    'FINAL ISSUE':     '#5a8b40',
    'FINAL CONSTRUCTION':'#5a8b40',
    'FINAL':           '#78ba57',
    'FINAL DRAFT':     '#e37c59',
    'FOR REVIEW':      '#E8A317',
    'FOR QUOTATION':   '#E8A317',
    'FOR QUOTE':       '#E8A317',
    'SITE REVIEW':     '#E8A317',
    'REVISED':         '#e37c59',
    'REVISED DRAFT':   '#e37c59',
    'PRELIMINARY':     '#e37c59',
    'DRAFT':           '#636c7a',
    'INITIAL DRAFT':   '#636c7a',
    'ORIGINAL DRAFT':  '#636c7a',
    'ACTIVE':          '#78ba57',
    'COMPLETED':       '#8b7d6b',
    'CLOSED':          '#8b7d6b',
    'ARCHIVED':        '#8b7d6b',
    'CANCELLED':       '#9F978B',
    'TENDER':          '#4bb9d3',
    'QUOTE':           '#4bb9d3',
    // v5.46 — Cinema Design lifecycle additions. CD's doc-status dropdown
    // covers the full drawing-package lifecycle from DRAFT → AS-BUILT.
    // Colours align with industry convention (IFC = green, AS-BUILT = muted
    // historical, SUPERSEDED = grey).
    'ISSUED FOR CONSTRUCTION': '#78ba57',
    'IFC':                     '#78ba57',
    'ISSUED':                  '#78ba57',
    'AS-BUILT':                '#8b7d6b',
    'AS BUILT':                '#8b7d6b',
    'SUPERSEDED':              '#9F978B',
    'OBSOLETE':                '#9F978B'
  });

  // Light-fill hexes that need DARK ink for legibility (yellow / aqua / light green).
  const LIGHT_PILL_FILLS = new Set([
    '#f5d05c', // svc04 yellow
    '#e8a317', // §23 amber (for review / for quote) — dark ink on it
    '#4bb9d3', // svc02 aqua
    '#78ba57'  // svc03 green
  ]);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Resolve a free-form status string to the canonical hex. Match strategy:
  //   1. exact uppercase match
  //   2. substring match against canonical keys (longest match wins)
  //   3. fallback to slate (DRAFT)
  function statusColour(status) {
    const s = String(status || '').toUpperCase().trim();
    if (!s) return STATUS_PALETTE.DRAFT;
    if (STATUS_PALETTE[s]) return STATUS_PALETTE[s];
    // Substring fallback — pick the LONGEST canonical key that's a substring.
    let best = null, bestLen = 0;
    Object.keys(STATUS_PALETTE).forEach(key => {
      if (s.indexOf(key) !== -1 && key.length > bestLen) {
        best = key; bestLen = key.length;
      }
    });
    return best ? STATUS_PALETTE[best] : STATUS_PALETTE.DRAFT;
  }

  function statusInkOn(fillHex) {
    return LIGHT_PILL_FILLS.has(String(fillHex || '').toLowerCase()) ? '#1a1f28' : '#ffffff';
  }

  // ---- Floor canonical sort -------------------------------------------------
  // Bake-in directive (Bryn 2026-05-08): wherever there are lists or schedules,
  // floors render GF → 1F → 2F → 3F+ → BA → EXT, always that sequence. Anything
  // unrecognised sinks below EXT.
  //
  // Accepts an array of floor-shaped objects ({code, name, ...}) OR an array
  // of plain code strings. Stable, pure — never mutates input. Returns a new
  // array. Falls back to slice() on bad input rather than throwing.
  function _floorRank(f) {
    const code = String((f && (f.code != null ? f.code : f.name)) || f || '').toUpperCase().trim();
    if (!code) return 9999;
    if (code === 'GF' || code === 'G' || code === '0F' ||
        code.indexOf('GROUND') === 0) return 0;
    // Numbered floors — handle 1F, 2F, F1, F2, 1, 2…
    let m = code.match(/^(\d+)F$/) || code.match(/^F(\d+)$/) || code.match(/^(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (code === 'BA' || code === 'B' || code.indexOf('BASEMENT') === 0) return 1000;
    if (code === 'EXT' || code === 'E' || code.indexOf('EXTERIOR') === 0 ||
        code.indexOf('EXTERNAL') === 0 || code.indexOf('OUTSIDE') === 0) return 2000;
    return 9999;
  }

  function sortFloors(floors) {
    if (!Array.isArray(floors)) return floors;
    // HARMONY no-fork: prefer the workspace-canonical `sonorSortFloors`
    // (data/sonor-app.js, exposed at window.sonorSortFloors and
    // window.SonorApp.sortFloors). Fall back to the local stable impl when
    // sonor-app.js hasn't loaded — keeps the PDF helpers usable in isolation
    // (tests, standalone preview), while production runtime always routes
    // through the single source of truth.
    if (typeof window !== 'undefined') {
      if (typeof window.sonorSortFloors === 'function') {
        return window.sonorSortFloors(floors);
      }
      if (window.SonorApp && typeof window.SonorApp.sortFloors === 'function') {
        return window.SonorApp.sortFloors(floors);
      }
    }
    // Stable sort: pair with index, sort by (rank, originalIndex), strip index.
    return floors
      .map((f, i) => ({ f, i, r: _floorRank(f) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map(x => x.f);
  }

  if (typeof window !== 'undefined') {
    window.SonorPdfHtmlHelpers = {
      __version: '1.1.0',
      esc, statusColour, statusInkOn, sortFloors,
      STATUS_PALETTE
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc, statusColour, statusInkOn, sortFloors, STATUS_PALETTE };
  }
})();
