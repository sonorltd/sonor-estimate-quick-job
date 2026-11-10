/**
 * Sonor Takeoffs — PDF rendering primitive (canonical master)
 *
 * Workspace-shared, browser-side PDF generation. Per Sonor Spine S-4.2:
 * edit THIS file at workspace root, then run sync-everything.sh to
 * propagate to APP - Takeoffs/data/sonor-takeoffs-pdf.js.
 *
 * Consumers: APP - Takeoffs (primary). Future: Cinema Takeoff (TBD).
 *
 * Dependencies (must be loaded BEFORE this file):
 *   - jsPDF 2.5.1                         (window.jspdf.jsPDF)
 *   - svg2pdf 2.5.0                       (provides pdf.svg() — optional, raster fallback)
 *   - SonorDrawingCore                    (window.SonorDrawingCore — math primitives)
 *   - window.__SONOR_BRAND__              (brand object — company line, urls)
 *   - window.__SONOR_WORDMARK_PDF__       (base64 wordmark image, optional fallback)
 *   - window.SERVICES                     (10-service catalogue array)
 *
 * Exports: window.SonorPdf — API surface unchanged from inline IIFE.
 *
 * History:
 *   v2.5.0  2026-08-01  SONOR_PDF_VERSION single version-of-record + banner
 *                       derivation + window.SonorPdf.__version (module gets its
 *                       own semver line again; host releases stamp the cache-bust).
 *   v5.185.2 2026-08-01 B-362 CLOSED — ONE aspect→section map. The two
 *                       hand-mirrored copies (_aspecSec in _buildFullDocSpec
 *                       precount + _aspectSecKey in fullDocument emit filter)
 *                       had already diverged on the pjscreen branch (prefix
 *                       match vs enumeration — a future pjscreen_* aspect key
 *                       would be precounted but not emitted, the B-359 PAGE
 *                       x OF y drift class). Both now alias the single
 *                       module-scope _aspectSectionKey(); prefix-match
 *                       behaviour kept (superset of the enumeration).
 *   v2.4.3  2026-04-28  pdf-lib FULL INTEGRATION. Cabling Info + Bend Radii
 *                       reference pages migrated to native vector. Page order
 *                       now matches v2.0.4 jsPDF (cover → CBL → BRD → plans →
 *                       schedules). Final pagination pass (_finalisePaginationPdfLib)
 *                       walks the finished doc + re-stamps PAGE X / Y on every
 *                       page using the actual final count. v2.4.4 will flip
 *                       the takeoffs-pdf-lib default to ON.
 *   v2.4.2  2026-04-28  pdf-lib pipeline — plan pages painted natively with
 *                       SHARED XObject background image dedup. Each floor's
 *                       plan canvas snapshot embedded ONCE via embedJpg, then
 *                       drawn N times across Combined / CCTV / Electrical /
 *                       per-service slice pages. Per-page overlay (Fabric
 *                       canvas with bg hidden) embedded as transparent PNG
 *                       on top. File-size headline win.
 *   v2.4.1  2026-04-28  pdf-lib aspect schedule pages (native vector).
 *   v2.4.0  2026-04-28  pdf-lib pipeline introduced (opt-in flag).
 *   v2.3.0  2026-04-28  Extracted to canonical master (first major modular
 *                       extraction per Bryn directive — proof of pattern for
 *                       takeoffs-tv.js / takeoffs-pj.js / takeoffs-cctv.js etc).
 *   v1.23.0 2026-04-25  Original module landed in sonor-takeoffs.html.
 *
 * Last extracted from sonor-takeoffs.html v2.2.0 → v2.3.0.
 */
(function () {
  'use strict';

  // v5.187.0 — SINGLE VERSION-OF-RECORD for this module (survey found the
  // header History, boot banner and host cache-bust all disagreeing).
  // Bump THIS on every functional change to the module; the banner and
  // window.SonorPdf.__version derive from it.
  var SONOR_PDF_VERSION = '2.9.0';   // v2.9.0 2026-11-01 — FULL DOCUMENT PAGE NUMBERS FROM THE FINAL COUNT: every HTML page's baked "PAGE n of T" is restamped after assembly when the precount drifted (a slice that came back empty, a dropped section — Demo contents read "Page 2 of 121" in a 117-page file): _trackHtmlPageStamps + _restampHtmlPageNumbers (sonor-pdf-html-cover 1.12.0 pageStamp patch) · Standard plan rasters capped (scale 2.5, JPEG 0.8) ·  v2.8.0 2026-11-01 — house ART cover (scope-cover / -landscape, full bleed, clean-zone type) on the full document + plan exports; frames yield between pages ·  v2.7.0 2026-10-16 — DMX PLAN special page (remote DMX driver loop, variant 'dmx'; servicePlan opts.variant) · v2.6.0 2026-10-16 — merged PROJECT INFORMATION front page, CABLING STANDARDS numbered on its own, TRADES REQUIREMENTS — BUILDER sheet

// ============================================================
// Boot diagnostic — resolved PDF pipeline
// ============================================================
// v5.12.0 DOC FIX: the v5.5.70 banner here claimed "pdf-lib pipeline back
// to default ON / canonical default again" — that was reverted by v5.5.71:
// `_pdfLibFlagOn()` is DEFAULT-OFF, so **jsPDF is the canonical default**
// and pdf-lib is OPT-IN via localStorage `takeoffs-pdf-lib = '1'` (painter
// parity pending). The stale banner actively misled sessions (and one
// audit). Boot diagnostic below logs the resolved pipeline truthfully.
try {
  if (typeof window !== 'undefined') {
    try {
      const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
      const optOut = !!(ls && (ls.getItem('takeoffs-pdf-lib-disable') === '1'
        || ls.getItem('takeoffs-pdf-lib') === '0'));
      const libOk = !!(window.PDFLib && window.PDFLib.PDFDocument
        && typeof window.PDFLib.PDFDocument.create === 'function');
      const optIn = !!(ls && ls.getItem('takeoffs-pdf-lib') === '1');
      console.info('[Sonor PDF v' + SONOR_PDF_VERSION + '] Pipeline:',
        (optIn && !optOut && libOk) ? 'pdf-lib (opt-in)' : 'jsPDF (default — proven v5.4.0 hero + v1.23.0 footer)',
        '— PDFLib loaded:', libOk,
        '— takeoffs-pdf-lib flag:', ls ? ls.getItem('takeoffs-pdf-lib') : '(no localStorage)');
    } catch (_) {}
  }
} catch (_) {}

// ============================================================
// v1.23.0 — SONOR PDF — branded chrome system
// ============================================================
// Replaces the v1.5.1 generic chrome (a single charcoal title bar) with
// a full Sonor-branded PDF system that mirrors the reference set Bryn
// shipped 2026-04-25 (Caldy plans + Caldy Shade Take-Off + Oak Bank LED
// Schedule + LL Exterior). One module powers BOTH:
//   • SonorPdf.plan()   — annotated full-plan PDF (canvas snapshot +
//                          inset legend + scale bar + summary panel)
//   • SonorPdf.aspect() — per-aspect tabular PDF (room-grouped data
//                          rows + total summary chip + service stripe)
//
// Every PDF gets:
//   • Top accent strip with document title (uppercased) + active floor
//     + date + revision (mirrors Caldy header strip)
//   • Bottom title-block with: Sonor wordmark + 10 service-colour dots,
//     Project / Drawing / Revision / Issue / Page panels, company line,
//     Takeoffs version stamp (mirrors Caldy footer title-block)
//   • Per-aspect colour accent strip under the title bar (e.g. Cable
//     PDFs get aqua, LED PDFs get yellow, Symbols get accent purple)
//
// Project metadata source of truth: `_projectsCache` populated by
// `_loadProjectsIntoBar()` from Supabase `projects` table — same data
// the in-app project bar shows (status / client_name / address / postcode).
//
// All sizing in PDF points (jsPDF default unit). A4 portrait = 595×842;
// A3 landscape = 1190×842. Constants kept conservative so the design
// scales between A3 plan PDFs and A4 aspect PDFs without re-tuning.
const SonorPdf = (function () {
  'use strict';

  // ---- BRAND CONSTANTS (slate theme — mirror Branding - CORE/dist/brand.css) ----
  // Pulled verbatim from `[data-theme='slate']` in dist/brand.css. Slate is
  // the canonical Sonor brand theme since B-188 (2026-04-21), used by every
  // app's UI chrome. PDFs match so the output reads as part of the same
  // family. NEVER hardcode separate values — if brand-core.xml changes,
  // refresh these constants in lock-step.

  // v5.249.0 (§41) — the project's cover photo for the hero (the same photo the scope brief uses); null when none is set.
  async function _coverBackdrop() {
    try { if (typeof window._wqCoverPhotoUrl === 'function') return await window._wqCoverPhotoUrl(); } catch (_) {}
    return null;
  }
  try { window._coverBackdrop = _coverBackdrop; } catch (_) {}
  const COLOURS = {
    bar:        '#151A22',   // surface-bar (slate near-black) — header/footer strip
    text:       '#1A1F28',   // text-primary (dark slate body text)
    text2:      '#475161',   // text-secondary
    muted:      '#636C7A',   // text-muted
    faint:      '#A8B0BC',   // text-faint
    surfaceTxt: '#F4F5F8',   // text on dark surface
    body:       '#FFFFFF',   // page bg (white — print spec)
    panel:      '#F7F8FA',   // very-light slate tint for table headers + alt rows
    tint:       '#F7F8FA',   // v1.27.0 alias: paintTable + paintLegend reference COLOURS.tint
    altRow:     '#FAFBFC',   // ultra-faint alt row stripe
    border:     '#E2E5EA',   // hairline divider (resolved from rgba border-token)
    borderHard: '#C5CAD2',   // stronger divider for cell separators
    accent:     '#ad9978',   // v5.143.0 — SONOR GOLD doc accent (was slate; service colours unaffected)
    appAccent:  '#ad9978',   // v5.143.0 — SONOR GOLD (was deep purple)
    danger:     '#ec6061',   // svc06 red (ON HOLD / removed-revision)
    ok:         '#78ba57',   // svc03 green (ACTIVE state)
    // v5.3.4 — Status-pill derived colours. Earthy palette per brand-core.xml.
    installGreen: '#5a8b40', // ISSUED FOR INSTALL (svc03 darkened ~25%)
    asBuiltAqua:  '#4bb9d3', // svc02 aqua (paired with v1.65 as-built flag)
    archived:     '#8b7d6b', // earthy --text-muted (Muted Taupe) per brand-core
    draftSlate:   '#636C7A'  // matches COLOURS.muted
  };

  // 2026-10-16 — sonor-pdf-theme.js is the ONE palette (§41): black chrome, ink greys, gold accent. Literals above = offline fallback.
  try {
    const _T = (typeof window !== 'undefined' && window.SonorPdfTheme) ? window.SonorPdfTheme.HEX : null;
    if (_T) Object.assign(COLOURS, { bar: _T.black, text: _T.ink, text2: _T.ink2, muted: _T.muted, faint: _T.g500, panel: _T.g100, tint: _T.g100, altRow: _T.g50, border: _T.g300, borderHard: _T.g400, accent: _T.gold, appAccent: _T.gold, archived: _T.label });
  } catch (_) {}
  // v1.27.0 — corrected key reads. __SONOR_BRAND__.company schema is
  // { name, legal, tagline, location, url, phone, email, office, ... }.
  // v1.23.0 read .web (undefined) → footer rendered "undefined · email · phone".
  // Now reads .url and strips protocol for compact display.
  const _rawCompany = (window.__SONOR_BRAND__ && window.__SONOR_BRAND__.company) || {};
  const COMPANY = {
    name:     _rawCompany.name     || 'Sonor Smart Homes',
    web:      String(_rawCompany.url || 'https://sonor.co.uk').replace(/^https?:\/\//, ''),
    email:    _rawCompany.email    || 'projects@sonor.co.uk',
    phone:    _rawCompany.phone    || '07933 684 000',
    location: _rawCompany.location || 'Chester, England',
    tagline:  _rawCompany.tagline  || 'Smart homes, beautifully done'
  };

  // Per-aspect accent — a single 2pt service-colour stripe drawn directly
  // under the slate header bar. Subtle (2pt, not 4pt) because the header
  // does the heavy visual work; the accent is just a wayfinding cue. Each
  // aspect maps to its canonical service-colour from SERVICES so the
  // family reads consistently across canvas pips → palette → PDF.
  // v1.99.1 / v2.0.0 — Per Bryn rule (2026-04-28) "only use service colours
  // where related, use black or other when its generic like rooms, but use
  // service accent colours where relevant such as blocks schedule".
  // Generic / multi-service aspects → charcoal (#302F2E). Service-bound
  // aspects keep their service colour (lighting/leds yellow, displays green,
  // pj_screens cinema purple, cctv gold). Per-service slice accents
  // (ASPECT_ACCENT['svc_NN']) are populated dynamically from SERVICES.colour.
  // v2.0.0 — locked map (verified 2026-04-28): rooms / symbols / blocks /
  // cables / shades / zones MUST be charcoal. lighting + leds yellow.
  // tvs/displays green. pj_screens cinema purple (added). cctv/security gold
  // (added). svc_NN per-service slices use SERVICES.colour for that NN.
  // v2.0.2 — Shades CORRECTION (Bryn 2026-04-28): v1.99.1 incorrectly mapped
  // shades to charcoal under the "generic = charcoal" rule. Shades have a
  // canonical visual identity (terracotta #e37c59, service-05 Automation
  // aspect) regardless of which technical services they span. Visual
  // identity is the priority — restored to terracotta. Master Blocks
  // schedule stays charcoal but per-section bands inside it are coloured
  // by NN.sub prefix via _serviceColourForSection() (see paintTable).
  // v5.0.4 — Gilroy font resolution. Reads window.SonorPdfFonts and
  // returns the family name to use in setFont() calls. If Gilroy is
  // loaded, returns 'Gilroy'; otherwise falls back to 'helvetica'.
  // The PDF entry points (aspect/plan/plans/fullDocument) call
  // _registerSonorFonts(pdf) at the top to attach the embedded TTFs;
  // every subsequent setFont() then picks up the Gilroy family if
  // registration succeeded.
  function _pdfFontFamily() {
    try {
      const sp = (typeof window !== 'undefined') ? window.SonorPdfFonts : null;
      if (sp && typeof sp.isLoaded === 'function' && sp.isLoaded()) return 'Gilroy';
    } catch (_) {}
    return 'helvetica';
  }
  function _registerSonorFonts(pdf) {
    try {
      const sp = (typeof window !== 'undefined') ? window.SonorPdfFonts : null;
      if (sp && typeof sp.registerWith === 'function') sp.registerWith(pdf);
    } catch (_) {}
  }

  const ASPECT_ACCENT = {
    plan:       '#475161',   // slate (composite full plan — no single service)
    rooms:      '#302F2E',   // charcoal (generic)
    symbols:    '#302F2E',   // charcoal (master multi-service Blocks schedule — sections coloured per-service inside)
    blocks:     '#302F2E',   // charcoal alias for symbols (master only — sections coloured per-service inside)
    cables:     '#302F2E',   // charcoal (generic infra)
    cabling:    '#302F2E',   // charcoal (Cabling Info reference page — generic)
    bend:       '#302F2E',   // charcoal (Bend Radii reference page — generic)
    zones:      '#302F2E',   // charcoal (generic multi-service)
    leds:       '#f5d05c',   // yellow (matches LEDs layer pip — service 04)
    lighting:   '#f5d05c',   // yellow (lighting schedule — service 04)
    shades:     '#e37c59',   // terracotta (service 05 — Shades aspect identity, v2.0.2 correction)
    tvs:        '#78ba57',   // green (Displays — service 03 video)
    displays:   '#78ba57',   // green alias for tvs (v2.0.0 — explicit)
    pj_screens: '#8058a1',   // cinema purple (service 01 — projector / fixed screen)
    cctv:       '#ad9978',   // gold (service 08 — CCTV / Security)
    security:   '#ad9978',   // gold alias for cctv (v2.0.0)
    containment: '#302F2E',  // charcoal (service 10 — Infrastructure, v2.2.0)
    snags:      '#ec6061',   // red (v3.0.2 — Pin Snags Schedule, issues semantics)
    automation: '#e37c59',   // terracotta (v3.0.2 — Automation Mode / service 05)
    full:       '#475161'    // slate (full data dump)
    // Per-service slice accents (ASPECT_ACCENT['svc_NN']) are populated
    // dynamically from SERVICES.colour via wirePerServicePdfButtons.
  };
  // v5.144.0 (Bryn: "electrical plan does not have correct colour line
  // accent under the header — check all services for this") — svc_NN keys
  // were only seeded into ASPECT_ACCENT during the per-service block emit
  // (services 01-10), so pages emitted OUTSIDE that loop fell back to
  // slate: ELECTRICAL PLAN (svc_11 — never seeded at all) and the WIFI
  // HEATMAP (svc_09 — emitted before the seeding pass). Resolve any
  // svc_NN aspect directly from SERVICES / brand SSOT, with a hard red
  // fallback for service 11.
  // v5.151.0 — notes tagged to a service (Notes hub pills), per surface.
  function _svcNotesFor(nn, surface) {
    try {
      if (typeof window !== 'undefined' && typeof window._planNotesForService === 'function') {
        const list = window._planNotesForService(String(nn || ''), surface);
        return (Array.isArray(list) && list.length) ? list : null;
      }
    } catch (_) {}
    return null;
  }
  function _svcAccentFromAspect(aspect) {
    try {
      const m = /^svc_(\d{2})$/.exec(String(aspect || ''));
      if (!m) return null;
      const nn = m[1];
      if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
        const svc = SERVICES.find(x => x && String(x.nn) === nn);
        if (svc && svc.colour) return svc.colour;
      }
      const b = (typeof window !== 'undefined' && window.__SONOR_BRAND__ && Array.isArray(window.__SONOR_BRAND__.services))
        ? window.__SONOR_BRAND__.services.find(x => x && String(x.nn) === nn) : null;
      if (b && b.hex) return b.hex;
      if (nn === '11') return '#e63946';   // electrical — svc-11 red
      return null;
    } catch (_) { return null; }
  }

  // v2.0.2 — Service-colour lookup for per-section bands inside the master
  // Blocks Schedule. Takes a section ID like "01.1", "04.6", or "08" and
  // returns the SERVICES[NN].colour. Falls back to charcoal for anything
  // that doesn't match the NN convention. Used by paintTable when the
  // group-by column is the NN.sub field, so each section stripe reads as
  // its trade colour while the master schedule's top-bar stays charcoal.
  function _serviceColourForSection(sectionId) {
    if (!sectionId) return '#302F2E';
    const trimmed = String(sectionId).trim();
    // v5.4.16 — Sonor canonical engineering aspect → service-colour map
    // (matches the cable schedule v5.4.9 aspect grouping). Resolved BEFORE
    // numeric-prefix lookup so the cable schedule's DISPLAY/SPEAKER/DATA
    // bands paint with the right hex without needing every group key to
    // carry an "NN." prefix.
    const ASPECT_HEX = {
      'DISPLAY':  '#78ba57',  // svc03 video green
      'SPEAKER':  '#4bb9d3',  // svc02 audio aqua
      'DATA':     '#b7b1a7',  // svc09 silver
      'CONTROL':  '#e67eb1',  // svc07 pink
      'LIGHTING': '#f5d05c',  // svc04 yellow
      'SECURITY': '#ec6061',  // svc06 red (also used for cctv ref)
      'OTHER':    '#8b7d6b',  // earthy muted
      'CINEMA':   '#8058a1',  // svc01 purple
      'AUDIO':    '#4bb9d3',
      'VIDEO':    '#78ba57',
      'AUTOMATION': '#e37c59',
      'CLIMATE':  '#ec6061',
      'NETWORK':  '#b7b1a7',
      'INFRA':    '#302f2e'
    };
    const upper = trimmed.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(ASPECT_HEX, upper)) return ASPECT_HEX[upper];
    // Match the leading two digits — handles "01", "01.1", "01.something",
    // " 01.1" (defensive trim). Falls through to charcoal on no-match.
    const m = trimmed.match(/^(\d{1,2})/);
    if (!m) return '#302F2E';
    const nn = m[1].padStart(2, '0');
    if (typeof SERVICES === 'undefined' || !Array.isArray(SERVICES)) return '#302F2E';
    const svc = SERVICES.find(s => s && s.nn === nn);
    return (svc && svc.colour) ? svc.colour : '#302F2E';
  }

  function _hexToRgb(hex) {
    const h = String(hex || '#000000').replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0
    };
  }
  function _setFill(pdf, hex)   { const c = _hexToRgb(hex); pdf.setFillColor(c.r, c.g, c.b); }
  function _setStroke(pdf, hex) { const c = _hexToRgb(hex); pdf.setDrawColor(c.r, c.g, c.b); }
  function _setText(pdf, hex)   { const c = _hexToRgb(hex); pdf.setTextColor(c.r, c.g, c.b); }
  // v1.71.0 — mix a hex colour with white. Used by the footer service-dot
  // strip to dim inactive (zero-count) services to ~25% saturation. amount
  // 0.0 = no white, 1.0 = pure white.
  function _mixWithWhite(hex, amount) {
    const c = _hexToRgb(hex);
    const r = Math.round(c.r + (255 - c.r) * amount);
    const g = Math.round(c.g + (255 - c.g) * amount);
    const b = Math.round(c.b + (255 - c.b) * amount);
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  // v5.3.4 — Proper darken helper. _mixWithWhite with negative amount
  // doesn't darken cleanly because (255 - r) is positive while we want
  // to subtract from r; here we multiply by (1 - amount) for true
  // perceptual darken. amount=0 returns input, amount=1 returns black.
  // Used to derive canonical COLOURS.installGreen and similar status
  // tones from base service colours without hardcoding new hex values.
  function _darken(hex, amount) {
    const c = _hexToRgb(hex);
    const factor = Math.max(0, 1 - amount);
    const r = Math.round(c.r * factor);
    const g = Math.round(c.g * factor);
    const b = Math.round(c.b * factor);
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  // ---- PROJECT METADATA COLLECTOR ----
  // Reads from the live in-app state (currentProjectId + _projectsCache),
  // falls back to UI labels when the project bar isn't populated yet.
  function collectProjectMeta() {
    let p = null;
    try {
      if (typeof currentProjectId !== 'undefined' && currentProjectId &&
          typeof _projectsCache !== 'undefined' && Array.isArray(_projectsCache)) {
        p = _projectsCache.find(r => r && r.id === currentProjectId) || null;
      }
    } catch (_) { /* noop */ }

    const name      = (p && (p.name || p.client_name)) || 'Untitled Takeoff';
    // v5.18.1 — REF reads as just the project NUMBER/code, not the project
    // name. Some projects store the ref as "1380 - The Bungalow"; strip a
    // trailing " - <name>" so the title-block REF shows "1380". Codes that
    // use bare hyphens (e.g. "SON-2026-BGTRL") have no spaced dash and pass
    // through unchanged.
    const ref       = String((p && p.ref) || '').split(/\s[–—-]\s/)[0].trim();
    const client    = (p && p.client_name) || '';
    const addrParts = p ? [p.address, p.postcode].filter(Boolean).join(', ') : '';
    // v5.4.6 — Project cloud folder (Dropbox-only today; gdrive reserved).
    // Surfaces in title-block CELL 1 + cabling-info page so installer + sub-
    // contractor can jump from the printed PDF to the live shared folder
    // (datasheets, revision PDFs, photos, RAMS docs all live there).
    let dropboxFolder = '';
    let cloudFolder = '';
    // v5.102.0 — project-level revision GENERAL COMMENTS (revisions modal
    // textarea → projects.metadata.revision_general_comments → glance page).
    let revisionGeneralComments = '';
    try {
      revisionGeneralComments = (p && p.metadata && p.metadata.revision_general_comments) || '';
    } catch (_) {}
    try {
      const cf = (p && p.metadata && p.metadata.cloud_folder) || {};
      dropboxFolder = cf.dropbox || '';
      cloudFolder   = dropboxFolder || cf.gdrive || '';
    } catch (_) {}
    // v5.4.4 / v5.4.17 — Status precedence chain:
    //   (1) projects.metadata.takeoff_status (explicit override)
    //   (2) Auto-inferred from latest revision label (Sonor canonical
    //       lifecycle Oak Bank A1→A10: ORIGINAL DRAFT → REVISED →
    //       FOR REVIEW → FINAL DRAFT → FINAL → FOR INSTALL → AS-BUILT)
    //   (3) project.status (generic Enquiry/Quote/Active/Completed)
    //   (4) DRAFT placeholder
    let status = 'DRAFT';
    let statusFromRevision = '';
    try {
      // Inference rules — matched against the LATEST revision label only.
      // First match wins. Map captures every Sonor-canonical lifecycle term.
      const labelInferRules = [
        { rx: /AS[- ]BUILT/i,                          status: 'AS-BUILT' },
        { rx: /FOR (SITE )?INSTALL(ATION)?/i,          status: 'FOR INSTALL' },
        { rx: /FINAL (ISSUE|CONSTRUCTION)/i,           status: 'FOR INSTALL' },
        { rx: /FINAL DRAFT/i,                          status: 'FOR REVIEW' },
        { rx: /FINAL AM[ME]NDMENTS?/i,                 status: 'FINAL' },
        { rx: /^FINAL$/i,                              status: 'FINAL' },
        { rx: /FOR (REVIEW|QUOTATION|QUOTE)/i,         status: 'FOR REVIEW' },
        { rx: /SITE REVIEW/i,                          status: 'FOR REVIEW' },
        { rx: /REVISED/i,                              status: 'REVISED DRAFT' },
        { rx: /(ORIGINAL )?DRAFT/i,                    status: 'INITIAL DRAFT' }
      ];
      try {
        const cache = (typeof window !== 'undefined' && window.__SONOR_TAKEOFF_REVISIONS_CACHE__) || null;
        if (Array.isArray(cache) && cache.length) {
          // Cache is newest-first — first row is latest revision
          const latest = cache[0];
          if (latest && latest.label) {
            const lbl = String(latest.label);
            for (const rule of labelInferRules) {
              if (rule.rx.test(lbl)) { statusFromRevision = rule.status; break; }
            }
          }
        }
      } catch (_) { /* offline / no cache */ }
    } catch (_) {}
    try {
      const tk = p && p.metadata && p.metadata.takeoff_status;
      if (tk) status = String(tk).toUpperCase();
      else if (statusFromRevision) status = statusFromRevision;
      else if (p && p.status) status = String(p.status).toUpperCase();
    } catch (_) {
      if (p && p.status) status = String(p.status).toUpperCase();
    }

    // Floor label — best-effort
    let floorName = '';
    try {
      if (typeof currentFloor === 'function') {
        const f = currentFloor();
        if (f && f.name) floorName = f.name;
      }
    } catch (_) { /* noop */ }

    // Scale: compose a human string + the raw px/m for scale-bar maths.
    // v5.4.14 — Architectural scale label "1:N @ A3" (Sonor canonical)
    // computed at meta time from the canvas calibration. Matches CAD
    // practice where the title-block scale reads as a ratio rather than
    // a px/m calibration value. Assumes A3 landscape (the default print
    // format for Full Plan / per-floor plan / per-aspect schedule pages
    // that ship at A3); A4-only schedule emitters can override the
    // label via opts when calling _paintTitleBlock.
    //   1 PDF point  = 1/72 inch = 0.3527 mm
    //   At ~80% canvas-fit on A3 landscape (1190 × 842 pt), the plan
    //   canvas occupies ~952pt = ~336mm. If the canvas is 1920px wide
    //   showing realW metres at scalePxPerM, then:
    //       1 paper-mm  ≈ (1920 / 336)  ≈  5.71 px
    //       1:N         =  scalePxPerM * 5.71  →  N
    //   i.e. N ≈ scalePxPerM × 5.71 ≈ scalePxPerM × paperRatio.
    // Common scales: 1:50 @ A3 ≈ scalePxPerM ≈ 8.7 — single-room cinema
    // 1:75 @ A3 ≈ 13.0 — single-floor home, 1:100 ≈ 17.4 — large estate.
    // This is approximate (canvas-fit ratio depends on aspect ratio of
    // the loaded plan); rounded to nearest canonical ratio for clarity.
    let scaleLabel = 'Not calibrated';
    let pxPerM = null;
    try {
      if (typeof scalePxPerM !== 'undefined' && scalePxPerM > 0) {
        pxPerM = scalePxPerM;
        // Canonical architectural scales (closest snap)
        const canon = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
        // Rough A3-landscape paper ratio (~5.71 px-per-paper-mm at 80% fit)
        const A3_PX_PER_PAPER_MM = 5.71;
        const rawN = scalePxPerM * A3_PX_PER_PAPER_MM;
        // Snap to nearest canonical ratio (within 25% tolerance) so we
        // don't print weird "1:78" — round to 1:75 instead.
        let snapped = canon.reduce((best, c) => Math.abs(c - rawN) < Math.abs(best - rawN) ? c : best, canon[0]);
        if (Math.abs(snapped - rawN) / rawN > 0.25) snapped = Math.round(rawN);
        scaleLabel = `1:${snapped} @ A3  ·  1m = ${scalePxPerM.toFixed(1)} px`;
      }
    } catch (_) { /* noop */ }

    const now = new Date();
    const dateIso = now.toISOString().slice(0, 10);
    const dateUk  = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // Drawn-by + revision: not yet tracked per-takeoff in Supabase, so
    // surface placeholders matching the Caldy/Oak Bank reference style.
    // Future enhancement: extend `projects.metadata.takeoff_revision` and
    // `projects.metadata.drawn_by` in Supabase + read those here.
    const drawnBy  = 'Sonor';
    const revision = '00';   // v5.148.0 (Bryn: "project revisioning should just be simple incremental numbers") — first issue = 00, then 01, 02…

    // v2.1.0 — wire the title-block "REVISION NOTES" Added/Changed/Removed
    // pills to the live revision-cloud counts. Pre-v2.1.0 these defaulted
    // to 0 (the title block painter still rendered the pills with empty
    // counts). Bryn directive: "revision clouds wchich have meta data and
    // text entry - red / green / orrange like in the title block".
    let revAdded = 0, revChanged = 0, revRemoved = 0, revRfi = 0, revNote = 0;
    let _revCountsAll = null;   // v5.136.0/v5.143.0 — FULL registry-driven map (re-applied to root master)
    try {
      if (typeof _countRevisionClouds === 'function') {
        const c = _countRevisionClouds();
        _revCountsAll = c;
        revAdded   = c.added   || 0;
        revChanged = c.changed || 0;
        revRemoved = c.removed || 0;
        revRfi     = c.rfi     || 0;   // 2026-07-12 — purple RFI clouds
        revNote    = c.note    || 0;   // v5.172.0 — charcoal Note clouds
      }
    } catch (_) {}

    // v5.4.3 — Cumulative revision history list (Sonor canonical pattern).
    // v5.4.73 — Bryn directive 2026-05-10: "keep revision naming
    // conventions to numbers only starting at 00, 01, 02 etc, no
    // letters". Codes drop the architect-style "A" prefix and become
    // zero-padded sequential integers starting at 00. Index 0 → '00',
    // index 1 → '01', …, index 9 → '09', index 10 → '10' (no padding
    // beyond two digits — > 99 reverts to natural width). Each row maps to:
    //   { code: '00', label: 'ORIGINAL DRAFT', date: '03/04/2020' }
    // sorted oldest-first so the title block reads top-to-bottom
    // chronologically. The most recent revision drives the top-level
    // meta.revision field used by the existing painters.
    let revisionHistory = [];
    let resolvedRevision = revision;
    let resolvedRevDescription = '';
    try {
      const cache = (typeof window !== 'undefined' && window.__SONOR_TAKEOFF_REVISIONS_CACHE__) || null;
      if (Array.isArray(cache) && cache.length) {
        // Cache is newest-first; reverse to oldest-first then assign 00, 01…
        const rows = cache.slice().reverse();
        revisionHistory = rows.map((r, i) => {
          const code = String(i).padStart(2, '0');
          let dShort = '—';
          try {
            const d = new Date(r.created_at);
            dShort = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
          } catch (_) {}
          // v5.4.70 — pull per-revision freeform notes + per-status
          // cloud counts from metadata. Notes render as a sub-line on
          // PDF p2 revision history rows; counts feed the +/~/- pills.
          const meta = (r && r.metadata) || {};
          const counts = (meta && meta.counts) || {};
          return {
            code,
            label: String(r.label || '').toUpperCase(),
            date: dShort,
            takeoff_version: r.takeoff_version || '',
            as_built: !!r.as_built,
            notes: String(meta.notes || ''),
            // Per-row cloud counts (used by buildCablingInfoPage's
            // _section00_1 to populate add/move/remove pills inline
            // with each revision row instead of only the latest).
            added:   counts.added   != null ? Number(counts.added)   : null,
            moved:   counts.moved   != null ? Number(counts.moved)   : null,
            removed: counts.removed != null ? Number(counts.removed) : null,
            // Forward the raw revision id so cloud-text grouping (next
            // batch) can match clouds via sonorRevCloud.revisionId.
            id: r.id || null
          };
        });
        // Most recent revision drives the top-level revision code + description.
        const last = revisionHistory[revisionHistory.length - 1];
        if (last) {
          resolvedRevision = last.code;
          resolvedRevDescription = last.label;
        }
      }
    } catch (_) { /* offline / no cache — fall back to placeholder */ }

    // v5.4.12 — Surface LED colour specification grouped by colour mode
    // (Sonor canonical from Oak Bank Media Lighting RevA10 left-side
    // "LED COLOUR SPECIFICATION" block). Walks every LED run on every
    // floor and groups them by their colour-temperature category:
    //   RGBW  — RGB + Warm White colour change (strip-rgbw)
    //   RGB   — RGB colour change          (strip-rgb)
    //   WW    — Warm White                 (strip-ww + cove-warm)
    //   W     — Cool White                 (strip-w)
    //   ARCH  — Architectural feature      (cove)
    // Each entry carries the run ID + room so the painter can render
    // grouped lists like "RGBW: ROOF LANTERN A · ROOF LANTERN B / WW:
    // KITCHEN PLINTHS · LINEAR PROFILES".
    let ledColourSpec = { RGBW: [], RGB: [], WW: [], W: [], ARCH: [] };
    try {
      if (typeof floors !== 'undefined' && Array.isArray(floors)) {
        const LED_TO_GROUP = {
          'strip-rgbw': 'RGBW',
          'strip-rgb':  'RGB',
          'strip-ww':   'WW',
          'strip-w':    'W',
          'cove':       'ARCH'
        };
        floors.forEach(f => {
          if (Array.isArray(f && f.leds)) {
            f.leds.forEach(led => {
              const g = LED_TO_GROUP[led && led.ledId] || 'W';
              if (!ledColourSpec[g]) return;
              const id = (led.autoId && led.autoId.id) || led.id || '';
              const room = (led.autoId && led.autoId.roomName) || led.room || '';
              ledColourSpec[g].push({
                id, room,
                label: room ? (room + ' · ' + id) : id,
                metres: typeof led.metres === 'number' ? led.metres : null
              });
            });
          }
        });
      }
    } catch (_) {}

    // v5.4.10 — Surface 4K video distribution zones for the canonical Sonor
    // top-centre "4K VIDEO DISTRIBUTION ZONES" numbered list block (Oak
    // Bank Media Lighting RevA5 + RevA10). Walks the floors[] global
    // (host-scope) and emits an ordered list of rooms where zones.video
    // is set, tagged with floor + room name so the painter can render
    // "1) Formal Lounge (Media Room) · GF / 2) Kitchen / Dining · GF /
    // 3) Drawing Room · GF / 4) Master Bedroom · 1F".
    let videoZones = [];
    try {
      if (typeof floors !== 'undefined' && Array.isArray(floors)) {
        floors.forEach(f => {
          const fName = f && (f.code || f.name) || '';
          if (Array.isArray(f && f.areas)) {
            f.areas.forEach(area => {
              const z = area && area.zones;
              if (z && z.video) {
                videoZones.push({
                  floor: fName,
                  floorName: f && f.name || fName,
                  room: area.name || '—',
                  hasCinema: !!z.cinema,
                  hasMedia: !!z.media,
                  hasAudio: !!z.audio
                });
              }
            });
          }
        });
      }
    } catch (_) {}

    return {
      name, ref, client, address: addrParts, status,
      floor: floorName,
      date: dateIso, dateUk,
      scaleLabel, pxPerM,
      drawnBy,
      revision: resolvedRevision,
      revDescription: resolvedRevDescription,
      revisionHistory,
      revisionGeneralComments,   // v5.102.0 — glance-page GENERAL COMMENTS band
      dropboxFolder, cloudFolder,
      videoZones,
      ledColourSpec,
      // v2.1.0 — revision-cloud counts feed the title-block revision pills.
      // `revMoved` kept as alias of `revChanged` for back-compat with the
      // pre-v2.1.0 painter (which read meta.revMoved). Both painters now
      // render the pill as "Changed" semantically.
      revAdded, revChanged, revMoved: revChanged, revRemoved, revRfi, revNote,
      revCounts: _revCountsAll,   // v5.136.0/v5.143.0 — cover panel + footer pills
      appVersion: (typeof APP_VERSION === 'string') ? APP_VERSION : ''
    };
  }

  // ---- v5.4.11 — Sonor canonical rounded page-edge border ----
  // Every Sonor reference plan (Caldy / Oak Bank / Little Leigh / 43 CPS /
  // Gallops / MacFadyen) carries a thin rounded blue stroke around the
  // entire page — printer's-mark frame that distinguishes a Sonor
  // deliverable from a generic A3 export at a glance. Drawn first on
  // every page so subsequent painters (slate header band, content,
  // title block) sit on top. ~12pt inset from page edge, ~6pt corner
  // radius, light brand-aqua stroke at 0.5pt weight.
  function _paintPageBorder(pdf) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const inset = 8;
    _setStroke(pdf, '#a4c8e0');   // muted brand light-blue / aqua tint
    pdf.setLineWidth(0.6);
    pdf.roundedRect(inset, inset, pageW - inset * 2, pageH - inset * 2, 6, 6);
  }

  // ---- HEADER (top slate strip — Caldy convention) ----
  // 36pt tall slate-near-black strip with the document title in white
  // (Helvetica Bold). A 2pt service-colour accent line sits beneath as
  // a wayfinding cue. Caldy sample uses a single uppercase title only;
  // floor/date/revision live in the bottom title block, NOT here, so
  // the header reads cleanly at a glance.
  function paintHeader(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const aspect = opts.aspect || 'plan';
    const accent = ASPECT_ACCENT[aspect] || _svcAccentFromAspect(aspect) /* v5.144.0 */ || ASPECT_ACCENT.plan;
    const meta = opts.meta || {};

    // v5.4.11 — Page-edge rounded border behind everything.
    _paintPageBorder(pdf);

    // Slate bar
    _setFill(pdf, COLOURS.bar);
    pdf.rect(0, 0, pageW, 36, 'F');

    // v5.2.4 — Subtle highlight ribbon along the top of the slate band
    // (1pt mixed-with-white slate). Reads as polished pro-grade chrome
    // rather than a flat painted rect. Same depth treatment as the
    // schedule table header (v5.2.1).
    _setFill(pdf, _mixWithWhite(COLOURS.bar, 0.12));
    pdf.rect(0, 0, pageW, 1.2, 'F');

    // Service-accent stripe (2pt, calm — wayfinding only)
    _setFill(pdf, accent);
    pdf.rect(0, 36, pageW, 2, 'F');

    // v5.2.4 — Subtle accent shadow 4pt below the stripe (very-light
    // tint of the accent at 88% white-mix). Reads as a 3D depth cue
    // without competing with the accent itself.
    _setFill(pdf, _mixWithWhite(accent, 0.88));
    pdf.rect(0, 38.5, pageW, 0.6, 'F');

    // Title (uppercase, bold, surface-text on slate). Caldy uses
    // "COMBINED PLANS - Ground Floor" style — title + floor combined.
    _setText(pdf, COLOURS.surfaceTxt);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(14);
    let titleText = String(opts.title || '').toUpperCase();
    if (meta.floor && !/floor/i.test(titleText)) {
      titleText += '  -  ' + meta.floor;
    }
    pdf.text(titleText, 24, 23);

    // v1.23.0 — optional subtitle right-aligned (e.g. "Floor 1 of 3"
    // for multi-floor Full Plan exports). Lighter weight + smaller so
    // the title still owns the visual hierarchy.
    if (opts.subtitle) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(10);
      _setText(pdf, '#A8B0BC');  // text-faint on slate
      pdf.text(String(opts.subtitle), pageW - 24, 23, { align: 'right' });
    }
  }

  // ---- FOOTER (Caldy-style structured title block) ----
  // 100pt tall block at the bottom of every page. 5-column grid mirroring
  // the Caldy 15 reference exactly:
  //   COL A: Sonor wordmark + 10-service-colour dot strip + tagline
  //   COL B: Project — name (big), reference, drawing
  //   COL C: Revision — number, status, date, quote ref, drawn by, page X of Y
  //   COL D: Issue — based on / issue date / revision-notes pills (added/moved/removed)
  //   COL E: Disclaimer block (do not scale, contractor, copyright) + scale
  //
  // Cells are separated by hairline slate-tint dividers (0.4pt). Captions
  // are 7pt muted; values are 9-10pt bold slate. Section pills (Added/
  // Moved/Removed) use service-colour green/yellow/red with white text.
  function paintFooter(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const FH = 100;            // total title-block height
    const FY = pageH - FH;     // top edge
    const meta = opts.meta || {};
    // v1.71.0 — compute service-counts lazily when caller didn't supply them.
    // Walks the canvas once per footer paint (cheap — O(N) over symbols).
    // Powers the service-dot dimming so empty services recede visually.
    if (!opts.svcCounts && typeof canvas !== 'undefined') {
      try {
        const counts = {};
        canvas.getObjects().forEach(o => {
          if (o && o.sonorSymbol && o.sonorSymbol.service_nn) {
            const nn = String(o.sonorSymbol.service_nn).padStart(2, '0');
            counts[nn] = (counts[nn] || 0) + 1;
          }
          // Cables / LEDs also count toward their service
          if (o && o.sonorMeasure) {
            const k = o.sonorMeasure.kind;
            if (k === 'length' || k === 'led') {
              const nn = (k === 'length') ? '10' : '04';  // cables → infra, LEDs → lighting
              counts[nn] = (counts[nn] || 0) + 1;
            }
          }
        });
        opts.svcCounts = counts;
      } catch (e) { /* non-fatal */ }
    }

    // Top divider — hairline above the block
    _setStroke(pdf, COLOURS.borderHard);
    pdf.setLineWidth(0.6);
    pdf.line(0, FY, pageW, FY);

    // v5.2.5 — Accent stripe just below the top divider, mirroring the
    // header band's accent treatment. Ties the footer wayfinding to the
    // page's aspect colour so each page reads as a coherent ribbon (slate
    // header → accent stripe at top + accent stripe + slate footer at
    // bottom). Defaults to slate plan-accent when caller doesn't pass
    // opts.aspect (e.g. cover page).
    {
      const fAspect = opts.aspect || 'plan';
      const fAccent = ASPECT_ACCENT[fAspect] || ASPECT_ACCENT.plan;
      _setFill(pdf, fAccent);
      pdf.rect(0, FY + 1, pageW, 1.5, 'F');
      // Subtle shadow beneath the accent stripe (matches paintHeader v5.2.4
      // depth treatment — same chrome top + bottom).
      _setFill(pdf, _mixWithWhite(fAccent, 0.88));
      pdf.rect(0, FY + 2.8, pageW, 0.5, 'F');
    }

    // v1.26.0 — 5-column geometry as page-width FRACTIONS so the footer
    // fits both A4 portrait (595pt) and A3 landscape (1190pt) without
    // overflow. Pre-fix used absolute widths (156+200+152+pageW*0.30)
    // which summed to ~686pt — fits A3 fine but the disclaimer column
    // ran ~91pt off-page on A4, breaking every per-aspect PDF (which
    // are A4 portrait). Fractions sum to 1.00 exactly so column widths
    // scale linearly with page size. Ratios tuned to give the disclaimer
    // (10 lines of small text) and Project (name + ref + address) the
    // most room, while keeping the Sonor branding column compact.
    // v1.26.0 — page-width awareness. A3 landscape (1190pt) gets the
    // full Caldy treatment; A4 portrait (595pt) gets compact wordmark
    // + symbolic revision pills (+/~/-) so the disclaimer doesn't get
    // squeezed off-page. Detection threshold 800pt comfortably splits
    // both standard sizes.
    const isWide = pageW > 800;
    const M = 0;                                    // bleed to page edge (matches Caldy)
    const colA = pageW * 0.14;                      // Sonor branding (compact)
    const colB = pageW * 0.22;                      // Project (name + ref + address)
    const colC = pageW * 0.22;                      // Revision (6-row key/value + Status pill needs ~130pt min on A4)
    const colD = pageW * 0.20;                      // Issue (Based-on + 3 revision pills)
    const colE = pageW - colA - colB - colC - colD - M * 2;  // Disclaimer (the rest, ~0.22)
    const xA = M;
    const xB = xA + colA;
    const xC = xB + colB;
    const xD = xC + colC;
    const xE = xD + colD;

    // Vertical dividers between cells
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.5);
    [xB, xC, xD, xE].forEach(x => pdf.line(x, FY, x, pageH - 22));

    // Bottom strip — page reference + Dropbox link line (caldy convention)
    const STRIP_Y = pageH - 22;
    _setStroke(pdf, COLOURS.border);
    pdf.line(0, STRIP_Y, pageW, STRIP_Y);

    // ---- COL A — Branding ----
    // v1.28.0 — proper Sonor wordmark embedded as PNG via
    // window.__SONOR_WORDMARK_PDF__ (data URL preloaded by
    // data/sonor-pdf-wordmark.js). The text fallback ('SONOR' helvetica
    // bold) only fires if the wordmark asset isn't loaded — defensive
    // for offline / asset-stripped environments. Dimensions scale to
    // colA so it fits both A3 (167pt) and A4 (83pt) without overflow.
    const padA = isWide ? 18 : 8;
    // v5.4.47 — white wordmark variant on dark footer chrome (Bryn 2026-05-08).
    const wmDataUrl = window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__;
    const wmDim     = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
    if (wmDataUrl) {
      // Target wordmark width = colA - padA*2 (max 110pt to keep visual proportion);
      // height scales from intrinsic 300×85 ratio (~3.53:1)
      const targetW = Math.min(110, colA - padA * 2);
      const targetH = targetW * (wmDim.h / wmDim.w);
      try {
        // v2.3.3 — alias 'wordmark-sonor' triggers jsPDF image dedup (maintainer-confirmed
        // in jsPDF >= 1.4: same alias = embed bytes once, reference N times). Wordmark
        // appears on every footer of every page, so this is the biggest dedup win.
        pdf.addImage(wmDataUrl, 'PNG', xA + padA, FY + 14, targetW, targetH, 'wordmark-sonor');
      } catch (e) {
        console.warn('[SonorPdf] wordmark addImage failed, falling back to text:', e);
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(isWide ? 20 : 16);
        _setText(pdf, COLOURS.text);
        pdf.text('SONOR', xA + padA, FY + 36);
      }
    } else {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(isWide ? 20 : 16);
      _setText(pdf, COLOURS.text);
      pdf.text('SONOR', xA + padA, FY + 36);
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.muted);
      pdf.text('Smart Homes', xA + padA, FY + 48);
    }

    // 10-service-colour dot strip — pitch scales to fit colA width.
    // v1.71.0 — service dots dim to ~25% opacity when the project has
    // zero placements in that service (read from opts.svcCounts when
    // provided by the caller). Active services pop visually; the empty
    // ones recede. Counts sourced from `_collectFooterSvcCounts(places)`
    // which the per-page caller supplies; falls back to all-active
    // colouring when not supplied (per-aspect pages don't always have
    // a cross-service summary handy).
    const dots = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10) : [];
    const dotPitch = Math.max(6, Math.min(12, (colA - padA * 2) / dots.length));
    const dotR     = Math.max(2.4, Math.min(3.6, dotPitch / 3.5));
    let dx = xA + padA;
    const dy = FY + 64;
    const svcCounts = (opts && opts.svcCounts && typeof opts.svcCounts === 'object') ? opts.svcCounts : null;
    dots.forEach((s, i) => {
      const nn = String(i + 1).padStart(2, '0');
      const hasContent = svcCounts ? ((svcCounts[nn] || 0) > 0) : true;
      const baseColour = s.colour || '#999';
      // Dim inactive services by mixing 75% white into the colour
      const fillCol = hasContent ? baseColour : _mixWithWhite(baseColour, 0.75);
      _setFill(pdf, fillCol);
      pdf.circle(dx + dotPitch / 2, dy, dotR, 'F');
      dx += dotPitch;
    });
    // v5.3.7 — Tagline shortened "Smart homes, beautifully done" → "Smart homes"
    // per Bryn directive (remove the "beautifully done" part). Wordmark + dots
    // + this short tagline now carry the brand identity in the footer.
    if (colA > 90) {
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(7);
      _setText(pdf, COLOURS.muted);
      pdf.text('Smart homes', xA + padA, FY + 80);
    }

    // ---- COL B — Project ----
    _drawCellCaption(pdf, 'Project:', xB + 8, FY + 14);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(13);
    _setText(pdf, COLOURS.text);
    const projTitle = meta.name || '—';
    pdf.text(_truncate(pdf, projTitle, colB - 16), xB + 8, FY + 30);
    if (meta.ref) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(9);
      _setText(pdf, COLOURS.muted);
      pdf.text(_truncate(pdf, String(meta.ref), colB - 16), xB + 8, FY + 43);
    }
    if (meta.address) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text2);
      pdf.text(_truncate(pdf, meta.address, colB - 16), xB + 8, FY + 55);
    }
    // Drawing sub-cell — v1.32.0 — tightened up so the value at FY+82
    // doesn't visually clip the bottom strip at FY+91 (= pageH-9).
    // Earlier was caption FY+75 + value FY+88 → 9pt font extending
    // into the bottom strip area.
    _drawCellCaption(pdf, 'Drawing:', xB + 8, FY + 70);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10);
    _setText(pdf, COLOURS.text);
    pdf.text(_truncate(pdf, String(opts.title || 'TAKEOFF').toUpperCase(), colB - 16), xB + 8, FY + 82);

    // ---- COL C — Revision / Status / Date / Quote / Drawn / Page ----
    // 3 rows × 2 columns of small key-value pairs
    const cellRows = [
      { label: 'Revision:',  value: meta.revision || '00',                     bold: true },
      { label: 'Status:',    value: meta.status   || 'DRAFT',                  bold: true,  pill: true },
      { label: 'Date:',      value: meta.dateUk   || meta.date || '—',         bold: false },
      { label: 'Quote Ref:', value: meta.ref      || '—',                      bold: false },
      { label: 'Drawn By:',  value: meta.drawnBy  || '—',                      bold: false },
      { label: 'Page:',      value: opts.pageTotal ? `${opts.pageNum} of ${opts.pageTotal}` : String(opts.pageNum || 1), bold: false }
    ];
    const cellH = 13;
    cellRows.forEach((r, i) => {
      const ry = FY + 14 + i * cellH;
      _drawCellCaption(pdf, r.label, xC + 8, ry);
      // Value placed inline to the right
      const labW = 56;
      if (r.pill && r.value) {
        // Status pill — slate filled, white text
        const pillTxt = String(r.value).toUpperCase();
        const pillW = pdf.getTextWidth(pillTxt) + 12;
        _setFill(pdf, COLOURS.text);
        pdf.roundedRect(xC + 8 + labW, ry - 8, pillW, 11, 2, 2, 'F');
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(7);
        _setText(pdf, COLOURS.surfaceTxt);
        pdf.text(pillTxt, xC + 8 + labW + 6, ry - 1);
      } else {
        pdf.setFont(_pdfFontFamily(), r.bold ? 'bold' : 'normal');
        pdf.setFontSize(9);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, String(r.value), colC - labW - 16), xC + 8 + labW, ry);
      }
      // v5.4.25 — Register the "Page:" cell-value stamp so
      // _finalisePagination rewrites it with the deck-wide page count.
      // Pre-v5.4.25 only the slim bottom-strip stamp was registered, so
      // schedule pages showed correct "Page 17 of 26" at the very bottom
      // but stale "Page: 15 of 13" in this title-block cell (the
      // aspect-internal count). Both stamps now rewrite together.
      if (r.label === 'Page:') {
        try {
          pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
          pdf.__sonorPageStamps__.push({
            page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                    ? pdf.internal.getCurrentPageInfo().pageNumber
                    : pdf.internal.pages.length - 1),
            x: xC + 8 + labW, y: ry,
            clearW: 70, clearH: 12, clearOffsetY: -8,
            format: 'count-of',           // "N of T"
            fontSize: 9, bold: false,
            source: 'paintfooter-cell'
          });
        } catch (_) { /* non-fatal */ }
      }
    });

    // ---- COL D — Issue / Revision Notes ----
    _drawCellCaption(pdf, 'Based on issued plans:', xD + 8, FY + 14);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(9);
    _setText(pdf, COLOURS.text);
    pdf.text(_truncate(pdf, meta.basedOn || '—', colD - 16), xD + 8, FY + 27);

    _drawCellCaption(pdf, 'Issue Date:', xD + 8, FY + 42);
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(9);
    _setText(pdf, COLOURS.text);
    pdf.text(meta.dateUk || meta.date || '—', xD + 8 + 56, FY + 42);

    _drawCellCaption(pdf, 'Revision Notes:', xD + 8, FY + 56);
    // Pills: Added (green) Moved (yellow) Removed (red) RFI (purple).
    // v1.26.0 — symbolic labels (+/~/-/?) on narrow pages so the pills
    // fit inside colD without overflow. A3 keeps the verbose Caldy
    // labels (Added/Moved/Removed/RFI) as full words.
    const pills = isWide
      ? [
          { label: 'Added',   count: meta.revAdded   != null ? meta.revAdded   : 0, hex: '#78ba57' },
          { label: 'Moved',   count: meta.revMoved   != null ? meta.revMoved   : 0, hex: '#f5d05c' },
          { label: 'Removed', count: meta.revRemoved != null ? meta.revRemoved : 0, hex: '#ec6061' },
          { label: 'RFI',     count: meta.revRfi     != null ? meta.revRfi     : 0, hex: '#8058a1' },
          { label: 'Note',    count: meta.revNote    != null ? meta.revNote    : 0, hex: '#302f2e' }
        ]
      : [
          { label: '+', count: meta.revAdded   != null ? meta.revAdded   : 0, hex: '#78ba57' },
          { label: '~', count: meta.revMoved   != null ? meta.revMoved   : 0, hex: '#f5d05c' },
          { label: '-', count: meta.revRemoved != null ? meta.revRemoved : 0, hex: '#ec6061' },
          { label: '?', count: meta.revRfi     != null ? meta.revRfi     : 0, hex: '#8058a1' },
          { label: 'i', count: meta.revNote    != null ? meta.revNote    : 0, hex: '#302f2e' }
        ];
    let pX = xD + 8;
    const pY = FY + 70;
    pills.forEach(p => {
      const txt = `${p.label}  ${p.count}`;
      const w = pdf.getTextWidth(txt) + 12;
      _setStroke(pdf, p.hex);
      pdf.setLineWidth(1);
      pdf.roundedRect(pX, pY - 9, w, 13, 2, 2);
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8);
      _setText(pdf, p.hex);
      pdf.text(txt, pX + 6, pY);
      pX += w + 4;
    });

    // ---- COL E — Disclaimer + Scale ----
    // v1.26.0 — disclaimer auto-wraps to colE width via jsPDF
    // splitTextToSize. On A3 landscape (colE ~262pt) the original 10-line
    // Caldy form fits one bullet per line; on A4 portrait (colE ~131pt)
    // each bullet wraps to 2-3 lines. Line height tightens proportionally.
    // 4 disclaimer paragraphs (do-not-scale / use-with-specs / installation /
    // copyright). Hard cap at ~70pt vertical so Scale row at FY+92 stays
    // visible — anything past gets truncated rather than overlap.
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(isWide ? 7 : 6);
    _setText(pdf, COLOURS.muted);
    const lineH = isWide ? 8 : 6.5;
    const wrapW = colE - 16;
    const paragraphs = [
      '· Do not scale from this drawing — all dimensions to be confirmed on-site prior to commencement of work and associated manufacturing.',
      '· This drawing should be used in conjunction with relevant specifications and documentation issued by Sonor Ltd or third parties. The contractor is responsible for assimilating the information and reporting any discrepancies prior to work commencing.',
      '· The installation team is responsible for ensuring all works comply with local authority requirements and national regulations.',
      '· Copyright of this drawing is owned by Sonor Ltd. This document is confidential — its contents should be treated with the utmost consideration and in no circumstances disclosed, distributed, published or copied without the prior written consent of Sonor Ltd.'
    ];
    let discY = FY + 12;
    // v1.27.0 — disclaimer cap tightened from FY+84 to FY+74 so wrapped
    // text never bleeds into the Scale row (FY+92) or the bottom strip
    // (pageH-9 ≈ FY+91 since FY=pageH-100). On A4 portrait the disclaimer
    // wraps to 2-3 lines per paragraph; tighter cap means we may show
    // fewer paragraphs but the layout stays clean — the full disclaimer
    // travels with the JSON/CSV exports anyway.
    const discYMax = FY + 74;
    for (let p = 0; p < paragraphs.length && discY < discYMax; p++) {
      const wrapped = (typeof pdf.splitTextToSize === 'function')
        ? pdf.splitTextToSize(paragraphs[p], wrapW)
        : [paragraphs[p]];
      for (let li = 0; li < wrapped.length && discY < discYMax; li++) {
        pdf.text(wrapped[li], xE + 8, discY);
        discY += lineH;
      }
    }

    // Scale — bottom of disclaimer column (always visible above the
    // bottom strip regardless of how much disclaimer fit). v1.27.0 —
    // moved up from FY+92 (which sat at pageH-8, overlapping the
    // bottom strip at pageH-9) to FY+82, comfortably above STRIP_Y
    // at pageH-22.
    _drawCellCaption(pdf, 'Scale:', xE + 8, FY + 82);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(9);
    _setText(pdf, COLOURS.text);
    pdf.text(meta.scaleLabel || 'N/A', xE + 8 + 36, FY + 82);

    // ---- Bottom strip (Page reference + Dropbox/version line) ----
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text(COMPANY.web + '  ·  ' + COMPANY.email + '  ·  ' + COMPANY.phone, 12, pageH - 9);
    const pageStr = opts.pageTotal ? `Page ${opts.pageNum} of ${opts.pageTotal}` : `Page ${opts.pageNum || 1}`;
    pdf.text(pageStr + '   ·   Sonor Takeoffs v' + (meta.appVersion || ''), pageW - 12, pageH - 9, { align: 'right' });

    // v5.5.69 — Debug build stamp (5pt grey, left-aligned just above the
    // contact strip). Visually inconspicuous but extractable from any PDF
    // via `pdftotext`. Encodes engine + cover-path + ISO timestamp + kind
    // so any export's exact code path is identifiable from the file alone.
    // Decode in shell: pdftotext file.pdf - | grep 'SONOR-BUILD:'
    try {
      pdf.setFontSize(5);
      _setText(pdf, COLOURS.faint);
      const stamp = _buildStamp({
        meta, kind: opts.title || 'page', engine: 'jsPDF'
      });
      pdf.text(stamp, 12, pageH - 2);
    } catch (_) {}

    // v2.0.1 — register the bottom-strip stamp so _finalisePagination
    // rewrites it with the final page total. (Source = 'footer'.)
    try {
      pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
      pdf.__sonorPageStamps__.push({
        page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                ? pdf.internal.getCurrentPageInfo().pageNumber
                : pdf.internal.pages.length - 1),
        x: pageW - 12, y: pageH - 9,
        clearW: 220, clearH: 14, clearOffsetY: -9,
        format: 'footer-page-of-version',
        appVersion: meta.appVersion || '',
        align: 'right',
        fontSize: 7, bold: false,
        source: 'footer'
      });
    } catch (_) { /* non-fatal */ }
  }

  // Small helper — draws a 7pt muted caption like "Project:" / "Revision:"
  function _drawCellCaption(pdf, text, x, y) {
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text(String(text || ''), x, y);
  }

  // ---- LEGEND (boxed key for plan PDFs) ----
  // Renders an inset white-on-tint box keyed to active service colours
  // present on the canvas. Used by SonorPdf.plan().
  function paintLegend(pdf, opts) {
    const x = opts.x || 24;
    const y = opts.y || 80;
    const w = opts.w || 180;
    const items = Array.isArray(opts.items) ? opts.items : [];
    if (!items.length) return 0;

    // v1.34.0 — Legend supports two row kinds:
    //   'group' (service header — coloured underline strip) /
    //   'group' level='sub' (sub-service caption — muted) /
    //   'item' (block with qty)
    // Mirrors SonorLibrary palette ordering + Live Takeoffs RHS panel.
    // Heights per kind:
    const ROW_ITEM   = 12;
    const ROW_SVC    = 16;  // service header — bold uppercase + colour bar
    const ROW_SUB    = 11;  // sub header   — small caps muted
    const PAD_TOP    = 6;
    const PAD_BOTTOM = 6;

    // Title bar
    _setFill(pdf, COLOURS.tint);
    pdf.rect(x, y, w, 16, 'F');
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.4);
    pdf.rect(x, y, w, 16);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text);
    pdf.text('LEGEND', x + 6, y + 11);

    // Compute body height
    const heights = items.map(it => {
      if (it.kind === 'group') return (it.level === 'sub') ? ROW_SUB : ROW_SVC;
      return ROW_ITEM;
    });
    const bodyH = heights.reduce((a, h) => a + h, 0) + PAD_TOP + PAD_BOTTOM;

    // Body container
    pdf.setDrawColor(212, 206, 194);
    pdf.rect(x, y + 16, w, bodyH);

    // Walk rows
    let cursorY = y + 16 + PAD_TOP;
    items.forEach((it, i) => {
      const h = heights[i];
      if (it.kind === 'group' && it.level !== 'sub') {
        // Service header — coloured 2px underline + bold uppercase NN · Name
        const baseline = cursorY + h - 5;
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(8.5);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, String(it.label || '').toUpperCase(), w - 12), x + 6, baseline);
        // Service colour stripe under text
        _setFill(pdf, it.colour || '#999');
        pdf.rect(x + 6, baseline + 2, w - 12, 1.4, 'F');
      } else if (it.kind === 'group' && it.level === 'sub') {
        // Sub-service header — muted small caps
        const baseline = cursorY + h - 3;
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(7);
        _setText(pdf, COLOURS.muted);
        pdf.text(_truncate(pdf, String(it.label || '').toUpperCase(), w - 16), x + 12, baseline);
      } else {
        // Item row — coloured chip + label + qty
        // v5.4.8 — Chip respects item.shape (Sonor canonical so legend
        // chips match the actual symbol shape drawn on canvas, per Oak
        // Bank Media Lighting RevA10 right-side legend convention):
        //   'circle' (default — speakers, sensors, blocks)
        //   'square' (TVs, displays, lighting keypads)
        //   'diamond' (floor-mounted)
        //   'rectH'   (TV / display panel — wider rectangle)
        //   'line'    (motorised curtain / blind / cable run swatch)
        //   'pill'    (touchscreen / intercom — rounded rect)
        //   'pin'     (PIR / motion sensor)
        // Bigger chip too (radius 3 → 4) so it reads on print.
        const baseline = cursorY + h - 3;
        const cx = x + 14;
        const cy = baseline - 3;
        const fill = it.colour || '#999';
        const shape = String(it.shape || 'circle').toLowerCase();
        _setFill(pdf, fill);
        _setStroke(pdf, COLOURS.text);
        pdf.setLineWidth(0.4);
        if (shape === 'square') {
          pdf.rect(cx - 4, cy - 4, 8, 8, 'FD');
        } else if (shape === 'diamond') {
          pdf.lines([[4, -4], [4, 4], [-4, 4], [-4, -4]], cx - 4, cy, [1, 1], 'FD', true);
        } else if (shape === 'recth' || shape === 'panel') {
          pdf.rect(cx - 6, cy - 3, 12, 6, 'FD');
        } else if (shape === 'pill') {
          pdf.roundedRect(cx - 6, cy - 3, 12, 6, 2, 2, 'FD');
        } else if (shape === 'line' || shape === 'cable') {
          // Thicker stroke as a horizontal swatch (~3pt cap)
          pdf.setLineWidth(2.5);
          _setStroke(pdf, fill);
          pdf.line(cx - 6, cy, cx + 6, cy);
          pdf.setLineWidth(0.4);
          _setStroke(pdf, COLOURS.text);
        } else if (shape === 'pin') {
          // Filled circle with white inner dot
          pdf.circle(cx, cy, 4, 'FD');
          _setFill(pdf, '#FFFFFF');
          pdf.circle(cx, cy, 1.4, 'F');
        } else {
          pdf.circle(cx, cy, 4, 'FD');
        }
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(8);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, String(it.label || ''), w - 46), x + 24, baseline);
        if (it.qty != null) {
          // v5.4.8 — qty bold + colour-matched so the number visually echoes
          // the service. Falls back to text colour when qty would be too
          // light against the body fill (yellow on body looks bad).
          pdf.setFont(_pdfFontFamily(), 'bold');
          // Colour-match unless yellow (low contrast against tint body)
          const yellowish = /^#?(f5d05c|f5cf5c|f1c40f|f3c93f)$/i.test(String(fill).replace('#',''));
          _setText(pdf, yellowish ? COLOURS.text : fill);
          pdf.text('×' + it.qty, x + w - 6, baseline, { align: 'right' });
          pdf.setFont(_pdfFontFamily(), 'normal');
          _setText(pdf, COLOURS.text);
        }
      }
      cursorY += h;
    });
    return 16 + bodyH;  // total drawn height
  }

  // ---- DRAWING KEY (v5.1.7) ----
  // Compact reference panel rendered above the per-floor LEGEND in the
  // right-side inset column of plan pages. Shows the symbol mounting
  // outlines, pre-wire indicator, and the canonical AA-S-02 cable ID
  // format with annotated parts. Mirrors the right-panel key seen in
  // canonical Sonor reference packs.
  //
  // The key is intentionally compact (~96pt tall at width 200pt) so it
  // sits above the existing LEGEND + FLOOR TOTALS + NOTES stack without
  // pushing the plan canvas into letterbox territory.
  //
  // opts: { x, y, w }  →  returns total drawn height (so the caller can
  //                       advance insetY downward).
  function paintDrawingKey(pdf, opts) {
    const x = opts.x || 24;
    const y = opts.y || 80;
    const w = opts.w || 200;

    const TITLE_H = 16;
    const SECTION_GAP = 4;
    const ROW_H = 12;
    const PAD_X = 6;
    const PAD_TOP = 4;
    const PAD_BOTTOM = 6;

    // Mounting rows: outline shape + label
    const mountRows = [
      { shape: 'circle',  label: 'Ceiling-mounted' },
      { shape: 'square',  label: 'Wall-mounted' },
      { shape: 'diamond', label: 'Floor-mounted' },
      { shape: 'dashed',  label: 'Pre-wire only' }
    ];
    const mountSectionH = mountRows.length * ROW_H + PAD_TOP + PAD_BOTTOM + 10;

    // v5.2.0 — Cable type colour-code swatches. Reuses the same 6-letter
    // type taxonomy used in the AA-S-02 cable ID format. Colours mirror
    // the per-aspect accent map so the cable colour-coding convention is
    // self-documenting on every plan page.
    // v5.4.25 — Drawing Key swatches NOW MATCH the actual CABLE_TYPES
    // colours used on canvas. Pre-v5.4.25 the Drawing Key invented its
    // own colours that didn't match the lines the installer would
    // actually see drawn on the plan (e.g. Speaker shown as RED in the
    // key but the plan rendered SP2/SP4 cable as PURPLE). Now the
    // swatches are a true reference legend:
    //
    //   S Speaker   PURPLE    matches CABLE_TYPES.sp2 / sp4 (#8058a1)
    //   V Video     GREEN     matches CABLE_TYPES.hdmi (#78ba57)
    //   D Data      AQUA      matches CABLE_TYPES.cat6d / cat6p (#4bb9d3)
    //   C Coax      TERRACOTTA matches CABLE_TYPES.coax (#e37c59)
    //   K Control   PINK      matches CABLE_TYPES.ctrl (#e67eb1) [Cresnet/keypad]
    //   L Lighting  YELLOW    matches CABLE_TYPES.lkp (#f5d05c)
    //
    // The "A Audio" row was always misleading (no Audio cable category
    // exists in CABLE_TYPES — speaker IS the audio cable) so it's
    // dropped. "Lighting" added so the LKP yellow line on plans has
    // a key entry. Order keeps the AA-S-02 cable-letter convention.
    const cableRows = [
      { letter: 'S', label: 'Speaker',  colour: '#8058a1' },  // sp2/sp4 purple
      { letter: 'V', label: 'Video',    colour: '#78ba57' },  // hdmi green
      { letter: 'D', label: 'Data',     colour: '#4bb9d3' },  // cat6d aqua
      { letter: 'C', label: 'Coax',     colour: '#e37c59' },  // coax terracotta
      { letter: 'K', label: 'Control',  colour: '#e67eb1' },  // ctrl pink (was 'Cresnet')
      { letter: 'L', label: 'Lighting', colour: '#f5d05c' }   // lkp yellow
    ];
    const cableSectionH = cableRows.length * ROW_H + PAD_TOP + PAD_BOTTOM + 10;

    // Cable ID format section: 1 caption row + worked example row
    const idSectionH = 36 + PAD_BOTTOM;

    const totalH = TITLE_H + mountSectionH + SECTION_GAP + cableSectionH + SECTION_GAP + idSectionH;

    // Title bar
    _setFill(pdf, COLOURS.tint);
    pdf.rect(x, y, w, TITLE_H, 'F');
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.4);
    pdf.rect(x, y, w, TITLE_H);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text);
    pdf.text('DRAWING KEY', x + PAD_X, y + 11);

    // Body container
    pdf.setDrawColor(212, 206, 194);
    pdf.rect(x, y + TITLE_H, w, mountSectionH + SECTION_GAP + cableSectionH + SECTION_GAP + idSectionH);

    // ---- Mounting section ----
    let cursorY = y + TITLE_H + PAD_TOP;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('MOUNTING', x + PAD_X, cursorY + 6, { charSpace: 0.6 });
    cursorY += 10;

    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7.5);
    mountRows.forEach(row => {
      const cx = x + PAD_X + 6;
      const cy = cursorY + ROW_H / 2;
      _setStroke(pdf, COLOURS.text);
      pdf.setLineWidth(0.6);
      _setFill(pdf, '#FFFFFF');
      if (row.shape === 'circle') {
        pdf.circle(cx, cy, 3.5, 'FD');
      } else if (row.shape === 'square') {
        pdf.rect(cx - 3.5, cy - 3.5, 7, 7, 'FD');
      } else if (row.shape === 'diamond') {
        // Diamond: rotated square (4-point poly via lines)
        const d = 4;
        pdf.lines([[d, -d], [d, d], [-d, d], [-d, -d]], cx - d, cy, [1, 1], 'FD', true);
      } else if (row.shape === 'dashed') {
        // Pre-wire = dashed square
        if (typeof pdf.setLineDashPattern === 'function') {
          pdf.setLineDashPattern([1.4, 1.2], 0);
        }
        pdf.rect(cx - 3.5, cy - 3.5, 7, 7, 'FD');
        if (typeof pdf.setLineDashPattern === 'function') {
          pdf.setLineDashPattern([], 0);  // reset
        }
      }
      _setText(pdf, COLOURS.text);
      pdf.text(_truncate(pdf, row.label, w - 24), x + PAD_X + 16, cy + 2.5);
      cursorY += ROW_H;
    });

    // ---- v5.2.0 — Cable types section (colour-coded swatches) ----
    cursorY += SECTION_GAP;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('CABLE TYPES', x + PAD_X, cursorY + 6, { charSpace: 0.6 });
    cursorY += 10;
    cableRows.forEach(row => {
      const cx = x + PAD_X + 6;
      const cy = cursorY + ROW_H / 2;
      // Coloured rounded chip (4pt × 7pt — like a cable strand cross-section)
      _setFill(pdf, row.colour);
      pdf.roundedRect(cx - 4, cy - 3, 8, 6, 1, 1, 'F');
      // Big letter centred on the chip in white bold
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(6.5);
      _setText(pdf, '#FFFFFF');
      pdf.text(row.letter, cx, cy + 2, { align: 'center' });
      // Label
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.text);
      pdf.text(_truncate(pdf, row.label, w - 32), x + PAD_X + 18, cy + 2.5);
      cursorY += ROW_H;
    });

    // ---- Cable ID format section ----
    cursorY += SECTION_GAP;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('CABLE ID FORMAT', x + PAD_X, cursorY + 6, { charSpace: 0.6 });
    cursorY += 10;

    // Worked example: AA-S-02 (large, centred, branded)
    const codeText = 'AA-S-02';
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(15);
    _setText(pdf, COLOURS.text);
    const codeW = pdf.getTextWidth(codeText);
    const codeX = x + (w - codeW) / 2;
    pdf.text(codeText, codeX, cursorY + 12);
    cursorY += 16;

    // Annotation line below
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(6.5);
    _setText(pdf, COLOURS.muted);
    pdf.text('floor · room · type · NN', x + w / 2, cursorY + 6, { align: 'center' });

    return totalH;
  }

  // ---- SCALE BAR ----
  // Draws a small visual scale bar (5m / 10m) anchored at (x, y).
  // Honors the plan's scalePxPerM. Returns drawn width.
  function paintScaleBar(pdf, opts) {
    const x = opts.x || 24;
    const y = opts.y || 100;
    const meta = opts.meta || {};
    const targetM = opts.metres || 5;

    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    pdf.text('Scale:', x, y);

    // Bar — segmented (alternating fills) for a CAD-style scale graphic
    const barX = x + 28;
    const barW = 90;
    const barH = 6;
    _setStroke(pdf, COLOURS.text);
    pdf.setLineWidth(0.6);
    pdf.rect(barX, y - barH + 1, barW, barH);
    // 5 segments (each = targetM/5)
    const segW = barW / 5;
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) {
        _setFill(pdf, COLOURS.text);
        pdf.rect(barX + i * segW, y - barH + 1, segW, barH, 'F');
      }
    }
    // Tick labels
    _setText(pdf, COLOURS.muted);
    pdf.setFontSize(7);
    pdf.text('0', barX, y + 8);
    pdf.text(String(targetM) + ' m', barX + barW, y + 8, { align: 'right' });
    if (meta.pxPerM) {
      pdf.text('1m = ' + meta.pxPerM.toFixed(1) + ' px', barX + barW + 6, y);
    }
    return barW + 28;
  }

  // ---- v5.3.3 — NORTH ARROW (architectural drawing convention) ----
  // Compact north arrow rendered next to the scale bar on every plan
  // page. Standard CAD convention — every architectural plan needs a
  // wayfinding compass mark. Renders as a stylised arrow + circle:
  //   ▲ pointing UP (page north — the same direction as the architect's
  //     issued plan), with a tiny "N" label inside a circle around it.
  // 26pt wide × 32pt tall — sits comfortably next to the scale bar.
  function paintNorthArrow(pdf, opts) {
    const x = opts.x || 24;
    const y = opts.y || 100;
    const size = opts.size || 18;  // outer circle diameter
    const r = size / 2;
    const cx = x + r;
    const cy = y - r;  // y is baseline reference; circle centre sits ABOVE

    // Outer circle (slate stroke, white fill)
    _setStroke(pdf, COLOURS.text);
    pdf.setLineWidth(0.8);
    _setFill(pdf, '#FFFFFF');
    pdf.circle(cx, cy, r, 'FD');

    // Arrow tip (slate-filled triangle pointing up)
    const arrW = r * 0.65;
    const arrTipY = cy - r * 0.6;     // tip near top of circle
    const arrBaseY = cy + r * 0.55;   // base near bottom
    _setFill(pdf, COLOURS.text);
    pdf.lines(
      [[arrW, arrBaseY - arrTipY], [-arrW * 2, 0], [arrW, arrTipY - arrBaseY]],
      cx, arrTipY,
      [1, 1], 'F', true
    );

    // Tiny "N" label below the arrow tip (white, on the dark arrow body)
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(5.5);
    _setText(pdf, '#FFFFFF');
    pdf.text('N', cx, cy + r * 0.15, { align: 'center' });

    // Caption underneath the circle
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('North', cx, y + 8, { align: 'center' });

    return size + 4;  // total drawn width
  }

  // ---- TOTAL SUMMARY CHIP ----
  // Boxed key/value summary table (Caldy Shade Take-Off "Total Count" style).
  // rows: array of { label, value, accent? }
  function paintSummary(pdf, opts) {
    const x = opts.x || 24;
    const y = opts.y || 80;
    const w = opts.w || 200;
    const accent = opts.accent || COLOURS.accent;
    const title = opts.title || 'Summary';
    const rows = Array.isArray(opts.rows) ? opts.rows : [];
    const rowH = 13;

    // Title
    _setFill(pdf, accent);
    pdf.rect(x, y, w, 16, 'F');
    // v5.3.1 — Subtle 1pt highlight along the top of the chip header,
    // mirroring the schedule table header polish (v5.2.1) + the page
    // header polish (v5.2.4). Consistent depth treatment across every
    // accent-coloured strip in the deck.
    _setFill(pdf, _mixWithWhite(accent, 0.18));
    pdf.rect(x, y, w, 1.0, 'F');
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(9);
    _setText(pdf, '#FFFFFF');
    pdf.text(String(title).toUpperCase(), x + 6, y + 11);

    // Rows
    const bodyH = Math.max(1, rows.length) * rowH;
    pdf.setDrawColor(212, 206, 194);
    pdf.setLineWidth(0.4);
    pdf.rect(x, y + 16, w, bodyH);
    // v5.3.1 — slim accent left-edge bar matching group-separator style
    // (1.5pt wide, full body height). Ties the summary chip visually to
    // the schedule table sections below.
    _setFill(pdf, accent);
    pdf.rect(x, y + 16, 1.5, bodyH, 'F');

    rows.forEach((r, i) => {
      const ry = y + 16 + (i + 0.7) * rowH;
      if (i % 2 === 1) {
        _setFill(pdf, COLOURS.altRow);
        pdf.rect(x, y + 16 + i * rowH, w, rowH, 'F');
      }
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text);
      pdf.text(_truncate(pdf, String(r.label || ''), w / 2 - 8), x + 6, ry);
      pdf.setFont(_pdfFontFamily(), 'bold');
      _setText(pdf, r.accent || COLOURS.text);
      pdf.text(_truncate(pdf, String(r.value || ''), w / 2 - 8), x + w - 6, ry, { align: 'right' });
    });

    return 16 + bodyH;  // total drawn height
  }

  // ---- v5.3.5 — Column-alignment inference ----
  // When callers don't pass an explicit `align` array, infer per-column
  // alignment from header text + first-row cell content. Replaces the
  // legacy "header always left, numeric value right" mismatch — which
  // produced the visible Rooms / Zones / Cinema-Schedule misalignment in
  // the v5.3.4 Caldy export (Bryn report 2026-05-07: "table column
  // alignments need fixing for various schedules").
  //
  // Heuristics (in priority order):
  //   1. Header is short (≤4 chars, uppercase) AND first cell is dot/dash
  //      → 'centre' (Cin / Med / Aud / Vid / Rem / OSD / Qty tick columns)
  //   2. Header contains 'm²' / 'mm' / 'qty' / matches /^[A-Z\s]*$/ AND
  //      first cell is numeric → 'right' (Area m² / Perim m / Width mm)
  //   3. Header is one of {'NN', 'NN.sub', 'No', '#'} → 'centre'
  //   4. Last column with numeric first cell → 'right'
  //   5. Default → 'left'
  //
  // Conservative — only fires when caller passes no align array. Existing
  // collectors that DO pass align continue to override.
  function _inferColAlign(headers, rows) {
    if (!Array.isArray(headers) || !headers.length) return null;
    const sampleRow = (rows && rows[0]) || [];
    const out = [];
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      const c = String(sampleRow[i] != null ? sampleRow[i] : '').trim();
      const hLower = h.toLowerCase();
      const isShortUC = h.length <= 4 && h === h.toUpperCase().replace(/[^A-Z]/g, '') ? false :
                        (h.length <= 4 && /^[A-Z][A-Za-z]{0,3}$/.test(h));
      const isDot = c === '·' || c === '•' || c === '—' || c === '-' || c === '✓' || c === '';
      const isNumericCell = /^[\-+£\d.,\s%×x–—•✓·]+$/.test(c) && c.length > 0;
      const isNNHeader = /^(NN|NN\.sub|No|#|Q EST|qty)$/i.test(h);
      const isMeasureHeader = /\b(m²|m|mm|cm|ft|qty|count|kg|w|btu|⌀|diagonal|width|height|drop|metres|perim)\b/i.test(hLower);
      if (isShortUC && (isDot || isNumericCell)) {
        out.push('centre');
      } else if (isNNHeader) {
        out.push('centre');
      } else if (isMeasureHeader && (isNumericCell || isDot || c === '')) {
        out.push('right');
      } else if (i === headers.length - 1 && isNumericCell) {
        out.push('right');
      } else {
        out.push('left');
      }
    }
    return out;
  }

  // ---- TABLE (rich data table with colour stripes + totals row) ----
  // opts: { x, y, w, headers, rows, accent, groupBy?, totals? }
  // Returns final y after drawing.
  function paintTable(pdf, opts) {
    const x = opts.x || 24;
    let y = opts.y || 80;
    const w = opts.w || (pdf.internal.pageSize.getWidth() - 48);
    const accent = opts.accent || COLOURS.accent;
    const headers = Array.isArray(opts.headers) ? opts.headers : [];
    const rows = Array.isArray(opts.rows) ? opts.rows : [];
    const totals = Array.isArray(opts.totals) ? opts.totals : null;
    const groupByCol = (typeof opts.groupBy === 'number') ? opts.groupBy : -1;
    const colWeights = Array.isArray(opts.colWeights) ? opts.colWeights : null;
    // v2.0.2 — per-column alignment array. Same length as headers. Values:
    // 'left' | 'centre' | 'right'. Falls back to the legacy heuristic
    // (right-align if numeric-looking, else left) when not provided so
    // older callers keep working unchanged.
    // v5.3.5 — Resolve per-column alignment with fallback chain:
    //   1. opts.align (explicit caller — collectors set this)
    //   2. _inferColAlign(headers, rows) (heuristic from header + first cell)
    //   3. legacy numeric-cue heuristic (per-cell, in _resolveAlign below)
    // Pre-v5.3.5 only #1 was honoured; when collectors didn't pass align
    // (full-document path through buildAspects), headers fell back to
    // 'left' while values used the numeric heuristic — producing the
    // visible Rooms / Zones / Cinema-Schedule mismatch.
    const explicitAlign = Array.isArray(opts.align) ? opts.align : null;
    const inferredAlign = explicitAlign ? null : _inferColAlign(headers, rows);
    const colAlign = explicitAlign || inferredAlign;
    const totalsAlign = Array.isArray(opts.totalsAlign) ? opts.totalsAlign : colAlign;
    // v2.0.2 — per-section service-colouring for group bands. When true,
    // the group separator's left-edge stripe + tinted fill use the colour
    // returned by _serviceColourForSection(sectionId) (NN-prefix lookup
    // against SERVICES). Used by Blocks Schedule so each "01.1" / "04.6"
    // band reads as its trade colour while the master accent stays charcoal.
    const groupColourByService = !!opts.groupColourByService;
    const headerH = 18;
    const rowH = 14;
    const groupH = 16;
    const pageH = pdf.internal.pageSize.getHeight();
    const meta = opts.meta || {};

    // Compute column widths from weights (default = equal)
    const nCols = headers.length || 1;
    const weights = colWeights && colWeights.length === nCols
      ? colWeights : new Array(nCols).fill(1);
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const colWs = weights.map(wt => (w * wt) / totalWeight);
    const colXs = []; let runX = x;
    colWs.forEach(cw => { colXs.push(runX); runX += cw; });

    // v2.0.2 — Per-cell text painter that honours per-column alignment.
    // 'left'   → text drawn at colX + pad (default jsPDF align)
    // 'centre' → text drawn at colX + cw/2 with align:'center'
    // 'right'  → text drawn at colX + cw - pad with align:'right'
    // Returns the chosen alignment so the totals row + headers can mirror.
    const _resolveAlign = (i, fallbackCell) => {
      if (colAlign && colAlign[i]) {
        const a = String(colAlign[i]).toLowerCase();
        if (a === 'centre' || a === 'center') return 'centre';
        if (a === 'right') return 'right';
        if (a === 'left') return 'left';
      }
      // Legacy fallback heuristic (kept for callers that don't pass align):
      // last column or numeric-looking cell → right; otherwise left.
      const isNum = i === nCols - 1 || /^[\-+£\d.,\s%×x–—•✓•]+$/.test(String(fallbackCell || '').trim());
      return isNum ? 'right' : 'left';
    };
    const _drawCellText = (text, i, baseY, opts2) => {
      opts2 = opts2 || {};
      const cw = colWs[i];
      const pad = (typeof opts2.pad === 'number') ? opts2.pad : 6;
      const align = opts2.forceAlign || _resolveAlign(i, text);
      if (align === 'right') {
        pdf.text(String(text), colXs[i] + cw - pad, baseY, { align: 'right' });
      } else if (align === 'centre') {
        pdf.text(String(text), colXs[i] + cw / 2, baseY, { align: 'center' });
      } else {
        pdf.text(String(text), colXs[i] + pad, baseY);
      }
    };

    // Header drawer (re-callable on page break)
    const drawHeader = () => {
      _setFill(pdf, accent);
      pdf.rect(x, y, w, headerH, 'F');
      // v5.2.1 — Slim white-with-alpha highlight along the top of the
      // header band for subtle 3D ribbon effect. jsPDF doesn't support
      // alpha on fills; emulate via _mixWithWhite at 18% which gives a
      // slightly lighter band — reads as polished, not flat. 1pt tall.
      _setFill(pdf, _mixWithWhite(accent, 0.18));
      pdf.rect(x, y, w, 1.2, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(9);
      _setText(pdf, '#FFFFFF');
      headers.forEach((h, i) => {
        const cw = colWs[i];
        const pad = 6;
        const txt = _truncate(pdf, String(h || ''), cw - pad * 2);
        // v5.3.5 — Headers use the SAME _resolveAlign as values so
        // header + value always match. When colAlign is set (explicit
        // or inferred), both honour it. When not, the heuristic looks
        // at the value cell (header text doesn't match numeric regex).
        // Cleanly fixes the Rooms / Zones / Cinema-Schedule misalignment
        // where header was 'left' (default) but value was 'right' (numeric).
        const align = _resolveAlign(i, h);
        if (align === 'right') {
          pdf.text(txt, colXs[i] + cw - pad, y + 12, { align: 'right' });
        } else if (align === 'centre' || align === 'center') {
          pdf.text(txt, colXs[i] + cw / 2, y + 12, { align: 'center' });
        } else {
          pdf.text(txt, colXs[i] + pad, y + 12);
        }
      });
      y += headerH;
    };

    drawHeader();

    // Track current group key for inline group separators
    let lastGroupKey = null;
    let stripeIdx = 0;

    rows.forEach((rawRow) => {
      // v5.4.77 — Row-shape unwrap for non-array variants (defensive
      // sweep alongside _writeAspectCsv fix). Three non-array shapes
      // arrive from _groupAspectByFloor (v5.4.72) + mix expansion
      // (v5.4.76):
      //   · { group:true, label:'X' }       — banner row. Render as a
      //     tinted full-width band with the label (similar to the
      //     legacy groupByCol path below, but pre-injected).
      //   · { _group:'X' }                  — Cinema Design banner.
      //     Treated identically.
      //   · { subRow:true, values:[…], total?:true } — mix sub-row.
      //     Render as a regular row using `.values`, with a lighter
      //     stripe (italic muted text is HTML-pipeline-only; the
      //     native path keeps cell text legible).
      // Plain arrays unchanged. Without this v5.4.77 fix, the jsPDF
      // fallback path silently rendered banner rows as empty rows and
      // mix sub-rows as "undefined undefined undefined" — fortunately
      // the HTML pipeline is canonical so production output stays clean.
      let row;
      let preInjectedBanner = null;
      let isSubRow = false;
      let isSubTotal = false;
      if (Array.isArray(rawRow)) {
        row = rawRow;
      } else if (rawRow && rawRow.group === true) {
        preInjectedBanner = String(rawRow.label == null ? '' : rawRow.label).toUpperCase();
      } else if (rawRow && typeof rawRow._group === 'string') {
        preInjectedBanner = rawRow._group.toUpperCase();
      } else if (rawRow && Array.isArray(rawRow.values)) {
        row = rawRow.values;
        isSubRow = !!rawRow.subRow;
        isSubTotal = isSubRow && !!rawRow.total;
      } else {
        return;   // unknown shape — skip silently
      }
      // v1.23.0 — page-break check honours the next row's full height
      // (rowH) plus a 10pt buffer so we never overlap the footer block
      // (which starts at pageH-100). If a callback is provided it owns
      // the addPage + header/footer chrome repaint; otherwise we add a
      // bare page ourselves. Either way, y resets to the body-top
      // offset and the table header is redrawn on the new page so the
      // column titles repeat for readability (CAD title-block convention).
      if (y + rowH > pageH - 110) {
        if (typeof opts.onPageBreak === 'function') {
          opts.onPageBreak();
        } else {
          pdf.addPage();
        }
        y = (typeof opts.pageBodyTop === 'number') ? opts.pageBodyTop : 80;
        drawHeader();
        stripeIdx = 0;
      }

      // v5.4.77 — pre-injected banner row from _groupAspectByFloor.
      // Render as a tinted full-width band (similar to legacy
      // groupByCol path) and skip the cell-painter below.
      if (preInjectedBanner != null) {
        _setFill(pdf, COLOURS.tint);
        pdf.rect(x, y, w, groupH, 'F');
        _setStroke(pdf, accent);
        pdf.setLineWidth(2);
        pdf.line(x, y, x, y + groupH);
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(9.5);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, preInjectedBanner || '(unassigned)', w - 16), x + 10, y + 11);
        y += groupH;
        stripeIdx = 0;
        lastGroupKey = preInjectedBanner;
        // v5.39.0 (B-350) — report top-tier (floor) banner pages so the
        // caller can build per-floor outline children. Room sub-banners
        // (kind:'sub') are skipped — floors are the useful nav unit.
        if (typeof opts.onGroupBanner === 'function' && !(rawRow && rawRow.kind === 'sub')) {
          try {
            const absPg = (pdf.internal && typeof pdf.internal.getCurrentPageInfo === 'function')
              ? pdf.internal.getCurrentPageInfo().pageNumber : null;
            if (absPg) opts.onGroupBanner(preInjectedBanner, absPg);
          } catch (_) {}
        }
        return;
      }

      // Group separator
      // v1.99.1 — Polish per Bryn group-header note: add a small breathing
      // gap above each new group (except the first, which sits flush under
      // the table header) so the bands read as section dividers, not as
      // orphan rows. Bolder text + slightly bigger font separates the
      // header tone from the data rows beneath. Bg fill stays as
      // COLOURS.tint (subtle slate) and the left-edge accent bar still
      // pulls from `accent` (the aspect colour) so service-bound aspects
      // get a service-colour cue while generic aspects (rooms / blocks /
      // cables / shades / zones) get the new charcoal accent.
      if (groupByCol >= 0) {
        const gk = String(row[groupByCol] || '');
        if (gk !== lastGroupKey) {
          if (lastGroupKey !== null) y += 6;  // 6pt gap above each new group
          // v2.0.2 — per-section service-colouring for the band. When
          // groupColourByService is on (Blocks Schedule), the section's
          // service colour from _serviceColourForSection() drives both
          // the tinted fill (15% mix toward white via _mixWithWhite) and
          // the 4pt left-edge stripe at full saturation. Otherwise the
          // legacy slate-tint fill + 2pt accent stripe is used.
          const sectionColour = groupColourByService ? _serviceColourForSection(gk) : null;
          if (sectionColour) {
            _setFill(pdf, _mixWithWhite(sectionColour, 0.85));  // ~15% saturation tint
            pdf.rect(x, y, w, groupH, 'F');
            // 4pt full-saturation left-edge accent stripe
            _setFill(pdf, sectionColour);
            pdf.rect(x, y, 4, groupH, 'F');
          } else {
            _setFill(pdf, COLOURS.tint);
            pdf.rect(x, y, w, groupH, 'F');
            _setStroke(pdf, accent);
            pdf.setLineWidth(2);
            pdf.line(x, y, x, y + groupH);
          }
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(9.5);
          // Section label text stays charcoal (NOT inverse-coloured) for
          // legibility against the pale tint background.
          _setText(pdf, COLOURS.text);
          // Indent the label past the 4pt accent stripe so it doesn't sit
          // on top of the colour bar.
          const labelLeftPad = sectionColour ? 12 : 10;
          pdf.text(_truncate(pdf, gk || '(unassigned)', w - 16), x + labelLeftPad, y + 11);
          y += groupH;
          stripeIdx = 0;
          lastGroupKey = gk;
        }
      }

      // (Row stripe moved below — needs dynRowH from cell-wrap pass)


      // Cells — v1.28.0: wrap long text to multiple lines instead of
      // truncating with ellipsis. Each cell uses pdf.splitTextToSize() to
      // break at word boundaries within column width. Row height adjusts
      // to the tallest wrapped cell so everything stays vertically aligned.
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8.5);
      _setText(pdf, COLOURS.text);
      const cellPad = 6;
      const lineH = 10;
      // First pass: wrap every cell + find max line count for row-height calc
      const wrappedCells = headers.map((_h, i) => {
        const cw = colWs[i];
        const cell = row[i] == null ? '' : String(row[i]);
        if (!cell) return [''];
        if (typeof pdf.splitTextToSize === 'function') {
          return pdf.splitTextToSize(cell, cw - cellPad * 2);
        }
        return [_truncate(pdf, cell, cw - cellPad * 2)];
      });
      const maxLines = Math.max(1, ...wrappedCells.map(w => w.length));
      const dynRowH = Math.max(rowH, maxLines * lineH + 4);
      // Re-paint stripe with the actual dynamic row height (overwrites
      // the rowH-only stripe drawn above). Simpler: skip the pre-paint
      // stripe and paint here once we know dynRowH.
      if (stripeIdx % 2 === 1) {
        _setFill(pdf, COLOURS.altRow);
        pdf.rect(x, y, w, dynRowH, 'F');
        // Re-set text colour after the fill
        _setText(pdf, COLOURS.text);
      }
      headers.forEach((_h, i) => {
        const lines = wrappedCells[i];
        // v2.0.2 — alignment is now per-column via opts.align (preferred)
        // or the legacy numeric-cue fallback (when no align array is
        // passed). Boolean/tick columns can be 'centre' so dots and
        // ticks sit dead-centre under their narrow header instead of
        // jamming against the right edge alongside metres/qty values.
        const align = _resolveAlign(i, row[i]);
        lines.forEach((ln, li) => {
          const lineY = y + 9 + li * lineH;
          if (!ln.trim()) {
            // Empty / whitespace-only cell — still draw nothing, skip
            // to avoid jsPDF's zero-width text warning.
            return;
          }
          _drawCellText(ln, i, lineY, { pad: cellPad, forceAlign: align });
        });
      });
      y += dynRowH;
      stripeIdx++;
    });

    // Empty state
    if (!rows.length) {
      _setFill(pdf, COLOURS.altRow);
      pdf.rect(x, y, w, rowH, 'F');
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(8.5);
      _setText(pdf, COLOURS.muted);
      pdf.text('No rows on this floor.', x + 8, y + 9);
      y += rowH;
    }

    // Totals row (highlighted) — page-break safeguard so the highlighted
    // totals strip never sits on top of the footer block. The totals row
    // is rowH+2 tall; if drawing it would cross into the footer area
    // (pageH - 110 buffer), break a page first so it lands cleanly on
    // the new page underneath the table header.
    if (totals && totals.length === nCols) {
      // v5.2.1 — buffer +3pt for the new gap above the totals row
      if (y + rowH + 5 > pageH - 110) {
        if (typeof opts.onPageBreak === 'function') {
          opts.onPageBreak();
        } else {
          pdf.addPage();
        }
        y = (typeof opts.pageBodyTop === 'number') ? opts.pageBodyTop : 80;
        drawHeader();
      }
      // v5.2.1 — Hairline accent line above totals row (3pt gap) so the
      // totals strip reads as a definitive bottom-line, separated from
      // the data rows. Then the dark fill + white text.
      _setStroke(pdf, accent);
      pdf.setLineWidth(0.6);
      pdf.line(x, y + 1.5, x + w, y + 1.5);
      y += 3;  // gap between data rows and totals
      _setFill(pdf, COLOURS.text);
      pdf.rect(x, y, w, rowH + 2, 'F');
      // v5.2.1 — Accent left-edge stripe (4pt × full row height) matching
      // the group-separator style. Pulls the eye to the totals row +
      // visually echoes the section-band hierarchy used above.
      _setFill(pdf, accent);
      pdf.rect(x, y, 4, rowH + 2, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(9);
      _setText(pdf, '#FFFFFF');
      headers.forEach((_h, i) => {
        const cw = colWs[i];
        const pad = 6;
        const cell = totals[i] == null ? '' : String(totals[i]);
        if (!cell.trim()) return;  // skip blank cells (no zero-width warning)
        // v2.0.2 — totals row honours per-column align (prefer totalsAlign,
        // fall back to colAlign, fall back to legacy numeric-cue heuristic)
        // so the totals strip aligns column-for-column with the data above.
        let align;
        if (totalsAlign && totalsAlign[i]) {
          const a = String(totalsAlign[i]).toLowerCase();
          align = (a === 'centre' || a === 'center') ? 'centre'
                : (a === 'right') ? 'right'
                : 'left';
        } else if (colAlign && colAlign[i]) {
          const a = String(colAlign[i]).toLowerCase();
          align = (a === 'centre' || a === 'center') ? 'centre'
                : (a === 'right') ? 'right'
                : 'left';
        } else {
          // Legacy numeric heuristic — kept so callers without align arrays
          // continue to render exactly like v2.0.1.
          const isNum = i === nCols - 1 || /^[\-+£\d.,\s%×x–—•✓•]+$/.test(cell.trim());
          align = isNum ? 'right' : 'left';
        }
        const txt = _truncate(pdf, cell, cw - pad * 2);
        if (align === 'right') {
          pdf.text(txt, colXs[i] + cw - pad, y + 11, { align: 'right' });
        } else if (align === 'centre') {
          pdf.text(txt, colXs[i] + cw / 2, y + 11, { align: 'center' });
        } else {
          pdf.text(txt, colXs[i] + pad, y + 11);
        }
      });
      y += rowH + 2;
    }

    return y;
  }

  // Truncate `s` so its rendered width fits `maxPt` at the current PDF
  // font setting. Adds an ellipsis when shortened.
  function _truncate(pdf, s, maxPt) {
    s = String(s == null ? '' : s);
    if (!s) return s;
    if (pdf.getTextWidth(s) <= maxPt) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pdf.getTextWidth(s.slice(0, mid) + '…') <= maxPt) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + '…';
  }

  // ---- ASPECT (per-aspect tabular PDF builder) ----
  // opts: {
  //   title:    string  - PDF title (uppercased in header)
  //   aspect:   string  - rooms|symbols|cables|leds|shades|tvs|full
  //   report:   { headers, rows }
  //   summary:  [{ label, value, accent? }]   - optional total summary chip
  //   groupBy:  number  - column index to group by (room name etc.)
  //   colWeights: number[]  - per-column width weights
  //   totals:   array  - last row to render with highlighted styling
  //   filename: string - download filename (defaults to a date-stamped slug)
  // }
  // v1.30.0 — extracted aspect emit logic so fullDocument() can re-use
  // it without spawning a separate PDF per aspect. Emits an aspect's
  // table content into the CURRENT page of the given PDF (caller is
  // responsible for addPage between sections). Handles its own pagination
  // for tables that span multiple pages.
  // Returns the final pageNum (relative to the section start = 1).
  // ==========================================================================
  // v5.47.1 — SHARED SCHEDULE PAGE BUILDER (single source for BOTH paths)
  // Bryn 2026-07-06: "the cable schedule in the full pack appears differently,
  // make sure it follows same scheme as the individual export, so we only
  // edit in one place." The standalone A3 export and the Full Document
  // previously carried PARALLEL item-mapping / pagination / header / summary
  // / total-row assemblies that drifted (budgets 24 vs 22, callback sets,
  // chip synthesis). These helpers are now THE implementation; both paths
  // delegate (full-doc locals are one-line shims, the standalone calls
  // SonorPdf.schedule* directly).
  // ==========================================================================
  // v5.50.0 — budgets re-measured for the 10px table font (was 7.5px).
  // v5.54.2 — TWO budget tiers (Bryn: "schedules dont need to paginate so
  // extremely if it will all fit on one, its only really the dense cable
  // schedule that needs the splits"). DENSE = cable-schedule-class rows
  // (multi-line terminations, room sub-banners, atomic device groups) —
  // conservative counts. REGULAR = everything else: rows are single-line,
  // so nearly twice as many fit before the footer is at risk.
  // v5.66.2 — re-measured for the 8px table font.
  // v5.198.0 — budgets are now an UPPER bound only: every page is measured
  // (scheduleMeasuredPages) and trimmed to what really fits, so the old
  // "conservative" dense budgets (22/28 — half-empty cable pages) can sit
  // nearer the true capacity. Keep-together decisions use these too.
  const SCHEDULE_BUDGET_FIRST_CHIPLESS = 41;
  const SCHEDULE_BUDGET_FIRST_CHIPS    = 38;
  const SCHEDULE_BUDGET_CONT           = 46;
  const SCHEDULE_BUDGET_DENSE_FIRST_CHIPLESS = 32;
  const SCHEDULE_BUDGET_DENSE_FIRST_CHIPS    = 30;
  const SCHEDULE_BUDGET_DENSE_CONT           = 36;

  function scheduleItemsFor(a) {
    const groupCol = (typeof a.groupBy === 'number' && a.groupBy >= 0) ? a.groupBy : -1;
    const accentForGroup = (ASPECT_ACCENT && ASPECT_ACCENT[a.aspect]) || COLOURS.accent || '#6b4a8a';
    const items = [];
    let lastGroup = null;
    ((a.report && a.report.rows) || []).forEach(row => {
      if (row && row.group === true) {
        items.push(row);   // pre-injected banner (kind: 'floor' | 'sub') — forward as-is
        lastGroup = row.label || '—';
        return;
      }
      const values = (Array.isArray(row) ? row : (row.values || []));
      if (groupCol >= 0) {
        const g = String(values[groupCol] == null ? '' : values[groupCol]);
        if (g !== lastGroup) {
          items.push({ group: true, label: g || '—', accent: accentForGroup, _groupKey: g });
          lastGroup = g;
        }
      }
      const item = { values };
      if (row && typeof row.symbolHTML === 'string' && row.symbolHTML) item.symbolHTML = row.symbolHTML;
      if (row && row.subRow) item.subRow = true;
      if (row && row.total) item.total = true;
      // v5.49.1 — forward the paired-slave indent flag (v5.49.0 added it to
      // collector rows but this hop dropped it — slaves rendered unindented).
      if (row && row.indent) item.indent = true;
      items.push(item);
    });
    return items;
  }

  function schedulePaginate(items, opts) {
    const hasChips = !!(opts && opts.hasChips);
    const dense = !!(opts && opts.dense);
    const first = dense
      ? (hasChips ? SCHEDULE_BUDGET_DENSE_FIRST_CHIPS : SCHEDULE_BUDGET_DENSE_FIRST_CHIPLESS)
      : (hasChips ? SCHEDULE_BUDGET_FIRST_CHIPS : SCHEDULE_BUDGET_FIRST_CHIPLESS);
    const cont = dense ? SCHEDULE_BUDGET_DENSE_CONT : SCHEDULE_BUDGET_CONT;
    const cbs = {
      // atomic devices: Aspect-cell leader rows (v5.5.9 collapse convention)
      isDeviceStart: (it) => {
        if (!it || it.group) return false;
        const v = it.values;
        return Array.isArray(v) && v[0] != null && String(v[0]).trim() !== '';
      },
      // v5.70.1 — floor page-breaks are a DENSE-schedule rule only (Bryn:
      // "general schedules do not need page break per floor if they fit,
      // its only the main cable schedules that need harder separation").
      // Dense (cables_v2 / cables_lighting): floors ALWAYS on a fresh page.
      // General schedules: floor banners are soft breaks — kept together
      // with their rows when possible, but no forced page turn.
      isSoftBreakBanner: (it) => !!(it && it.group === true
        && (it.kind === 'sub' || (!dense && it.kind === 'floor'))),
      isHardBreakBanner: (it) => !!(dense && it && it.group === true && it.kind === 'floor')
    };
    const P = (typeof window !== 'undefined' && window.SonorPdfPaginate
               && typeof window.SonorPdfPaginate.paginate === 'function')
      ? window.SonorPdfPaginate.paginate : null;
    if (P) return P(items, Object.assign({ firstPageBudget: first, contPageBudget: cont }, cbs));
    // minimal fallback — plain chunking, no keep-together (paginate module missing)
    const pages = [];
    let i = 0, lastGroupBeforeBoundary = null;
    while (i < items.length) {
      const budget = pages.length === 0 ? first : cont;
      const chunk = [];
      if (pages.length && lastGroupBeforeBoundary) {
        chunk.push({ group: true, label: (lastGroupBeforeBoundary.label || '') + ' (continued)', accent: lastGroupBeforeBoundary.accent, kind: lastGroupBeforeBoundary.kind });
      }
      while (chunk.length < budget && i < items.length) {
        const it = items[i];
        chunk.push(it);
        if (it && it.group === true) lastGroupBeforeBoundary = it;
        i++;
      }
      pages.push({ items: chunk, lastGroup: lastGroupBeforeBoundary });
    }
    return pages;
  }

  // ===========================================================================
  // v5.198.0 — MEASURED SCHEDULE PAGINATION (Bryn 2026-09-15 PDF review:
  // rows vanished at page breaks — Utility/WC devices, the Study PIRs,
  // three shades with NO continuation page). The budget paginator counts
  // items; the HTML renderer clips at `.page-table-wrap` (overflow:hidden),
  // and taller rows (sub-banners, wrapped cells) blew the budget by 2-4 rows
  // per page. Now every budgeted page is LAID OUT (no rasterising) via
  // SonorPdfHtmlCover.measureSchedule; rows that don't fit are carried onto
  // the next page (with a "(continued)" banner when mid-group), a page is
  // appended when the last page overflows, and a total row that no longer
  // fits takes its last two rows along. The same rebalance runs at emit
  // time as a safety net, so a row can NEVER be clipped again.
  // ===========================================================================
  function _rebalanceSchedulePages(pages, pi, measure) {
    if (!Array.isArray(pages) || !pages[pi] || !measure || !measure.overflow) return false;
    const items = pages[pi].items || [];
    let fit = Number(measure.fitCount);
    if (!isFinite(fit)) return false;
    if (fit >= items.length) fit = Math.max(0, items.length - 2);   // only the TOTAL overflowed — carry two rows with it
    if (items.length <= 1) return false;                              // nothing to move
    if (fit <= 0) fit = 1;
    while (fit > 1 && items[fit - 1] && items[fit - 1].group === true) fit--;   // never strand a banner as the last row
    if (fit >= items.length) return false;
    const tail = items.slice(fit);
    pages[pi].items = items.slice(0, fit);
    let g = null;
    for (let k = pages[pi].items.length - 1; k >= 0; k--) {
      const it = pages[pi].items[k];
      if (it && it.group === true) { g = it; break; }
    }
    if (!g) g = pages[pi].lastGroup || null;
    const carry = [];
    if (tail[0] && tail[0].group !== true && g) {
      carry.push({ group: true, label: String(g.label || '').replace(/ \(continued\)$/i, '') + ' (continued)',
                   accent: g.accent, _groupKey: g._groupKey, kind: g.kind });
    }
    if (pi + 1 < pages.length) {
      const nxt = (pages[pi + 1].items || []).slice();
      if (nxt[0] && nxt[0].group === true && /\(continued\)$/i.test(String(nxt[0].label || ''))) nxt.shift();
      pages[pi + 1].items = carry.concat(tail, nxt);
    } else {
      pages.push({ items: carry.concat(tail), lastGroup: g });
    }
    return true;
  }

  // pageOptsFor(rows, { isFirst, isLast }) → the same opts renderSchedule gets.
  async function scheduleMeasuredPages(a, pageOptsFor) {
    if (a && Array.isArray(a._measuredPages)) return a._measuredPages;
    const items = scheduleItemsFor(a);
    const pages = schedulePaginate(items, {
      hasChips: !!(a && Array.isArray(a.summary) && a.summary.length),
      dense: !!(a && a.denseSchedule)
    });
    const HC = (typeof window !== 'undefined') ? window.SonorPdfHtmlCover : null;
    const canMeasure = !!(HC && typeof HC.measureSchedule === 'function'
      && typeof HC.available === 'function' && HC.available() && typeof pageOptsFor === 'function');
    if (canMeasure) {
      let guard = 0;
      for (let pi = 0; pi < pages.length && guard++ < 400; pi++) {
        let m = null;
        try {
          m = await HC.measureSchedule(pageOptsFor(pages[pi].items, { isFirst: pi === 0, isLast: pi === pages.length - 1 }));
        } catch (e) { console.warn('[scheduleMeasuredPages] measure failed — budget pages kept:', e && e.message); break; }
        if (!m || !m.overflow) continue;
        if (!_rebalanceSchedulePages(pages, pi, m)) continue;
        // re-measure this page (it shrank) before moving on
        pi--;
      }
    }
    if (a) a._measuredPages = pages;
    return pages;
  }

  // v5.55.0 (B-361) — ONE builder for scheduleTable's per-aspect render
  // options. Three sites used to hand-mirror this block (two fullDocument
  // emission sites + the standalone _buildScheduleAspectHtmlPdf in the
  // host) and drifted repeatedly (tickCols missed standalone v5.50.0,
  // colour dots missed full-pack v5.47.1). Specs declare; this forwards.
  function scheduleTableOptsFor(a) {
    const o = {};
    if (!a) return o;
    if (typeof a.colourPillCol === 'number') o.colourPillCol = a.colourPillCol;
    if (a.colourPillMap) o.colourPillMap = a.colourPillMap;
    if (typeof a.colourDotCol === 'number') o.colourDotCol = a.colourDotCol;
    if (a.colourDotMap) o.colourDotMap = a.colourDotMap;
    if (typeof a.deviceStartCol === 'number') o.deviceStartCol = a.deviceStartCol;
    if (typeof a.symbolCol === 'number') o.symbolCol = a.symbolCol;
    if (Array.isArray(a.tickCols)) o.tickCols = a.tickCols;
    return o;
  }

  function scheduleHeadersFor(a) {
    const alignArr = (a.align || (a.report && a.report.align) || []);
    const headers = ((a.report && a.report.headers) || []);
    // v5.185.1 — ALIGNMENT PARITY (Bryn: "all table alignments throughout
    // the pdf make sure they are perfect"). The HTML pipeline previously
    // honoured only the collector's explicit align array — any aspect
    // without one rendered browser-default LEFT on every numeric column,
    // while the native jsPDF path has had heuristic inference since
    // v5.3.5. The SAME _inferColAlign now backfills columns with no
    // explicit value, sampled from the first DATA row (group banners
    // skipped). 'centre' also normalises to CSS-valid 'center' —
    // text-align:centre is invalid CSS and silently rendered LEFT.
    let _sampleRow = null;
    try {
      for (const r of ((a.report && a.report.rows) || [])) {
        if (r && r.group === true) continue;
        _sampleRow = Array.isArray(r) ? r : (r && Array.isArray(r.values) ? r.values : null);
        if (_sampleRow) break;
      }
    } catch (_) {}
    const _inferred = _inferColAlign(headers, _sampleRow ? [_sampleRow] : []) || [];
    const _cssAlign = (v) => (v === 'centre' ? 'center' : (v || null));
    // v5.49.0 — the HTML pipeline now respects the aspect's colWeights
    // (the native jsPDF layout always did). Weights are converted to
    // percentage width hints on the <col> elements, so narrow columns
    // (Aspect icon, Qty) stop hogging space they don't need and wide
    // columns (ID, terminations) get it instead. Rows keep auto layout —
    // hints, not table-layout:fixed — so long content still never clips.
    const w = (Array.isArray(a.colWeights) && a.colWeights.length === headers.length)
      ? a.colWeights : null;
    const wSum = w ? w.reduce((t, x) => t + (Number(x) || 0), 0) : 0;
    return headers.map((label, i) => {
      const align = _cssAlign(alignArr[i] || _inferred[i] || null);
      const h = { key: 'c' + i, label, align: align || (i === 0 ? 'left' : null) };
      if (w && wSum > 0) h.width = (((Number(w[i]) || 0) / wSum) * 100).toFixed(2) + '%';
      return h;
    });
  }

  function scheduleTotalRowFor(a) {
    if (a.totals && Array.isArray(a.totals)) return { label: a.totals[0] || 'TOTAL', values: a.totals };
    if (a.report && a.report.total) return a.report.total;
    return null;
  }

  function scheduleSummaryFor(a) {
    // EXPLICIT EMPTY ARRAY = deliberately chipless (v5.47.0 cable schedule).
    if (Array.isArray(a.summary)) {
      if (!a.summary.length) return { headline: null, chips: [] };
      // v5.182.0 ROOT-CAUSE FIX — every push site passes OBJECT rows
      // ({label, value, accent?} — the paintSummary shape) but this
      // converter only read ARRAY rows ([label, value]). `first.length`
      // is undefined on an object, so headline + chips silently came out
      // EMPTY and summaryChip rendered NOTHING — the shades / devices /
      // lighting summary cards were MISSING from the Full-Document HTML
      // pipeline all along (the standalone jsPDF path was fine because
      // paintSummary reads objects). Now both shapes normalise.
      const _norm = (r) => {
        if (!r) return null;
        if (Array.isArray(r)) return (r.length >= 2) ? { label: r[0], value: r[1] } : null;
        if (typeof r === 'object' && 'label' in r) return { label: r.label, value: r.value, accent: r.accent };
        return null;
      };
      const summary = { headline: null, chips: [] };
      // v5.198.0 — the HEADLINE is the aspect's TOTAL, not whichever chip
      // happens to be listed first (Heybridge export: "DOORBELL 1" headed
      // the Cable Schedule, "CINEMA 0" the Zones, "BED4 2" the Audio
      // schedule). Collectors push the TOTAL last; find it by label, fall
      // back to the first row for collectors that lead with their total.
      const _norms = a.summary.map(_norm);
      let hi = _norms.findIndex(r => r && /^total\b/i.test(String(r.label || '')));
      if (hi < 0) hi = _norms.findIndex(r => !!r);
      const first = hi >= 0 ? _norms[hi] : null;
      if (first) summary.headline = { label: first.label, value: first.value };
      const accent = (ASPECT_ACCENT && ASPECT_ACCENT[a.aspect]) || COLOURS.accent || '#6b4a8a';
      for (let si = 0; si < _norms.length; si++) {
        if (si === hi) continue;
        const r = _norms[si];
        if (r) summary.chips.push({ label: r.label, value: r.value, accent: r.accent || accent });
      }
      return summary;
    }
    // No summary supplied → synthesise from row count + totals row.
    const rowCount = ((a.report && a.report.rows) || []).length;
    const accent = (ASPECT_ACCENT && ASPECT_ACCENT[a.aspect]) || COLOURS.accent || '#6b4a8a';
    const ASPECT_LABELS = {
      rooms: 'Rooms', symbols: 'Blocks', blocks: 'Blocks', cables: 'Cables',
      leds: 'Runs', lighting: 'Lighting', shades: 'Shades',
      tvs: 'Displays', displays: 'Displays', zones: 'Zones',
      snags: 'Snags', cctv: 'Cameras'
    };
    const labelForAspect = ASPECT_LABELS[a.aspect] ||
      (a.aspect && a.aspect.indexOf('svc_') === 0 ? 'Items' : 'Entries');
    const summary = { headline: { label: labelForAspect, value: rowCount }, chips: [] };
    if (Array.isArray(a.totals) && a.totals.length && a.report && Array.isArray(a.report.headers)) {
      for (let ci = 1; ci < a.totals.length; ci++) {
        const v = a.totals[ci];
        if (v == null || v === '' || String(v).toUpperCase() === 'TOTAL') continue;
        summary.chips.push({ label: a.report.headers[ci] || ('Col ' + ci), value: v, accent });
        if (summary.chips.length >= 3) break;
      }
    }
    return summary;
  }

  function _emitAspectIntoPdf(pdf, opts, baseMeta) {
    const meta = baseMeta || collectProjectMeta();
    const accent = ASPECT_ACCENT[opts.aspect] || COLOURS.accent;
    const pageW = pdf.internal.pageSize.getWidth();

    // v2.0.0 — aspect → pageCode taxonomy lookup. Fallback "SCH" for any
    // schedule type not in the canonical map (won't happen for current
    // aspects but future-proofs new schedule aspects without breaking).
    const ASPECT_PAGECODE = {
      rooms: 'ROO', symbols: 'BLK', blocks: 'BLK', cables: 'CAB',
      leds: 'LED', lighting: 'LIT', shades: 'SHA', tvs: 'DIS',
      displays: 'DIS', pj_screens: 'PJS', zones: 'ZON', cctv: 'CCT'
    };
    const aspectPageCode = opts.pageCode
      || ASPECT_PAGECODE[opts.aspect]
      || (typeof opts.aspect === 'string' && opts.aspect.indexOf('svc_') === 0
          ? 'SLI-' + opts.aspect.slice(4) : null)
      || 'SCH';

    paintHeader(pdf, { title: opts.title, subtitle: opts.subtitle, aspect: opts.aspect, meta });
    // v2.0.0 — drawing reference code top-right of slate header
    paintHeaderDrawingCode(pdf, meta, aspectPageCode);

    const bodyTop = 60;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(14);
    _setText(pdf, COLOURS.text);
    pdf.text(opts.title || 'Take-Off', 24, bodyTop + 14);

    // v5.4.5 — "BASED ON PLANS Rev A{N}" tag (Sonor canonical from Oak Bank
    // 1st Fix Schedule RevA9 — every schedule pins itself to a specific plan
    // revision so installer knows which media plans the costing is based on).
    // Renders right-anchored on the title row in italic muted caps so it
    // doesn't compete with the title visually but is unmissable on a printed
    // sheet. Pulls from meta.revision (resolved by collectProjectMeta to the
    // most recent cached takeoff_revisions row).
    if (meta.revision && meta.revision !== 'A0' && meta.revision !== '00') {
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(8.5);
      _setText(pdf, COLOURS.text2);
      const basedOnTxt = 'BASED ON PLANS  ·  Rev ' + meta.revision;
      // Reserve space — sit at right edge with 24pt right margin
      pdf.text(basedOnTxt, pageW - 24, bodyTop + 14, { align: 'right' });
    }

    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(9);
    _setText(pdf, COLOURS.muted);
    const rowCount = (opts.report && Array.isArray(opts.report.rows)) ? opts.report.rows.length : 0;
    // v5.92.0 (B-371b) — 'Floor: <active>' dropped: schedules span ALL
    // floors (floor banners carry the per-floor read); the caption stamped
    // whichever floor happened to be active at export.
    const sub = `${rowCount} row${rowCount === 1 ? '' : 's'}` +
      '  ·  Generated ' + meta.dateUk;
    pdf.text(sub, 24, bodyTop + 28);

    // v5.4.5/v5.4.24 — quantity-take-off red disclaimer. Sits LEFT (next
    // to the sub-row, indented) so it can't collide with the right-anchored
    // summary chip which occupies pageW-224 to pageW-24 from bodyTop down.
    // Pre-v5.4.24 the disclaimer was right-anchored at bodyTop+28 — exactly
    // where the summary chip's first row of values lives → red text
    // overlapping every chip on every schedule page. Now sits to the
    // RIGHT of the row-count sub-line, in-flow on the sub-row line.
    if (opts.suppressTakeoffDisclaimer !== true) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(9);
      _setText(pdf, COLOURS.muted);
      const subLeft = pdf.getTextWidth(sub);
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.danger);
      const tkText = '  ·  QUANTITIES TAKEN-OFF — TBC ON-SITE';
      pdf.text(tkText, 24 + subLeft, bodyTop + 28, { charSpace: 0.4 });
      _setText(pdf, COLOURS.text);  // restore
    }

    let tableY = bodyTop + 40;
    if (Array.isArray(opts.summary) && opts.summary.length) {
      const sumW = 200;
      const sumH = paintSummary(pdf, {
        x: pageW - sumW - 24,
        y: bodyTop,
        w: sumW,
        accent: accent,
        title: opts.summaryTitle || 'Summary',
        rows: opts.summary
      });
      tableY = Math.max(tableY, bodyTop + sumH + 12);
    }

    const tableW = pageW - 48;
    let pageNum = (typeof opts._pageNumStart === 'number') ? opts._pageNumStart : 1;
    const pageTotal = opts._pageTotal || null;
    const onPageBreak = () => {
      paintFooter(pdf, { meta, pageNum, pageTotal });
      // v5.185.0 — explicit format/orientation so continuation pages stay
      // in the schedule's own size when front matter (extract cover /
      // preface pages) changed the document default.
      if (opts._pageFormat) pdf.addPage(opts._pageFormat, opts._pageOrientation);
      else pdf.addPage();
      pageNum++;
      paintHeader(pdf, { title: opts.title, subtitle: opts.subtitle, aspect: opts.aspect, meta });
      // v2.0.0 — repeat the drawing code on every continuation page
      paintHeaderDrawingCode(pdf, meta, aspectPageCode);
    };

    paintTable(pdf, {
      x: 24, y: tableY, w: tableW,
      pageBodyTop: 60,
      onGroupBanner: opts.onGroupBanner || null,   // v5.39.0 (B-350)
      headers: (opts.report && opts.report.headers) || [],
      rows:    (opts.report && opts.report.rows) || [],
      totals:  opts.totals || null,
      colWeights: opts.colWeights || null,
      groupBy: (typeof opts.groupBy === 'number') ? opts.groupBy : -1,
      // v2.0.2 — per-column alignment + per-section service-colouring.
      // align/totalsAlign come from the report (preferred — every collector
      // sets them) or from opts (override). groupColourByService is only
      // set explicitly by Blocks / per-service slices.
      align:        opts.align || (opts.report && opts.report.align) || null,
      totalsAlign:  opts.totalsAlign || (opts.report && opts.report.totalsAlign) || null,
      groupColourByService: !!opts.groupColourByService,
      accent,
      meta,
      onPageBreak
    });

    // v1.30.0 — caller (fullDocument) emits its own footer per page when
    // _suppressFooter is set, so the deck-wide pageNum increments correctly.
    // Standalone aspect() emits the final-page footer here.
    if (!opts._suppressFooter) {
      paintFooter(pdf, { meta, pageNum, pageTotal });
    }
    return pageNum;
  }

  async function aspect(opts) {
    opts = opts || {};
    // ---- v5.5.58 Phase 4 unification: pdf-lib dispatcher ----
    // When pdf-lib flag is on, route through aspectPdfLib() which uses
    // _paintAspectPdfLib — same painter Full Document uses for schedules.
    // Multi-page support added in v5.5.58 (was the v2.4.x blocker), so
    // long schedules (Cable Schedule, Per-Room) no longer truncate.
    if (_pdfLibFlagOn() && _pdfLibAvailable()) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating schedule via pdf-lib (unified style)…');
        const result = await aspectPdfLib(opts);
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          return result;
        }
        console.warn('[SonorPdf v5.5.58 aspect] aspectPdfLib returned null — falling back to legacy jsPDF.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v5.5.58 aspect] threw — falling back to jsPDF:', err);
      }
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}

    // ---- Legacy jsPDF path (fallback) ----
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    // v1.27.0 — page size auto-selected by column count. Tables with
    // 6 or fewer columns fit A4 portrait (Rooms 4 col, LEDs 4 col,
    // Cables 5 col, Lighting 3 col). 7-12 columns get A4 landscape
    // (Symbols 6 col borderline, TVs 8 col). 13+ columns get A3
    // landscape (Shades 14 col, Caldy convention). Caller can override
    // via opts.orientation / opts.format.
    const headerCount = (opts.report && Array.isArray(opts.report.headers)) ? opts.report.headers.length : 0;
    let orientation, format;
    if (opts.orientation && opts.format) {
      orientation = opts.orientation;
      format = opts.format;
    } else if (headerCount >= 13) {
      orientation = 'landscape';
      format = 'a3';
    } else if (headerCount >= 6) {
      orientation = 'landscape';
      format = 'a4';
    } else {
      orientation = 'portrait';
      format = 'a4';
    }
    const meta = collectProjectMeta();
    // v5.185.0 — STANDALONE EXPORT FRONT MATTER (Bryn: "smaller per aspect
    // exports should have the cover page included but only relevant info
    // plus a bold note to say which document it is with a sub head to
    // explain to refer to full takeoff export for all info" + "[cabling
    // info] included on the cs only export").
    //   • Light EXTRACT cover: project identity + bold document-type banner
    //     + "refer to the full take-off" subhead (template o.extract).
    //   • opts.prefaceInfoPages: CABLING STANDARDS pageIndexes ([3, 4] on
    //     the Cable Schedule exports) rendered after the cover.
    // Front matter is A4 landscape (the HTML deck's native size); the
    // schedule then continues in its own format via explicit addPage args
    // (_pageFormat/_pageOrientation keep continuation pages in step).
    const _svcChrome = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10).map(sv => ({ nn: sv.nn, key: sv.key, name: sv.name, colour: sv.colour })) : null;
    const _htmlFrontOk = !!(window.SonorPdfHtmlCover
      && typeof window.SonorPdfHtmlCover.available === 'function'
      && window.SonorPdfHtmlCover.available());
    const _wantCover = opts.noCover !== true && _htmlFrontOk
      && typeof window.SonorPdfHtmlCover.renderCover === 'function';
    const _prefaceList = (_htmlFrontOk && Array.isArray(opts.prefaceInfoPages)
      && typeof window.SonorPdfHtmlCover.renderCablingInfo === 'function')
      ? opts.prefaceInfoPages.slice() : [];
    let pdf;
    let _frontPages = 0;
    if (_wantCover || _prefaceList.length) {
      pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
      _registerSonorFonts(pdf);
      const _fw = pdf.internal.pageSize.getWidth();
      const _fh = pdf.internal.pageSize.getHeight();
      if (_wantCover) {
        try {
          if (typeof setStatus === 'function') setStatus('Rendering extract cover (HTML/CSS) …');
          const cov = await window.SonorPdfHtmlCover.renderCover({
            projectName: meta.name, client: meta.client, address: meta.address,
            reference: meta.ref || '', status: meta.status, revision: meta.revision,
            issueDate: meta.dateUk || meta.date,
            services: _svcChrome,
            backdropImg: (await _coverBackdrop()) || null,   // v5.249.0 §41
            extract: {
              label: opts.title || 'Schedule',
              note: 'EXTRACT — refer to the FULL TAKE-OFF export for complete project information.'
            }
          });
          if (cov && cov.dataUrl) {
            pdf.addImage(cov.dataUrl, 'JPEG', 0, 0, _fw, _fh, 'aspect-extract-cover');
            _frontPages = 1;
          }
        } catch (e) { console.warn('[SonorPdf v5.185.0 aspect] extract cover failed — continuing without:', e); }
      }
      for (let _pi = 0; _pi < _prefaceList.length; _pi++) {
        try {
          const _r = await window.SonorPdfHtmlCover.renderCablingInfo({
            pageIndex: _prefaceList[_pi],
            accentHex: '#475161', sectionTitle: null, appName: 'TAKEOFFS',
            reference: meta.ref || '', projectName: meta.name, client: meta.client,
            address: meta.address, revision: meta.revision,
            issueDate: meta.dateUk || meta.date, status: meta.status,
            pageNum: _frontPages + 1, pageTotal: null,
            pageOrdinal: _pi, totalInfoPages: _prefaceList.length,
            footerSlim: false,
            services: _svcChrome
          });
          if (_r && _r.dataUrl) {
            // v5.185.1 — page added only AFTER a successful render (a mid-
            // loop failure no longer leaves blank pages behind).
            if (_frontPages > 0) pdf.addPage('a4', 'landscape');
            pdf.addImage(_r.dataUrl, 'JPEG', 0, 0, _fw, _fh, 'aspect-preface-' + _pi);
            _frontPages++;
          }
        } catch (e) { console.warn('[SonorPdf v5.185.0 aspect] preface info page failed:', e); }
      }
      // Schedule starts on a fresh page in ITS OWN format — unless NO front
      // matter actually rendered (then the constructor page is still blank
      // and the schedule paints straight onto it, swapped to the schedule's
      // own format when it differs from the a4-landscape front-matter doc).
      if (_frontPages > 0) {
        pdf.addPage(format, orientation);
      } else if (format !== 'a4' || orientation !== 'landscape') {
        pdf.addPage(format, orientation);
        try { pdf.deletePage(1); } catch (_) {}
      }
    } else {
      pdf = new jsPDF({ orientation, unit: 'pt', format, compress: true }); // v5.39.0 (B-350) — stream compression, 40-60% smaller files
      _registerSonorFonts(pdf);
    }
    _emitAspectIntoPdf(pdf, Object.assign({}, opts, {
      _pageNumStart: _frontPages + 1,
      _pageFormat: format,
      _pageOrientation: orientation
    }), meta);

    const stamp = meta.date;
    const slug = (opts.aspect || 'aspect').toLowerCase();
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-${slug}_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus('PDF exported — ' + fname);
    return fname;
  }

  // ---------------------------------------------------------------------
  // v5.5.58 — UNIFICATION Phase 4: standalone aspect schedule via pdf-lib
  // ---------------------------------------------------------------------
  // Mirrors aspectPdfLib's relationship to fullDocumentPdfLib: builds its
  // own minimal pdf-lib doc (no cover, no reference pages), embeds fonts +
  // wordmark, calls _paintAspectPdfLib (now multi-page in v5.5.58), runs
  // final pagination pass, saves + downloads. Twelve schedule buttons
  // (Rooms / Symbols / Cables / CableSchedV2 / LEDs / Lighting / Shades /
  // TVs / PJ / Snags / Zones / PerRoom) all flow through this on the
  // unified path. Falls back to legacy jsPDF _emitAspectIntoPdf otherwise.
  async function aspectPdfLib(opts) {
    if (!_pdfLibAvailable()) return null;
    try {
      const { PDFDocument, StandardFonts } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      let wordmarkRef = null;
      if (window.__SONOR_WORDMARK_PDF__) {
        try {
          const wmStr = String(window.__SONOR_WORDMARK_PDF__);
          const wmBytes = _pdfLibBase64ToBytes(wmStr);
          wordmarkRef = (wmStr.indexOf('image/png') !== -1)
            ? await pdfDoc.embedPng(wmBytes)
            : await pdfDoc.embedJpg(wmBytes);
        } catch (e) { console.warn('[SonorPdf v5.5.58 aspectPdfLib] wordmark embed failed:', e); }
      }

      const meta = collectProjectMeta();
      const ctx = { fontReg, fontBold, wordmarkRef, meta };

      // Paint the aspect — multi-page in v5.5.58. _paintAspectPdfLib stamps
      // aspect._pagesAdded with how many pages it produced.
      // v5.12.0 FIX (audit #3): the stamp lands on the MERGED COPY passed
      // to the painter — reading opts._pagesAdded afterwards was always
      // undefined, so the status line always claimed "1 page".
      const _mergedOpts = Object.assign({}, opts, {
        _pageNumStart: 1,
        _pageTotal: null    // _finalisePaginationPdfLib rewrites all stamps at the end
      });
      _paintAspectPdfLib(pdfDoc, ctx, _mergedOpts);
      const pagesAdded = _mergedOpts._pagesAdded || 1;

      // Final pagination pass — rewrites X/Y stamps with actual page count
      try { _finalisePaginationPdfLib(pdfDoc, ctx); }
      catch (e) { console.warn('[SonorPdf v5.5.58 aspectPdfLib] page renumber failed:', e); }

      // v5.5.69 — bake Sonor metadata + debug build stamp before save
      try { _applyDocumentMetadataPdfLib(pdfDoc, meta, { title: opts.title || 'Schedule' }); } catch (_) {}
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = meta.date;
      const slug = (opts.aspect || 'aspect').toLowerCase();
      const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const fname = opts.filename || `sonor-${projSlug}-${slug}_${stamp}.pdf`;
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof setStatus === 'function') {
        setStatus(`Schedule (unified) exported — ${fname} (${pagesAdded} page${pagesAdded === 1 ? '' : 's'} · v5.5.58 same painter as Full Doc)`);
      }
      return fname;
    } catch (err) {
      console.error('[SonorPdf v5.5.58 aspectPdfLib] threw — caller will fall back to jsPDF:', err);
      return null;
    }
  }

  // ---- PLAN (annotated full-plan PDF builder) ----
  // opts: {
  //   title:    string  - default 'FULL PLAN'
  //   summary:  [{label,value}]  - optional summary chip rows
  //   legend:   [{colour,label,qty}]  - optional inset legend
  //   filename: string
  // }
  // ---- COVER SHEET (v1.33.0 stylish redesign) ----
  // Hero front page for multi-page decks. v1.33.0 drops the standard
  // 5-column footer title-block (kept on every other page) in favour
  // of a refined Sonor-brand strip. Whole-page composition: top slate
  // band, generous hero zone, info-grid as boxed cells, two-column
  // lower section with FLOORS + PROJECT TOTALS panels, brand strip
  // footer with wordmark + service-dot strip + tagline + contact.
  // Per Bryn directive: "make the cover page more stylish... remove
  // the standard title block for this page only but present most of
  // the useful info in a more stylish fashion in keeping with the
  // sonor brand but make it look amazing for the front page".
  // ---------------------------------------------------------------------
  // v5.5.74 — UNIFIED jsPDF cover painter (shared between plans + fullDocument)
  // ---------------------------------------------------------------------
  // Bryn architectural directive 2026-05-20: "surely there should just be
  // one pdf export method, so everything is consistent". Pre-v5.5.74 the
  // plans() function had its OWN HTML-cover try-block + paintCoverSheet
  // fallback. fullDocument() had a SEPARATE identical-ish block. They
  // drifted. Now this helper is the SINGLE SOURCE for jsPDF cover painting.
  //
  // Returns true if the HTML cover succeeded, false if fell back to
  // native paintCoverSheet. Either way, page 1 of `pdf` is now a cover.
  //
  // Opt-out (same flags as legacy paths):
  //   window.__SONOR_PDF_HTML_COVER__ = false
  //   localStorage.takeoffs-pdf-html-cover = '0'
  // v5.5.78 — merge per-floor legend captures into a SINGLE itemised legend
  // row array (same row shape as `_sonorBuildLegendForActive`) for the
  // cover RHS. Bryn directive 2026-05-21 (with screenshot): cover legend
  // must match the on-plan-page legend exactly — service NN underline,
  // sub-service label, item row with shape chip + short code + label +
  // summed qty. No per-floor breakdown.
  //
  // Algorithm:
  //   1. Walk every captured floor's legend rows (in floor order).
  //   2. Three-level merge keyed by (serviceNn, subLabel, itemKey).
  //   3. Item qty sums across floors; first-seen header metadata wins.
  //   4. Emit rows in canonical order: service NN ascending → sub order as
  //      first seen → items as first seen. This matches the per-floor
  //      ordering convention used everywhere else in the workspace.
  //   5. Suppress empty sub groups (sub with no items in any floor).
  //
  // Returns an array of legend rows ready for SonorPdfHtmlComponents
  // .legendPanel(rows), or null when there's nothing to render.
  function _aggregateMergedLegendFromCapture(captured) {
    if (!Array.isArray(captured) || !captured.length) return null;
    // services: Map<svcNn, {meta, subs: Map<subLabel, {meta, items: Map<itemKey, itemRow>}>}>
    const services = new Map();
    captured.forEach(cap => {
      const legend = (cap && Array.isArray(cap.legend)) ? cap.legend : [];
      let svcNn = null;
      let subLabel = null;
      legend.forEach(r => {
        if (!r) return;
        if (r.kind === 'group' && r.level === 'service') {
          const lbl = String(r.label || '');
          const m = /^(\d{2})/.exec(lbl);
          svcNn = m ? m[1] : lbl.slice(0, 2);
          subLabel = null;
          if (svcNn && !services.has(svcNn)) {
            services.set(svcNn, {
              meta: {
                kind: 'group', level: 'service',
                label: r.label || '',
                colour: r.colour || r.accent || '#999',
                accent: r.accent || r.colour || '#999'
              },
              subs: new Map()
            });
          }
          return;
        }
        if (r.kind === 'group' && r.level === 'sub') {
          if (!svcNn) return;
          subLabel = String(r.label || '');
          const svc = services.get(svcNn);
          if (svc && !svc.subs.has(subLabel)) {
            svc.subs.set(subLabel, {
              meta: {
                kind: 'group', level: 'sub',
                label: subLabel,
                colour: r.colour || svc.meta.colour
              },
              items: new Map()
            });
          }
          return;
        }
        if (r.kind === 'item') {
          if (!svcNn) return;
          // sub_label may be null (items emitted before any sub header — fall back
          // to '' as the bucket key so they group together under the service).
          const subKey = subLabel || '';
          const svc = services.get(svcNn);
          if (!svc) return;
          if (!svc.subs.has(subKey)) {
            svc.subs.set(subKey, {
              meta: subKey ? { kind: 'group', level: 'sub', label: subKey, colour: svc.meta.colour } : null,
              items: new Map()
            });
          }
          const bucket = svc.subs.get(subKey);
          const qty = (typeof r.qty === 'number') ? r.qty : (parseInt(r.qty, 10) || 0);
          const itemKey = (r.short || '') + '|' + (r.shape || '') + '|' + (r.label || '');
          if (bucket.items.has(itemKey)) {
            bucket.items.get(itemKey).qty += qty;
          } else {
            bucket.items.set(itemKey, {
              kind: 'item',
              colour: r.colour || svc.meta.colour,
              accent: r.accent || r.colour || svc.meta.colour,
              label: r.label || '',
              shape: r.shape || null,
              short: r.short || null,
              qty: qty
            });
          }
        }
      });
    });

    // Emit in canonical order — service NN ascending; sub + item in
    // first-seen order (Map iteration preserves insertion order).
    const out = [];
    const svcKeys = Array.from(services.keys()).sort((a, b) => a.localeCompare(b));
    svcKeys.forEach(svcNn => {
      const svc = services.get(svcNn);
      // Skip a service header that has no items at all (rare but possible
      // if a floor declared the service group then had no symbols).
      let serviceHasItems = false;
      svc.subs.forEach(sub => { if (sub.items.size) serviceHasItems = true; });
      if (!serviceHasItems) return;
      out.push(svc.meta);
      svc.subs.forEach(sub => {
        if (!sub.items.size) return;
        if (sub.meta) out.push(sub.meta);
        sub.items.forEach(item => out.push(item));
      });
    });
    return out.length ? out : null;
  }

  // v2.8.0 (Takeoffs v5.274.0, 2026-11-01 — Demo re-render: "the FULL DOCUMENT cover still draws the old dark-header-band + cream
  // info / legend cover") — the HOUSE ART COVER, the Service Contracts front page every Sonor document now uses (sonor-pdf-luxury
  // 1.7.0 coverArt geometry, painted natively in jsPDF so the 100+ page deck stays one jsPDF document): data/scope-cover.jpg on a
  // portrait page / data/scope-cover-landscape.jpg on a landscape page (the other twin if one is missing), full bleed, cover-fit,
  // no fade; mark + wordmark, eyebrow, title (wraps, steps 54 → 26 pt), subtitle and three info cells set ONLY in the clean zone
  // (landscape: the left 55 % · portrait: the top 52 %); thin gold inset frame; CEDIA bottom right. No cream anywhere. A project
  // cover PHOTO (takeoffs-push link metadata.cover_photo → _coverBackdrop) still wins and keeps the photo cover, as on every other
  // Sonor cover. Opt out: localStorage takeoffs-pdf-art-cover = '0'. Returns true when painted.
  const _artCoverCache = {};
  async function _artCoverBytes(url) {
    if (_artCoverCache[url] !== undefined) return _artCoverCache[url];
    let out = null;
    try { const r = await fetch(url); if (r.ok) out = new Uint8Array(await r.arrayBuffer()); } catch (_) { out = null; }
    _artCoverCache[url] = out; return out;
  }
  async function _paintArtCoverJsPdf(pdf, o) {
    try { if (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-art-cover') === '0') return false; } catch (_) {}
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), LAND = W > H;
    const base = (o && o.base) || 'data/';
    const want = base + (LAND ? 'scope-cover-landscape.jpg' : 'scope-cover.jpg'), other = base + (LAND ? 'scope-cover.jpg' : 'scope-cover-landscape.jpg');
    const bytes = (await _artCoverBytes(want)) || (await _artCoverBytes(other));
    if (!bytes) return false;
    const LX = (typeof window !== 'undefined' && window.SonorPdfLuxury) || null;
    const C = Object.assign({ GOLD: [173, 153, 120], GOLDL: [200, 180, 142], CREAM: [251, 250, 247], DARK: [9, 8, 7], INFO: [168, 156, 136] }, (LX && LX.COL) ? { GOLD: LX.COL.GOLD, GOLDL: LX.COL.GOLDL, DARK: LX.COL.DARK } : {});
    const CREAMTXT = [251, 250, 247];   // type colour on the black art (not a paper colour)
    const k = Math.min(W, H) / 595.28, m = ((LX && LX.M) || 48) * k, fi = ((LX && LX.M) || 48) * 0.62 * k;
    const fonts = (typeof pdf.getFontList === 'function') ? pdf.getFontList() : {};
    const FF = fonts.Gilroy ? 'Gilroy' : 'helvetica';
    const setF = (st, sz) => { try { pdf.setFont(FF, st); } catch (_) { pdf.setFont('helvetica', st === 'bold' ? 'bold' : 'normal'); } pdf.setFontSize(sz); };
    const fill = (c) => pdf.setFillColor(c[0], c[1], c[2]);
    const ink = (c) => pdf.setTextColor(c[0], c[1], c[2]);
    const draw = (c) => pdf.setDrawColor(c[0], c[1], c[2]);
    const gs = (op) => { try { pdf.setGState(new pdf.GState({ opacity: op, 'stroke-opacity': op })); } catch (_) {} };
    const tw = (t, st, sz) => { setF(st, sz); return pdf.getTextWidth(String(t)); };
    // text with jsPDF's top-left page origin: baseline = top + size (matches the luxury painter's drawText(y = H - top - size))
    const T = (t, x, top, sz, st, c, cs) => { setF(st, sz); ink(c); pdf.text(String(t), x, top + sz * 0.8, cs ? { charSpace: cs } : undefined); };
    fill(C.DARK); pdf.rect(0, 0, W, H, 'F');
    let props = null; try { props = pdf.getImageProperties(bytes); } catch (_) {}
    const iw = (props && props.width) || (LAND ? 3508 : 2480), ih = (props && props.height) || (LAND ? 2480 : 3508);
    const sc = Math.max(W / iw, H / ih), dw = iw * sc, dh = ih * sc;
    pdf.addImage(bytes, 'JPEG', (W - dw) / 2, (H - dh) / 2, dw, dh, 'sonor-art-cover-' + (LAND ? 'l' : 'p'), 'NONE');
    // thin gold inset frame
    gs(0.34); draw(C.GOLD); pdf.setLineWidth(0.7 * k); pdf.rect(fi, fi, W - fi * 2, H - fi * 2, 'S'); gs(1);
    // mark + wordmark (the white wordmark PNG carries both)
    const brandTop = fi + 22 * k;
    const wm = (typeof window !== 'undefined') ? window.__SONOR_WORDMARK_PDF_WHITE__ : null;
    if (wm) { const wh = 30 * k, ww = wh * (300 / 85); try { pdf.addImage(wm, 'PNG', m, brandTop, ww, wh, 'sonor-wordmark-white'); } catch (_) {} }
    else T('SONOR', m, brandTop + 6 * k, 18 * k, 'bold', CREAMTXT, 4.2 * k);
    // the clean zone
    const zx = m, zw = LAND ? W * 0.55 - m - 14 * k : W - m * 2;
    const zTop = brandTop + 30 * k + 46 * k, zBot = LAND ? H - fi - 34 * k : H * 0.52;
    const title = String((o && o.title) || 'Project'), eyebrow = String((o && o.eyebrow) || 'TAKE-OFF').toUpperCase();
    const sub = (o && o.subtitle) ? String(o.subtitle) : '', info = ((o && o.info) || []).slice(0, 3);
    const wrapTo = (t, st, sz, w, max) => {
      setF(st, sz); let ls = pdf.splitTextToSize(String(t), w);
      if (max && ls.length > max) { ls = ls.slice(0, max); let last = ls[max - 1] + '…'; while (last.length > 1 && pdf.getTextWidth(last) > w) last = last.slice(0, -2) + '…'; ls[max - 1] = last; }
      return ls;
    };
    const cols = info.length || 1, cw = zw / cols, infoSize = (cw < 150 * k ? 11 : 12.5) * k, infoLh = infoSize * 1.2;
    const infoVals = info.map(c => wrapTo(String(c[1] || '—').replace(/\s*·\s*/g, ' · '), 'bold', infoSize, cw - 16 * k, 3));
    const infoLines = infoVals.reduce((a, v) => Math.max(a, v.length), 1);
    const subSize = 19 * k, subLh = 24 * k;
    const layout = (tsz) => {
      const tl = wrapTo(title, 'bold', tsz, zw), sl = sub ? wrapTo(sub, 'normal', subSize, zw, 2) : [];
      const h = 8.5 * k + 22 * k + tl.length * tsz * 1.06 + (sl.length ? 14 * k + sl.length * subLh : 0) + (info.length ? 34 * k + 13 * k + infoLines * infoLh : 0);
      return { tsz, tl, sl, h };
    };
    const sizes = [54, 46, 40, 34, 30, 26].map(v => v * k); let L = null;
    for (let i = 0; i < sizes.length; i++) {
      const c = layout(sizes[i]), wide = c.tl.some(ln => tw(ln, 'bold', sizes[i]) > zw);
      if (!wide && c.tl.length <= (i < 3 ? 2 : 3) && c.h <= zBot - zTop) { L = c; break; }
    }
    if (!L) { L = layout(sizes[sizes.length - 1]); L.tl = wrapTo(title, 'bold', L.tsz, zw, 3); }
    let y = zTop + Math.max(0, zBot - zTop - L.h) * (LAND ? 0.5 : 0.62);
    draw(C.GOLD); pdf.setLineWidth(1 * k); pdf.line(zx, y + 4 * k, zx + 26 * k, y + 4 * k);
    T(eyebrow, zx + 34 * k, y, 8.5 * k, 'normal', C.GOLDL, 3.2 * k);
    y += 8.5 * k + 22 * k;
    L.tl.forEach(ln => { T(ln, zx - 2 * k, y, L.tsz, 'bold', CREAMTXT); y += L.tsz * 1.06; });
    if (L.sl.length) { y += 14 * k; L.sl.forEach(ln => { T(ln, zx, y, subSize, 'normal', C.GOLDL); y += subLh; }); }
    if (info.length) {
      y += 34 * k;
      gs(0.45); draw(C.GOLD); pdf.setLineWidth(0.5 * k); pdf.line(zx, y - 16 * k, zx + zw, y - 16 * k); gs(1);
      info.forEach((c, i) => {
        const x = zx + i * cw;
        T(String(c[0] || '').toUpperCase(), x, y, 7 * k, 'normal', C.INFO, 1.8 * k);
        infoVals[i].forEach((ln, j) => T(ln, x, y + 13 * k + j * infoLh, infoSize, 'bold', CREAMTXT));
      });
    }
    // CEDIA — the clear band below the frame, bottom right
    const cyL = H - 14 * k; let cediaDone = false;
    try {
      const cb = await _artCoverBytes(base + 'cedia-member-stacked.png');
      if (cb) { const pp = pdf.getImageProperties(cb), ch = ((pp.width / pp.height) < 3 ? 13 : 9) * k, cwd = ch * (pp.width / pp.height); pdf.addImage(cb, 'PNG', W - m - cwd, cyL - ch / 2, cwd, ch, 'sonor-cedia'); cediaDone = true; }
    } catch (_) {}
    if (!cediaDone) { setF('normal', 6 * k); ink(C.INFO); pdf.text('CEDIA MEMBER', W - m, cyL, { align: 'right', charSpace: 1.2 * k }); }
    try { window.__SONOR_LAST_COVER_PATH__ = 'art'; } catch (_) {}
    return true;
  }
  // the info a Takeoffs art cover carries (title = the project, eyebrow = the document)
  function _artCoverOpts(meta, docTitle) {
    meta = meta || {};
    const rev = meta.revision ? ('Rev ' + meta.revision) : '';
    return {
      eyebrow: String(docTitle || 'TAKE-OFF').toUpperCase() + '  ·  TAKEOFFS',
      title: meta.name || meta.ref || 'Project',
      subtitle: meta.address || meta.client || '',
      info: [['PROJECT', meta.ref || '—'], ['CLIENT', meta.client || '—'], ['ISSUED', [meta.dateUk || meta.date || '', rev].filter(Boolean).join(' · ') || '—']]
    };
  }
  // stamp the cover page so _finalisePagination never paints page chrome over it
  function _noopCoverStamp(pdf, src) {
    try {
      pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
      pdf.__sonorPageStamps__.push({ page: (typeof pdf.internal.getCurrentPageInfo === 'function' ? pdf.internal.getCurrentPageInfo().pageNumber : pdf.internal.pages.length - 1), x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0, format: 'noop', source: src || 'art-cover' });
    } catch (_) {}
  }

  async function _renderCoverJsPdf(pdf, opts, meta, pageTotalEstimate, title, kind) {
    // v2.8.0 — the house art cover unless the project has a cover photo
    try { if (!(await _coverBackdrop()) && await _paintArtCoverJsPdf(pdf, _artCoverOpts(meta, title))) { _noopCoverStamp(pdf, 'art-cover-' + (kind || 'export')); return true; } } catch (e) { console.warn('[SonorPdf] art cover failed — HTML cover instead:', e); }
    const htmlCoverDisabled =
      (typeof window !== 'undefined') && (
        window.__SONOR_PDF_HTML_COVER__ === false ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-cover') === '0')
      );
    let htmlCoverUsed = false;
    if (!htmlCoverDisabled &&
        typeof window !== 'undefined' &&
        window.SonorPdfHtmlCover &&
        typeof window.SonorPdfHtmlCover.available === 'function' &&
        window.SonorPdfHtmlCover.available()) {
      try {
        if (typeof setStatus === 'function') setStatus('Rendering luxury cover (HTML/CSS, ' + (kind || 'export') + ') …');
        const _toNum = v => {
          if (v == null) return null;
          if (typeof v === 'number') return Number.isFinite(v) ? v : null;
          const n = parseFloat(String(v));
          return Number.isFinite(n) ? n : null;
        };
        const _sortFloorsHtml = (typeof window.sonorSortFloors === 'function')
          ? window.sonorSortFloors
          : ((window.SonorPdfHtmlHelpers && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
             ? window.SonorPdfHtmlHelpers.sortFloors
             : null);
        const _floorsHtmlMapped = (Array.isArray(opts.floorRows) ? opts.floorRows : []).map(r => ({
          name: r.name || r.code || '—',
          code: r.code,
          rooms: r.rooms,
          symbols: r.syms != null ? r.syms : r.symbols,
          areaM2: _toNum(r.areaM2 != null ? r.areaM2 : (r.area_m2 != null ? r.area_m2 : r.area)),
          perimeterM: _toNum(r.perimeterM != null ? r.perimeterM : (r.perimeter_m != null ? r.perimeter_m : r.perimeter))
        }));
        const floorsForHtml = _sortFloorsHtml ? _sortFloorsHtml(_floorsHtmlMapped) : _floorsHtmlMapped;
        let totalsForHtml = null;
        try {
          if (typeof computeProjectTotals === 'function') {
            const t = computeProjectTotals();
            if (t && t.grand) {
              totalsForHtml = {
                floors: t.grand.floors, rooms: t.grand.rooms,
                blocks: (t.grand.symbols || 0) + (t.grand.shades || 0),   // v5.145.0 — drawn shades count as blocks (Bryn)
                areaM2: t.grand.areaM2, perimeterM: t.grand.perimeterM,
                cableM: t.grand.cableM, ledM: t.grand.ledM,
                shades: t.grand.shades
              };
            }
          }
        } catch (_) {}
        const services = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
          ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
          : null;
        // v5.5.78 — Merge per-floor legend captures into a SINGLE itemised
        // legend row array for the cover RHS (matches on-plan-page legend
        // format exactly — service NN header, sub label, item rows with
        // shape chip + short + label + summed qty). No per-floor breakdown.
        // Bryn directive 2026-05-21 (with screenshot reference).
        // Precedence: caller-provided opts.coverLegend > derived from
        // opts.coverLegendCapture (Plans passes captured[]) > null
        // (renderCover falls back to revisionTimeline slot).
        let coverLegendRows = Array.isArray(opts.coverLegend) ? opts.coverLegend : null;
        if (!coverLegendRows && Array.isArray(opts.coverLegendCapture)) {
          try {
            coverLegendRows = _aggregateMergedLegendFromCapture(opts.coverLegendCapture);
          } catch (e) {
            console.warn('[SonorPdf v5.5.78 cover] merged legend aggregation failed:', e);
          }
        }
        const result = await window.SonorPdfHtmlCover.renderCover({
          title: title,
          subtitle: 'PROJECT TAKE-OFF',
          projectName: meta.name,
          client: meta.client,
          address: meta.address,
          reference: meta.ref || '—',
          status: meta.status,
          issueDate: meta.dateUk || meta.date,
          revision: meta.revision,
          revisionHistory: meta.revisionHistory || [],
          // v5.144.0 (Bryn export: cover pills read +0 ~0 -0 ?0 while the
          // title block said ?4) — the cover callsites never forwarded the
          // cloud counts, so revPillsPanel fell back to an all-zero object.
          revCounts: meta.revCounts || null,
          revAdded: meta.revAdded || 0,
          revMoved: (meta.revMoved != null ? meta.revMoved : meta.revChanged) || 0,
          revRemoved: meta.revRemoved || 0,
          revRfi: meta.revRfi || 0,
          revNote: meta.revNote || 0,
          appName: 'Takeoffs',
          appVersion: meta.appVersion,
          accentHex: '#ad9978',   // v5.138.0/v5.143.0 — SONOR GOLD (re-applied to root master)
          backdropImg: _fdBackdrop || null,   // v5.249.0 — project cover photo (takeoffs-push link metadata.cover_photo) fades to black on the luxury hero (§41); v2.8.0 — read once above
          services,
          floors: floorsForHtml,
          totals: totalsForHtml,
          coverLegend: coverLegendRows,
          // v5.5.77 — hero-top strip hidden by default. Opt in via
          // opts.showHeroTopBar to restore the legacy hero-top date/title.
          showHeroTopBar: opts.showHeroTopBar === true
        });
        if (result && result.dataUrl) {
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          pdf.addImage(result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'cover-html');
          htmlCoverUsed = true;
          try { window.__SONOR_LAST_COVER_PATH__ = 'html'; } catch (_) {}
          try {
            pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
            pdf.__sonorPageStamps__.push({
              page: 1, x: 0, y: 0, clearW: 0, clearH: 0, format: 'noop-suppress'
            });
          } catch (_) {}
          console.log('[SonorPdf v5.5.74 cover] HTML cover rendered OK ✓ (' + (kind || 'export') + ', bytes=' +
            (result.dataUrl ? result.dataUrl.length : 0) + ')');
        }
      } catch (e) {
        console.warn('[SonorPdf v5.5.74 cover] HTML cover failed for ' + (kind || 'export') + ' — falling back to paintCoverSheet:', e);
      }
    }
    if (!htmlCoverUsed) {
      paintCoverSheet(pdf, {
        title, meta,
        floorRows: opts.floorRows,
        summary: opts.summary,
        summaryTitle: opts.summaryTitle,
        pageTotal: pageTotalEstimate
      });
      try { window.__SONOR_LAST_COVER_PATH__ = 'native'; } catch (_) {}
    }
    return htmlCoverUsed;
  }

  function paintCoverSheet(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const meta = opts.meta || collectProjectMeta();
    const isWide = pageW > 800;

    // v5.4.11 — Sonor canonical rounded page-edge border behind everything.
    _paintPageBorder(pdf);
    // v5.3.6 — Bumped outer margin 56 → 72pt (A3) / 56 → 56 (A4) for
    // luxury-brochure breathing room. Per Bryn directive: "make the cover
    // much more stylish, like luxury brochure almost." The hero composition
    // gains an extra 32pt of horizontal whitespace either side at A3 —
    // immediate "expensive deliverable" feel.
    const M = isWide ? 72 : 56;
    const innerW = pageW - M * 2;

    // ---- v5.4.0 — APP-HEADER HERO RIBBON (luxury brochure) ----
    // Bryn directive (2026-05-07): "fully stylise the front cover page to
    // look like a website / brochure / header of the apps with gradients
    // & images etc."
    //
    // Pre-v5.4.0: thin 28pt slate strip + 2pt accent — utilitarian.
    // Post-v5.4.0: 110pt deep slate hero ribbon with simulated vertical
    // gradient (5 horizontal slate-to-dark-slate bands) + 10-service
    // colour stripe at bottom edge running full width — same visual
    // language as the Sonor website + Master Hub + every app's nav
    // header. Reads as "branded deliverable, not a generated report".
    const HERO_H = isWide ? 130 : 100;
    // Stepped gradient — 6 slate bands going light-to-dark top→bottom.
    // jsPDF has no native gradient; multi-band fill is the standard
    // workaround. Palette derived from COLOURS.bar (#151A22) lightened
    // 18%/12%/6%/0%/-6%/-12% via _mixWithWhite + _darken.
    const heroBands = [
      _mixWithWhite(COLOURS.bar, 0.18),  // top — lighter
      _mixWithWhite(COLOURS.bar, 0.12),
      _mixWithWhite(COLOURS.bar, 0.06),
      COLOURS.bar,                         // mid
      _darken(COLOURS.bar, 0.10),
      _darken(COLOURS.bar, 0.20)           // bottom — darkest
    ];
    const bandH = HERO_H / heroBands.length;
    heroBands.forEach((c, i) => {
      _setFill(pdf, c);
      pdf.rect(0, i * bandH, pageW, bandH + 0.6, 'F');  // +0.6 overlap to hide hairlines
    });
    // 10-service colour ribbon along bottom edge of hero — 4pt tall,
    // each segment is the service colour. Same chrome as the website
    // header service-strip + Master Hub. Bryn approved canonical.
    const services10 = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10) : null;
    if (services10 && services10.length) {
      const segW = pageW / services10.length;
      services10.forEach((s, i) => {
        _setFill(pdf, (s && s.colour) || '#999');
        pdf.rect(i * segW, HERO_H - 4, segW + 0.6, 4, 'F');
      });
    } else {
      _setFill(pdf, ASPECT_ACCENT.plan);
      pdf.rect(0, HERO_H - 4, pageW, 4, 'F');
    }
    // Document title + project ref TOP, aligned to the rule-of-thirds
    // upper band of the gradient. Letter-spaced editorial caps.
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.surfaceTxt);
    const docType = String(opts.title || 'TAKE-OFF').toUpperCase();
    pdf.text(docType, M, 28, { charSpace: 2 });
    if (meta.ref) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(10);
      _setText(pdf, '#cdc7bd');
      pdf.text(meta.ref, pageW - M, 28, { align: 'right', charSpace: 1 });
    }
    // v5.4.0 — Issue date inline under doc-type, muted on slate
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8.5);
    _setText(pdf, '#a8b0bc');
    pdf.text((meta.dateUk || meta.date || '—').toUpperCase(), M, 42, { charSpace: 1 });
    if (meta.status) {
      pdf.text((meta.status || '').toUpperCase(), pageW - M, 42, { align: 'right', charSpace: 1 });
    }
    // v1.65.0 — AS-BUILT pill in the top slate band. Sits left of the
    // ref text-right anchor so the right-side ref still reads. Charcoal
    // pill with bone-white text — high contrast against the slate band.
    // Renders only when the active revision for this project is flagged.
    var asBuilt = (typeof window !== 'undefined') ? window._activeAsBuiltRev : null;
    if (asBuilt) {
      var abLabel = 'AS-BUILT';
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8);
      var abTextW = pdf.getTextWidth(abLabel);
      var abPadX = 8;
      var abPillW = abTextW + abPadX * 2;
      var abPillH = 14;
      // Anchor: 14pt left of the ref text (or right margin if no ref)
      var refW = meta.ref ? pdf.getTextWidth(meta.ref) : 0;
      var abPillX = pageW - M - refW - (refW ? 14 : 0) - abPillW;
      var abPillY = 18 - abPillH + 3;  // align baselines roughly
      _setFill(pdf, '#e37c59');         // terracotta — sister tone to charcoal, reads as a stamp
      pdf.roundedRect(abPillX, abPillY, abPillW, abPillH, 2, 2, 'F');
      _setText(pdf, '#FFFFFF');
      pdf.text(abLabel, abPillX + abPillW / 2, abPillY + 10, { align: 'center', charSpace: 1 });
    }

    // ---- HERO BAND ----
    // v5.4.0 — Pushed below the new HERO_H ribbon (130pt A3 / 100pt A4)
    // with 30pt breathing room above the wordmark. Composition reads:
    // hero ribbon → wordmark → CEDIA → eyebrow → project name → ...
    const heroTop = HERO_H + (isWide ? 30 : 22);
    // v5.4.47 — prefer WHITE variant (Bryn directive 2026-05-08): every
    // native wordmark site sits on a dark slate surface (footer / cover
    // hero / brand strip), so white reads against the chrome. Fall back
    // to dark variant if white isn't loaded.
    const wmDataUrl = window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__;
    const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
    if (wmDataUrl) {
      const wmW = isWide ? 220 : 160;
      const wmH = wmW * (wmDim.h / wmDim.w);
      try {
        pdf.addImage(wmDataUrl, 'PNG', (pageW - wmW) / 2, heroTop, wmW, wmH, 'wordmark-sonor');
      } catch (e) { /* fallback below */ }
    }

    // v5.1.9 — CEDIA MEMBER text-rendered badge sub-hero. Sits between
    // wordmark and the "PROJECT TAKE-OFF" eyebrow. Same compact style
    // — orange CEDIA + slate
    // MEMBER, letter-spaced, centred. Pure text (no image asset embed)
    // so it scales perfectly + stays sharp at any zoom + adds zero KB.
    const cediaY = heroTop + (isWide ? 70 : 52);
    {
      const cediaSize = isWide ? 11 : 9;
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(cediaSize);
      const cediaText = 'CEDIA';
      const memberText = ' MEMBER';
      const cediaTw = pdf.getTextWidth(cediaText);
      const memberTw = pdf.getTextWidth(memberText);
      const totalW = cediaTw + memberTw;
      const startX = (pageW - totalW) / 2;
      _setText(pdf, '#e37c59');  // CEDIA orange (terracotta — Sonor svc05)
      pdf.text(cediaText, startX, cediaY, { charSpace: 1 });
      _setText(pdf, COLOURS.muted);
      pdf.text(memberText, startX + cediaTw, cediaY, { charSpace: 1 });
    }

    // v5.3.6 — Editorial eyebrow with wider letter-spacing for luxury
    // brochure feel. "— PROJECT TAKE-OFF —" wrapped in em-dashes mirrors
    // the section-divider eyebrow (v5.2.2) for visual consistency
    // across the deck.
    const labelY = heroTop + (isWide ? 95 : 70);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(isWide ? 9 : 8);
    _setText(pdf, ASPECT_ACCENT.plan);
    pdf.text('— PROJECT TAKE-OFF —', pageW / 2, labelY, { align: 'center', charSpace: 4 });

    // v5.4.18/v5.4.23 — Prominent floating status pill ABOVE the project
    // name. Bug fix: pre-v5.4.23 the pill rendered at labelY+16 with
    // height ~16pt (extending to labelY+32) and the project name
    // baseline at labelY+60 with 52pt bold font's cap-height of ~47pt
    // → text TOP at labelY+13. The pill OVERLAPPED the upper part of
    // the project name on Caldy export pages (visible as green pill
    // behind the C of "Caldy"). Now: pill statusY = labelY+8 (right
    // below eyebrow) + project name pushed DOWN to leave clear space.
    const statusUC = String(meta.status || 'DRAFT').toUpperCase();
    const showStatusPill = statusUC && statusUC !== 'DRAFT' && statusUC !== 'INITIAL DRAFT';
    let statusPillH = 0;
    if (showStatusPill) {
      const statusY = labelY + (isWide ? 8 : 6);
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(isWide ? 10 : 9);
      const pillTextW = pdf.getTextWidth(statusUC) + 18;
      const pillX = (pageW - pillTextW) / 2;
      _statusPill(pdf, statusUC, pillX, statusY, {
        fontSize: isWide ? 10 : 9, padX: 9, padY: 3
      });
      statusPillH = (isWide ? 16 : 14) + 14;  // pill height + buffer
    }

    // Project name HUGE, slate, centred. v5.3.6 — bumped 44pt → 52pt on
    // A3 (30pt → 36pt on A4) for more dramatic hero typography.
    // v5.4.20 — Auto-fit: bisect down from headline size if the name
    // overflows innerW. v5.4.23 — push DOWN by statusPillH when status
    // pill is rendered above (eliminates overlap with project name).
    const projY = labelY + (isWide ? 60 : 44) + statusPillH;
    const headlineMax = isWide ? 52 : 36;
    const headlineFloor = isWide ? 22 : 16;
    const rawName = meta.name || 'Untitled Take-Off';
    pdf.setFont(_pdfFontFamily(), 'bold');
    let projFontSize = headlineMax;
    pdf.setFontSize(projFontSize);
    while (projFontSize > headlineFloor && pdf.getTextWidth(rawName) > innerW) {
      projFontSize -= 2;
      pdf.setFontSize(projFontSize);
    }
    _setText(pdf, COLOURS.text);
    pdf.text(_truncate(pdf, rawName, innerW), pageW / 2, projY, { align: 'center' });

    // v5.1.9 — Slim accent underline below project name (centred, branded
    // app-purple). Adds visual weight under the hero typography without
    // crowding the divider that sits below client/address. Width ~30pt
    // — short enough to feel like a typographic flourish, not a rule.
    {
      const accentW = isWide ? 36 : 28;
      const accentH = isWide ? 3 : 2.5;
      const accentY = projY + (isWide ? 9 : 6);
      _setFill(pdf, COLOURS.appAccent || '#6b4a8a');
      pdf.rect((pageW - accentW) / 2, accentY, accentW, accentH, 'F');
    }

    // Client + Address (centred, lighter)
    let subY = projY + (isWide ? 32 : 24);
    if (meta.client) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(isWide ? 17 : 14);
      _setText(pdf, COLOURS.text2);
      pdf.text(_truncate(pdf, meta.client, innerW), pageW / 2, subY, { align: 'center' });
      subY += isWide ? 22 : 18;
    }
    if (meta.address) {
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(isWide ? 13 : 11);
      _setText(pdf, COLOURS.muted);
      pdf.text(_truncate(pdf, meta.address, innerW), pageW / 2, subY, { align: 'center' });
      subY += isWide ? 18 : 14;
    }

    // Hairline divider (centred, thin, brief — golden ratio width)
    const divW = innerW * 0.382;
    _setStroke(pdf, COLOURS.borderHard);
    pdf.setLineWidth(0.6);
    const dividerY = subY + (isWide ? 26 : 18);
    pdf.line((pageW - divW) / 2, dividerY, (pageW + divW) / 2, dividerY);

    // ---- v5.3.6 — INFO STRIP (luxury-brochure refactor) ----
    // Pre-v5.3.6: a boxed 4-cell rounded-rect grid with tint fill + border.
    // Reads as a data table.
    // Post-v5.3.6: hairline-separated horizontal strip with NO outer box,
    // NO fill — just thin slate hairlines top + bottom, with vertical
    // 0.4pt rules between the 4 cells. Captions sit in tiny letter-spaced
    // small caps; values land below in bold. Reads as luxury-brochure
    // editorial (think Aston Martin / Bentley / luxury hotel folio).
    const gridTop = dividerY + (isWide ? 44 : 32);
    const gridH = isWide ? 60 : 50;
    const gridW = innerW;
    // v5.4.21 — Cover info-grid layout. When the project has saved
    // revisions, the 4th cell swaps from "DRAWN BY" (placeholder
    // 'Sonor' — never actually populated) to "REVISION" so the cover
    // surfaces the live revision code (A1...A{N}) front-and-centre,
    // matching every other Sonor lifecycle indicator on the page.
    // When there are no revisions yet, falls back to "DRAWN BY" so
    // the cell never reads empty on a fresh project.
    const hasRevisions = Array.isArray(meta.revisionHistory) && meta.revisionHistory.length;
    // v5.4.73 — Numeric revision fallback: derive zero-padded code from
    // length-1 if meta.revision wasn't set (matches the numeric scheme
    // used by the revisionHistory mapper above — "00" / "01" / …).
    const fallbackCode = hasRevisions
      ? String(meta.revisionHistory.length - 1).padStart(2, '0')
      : '00';
    const fourthCell = hasRevisions
      ? { caption: 'REVISION', value: meta.revision || fallbackCode }
      : { caption: 'DRAWN BY', value: meta.drawnBy || 'Sonor' };
    const gridCells = [
      { caption: 'REFERENCE',  value: meta.ref || '—' },
      { caption: 'STATUS',     value: meta.status || 'DRAFT', pill: true },
      { caption: 'ISSUE DATE', value: meta.dateUk || meta.date || '—' },
      fourthCell
    ];
    const cellW = gridW / gridCells.length;
    // Hairline frame — 0.4pt slate top + bottom, NO side borders, NO fill
    _setStroke(pdf, COLOURS.borderHard);
    pdf.setLineWidth(0.6);
    pdf.line(M, gridTop, M + gridW, gridTop);
    pdf.line(M, gridTop + gridH, M + gridW, gridTop + gridH);
    gridCells.forEach((c, i) => {
      const cx = M + i * cellW;
      // Hairline rule between cells (not at edges)
      if (i > 0) {
        _setStroke(pdf, COLOURS.border);
        pdf.setLineWidth(0.4);
        pdf.line(cx, gridTop + 10, cx, gridTop + gridH - 10);
      }
      const captionY = gridTop + (isWide ? 20 : 18);
      const valueY = gridTop + (isWide ? 44 : 38);
      // Caption — tiny letter-spaced editorial small-caps
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(isWide ? 7.5 : 7);
      _setText(pdf, COLOURS.muted);
      pdf.text(c.caption, cx + cellW / 2, captionY, { align: 'center', charSpace: 2.5 });
      if (c.pill) {
        const txt = String(c.value).toUpperCase();
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(isWide ? 10 : 9);
        const pillW = pdf.getTextWidth(txt) + 16;
        const pillH = isWide ? 16 : 14;
        const pillX = cx + (cellW - pillW) / 2;
        // v5.4.18 — Cover status pill now mirrors the v5.4.4 extended
        // colour map (canonical Sonor lifecycle terms). Pre-v5.4.18 only
        // knew 7 states; new status terms (INITIAL DRAFT, FOR REVIEW,
        // FOR INSTALL, FINAL CONSTRUCTION, REVISED DRAFT etc) fell
        // through to slate. Now the cover speaks the same lifecycle
        // language as the title-block pill.
        let pillFill = COLOURS.text;
        // Pre-issue (slate / charcoal)
        if (txt === 'INITIAL DRAFT' || txt === 'DRAFT')           pillFill = '#f5d05c';  // svc04 yellow — in-progress
        else if (txt === 'REVISED DRAFT' || txt === 'PRELIMINARY' ||
                 txt === 'FINAL DRAFT FOR SITE REVIEW') pillFill = '#e37c59';  // svc05 terracotta
        // Review (yellow)
        else if (txt === 'FOR REVIEW')                            pillFill = '#f5d05c';  // svc04 yellow
        // Issued (green)
        else if (txt === 'ACTIVE' || txt === 'FINAL')             pillFill = '#78ba57';  // svc03 green
        else if (txt === 'FOR INSTALL' || txt === 'FOR INSTALLATION' ||
                 txt === 'ISSUED FOR INSTALL' ||
                 txt === 'FINAL ISSUE FOR SITE INSTALLATION' ||
                 txt === 'FINAL CONSTRUCTION') pillFill = '#5a8b40';  // dark green — issued
        // Post-install
        else if (txt === 'AS-BUILT')                              pillFill = '#4bb9d3';  // svc02 aqua
        else if (txt === 'ON HOLD')                               pillFill = '#ec6061';  // svc06 red
        else if (txt === 'COMPLETED' || txt === 'CLOSED' || txt === 'ARCHIVED') pillFill = COLOURS.text2;
        else if (txt === 'CANCELLED')                             pillFill = '#9F978B';
        else if (txt === 'TENDER' || txt === 'QUOTE')             pillFill = '#4bb9d3';
        _setFill(pdf, pillFill);
        pdf.roundedRect(pillX, valueY - pillH + 2, pillW, pillH, 3, 3, 'F');
        // White text on dark pills, dark text on light pills (yellow/aqua)
        const lightPill = (pillFill === '#f5d05c' || pillFill === '#4bb9d3' || pillFill === '#78ba57');
        _setText(pdf, lightPill ? COLOURS.text : '#FFFFFF');
        pdf.text(txt, cx + cellW / 2, valueY - 2, { align: 'center' });
      } else {
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(isWide ? 14 : 12);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, String(c.value), cellW - 16), cx + cellW / 2, valueY, { align: 'center' });
      }
    });

    // ---- v5.1.9 — 10-SERVICE POSITIONAL DOT STRIP ----
    // The canonical S-4.14 brand chrome — 10 service-colour dots in
    // positional NN order (01 Cinema purple → 10 Infra charcoal). Same
    // strip as the cover footer + every page footer + the website +
    // every Sonor app's nav. Cover gets it ABOVE the FLOORS / PROJECT
    // TOTALS panels so the page reads as a brand-anchored composition
    // top-to-bottom (slate band → wordmark + CEDIA → hero + accent →
    // info grid → SERVICE STRIP → lower panels → brand strip footer).
    {
      const stripPadV = isWide ? 18 : 14;
      const stripY = gridTop + gridH + stripPadV;
      const dotR = isWide ? 4 : 3.2;
      const dotGap = isWide ? 14 : 11;
      const services = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
        ? SERVICES.slice(0, 10)
        : null;
      if (services && services.length) {
        const stripW = services.length * (dotR * 2) + (services.length - 1) * dotGap;
        const stripX = (pageW - stripW) / 2;
        services.forEach((s, i) => {
          const cxd = stripX + i * (dotR * 2 + dotGap) + dotR;
          _setFill(pdf, (s && s.colour) || '#999');
          pdf.circle(cxd, stripY + dotR, dotR, 'F');
        });
      }
    }

    // ---- v5.4.22/v5.4.23 — REVISION TIMELINE strip (cumulative A1→A{N}) ----
    // Sonor canonical lifecycle visual lifted from Oak Bank Media
    // Lighting RevA10 + Caldy reference set: a horizontal connected
    // dot timeline showing every saved revision. v5.4.23 fix: pushed
    // BELOW the 10-service-colour strip (was overlapping it on the
    // Caldy export — service dots painted across the timeline connector
    // line). Now the cover reads top-to-bottom: service colour strip
    // → REVISIONS timeline → FLOORS / TOTALS panels.
    if (Array.isArray(meta.revisionHistory) && meta.revisionHistory.length >= 2) {
      const tlPadV = isWide ? 56 : 42;   // was 30/22 — clears service strip + 10pt buffer
      const tlY = gridTop + gridH + tlPadV;
      const tlH = 30;
      const tlGap = 16;
      const tlInner = innerW - 80;   // leave 40pt margin each side for label "REVISIONS"
      const items = meta.revisionHistory;
      const cap = Math.min(items.length, 8);
      const showItems = items.length > cap
        ? [items[0], { code: '…', label: '(' + (items.length - cap) + ' more)' }, ...items.slice(-(cap - 2))]
        : items;
      const dotR = 4.5;
      const stepX = tlInner / Math.max(1, showItems.length - 1);
      const tlStartX = M + (innerW - tlInner) / 2;
      const tlMidY = tlY + tlH / 2;
      // Caption — left-anchored "REVISIONS"
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(7);
      _setText(pdf, COLOURS.muted);
      pdf.text('REVISIONS', M, tlMidY + 2, { charSpace: 2 });
      // Connector line
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.6);
      pdf.line(tlStartX, tlMidY, tlStartX + tlInner, tlMidY);
      // Dots
      const latestCode = (meta.revision || items[items.length - 1].code);
      showItems.forEach((r, i) => {
        const cx = tlStartX + i * stepX;
        const isLatest = (r.code === latestCode);
        const isEll = (r.code === '…');
        if (isEll) {
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(8);
          _setText(pdf, COLOURS.muted);
          pdf.text('…', cx, tlMidY + 2.5, { align: 'center' });
        } else {
          // Outer ring (white) + filled circle
          _setFill(pdf, '#FFFFFF');
          pdf.circle(cx, tlMidY, dotR + 1.2, 'F');
          // Latest = lifecycle-status fill, earlier = muted slate
          let dotFill = isLatest ? '#5a8b40' : COLOURS.muted;
          // If latest is AS-BUILT use aqua instead of green; keep visual
          // signalling consistent with the title-block status pill.
          if (isLatest && /AS[- ]BUILT/i.test(meta.status || '')) dotFill = '#4bb9d3';
          else if (isLatest && /FINAL/i.test(meta.status || '') && !/INSTALL/i.test(meta.status || '')) dotFill = '#78ba57';
          else if (isLatest && /REVIEW/i.test(meta.status || '')) dotFill = '#E0922F';
          else if (isLatest && /DRAFT/i.test(meta.status || '')) dotFill = COLOURS.draftSlate;
          _setFill(pdf, dotFill);
          pdf.circle(cx, tlMidY, dotR, 'F');
          // Code below dot
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(6.5);
          _setText(pdf, isLatest ? COLOURS.text : COLOURS.text2);
          pdf.text(r.code || '—', cx, tlMidY + dotR + 9, { align: 'center' });
          // Date above dot (compact dd/mm only)
          if (r.date) {
            pdf.setFont(_pdfFontFamily(), 'normal');
            pdf.setFontSize(5.5);
            _setText(pdf, COLOURS.muted);
            pdf.text(r.date.length > 5 ? r.date.slice(0, 5) : r.date, cx, tlMidY - dotR - 2.5, { align: 'center' });
          }
          // AS-BUILT badge on the dot itself if flagged
          if (r.as_built && !isLatest) {
            // Tiny "AB" tag below the date
            pdf.setFont(_pdfFontFamily(), 'bold');
            pdf.setFontSize(5);
            _setFill(pdf, '#4bb9d3');
            pdf.circle(cx + dotR - 1, tlMidY - dotR + 1, 2, 'F');
          }
        }
      });
    }

    // ---- LOWER SECTION — FLOORS + PROJECT TOTALS panels ----
    // v5.4.22/v5.4.23 — push lowerTop down further when the revision
    // timeline renders. v5.4.22 reserved 36pt; v5.4.23 reserves 64pt
    // because the timeline now sits BELOW the service strip (was
    // overlapping it pre-v5.4.23) so total reserved vertical = service
    // strip (~16pt) + timeline (~30pt) + buffer (18pt) = 64pt.
    const _hasRevTimeline = Array.isArray(meta.revisionHistory) && meta.revisionHistory.length >= 2;
    const lowerTop = gridTop + gridH + (isWide ? 56 : 44) + (_hasRevTimeline ? (isWide ? 64 : 50) : 0);
    const gap = 16;
    const floorsW = (gridW - gap) * 0.55;
    const totalsW = (gridW - gap) * 0.45;
    const floorsX = M;
    const totalsX = M + floorsW + gap;

    // Refined FLOORS panel
    if (Array.isArray(opts.floorRows) && opts.floorRows.length) {
      // v5.4.42 — bake-in canonical floor sequence (Bryn 2026-05-08).
      // Sort opts.floorRows in-place into GF → 1F → 2F → BA → EXT order
      // before the rest of the panel renders. Stable sort preserves any
      // host-side ordering for floors that share a rank (shouldn't happen
      // in practice but defensive). Falls back to original order when
      // helpers module unavailable.
      const _sortFloorsCover = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
        ? window.sonorSortFloors
        : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
            && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
           ? window.SonorPdfHtmlHelpers.sortFloors
           : null);
      if (_sortFloorsCover) {
        // floorRows entries carry .code or .name — sortFloors handles either.
        opts.floorRows = _sortFloorsCover(opts.floorRows);
      }
      const headerH = 22;
      const rowH = isWide ? 18 : 16;
      const bodyH = opts.floorRows.length * rowH;
      // Outer rounded container
      _setFill(pdf, COLOURS.body);
      pdf.roundedRect(floorsX, lowerTop, floorsW, headerH + bodyH, 4, 4, 'F');
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.4);
      pdf.roundedRect(floorsX, lowerTop, floorsW, headerH + bodyH, 4, 4);
      // Slate header
      _setFill(pdf, COLOURS.bar);
      // Header drawn as filled rect with rounded TOP corners only —
      // jsPDF doesn't expose top-only round, so we paint a square rect
      // and let the outer rounded border clip visually
      pdf.rect(floorsX + 0.5, lowerTop + 0.5, floorsW - 1, headerH - 1, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(9);
      _setText(pdf, COLOURS.surfaceTxt);
      pdf.text('FLOORS', floorsX + 12, lowerTop + 14, { charSpace: 1 });
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, '#cdc7bd');
      pdf.text(opts.floorRows.length + ' floor' + (opts.floorRows.length === 1 ? '' : 's'), floorsX + floorsW - 12, lowerTop + 14, { align: 'right' });
      // Rows
      let fy = lowerTop + headerH + (isWide ? 12 : 11);
      opts.floorRows.forEach((fr, i) => {
        if (i % 2 === 1) {
          _setFill(pdf, COLOURS.altRow);
          pdf.rect(floorsX + 1, lowerTop + headerH + i * rowH, floorsW - 2, rowH, 'F');
        }
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(9.5);
        _setText(pdf, COLOURS.text);
        pdf.text(_truncate(pdf, String(fr.name || '—'), floorsW * 0.42), floorsX + 12, fy);
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(8);
        _setText(pdf, COLOURS.muted);
        const parts = [];
        if (fr.rooms != null)   parts.push(fr.rooms + ' rooms');
        if (fr.symbols != null) parts.push(fr.symbols + ' sym');
        // v5.78.0 — area/perim dropped from pdf outputs
        if (fr.cable != null && Number(fr.cable) > 0)         parts.push(fr.cable + ' m cable');
        if (fr.led != null && Number(fr.led) > 0)             parts.push(fr.led + ' m LED');
        pdf.text(_truncate(pdf, parts.join('  ·  '), floorsW * 0.55), floorsX + floorsW - 12, fy, { align: 'right' });
        fy += rowH;
      });
    }

    // Refined PROJECT TOTALS panel — same shape language
    if (Array.isArray(opts.summary) && opts.summary.length) {
      const headerH = 22;
      const rowH = isWide ? 18 : 16;
      const bodyH = opts.summary.length * rowH;
      _setFill(pdf, COLOURS.body);
      pdf.roundedRect(totalsX, lowerTop, totalsW, headerH + bodyH, 4, 4, 'F');
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.4);
      pdf.roundedRect(totalsX, lowerTop, totalsW, headerH + bodyH, 4, 4);
      // v1.56.0 — Header: match FLOORS panel slate (was ASPECT_ACCENT.plan
      // which read as a washed-out grey against the dark FLOORS header,
      // breaking the visual pairing). Differentiation comes from a thin
      // accent underline stripe + the content shape (metric pairs vs floor
      // rows) — not from header colour.
      _setFill(pdf, COLOURS.bar);
      pdf.rect(totalsX + 0.5, lowerTop + 0.5, totalsW - 1, headerH - 1, 'F');
      // Accent underline stripe — 1.5pt high, full panel width, sits at
      // the bottom of the header. Clear visual cue without taking over.
      _setFill(pdf, ASPECT_ACCENT.plan);
      pdf.rect(totalsX + 0.5, lowerTop + headerH - 2, totalsW - 1, 1.5, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(9);
      _setText(pdf, COLOURS.surfaceTxt);
      pdf.text((opts.summaryTitle || 'PROJECT TOTALS').toUpperCase(), totalsX + 12, lowerTop + 14, { charSpace: 1 });
      // Rows
      let ty = lowerTop + headerH + (isWide ? 12 : 11);
      opts.summary.forEach((r, i) => {
        if (i % 2 === 1) {
          _setFill(pdf, COLOURS.altRow);
          pdf.rect(totalsX + 1, lowerTop + headerH + i * rowH, totalsW - 2, rowH, 'F');
        }
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(9);
        _setText(pdf, COLOURS.text2);
        pdf.text(_truncate(pdf, String(r.label || ''), totalsW * 0.55), totalsX + 12, ty);
        pdf.setFont(_pdfFontFamily(), 'bold');
        _setText(pdf, r.accent || COLOURS.text);
        pdf.text(_truncate(pdf, String(r.value || ''), totalsW * 0.40), totalsX + totalsW - 12, ty, { align: 'right' });
        ty += rowH;
      });
    }

    // ---- v1.78.0 — SERVICE TALLY STRIP ----
    // Project-wide service distribution at a glance. Horizontal row of
    // colour chips "01·6  02·12  03·5 …" sits between the FLOORS/TOTALS
    // panels and the brand strip footer. Inactive services (count 0)
    // dim to ~25% saturation so the active services pop.
    // Source: opts.svcCounts when caller supplies it; fallback is a
    // canvas walk same as paintFooter.
    if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
      let svcCounts = (opts.svcCounts && typeof opts.svcCounts === 'object') ? opts.svcCounts : null;
      if (!svcCounts && typeof canvas !== 'undefined') {
        try {
          svcCounts = {};
          canvas.getObjects().forEach(o => {
            if (o && o.sonorSymbol && o.sonorSymbol.service_nn) {
              const nn = String(o.sonorSymbol.service_nn).padStart(2, '0');
              svcCounts[nn] = (svcCounts[nn] || 0) + 1;
            }
            if (o && o.sonorMeasure) {
              const k = o.sonorMeasure.kind;
              if (k === 'length') svcCounts['10'] = (svcCounts['10'] || 0) + 1;  // cables → infra
              else if (k === 'led') svcCounts['04'] = (svcCounts['04'] || 0) + 1;  // LEDs → lighting
            }
          });
        } catch (e) { svcCounts = null; }
      }
      if (svcCounts) {
        const tallyTop = lowerTop + (isWide ? 130 : 110);  // below the panels
        // Title — small caption above the chips
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(isWide ? 8 : 7);
        _setText(pdf, COLOURS.muted);
        pdf.text('PROJECT BY SERVICE', M, tallyTop, { charSpace: 1 });
        // Chip row
        const chipY = tallyTop + (isWide ? 14 : 12);
        const chipH = isWide ? 22 : 18;
        const chipPad = 8;
        let cx = M;
        const chipFontSize = isWide ? 9 : 8;
        SERVICES.forEach((s) => {   // v5.159.0 — full registry; nn from the record (index-derived nn broke past 10)
          const nn = String(s.nn || '');
          const count = svcCounts[nn] || 0;
          const baseColour = s.colour || '#999';
          const fillCol = count > 0 ? baseColour : _mixWithWhite(baseColour, 0.78);
          const txtCol = count > 0 ? '#FFFFFF' : '#5a4e3e';
          // Measure chip width
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(chipFontSize);
          const txt = nn + '·' + count;
          const txtW = pdf.getTextWidth(txt);
          const chipW = txtW + chipPad * 2;
          // Wrap to next row if we'd overflow innerW
          if (cx + chipW > M + innerW) {
            // No-op for cover — assume it fits at A3/A4. Skip overflow.
            return;
          }
          _setFill(pdf, fillCol);
          pdf.roundedRect(cx, chipY, chipW, chipH, 3, 3, 'F');
          _setText(pdf, txtCol);
          pdf.text(txt, cx + chipW / 2, chipY + chipH / 2 + 3, { align: 'center' });
          cx += chipW + 6;
        });
      }
    }

    // ---- BRAND STRIP FOOTER (replaces the standard title-block) ----
    // Slate strip at the very bottom. Sonor wordmark (small) + 10
    // service-colour dots + tagline + contact line — refined, not
    // crowded. No disclaimer / no scale / no Caldy 5-col grid (those
    // belong on plan + aspect pages, NOT on the cover).
    const brandH = 78;
    const brandY = pageH - brandH;
    _setFill(pdf, COLOURS.bar);
    pdf.rect(0, brandY, pageW, brandH, 'F');
    // Accent stripe top of brand strip
    _setFill(pdf, ASPECT_ACCENT.plan);
    pdf.rect(0, brandY, pageW, 2, 'F');

    // Brand strip — three-section composition: wordmark left, dot strip
    // centre, contact line right. Compact, all on same horizontal line.
    const brandMidY = brandY + (isWide ? 38 : 34);

    // Wordmark (smaller version on dark slate)
    if (wmDataUrl) {
      const wmW2 = isWide ? 110 : 86;
      const wmH2 = wmW2 * (wmDim.h / wmDim.w);
      // For dark backgrounds we'd ideally use the white wordmark
      // (Branding-CORE/HIRES/wordmark_hires_white.png) — for now the
      // dark wordmark on slate is acceptable but less optimal. Future
      // enhancement: ship a white-wordmark base64 alongside the dark.
      // To keep contrast acceptable on slate, paint a light pill behind.
      _setFill(pdf, COLOURS.surfaceTxt);
      pdf.roundedRect(M - 6, brandMidY - wmH2 / 2 - 4, wmW2 + 12, wmH2 + 8, 4, 4, 'F');
      try {
        pdf.addImage(wmDataUrl, 'PNG', M, brandMidY - wmH2 / 2, wmW2, wmH2, 'wordmark-sonor');
      } catch (e) { /* graceful */ }
    } else {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(isWide ? 18 : 14);
      _setText(pdf, COLOURS.surfaceTxt);
      pdf.text('SONOR', M, brandMidY + 4);
    }

    // 10 service-colour dots — centre
    const dots = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) ? SERVICES.slice(0, 10) : [];
    const dotPitch = isWide ? 18 : 14;
    const dotR = isWide ? 4.5 : 3.6;
    const dotsTotalW = dots.length * dotPitch;
    let dx = (pageW - dotsTotalW) / 2;
    dots.forEach(s => {
      _setFill(pdf, s.colour || '#999');
      pdf.circle(dx + dotPitch / 2, brandMidY, dotR, 'F');
      dx += dotPitch;
    });

    // Contact + tagline — right
    // v5.3.7 — Tagline shortened "Smart homes, beautifully done" → "Smart homes".
    pdf.setFont(_pdfFontFamily(), 'italic');
    pdf.setFontSize(isWide ? 10 : 8);
    _setText(pdf, '#cdc7bd');
    pdf.text('Smart homes', pageW - M, brandMidY - 6, { align: 'right' });
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(isWide ? 9 : 7);
    _setText(pdf, '#a8b0bc');
    const contactLine = COMPANY.web + '  ·  ' + COMPANY.email + '  ·  ' + COMPANY.phone;
    pdf.text(contactLine, pageW - M, brandMidY + 8, { align: 'right' });

    // Bottom row — page reference + version (small, muted)
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    const pageStr = opts.pageTotal ? `Page 1 of ${opts.pageTotal}` : 'Page 1';
    const coverPageX = M;
    const coverPageY = brandY + brandH - 10;
    pdf.text(pageStr, coverPageX, coverPageY);
    pdf.text('Sonor Takeoffs v' + (meta.appVersion || ''), pageW - M, coverPageY, { align: 'right' });

    // v2.0.1 — register the cover-page-1 stamp so _finalisePagination can
    // rewrite "Page 1 of <estimate>" → "Page 1 of <actual>".
    try {
      pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
      pdf.__sonorPageStamps__.push({
        page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                ? pdf.internal.getCurrentPageInfo().pageNumber
                : 1),
        x: coverPageX, y: coverPageY,
        clearW: 100, clearH: 12, clearOffsetY: -9,
        format: 'cover-page-of',
        align: 'left',
        fontSize: 7, bold: false,
        textColor: COLOURS.muted,
        source: 'cover'
      });
    } catch (_) { /* non-fatal */ }
  }

  // ========================================================================
  // v2.0.0 PAINTERS — page-type differentiated styling (locked Bryn 2026-04-28)
  // ========================================================================

  // ---- _drawingCode(meta, pageCode) ----
  // Auto-generates `{ProjectRef}-{Rev}-{PageCode}` e.g. "1343-A0-04" or
  // "1343-A0-CCT". When ref/rev are missing we substitute neutral defaults
  // so the stamp never shows as "—-—-CVR". PageCode taxonomy locked:
  //   CVR (cover) / CBL (cabling info) / BRD (bend radii)
  //   COM-NN (combined plan, per-floor) / CCT (CCTV) / ELE (electrical)
  //   SLI-NN (per-service slice) / ROO BLK CAB LED LIT SHA DIS PJS ZON
  function _drawingCode(meta, pageCode) {
    const m = meta || {};
    let ref = String(m.ref || '').replace(/[^A-Za-z0-9]+/g, '');
    if (!ref) ref = 'SONOR';
    const rev = String(m.revision || '00').toUpperCase();
    const pc = String(pageCode || '').toUpperCase() || 'PAG';
    return ref + '-' + rev + '-' + pc;
  }

  // ---- _statusPill(pdf, state, x, y, opts) ----
  // Pill-shaped chip painter with state-coloured fill + white inverse caps.
  // States (formal trade language):
  //   PRELIMINARY   amber   #e37c59
  //   ACTIVE        green   #78ba57   (default)
  //   ISSUED FOR INSTALL    green-darker #5a8b40
  //   AS-BUILT      blue    #4bb9d3   (paired with v1.65 as-built flag)
  //   ARCHIVED      grey    #8b7d6b
  //   DRAFT         slate   #636c7a
  function _statusPill(pdf, state, x, y, opts) {
    opts = opts || {};
    const label = String(state || 'ACTIVE').toUpperCase();
    // v5.3.4 — Pull every value from canonical COLOURS / brand-core
    // service hex codes. Drift-free per SONOR-PDF-STYLE-GUIDE.md.
    // v5.4.4 — Extended palette to cover every Sonor reference status
    // (Caldy Takeoff 000 / Oak Bank Media Lighting RevA5–A10 / LL_Exterior
    // RevA3–A14): INITIAL DRAFT, REVISED DRAFT, FOR REVIEW, FOR INSTALL,
    // FINAL CONSTRUCTION, FINAL, AS-BUILT etc. Each maps to a brand-coherent
    // hex so the pill colour is itself a signal (slate=draft, amber=review,
    // green=approved, aqua=as-built, charcoal=archived).
    const colourMap = {
      // Pre-issue (slate / charcoal)
      'INITIAL DRAFT':      COLOURS.draftSlate,
      'DRAFT':              COLOURS.draftSlate,
      'REVISED DRAFT':      '#e37c59',                // svc05 terracotta — actively iterating
      // Review (amber/yellow)
      'FOR REVIEW':         '#f5d05c',                // svc04 yellow
      'FINAL DRAFT FOR SITE REVIEW': '#e37c59',
      // Pre-install (terracotta = warming up)
      'PRELIMINARY':        '#e37c59',
      // Issued (green family — ready for site)
      'ACTIVE':             COLOURS.ok,               // svc03 green
      'FOR INSTALL':        COLOURS.installGreen,
      'FOR INSTALLATION':   COLOURS.installGreen,
      'ISSUED FOR INSTALL': COLOURS.installGreen,
      'FINAL ISSUE FOR SITE INSTALLATION': COLOURS.installGreen,
      'FINAL CONSTRUCTION': COLOURS.installGreen,
      'FINAL':              COLOURS.ok,
      // Post-install (aqua / archived)
      'AS-BUILT':           COLOURS.asBuiltAqua,
      'ARCHIVED':           COLOURS.archived
    };
    const fill = colourMap[label] || colourMap.ACTIVE;
    const fontSize = opts.fontSize || 7.5;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(fontSize);
    const padX = opts.padX || 8;
    const padY = opts.padY || 3;
    const txtW = pdf.getTextWidth(label);
    const w = txtW + padX * 2;
    const h = fontSize + padY * 2;
    _setFill(pdf, fill);
    pdf.roundedRect(x, y, w, h, 2, 2, 'F');
    _setText(pdf, '#FFFFFF');
    pdf.text(label, x + w / 2, y + h - padY - 1, { align: 'center', charSpace: 0.4 });
    return { w, h };
  }

  // ---- paintHeaderDrawingCode(pdf, meta, pageCode) ----
  // Stamps the drawing reference code in the top-right corner of the slate
  // header, sitting under the existing title. Light-weight caption (8pt)
  // muted on slate so the title still owns the strip visually.
  function paintHeaderDrawingCode(pdf, meta, pageCode) {
    if (!pageCode) return;
    const code = _drawingCode(meta, pageCode);
    const pageW = pdf.internal.pageSize.getWidth();
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, '#A8B0BC');  // text-faint on slate (matches subtitle tone)
    pdf.text(code, pageW - 24, 32, { align: 'right' });
  }

  // ---- _paintTitleBlock(pdf, opts) ----
  // FULL-WIDTH architectural title BAND (v2.0.1 — Bryn directive 2026-04-28
  // "keep our orignal full width title block across the bottom"). Stretches
  // the entire page width as a horizontal band ~70pt tall, anchored bottom.
  // Replaces the v2.0.0 corner-block layout. Five horizontal cells, separated
  // by hairline borders, each with its own internal vertical layout.
  //
  // Layout (left-to-right, bottom-anchored, page-width fractions sum to 1):
  //   Cell 1 (~22%) — Sonor wordmark + tagline + integrator address
  //   Cell 2 (~22%) — PROJECT name + site address
  //   Cell 3 (~22%) — REV / DESCRIPTION / BY / DATE row + Status pill +
  //                   Drawn / Checked / Based on
  //   Cell 4 (~17%) — REVISION NOTES — Added / Moved / Removed pills
  //   Cell 5 (~17%) — DRG code · PAGE X/Y · SCALE
  //
  // v2.0.1 fix: also pushes pageNum stamp coords into the per-pdf registry
  // (`pdf.__sonorPageStamps__`) so `_finalisePagination` can rewrite EVERY
  // page-number stamp (not just the legacy slate-header footer line).
  function _paintTitleBlock(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const meta = opts.meta || {};
    const pageCode = opts.pageCode || 'PAG';
    const status = (meta.status || 'ACTIVE').toUpperCase();

    // Band geometry — full page width, bottom-anchored
    const BH = 70;                      // band height
    const BX = 0;                       // bleeds to left edge
    const BY = pageH - BH;              // top edge of band
    const BW = pageW;

    // Outer fill + top divider
    _setFill(pdf, COLOURS.body);
    pdf.rect(BX, BY, BW, BH, 'F');
    _setStroke(pdf, COLOURS.borderHard);
    pdf.setLineWidth(0.6);
    pdf.line(0, BY, pageW, BY);

    // Cell widths as page-width fractions (sum = 1.00) so the band scales
    // cleanly across A3 landscape (1190pt) and A4 portrait (595pt).
    const f1 = 0.22, f2 = 0.22, f3 = 0.22, f4 = 0.17;
    const c1W = pageW * f1;
    const c2W = pageW * f2;
    const c3W = pageW * f3;
    const c4W = pageW * f4;
    const c5W = pageW - c1W - c2W - c3W - c4W;
    const c1X = 0;
    const c2X = c1X + c1W;
    const c3X = c2X + c2W;
    const c4X = c3X + c3W;
    const c5X = c4X + c4W;

    // Vertical dividers between cells
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.3);
    [c2X, c3X, c4X, c5X].forEach(x => pdf.line(x, BY, x, pageH));

    // ---- CELL 1 — Sonor wordmark + tagline + integrator address ----
    // v5.4.47 — prefer WHITE variant (Bryn directive 2026-05-08): every
    // native wordmark site sits on a dark slate surface (footer / cover
    // hero / brand strip), so white reads against the chrome. Fall back
    // to dark variant if white isn't loaded.
    const wmDataUrl = window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__;
    const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
    const padX1 = 10, topPad = 8;
    if (wmDataUrl) {
      const targetW = Math.min(110, c1W - padX1 * 2);
      const targetH = targetW * (wmDim.h / wmDim.w);
      try { pdf.addImage(wmDataUrl, 'PNG', c1X + padX1, BY + topPad, targetW, targetH, 'wordmark-sonor'); }
      catch (e) {
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(13);
        _setText(pdf, COLOURS.text);
        pdf.text('SONOR', c1X + padX1, BY + topPad + 12);
      }
    } else {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(13);
      _setText(pdf, COLOURS.text);
      pdf.text('SONOR', c1X + padX1, BY + topPad + 12);
    }
    // Tagline (italic, muted)
    // v5.3.7 — Tagline shortened "Smart homes, beautifully done" → "Smart homes".
    pdf.setFont(_pdfFontFamily(), 'italic');
    pdf.setFontSize(6.5);
    _setText(pdf, COLOURS.muted);
    pdf.text('Smart homes', c1X + padX1, BY + 42);
    // Integrator contact line
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(6.5);
    _setText(pdf, COLOURS.muted);
    const cLine = (COMPANY.location || 'Chester') + '  ·  ' + (COMPANY.web || 'sonor.co.uk');
    pdf.text(_truncate(pdf, cLine, c1W - padX1 * 2), c1X + padX1, BY + 54);
    // v5.4.6 — Dropbox folder link replaces the email+phone double-up when set
    // (Bryn directive: surface project Dropbox so installer can jump from
    // print to live shared folder for datasheets / RAMS / photos / revisions).
    // Falls back to email · phone when no cloud folder is configured.
    if (meta.dropboxFolder) {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(6.2);
      _setText(pdf, '#1d6cdb');  // Dropbox blue (recognisable brand cue)
      const dbText = '📁 Project folder · Dropbox';
      pdf.text(_truncate(pdf, dbText, c1W - padX1 * 2), c1X + padX1, BY + 64);
      // Make the cell-1 area below the wordmark a clickable link to the
      // shared folder. jsPDF link() takes a rectangle so we cover the line.
      try {
        const lkY = BY + 56;
        pdf.link(c1X + padX1, lkY, c1W - padX1 * 2, 10, { url: meta.dropboxFolder });
      } catch (_) { /* offline / no link support */ }
    } else {
      pdf.text(_truncate(pdf, (COMPANY.email || '') + '  ·  ' + (COMPANY.phone || ''), c1W - padX1 * 2),
               c1X + padX1, BY + 64);
    }

    // ---- CELL 2 — PROJECT name + site address ----
    const padX2 = 8;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6.5);
    _setText(pdf, COLOURS.muted);
    pdf.text('PROJECT', c2X + padX2, BY + 11, { charSpace: 0.6 });
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    pdf.text(_truncate(pdf, meta.name || 'Untitled', c2W - padX2 * 2), c2X + padX2, BY + 26);
    if (meta.ref) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.muted);
      pdf.text(_truncate(pdf, 'Ref: ' + String(meta.ref), c2W - padX2 * 2), c2X + padX2, BY + 38);
    }
    if (meta.address) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.text2);
      // Wrap address across up to 2 lines
      const addrLines = (typeof pdf.splitTextToSize === 'function')
        ? pdf.splitTextToSize(String(meta.address), c2W - padX2 * 2).slice(0, 2)
        : [_truncate(pdf, String(meta.address), c2W - padX2 * 2)];
      let ay = BY + (meta.ref ? 50 : 40);
      addrLines.forEach(line => { pdf.text(line, c2X + padX2, ay); ay += 9; });
    }

    // ---- CELL 3 — REV/DESCRIPTION/BY/DATE row + Status pill + Drawn/Checked/BasedOn ----
    const padX3 = 8;
    // Top: 4-column REV / DESCRIPTION / BY / DATE
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6);
    _setText(pdf, COLOURS.muted);
    const innerW3 = c3W - padX3 * 2;
    const subCols3 = [
      { lbl: 'REV.',        w: 0.16, val: meta.revision || '00', bold: true },
      { lbl: 'DESCRIPTION', w: 0.50, val: meta.revDescription || (status === 'AS-BUILT' ? 'As-built' : 'Initial issue'), bold: false },
      { lbl: 'BY',          w: 0.14, val: (meta.drawnBy || 'SO').toString().slice(0, 3).toUpperCase(), bold: false },
      { lbl: 'DATE',        w: 0.20, val: (meta.dateUk || meta.date || '—').slice(0, 10), bold: false }
    ];
    let cx3 = c3X + padX3;
    subCols3.forEach(c => {
      const w = innerW3 * c.w;
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(6);
      _setText(pdf, COLOURS.muted);
      pdf.text(c.lbl, cx3, BY + 11, { charSpace: 0.4 });
      pdf.setFont(_pdfFontFamily(), c.bold ? 'bold' : 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text);
      pdf.text(_truncate(pdf, String(c.val), w - 4), cx3, BY + 23);
      cx3 += w;
    });
    // Status pill (left side of mid-cell 3) — v5.4.4: bumped to fontSize 8
    // + padX 9 so it reads as the document's headline status rather than a
    // small footnote. Matches the prominence of "FOR INSTALLATION" / "FINAL
    // CONSTRUCTION" / "INITIAL DRAFT" pills on Sonor reference sets.
    _statusPill(pdf, status, c3X + padX3, BY + 28, { fontSize: 8, padX: 9, padY: 3 });
    // Drawn / Checked / Based on (right of pill)
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(6.5);
    _setText(pdf, COLOURS.muted);
    const dcY = BY + 52;
    pdf.text('Drawn  ' + (meta.drawnBy || 'SO') + '   ·   Chk  —', c3X + padX3, dcY);
    pdf.setFontSize(6);
    pdf.text(_truncate(pdf, 'Based on ' + (meta.basedOn || 'architect plan'), innerW3),
             c3X + padX3, BY + 62);

    // ---- CELL 4 — REVISION HISTORY (Sonor canonical, v5.4.3) ----
    // Cumulative chronological list of every saved revision (A1 → AN)
    // matching Oak Bank Media Lighting Plans RevA5/A10, LL_Exterior, Caldy
    // reference set. Most recent revision lives at the bottom (top of list
    // visually = oldest). Format per row:
    //   A{n}  ·  {date dd/mm/yy}  ·  {LABEL truncated to fit}
    // Drawn at 6pt to maximise list capacity in the 17%-width cell. If
    // there's no cumulative cache yet (modal never opened, or first save
    // pending), falls back to the legacy Added/Moved/Removed pills so the
    // cell never looks empty.
    const padX4 = 8;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6);
    _setText(pdf, COLOURS.muted);
    pdf.text('REVISION HISTORY', c4X + padX4, BY + 11, { charSpace: 0.4 });

    const innerW4 = c4W - padX4 * 2;
    const history = Array.isArray(meta.revisionHistory) ? meta.revisionHistory : [];

    if (history.length) {
      // Show oldest-first (A1 at top, A{N} at bottom); cap at 5 rows so
      // tall histories don't overrun the band. Always include the very
      // latest row even if cap forces an ellipsis between A1 and last.
      const MAX_ROWS = 5;
      let rows = history;
      if (rows.length > MAX_ROWS) {
        rows = [history[0], { code: '…', label: `(${history.length - MAX_ROWS} more)`, date: '' }, ...history.slice(-(MAX_ROWS - 2))];
      }
      const rowH = 8.2;
      const startY = BY + 22;
      rows.forEach((r, i) => {
        const yy = startY + i * rowH;
        const isLatest = (r.code === meta.revision);
        // Code (bold)
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(6.5);
        _setText(pdf, isLatest ? COLOURS.text : COLOURS.text2);
        pdf.text(r.code || '—', c4X + padX4, yy);
        // Date
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(6);
        _setText(pdf, COLOURS.muted);
        const codeW = 14;
        const dateX = c4X + padX4 + codeW;
        pdf.text(r.date || '—', dateX, yy);
        // Label (truncated)
        pdf.setFont(_pdfFontFamily(), isLatest ? 'bold' : 'normal');
        pdf.setFontSize(6);
        _setText(pdf, isLatest ? COLOURS.text : COLOURS.text2);
        const labelX = dateX + 32;
        const labelW = innerW4 - codeW - 32;
        const lbl = (r.label || '').slice(0, 64);
        pdf.text(_truncate(pdf, lbl, labelW), labelX, yy);
        // AS-BUILT pill
        if (r.as_built) {
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(5.2);
          const ab = 'AS-BUILT';
          const abW = pdf.getTextWidth(ab) + 4;
          const abX = c4X + c4W - padX4 - abW;
          _setFill(pdf, '#78ba57');
          pdf.roundedRect(abX, yy - 6, abW, 7.5, 1, 1, 'F');
          _setText(pdf, '#FFFFFF');
          pdf.text(ab, abX + abW / 2, yy - 0.5, { align: 'center' });
        }
      });
    } else {
      // Fallback: legacy Added/Moved/Removed/RFI revision-cloud pills + caption.
      // Triggers when no revisions cache is available (offline, modal not
      // opened, fresh project, anonymous mode).
      const pills = [
        { label: 'Added',   count: meta.revAdded   != null ? meta.revAdded   : 0, hex: '#78ba57' },
        { label: 'Moved',   count: meta.revMoved   != null ? meta.revMoved   : 0, hex: '#f5d05c' },
        { label: 'Removed', count: meta.revRemoved != null ? meta.revRemoved : 0, hex: '#ec6061' },
        { label: 'RFI', glyph: '?', count: meta.revRfi != null ? meta.revRfi : 0, hex: '#8058a1' },
        { label: 'Note', glyph: 'i', count: meta.revNote != null ? meta.revNote : 0, hex: '#302f2e' }
      ];
      let pX = c4X + padX4;
      const pY = BY + 30;
      pills.forEach(p => {
        const txt = (p.glyph || p.label.charAt(0)) + '  ' + p.count;
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(7);
        const w = pdf.getTextWidth(txt) + 10;
        _setStroke(pdf, p.hex);
        pdf.setLineWidth(0.8);
        pdf.roundedRect(pX, pY - 9, w, 12, 2, 2);
        _setText(pdf, p.hex);
        pdf.text(txt, pX + w / 2, pY - 1, { align: 'center' });
        pX += w + 4;
      });
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(6);
      _setText(pdf, COLOURS.muted);
      pdf.text('No revisions saved yet · open Revisions modal', c4X + padX4, BY + 50);
    }

    // ---- CELL 5 — DRG code · PAGE X/Y · SCALE ----
    const padX5 = 8;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6);
    _setText(pdf, COLOURS.muted);
    pdf.text('DRG', c5X + padX5, BY + 11, { charSpace: 0.4 });
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    const drgCode = _drawingCode(meta, pageCode);
    pdf.text(drgCode, c5X + padX5, BY + 24);

    // PAGE row
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6);
    _setText(pdf, COLOURS.muted);
    pdf.text('PAGE', c5X + padX5, BY + 38, { charSpace: 0.4 });
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10);
    _setText(pdf, COLOURS.text);
    const pageNum = opts.pageNum || 1;
    const pageTotal = opts.pageTotal || null;
    const pageStr = pageTotal ? (pageNum + ' / ' + pageTotal) : String(pageNum);
    const pageStrX = c5X + padX5 + 28;
    const pageStrY = BY + 38;
    pdf.text(pageStr, pageStrX, pageStrY);

    // v2.0.1 — register this stamp coord with the per-pdf stamp registry so
    // _finalisePagination can rewrite it after the final page count is known.
    try {
      pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
      pdf.__sonorPageStamps__.push({
        page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                ? pdf.internal.getCurrentPageInfo().pageNumber
                : pdf.internal.pages.length - 1),
        x: pageStrX, y: pageStrY,
        clearW: 70, clearH: 12, clearOffsetY: -8,
        format: 'numslash',           // "N / T"
        fontSize: 10, bold: true,
        source: 'titleblock'
      });
    } catch (_) { /* non-fatal */ }

    // SCALE row
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6);
    _setText(pdf, COLOURS.muted);
    pdf.text('SCALE', c5X + padX5, BY + 54, { charSpace: 0.4 });
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(9);
    _setText(pdf, COLOURS.text);
    pdf.text(meta.scaleLabel ? meta.scaleLabel : (meta.scale || '1:50 @ A3'),
             c5X + padX5 + 28, BY + 54);
  }

  // ---- _paintNotesColumn(pdf, opts) ----
  // NOTES section with ruled lines for handwritten notes when printed.
  // NEVER on schedule pages. v2.6.2 — Bryn directive 2026-04-29: NOTES is
  // now part of the SINGLE right-side info column (LEGEND → FLOOR TOTALS →
  // NOTES stacked) rather than a separate right-edge strip. Caller passes
  // `x` + `w` to position it inside the inset column; pre-v2.6.2 callers
  // who don't pass `x` get the legacy right-edge fallback (back-compat).
  function _paintNotesColumn(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const colW = opts.w || 140;
    // v2.6.2 — explicit x wins (new behaviour); fallback to right-edge for
    // back-compat with any caller not yet migrated.
    const colX = (opts.x != null ? opts.x : pageW - colW - 8);
    const colTop = (opts.top != null ? opts.top : 50);
    const colBottom = (opts.bottom != null ? opts.bottom : pageH - 150);  // leave title block room
    const colH = colBottom - colTop;
    if (colH < 80) return 0;

    // Subtle outer frame
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.3);
    pdf.rect(colX, colTop, colW, colH);

    // Header bar
    _setFill(pdf, COLOURS.panel);
    pdf.rect(colX, colTop, colW, 18, 'F');
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text);
    pdf.text('NOTES', colX + 8, colTop + 12, { charSpace: 0.6 });

    // Ruled lines — 14pt pitch, light grey
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.25);
    const lineY0 = colTop + 28;
    const linePitch = 14;
    for (let y = lineY0; y < colBottom - 4; y += linePitch) {
      pdf.line(colX + 4, y, colX + colW - 4, y);
    }
    return colW + 8;
  }

  // ---- _paintScheduleFooter(pdf, opts) ----
  // SLIM breadcrumb footer for SCHEDULE PAGES only. Single row, ~25mm tall.
  // Format: [wordmark] · Project · Drawing code · Page X/Y · Status
  // No architectural cells, no disclaimer, no scale — schedules are schedules.
  function _paintScheduleFooter(pdf, opts) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const meta = opts.meta || {};
    const FY = pageH - 28;

    // Top divider
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.5);
    pdf.line(12, FY, pageW - 12, FY);

    // Wordmark (compact)
    // v5.4.47 — prefer WHITE variant (Bryn directive 2026-05-08): every
    // native wordmark site sits on a dark slate surface (footer / cover
    // hero / brand strip), so white reads against the chrome. Fall back
    // to dark variant if white isn't loaded.
    const wmDataUrl = window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__;
    const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
    const baselineY = FY + 17;
    let cursorX = 16;
    if (wmDataUrl) {
      const wmW = 48;
      const wmH = wmW * (wmDim.h / wmDim.w);
      try {
        pdf.addImage(wmDataUrl, 'PNG', cursorX, FY + 6, wmW, wmH, 'wordmark-sonor');
        cursorX += wmW + 10;
      } catch (e) {
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(10);
        _setText(pdf, COLOURS.text);
        pdf.text('SONOR', cursorX, baselineY);
        cursorX += pdf.getTextWidth('SONOR') + 10;
      }
    } else {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(10);
      _setText(pdf, COLOURS.text);
      pdf.text('SONOR', cursorX, baselineY);
      cursorX += pdf.getTextWidth('SONOR') + 10;
    }
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text2);
    const sep = '   ·   ';
    const projTxt = meta.name || 'Untitled';
    pdf.text(projTxt + sep + _drawingCode(meta, opts.pageCode || 'PAG'), cursorX, baselineY);

    // Right side — page X/Y + status pill
    const schedPageStr = opts.pageTotal ? ('Page ' + opts.pageNum + ' of ' + opts.pageTotal) : ('Page ' + (opts.pageNum || 1));
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    // Reserve ~80pt for status pill on the right
    const status = (meta.status || 'ACTIVE').toUpperCase();
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(6.5);
    const pillW = pdf.getTextWidth(status) + 12;
    const pillX = pageW - 12 - pillW;
    _statusPill(pdf, status, pillX, FY + 6, { fontSize: 6.5, padX: 6, padY: 2 });
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    const schedPageX = pillX - 8;
    pdf.text(schedPageStr, schedPageX, baselineY, { align: 'right' });

    // v2.0.1 — register schedule-footer stamp coord
    try {
      pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
      pdf.__sonorPageStamps__.push({
        page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                ? pdf.internal.getCurrentPageInfo().pageNumber
                : pdf.internal.pages.length - 1),
        x: schedPageX, y: baselineY,
        clearW: 100, clearH: 12, clearOffsetY: -9,
        format: 'sched-page-of',
        align: 'right',
        fontSize: 8, bold: false,
        source: 'sched'
      });
    } catch (_) { /* non-fatal */ }
  }

  // ---- _paintCablingInfoPage(pdf, meta, pageNum, pageTotal) ----
  // NEW v2.0.0 reference page (page 2 of Full Document). Static
  // auto-generated. 6 sections: Cable ID format, cable type taxonomy,
  // symbol convention, mounting options, 10-service strip, install notes.
  function _paintCablingInfoPage(pdf, meta, pageNum, pageTotal) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    paintHeader(pdf, { title: 'CABLING INFORMATION', subtitle: 'Reference sheet — read with all takeoff drawings', aspect: 'cabling', meta });
    paintHeaderDrawingCode(pdf, meta, 'CBL');

    const M = 32;
    const top = 60;
    const colW = (pageW - M * 3) / 2;
    const leftX = M;
    const rightX = M + colW + M;

    // ---- LEFT COLUMN ----
    let lY = top;

    // Section 1 — Cable ID format
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    pdf.text('1.  CABLE ID FORMAT', leftX, lY);
    lY += 18;
    // Big sample "AA-S-02"
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(28);
    _setText(pdf, ASPECT_ACCENT.cabling);
    pdf.text('AA-S-02', leftX, lY + 22);
    lY += 38;
    // Breakdown
    const idRows = [
      ['AA',          'Lowest Floor (A) · Top Left Room (A)'],
      ['S',           'Speaker Cable (cable type)'],
      ['02',          'ID Number (sequential per type)'],
      ['Destination', 'HE = Audio/Video Head End  ·  RK = Rack  ·  KP = Keypad']
    ];
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8.5);
    idRows.forEach(r => {
      pdf.setFont(_pdfFontFamily(), 'bold');
      _setText(pdf, COLOURS.text);
      pdf.text(r[0], leftX, lY);
      pdf.setFont(_pdfFontFamily(), 'normal');
      _setText(pdf, COLOURS.text2);
      pdf.text(r[1], leftX + 70, lY);
      lY += 13;
    });
    lY += 18;

    // Section 3 — Symbol convention (left col)
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    pdf.text('2.  SYMBOL CONVENTION', leftX, lY);
    lY += 16;
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text2);
    const symRows = [
      ['Speaker (in-ceiling)',  'SP-AA-1'],
      ['Wall plate (Cat6 + RG6)', 'WP-AA-2'],
      ['Camera (CCTV)',         'CCTV-AA-1'],
      ['Keypad / control',      'KP-AA-1'],
      ['LED strip terminator',  'LED-AA-1']
    ];
    symRows.forEach(r => {
      _setFill(pdf, ASPECT_ACCENT.cabling);
      pdf.circle(leftX + 4, lY - 3, 2.5, 'F');
      _setText(pdf, COLOURS.text2);
      pdf.text(r[0], leftX + 14, lY);
      pdf.setFont(_pdfFontFamily(), 'bold');
      _setText(pdf, COLOURS.text);
      pdf.text(r[1], leftX + colW - 4, lY, { align: 'right' });
      pdf.setFont(_pdfFontFamily(), 'normal');
      lY += 13;
    });

    // ---- RIGHT COLUMN ----
    let rY = top;

    // Section 2 — Cable type taxonomy table
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    pdf.text('3.  CABLE TYPES & BEND RADII', rightX, rY);
    rY += 14;

    const tableRows = [
      ['Speaker 2-core',   '35',  '—'],
      ['Speaker 4-core',   '35',  '—'],
      ['Audio signal',     '25',  '—'],
      ['RG6 coaxial',      '65',  '—'],
      ['Control',          '65',  '—'],
      ['Cat6',             '48',  '—'],
      ['Optical fibre',    '200', 'Special handling'],
      ['Blinds (Sivoia)',  '90',  '—']
    ];
    // Header row
    _setFill(pdf, COLOURS.panel);
    pdf.rect(rightX, rY, colW, 14, 'F');
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7.5);
    _setText(pdf, COLOURS.muted);
    pdf.text('TYPE',         rightX + 6, rY + 9);
    pdf.text('R (mm)',       rightX + colW * 0.55, rY + 9, { align: 'right' });
    pdf.text('NOTES',        rightX + colW - 6, rY + 9, { align: 'right' });
    rY += 14;
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    tableRows.forEach((r, i) => {
      if (i % 2 === 1) {
        _setFill(pdf, COLOURS.altRow);
        pdf.rect(rightX, rY, colW, 12, 'F');
      }
      _setText(pdf, COLOURS.text);
      pdf.text(r[0], rightX + 6, rY + 8);
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.text(r[1], rightX + colW * 0.55, rY + 8, { align: 'right' });
      pdf.setFont(_pdfFontFamily(), 'normal');
      _setText(pdf, COLOURS.muted);
      pdf.text(r[2], rightX + colW - 6, rY + 8, { align: 'right' });
      rY += 12;
    });
    rY += 16;

    // Section 4 — Mounting options (right col)
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(11);
    _setText(pdf, COLOURS.text);
    pdf.text('4.  MOUNTING OPTIONS', rightX, rY);
    rY += 14;
    const quad = [
      ['Ceiling',     'Recessed flush — fire-rated back-box'],
      ['Wall',        'In-wall pre-wire — flush plate finish'],
      ['Floor',       'Floor box / under-carpet — sealed exit'],
      ['Pre-wire',    'First-fix only — second-fix at fit-out']
    ];
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    const quadW = colW / 2;
    quad.forEach((r, i) => {
      const qx = rightX + (i % 2) * quadW;
      const qy = rY + Math.floor(i / 2) * 28;
      _setFill(pdf, COLOURS.panel);
      pdf.rect(qx, qy, quadW - 4, 24, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text);
      pdf.text(r[0], qx + 6, qy + 10);
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(7);
      _setText(pdf, COLOURS.muted);
      pdf.text(_truncate(pdf, r[1], quadW - 12), qx + 6, qy + 20);
    });
    rY += 60;

    // ---- BOTTOM (full width) — Section 5 + 6 ----
    let bY = Math.max(lY, rY) + 6;

    // Section 5 — 10-service taxonomy strip
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10.5);
    _setText(pdf, COLOURS.text);
    pdf.text('5.  10-SERVICE TAXONOMY', M, bY);
    bY += 12;
    if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
      const stripW = pageW - M * 2;
      const tileW = stripW / 10;
      const tileH = 26;
      SERVICES.slice(0, 10).forEach((s, i) => {
        const tx = M + i * tileW;
        _setFill(pdf, s.colour || '#999');
        pdf.rect(tx, bY, tileW - 2, 6, 'F');
        _setFill(pdf, COLOURS.panel);
        pdf.rect(tx, bY + 6, tileW - 2, tileH - 6, 'F');
        _setStroke(pdf, COLOURS.border);
        pdf.setLineWidth(0.3);
        pdf.rect(tx, bY, tileW - 2, tileH);
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(8);
        _setText(pdf, COLOURS.text);
        const nn = String(i + 1).padStart(2, '0');
        pdf.text(nn, tx + 4, bY + 16);
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(7);
        _setText(pdf, COLOURS.text2);
        pdf.text(_truncate(pdf, s.name || '', tileW - 12), tx + 14, bY + 16);
      });
      bY += tileH + 16;
    }

    // Section 6 — Standing install notes
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10.5);
    _setText(pdf, COLOURS.text);
    pdf.text('6.  STANDING INSTALL NOTES', M, bY);
    bY += 12;
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8.5);
    _setText(pdf, COLOURS.text2);
    const notes = [
      'Do not scale from this drawing — all dimensions to be confirmed on-site.',
      'Label cables 150 mm from the cable end (both ends) using approved markers.',
      'Maintain 300 mm minimum parallel separation from mains-voltage cabling.',
      'Where mains and low-voltage cross, cross at 90 degrees only.',
      'Sockets/keypads/wall-plates installed at standard heights per project spec.',
      'Cables loosely coiled 1.0 m above FFL at termination point pending second-fix.'
    ];
    notes.forEach((n, i) => {
      pdf.text((i + 1) + '.  ' + n, M + 4, bY);
      bY += 12;
    });
    bY += 14;

    // ---- v5.2.3 — Section 7: Drawing annotations ----
    // Two sub-blocks side-by-side:
    //   Left:  Height prefix letters (C/T/M/F/S/D) — what the small letter
    //          inside an outlet outline means
    //   Right: Revision-status cloud convention (red removed / orange
    //          moved / green added) — what coloured cloud-outlines around
    //          symbols signify when a drawing is reissued.
    // Closes the gap on outlet-mounting nuance
    // and revision-status visibility.
    const annTopY = bY;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10.5);
    _setText(pdf, COLOURS.text);
    pdf.text('7.  DRAWING ANNOTATIONS', M, annTopY);
    bY = annTopY + 14;

    const annColW = (pageW - M * 3) / 2;
    const annLeftX = M;
    const annRightX = M + annColW + M;

    // ---- LEFT — Height prefix letters ----
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    pdf.text('HEIGHT PREFIX (small letter inside outlet)', annLeftX, bY, { charSpace: 0.6 });
    let hY = bY + 12;
    const heights = [
      ['C', 'High level — under ceiling'],
      ['T', 'TV level — 1500 mm AFFL'],
      ['M', 'Middle — standard switch / above worktop'],
      ['F', 'Low — standard outlet / above floor'],
      ['S', 'To suit furniture / custom — confirm pre-fit'],
      ['D', 'To suit bedhead / bedside — confirm with ID']
    ];
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    heights.forEach(r => {
      // Big letter chip (slate fill, white text)
      _setFill(pdf, COLOURS.text);
      pdf.roundedRect(annLeftX, hY - 8, 14, 12, 1.5, 1.5, 'F');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8.5);
      _setText(pdf, '#FFFFFF');
      pdf.text(r[0], annLeftX + 7, hY + 1, { align: 'center' });
      // Description
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text2);
      pdf.text(_truncate(pdf, r[1], annColW - 24), annLeftX + 20, hY);
      hY += 14;
    });

    // ---- RIGHT — Revision-status cloud convention ----
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    pdf.text('REVISION-STATUS CLOUDS (around symbol)', annRightX, bY, { charSpace: 0.6 });
    let revY = bY + 12;
    const revStatuses = [
      { col: '#ec6061', label: 'RED — Removed in this revision' },     // svc06 red
      { col: '#e37c59', label: 'ORANGE — Moved in this revision' },    // svc05 terracotta
      { col: '#78ba57', label: 'GREEN — Added in this revision' }      // svc03 green
    ];
    pdf.setFont(_pdfFontFamily(), 'normal');
    revStatuses.forEach(s => {
      // Cloud-style outline: 3 overlapping circles forming a scalloped
      // rectangle ~22 × 12pt. Reads as a revision-cloud annotation.
      const cy = revY - 2;
      _setStroke(pdf, s.col);
      pdf.setLineWidth(1.0);
      _setFill(pdf, '#FFFFFF');
      pdf.circle(annRightX + 4, cy, 4, 'FD');
      pdf.circle(annRightX + 11, cy, 5, 'FD');
      pdf.circle(annRightX + 19, cy, 4, 'FD');
      // Inner symbol placeholder (small filled square)
      _setFill(pdf, COLOURS.muted);
      pdf.rect(annRightX + 8, cy - 1.5, 6, 3, 'F');
      // Label
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text2);
      pdf.text(_truncate(pdf, s.label, annColW - 32), annRightX + 28, revY);
      revY += 16;
    });

    // ---- v5.4.1 — Section 8: Tails Protocol ----
    // Service-loop length convention every Sonor installer recognises.
    // Pulled from MacFadyen Cable Schedule reference: TVs 1m @ TV / 5m @
    // Node0, Speakers 2m @ speaker / 5m @ Node0, Data 500mm @ outlet /
    // 5m @ Node0, Shades 1m @ outlet / 3m @ SHD-PANEL.
    // Saves the installer flipping back to the spec doc — every cable's
    // service-loop convention is one glance away on the same page.
    bY = Math.max(hY, revY) + 14;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10.5);
    _setText(pdf, COLOURS.text);
    pdf.text('8.  TAILS PROTOCOL', M, bY);
    bY += 14;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.muted);
    pdf.text('SERVICE LOOP @ EACH END (per outlet  ·  per head-end)', M, bY, { charSpace: 0.6 });
    bY += 12;
    const tailsRows = [
      { kind: 'TV / Display',         atOutlet: '1.0 m',    atHE: '5.0 m' },
      { kind: 'Ceiling Speaker',      atOutlet: '2.0 m',    atHE: '5.0 m' },
      { kind: 'Wall Speaker',         atOutlet: '1.0 m',    atHE: '5.0 m' },
      { kind: 'Data / Cat6',          atOutlet: '0.5 m',    atHE: '5.0 m' },
      { kind: 'Wireless Access Point', atOutlet: '0.5 m',   atHE: '5.0 m' },
      { kind: 'Shade / Blind',        atOutlet: '1.0 m',    atHE: '3.0 m  (SHD-PANEL)' },
      { kind: 'Lighting Keypad',      atOutlet: '0.3 m',    atHE: '5.0 m  (LPNL)' },
      { kind: 'CCTV Camera',          atOutlet: '0.5 m',    atHE: '5.0 m  (NVR)' }
    ];
    const tailsColW = (pageW - M * 2) / 4;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7.5);
    _setText(pdf, COLOURS.muted);
    pdf.text('OUTLET TYPE',     M,                       bY, { charSpace: 0.6 });
    pdf.text('@ OUTLET',        M + tailsColW * 1.6,     bY, { charSpace: 0.6 });
    pdf.text('@ HEAD-END',      M + tailsColW * 2.4,     bY, { charSpace: 0.6 });
    bY += 10;
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(8);
    tailsRows.forEach((r, i) => {
      if (i % 2 === 1) {
        _setFill(pdf, COLOURS.altRow);
        pdf.rect(M, bY - 8, pageW - M * 2, 11, 'F');
      }
      _setText(pdf, COLOURS.text);
      pdf.text(r.kind, M, bY);
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.text(r.atOutlet, M + tailsColW * 1.6, bY);
      pdf.text(r.atHE,     M + tailsColW * 2.4, bY);
      pdf.setFont(_pdfFontFamily(), 'normal');
      bY += 11;
    });
    bY += 4;
    pdf.setFont(_pdfFontFamily(), 'italic');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('Coil cables loosely 1.0 m above FFL at termination point pending second-fix. Loop where indicated.', M, bY);

    // ---- v5.4.7 — Section 9 REVISION HISTORY (cumulative) ----
    // Sonor canonical pattern from Oak Bank Media Lighting RevA10 — every
    // engineering reference page carries a chronological revision list so
    // the printed PDF self-documents which rev produced it. Compact 4-row
    // band underneath Section 8; renders only when history is present so
    // first-time users don't get an empty section. Each row format:
    //    A{n}  ·  {date dd/mm/yy}  ·  v{takeoff_version}  ·  {LABEL}
    bY += 14;
    if (Array.isArray(meta.revisionHistory) && meta.revisionHistory.length) {
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(10.5);
      _setText(pdf, COLOURS.text);
      pdf.text('9.  REVISION HISTORY', M, bY);
      bY += 11;
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.muted);
      pdf.text('REV', M, bY, { charSpace: 0.6 });
      pdf.text('DATE', M + 36, bY, { charSpace: 0.6 });
      pdf.text('VERSION', M + 100, bY, { charSpace: 0.6 });
      pdf.text('NOTES', M + 170, bY, { charSpace: 0.6 });
      bY += 9;
      const innerW = pageW - M * 2;
      const labelMaxW = innerW - 170 - 4;
      // Show oldest-first (A1 at top), cap at 6 rows so the band stays
      // bounded; collapse with "(N more)" if exceeded — matches title-block.
      const MAX_ROWS = 6;
      let rows = meta.revisionHistory;
      if (rows.length > MAX_ROWS) {
        rows = [rows[0], { code: '…', label: `(${rows.length - MAX_ROWS} earlier rows hidden)`, date: '', takeoff_version: '' }, ...rows.slice(-(MAX_ROWS - 2))];
      }
      rows.forEach((r, i) => {
        if (i % 2 === 1) {
          _setFill(pdf, COLOURS.altRow);
          pdf.rect(M, bY - 6.5, pageW - M * 2, 9.5, 'F');
        }
        const isLatest = (r.code === meta.revision);
        pdf.setFont(_pdfFontFamily(), isLatest ? 'bold' : 'normal');
        pdf.setFontSize(7.5);
        _setText(pdf, isLatest ? COLOURS.text : COLOURS.text2);
        pdf.text(r.code || '—', M, bY);
        pdf.text(r.date || '—', M + 36, bY);
        pdf.text(r.takeoff_version ? 'v' + r.takeoff_version : '—', M + 100, bY);
        const lblText = (r.label || '').slice(0, 96);
        pdf.text(_truncate(pdf, lblText, labelMaxW), M + 170, bY);
        if (r.as_built) {
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(5.8);
          const ab = 'AS-BUILT';
          const abW = pdf.getTextWidth(ab) + 5;
          const abX = pageW - M - abW;
          _setFill(pdf, '#78ba57');
          pdf.roundedRect(abX, bY - 6, abW, 8, 1, 1, 'F');
          _setText(pdf, '#FFFFFF');
          pdf.text(ab, abX + abW / 2, bY - 0.5, { align: 'center' });
        }
        bY += 9;
      });
    }

    // ---- v5.4.13/v5.4.23 — Section 10 EXTERNAL DOCUMENTATION ----
    // Conditional: only render when there's room before the page footer.
    // Pre-v5.4.23 §10 spilled past the bottom of the page on long projects
    // (Caldy export — last 2 rows overlapped the slate footer). Now we
    // measure the remaining space against the section's known height and
    // skip the section when it would clip.
    const SCHED_FOOTER_H = 28;            // matches _paintScheduleFooter band height
    const EXT_DOCS_HEIGHT = 14 + 11 + 12 + 9 + 9 * 9.5 + 6;  // heading + caption + table = ~115pt
    const remainingV = pageH - SCHED_FOOTER_H - 12 - bY;
    const canRenderExtDocs = remainingV >= EXT_DOCS_HEIGHT;
    if (!canRenderExtDocs) {
      _paintScheduleFooter(pdf, { meta, pageNum: pageNum, pageTotal: pageTotal, pageCode: 'CBL' });
      return;
    }
    bY += 14;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10.5);
    _setText(pdf, COLOURS.text);
    pdf.text('10.  EXTERNAL DOCUMENTATION', M, bY);
    bY += 11;
    pdf.setFont(_pdfFontFamily(), 'italic');
    pdf.setFontSize(7.5);
    _setText(pdf, COLOURS.muted);
    pdf.text(meta.dropboxFolder
      ? 'Live revisions of the documents below are kept in the project Dropbox folder.'
      : 'Documents below referenced by the takeoff — see project folder for revisions.',
      M, bY);
    bY += 12;
    // Document index — canonical Sonor sub-doc taxonomy. Each row carries
    // a category icon-style chip + the document name + a status hint.
    const extDocs = [
      { cat: 'PLAN',   name: 'Media + Lighting Floor Plans',     status: 'this document is the schedule pair' },
      { cat: 'SCHED',  name: 'LED Strip Schedule',                status: 'voltage / wattage / DMX channel map' },
      { cat: 'SCHED',  name: 'Lighting Circuit Schedule',         status: 'LC keypad → load mapping' },
      { cat: 'SCHED',  name: 'Shade / Window Treatment Schedule', status: 'Caldy 14-column motor + textile detail' },
      { cat: 'CAD',    name: 'Cinema Room Construction Drawings', status: 'studwork / framing / coffer / acoustic' },
      { cat: 'CAD',    name: 'Wall Elevations + TV Recess Detail', status: 'finished-opening / mount centre / tilt' },
      { cat: 'RACK',   name: 'AV Rack Schematic + Patch Plan',     status: 'rack elevation + patch field' },
      { cat: 'NETWK',  name: 'Network Topology Map',               status: 'switch ports / VLAN / WAP coverage' },
      { cat: 'RAMS',   name: 'Risk Assessment + Method Statement', status: 'pre-install briefing pack' }
    ];
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(7);
    _setText(pdf, COLOURS.muted);
    pdf.text('CAT',     M,        bY, { charSpace: 0.6 });
    pdf.text('DOCUMENT', M + 50,  bY, { charSpace: 0.6 });
    pdf.text('CONTENT', M + 280,  bY, { charSpace: 0.6 });
    bY += 9;
    extDocs.forEach((d, i) => {
      if (i % 2 === 1) {
        _setFill(pdf, COLOURS.altRow);
        pdf.rect(M, bY - 6.5, pageW - M * 2, 9.5, 'F');
      }
      // Category chip
      const catColours = { PLAN: '#4bb9d3', SCHED: '#f5d05c', CAD: '#8058a1', RACK: '#302f2e', NETWK: '#78ba57', RAMS: '#ec6061' };
      const chipHex = catColours[d.cat] || COLOURS.muted;
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(5.5);
      const catW = pdf.getTextWidth(d.cat) + 6;
      _setFill(pdf, chipHex);
      pdf.roundedRect(M, bY - 6, catW, 8, 1, 1, 'F');
      _setText(pdf, '#FFFFFF');
      pdf.text(d.cat, M + catW / 2, bY - 0.5, { align: 'center' });
      // Document name
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(7.5);
      _setText(pdf, COLOURS.text);
      pdf.text(d.name, M + 50, bY);
      // Content hint
      pdf.setFont(_pdfFontFamily(), 'italic');
      pdf.setFontSize(7);
      _setText(pdf, COLOURS.muted);
      pdf.text(d.status, M + 280, bY);
      bY += 9.5;
    });

    _paintScheduleFooter(pdf, { meta, pageNum: pageNum, pageTotal: pageTotal, pageCode: 'CBL' });
  }

  // ---- _paintBendRadiusPage(pdf, meta, pageNum, pageTotal) ----
  // v2.0.0 reference page (page 3 of Full Document). 7 concentric arcs at
  // ~1:1 A3 scale (1 mm = 2.834 pt at 72dpi). Each labelled with cable type +
  // bend radius (mm).
  //
  // v2.0.1 fixes:
  //   1. Centre forced to true page centre, with safe-margin verification
  //      against headerH + titleBlockH + page edges. Arcs scale to 0.95×
  //      when 200 mm radius would clip; the legend chip then reads
  //      "0.95 : 1 — multiply radii by 1.05 for true mm".
  //   2. Labels move to a clean bottom-left LEGEND STACK (colour swatch +
  //      cable type + radius mm) instead of bunching at the centre. The
  //      arcs themselves stay clean with just a single tiny tick at 0° on
  //      the right edge of each arc. This kills overlap entirely and is
  //      cleaner for a soup of small radii.
  //   3. Calls _paintTitleBlock instead of _paintScheduleFooter so the
  //      drawing chrome is consistent with v2.0.1 full-width band style.
  function _paintBendRadiusPage(pdf, meta, pageNum, pageTotal) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    paintHeader(pdf, { title: 'BEND RADIUS REFERENCE', subtitle: '1:1 scale on A3 — verify with ruler before installation', aspect: 'bend', meta });
    paintHeaderDrawingCode(pdf, meta, 'BRD');

    // Drawable area inside header (top) and title-block band (bottom)
    const HEADER_H = 56;          // matches paintHeader bar
    const TITLE_BLOCK_H = 70;     // matches v2.0.1 _paintTitleBlock band
    const drawTop = HEADER_H + 8;
    const drawBottom = pageH - TITLE_BLOCK_H - 8;
    const drawH = drawBottom - drawTop;

    // 1 mm = 2.834645669 pt
    const MM = 2.834645669;
    const arcs = [
      { mm: 200, label: 'Optical fibre',          hex: '#e37c59', special: true },
      { mm: 90,  label: 'Blinds (Sivoia)',        hex: '#8058a1' },
      { mm: 65,  label: 'RG6 coaxial',            hex: '#4bb9d3' },
      { mm: 65,  label: 'Control',                hex: '#e67eb1', offset: true },
      { mm: 48,  label: 'Cat6',                   hex: '#78ba57' },
      { mm: 35,  label: 'Speaker 2 & 4-core',     hex: '#ad9978' },
      { mm: 25,  label: 'Audio signal',           hex: '#f5d05c' }
    ];
    const maxRmm = Math.max.apply(null, arcs.map(a => a.mm));
    const maxRpt = maxRmm * MM;     // ~566.93pt @ 1:1

    // Compute scale factor — keep 1:1 when it fits with 8pt margin, otherwise
    // shrink to fit. Centre is true page centre (horizontally) and centre of
    // drawable vertical band.
    const cx = pageW / 2;
    const cy = drawTop + drawH / 2;
    const horizSafe = Math.min(cx, pageW - cx) - 12;   // distance from centre to nearer edge
    const vertSafe  = Math.min(cy - drawTop, drawBottom - cy) - 12;
    const safeR     = Math.min(horizSafe, vertSafe);
    let scale = 1.0;
    if (maxRpt > safeR) {
      scale = Math.max(0.5, safeR / maxRpt);
      // Round to 2 dp for legend display
      scale = Math.floor(scale * 100) / 100;
    }
    const trueRatio = (1 / scale).toFixed(2);  // multiply by this for true mm

    // Reserve a label-stack column on bottom-left of the drawable area.
    const stackX = 28;
    const stackY = drawBottom - (arcs.length * 14 + 24);
    const stackW = 220;
    // (Stack is rendered after arcs so it sits over them cleanly.)

    // Draw arcs (full circles — jsPDF handles partial arcs unreliably)
    arcs.forEach(a => {
      const r = a.mm * MM * scale;
      _setStroke(pdf, a.hex);
      pdf.setLineWidth(a.special ? 1.6 : 1.0);
      try { pdf.circle(cx, cy, r); } catch (e) {}
      // Single tiny tick at 0° (right) — quick visual anchor on each arc
      pdf.setLineWidth(0.5);
      pdf.line(cx + r - 4, cy, cx + r + 4, cy);
    });

    // Centre dot + crosshair
    _setStroke(pdf, COLOURS.text);
    pdf.setLineWidth(0.4);
    pdf.line(cx - 8, cy, cx + 8, cy);
    pdf.line(cx, cy - 8, cx, cy + 8);
    _setFill(pdf, COLOURS.text);
    pdf.circle(cx, cy, 1.4, 'F');

    // ---- Bottom-left LEGEND STACK (clean key, no overlap) ----
    // Background panel for legibility against arc lines
    _setFill(pdf, '#FFFFFF');
    pdf.rect(stackX - 6, stackY - 14, stackW, arcs.length * 14 + 22, 'F');
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.4);
    pdf.rect(stackX - 6, stackY - 14, stackW, arcs.length * 14 + 22);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, COLOURS.text);
    pdf.text('MIN BEND RADIUS — KEY', stackX, stackY - 2);
    let lY = stackY + 12;
    arcs.forEach(a => {
      // Colour swatch
      _setFill(pdf, a.hex);
      pdf.circle(stackX + 5, lY - 3, 3.2, 'F');
      // Label
      pdf.setFont(_pdfFontFamily(), a.special ? 'bold' : 'normal');
      pdf.setFontSize(8);
      _setText(pdf, COLOURS.text);
      pdf.text(a.label, stackX + 14, lY);
      // Radius (right-aligned within stack)
      pdf.setFont(_pdfFontFamily(), 'bold');
      _setText(pdf, a.hex);
      pdf.text(a.mm + ' mm', stackX + stackW - 18, lY, { align: 'right' });
      lY += 14;
    });

    // ---- Bottom-right SCALE CHIP ----
    const chipW = 220;
    const chipH = 50;
    const chipX = pageW - chipW - 28;
    const chipY = drawBottom - chipH - 4;
    _setFill(pdf, '#FFFFFF');
    pdf.rect(chipX, chipY, chipW, chipH, 'F');
    _setStroke(pdf, COLOURS.border);
    pdf.setLineWidth(0.4);
    pdf.rect(chipX, chipY, chipW, chipH);
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(10);
    _setText(pdf, COLOURS.text);
    const scaleLbl = (scale === 1.0) ? '1 : 1 SCALE @ A3' : (scale.toFixed(2) + ' : 1 SCALE @ A3');
    pdf.text(scaleLbl, chipX + 10, chipY + 14);
    pdf.setFont(_pdfFontFamily(), 'normal');
    pdf.setFontSize(7.5);
    _setText(pdf, COLOURS.muted);
    if (scale === 1.0) {
      pdf.text('Place a ruler across the centre to verify 200 mm = 200 mm.', chipX + 10, chipY + 26);
      pdf.text('If the printed sheet has been scaled, multiply all radii proportionally', chipX + 10, chipY + 36);
      pdf.text('before pre-bending cables on site.', chipX + 10, chipY + 46);
    } else {
      pdf.text('Arcs reduced to fit page. Multiply each radius by ' + trueRatio + ' for true mm,', chipX + 10, chipY + 26);
      pdf.text('or print A3 unscaled for true 1:1. Verify with a ruler before pre-bending', chipX + 10, chipY + 36);
      pdf.text('cables on site.', chipX + 10, chipY + 46);
    }

    // v2.0.1 — drawing-page chrome (full-width title block)
    _paintTitleBlock(pdf, { meta, pageNum: pageNum, pageTotal: pageTotal, pageCode: 'BRD' });
  }

  // ---- _emitVectorOrRaster(pdf, opts) ----
  // v2.0.0 vector-pipeline shim. Tries pdf.svg() with the canvas's SVG export
  // first (smaller, sharper, NO cursor artefact), falls back to raster
  // pdf.addImage() with v1.99.1 compression flags on any throw.
  // v2.3.2 — DEFAULT FLIPPED BACK TO OPT-IN. Bryn report 2026-04-28: Full
  // Document export ballooned to 380 MB (vs 9.4 MB raster baseline) because
  // Fabric `canvas.toSVG()` serialises the background plan image as a giant
  // base64 data URL inside the SVG, embedded once per page. v2.0.6's
  // default-on flip was unsafe whenever a plan image is loaded (i.e. always).
  // Long-term fix: hybrid pipeline that emits the plan image once via
  // pdf.addImage and only the overlay objects via pdf.svg — deferred to v2.4.
  // v2.3.2 reverts to original opt-in behaviour: vector only runs when the
  // user explicitly sets localStorage 'takeoffs-pdf-vector' = '1'. The
  // emergency opt-out flag 'takeoffs-pdf-vector-disable' is preserved so
  // anyone who set it during the v2.0.6→v2.3.1 window stays safe.
  // The clean-render benefit (no cursor capture) is preserved on the raster
  // path because every snapshot helper calls canvas.discardActiveObject()
  // followed by renderAll() before canvas.toDataURL().
  async function _emitVectorOrRaster(pdf, opts) {
    const dataUrl = opts.dataUrl;
    const x = opts.x, y = opts.y, w = opts.w, h = opts.h;
    let useVector = false;
    try {
      let disabled = false;
      let optedIn  = false;
      try {
        if (typeof localStorage !== 'undefined') {
          disabled = (localStorage.getItem('takeoffs-pdf-vector-disable') === '1');
          optedIn  = (localStorage.getItem('takeoffs-pdf-vector') === '1');
        }
      } catch (_) { disabled = false; optedIn = false; }
      // v2.3.2 — opt-in only: requires explicit 'takeoffs-pdf-vector' = '1'
      // AND not opted out via 'takeoffs-pdf-vector-disable' = '1'.
      useVector = optedIn && !disabled && typeof pdf.svg === 'function' && typeof canvas !== 'undefined';
    } catch (e) { useVector = false; }

    if (useVector) {
      // Pre-pass: dodge svg2pdf font-fallback by forcing 'helvetica' on text
      // objects, restore originals after. Keeps live canvas display unaffected.
      // v2.0.6 — also hide the rooms layer for the vector serialisation
      // window (Fabric's toSVG() honours `visible:false` and skips the
      // object). Rooms are working overlay only — never a deliverable.
      // Wrapper-driven visibility (CCTV-only / service-slice) is preserved
      // because we only flip rooms that are currently visible — restore
      // sets their state back to whatever it was when we entered.
      const restores = [];
      const roomsStash = _hideRoomsForSnapshot();
      try {
        canvas.getObjects().forEach(o => {
          if (!o) return;
          if (o.type === 'i-text' || o.type === 'textbox' || o.type === 'text') {
            restores.push({ obj: o, prev: o.fontFamily });
            o.set('fontFamily', 'helvetica');
          }
        });
        canvas.renderAll();
        const svgString = canvas.toSVG();
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = svgDoc.documentElement;
        await pdf.svg(svgEl, { x, y, width: w, height: h });
        return 'vector';
      } catch (e) {
        console.warn('[SonorPdf v2.0.0] vector pipeline threw, falling back to raster:', e);
        // Fall through to raster path below
      } finally {
        // Restore previous fontFamily values
        restores.forEach(r => { try { r.obj.set('fontFamily', r.prev); } catch (_) {} });
        // v2.0.6 — restore room visibility post-vector-emit.
        _restoreRoomsAfterSnapshot(roomsStash);
        try { canvas.renderAll(); } catch (_) {}
      }
    }

    // Raster path (default) — uses v1.99.1 compression
    if (dataUrl) {
      const fmt = (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/jpeg') === 0) ? 'JPEG' : 'PNG';
      // v2.3.3 — alias intentionally undefined: each plan-snapshot per page contains
      // different overlay content (Combined / CCTV / Electrical / per-service slices),
      // so its bytes differ. Reusing an alias would WRONGLY dedup distinct images.
      // True per-page-bg dedup needs the v2.4.0 pdf-lib migration (embed bg once,
      // draw overlays separately).
      try { pdf.addImage(dataUrl, fmt, x, y, w, h, undefined, 'FAST'); }
      catch (e) { console.warn('[SonorPdf] plan addImage failed:', e); }
    }
    return 'raster';
  }

  // ---- _paintSectionDividerPage(pdf, meta, opts, pageNum, pageTotal) ---- (v5.1.7)
  // Full-page placeholder / cross-app section divider. Used to mark the
  // boundaries between the Takeoffs deliverables and content owned by
  // sister apps (Packs → rack drawings, Engineering → schematics,
  // Cinema Takeoff → cinema construction). Renders a clean centred
  // "section title" + sub-line + cross-app pointer panel + the standard
  // slate header + branded footer title-block so the deck reads as a
  // coherent multi-pack deliverable.
  //
  // opts: {
  //   sectionTitle:   'RACK BUILD SHEETS',         // h1 text
  //   sectionSubtitle:'Detailed equipment racks…', // h2 text
  //   crossAppLabel:  'See Packs export',          // big pointer line
  //   crossAppDetail: 'sonor-packs · live build…', // sub line
  //   accent:         '#475161',                   // header stripe colour
  //   pageCode:       'DIV-PCK',                   // top-right drawing code
  //   wipBadge:       true                         // optional WIP pill
  // }
  function _paintSectionDividerPage(pdf, meta, opts, pageNum, pageTotal) {
    opts = opts || {};
    meta = meta || collectProjectMeta();
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // Slate header band (matches every other page)
    paintHeader(pdf, {
      title: 'SECTION DIVIDER',
      subtitle: opts.sectionTitle || '',
      aspect: 'plan',
      meta,
      accent: opts.accent
    });
    if (opts.pageCode) paintHeaderDrawingCode(pdf, meta, opts.pageCode);

    // ---- v5.2.2 — Full-height left-edge accent stripe ----
    // 6pt wide bar in the cross-app accent colour running from below the
    // header band to above the footer band. Architectural drawing
    // convention — instantly signals this is a section transition page,
    // visually different from a normal plan / schedule page.
    {
      const stripeAccent = opts.accent || ASPECT_ACCENT.plan;
      const stripeY = 32;  // just below the slate header band
      const stripeH = pageH - 32 - 144;  // above the title-block footer
      _setFill(pdf, stripeAccent);
      pdf.rect(0, stripeY, 6, stripeH, 'F');
    }

    // ---- HERO ZONE (centred, uppercase section title) ----
    // v5.2.2 — bumped title from 34pt → 42pt + tightened eyebrow position
    // for stronger visual presence (these are major section transitions
    // — should hit hard).
    const heroTop = 140;
    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(8);
    _setText(pdf, opts.accent || COLOURS.muted);
    pdf.text('— SECTION —', pageW / 2, heroTop, { align: 'center', charSpace: 4 });

    pdf.setFont(_pdfFontFamily(), 'bold');
    pdf.setFontSize(42);
    _setText(pdf, COLOURS.text);
    pdf.text(String(opts.sectionTitle || '').toUpperCase(), pageW / 2, heroTop + 44, { align: 'center' });

    if (opts.sectionSubtitle) {
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(13);
      _setText(pdf, COLOURS.muted);
      // Wrap so long subtitles don't overflow
      const wrapped = pdf.splitTextToSize(String(opts.sectionSubtitle), pageW - 240);
      pdf.text(wrapped, pageW / 2, heroTop + 70, { align: 'center' });
    }

    // v5.2.2 — Accent stripe in the section colour (wider, more visual
    // weight than a hairline). Centered, 60pt × 3pt — pulls the eye and
    // confirms the section ownership colour.
    const stripeW = 60;
    const stripeH = 3;
    _setFill(pdf, opts.accent || ASPECT_ACCENT.plan);
    pdf.rect((pageW - stripeW) / 2, heroTop + 110, stripeW, stripeH, 'F');

    // ---- WIP pill (optional, terracotta) ----
    if (opts.wipBadge) {
      const wipText = 'WORK IN PROGRESS';
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8);
      const wipW = pdf.getTextWidth(wipText) + 18;
      const wipH = 16;
      const wipX = (pageW - wipW) / 2;
      const wipY = heroTop + 130;
      _setFill(pdf, '#e37c59');  // terracotta
      pdf.roundedRect(wipX, wipY, wipW, wipH, 2, 2, 'F');
      _setText(pdf, '#FFFFFF');
      pdf.text(wipText, wipX + wipW / 2, wipY + 11, { align: 'center', charSpace: 1 });
    }

    // ---- CROSS-APP POINTER PANEL ----
    if (opts.crossAppLabel) {
      const panelW = 480;
      const panelH = 92;
      const panelX = (pageW - panelW) / 2;
      const panelY = pageH / 2 + 20;
      _setFill(pdf, COLOURS.panel);
      pdf.roundedRect(panelX, panelY, panelW, panelH, 6, 6, 'F');
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.6);
      pdf.roundedRect(panelX, panelY, panelW, panelH, 6, 6);

      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(8);
      _setText(pdf, opts.accent || COLOURS.muted);
      pdf.text('OWNED BY', panelX + 20, panelY + 22, { charSpace: 2 });

      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(20);
      _setText(pdf, COLOURS.text);
      pdf.text(opts.crossAppLabel, panelX + 20, panelY + 50);

      if (opts.crossAppDetail) {
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(10);
        _setText(pdf, COLOURS.muted);
        const wrapped = pdf.splitTextToSize(String(opts.crossAppDetail), panelW - 40);
        pdf.text(wrapped, panelX + 20, panelY + 72);
      }
    }

    // Standard branded footer
    paintFooter(pdf, {
      pageCode: opts.pageCode || 'DIV',
      pageNum: pageNum || 1,
      pageTotal: pageTotal || 1,
      meta,
      title: 'Section Divider'
    });
  }

  // v5.4.34 — HTML/CSS plan-page emit wrapper. Async because it goes
  // through SonorPdfHtmlCover.renderPlanPage (html2canvas iframe
  // pipeline). Translates the host-side opts shape to the HTML template
  // shape: legend rows mapped from {colour}→{accent}, totals derived
  // from opts.summary or opts.totals, drawing key uses the canonical
  // 6-cable list unless overridden. On any failure, caller falls back
  // to the native _emitPlanPageIntoPdf below.
  // Returns true on success, false on failure.
  async function _emitPlanPageIntoPdfHtml(pdf, opts, baseMeta) {
    if (!(typeof window !== 'undefined' && window.SonorPdfHtmlCover &&
          typeof window.SonorPdfHtmlCover.renderPlanPage === 'function' &&
          window.SonorPdfHtmlCover.available())) {
      return false;
    }
    try {
      const meta = baseMeta || collectProjectMeta();
      const dataUrl = opts.dataUrl;
      if (!dataUrl) return false;  // no canvas snapshot → can't render

      // Translate legend shape: native uses {kind, level, colour, code,
      // label, qty}; HTML expects {kind, level, accent, code, label, qty}.
      const legend = (Array.isArray(opts.legend) ? opts.legend : []).map(r => {
        const out = { ...r };
        if (out.colour && !out.accent) out.accent = out.colour;
        return out;
      });

      // v5.4.35 — Derive totals from explicit opts.totals (caller-provided),
      // OR opts.floorIndex (lookup in computeProjectTotals().perFloor[i]),
      // OR summary parsing fallback. The floorTotalsPanel expects
      // {rooms, blocks, areaM2, perimeterM, cableM, ledM, shades}.
      let totals = null;
      if (opts.totals && typeof opts.totals === 'object') {
        totals = opts.totals;
      } else if (typeof opts.floorIndex === 'number' && typeof computeProjectTotals === 'function') {
        try {
          const t = computeProjectTotals();
          const f = t && t.perFloor && t.perFloor[opts.floorIndex];
          if (f) {
            totals = {
              rooms: f.rooms != null ? f.rooms : null,
              blocks: f.symbols != null ? (f.symbols + (f.shades || 0)) : null,   // v5.145.0 — + drawn shades
              // v5.78.0 — areaM2/perimeterM dropped from all pdf outputs
              cableM: f.cableM != null ? f.cableM : null,
              ledM: f.ledM != null ? f.ledM : null,
              shades: f.shades != null ? f.shades : null
            };
          }
        } catch (_) { /* fall through */ }
      }
      if (!totals && Array.isArray(opts.summary) && opts.summary.length) {
        totals = {};
        opts.summary.forEach(row => {
          if (!row || row.length < 2) return;
          const k = String(row[0] || '').toLowerCase();
          const v = row[1];
          if (k.indexOf('room')   !== -1) totals.rooms = _parseNumOrStr(v);
          else if (k.indexOf('block') !== -1 || k.indexOf('symbol') !== -1) totals.blocks = _parseNumOrStr(v);
          // v5.78.0 — area/perim no longer surfaced on pdf outputs
          else if (k.indexOf('cable') !== -1) totals.cableM = _parseNumOrStr(v);
          else if (k.indexOf('led') !== -1) totals.ledM = _parseNumOrStr(v);
          else if (k.indexOf('shade') !== -1) totals.shades = _parseNumOrStr(v);
        });
      }
      // v5.78.0 — BUG FIX (Bryn: "individual service pages have floor totals
      // incorrect, every floor shows the overall total"): the old last-resort
      // fell back to PROJECT GRAND totals for CCTV / Electrical / slice pages
      // (which carry no per-floor index), so every floor's service page showed
      // whole-project numbers. The plan-page walk switchFloor()'s before
      // painting, so the ACTIVE floor IS the page's floor — resolve its
      // perFloor entry instead. Grand stays only as the final fallback when
      // no active floor resolves (never during the walk).
      // v5.198.0 — the summary-parse branch above only ever learns "Blocks"
      // (legend rows carry no rooms / cable / shades), so every plan page
      // printed "Rooms — · Cable measured — · Shades —". Backfill whatever is
      // still missing from the ACTIVE floor's totals (the walk switches floor
      // before painting, so that is this page's floor).
      const _needBackfill = !totals || ['rooms', 'blocks', 'cableM', 'ledM', 'shades'].some(k => totals[k] == null);
      if (_needBackfill && typeof computeProjectTotals === 'function') {
        try {
          const t = computeProjectTotals();
          let _af = null;
          try { _af = (typeof _activeFloor === 'function') ? _activeFloor() : null; } catch (_) {}
          if (!_af) {
            try {
              if (typeof activeFloorId !== 'undefined' && typeof floors !== 'undefined' && Array.isArray(floors)) {
                _af = floors.find(x => x && x.id === activeFloorId) || null;
              }
            } catch (_) {}
          }
          const fEntry = (t && Array.isArray(t.perFloor) && _af)
            ? t.perFloor.find(pf => pf && pf.id === _af.id) : null;
          const src = fEntry || (t && t.grand) || null;
          if (src) {
            const full = {
              rooms: src.rooms,
              blocks: (src.symbols || 0) + (src.shades || 0),   // v5.145.0 — + drawn shades
              cableM: src.cableM,
              ledM: src.ledM,
              shades: src.shades
            };
            if (!totals) totals = full;
            else Object.keys(full).forEach(k => { if (totals[k] == null && full[k] != null) totals[k] = full[k]; });
          }
        } catch (_) { /* fall through */ }
      }

      const services = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
        ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
        : null;

      const aspect = opts.aspect || 'plan';
      // v5.144.0 — svc_NN accents resolve from SERVICES/brand when not yet
      // seeded into ASPECT_ACCENT (electrical svc_11, early-emitted wifi).
      const accentHex = (typeof ASPECT_ACCENT !== 'undefined' && ASPECT_ACCENT[aspect])
        || _svcAccentFromAspect(aspect) || '#475161';

      // Resolve floor name + sub-info bottom-strip (the "GROUND FLOOR" /
      // "FIRST FLOOR" big watermark + the small dark sub-info card top-left).
      // Heuristic: opts.floorName explicit > opts.subtitle parse > opts.title.
      let floorName = opts.floorName;
      if (!floorName && typeof opts.subtitle === 'string') {
        const m = opts.subtitle.match(/—\s*([^·]+)$/);
        if (m) floorName = m[1].trim();
      }

      // v5.22.2 — Combined Plans drop the FLOOR TOTALS sidebar panel (Bryn:
      // the floor name carries the per-floor read; totals live on the
      // Overall Counts + schedule pages). Caller sets opts.hideTotals.
      if (opts.hideTotals === true) totals = null;

      const result = await window.SonorPdfHtmlCover.renderPlanPage({
        // Chrome
        serviceNotes: opts.serviceNotes || null,   // v5.151.0 — SERVICE NOTES sidebar panel
        accentHex,
        status: meta.status,
        sectionTitle: opts.title || 'PLAN',
        // v5.22.2 — floor name after the section title in the header
        // (e.g. "COMBINED PLANS · Ground Floor"). Only set for real-floor
        // pages; CCTV/Electrical leave it null to avoid redundant labels.
        subtitle: opts.headerSubtitle || null,
        reference: meta.ref || '',
        projectName: meta.name,
        client: meta.client,
        address: meta.address,
        revision: meta.revision,
        issueDate: meta.dateUk || meta.date,
        pageNum: opts.pageNum || 1,
        pageTotal: opts.pageTotal || 0,
        services,
        appName: 'Takeoffs',
        // v5.4.59 — revision-cloud counts → footer "REVISIONS" col
        revAdded:   meta.revAdded   || 0,
        revMoved:   meta.revMoved   || 0,
        revRemoved: meta.revRemoved || 0,
        revRfi:     meta.revRfi     || 0,
        revNote:    meta.revNote    || 0,
        // Body
        canvasDataUrl: dataUrl,
        floorName,
        subInfo: opts.subInfo || null,
        illustrationBanner: opts.illustrationBanner !== false,
        legend,
        totals,
        totalsTitle: opts.totalsTitle || 'FLOOR TOTALS',
        showNotes: opts.showNotes === true,
        ledColourSpec: opts.ledColourSpec || null,
        scaleLabel: opts.scaleLabel || null,
        cableTypes: opts.cableTypes || null,
        cableIdFormat: opts.cableIdFormat || 'AA-S-02',
        // v5.111.0 — large diagonal watermark across the plan area (e.g.
        // NO REQUIREMENTS on empty electrical floor pages).
        watermarkText: opts.watermarkText || null
      });
      if (!result || !result.dataUrl) return false;

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      // v5.18.1 — UNIQUE per-page alias. The prior alias `plan-html-<aspect>`
      // was IDENTICAL for every Combined Plans floor (aspect is always
      // 'plan'), so jsPDF's same-alias image dedup made every floor reuse the
      // FIRST floor's bytes → the long-standing "Ground Floor twice" bug. Key
      // on the per-page drawing code + page number so each floor (COM-01,
      // COM-02 …) and each service slice embeds its own distinct image.
      const _planAlias = 'plan-html-' + (opts.pageCode || aspect || 'p') + '-' + (opts.pageNum || 0);
      pdf.addImage(result.dataUrl, 'JPEG', 0, 0, pageW, pageH, _planAlias);

      // Register noop stamp so _finalisePagination Pass 2 doesn't paint
      // over our HTML chrome with the legacy "Page X of Y" overlay.
      try {
        pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
        pdf.__sonorPageStamps__.push({
          page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                  ? pdf.internal.getCurrentPageInfo().pageNumber
                  : pdf.internal.pages.length - 1),
          x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
          format: 'noop',
          source: 'html-plan-suppress'
        });
      } catch (_) { /* non-fatal */ }
      try { window.__SONOR_LAST_PLAN_PATH__ = 'html'; } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[fullDocument v5.4.34] HTML plan emit failed — falling back to native:', e);
      try { window.__SONOR_LAST_PLAN_PATH__ = 'jspdf-fallback'; } catch (_) {}
      return false;
    }
  }

  // Helper for opt-totals translation. "5 rooms" → 5; "145.55 m²" → 145.55;
  // numbers pass through; non-numeric strings pass through as-is.
  function _parseNumOrStr(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v);
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : s;
  }

  // v1.30.0 — extracted plan-canvas-page emit logic so fullDocument()
  // can re-use it without spawning a separate PDF. Emits the canvas
  // snapshot + inset legend/summary + scale bar + footer onto the
  // CURRENT page of the given PDF. Returns nothing — caller handles
  // page management (addPage before this if needed).
  function _emitPlanPageIntoPdf(pdf, opts, baseMeta) {
    const meta = baseMeta || collectProjectMeta();
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const title = opts.title || 'FULL PLAN';
    const dataUrl = opts.dataUrl;  // pre-captured canvas PNG data URL
    const cw = opts.canvasW || 1;
    const ch = opts.canvasH || 1;

    paintHeader(pdf, { title, subtitle: opts.subtitle, aspect: opts.aspect || 'plan', meta });
    // v2.0.0 — drawing reference code stamp top-right of slate header
    if (opts.pageCode) paintHeaderDrawingCode(pdf, meta, opts.pageCode);

    // v2.0.0 — page-type aware geometry. When useTitleBlock is on, reserve
    // the bottom-right block area; when withNotesColumn is on, reserve a
    // strip on the right edge for the ruled NOTES column. Both default OFF
    // so legacy callers stay pixel-identical to v1.99.1.
    const useTitleBlock = opts.useTitleBlock === true;
    // v2.6.2 — Bryn directive 2026-04-29: "shrink the notes section in pdf
    // export underneath the legend so there is just 1x info column". NOTES
    // now lives INSIDE the inset column (LEGEND → FLOOR TOTALS → NOTES
    // stacked) instead of as a separate right-edge strip. Plan canvas area
    // expands to take up the freed width. `withNotesColumn` becomes
    // `withNotes` semantically — the column structure changes, not the
    // intent (drawing pages get notes, schedule pages don't).
    const withNotesColumn = opts.withNotesColumn === true;
    const planTop = 50;
    const planBottom = useTitleBlock ? pageH - 144 : pageH - 90;
    const planLeft = 24;
    let planRight = pageW - 24;

    // v2.6.2 — Notes column REMOVED as a separate right-edge strip. Plan
    // canvas now uses the full freed width (was reserving 152pt for the
    // legacy NOTES strip). NOTES will be drawn below FLOOR TOTALS in the
    // inset column instead.
    const planAvailW = planRight - planLeft;
    const planAvailH = planBottom - planTop;

    const hasInset = Array.isArray(opts.legend) || Array.isArray(opts.summary) || withNotesColumn;
    const insetW   = hasInset ? 200 : 0;
    const planW    = planAvailW - (hasInset ? insetW + 16 : 0);
    const planH    = planAvailH;

    const ratio = Math.min(planW / cw, planH / ch);
    const drawW = cw * ratio;
    const drawH = ch * ratio;
    const imgX  = planLeft + (planW - drawW) / 2;
    const imgY  = planTop  + (planH - drawH) / 2;

    // v5.2.0 — Polished plan canvas frame (architectural drawing convention).
    // Was: single 0.4pt hairline rect at (imgX-2, imgY-2). Now: double-stroke
    // border (1.0pt outer slate + 0.3pt inner light grey) + small corner
    // registration crosses at all four corners, like proper CAD drawings.
    // Reads as a finished deliverable, not a screenshot dropped on a page.
    {
      const pad = 4;
      const fx = imgX - pad;
      const fy = imgY - pad;
      const fw = drawW + pad * 2;
      const fh = drawH + pad * 2;
      // Outer slate frame (1.0pt)
      _setStroke(pdf, COLOURS.borderHard);
      pdf.setLineWidth(1.0);
      pdf.rect(fx, fy, fw, fh);
      // Inner hairline (0.3pt) — 2pt inset, lighter grey
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.3);
      pdf.rect(fx + 2, fy + 2, fw - 4, fh - 4);
      // Corner registration crosses (architectural convention) — 6pt arms
      // protruding INSIDE the frame, slate stroke 0.4pt. Centered on the
      // outer-frame corners.
      _setStroke(pdf, COLOURS.text);
      pdf.setLineWidth(0.4);
      const arm = 6;
      // Top-left
      pdf.line(fx, fy, fx + arm, fy);
      pdf.line(fx, fy, fx, fy + arm);
      // Top-right
      pdf.line(fx + fw - arm, fy, fx + fw, fy);
      pdf.line(fx + fw, fy, fx + fw, fy + arm);
      // Bottom-left
      pdf.line(fx, fy + fh - arm, fx, fy + fh);
      pdf.line(fx, fy + fh, fx + arm, fy + fh);
      // Bottom-right
      pdf.line(fx + fw - arm, fy + fh, fx + fw, fy + fh);
      pdf.line(fx + fw, fy + fh - arm, fx + fw, fy + fh);
    }
    if (dataUrl) {
      // v2.0.0 — vector pipeline shim with raster fallback (compression flags
      // 'FAST' / multiplier 3.0 / quality 0.85 on the raster path mirror
      // v1.99.1 baseline). pdf.svg() is opt-in via localStorage flag — raster
      // remains the default-safe path until per-canvas-variant verification
      // lands. This call is fire-and-forget (await not strictly needed since
      // the raster path is sync, but we keep it as Promise for symmetry).
      try {
        const ret = _emitVectorOrRaster(pdf, { dataUrl, x: imgX, y: imgY, w: drawW, h: drawH });
        // _emitVectorOrRaster returns a Promise when vector path runs; we
        // don't await here because callers (sync emit chain) don't expect it.
        // The vector path is opt-in and gated to async-aware callers via
        // SonorPdf.fullDocumentAsync (future). For default raster path the
        // function returns synchronously after addImage().
        if (ret && typeof ret.then === 'function') {
          // Vector branch — fire-and-forget; jsPDF buffers operations so the
          // page is finalised at save() time. If the vector promise rejects
          // after we move on we've already lost the snapshot frame, which is
          // why the inner try/catch in _emitVectorOrRaster falls back to
          // raster on first throw.
          ret.catch(e => console.warn('[SonorPdf v2.0.0] vector emit rejected:', e));
        }
      } catch (e) {
        const fmt = (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/jpeg') === 0) ? 'JPEG' : 'PNG';
        try { pdf.addImage(dataUrl, fmt, imgX, imgY, drawW, drawH, undefined, 'FAST'); }
        catch (e2) { console.warn('[SonorPdf] plan addImage failed:', e2); }
      }
      // v5.111.0 — diagonal watermark (native fallback parity with the HTML
      // template's .plan-watermark). Light svc-11 red, rotated across the
      // plan area.
      if (opts.watermarkText) {
        try {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(64);
          pdf.setTextColor(238, 170, 175);
          pdf.text(String(opts.watermarkText).toUpperCase(),
            imgX + drawW / 2, imgY + drawH / 2,
            { angle: 24, align: 'center', baseline: 'middle' });
          pdf.setTextColor(0, 0, 0);
        } catch (e3) { console.warn('[SonorPdf] watermark paint failed:', e3); }
      }
    }

    if (hasInset) {
      const insetX = planLeft + planW + 16;
      let insetY = planTop;
      // v5.1.7 — DRAWING KEY at top of inset stack. Compact reference
      // panel (mounting outlines + cable ID format worked example) that
      // installers / sub-contractors need to read every plan page.
      // Canonical Sonor right-panel convention. Skip on slice plans (zoomed view of one
      // service — key would crowd the small canvas) by checking
      // opts.skipDrawingKey.
      if (!opts.skipDrawingKey) {
        const drawnKey = paintDrawingKey(pdf, {
          x: insetX, y: insetY, w: insetW
        });
        insetY += drawnKey + 10;
      }
      if (Array.isArray(opts.legend) && opts.legend.length) {
        const drawn = paintLegend(pdf, {
          x: insetX, y: insetY, w: insetW,
          items: opts.legend
        });
        insetY += drawn + 12;
      }
      let summaryH = 0;
      if (Array.isArray(opts.summary) && opts.summary.length) {
        summaryH = paintSummary(pdf, {
          x: insetX, y: insetY, w: insetW,
          accent: ASPECT_ACCENT.plan,
          title: opts.summaryTitle || 'Project totals',
          rows: opts.summary
        }) || 0;
        // paintSummary returns void in some implementations — estimate height
        // when it doesn't (header 18 + row 12 each + bottom pad 4)
        if (!summaryH) summaryH = 18 + (opts.summary.length * 12) + 4;
        insetY += summaryH + 12;
      }
      // v2.6.2 — NOTES section stacked below LEGEND + FLOOR TOTALS in the
      // SAME inset column (was a separate right-edge strip). Bryn directive
      // 2026-04-29: "shrink the notes section in pdf export underneath the
      // legend so there is just 1x info column". Drawing pages only.
      if (withNotesColumn) {
        _paintNotesColumn(pdf, {
          top: insetY,
          bottom: planBottom,
          x: insetX,
          w: insetW
        });
      }
    }

    paintScaleBar(pdf, {
      x: planLeft + 8,
      y: planBottom - 6,
      meta,
      metres: 5
    });

    // v5.3.3 — North arrow next to the scale bar (architectural drawing
    // convention). Sits at the right end of the scale bar so the bottom-
    // left corner of the plan area shows a wayfinding badge: scale ruler
    // → north compass.
    paintNorthArrow(pdf, {
      x: planLeft + 8 + 90 + 28 + 90,  // past scale bar + tick labels
      y: planBottom - 6
    });

    // ---- v5.4.1 — ILLUSTRATION-ONLY disclaimer stripe ----
    // Architectural-drawing convention every Sonor reference plan carries:
    // a small red stripe just inside the plan canvas reminding the
    // installer not to scale from the drawing. Pre-v5.4.1 the disclaimer
    // only existed in the title-block disclaimer column (subtle); now it
    // sits ON the plan canvas where it can't be missed. Renders in the
    // top-right area of the plan canvas (above the inset column on plan
    // pages with inset, or top-right corner on inset-less pages).
    if (opts.suppressIllustrationOnly !== true) {
      // v5.4.23/v5.4.24 — Truncation fix v2. The v5.4.23 fix used
      // pdf.getTextWidth to size the candidate selection — but
      // getTextWidth IGNORES charSpace, so a text rendered with
      // charSpace 0.6pt was 30-40pt wider than measured. The picked
      // candidate (longest fit) overflowed the rect and the centred
      // text got clipped symmetrically (lost "ALL " prefix + "ITE"
      // suffix). v5.4.24: drop charSpace entirely so getTextWidth is
      // accurate, AND add a 24pt safety margin to the rect width. Pick
      // the LONGEST candidate that fits in maxStripeW.
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(7);
      const candidates = [
        'ALL POSITIONS FOR ILLUSTRATION ONLY  ·  TO BE CONFIRMED ON-SITE',
        'POSITIONS FOR ILLUSTRATION ONLY  ·  TBC ON-SITE',
        'ILLUSTRATION ONLY  ·  TBC ON-SITE',
        'ILLUSTRATION ONLY'
      ];
      const maxStripeW = drawW - 12;
      let discText = candidates[candidates.length - 1];
      for (const c of candidates) {
        // 24pt safety margin (was 16pt) — accommodates fontmetric
        // jitter + the previous charSpace miscalc legacy.
        if (pdf.getTextWidth(c) + 24 <= maxStripeW) { discText = c; break; }
      }
      const discW = pdf.getTextWidth(discText) + 24;
      const discH = 12;
      const discX = imgX + drawW - discW - 6;
      const discY = imgY + 6;
      _setFill(pdf, COLOURS.danger);
      pdf.roundedRect(discX, discY, discW, discH, 1.5, 1.5, 'F');
      _setText(pdf, '#FFFFFF');
      // v5.4.24 — charSpace removed (was 0.6) so rendered width matches
      // pdf.getTextWidth measurement → no symmetric clipping.
      pdf.text(discText, discX + discW / 2, discY + 8.5, { align: 'center' });
    }

    // ---- v5.4.10 — 4K VIDEO DISTRIBUTION ZONES list block ----
    // Sonor canonical pattern from Oak Bank Media Lighting RevA5/A10:
    // top-centre numbered list naming every room flagged as a video
    // zone so the installer can sight-check the matrix wiring scope at
    // a glance. Renders as a small bordered panel anchored top-centre
    // of the plan canvas, just inside the disclaimer stripe row. Skips
    // when there are no video zones (zero rooms tagged) so empty
    // projects don't get a stub. Suppressible via opts.suppress4KZones
    // for slice plans where the list would crowd the canvas.
    if (opts.suppress4KZones !== true && Array.isArray(meta.videoZones) && meta.videoZones.length) {
      const zones = meta.videoZones;
      const zoneFont = 7;
      const headFont = 7.5;
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(zoneFont);
      // Pre-compute panel width based on widest "N) Room (· Floor)" string
      const lines = zones.map((z, i) => {
        const order = (i + 1) + ') ';
        const tail = z.floor ? ('  ·  ' + z.floor) : '';
        return order + (z.room || '—') + tail;
      });
      const widestLine = Math.max(60, ...lines.map(s => pdf.getTextWidth(s)));
      const panelW = Math.min(220, widestLine + 16);
      const headTxt = '4K VIDEO DISTRIBUTION ZONES';
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(headFont);
      const headW = pdf.getTextWidth(headTxt) + 16;
      const fW = Math.max(panelW, headW);
      const panelX = imgX + 12;   // anchored to plan-canvas left, just inside the frame
      const panelY = imgY + 22;   // below disclaimer stripe + a little gap
      const panelH = 16 + zones.length * 9 + 6;
      // Card backdrop
      _setFill(pdf, '#FFFFFF');
      _setStroke(pdf, COLOURS.border);
      pdf.setLineWidth(0.4);
      pdf.roundedRect(panelX, panelY, fW, panelH, 1.5, 1.5, 'FD');
      // Header (slate band)
      _setFill(pdf, COLOURS.bar);
      pdf.roundedRect(panelX, panelY, fW, 14, 1.5, 1.5, 'F');
      _setFill(pdf, COLOURS.bar);
      pdf.rect(panelX, panelY + 7, fW, 7, 'F');  // square-bottom corners
      _setText(pdf, '#FFFFFF');
      pdf.setFont(_pdfFontFamily(), 'bold');
      pdf.setFontSize(headFont);
      pdf.text(headTxt, panelX + fW / 2, panelY + 10, { align: 'center', charSpace: 0.6 });
      // Rows
      pdf.setFont(_pdfFontFamily(), 'normal');
      pdf.setFontSize(zoneFont);
      _setText(pdf, COLOURS.text);
      let zy = panelY + 22;
      lines.forEach(line => {
        pdf.text(line, panelX + 8, zy);
        zy += 9;
      });
      _setText(pdf, COLOURS.text);
    }

    // ---- v5.4.12 — LED COLOUR SPECIFICATION side panel ----
    // Sonor canonical pattern from Oak Bank Media Lighting RevA10 left-
    // side "LED COLOUR SPECIFICATION" callout block. Lists per-colour-
    // mode categories (RGBW / RGB / WW / W / ARCH) with the run ID +
    // room of each LED in that category. Anchored to the BOTTOM-LEFT
    // of the plan canvas so it doesn't fight the 4K zones / floor
    // watermark in the top half. Compact 6.5pt body with bold
    // category headings; rendered only when at least one category has
    // runs. Suppressible via opts.suppressLedColourSpec.
    if (opts.suppressLedColourSpec !== true && meta.ledColourSpec) {
      const groups = [
        { key: 'RGBW', label: 'RGB + WARM WHITE',     accent: '#e67eb1' },
        { key: 'RGB',  label: 'RGB COLOUR CHANGE',    accent: '#8058a1' },
        { key: 'WW',   label: 'WARM WHITE',           accent: '#f5d05c' },
        { key: 'W',    label: 'COOL WHITE',           accent: '#b7b1a7' },
        { key: 'ARCH', label: 'ARCHITECTURAL / COVE', accent: '#e37c59' }
      ];
      const populated = groups.filter(g => Array.isArray(meta.ledColourSpec[g.key]) && meta.ledColourSpec[g.key].length);
      if (populated.length) {
        // Pre-compute panel size
        const headFont = 7.5;
        const subFont  = 7;
        const itemFont = 6.5;
        const panelW = 200;
        let lineCount = 0;
        populated.forEach(g => {
          lineCount += 1;  // sub-heading
          lineCount += Math.min(meta.ledColourSpec[g.key].length, 6);  // items (cap 6)
          if (meta.ledColourSpec[g.key].length > 6) lineCount += 1;  // "(N more)" row
        });
        const panelH = 18 + lineCount * 8 + 6 + (populated.length - 1) * 4;
        const panelX = imgX + 12;
        const panelY = imgY + drawH - panelH - 12;
        // Card backdrop
        _setFill(pdf, '#FFFFFF');
        _setStroke(pdf, COLOURS.border);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(panelX, panelY, panelW, panelH, 1.5, 1.5, 'FD');
        // Header band
        _setFill(pdf, COLOURS.bar);
        pdf.rect(panelX, panelY, panelW, 14, 'F');
        _setText(pdf, '#FFFFFF');
        pdf.setFont(_pdfFontFamily(), 'bold');
        pdf.setFontSize(headFont);
        pdf.text('LED COLOUR SPECIFICATION', panelX + panelW / 2, panelY + 10, { align: 'center', charSpace: 0.6 });
        // Body — each group in turn
        let ly = panelY + 22;
        populated.forEach((g, gi) => {
          // Group sub-heading with accent dot
          _setFill(pdf, g.accent);
          pdf.circle(panelX + 8, ly - 2, 2.5, 'F');
          pdf.setFont(_pdfFontFamily(), 'bold');
          pdf.setFontSize(subFont);
          _setText(pdf, COLOURS.text);
          pdf.text(g.label, panelX + 14, ly);
          ly += 8;
          // Items (cap 6 per group, ellipsis after)
          const items = meta.ledColourSpec[g.key];
          const cap = Math.min(items.length, 6);
          pdf.setFont(_pdfFontFamily(), 'normal');
          pdf.setFontSize(itemFont);
          _setText(pdf, COLOURS.text2);
          for (let i = 0; i < cap; i++) {
            const it = items[i];
            const txt = '· ' + (it.label || '—');
            pdf.text(_truncate(pdf, txt, panelW - 22), panelX + 14, ly);
            ly += 8;
          }
          if (items.length > cap) {
            pdf.setFont(_pdfFontFamily(), 'italic');
            _setText(pdf, COLOURS.muted);
            pdf.text('· (' + (items.length - cap) + ' more)', panelX + 14, ly);
            pdf.setFont(_pdfFontFamily(), 'normal');
            _setText(pdf, COLOURS.text2);
            ly += 8;
          }
          if (gi < populated.length - 1) ly += 4;  // gap between groups
        });
        _setText(pdf, COLOURS.text);
      }
    }

    // ---- v5.4.2 — Big light-grey floor watermark (Sonor canonical) ----
    // Every Sonor reference plan (Oak Bank Media Lighting RevA5/A10, Caldy
    // Takeoff 000) carries a giant pale-grey floor name in the top-right
    // of the plan canvas — wayfinding for a stack of multi-floor plans
    // when reviewed in print. Renders BELOW the disclaimer stripe, anchored
    // to the right edge, in 32pt light-grey display weight. Multi-word
    // floor names ("Ground Floor", "First Floor") wrap naturally.
    //
    // v5.5.78 — Bryn directive 2026-05-21: "the large floor name can go,
    // hide it at least, we might reinstate at some point". The watermark
    // is now HIDDEN BY DEFAULT — code preserved verbatim, gate inverted.
    // Opt back in via opts.showFloorWatermark === true (replaces the
    // legacy opts.suppressFloorWatermark gate, which still works
    // negatively for any caller passing it to suppress on a per-page
    // basis — keeping the legacy behaviour means existing slice-plan
    // suppressions don't accidentally re-enable the watermark).
    if (opts.showFloorWatermark === true && opts.suppressFloorWatermark !== true && meta.floor) {
      const fwTop = imgY + 22;        // below disclaimer stripe (imgY+6 + 12 + gap)
      const fwRight = imgX + drawW - 10;
      const words = String(meta.floor).toUpperCase().trim().split(/\s+/);
      pdf.setFont(_pdfFontFamily(), 'bold');
      // Choose size relative to plan width so wide A3 landscape gets a big
      // statement and narrow plans don't get a watermark that overruns.
      const fwSize = Math.max(20, Math.min(40, drawW * 0.05));
      pdf.setFontSize(fwSize);
      _setText(pdf, COLOURS.muted);
      const lh = fwSize * 1.02;
      let y = fwTop + fwSize * 0.85;   // baseline of first line
      // If single word OR title is short enough at this size, render single line.
      const fullText = words.join(' ');
      const fullW = pdf.getTextWidth(fullText);
      const maxW = drawW * 0.55;
      if (words.length === 1 || fullW <= maxW) {
        pdf.text(fullText, fwRight, y, { align: 'right' });
      } else {
        // Stack each word on its own line — Sonor convention from Oak Bank.
        words.forEach((w, i) => {
          pdf.text(w, fwRight, y + i * lh, { align: 'right' });
        });
      }
      _setText(pdf, COLOURS.text);  // restore default text colour
    }

    // v2.0.0 — page-type-differentiated footer:
    //   useTitleBlock=true  → architectural title block (drawing pages)
    //   default             → standard 5-column Caldy footer (back-compat)
    if (useTitleBlock) {
      _paintTitleBlock(pdf, {
        meta,
        pageNum: opts.pageNum || 1,
        pageTotal: opts.pageTotal || null,
        pageCode: opts.pageCode || 'PAG'
      });
    } else {
      paintFooter(pdf, {
        meta,
        pageNum: opts.pageNum || 1,
        pageTotal: opts.pageTotal || null
      });
    }
  }

  // v1.30.0 / v1.41.0 — capture the active canvas as a PNG data URL.
  // v1.41.0: crop to content bounds rather than the full canvas. Bryn
  // report: PDF plan pages had lots of empty whitespace around the
  // floorplan because canvas.toDataURL() captures the full canvas
  // including blank grid area outside the loaded plan. Solution: walk
  // every renderable object (plan, symbols, rooms, cables, LEDs, shades,
  // TVs, labels), build a union bounding box in absolute canvas coords,
  // pad slightly, and crop the snapshot to that. The PDF emitter then
  // scales-to-fit a much tighter rectangle → plan fills the page area.
  // v1.46.0 — Combined-plans snapshot. Hides CCTV view cones for the
  // duration of the capture so the all-symbols overview doesn't double
  // up the security service in gold (cameras themselves stay visible).
  // The cone overlay belongs on the dedicated CCTV plan page only.
  function _snapshotCanvasNoCctvCones() {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    if (typeof _coneRebuildRaf !== 'undefined' && _coneRebuildRaf != null) {
      try { cancelAnimationFrame(_coneRebuildRaf); } catch (e) {}
      _coneRebuildRaf = null; _coneRebuildTarget = null;
    }
    // v1.63.0 — Bryn report: cones still showing on non-CCTV exports.
    // Visibility-only stash isn't always enough (render-timing races, the
    // v1.62 module's attachCamera could re-fire). Aggressive strip:
    // physically REMOVE every cone from the canvas for the snapshot
    // window, then re-attach via SonorCctv.resyncAll() in finally.
    // The owner camera Groups stay in place; only the cone Paths come
    // off and back. resyncAll() rebuilds them fresh from sym.viewCone.
    const stash = [];
    // v5.172.0 (Bryn: "dont show circuit links on combined plans") — LC/LKP
    // circuit curves + id tags belong on the LIGHTING/LKP plans only; on the
    // combined snapshot they are visibility-stashed for the capture window.
    const _lcStash = [];
    canvas.getObjects().slice().forEach(o => {
      if (!o) return;
      if (o._sonorViewCone === true) {
        stash.push({ owner: o._sonorViewConeOwner });
        try { canvas.remove(o); } catch (e) {}
        if (o._sonorViewConeOwner) o._sonorViewConeOwner._sonorViewCone = null;
      }
      if (o._sonorCircuitLink === true && o.visible !== false) {
        _lcStash.push(o);
        o.visible = false;
      }
    });
    canvas.renderAll();
    let snap = null;
    // v1.94.0 — pass skipConeResync so _snapshotCanvas doesn't rebuild
    // the cones we just stripped (root cause of the v1.63 cone-leak
    // regression Bryn re-flagged).
    try { snap = _snapshotCanvas({ skipConeResync: true }); }
    finally {
      // Re-attach via the module so cones come back at the correct
      // bearing + z-order. Falls back to legacy _resyncAllViewCones for
      // older non-modular sessions.
      try { _lcStash.forEach(o => { o.visible = true; }); } catch (_) {}   // v5.172.0 — circuit links back on-screen
      try {
        if (typeof SonorCctv !== 'undefined' && SonorCctv.resyncAll) SonorCctv.resyncAll();
        else if (typeof _resyncAllViewCones === 'function') _resyncAllViewCones();
      } catch (e) { /* never block on cone restore */ }
      canvas.requestRenderAll();
    }
    return snap;
  }

  // v1.46.0 — Service-only snapshot. Filters canvas to a single service
  // NN (e.g. '11' Electrical, '08' Security cameras+cones) so a sub-
  // contractor handover plan shows only the work in their scope. The
  // plan image stays visible; rooms / non-target services / non-target
  // measurements / labels for other services hidden. Cables + LEDs
  // intentionally INCLUDED for the target service so the electrician
  // sees lighting circuits / power runs that belong to their package.
  // v5.70.0 — SPECIAL SERVICE-PLAN REGISTRY: the ONE list that drives both
  // the page-count estimator and the fullDocument emit loop (they can
  // never disagree). SERVICE-NUMBER order. Each entry: ticklist key,
  // service nn, page code, titles, device predicate (works on both live
  // sonorSymbol objects and collectTakeoffAllFloors records), snapshot fn.
  // v5.84.0 — EXPORT LAYER BOOST (Bryn: "cctv views are not visible on the
  // cctv coverage, the layer should be enabled just for this and any other
  // exports that involve hidden layers — only enabled on the export, not in
  // general"). Forces the layers a special plan NEEDS visible/rebuilt around
  // its snapshot, then restores the user's app state exactly.
  function _withExportLayerBoost(planKey, fn) {
    const w = (typeof window !== 'undefined') ? window : {};
    const prevCones = w._cctvViewsHidden;
    const prevLc = w._lcLinksVisible, prevLkp = w._lkpLinksVisible, prevDmx = w._dmxLinksVisible;   // v2.7.0
    let boosted = false;
    try {
      if (planKey === 'cctv' && prevCones === true) {
        w._cctvViewsHidden = false;
        try { if (typeof _resyncAllViewCones === 'function') _resyncAllViewCones(); } catch (_) {}
        boosted = true;
      }
      if (planKey === 'lightingplan' && w._lcLinksVisible === false) {
        w._lcLinksVisible = true;
        try { if (typeof w._resolveCircuitLinks === 'function') w._resolveCircuitLinks(); } catch (_) {}
        boosted = true;
      }
      if (planKey === 'lkpplan' && w._lkpLinksVisible === false) {
        w._lkpLinksVisible = true;
        try { if (typeof w._resolveCircuitLinks === 'function') w._resolveCircuitLinks(); } catch (_) {}
        boosted = true;
      }
      if (planKey === 'dmxplan' && w._dmxLinksVisible === false) {   // v2.7.0
        w._dmxLinksVisible = true;
        try { if (typeof w._resolveCircuitLinks === 'function') w._resolveCircuitLinks(); } catch (_) {}
        boosted = true;
      }
      return fn();
    } finally {
      if (boosted) {
        w._cctvViewsHidden = prevCones;
        w._lcLinksVisible = prevLc;
        w._lkpLinksVisible = prevLkp;
        w._dmxLinksVisible = prevDmx;   // v2.7.0
        try { if (planKey === 'cctv' && typeof _resyncAllViewCones === 'function') _resyncAllViewCones(); } catch (_) {}
        try { if ((planKey === 'lightingplan' || planKey === 'lkpplan' || planKey === 'dmxplan') && typeof w._resolveCircuitLinks === 'function') w._resolveCircuitLinks(); } catch (_) {}
      }
    }
  }

  // ---- v5.87.0 — EXTERNALS geometry helpers ----
  // Local ray-cast (the host's pointInPolygon global isn't guaranteed in
  // this module's scope). pts = [{x,y}...], pt = {x,y}.
  function _pipPdf(pt, pts) {
    if (!pt || !Array.isArray(pts) || pts.length < 3) return false;
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) &&
          (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins;
    }
    return ins;
  }
  // Floor-record geometry (works from SAVED payloads so the registry's
  // has() predicates can classify symbols on every floor without switching).
  function _extGeomForFloorName(fname) {
    try {
      const fl = (typeof floors !== 'undefined' && Array.isArray(floors))
        ? floors.find(f => f && (f.name || '') === String(fname || '')) : null;
      if (!fl) return null;
      const bo = Array.isArray(fl.buildingOutline) && fl.buildingOutline[0];
      const outline = (bo && Array.isArray(bo.points) && bo.points.length > 2) ? bo.points : null;
      const extRooms = (Array.isArray(fl.areas) ? fl.areas : [])
        .filter(a => a && a.external === true && Array.isArray(a.points) && a.points.length > 2)
        .map(a => a.points);
      return { outline, extRooms };
    } catch (_) { return null; }
  }
  // External = inside an external-flagged room (courtyards), OR outside the
  // building outline. No outline + no ext rooms → nothing counts external.
  function _savedSymbolIsExternal(sym) {
    if (!sym || typeof sym.x !== 'number' || typeof sym.y !== 'number') return false;
    const g = _extGeomForFloorName(sym.floor);
    if (!g) return false;
    const pt = { x: sym.x, y: sym.y };
    for (let i = 0; i < g.extRooms.length; i++) { if (_pipPdf(pt, g.extRooms[i])) return true; }
    if (g.outline) return !_pipPdf(pt, g.outline);
    return false;
  }

  // ---- v5.87.0 — PER-SERVICE EXTERNALS snapshot ----
  // Plan dimmed to 25% (same reference treatment as the External Areas
  // plan), building outline + external rooms visible, ONLY the service's
  // EXTERNAL placements (+ sibling labels, + owned cones for CCTV) at
  // full strength. Returns null when the service has no external
  // placements on the ACTIVE floor.
  function _snapshotCanvasSvcExternals(svcNn, svcKey) {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    let outline = null;
    try {
      const af = (typeof _activeFloor === 'function') ? _activeFloor()
        : ((typeof floors !== 'undefined' && Array.isArray(floors) && typeof activeFloorId !== 'undefined')
            ? floors.find(x => x && x.id === activeFloorId) : null);
      const bo = af && Array.isArray(af.buildingOutline) && af.buildingOutline[0];
      if (bo && Array.isArray(bo.points) && bo.points.length > 2) outline = bo.points;
    } catch (_) {}
    const extRoomObjs = canvas.getObjects().filter(o =>
      o && o.sonorMeasure && o.sonorMeasure.kind === 'area' && o.sonorMeasure.external === true
      && Array.isArray(o.sonorMeasure.points) && o.sonorMeasure.points.length > 2);
    if (!outline && !extRoomObjs.length) return null;
    const isExtPoint = (pt) => {
      for (let i = 0; i < extRoomObjs.length; i++) {
        if (_pipPdf(pt, extRoomObjs[i].sonorMeasure.points)) return true;
      }
      if (outline) return !_pipPdf(pt, outline);
      return false;
    };
    const keptSymbols = new Set();
    const keptLabels = new Set();
    canvas.getObjects().forEach(o => {
      if (!o || !o.sonorSymbol) return;
      const sym = o.sonorSymbol;
      const mSvc = (sym.service === svcKey || sym.service_nn === svcNn
                 || sym.service === svcNn || sym.service_nn === svcKey);
      if (!mSvc) return;
      const c = (o.getCenterPoint && o.getCenterPoint()) || { x: o.left || 0, y: o.top || 0 };
      if (!isExtPoint(c)) return;
      keptSymbols.add(o);
      if (o._sonorLabel) keptLabels.add(o._sonorLabel);
    });
    if (!keptSymbols.size) return null;
    extRoomObjs.forEach(r => { if (r._sonorLabel) keptLabels.add(r._sonorLabel); });
    const stash = [];
    const planDim = [];
    canvas.getObjects().forEach(o => {
      if (!o) return;
      stash.push({ o, visible: o.visible });
      if (o.sonorPlan === true) {
        planDim.push({ o, opacity: o.opacity });
        o.opacity = 0.25;
        return;
      }
      if (o.sonorBuildingOutline) { o.visible = true; return; }
      const isExtRoom = extRoomObjs.indexOf(o) !== -1;
      const isKeptCone = (svcNn === '08' && o._sonorViewCone === true
        && o._sonorViewConeOwner && keptSymbols.has(o._sonorViewConeOwner));
      o.visible = isExtRoom || keptSymbols.has(o) || keptLabels.has(o) || isKeptCone;
    });
    canvas.renderAll();
    let snap = null;
    try { snap = _snapshotCanvas({ skipConeResync: true }); }
    finally {
      stash.forEach(sv => { if (sv.o) sv.o.visible = sv.visible; });
      planDim.forEach(pd => { if (pd.o) pd.o.opacity = pd.opacity; });
      canvas.requestRenderAll();
    }
    return snap;
  }

  // ---- v5.87.0 — PER-SERVICE PAGE INSETS ----
  // (Bryn: "the floor totals per service are wrong though, should be
  // replaced with similar to combined legend plus any other relevant short
  // data per service"). Legend = THE SAME shared builder the combined pages
  // use (_legendRowsFromSymbols, reports module) filtered to the page's
  // symbols on the ACTIVE floor; totals = service-scoped short data
  // (blocks + this service's cable/LED metres on this floor) — never the
  // whole-floor rollup again. matchSym receives (sonorSymbol, fabricObj).
  function _svcInsetsForActiveFloor(matchSym, svcNn) {
    const out = { legend: null, totals: { blocks: 0 }, summary: null };
    try {
      if (typeof canvas === 'undefined' || !canvas) return out;
      const syms = [];
      canvas.getObjects().forEach(o => {
        if (o && o.sonorSymbol && matchSym(o.sonorSymbol, o)) syms.push(o.sonorSymbol);
      });
      out.totals.blocks = syms.length;
      if (typeof _legendRowsFromSymbols === 'function' && syms.length) {
        const rows = _legendRowsFromSymbols(syms);
        if (Array.isArray(rows) && rows.length) out.legend = rows;
      }
      // Cable/LED metres owned by this service on THIS floor (map exposed
      // by the host layers module; local mirror as fallback).
      const CAB_NN = (typeof window !== 'undefined' && window._cableServiceNn) || {
        cat6d: '09', cat6p: '09', sp2: '02', sp4: '02', hdmi: '03',
        coax: '03', ctrl: '07', lkp: '04', alarm: '08', fibre: '10'
      };
      let cabM = 0, ledM = 0;
      canvas.getObjects().forEach(o => {
        if (!o || !o.sonorMeasure) return;
        const m = o.sonorMeasure;
        if (m.kind === 'length' && CAB_NN[m.cableId] === svcNn) cabM += (Number(m.metres) || 0);
        if (m.kind === 'led' && svcNn === '04') ledM += (Number(m.metres) || 0);
      });
      if (cabM > 0) out.totals.cableM = Math.round(cabM * 10) / 10;
      if (ledM > 0) out.totals.ledM = Math.round(ledM * 10) / 10;
      const s = [['Blocks', String(syms.length)]];
      if (out.totals.cableM != null) s.push(['Cable', out.totals.cableM + ' m']);
      if (out.totals.ledM != null) s.push(['LED', out.totals.ledM + ' m']);
      out.summary = s;
    } catch (_) { /* insets are best-effort — never block the page */ }
    return out;
  }

  function _specialPlanRegistry() {
    const base = [
      { key: 'lightingplan', svcNn: '04', code: 'LTG',
        title: 'LIGHTING PLAN',
        subtitle: 'Luminaires, lighting panels + circuit chains (LC links)',
        scopeLabel: 'LIGHTING SCOPE',
        has: (sym) => !!(window._isLuminaire && window._isLuminaire(sym)),
        snap: () => _snapshotCanvasByService('04', 'lighting') },
      { key: 'lkpplan', svcNn: '04', code: 'LKP',
        title: 'LKP PLAN',
        subtitle: 'Wired keypads, lighting panels + bus loops (LKP links)',
        scopeLabel: 'KEYPAD BUS SCOPE',
        has: (sym) => !!(window._isWiredKeypad && window._isWiredKeypad(sym)),
        snap: () => _snapshotCanvasByService('04', 'lkp') },
      { key: 'dmxplan', svcNn: '04', code: 'DMX',   // v2.7.0 (Takeoffs 5.257.0) — remote DMX driver loop
        title: 'DMX PLAN',
        subtitle: 'Remote DMX drivers, DMX interface + floor DMX loop (data daisy chain from the interface and back)',
        scopeLabel: 'DMX LOOP SCOPE',
        has: (sym) => !!(window._isDmxDriver && window._isDmxDriver(sym)),
        snap: () => _snapshotCanvasByService('04', 'dmx') },
      { key: 'cctv', svcNn: '08', code: 'CCT',
        title: 'CCTV COVERAGE PLAN',
        subtitle: 'Cameras + field-of-view coverage',
        scopeLabel: 'CCTV COVERAGE',
        has: (sym) => !!(typeof _isCameraBlock === 'function' && _isCameraBlock(sym)),
        snap: () => _snapshotCanvasCctvOnly() },
      { key: 'wifiheatmap', svcNn: '09', code: 'WIFI',
        // v5.80.0 — Ekahau-style predictive coverage (multi-wall model, host
        // engine in sonor-takeoffs.html). Gated on WAP blocks being placed.
        // v5.87.0 — INDOOR ONLY (Bryn: "external waps should not bleed in to
        // internal"); outdoor APs get their own EXTERNALS page below.
        title: 'WIFI COVERAGE HEATMAP',
        subtitle: 'Predicted 5 GHz coverage — multi-wall model (walls attenuate signal)',
        scopeLabel: 'WIFI COVERAGE',
        legend: () => (window._wifiLegendRows ? window._wifiLegendRows() : null),
        has: (sym) => !!(window._isWapSymbol && window._isWapSymbol(sym))
          && !(window._isOutdoorWapSymbol && window._isOutdoorWapSymbol(sym)),
        snap: () => (window._sonorWifiHeatmapSnapshot ? window._sonorWifiHeatmapSnapshot({ mode: 'indoor' }) : null) },
      { key: 'wifiheatmapext', sec: 'wifiheatmap', svcNn: '09', code: 'WFX',
        // v5.87.0 — OUTDOOR APs only: coverage outside the building, main
        // plan dimmed to 25% (rides the WiFi heatmap ticklist key).
        title: 'WIFI COVERAGE — EXTERNALS',
        subtitle: 'Outdoor access points — external coverage only, building dimmed for reference',
        scopeLabel: 'WIFI EXTERNALS',
        legend: () => (window._wifiLegendRows ? window._wifiLegendRows() : null),
        has: (sym) => !!(window._isOutdoorWapSymbol && window._isOutdoorWapSymbol(sym)),
        snap: () => (window._sonorWifiHeatmapSnapshot ? window._sonorWifiHeatmapSnapshot({ mode: 'outdoor' }) : null) },
      { key: 'electrical', svcNn: '11', code: 'ELE',
        title: 'ELECTRICAL PLAN',
        // v5.70.0 — gate + scope = service 11 ONLY (lighting has its own plans)
        subtitle: 'Sub-contractor handover — electrical scope (service 11)',
        scopeLabel: 'ELECTRICAL SCOPE',
        has: (sym) => !!(sym && sym.service_nn === '11'),
        snap: () => _snapshotCanvasByService('11') }
    ];
    // v5.87.0 — PER-SERVICE EXTERNALS pages (Bryn: "a fourth page / plan for
    // externals which shows the main building greyed out, this should be for
    // each service that has externals"). One registry entry per service —
    // the shared registry mechanics give us the estimator count, ticklist
    // gate (shared 'externalsvc' sec key), per-floor device presence and
    // service-order interleave FOR FREE. External = saved symbol whose x/y
    // sits outside the floor's building outline, or inside an external room.
    const list = [];
    const svcs = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) ? SERVICES : [];
    ['01','02','03','04','05','06','07','08','09','10','11'].forEach(nn => {
      base.forEach(p => { if (String(p.svcNn) === nn && p.key !== 'wifiheatmapext') list.push(p); });
      const svc = svcs.find(s => s && s.nn === nn);
      if (svc) {
        list.push({
          key: 'extsvc' + nn, sec: 'externalsvc', svcNn: nn, code: 'EXT',
          title: nn + ' ' + String(svc.name || svc.key).toUpperCase() + ' — EXTERNALS',
          subtitle: 'External placements only — main building dimmed to 25% for reference',
          scopeLabel: 'EXTERNALS',
          has: (sym) => {
            if (!sym) return false;
            const mSvc = (sym.service === svc.key || sym.service_nn === nn
                       || sym.service === nn || sym.service_nn === svc.key);
            return mSvc && _savedSymbolIsExternal(sym);
          },
          snap: () => _snapshotCanvasSvcExternals(nn, svc.key)
        });
      }
      // WiFi externals heatmap follows the network externals block page
      base.forEach(p => { if (String(p.svcNn) === nn && p.key === 'wifiheatmapext') list.push(p); });
    });
    return list;
  }

  // v5.71.0 — SHARED floor-presence helpers: the estimator and the emit
  // loops both read THESE (never two copies of the same walk again).
  // _specialPlanFloorSet: floor names holding a special plan's devices.
  // _slicesFloorMatrix: {nn: Set(floorNames)} for the per-service slices —
  // slices now SKIP floors without the service (was emitting empty
  // full-floor pages for them).
  function _specialPlanFloorSet(p, allSymbols) {
    const set = new Set();
    (allSymbols || []).forEach(sym => {
      if (sym && sym.floor && p.has(sym)) set.add(sym.floor);
    });
    return set;
  }
  function _slicesFloorMatrix(allSymbols) {
    const matrix = {};
    (allSymbols || []).forEach(sym => {
      if (!sym || !sym.floor) return;
      const svc = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
        ? SERVICES.find(x => x.key === sym.service || x.nn === sym.service_nn) : null;
      if (!svc) return;
      if (!matrix[svc.nn]) matrix[svc.nn] = new Set();
      matrix[svc.nn].add(sym.floor);
    });
    return matrix;
  }

  // v5.69.0 — optional VARIANT filter (Bryn: lighting + LKP plans in the
  // full pack): 'lighting' keeps luminaires + LPNL panels + LC links +
  // LED runs; 'lkp' keeps wired keypads + LPNL panels + LKP bus links.
  // No variant = classic service filter.
  function _snapshotCanvasByService(serviceNn, variant) {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    // v5.144.0 (Bryn: "links arent shown on combined plans, but at least
    // should be shown on individual service plans") — make sure the link
    // overlays exist for THIS floor (floor switches during export rebuild
    // placements; the overlay refresh can lag the capture).
    try { if (typeof window !== 'undefined' && typeof window._resolvePairLinks === 'function') window._resolvePairLinks(); } catch (_) {}
    // v5.102.0 (Bryn: "audio export doesnt show speaker links") — the audio
    // zone topology (aqua dashed MST lines + zone letter chips) is an
    // Audio-Mode overlay that's normally OFF outside the mode. Same export
    // boost philosophy as _withExportLayerBoost (CCTV cones / LC links):
    // rebuild it around the 02 slice snapshot, tear back down after if it
    // wasn't there before.
    // v5.107.0 (Library §15.1 / handover 2026-07-12: spur items belong on
    // the ELECTRICAL plan layer) — the fused-spur 'SP' tags are normally
    // DERIVED children of their shade groups, which are svc-05 objects and
    // therefore hidden on the 11 slice. Synthesise standalone SP badges at
    // each flagged shade's motor-side vertex around the 11-slice snapshot,
    // then remove them. BY OTHERS on schedules is already handled; these
    // stay out of Sonor totals by construction (never placements).
    const _spurBoostObjs = [];
    if (serviceNn === '11' && !variant) {
      try {
        const req = (typeof window !== 'undefined' && typeof window._shadeSpurRequirement === 'function')
          ? window._shadeSpurRequirement : null;
        if (req && typeof fabric !== 'undefined') {
          canvas.getObjects().forEach(o => {
            const sh = o && o.sonorShade;
            if (!sh || !req(sh)) return;
            const pts = Array.isArray(sh.points) && sh.points.length ? sh.points
              : [{ x: sh.x1 || 0, y: sh.y1 || 0 }, { x: sh.x2 || 0, y: sh.y2 || 0 }];
            const ms = String(sh.motorSide || '').toLowerCase();
            let sp = pts[0];
            if (ms === 'left')       { for (const q of pts) if ((q.x || 0) < (sp.x || 0)) sp = q; }
            else if (ms === 'right') { for (const q of pts) if ((q.x || 0) > (sp.x || 0)) sp = q; }
            const box = new fabric.Rect({
              left: 0, top: 0, width: 12, height: 12,
              fill: '#ffffff', stroke: '#e63946', strokeWidth: 1.3,
              originX: 'center', originY: 'center', strokeLineJoin: 'miter', objectCaching: false
            });
            const txt = new fabric.Text('SP', {
              left: 0, top: 0.5, fontSize: 6, fontFamily: 'Helvetica', fontWeight: 'bold',
              fill: '#e63946', originX: 'center', originY: 'center', objectCaching: false
            });
            const badge = new fabric.Group([box, txt], {
              left: sp.x, top: sp.y, originX: 'center', originY: 'center',
              selectable: false, evented: false
            });
            badge._sonorSpurBoost = true;
            canvas.add(badge);
            _spurBoostObjs.push(badge);
          });
          if (_spurBoostObjs.length) console.info('[SonorPdf §15.1] ' + _spurBoostObjs.length + ' fused-spur badge(s) boosted onto the 11 slice.');
        }
      } catch (_) {}
    }
    let _audioTopoBoosted = false;
    if (serviceNn === '02' && !variant) {
      try {
        const hadTopo = canvas.getObjects().some(o => o && o._sonorAudioTopo === true);
        if (typeof window !== 'undefined' && typeof window._renderAudioTopology === 'function') {
          window._renderAudioTopology();
          _audioTopoBoosted = !hadTopo;
        } else if (typeof _renderAudioTopology === 'function') {
          _renderAudioTopology();
          _audioTopoBoosted = !hadTopo;
        }
      } catch (_) {}
    }
    const _matchesSvc = (sym) => {
      if (!sym) return false;
      if (variant === 'override') return false;   // v5.157.0 — watermark-override: NO Sonor blocks on the slice
      if (variant === 'lighting') {
        return (window._isLuminaire && window._isLuminaire(sym))
            || (window._isLpnl && window._isLpnl(sym));
      }
      if (variant === 'lkp') {
        return (window._isWiredKeypad && window._isWiredKeypad(sym))
            || (window._isLpnl && window._isLpnl(sym));
      }
      if (variant === 'dmx') {   // v2.7.0 — DMX drivers + the interface + the LPNL it heads from
        return (window._isDmxDriver && window._isDmxDriver(sym))
            || (window._isDmxInterface && window._isDmxInterface(sym))
            || (window._isLpnl && window._isLpnl(sym));
      }
      return sym.service_nn === serviceNn;
    };
    if (typeof _coneRebuildRaf !== 'undefined' && _coneRebuildRaf != null) {
      try { cancelAnimationFrame(_coneRebuildRaf); } catch (e) {}
      _coneRebuildRaf = null; _coneRebuildTarget = null;
    }
    // v1.63.0 — for non-CCTV (non-08) services, physically REMOVE cones
    // (same defensive pattern as _snapshotCanvasNoCctvCones). For CCTV
    // (NN=08), keep cones (they're the value of the CCTV plan).
    const removedCones = [];
    if (serviceNn !== '08') {
      canvas.getObjects().slice().forEach(o => {
        if (o && o._sonorViewCone === true) {
          removedCones.push({ owner: o._sonorViewConeOwner });
          try { canvas.remove(o); } catch (e) {}
          if (o._sonorViewConeOwner) o._sonorViewConeOwner._sonorViewCone = null;
        }
      });
    }
    // v5.4.24/v5.4.27/v5.4.30 — Pre-compute "active rooms" for the
    // service: rooms that contain at least one target-service symbol.
    // Used to hide non-active rooms so the auto-bbox in _snapshotCanvas
    // tightens to just the service's spatial footprint (e.g. cinema
    // slice zooms to cinema room).
    //
    // v5.4.30 fix: use the canonical findRoomAt(x, y) host helper
    // (rbush-backed, proven correct since v1.47) instead of a manual
    // pointInPolygon. The v5.4.27 manual implementation was failing
    // silently — getCenterPoint() returns canvas-absolute coords but
    // r.sonorMeasure.points may be in a different space depending on
    // the room's draw-time transforms. findRoomAt handles all that
    // correctly and is the same hit-test used by recalc / _autoIdForSymbol.
    const activeRooms = new Set();
    let targetSymsCount = 0;
    try {
      const targetSyms = canvas.getObjects().filter(o =>
        o && o.sonorSymbol && _matchesSvc(o.sonorSymbol));
      targetSymsCount = targetSyms.length;
      targetSyms.forEach(sym => {
        const c = (sym.getCenterPoint && sym.getCenterPoint()) || { x: sym.left || 0, y: sym.top || 0 };
        let hit = null;
        try {
          if (typeof findRoomAt === 'function') hit = findRoomAt(c.x, c.y);
        } catch (_) {}
        if (hit) activeRooms.add(hit);
      });
    } catch (e) { /* fall through — all rooms kept */ }
    // v5.4.27/v5.4.30/v5.4.33 — When no active rooms detected (target
    // symbols on a floor without geometry-defined rooms, e.g. Caldy 1F
    // has 2 Master Dressing/En Suite rooms with 0 area), keep ALL rooms
    // visible AND keep the plan in bbox compute → bbox falls back to
    // the full floor instead of collapsing to a single symbol.
    //
    // v5.4.33 fix: filter degenerate-area rooms (polygon bbox < 80×80 px)
    // out of activeRooms BEFORE computing hasActiveRooms. Pre-v5.4.33,
    // a degenerate room (drawn but empty geometry, or imported with 0
    // area) would still hit findRoomAt and pin the bbox to its near-zero
    // bounds → over-zoomed slice with single symbol filling the page
    // (Caldy v5.4.32 export pages 9, 11). Filtering forces fallback to
    // full-floor render when only degenerate rooms exist.
    const MIN_ROOM_BBOX_PX2 = 80 * 80;
    const meaningfulRooms = new Set();
    activeRooms.forEach(r => {
      try {
        const bb = r.getBoundingRect && r.getBoundingRect(true, true);
        if (bb && (bb.width || 0) * (bb.height || 0) >= MIN_ROOM_BBOX_PX2) {
          meaningfulRooms.add(r);
        }
      } catch (_) { /* skip */ }
    });
    const hasActiveRooms = meaningfulRooms.size > 0;

    // v5.41.1 — block ID labels moved OUT of symbol Groups to output-only
    // siblings in app v5.9.0; the blanket temp:'label' hide below therefore
    // stripped every block ID from service-slice pages (they're the point
    // of a sub-contractor handover). Collect the kept symbols' sibling
    // labels so the visibility rule can keep them.
    const keptSymbolLabels = new Set();
    canvas.getObjects().forEach(o => {
      if (o && o.sonorSymbol && _matchesSvc(o.sonorSymbol) && o._sonorLabel) {
        keptSymbolLabels.add(o._sonorLabel);
      }
      // v5.153.0 — HVAC blocks kept on the 11 slice keep their ID labels
      if (serviceNn === '11' && !variant && o && o.sonorSymbol && o._sonorLabel
          && String(o.sonorSymbol.service_nn || '') === '06'
          && /THERM|UFH|MANIFOLD/i.test(String(o.sonorSymbol.block_code || ''))) {
        keptSymbolLabels.add(o._sonorLabel);
      }
    });
    const stash = [];
    canvas.getObjects().forEach(o => {
      if (!o) return;
      stash.push({ o, visible: o.visible });
      const isPlan      = !!o.sonorPlan;
      const isRoom      = (o.sonorMeasure && o.sonorMeasure.kind === 'area');
      // v5.4.24/v5.4.27 — Room visibility:
      //   - hasActiveRooms: keep only rooms in the active set (zooms
      //     bbox to service's spatial footprint, e.g. cinema room)
      //   - !hasActiveRooms: keep ALL rooms so bbox falls back to full
      //     floor — prevents over-zoom on floors with no geometry-
      //     defined target rooms (e.g. Caldy 1F)
      let keep = isPlan || (isRoom && (hasActiveRooms ? meaningfulRooms.has(o) : true));
      // Symbols: only those for the target service / variant predicate
      if (o.sonorSymbol && _matchesSvc(o.sonorSymbol)) keep = true;
      // v5.153.0 (Bryn: "HVAC stats and manifold etc need to be included in
      // the electrical section — the 240v side will almost always be done by
      // electrician") — UFH stats + manifolds ride the 11 slice like the
      // fused-spur badges do.
      if (serviceNn === '11' && !variant && o.sonorSymbol
          && String(o.sonorSymbol.service_nn || '') === '06'
          && /THERM|UFH|MANIFOLD/i.test(String(o.sonorSymbol.block_code || ''))) keep = true;
      // Cone overlay only kept when serviceNn === '08' (CCTV plan path
      // covers that case; this branch is here so a future call honours it).
      if (o._sonorViewCone === true && serviceNn === '08') keep = true;
      // v5.102.0 — audio zone topology lines + labels belong on the 02 slice.
      if (o._sonorAudioTopo === true) keep = (serviceNn === '02' && !variant);
      // v5.107.0 — synthesised fused-spur badges belong on the 11 slice.
      if (o._sonorSpurBoost === true) keep = (serviceNn === '11' && !variant);
      // v5.158.0 (Bryn: "text editor should have pallette of all services and
      // ability to link to a service, so it shows on the relevant service
      // slice as well as combined") — service-linked text boxes ride their
      // linked services' slice pages (classic slices incl. electrical;
      // lighting/lkp/override variants excluded). Untagged text stays
      // combined-plans-only, exactly as before.
      if (o.sonorTextBox) {
        const _txtSvcs = Array.isArray(o.sonorTextBox.services) ? o.sonorTextBox.services : [];
        keep = !variant && _txtSvcs.indexOf(String(serviceNn)) !== -1;
      }
      // Cables + LEDs scoped by service if metadata allows; keep all by
      // default for the electrical (11) case since lighting circuits use
      // service 04 cables but are still in the electrician's scope.
      // For non-electrical service slices we hide non-target cables.
      if (o.sonorMeasure && (o.sonorMeasure.kind === 'length' || o.sonorMeasure.kind === 'led')) {
        if (variant === 'lighting') keep = (o.sonorMeasure.kind === 'led');   // LED runs belong on the lighting plan
        else if (variant === 'lkp') keep = false;
        else if (variant === 'dmx') keep = (o.sonorMeasure.kind === 'led' && !!(window._ledIsDmx && window._ledIsDmx(o.sonorMeasure)));   // v2.7.0 — DMX-controlled runs only
        else if (variant === 'override') keep = false;   // v5.157.0 — watermark-override: no cables/LEDs either
        else keep = (serviceNn === '11' || serviceNn === '04');
      }
      // v5.69.0 — circuit links: LC curves on the lighting plan, bus loops
      // on the LKP plan; hidden on classic service slices.
      if (o._sonorCircuitLink === true) {
        keep = variant === 'lighting' ? (o._lcKind !== 'lkp' && o._lcKind !== 'dmx')
             : variant === 'lkp'      ? o._lcKind === 'lkp'
             : variant === 'dmx'      ? o._lcKind === 'dmx'   // v2.7.0
             : false;
      }
      // Labels: hide unless they belong to a kept symbol family — simplest
      // rule: hide all standalone labels for service-slice plans (the
      // symbols carry their own ID labels via the inline child).
      // v5.41.1 — keep the kept symbols' sibling ID labels (see above);
      // every other standalone label stays hidden on slice pages.
      if (o.temp === 'label') keep = keptSymbolLabels.has(o);
      // v5.144.0 — origin-override + master/slave pair links ride their
      // service's slice page (tagged _sonorLinkSvcNn at draw time in
      // sonor-takeoffs-pairs.js). Classic slices only — lighting/lkp
      // variants keep their own circuit-link vocabulary.
      if (o._sonorOriginLink === true || o._sonorPairLink === true) {
        keep = !variant && String(o._sonorLinkSvcNn || '') === String(serviceNn);
      }
      o.visible = keep;
    });
    canvas.renderAll();
    let snap = null;
    // v1.94.0 — for non-CCTV service slices we removed cones above, so
    // pass skipConeResync to prevent _snapshotCanvas from rebuilding them.
    // For NN=08 (CCTV) we WANT the resync so cones are fresh.
    // v5.4.27 — Also pass skipPlanInBbox: true ONLY when we have active
    // rooms to zoom to. When hasActiveRooms is false (no target rooms
    // on this floor) we let the plan EXPAND the bbox so the slice
    // shows the full floor as fallback rather than over-zooming to
    // a single symbol.
    const opts = {
      skipConeResync: (serviceNn !== '08'),
      skipPlanInBbox: hasActiveRooms,
      // v5.41.1 — footprint > 60% of the plan in either axis → full-floor
      // framing instead of an amputated near-full crop (see _snapshotCanvas).
      maxBboxFracOfPlan: 0.6,
      // v5.4.35 — service slices opt into the 25% relative-fraction bbox
      // fallback. Default _snapshotCanvas behaviour stays untouched (no
      // fallback) so _captureAllFloors continues to render distinct
      // floors. Sparse-content slice snapshots that would otherwise
      // collapse to a single symbol still get the full-floor fallback.
      minBboxFracW: 0.25,
      minBboxFracH: 0.25
    };
    try {
      // v5.144.0 — tell _withIdentityViewport (capture wrapper) to keep this
      // service's link overlays visible instead of stashing them away.
      if (typeof window !== 'undefined') window.__sonorExportKeepLinksSvcNn = variant ? null : String(serviceNn);
      snap = _snapshotCanvas(opts);
    }
    finally {
      if (typeof window !== 'undefined') window.__sonorExportKeepLinksSvcNn = null;
      stash.forEach(s => { if (s.o) s.o.visible = s.visible; });
      // v5.107.0 — drop the synthesised spur badges.
      if (_spurBoostObjs.length) {
        _spurBoostObjs.forEach(b => { try { canvas.remove(b); } catch (_) {} });
      }
      // v5.102.0 — drop the boosted audio topology if we created it.
      if (_audioTopoBoosted) {
        try {
          if (typeof window !== 'undefined' && typeof window._clearAudioTopology === 'function') window._clearAudioTopology();
          else if (typeof _clearAudioTopology === 'function') _clearAudioTopology();
        } catch (_) {}
      }
      // v1.63.0 — re-attach removed cones for the non-CCTV branch
      if (removedCones.length) {
        try {
          if (typeof SonorCctv !== 'undefined' && SonorCctv.resyncAll) SonorCctv.resyncAll();
          else if (typeof _resyncAllViewCones === 'function') _resyncAllViewCones();
        } catch (e) {}
      }
      canvas.requestRenderAll();
    }
    return snap;
  }

  // v5.42.0 — EXTERNAL AREAS snapshot (Bryn 2026-07-06: "the external pdf
  // render should have the main plan at low opacity for reference").
  // Keeps: the architect plan DIMMED to 25%, the building outline, every
  // EXTERNAL room + its sibling label, and symbols whose centre sits in an
  // external room. Everything else hidden. Full-floor framing (plan stays
  // in the bbox), restore in finally.
  function _snapshotCanvasExternalOnly() {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    const extRooms = canvas.getObjects().filter(o =>
      o && o.sonorMeasure && o.sonorMeasure.kind === 'area' && o.sonorMeasure.external === true);
    if (!extRooms.length) return null;
    const keptLabels = new Set();
    extRooms.forEach(r => { if (r._sonorLabel) keptLabels.add(r._sonorLabel); });
    // Symbols inside external rooms (canonical hit-test)
    const keptSymbols = new Set();
    try {
      canvas.getObjects().forEach(o => {
        if (!o || !o.sonorSymbol) return;
        const c = (o.getCenterPoint && o.getCenterPoint()) || { x: o.left || 0, y: o.top || 0 };
        let hit = null;
        try { if (typeof findRoomAt === 'function') hit = findRoomAt(c.x, c.y); } catch (_) {}
        if (hit && hit.sonorMeasure && hit.sonorMeasure.external === true) {
          keptSymbols.add(o);
          if (o._sonorLabel) keptLabels.add(o._sonorLabel);
        }
      });
    } catch (_) {}
    const stash = [];
    const planDim = [];
    canvas.getObjects().forEach(o => {
      if (!o) return;
      stash.push({ o, visible: o.visible });
      if (o.sonorPlan === true) {
        // keep, but dim for reference
        planDim.push({ o, opacity: o.opacity });
        o.opacity = 0.25;
        return;
      }
      if (o.sonorBuildingOutline) { o.visible = true; return; }
      const isExtRoom = o.sonorMeasure && o.sonorMeasure.kind === 'area' && o.sonorMeasure.external === true;
      let keep = isExtRoom || keptSymbols.has(o) || keptLabels.has(o);
      o.visible = keep;
    });
    canvas.renderAll();
    let snap = null;
    try { snap = _snapshotCanvas({ skipConeResync: true }); }
    finally {
      stash.forEach(sv => { if (sv.o) sv.o.visible = sv.visible; });
      planDim.forEach(pd => { if (pd.o) pd.o.opacity = pd.opacity; });
      canvas.requestRenderAll();
    }
    return snap;
  }

  // v1.44.0 — CCTV-filtered canvas snapshot. Hides every non-camera
  // symbol + non-cone object (rooms / cables / LEDs / shades / TVs / labels)
  // for the duration of the snapshot, captures, then restores prior
  // visibility. The plan image stays visible. Result: a security-only
  // overlay showing just cameras + their FoV cones on top of the floorplan.
  function _snapshotCanvasCctvOnly() {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    // Stash visibility, then mute non-CCTV objects
    const stash = [];
    canvas.getObjects().forEach(o => {
      if (!o) return;
      stash.push({ o, visible: o.visible });
      const isPlan      = !!o.sonorPlan;
      const isCamera    = (o.sonorSymbol && _isCameraBlock(o.sonorSymbol));
      const isViewCone  = (o._sonorViewCone === true);
      const isCameraLbl = (o.temp === 'label' && o._isLabel === undefined && false);
      // Keep plan + camera symbols + view cones; hide everything else
      o.visible = isPlan || isCamera || isViewCone;
    });
    canvas.renderAll();  // v1.46.2 — sync render before snapshot
    let snap = null;
    try { snap = _snapshotCanvas(); }
    finally {
      // Restore prior visibility regardless of capture outcome
      stash.forEach(s => { if (s.o) s.o.visible = s.visible; });
      canvas.requestRenderAll();
    }
    return snap;
  }

  // v2.0.6 — Hide every room polygon (and its standalone name label) for
  // the snapshot window. Bryn directive: "plans should render without the
  // rooms layer". Rooms are a working visualisation only — never a
  // deliverable. Applies to every PDF plan page. Tagged-find pattern
  // (mirrors v1.95 cone-strip safety): match on
  // `sonorMeasure.kind === 'area'` for the polygon, and the polygon's
  // attached `_sonorLabel` reference for the room name text. Stash prior
  // visibility, mutate to false, capture, restore in finally.
  function _hideRoomsForSnapshot() {
    if (typeof canvas === 'undefined' || !canvas) return [];
    const stash = [];
    canvas.getObjects().forEach(o => {
      if (!o) return;
      const isRoom = (o.sonorMeasure && o.sonorMeasure.kind === 'area');
      if (isRoom) {
        stash.push({ o, visible: o.visible });
        o.visible = false;
        // Hide the standalone room-name label paired via _sonorLabel
        if (o._sonorLabel) {
          stash.push({ o: o._sonorLabel, visible: o._sonorLabel.visible });
          o._sonorLabel.visible = false;
        }
      }
    });
    return stash;
  }
  function _restoreRoomsAfterSnapshot(stash) {
    if (!stash || !stash.length) return;
    stash.forEach(s => { if (s.o) s.o.visible = s.visible; });
  }

  // v5.147.0 — export-quality preset (Quality selector in the exports
  // panel). Falls back to the v5.146.0 High preset when the host UI or
  // selector is absent (headless probes, older shells).
  function _snapQuality() {
    try {
      if (typeof window !== 'undefined' && typeof window._sonorPdfQuality === 'function') {
        const q = window._sonorPdfQuality();
        if (q && q.snapMult > 0 && q.snapQ > 0) return q;
      }
    } catch (_) {}
    return { snapMult: 4.0, snapQ: 0.9, htmlScale: 4 };
  }
  // v2.8.0 (Takeoffs v5.274.0 — a Standard full document froze the tab for 50+ min) — the plan snapshot multiplier is CAPPED so
  // the capture is never bigger than the page can show. The preset multiplier (Draft 2 · Standard 3 · High 4 · Print 5) multiplied
  // the plan's WORLD size, so a large architect drawing (e.g. 6000 x 4200 px) became an 18000 x 12600 = 227 MP canvas at Standard —
  // a synchronous fabric render + JPEG encode of seconds to minutes PER plan page (service slices, CCTV, lighting, DMX … ×
  // floors), then a 20-60 MB data URL html2canvas decoded and scaled straight back down to the 1190 pt page (3570 px at
  // Standard). Long side now ≤ 1190 pt × the page raster scale × 1.25 (headroom for zoom); never below 0.5×, never above the preset.
  function _snapMultFor(w, h) {
    const q = _snapQuality(), pre = q.snapMult || 4;
    const pageScale = Math.max(2, Math.min((q.planScale > 0 ? q.planScale : q.htmlScale) || 4, ({ draft: 2.5, standard: 3 })[q.key] || 99));   // v2.9.0 — the plan page's own raster scale when the preset sets one
    const maxPx = Math.round(1190 * pageScale * 1.25), long = Math.max(Number(w) || 0, Number(h) || 0);
    if (!(long > 0)) return pre;
    return Math.max(0.5, Math.min(pre, maxPx / long));
  }
  // v5.199.0 — bbox of the BUILDING on the live canvas: room polygons
  // (visible or not — they are hidden during capture) + the building
  // outline, padded by padM metres (scalePxPerM; falls back to 6 % of the
  // footprint when the floor is unscaled) and clamped to the architect
  // underlay when one is present. Returns null when the floor has no room
  // ≥ 80×80 px so unscaled / room-less floors keep the legacy framing.
  const _PLAN_FRAME_PAD_M = 1.5;
  function _buildingFrame(padM) {
    if (typeof canvas === 'undefined' || !canvas) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, n = 0, plan = null;
    canvas.getObjects().forEach(o => {
      if (!o || o.temp === true) return;
      if (o.sonorPlan === true) { if (!plan) plan = o; return; }
      const isRoom = !!(o.sonorMeasure && o.sonorMeasure.kind === 'area');
      const isOutline = !!o.sonorBuildingOutline;
      if (!isRoom && !isOutline) return;
      let br = null;
      try { br = o.getBoundingRect ? o.getBoundingRect(true, true) : null; } catch (_) { br = null; }
      if (!br || !(br.width > 0) || !(br.height > 0)) return;
      if (isRoom && (br.width < 80 || br.height < 80)) return;   // degenerate trace (v5.4.33 filter)
      l = Math.min(l, br.left); t = Math.min(t, br.top);
      r = Math.max(r, br.left + br.width); b = Math.max(b, br.top + br.height);
      n++;
    });
    if (!n || !isFinite(l) || !isFinite(r) || (r - l) < 10 || (b - t) < 10) return null;
    const scale = (typeof scalePxPerM !== 'undefined' && scalePxPerM > 0) ? scalePxPerM : 0;
    const pm = (typeof padM === 'number' && padM >= 0) ? padM : _PLAN_FRAME_PAD_M;
    const pad = scale ? pm * scale : Math.max(20, Math.max(r - l, b - t) * 0.06);
    let out = { left: l - pad, top: t - pad, width: (r - l) + 2 * pad, height: (b - t) + 2 * pad };
    if (plan) {
      try {
        const pr = plan.getBoundingRect(true, true);
        if (pr && pr.width > 10 && pr.height > 10) {
          const L = Math.max(out.left, pr.left), T = Math.max(out.top, pr.top);
          const R = Math.min(out.left + out.width, pr.left + pr.width), B = Math.min(out.top + out.height, pr.top + pr.height);
          if (R - L > 10 && B - T > 10) out = { left: L, top: T, width: R - L, height: B - T };
        }
      } catch (_) {}
    }
    return out;
  }

  function _snapshotCanvas(opts) {
    if (typeof canvas === 'undefined' || !canvas) return null;
    canvas.discardActiveObject();
    // v2.0.6 — hide rooms layer for every plan-page snapshot. Caller can
    // opt out via `{ keepRooms: true }` (currently unused — every PDF path
    // wants rooms hidden). The CCTV-only wrapper already hides rooms via
    // its visibility filter, so the hide-here is a no-op when rooms are
    // already invisible.
    const keepRooms = opts && opts.keepRooms === true;
    const roomsStash = keepRooms ? [] : _hideRoomsForSnapshot();
    // v1.46.5 — force every camera's view cone to be fresh (correct
    // bearing for current group.angle, correct wall-clipping for current
    // room polygons). Belt-and-braces — even if the per-group / canvas-
    // level rotation handlers fail or race, snapshot-time resync
    // guarantees the PDF reflects the live canvas state.
    //
    // v1.94.0 — Bryn report: "still has the cctv views on all plans".
    // Root cause: this resync was rebuilding cones that the
    // _snapshotCanvasNoCctvCones / _snapshotCanvasByService wrappers had
    // just physically removed from the canvas, so cones came back BEFORE
    // the JPEG capture. The wrappers now pass `{ skipConeResync: true }`
    // so the strip stays effective for the snapshot window. CCTV-only
    // and live-canvas paths still benefit from the resync.
    const skipResync = opts && opts.skipConeResync === true;
    if (!skipResync && typeof _resyncAllViewCones === 'function') {
      try { _resyncAllViewCones(); } catch (e) { console.warn('[snapshot] cone resync failed:', e); }
    }
    // v1.46.2 — JPEG doesn't support transparency. The canvas defaults to
    // backgroundColor '#ffffff00' (transparent) so JPEG export rendered
    // every transparent pixel as BLACK (Bryn report: "pdf shows as black,
    // not floorplan image"). Force solid white before capture, restore
    // in finally so we never leave the live canvas with the wrong bg.
    const origBg = canvas.backgroundColor;
    canvas.backgroundColor = '#ffffff';
    // v1.46.2 — sync renderAll() so the bg + any pre-call visibility
    // mutations (from _snapshotCanvasCctvOnly / _snapshotCanvasByService
    // wrappers) take effect on the captured pixels. requestRenderAll
    // schedules via rAF which doesn't fire before the synchronous
    // toDataURL below — captured frame would show stale state.
    canvas.renderAll();
    let result = null;
    try {
      const fullW = canvas.getWidth();
      const fullH = canvas.getHeight();
      // Content bbox in absolute canvas coordinates (ignoring zoom/pan).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasContent = false;
      // v5.4.27 — Plan-skip is now OPT-IN via opts.skipPlanInBbox. The
      // v5.4.24 unconditional skip caused a regression where Combined
      // Plans pages (which want the FULL floor visible) ended up
      // tightly-cropped to just the user-drawn symbols when the floor
      // had few objects (Caldy 1F: 2 symbols only → over-zoomed to a
      // single dimension annotation). Now: only slice paths
      // (_snapshotCanvasByService) opt in, combined paths stay
      // backward-compatible.
      const skipPlanInBbox = opts && opts.skipPlanInBbox === true;
      // v5.199.0 — BUILDING FRAME (Bryn: "can plans fill the viewport width
      // more"). The architect underlay is a whole A3 sheet — wide white
      // margins + title block — so framing to the underlay left the
      // building small in the page. Frame to the BUILDING instead: the
      // union of the room polygons (hidden for the capture, but they still
      // define the footprint) + the building outline, padded by
      // framePadM metres (default 1.5 m — keeps the external walls and the
      // architect's dimension strings) and clamped to the underlay. The
      // frame replaces the underlay as the "whole floor" reference below:
      // combined pages crop to it, the slice max-fraction guard expands to
      // it (not the sheet), and the sparse-content fallback uses it (not
      // the full canvas). Floors with no rooms behave exactly as before.
      // Opt out per call with { frameToBuilding: false }.
      const frame = (opts && opts.frameToBuilding === false) ? null : _buildingFrame(opts && opts.framePadM);
      canvas.getObjects().forEach(o => {
        if (!o || o.temp === true) return;  // skip transient drawing helpers
        // v1.57.0 — also skip invisible objects so any wrapper that hid
        // CCTV cones / non-target services / labels via o.visible=false
        // gets a tight crop that doesn't extend into the would-be cone
        // area. Belt-and-braces for the cone-bleed Bryn report.
        if (o.visible === false) return;
        // v5.199.0 — never let on-canvas chrome drive the crop: the export
        // frame rect / label (excludeFromExport) is the WHOLE sheet + margin,
        // so counting it framed every plan to the sheet (masked pre-v5.198.0
        // by the canvas-element clamp). _withIdentityViewport hides it for
        // the capture but the bbox loop runs before that wrapper.
        if (o.excludeFromExport === true || o._sonorExportFrame === true || o._sonorExportFrameLabel === true || o.__sonorMirrorBadge === true) return;
        if ((skipPlanInBbox || frame) && o.sonorPlan === true) return;
        try {
          const r = o.getBoundingRect ? o.getBoundingRect(true, true) : null;
          if (!r) return;
          if (r.left < minX) minX = r.left;
          if (r.top  < minY) minY = r.top;
          if (r.left + r.width  > maxX) maxX = r.left + r.width;
          if (r.top  + r.height > maxY) maxY = r.top  + r.height;
          hasContent = true;
        } catch (e) { /* skip object */ }
      });
      // Sensible fallback when the canvas is empty — full canvas.
      // v5.4.34: also fall back when the resulting bbox is too small
      // RELATIVE TO THE CANVAS (< 25% in either dimension). Over-zoom
      // class fix: pre-v5.4.34, a service slice on a floor with sparse
      // content (e.g. Caldy 1F Cinema = 1 DV-1 symbol + 2 degenerate-area
      // rooms) computed a bbox of ~50 px even though the canvas is
      // ~1500 px wide → JPEG cropped to a tiny region around the symbol
      // → page rendered as a single zoomed-in symbol instead of
      // "service overlay on full floor plan". The 80×80 px room filter
      // (v5.4.33) caught most cases but failed when the architect plan
      // is set as canvas backgroundImage (not in getObjects()) — the
      // bbox sees only canvas objects, not the bg, so even the
      // skipPlanInBbox=false branch can't expand the bbox to include
      // the plan. This relative-fraction fallback closes the bug class
      // structurally regardless of whether the plan is bg or object.
      // v5.4.35 — opt-in only (default 0). Pre-v5.4.35 the 0.25 default
      // triggered the full-canvas fallback for any sparse-content snapshot,
      // breaking _captureAllFloors when the First Floor's architect plan
      // bbox was naturally narrow (Caldy v5.4.34 export had Ground Floor
      // shown twice because 1F snapshot fell back to the canvas state at
      // capture time, which happened to still hold GF). Slice paths
      // (_snapshotCanvasByService) opt in with explicit minBboxFracW: 0.25.
      // v5.41.1 — MAX-fraction guard (Bryn 2026-07-06: "the other services
      // plans are cropped"). The zoom-to-footprint design (v5.4.24, from
      // the cinema directive) amputates the floor mid-wall when a service
      // (Audio/Network) spans MOST of it — the union of active rooms is
      // nearly the whole plan, so edge rooms get chopped. If the content
      // bbox exceeds maxBboxFracOfPlan of the PLAN's extent in EITHER
      // axis, expand the bbox to include the whole plan → clean full-floor
      // framing (same as Combined). Compact footprints (a cinema room)
      // still zoom exactly as before. Opt-in — slice path passes 0.6.
      // v5.199.0 — combined pages (no plan-skip) frame to the building.
      if (frame && !skipPlanInBbox) {
        minX = hasContent ? Math.min(minX, frame.left) : frame.left;
        minY = hasContent ? Math.min(minY, frame.top)  : frame.top;
        maxX = hasContent ? Math.max(maxX, frame.left + frame.width)  : frame.left + frame.width;
        maxY = hasContent ? Math.max(maxY, frame.top  + frame.height) : frame.top  + frame.height;
        hasContent = true;
      }
      const maxFracOfPlan = (opts && typeof opts.maxBboxFracOfPlan === 'number') ? opts.maxBboxFracOfPlan : 0;
      if (hasContent && maxFracOfPlan > 0) {
        try {
          const planObj = canvas.getObjects().find(o => o && o.sonorPlan === true && o.visible !== false);
          // v5.199.0 — the building frame is the "whole floor" reference when present.
          const pr = frame || (planObj && planObj.getBoundingRect ? planObj.getBoundingRect(true, true) : null);
          if (pr && pr.width > 10 && pr.height > 10 &&
              ((maxX - minX) > pr.width * maxFracOfPlan || (maxY - minY) > pr.height * maxFracOfPlan)) {
            minX = Math.min(minX, pr.left);
            minY = Math.min(minY, pr.top);
            maxX = Math.max(maxX, pr.left + pr.width);
            maxY = Math.max(maxY, pr.top + pr.height);
          }
        } catch (_) { /* guard is best-effort — zoom behaviour unchanged on error */ }
      }
      const minBboxFracW = (opts && typeof opts.minBboxFracW === 'number') ? opts.minBboxFracW : 0;
      const minBboxFracH = (opts && typeof opts.minBboxFracH === 'number') ? opts.minBboxFracH : 0;
      const bboxW = (maxX - minX);
      const bboxH = (maxY - minY);
      const bboxTooSmall = hasContent && (
        bboxW < fullW * minBboxFracW ||
        bboxH < fullH * minBboxFracH
      );
      // v5.199.0 — sparse / empty content on a floor WITH rooms: frame the
      // building rather than the whole canvas (which is the whole sheet).
      const sparse = !hasContent || !isFinite(minX) || !isFinite(maxX) || bboxW < 10 || bboxH < 10 || bboxTooSmall;
      if (sparse && frame) {
        minX = frame.left; minY = frame.top; maxX = frame.left + frame.width; maxY = frame.top + frame.height;
      }
      if (sparse && !frame) {
        // v1.99.1 — Compression hedge. Step DOWN from v1.66's 4.5× / q1.0
        // baseline to 3.0× / q0.85 — engineering plans look visually
        // identical at this setting (test prints unchanged), 56% fewer
        // pixels and ~15% lower JPEG quality cuts the snapshot file size
        // by 30-50%. This is a tactical patch — the v2.0.0 vector pipeline
        // (B-NNN, queued separately) replaces the raster path entirely.
        // v5.78.1 (sweep C-P1) — route through the identity-viewport wrapper:
        // hides the export-frame chrome + pair links and neutralises pan/zoom
        // (fabric toDataURL ignores excludeFromExport in raster renders).
        const _wrapCap0 = (typeof window !== 'undefined' && typeof window._withIdentityViewport === 'function')
          ? window._withIdentityViewport : (fn => fn());
        result = _wrapCap0(() => ({
          dataUrl: canvas.toDataURL({ format: 'jpeg', quality: _snapQuality().snapQ, multiplier: _snapMultFor(fullW, fullH) /* v2.8.0 — capped to the page; v5.147.0 — user preset (Quality selector); v5.146.0 default High 4.0/q0.9 */ }),
          w: fullW,
          h: fullH
        }));
      } else {
        // 4% padding around content so labels/strokes near edges aren't clipped
        const padX = Math.max(20, (maxX - minX) * 0.04);
        const padY = Math.max(20, (maxY - minY) * 0.04);
        // v5.198.0 — no longer clamped to the live canvas ELEMENT: fabric
        // renders any world region into the export canvas, and clamping to
        // the element size cut plans off at the window height (a 560 px-tall
        // canvas lost the bottom of every floor; the same export on a taller
        // window was complete — captures must not depend on window size).
        let cropL = minX - padX;
        let cropT = minY - padY;
        let cropW = (maxX - minX) + 2 * padX;
        let cropH = (maxY - minY) + 2 * padY;
        // v5.78.1 (sweep C-P1) — capture inside the identity-viewport wrapper
        // (frame chrome + pair links hidden; VT forced identity). The vt maths
        // below reads viewportTransform LIVE inside the wrapper, so screen
        // coords == world coords there and the crop translation stays exact.
        // v1.99.1 — Compression hedge (mirrors the no-content branch above).
        // 4.5× / q1.0 → 3.0× / q0.85. 56% fewer pixels + slight quality drop
        // = 30-50% smaller PDFs with no visible quality loss for line-art
        // engineering plans. Bridge until v2.0.0 vector pipeline lands.
        const _wrapCap1 = (typeof window !== 'undefined' && typeof window._withIdentityViewport === 'function')
          ? window._withIdentityViewport : (fn => fn());
        result = _wrapCap1(() => {
          const vt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
          const zoom = vt[0] || 1;
          const offX = vt[4] || 0;
          const offY = vt[5] || 0;
          const screenL = cropL * zoom + offX;
          const screenT = cropT * zoom + offY;
          const screenW = cropW * zoom;
          const screenH = cropH * zoom;
          return {
            dataUrl: canvas.toDataURL({
              format: 'jpeg',
              quality: _snapQuality().snapQ,      // v5.147.0 — user preset (Quality selector)
              multiplier: _snapMultFor(screenW, screenH),   // v2.8.0 — capped to the page (was the preset × the world size)
              left:   screenL,
              top:    screenT,
              width:  screenW,
              height: screenH
            }),
            w: screenW,
            h: screenH
          };
        });
      }
    } finally {
      // Always restore the original transparent bg so the live canvas
      // editing experience isn't affected.
      canvas.backgroundColor = origBg;
      // v2.0.6 — restore room visibility (no-op when keepRooms or when
      // wrapper had already hidden them via its own visibility stash).
      _restoreRoomsAfterSnapshot(roomsStash);
      canvas.requestRenderAll();
    }
    return result;
  }

  // v1.46.0 — Service-slice plan PDF (sub-contractor handover). Identical
  // to plan() except the snapshot is filtered to a single service NN.
  // Defaults to electrical (11) per Bryn directive: a third-party
  // electrician PDF showing only the work in their scope (lighting
  // circuits, power runs, electrical placements).
  async function servicePlan(serviceNn, serviceName, opts) {
    opts = opts || {};
    // ---- v5.5.57 Phase 3: pdf-lib dispatcher (unified style) ----
    if (_pdfLibFlagOn() && _pdfLibAvailable() && Array.isArray(opts.planPages) && opts.planPages.length) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating ' + (serviceName || 'service') + ' plan via pdf-lib (unified style)…');
        const result = await servicePlanPdfLib(Object.assign({}, opts, {
          serviceNn: String(serviceNn),
          serviceName: serviceName
        }));
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          return result;
        }
        console.warn('[SonorPdf v5.5.57 servicePlan] servicePlanPdfLib returned null — falling back to legacy jsPDF.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v5.5.57 servicePlan] threw — falling back to jsPDF:', err);
      }
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}

    // ---- Legacy jsPDF snapshot path (fallback) ----
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    const snap = _snapshotCanvasByService(serviceNn, opts && opts.variant);   // v2.7.0 — opts.variant ('dmx' …) filters like the full-document special plans
    if (!snap) {
      if (typeof setStatus === 'function') setStatus('Plan canvas not ready.');
      return null;
    }
    opts = opts || {};
    const { jsPDF } = window.jspdf;
    const landscape = snap.w >= snap.h;
    const pdf = new jsPDF({
      orientation: landscape ? 'landscape' : 'portrait',
      unit: 'pt',
      format: 'a3',
      compress: true   // v5.39.0 (B-350)
    });
    _registerSonorFonts(pdf);
    const meta = collectProjectMeta();
    const niceName = (serviceName || '').toUpperCase();
    const title = opts.title || `${niceName} PLAN`;
    _emitPlanPageIntoPdf(pdf, {
      title,
      subtitle: opts.subtitle || `Sub-contractor handover — ${serviceName} scope only`,
      aspect: 'svc_' + serviceNn,
      legend: opts.legend,
      summary: opts.summary,
      summaryTitle: opts.summaryTitle || (niceName + ' totals'),
      dataUrl: snap.dataUrl,
      canvasW: snap.w,
      canvasH: snap.h,
      pageNum: 1,
      pageTotal: 1,
      // v2.0.0 — drawing page: full architectural title block + ref code
      pageCode: 'SLI-' + serviceNn,
      useTitleBlock: true,
      withNotesColumn: true
    }, meta);
    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug = (serviceName || ('svc' + serviceNn)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const fname = opts.filename || `sonor-${projSlug}-${slug}_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus(`${niceName} plan exported — ` + fname);
    return pdf;
  }

  // v1.44.0 — CCTV-only plan PDF. Identical to plan() except the canvas
  // snapshot is filtered to camera blocks + view cones only. Title +
  // accent default to security-08. Used by both the standalone export
  // button and (auto-included) by fullDocument when CCTV placements exist.
  //
  // v5.5.57 — Phase 3 unification (PDF-UNIFICATION_2026-05-19.md). Now a
  // dispatcher: when caller supplies opts.planPages (built by host
  // _buildPlanPagesForPdfLib) AND pdf-lib is loaded AND flag is on, routes
  // to cctvPlanPdfLib() which uses SAME _paintPlanPagePdfLib painter as
  // Full Doc. Falls back to legacy jsPDF snapshot path otherwise.
  // v5.80.0 — standalone WiFi heatmap export. pdf-lib deck (all floors) when
  // the unified pipeline is opted in; legacy jsPDF single active-floor page
  // otherwise (mirrors cctvPlan's convention).
  async function wifiHeatmap(opts) {
    opts = opts || {};
    if (_pdfLibFlagOn() && _pdfLibAvailable() && Array.isArray(opts.planPages) && opts.planPages.length) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating WiFi heatmap via pdf-lib (unified style)…');
        const result = await wifiHeatmapPdfLib(opts);
        if (result) { try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {} return result; }
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v5.80.0 wifiHeatmap] threw — falling back to jsPDF:', err);
      }
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    const snap = (window._sonorWifiHeatmapSnapshot ? window._sonorWifiHeatmapSnapshot() : null);
    if (!snap) {
      if (typeof setStatus === 'function') setStatus('No access points placed — add 09.1 WAP blocks first.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: snap.w >= snap.h ? 'landscape' : 'portrait', unit: 'pt', format: 'a3', compress: true });
    _registerSonorFonts(pdf);
    const meta = collectProjectMeta();
    _emitPlanPageIntoPdf(pdf, {
      title: opts.title || 'WIFI COVERAGE HEATMAP',
      subtitle: opts.subtitle || 'Predicted 5 GHz coverage — multi-wall model (walls attenuate signal). Predictive only — verify on site.',
      aspect: 'network',
      legend: opts.legend || (window._wifiLegendRows ? window._wifiLegendRows() : null),
      summary: opts.summary,
      summaryTitle: opts.summaryTitle || 'WiFi coverage',
      dataUrl: snap.dataUrl,
      canvasW: snap.w,
      canvasH: snap.h,
      pageNum: 1, pageTotal: 1,
      pageCode: 'WIFI',
      useTitleBlock: true,
      withNotesColumn: true
    }, meta);
    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const floorSlug = (meta.floor || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-wifi-heatmap${floorSlug ? '-' + floorSlug : ''}_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus('WiFi heatmap exported — ' + fname);
    return pdf;
  }

  async function cctvPlan(opts) {
    opts = opts || {};
    // ---- Unified path (pdf-lib + modern style) ----
    if (_pdfLibFlagOn() && _pdfLibAvailable() && Array.isArray(opts.planPages) && opts.planPages.length) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating CCTV plan via pdf-lib (unified style)…');
        const result = await cctvPlanPdfLib(opts);
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          return result;
        }
        console.warn('[SonorPdf v5.5.57 cctvPlan] cctvPlanPdfLib returned null — falling back to legacy jsPDF.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v5.5.57 cctvPlan] threw — falling back to jsPDF:', err);
      }
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}

    // ---- Legacy jsPDF snapshot path (fallback) ----
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    const snap = _snapshotCanvasCctvOnly();
    if (!snap) {
      if (typeof setStatus === 'function') setStatus('CCTV plan canvas not ready.');
      return null;
    }
    opts = opts || {};
    const { jsPDF } = window.jspdf;
    const landscape = snap.w >= snap.h;
    const pdf = new jsPDF({
      orientation: landscape ? 'landscape' : 'portrait',
      unit: 'pt',
      format: 'a3',
      compress: true   // v5.39.0 (B-350)
    });
    _registerSonorFonts(pdf);
    const meta = collectProjectMeta();
    const title = opts.title || 'CCTV COVERAGE PLAN';
    _emitPlanPageIntoPdf(pdf, {
      title,
      subtitle: opts.subtitle || 'Cameras + field-of-view overlay',
      aspect: 'security',
      legend: opts.legend,
      summary: opts.summary,
      summaryTitle: opts.summaryTitle || 'CCTV totals',
      dataUrl: snap.dataUrl,
      canvasW: snap.w,
      canvasH: snap.h,
      pageNum: 1,
      pageTotal: 1,
      // v2.0.0 — drawing page: title block + drawing code + notes column
      pageCode: 'CCT',
      useTitleBlock: true,
      withNotesColumn: true
    }, meta);
    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const floorSlug = (meta.floor || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-cctv${floorSlug ? '-' + floorSlug : ''}_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus('CCTV plan exported — ' + fname);
    return pdf;
  }

  async function plan(opts) {
    opts = opts || {};
    // ---- v5.5.57 Phase 3: pdf-lib dispatcher (unified style) ----
    if (_pdfLibFlagOn() && _pdfLibAvailable() && Array.isArray(opts.planPages) && opts.planPages.length) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating Plan via pdf-lib (unified style)…');
        const result = await planPdfLib(opts);
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          return result;
        }
        console.warn('[SonorPdf v5.5.57 plan] planPdfLib returned null — falling back to legacy jsPDF.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v5.5.57 plan] threw — falling back to jsPDF:', err);
      }
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}

    // ---- Legacy jsPDF snapshot path (fallback) ----
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    // v1.46.0 — Combined-plans snapshot also hides view cones for
    // standalone Plan PDFs (cones belong on the dedicated CCTV page).
    const snap = _snapshotCanvasNoCctvCones();
    if (!snap) {
      if (typeof setStatus === 'function') setStatus('Plan canvas not ready.');
      return null;
    }
    opts = opts || {};
    const { jsPDF } = window.jspdf;
    const landscape = snap.w >= snap.h;

    const pdf = new jsPDF({
      orientation: landscape ? 'landscape' : 'portrait',
      unit: 'pt',
      format: 'a3',
      compress: true   // v5.39.0 (B-350)
    });
    _registerSonorFonts(pdf);
    const meta = collectProjectMeta();
    const title = opts.title || 'FULL PLAN';

    const includeCover = opts.includeCover !== false;
    const pageTotal = includeCover ? 2 : 1;
    if (includeCover) {
      paintCoverSheet(pdf, {
        title,
        meta,
        floorRows: opts.floorRows,
        summary: opts.summary,
        summaryTitle: opts.summaryTitle,
        pageTotal
      });
      pdf.addPage();
    }

    _emitPlanPageIntoPdf(pdf, {
      title,
      subtitle: opts.subtitle,
      legend: opts.legend,
      summary: opts.summary,
      summaryTitle: opts.summaryTitle,
      dataUrl: snap.dataUrl,
      canvasW: snap.w,
      canvasH: snap.h,
      pageNum: includeCover ? 2 : 1,
      pageTotal,
      // v2.0.0 — drawing page chrome
      pageCode: 'COM-01',
      useTitleBlock: true,
      withNotesColumn: true
    }, meta);

    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const floorSlug = (meta.floor || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-plan${floorSlug ? '-' + floorSlug : ''}_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus('PDF exported — ' + fname);
    return fname;
  }

  // v1.31.0 — capture every floor's canvas snapshot + per-floor legend +
  // per-floor totals via async floor-walk. Switches active floor via the
  // existing switchFloor() mechanism, awaits the canvas re-render, then
  // restores the original active floor at the end via try/finally. Each
  // captured floor returns { floor, snap, legend, summary } for the
  // PDF page emitter. If only one floor exists, no switching happens.
  async function _captureAllFloors(opts) {
    if (typeof switchFloor !== 'function' || typeof floors === 'undefined' || !Array.isArray(floors)) {
      // Fallback: single-floor mode (legacy behaviour)
      // v1.57.0 — was raw _snapshotCanvas() which leaked CCTV cones into
      // Combined Plans pages. Bryn directive: "the views layer should be
      // hidden on all outputs pdfs unless it is specifically the cctv
      // coverage page". Switched to the cone-filtering variant — matches
      // the multi-floor path at line ~6191.
      const snap = _snapshotCanvasNoCctvCones();
      return [{
        floor: { name: 'Plan' },
        snap,
        legend: opts.legend || [],
        summary: opts.summary || []
      }];
    }
    // v5.4.42 — bake-in canonical floor sequence (Bryn 2026-05-08).
    // Wherever floors are listed/iterated, render GF → 1F → 2F → … → BA → EXT.
    // SonorPdfHtmlHelpers.sortFloors is a stable, pure sort — does not mutate
    // the host's floors[] array. Falls back to slice() when helpers module is
    // unavailable (offline/pre-load) so the behaviour is non-breaking.
    const _sortFloors = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
      ? window.sonorSortFloors
      : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
          && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
         ? window.SonorPdfHtmlHelpers.sortFloors
         : (arr => Array.isArray(arr) ? arr.slice() : arr));
    const allFloors = _sortFloors(floors.slice());
    const origActiveId = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
    const captured = [];
    // v5.4.40 — aggressive diagnostic logging. Pre-v5.4.40 the duplicate-
    // floor bug persisted through 6 fix attempts (v5.4.34-v5.4.39) without
    // resolution. The user's PDF output kept showing the same floor twice.
    // Without console access I can't see what's happening, so v5.4.40
    // logs every key state change. User can open DevTools, run an export,
    // and paste the [SonorPdf-DIAG] entries back so we can see definitively
    // whether switchFloor is being called, whether canvas state is changing,
    // and whether captured snapshots are actually different.
    console.log('[SonorPdf-DIAG] _captureAllFloors START. allFloors.length=' + allFloors.length +
      ' origActiveId=' + origActiveId +
      ' typeof switchFloor=' + (typeof switchFloor) +
      ' typeof canvas=' + (typeof canvas));
    if (allFloors.length) {
      console.log('[SonorPdf-DIAG] floors meta:', allFloors.map(f => ({ id: f && f.id, name: f && f.name })));
    }
    // v5.4.39 — own tracking variable instead of trusting activeFloorId.
    // The v5.4.36 fix relied on activeFloorId being kept in sync by
    // switchFloor, but the duplicate-page bug persisted in v5.4.36-v5.4.38
    // exports (Bryn v5.4.38 export pages 4+5 both Ground Floor). The
    // host's switchFloor may update activeFloorId asynchronously OR the
    // condition `f.id !== activeFloorId` might short-circuit if the
    // canvas is already on f.id from a previous capture pass.
    // Solution: ALWAYS call switchFloor, regardless of state. Track our
    // own "current floor" so we can detect repeat-iteration without
    // depending on the host's activeFloorId. Bigger settle window
    // (250 ms) gives Fabric's async backgroundImage load time to fully
    // resolve before we snapshot.
    let _lastSwitchedId = null;
    try {
      for (let i = 0; i < allFloors.length; i++) {
        const f = allFloors[i];
        if (!f) continue;
        const _activeBeforeSwitch = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
        console.log('[SonorPdf-DIAG] iter ' + i + ' START. f.id=' + f.id + ' f.name=' + f.name +
          ' _lastSwitchedId=' + _lastSwitchedId + ' activeFloorId=' + _activeBeforeSwitch);
        // v5.5.53 — ALWAYS call switchFloor with { force: true } so the host's
        // early-return on `targetId === activeFloorId` doesn't short-circuit
        // the per-iter capture. Six prior fix attempts (v5.4.34-v5.4.40) tried
        // to track switchFloor's success via _lastSwitchedId but couldn't
        // defeat the host's early-return. Now the host honours `force` and
        // re-applies the floor payload + plan unconditionally.
        console.log('[SonorPdf-DIAG] iter ' + i + ' calling switchFloor(' + f.id + ', { force: true })');
        let _switchReturn;
        try {
          _switchReturn = await switchFloor(f.id, { force: true });
          console.log('[SonorPdf-DIAG] iter ' + i + ' switchFloor returned. activeFloorId now=' +
            (typeof activeFloorId !== 'undefined' ? activeFloorId : 'undef') +
            ' returnVal=' + (_switchReturn === undefined ? 'undefined' : (typeof _switchReturn)));
        } catch (e) {
          console.warn('[SonorPdf-DIAG] iter ' + i + ' switchFloor THREW:', e);
        }
        _lastSwitchedId = f.id;
        // v5.5.53 — Correct plan-load wait. The architect plan is NOT
        // canvas.backgroundImage — Takeoffs' loadBackgroundImage uses
        // canvas.add(img) with sonorPlan:true. The v5.4.39 wait checked
        // canvas.backgroundImage which is ALWAYS null → wait skipped,
        // snapshot fired before the new floor's plan finished loading.
        // Six prior fix attempts (v5.4.34-v5.4.40) didn't catch this.
        //
        // Now: find the sonorPlan canvas object after switchFloor +
        // _restoreActivePlanForCurrentFloor returns, poll its underlying
        // <img>'s .complete with a 3-second cap (plans are larger than
        // backgrounds were and may take longer over slow connections).
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 250));
        try {
          if (typeof canvas !== 'undefined' && canvas && typeof canvas.getObjects === 'function') {
            const planObj = canvas.getObjects().find(o => o && o.sonorPlan);
            if (planObj) {
              const img = planObj._element || (planObj.getElement && planObj.getElement());
              if (img && img.complete === false) {
                const startWait = Date.now();
                while (img.complete === false && (Date.now() - startWait) < 3000) {
                  await new Promise(r => setTimeout(r, 50));
                }
                console.log('[SonorPdf-DIAG] iter ' + i + ' plan img.complete after ' +
                  (Date.now() - startWait) + 'ms (complete=' + img.complete + ')');
              } else if (img) {
                console.log('[SonorPdf-DIAG] iter ' + i + ' plan img already complete');
              }
            } else {
              console.log('[SonorPdf-DIAG] iter ' + i + ' no sonorPlan object on canvas (floor has no plan?)');
            }
          }
          if (typeof canvas !== 'undefined' && canvas && typeof canvas.renderAll === 'function') {
            canvas.renderAll();
          }
          // One more RAF tick after renderAll to ensure paint completes
          await new Promise(r => requestAnimationFrame(r));
        } catch (_) {}
        // v1.46.0 — Combined Plans omit CCTV view cones (cameras still
        // visible). Cones live on the dedicated CCTV plan page only.
        const snap = _snapshotCanvasNoCctvCones();
        let legend = (typeof opts.buildLegendForActive === 'function') ? opts.buildLegendForActive() : (opts.legend || []);
        const summary = (typeof opts.buildSummaryForActive === 'function') ? opts.buildSummaryForActive() : (opts.summary || []);
        // v5.172.0 appended a Luminaires total; v5.173.0 (Bryn: "the pdf export
        // still does not collapse luminaires to a single total with reference
        // to see lighting plan") — the per-type luminaire item rows are now
        // REMOVED from the Combined Plans SUMMARY and replaced by ONE total
        // line under 04 · LIGHTING. Full luminaire detail lives on the
        // Lighting plan pages (untouched — they build their own legends).
        // Non-luminaire 04 rows (LKP keypads, sensors, drivers) stay itemised.
        try {
          const _isLum = (sym) => (typeof window !== 'undefined' && typeof window._isLuminaire === 'function')
            ? window._isLuminaire(sym)
            : String(sym && sym.service_nn || '') === '04';
          const _lumSyms = canvas.getObjects()
            .filter(o => o && o.sonorSymbol && _isLum(o.sonorSymbol))
            .map(o => o.sonorSymbol);
          if (_lumSyms.length > 0 && Array.isArray(legend)) {
            const _lumShorts = new Set(_lumSyms.map(sy =>
              (typeof _shortFromSymbol === 'function') ? _shortFromSymbol(sy) : (sy.short_code || sy.code || '?')));
            // pass 1: drop luminaire item rows
            const _noLums = legend.filter(rw => !(rw && rw.kind === 'item' && rw.short != null && _lumShorts.has(rw.short)));
            // pass 2: drop sub-group headers emptied by pass 1
            const _out = [];
            for (let li = 0; li < _noLums.length; li++) {
              const rw = _noLums[li];
              if (rw && rw.kind === 'group' && rw.level === 'sub') {
                const nx = _noLums[li + 1];
                if (!nx || nx.kind === 'group') continue;
              }
              _out.push(rw);
            }
            // insert the single total at the END of the 04 · LIGHTING section
            const _total = { kind: 'group', level: 'sub', label: 'Luminaires \u00d7' + _lumSyms.length + ' \u2014 see Lighting plan' };
            let _svcIdx = _out.findIndex(rw => rw && rw.kind === 'group' && rw.level === 'service' && String(rw.label || '').indexOf('04') === 0);
            if (_svcIdx === -1) {
              _out.push(_total);
            } else {
              let _end = _svcIdx + 1;
              while (_end < _out.length && !(_out[_end] && _out[_end].kind === 'group' && _out[_end].level === 'service')) _end++;
              _out.splice(_end, 0, _total);
            }
            legend = _out;
          }
        } catch (_) {}
        captured.push({ floor: f, snap, legend, summary });
        // v5.4.40 — log captured snapshot meta for diagnosis. Always logs
        // (not just on duplicate) so user can see what's happening.
        const _snapPrefix = snap && snap.dataUrl ? snap.dataUrl.substring(0, 80) : 'NO-DATA-URL';
        const _snapBytes  = snap && snap.dataUrl ? snap.dataUrl.length : 0;
        console.log('[SonorPdf-DIAG] iter ' + i + ' SNAP captured. floor=' + f.name +
          ' bytes=' + _snapBytes + ' prefix80=' + _snapPrefix);
        // Duplicate detection
        if (captured.length >= 2) {
          const prev = captured[captured.length - 2].snap;
          if (prev && snap && prev.dataUrl && snap.dataUrl &&
              prev.dataUrl === snap.dataUrl) {
            console.error('[SonorPdf-DIAG] !!! DUPLICATE SNAPSHOT !!! floor[' + i + '] (' +
              (f.name || f.id) + ') exact-match with floor[' + (i - 1) + ']. switchFloor failed to change canvas state.');
          } else if (prev && snap && prev.dataUrl && snap.dataUrl &&
              prev.dataUrl.substring(0, 200) === snap.dataUrl.substring(0, 200)) {
            console.warn('[SonorPdf-DIAG] near-duplicate snapshot floor[' + i + '] vs ' + (i - 1));
          }
        }
      }
      console.log('[SonorPdf-DIAG] _captureAllFloors DONE. captured.length=' + captured.length);
    } finally {
      // v5.5.53 — Restore original active floor with force flag so the
      // host's early-return doesn't skip the restore (would leave user
      // looking at the LAST captured floor instead of where they started).
      if (origActiveId) {
        try { await switchFloor(origActiveId, { force: true }); }
        catch (e) { console.warn('[SonorPdf] failed to restore active floor:', e); }
      }
    }
    return captured;
  }

  // v1.30.0 — PLANS export: cover + plan canvas page (no aspect tables).
  // v1.31.0 — async, walks every floor for multi-floor decks.
  //
  // v3.1.0 — UNIFICATION (Bryn directive 2026-05-19 "see what you can do to
  // make sure all the different pdf types call the same methods, so they
  // are essentially just exporting sections of the full one"). Background
  // at APP - Takeoffs/PDF-UNIFICATION_2026-05-19.md.
  //
  // plans() is now a dispatcher: when the caller supplies opts.planPages
  // (built by the host's _buildPlanPagesForPdfLib) AND pdf-lib is loaded
  // AND the opt-in flag is on, we render via plansPdfLib() — which uses
  // the SAME _paintPlanPagePdfLib painter as Full Document. Plans-only
  // PDF then matches Full Doc's plan-page style (modern slate band +
  // single hairline + simpler inset) instead of the legacy heavy-sidebar
  // _emitPlanPageIntoPdf style.
  //
  // Falls back to the v2.3.x jsPDF heavy-sidebar path on null return /
  // thrown error / missing planPages. Behaviour-preserving when the
  // host doesn't pass planPages (legacy callers stay pixel-identical).
  async function plans(opts) {
    opts = opts || {};
    // ---- Unified path (pdf-lib + modern style — matches Full Document) ----
    try { window.__SONOR_LAST_PDF_ERROR__ = null; } catch (_) {}
    const flagOn = _pdfLibFlagOn();
    const libOk  = _pdfLibAvailable();
    const hasPlanSpec = Array.isArray(opts.planPages) && opts.planPages.length > 0;
    if (flagOn && libOk && hasPlanSpec) {
      try {
        if (typeof setStatus === 'function') setStatus('Generating Plans via pdf-lib (unified style)…');
        const result = await plansPdfLib(opts);
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          return result;
        }
        try { window.__SONOR_LAST_PDF_ERROR__ = new Error('plansPdfLib returned null'); } catch (_) {}
        console.warn('[SonorPdf v3.1.0] plansPdfLib returned null — falling back to legacy heavy-sidebar jsPDF.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[SonorPdf v3.1.0] plansPdfLib threw — falling back to jsPDF:', err);
      }
    } else {
      try {
        console.warn('[SonorPdf v3.1.0] Plans pdf-lib path skipped:', {
          flagOn, libOk, hasPlanSpec,
          reason: !flagOn ? 'flag off' : (!libOk ? 'pdf-lib not loaded' : 'no planPages spec from host')
        });
      } catch (_) {}
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}

    // ---- Legacy jsPDF heavy-sidebar path (fallback) ----
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3', compress: true }); // v5.39.0 (B-350)
    _registerSonorFonts(pdf);
    const meta = collectProjectMeta();
    const title = opts.title || 'PLANS';

    if (typeof setStatus === 'function') setStatus('Capturing floors…');
    const captured = await _captureAllFloors(opts);
    if (!captured.length || !captured[0].snap) {
      if (typeof setStatus === 'function') setStatus('Plan canvas not ready.');
      return null;
    }
    const pageTotal = 1 + captured.length;

    // v5.5.74 — UNIFIED COVER. Call the shared `_renderCoverJsPdf` helper
    // that fullDocument() also uses, so Plans cover + Full Doc cover are
    // GUARANTEED visually identical (HTML/CSS luxury cover first, native
    // paintCoverSheet fallback). One painter, one call site contract,
    // zero drift possible. Bryn architectural directive:
    //   "surely there should just be one pdf export method, so everything
    //    is consistent"
    //
    // v5.5.77 — Pass the captured floors array into opts as
    // `coverLegendCapture` so _renderCoverJsPdf can aggregate per-floor
    // legends into a project-wide legendTotals shape for the cover RHS.
    // Bryn directive 2026-05-21: "add the legend count total of all
    // floors to the RHS of cover page". Captures the snapshot of
    // legend rows that match what each plan page will render.
    // v5.12.0 (audit #5) — pass the capture via a SHALLOW COPY instead of
    // mutating the caller's opts: the captured[] array holds per-floor
    // 3×-multiplier JPEG dataURLs (potentially tens of MB) and stamping it
    // onto the caller's object pins those snapshots for as long as the
    // caller retains its opts literal.
    const _coverOpts = Object.assign({}, opts, { coverLegendCapture: captured });
    await _renderCoverJsPdf(pdf, _coverOpts, meta, pageTotal, title, 'plans');

    captured.forEach((c, i) => {
      pdf.addPage();
      _emitPlanPageIntoPdf(pdf, {
        title: 'COMBINED PLANS',
        subtitle: c.floor && c.floor.name ? ('Floor ' + (i + 1) + ' of ' + captured.length + ' — ' + c.floor.name) : null,
        legend: c.legend,
        summary: c.summary,
        // v1.32.0 — per-floor pages show per-floor data, so the chip
        // title reads "Floor totals" not "Project totals". Caller can
        // still override via opts.summaryTitle.
        summaryTitle: opts.perFloorSummaryTitle || 'Floor totals',
        dataUrl: c.snap.dataUrl,
        canvasW: c.snap.w,
        canvasH: c.snap.h,
        pageNum: 2 + i,
        pageTotal,
        // v2.0.0 — drawing pages: title block + drawing code COM-NN + notes
        pageCode: 'COM-' + String(i + 1).padStart(2, '0'),
        useTitleBlock: true,
        withNotesColumn: true
      }, Object.assign({}, meta, { floor: c.floor && c.floor.name }));
    });

    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-plans_${stamp}.pdf`;
    try { _applyDocumentMetadata(pdf, meta); } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') setStatus('PDF exported — ' + fname + ' (' + pageTotal + ' pages, legacy style — pass planPages to use unified style)');
    return fname;
  }

  // ---------------------------------------------------------------------
  // v3.1.0 — UNIFICATION: Plans-only via pdf-lib using SAME painter as Full Doc
  // v3.2.0 — UNIFICATION Phase 3: refactored into _renderPlanDeckPdfLib helper
  //          so cctvPlanPdfLib + servicePlanPdfLib + planPdfLib share the
  //          same pipeline. Each one is a thin filter over the same renderer.
  // ---------------------------------------------------------------------
  // Phase 2 + 3 of the PDF unification (PDF-UNIFICATION_2026-05-19.md).
  // Mirrors fullDocumentPdfLib but emits only the page-kinds the caller
  // filters in. Uses _paintPlanPagePdfLib so the visual style is identical
  // to Full Doc — every plan-style change made in that painter cascades to
  // EVERY plan-style export automatically (Plans-only, CCTV-only, Electrical-
  // only, per-service, single-page Plan).
  //
  // Caller MUST supply opts.planPages (the host's _buildPlanPagesForPdfLib
  // output). The plans() / cctvPlan() / servicePlan() / plan() dispatchers
  // only route here when planPages is present + pdf-lib is loaded + opt-in
  // flag is on.
  //
  // cfg:
  //   - pageFilter   fn(planPage, floorEntry) → bool. Default: COM-* only.
  //   - floorFilter  fn(floorEntry) → bool. Default: every floor.
  //   - includeCover bool. Default: true.
  //   - filenamePart string. Default: 'plans'.
  //   - deckTitle    string. Default: opts.title || 'PLANS'.
  //   - statusLabel  string. Default: filenamePart with capital.
  async function _renderPlanDeckPdfLib(opts, cfg) {
    if (!_pdfLibAvailable()) return null;
    cfg = cfg || {};
    const pageFilter   = cfg.pageFilter   || (p => p && (p.pageCode || '').indexOf('COM-') === 0);
    const floorFilter  = cfg.floorFilter  || (() => true);
    const includeCover = cfg.includeCover !== false;
    const filenamePart = cfg.filenamePart || 'plans';
    const statusLabel  = cfg.statusLabel  || (filenamePart.charAt(0).toUpperCase() + filenamePart.slice(1));

    try {
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Embed wordmark ONCE (reused via shared ref on every page).
      let wordmarkRef = null;
      if (window.__SONOR_WORDMARK_PDF__) {
        try {
          const wmStr = String(window.__SONOR_WORDMARK_PDF__);
          const wmBytes = _pdfLibBase64ToBytes(wmStr);
          wordmarkRef = (wmStr.indexOf('image/png') !== -1)
            ? await pdfDoc.embedPng(wmBytes)
            : await pdfDoc.embedJpg(wmBytes);
        } catch (e) { console.warn('[SonorPdf v3.2.0 _renderPlanDeck] wordmark embed failed:', e); }
      }

      const meta = collectProjectMeta();
      const ctx = { fontReg, fontBold, wordmarkRef, meta };

      // ---- Apply filters: trim opts.planPages to the requested subset ----
      const planPages = (Array.isArray(opts.planPages) ? opts.planPages : [])
        .filter(fp => fp && floorFilter(fp))
        .map(fp => Object.assign({}, fp, {
          pages: (Array.isArray(fp.pages) ? fp.pages : []).filter(p => p && pageFilter(p, fp))
        }))
        .filter(fp => fp.pages && fp.pages.length > 0);

      if (!planPages.length) {
        console.warn('[SonorPdf v3.2.0 _renderPlanDeck:' + filenamePart + '] no plan pages match the filter — returning null');
        return null;
      }

      // ---- Embed each floor's bg ONCE (the dedup win — shared XObject) ----
      const planRefsByFloor = new Map();
      for (const fp of planPages) {
        if (!fp || planRefsByFloor.has(fp.floorId)) continue;
        let pdfPageRef = null, pdfPageW = 0, pdfPageH = 0;
        if (fp.planPdfBytes && fp.planPdfBytes.byteLength > 0 && typeof pdfDoc.embedPdf === 'function') {
          try {
            const idx = Math.max(1, fp.planPdfPageIndex || 1) - 1;
            const embedded = await pdfDoc.embedPdf(fp.planPdfBytes, [idx]);
            if (Array.isArray(embedded) && embedded.length) {
              pdfPageRef = embedded[0];
              pdfPageW = (typeof pdfPageRef.width === 'number') ? pdfPageRef.width : (fp.planW || 1);
              pdfPageH = (typeof pdfPageRef.height === 'number') ? pdfPageRef.height : (fp.planH || 1);
            }
          } catch (e) {
            console.warn('[SonorPdf v3.2.0 _renderPlanDeck] embedPdf failed for floor', fp.floorId, e);
          }
        }
        let rasterRef = null;
        if (fp.planDataUrl) {
          try {
            const raw = String(fp.planDataUrl);
            const isPng = raw.indexOf('data:image/png') === 0;
            const bytes = _pdfLibBase64ToBytes(raw);
            rasterRef = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
          } catch (e) {
            console.warn('[SonorPdf v3.2.0 _renderPlanDeck] plan bg embed failed for floor', fp.floorId, e);
          }
        }
        if (pdfPageRef || rasterRef) {
          planRefsByFloor.set(fp.floorId, {
            ref: rasterRef, pdfPageRef, pdfPageW, pdfPageH,
            w: fp.planW || 1, h: fp.planH || 1
          });
        }
      }

      // ---- Page total = optional cover + filtered plan pages ----
      const totalPlanPages = planPages.reduce((acc, fp) =>
        acc + (Array.isArray(fp.pages) ? fp.pages.length : 0), 0);
      const pageTotalEstimate = (includeCover ? 1 : 0) + totalPlanPages;
      let curPageNum = 0;

      // ---- Optional cover page ----
      if (includeCover) {
        curPageNum = 1;
        const deckTitle = cfg.deckTitle || opts.title || statusLabel.toUpperCase();
        const A3_LANDSCAPE = [1190, 842];
        const cover = pdfDoc.addPage(A3_LANDSCAPE);

        // v5.5.64 — FIRST try the HTML/CSS luxury cover (blue gradients).
        // Falls through to the simple native pdf-lib composition only when
        // SonorPdfHtmlCover is unavailable or render fails.
        const htmlOk = await _tryPaintHtmlCoverPdfLib(pdfDoc, cover, ctx,
          Object.assign({}, opts, { title: deckTitle }));
        if (htmlOk) {
          try {
            _paintTitleBlockPdfLib(cover, ctx, {
              meta, pageNum: 1, pageTotal: pageTotalEstimate, pageCode: 'CVR'
            });
          } catch (e) { console.warn('[SonorPdf v5.5.64 _renderPlanDeck] title-block over HTML cover failed:', e); }
          try { _pdfLibPageBorder(cover); } catch (_) {}
        } else {
          // ---- Fallback: simple native pdf-lib cover (legacy v5.5.60 style) ----
          const slate = rgb(0x15 / 255, 0x1A / 255, 0x22 / 255);
          const white = rgb(1, 1, 1);
          cover.drawRectangle({ x: 0, y: 842 - 46, width: 1190, height: 46, color: slate });
          cover.drawText('SONOR — ' + String(deckTitle).toUpperCase(),
            { x: 24, y: 842 - 30, size: 14, font: fontBold, color: white });
          cover.drawText('Project: ' + (meta.name || 'Untitled Takeoff'),
            { x: 24, y: 842 - 100, size: 11, font: fontBold, color: slate });
          if (meta.client) cover.drawText('Client: ' + meta.client,
            { x: 24, y: 842 - 120, size: 10, font: fontReg, color: slate });
          if (meta.address) cover.drawText('Address: ' + meta.address,
            { x: 24, y: 842 - 140, size: 10, font: fontReg, color: slate });
          cover.drawText('Generated: ' + meta.dateUk,
            { x: 24, y: 842 - 160, size: 10, font: fontReg, color: slate });
          const subline = (cfg.coverSubline) ||
            (totalPlanPages + ' page' + (totalPlanPages === 1 ? '' : 's'));
          cover.drawText(String(subline).toUpperCase(),
            { x: 24, y: 842 - 200, size: 10, font: fontBold, color: slate });

          if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
            const dotY = 842 - 260;
            SERVICES.slice(0, 10).forEach((s, i) => {
              if (!s || !s.colour) return;
              const c = _hexToRgb(s.colour);
              cover.drawCircle({
                x: 30 + i * 14, y: dotY, size: 5,
                color: rgb(c.r / 255, c.g / 255, c.b / 255)
              });
            });
          }

          if (wordmarkRef) {
            const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
            const targetW = 110;
            const targetH = targetW * (wmDim.h / wmDim.w);
            cover.drawImage(wordmarkRef, {
              x: 1190 - targetW - 24, y: 842 - 30 - targetH / 2,
              width: targetW, height: targetH
            });
          }

          try {
            _paintTitleBlockPdfLib(cover, ctx, {
              meta, pageNum: 1, pageTotal: pageTotalEstimate, pageCode: 'CVR'
            });
          } catch (e) { console.warn('[SonorPdf v3.2.0 _renderPlanDeck] cover title-block paint failed:', e); }

          try {
            if (meta.status) {
              _pdfLibStatusPill(cover, ctx, meta.status,
                1190 - 240, 36,
                { fontSize: 8.5, padX: 10, padY: 4 });
            }
          } catch (e) { console.warn('[SonorPdf v5.5.60] plansDeck cover status pill failed:', e); }
          try { _pdfLibPageBorder(cover); } catch (_) {}
        }
      }

      // ---- Filtered plan pages — SAME painter as Full Doc ----
      let planPagesAdded = 0;
      for (const fp of planPages) {
        const sharedRefEntry = planRefsByFloor.get(fp.floorId);
        for (const planPage of fp.pages) {
          curPageNum++;
          planPage._pageNum = curPageNum;
          planPage._pageTotal = pageTotalEstimate;
          try {
            const hasInset = (Array.isArray(planPage.legend) && planPage.legend.length)
                          || (planPage.floorTotals && Object.keys(planPage.floorTotals).length);
            const showNotes = planPage.showNotes !== false;
            // v2.6.1 — per-page bg override for bbox-zoomed slices
            let pageBgRef = sharedRefEntry ? sharedRefEntry.ref : null;
            let pageBgPdfRef = (sharedRefEntry && !planPage.planOverrideDataUrl)
              ? sharedRefEntry.pdfPageRef : null;
            if (planPage.planOverrideDataUrl) {
              try {
                const raw = String(planPage.planOverrideDataUrl);
                const isPng = raw.indexOf('data:image/png') === 0;
                const bytes = _pdfLibBase64ToBytes(raw);
                pageBgRef = isPng
                  ? await pdfDoc.embedPng(bytes)
                  : await pdfDoc.embedJpg(bytes);
                pageBgPdfRef = null;
              } catch (e) {
                console.warn('[SonorPdf v3.2.0 _renderPlanDeck] per-page bg override embed failed, falling back to shared:', e);
              }
            }
            const snapW = (planPage.overlayW || (sharedRefEntry && sharedRefEntry.w) || 1);
            const snapH = (planPage.overlayH || (sharedRefEntry && sharedRefEntry.h) || 1);
            const planRect = _pdfLibPlanRect(1190, 842, snapW, snapH, { showNotes, hasInset });
            await _paintPlanPagePdfLib(pdfDoc, ctx, {
              pageTitle: planPage.pageTitle || 'COMBINED PLANS',
              pageHint: planPage.pageHint || (fp.floorName ? ('Floor — ' + fp.floorName) : null),
              drawingCode: planPage.drawingCode || _drawingCode(meta, planPage.pageCode || 'COM-01'),
              aspectAccent: planPage.aspectAccent || ASPECT_ACCENT.plan,
              pageCode: planPage.pageCode || 'COM-01',
              pageNum: curPageNum,
              pageTotal: pageTotalEstimate,
              bgImageRef: pageBgRef,
              bgPdfPageRef: pageBgPdfRef,
              bgImageDim: planRect,
              overlayDataUrl: planPage.overlayDataUrl || null,
              overlayDim: planRect,
              legend: planPage.legend || null,
              floorTotals: planPage.floorTotals || null,
              floorTotalsTitle: planPage.floorTotalsTitle || 'Floor totals',
              footnote: planPage.footnote || null,
              showNotes
            });
            planPagesAdded++;
          } catch (e) {
            console.warn('[SonorPdf v3.2.0 _renderPlanDeck] plan page paint failed:', e);
          }
        }
      }

      // Final pagination pass — rewrites every page-stamp with actual final total
      try { _finalisePaginationPdfLib(pdfDoc, ctx); }
      catch (e) { console.warn('[SonorPdf v3.2.0 _renderPlanDeck] page renumber failed:', e); }

      // v5.5.69 — bake Sonor metadata + debug build stamp before save
      try { _applyDocumentMetadataPdfLib(pdfDoc, meta, { title: opts.title || statusLabel }); } catch (_) {}
      // Save bytes + trigger download
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = meta.date;
      const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const fname = opts.filename || `sonor-${projSlug}-${filenamePart}_${stamp}.pdf`;
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof setStatus === 'function') {
        const dedupTxt = planRefsByFloor.size ? ` · ${planRefsByFloor.size} bg${planRefsByFloor.size === 1 ? '' : 's'} dedup'd` : '';
        const coverTxt = includeCover ? 'cover + ' : '';
        setStatus(`${statusLabel} (unified) exported — ${fname} (${coverTxt}${planPagesAdded} page${planPagesAdded === 1 ? '' : 's'}${dedupTxt} · v3.2.0 same painter as Full Doc)`);
      }
      return fname;
    } catch (err) {
      console.error('[SonorPdf v3.2.0 _renderPlanDeck:' + filenamePart + '] threw — caller will fall back to jsPDF:', err);
      return null;
    }
  }

  // ---- v3.1.0 — Plans-only deck: cover + every COM-* plan page ----
  // Now a one-line filter over _renderPlanDeckPdfLib.
  async function plansPdfLib(opts) {
    return _renderPlanDeckPdfLib(opts, {
      pageFilter:   p => p && (p.pageCode || '').indexOf('COM-') === 0,
      includeCover: true,
      filenamePart: 'plans',
      statusLabel:  'Plans',
      deckTitle:    opts && opts.title || 'PLANS',
      coverSubline: 'FLOOR PLANS DECK'
    });
  }

  // ---- v3.2.0 — CCTV-only: every CCT page across every floor, no cover ----
  // Single-purpose deliverable for the security install team — pages from
  // floors with cameras, each showing FoV cones + camera placements.
  async function cctvPlanPdfLib(opts) {
    return _renderPlanDeckPdfLib(opts, {
      pageFilter:   p => p && (p.pageCode === 'CCT'),
      includeCover: false,
      filenamePart: 'cctv',
      statusLabel:  'CCTV plan'
    });
  }

  // ---- v5.80.0 — WiFi heatmap deck: every WIFI page across floors ----
  async function wifiHeatmapPdfLib(opts) {
    return _renderPlanDeckPdfLib(opts, {
      pageFilter:   p => p && (p.pageCode === 'WIFI'),
      includeCover: false,
      filenamePart: 'wifi-heatmap',
      statusLabel:  'WiFi heatmap'
    });
  }

  // ---- v3.2.0 — Service-only: every SLI-NN page for the requested service ----
  // serviceNn is the 2-digit string ('01' through '10' or '11' for Electrical).
  // Passed via opts.serviceNn so the public servicePlan() shim keeps its
  // (serviceNn, serviceName, opts) signature.
  async function servicePlanPdfLib(opts) {
    const serviceNn = String(opts && opts.serviceNn || '');
    if (!serviceNn) {
      console.warn('[SonorPdf v3.2.0 servicePlanPdfLib] missing opts.serviceNn — returning null');
      return null;
    }
    const sliceTag = 'SLI-' + serviceNn;
    return _renderPlanDeckPdfLib(opts, {
      pageFilter:   p => p && (p.pageCode === sliceTag),
      includeCover: false,
      filenamePart: 'svc' + serviceNn,
      statusLabel:  (opts.serviceName || ('Service ' + serviceNn)) + ' plan'
    });
  }

  // ---- v3.2.0 — Single-page Plan: active floor's COM page only, no cover ----
  // For the lightweight "Plan" toolbar export (one floor, one page, no cover).
  // Caller passes opts.activeFloorId to filter the spec.
  async function planPdfLib(opts) {
    const activeFloorId = opts && opts.activeFloorId;
    return _renderPlanDeckPdfLib(opts, {
      pageFilter:   p => p && (p.pageCode || '').indexOf('COM-') === 0,
      floorFilter:  fp => !activeFloorId || fp.floorId === activeFloorId,
      includeCover: false,
      filenamePart: 'plan',
      statusLabel:  'Plan'
    });
  }

  // v2.0.1 — Final pagination pass. Walks the per-pdf stamp registry
  // (`pdf.__sonorPageStamps__`) and rewrites EVERY page-number stamp with
  // the actual final total. Replaces the v1.99.1 implementation which only
  // overwrote the legacy slate-header right-edge stamp — leaving:
  //   - The new v2.0.0 title-block PAGE cell stale (e.g. "4/14" when total=22)
  //   - Per-service slice pages with no /Y at all (slice path used pageNum:0)
  //   - Cover "Page 1 of <estimate>" still showing the pre-conditional total
  //
  // The registry is populated by paintFooter, paintCoverSheet, _paintTitleBlock,
  // ---- v5.1.8 — Document metadata + display-mode chrome ---------------
  // Sets the PDF Title / Author / Subject / Keywords / Creator so the
  // file appears properly in Adobe Acrobat / macOS Preview / Finder /
  // Spotlight indexing / archival systems. Bryn directive 2026-05-07:
  // "make sure the styling and branding is super swanky" — invisible-
  // until-you-look-at-File-Properties polish that immediately reads as
  // pro-grade. Also sets the display mode to UseOutlines so PDF readers
  // open the document with the bookmarks panel visible by default —
  // every Sonor PDF (cover + sub-aspect + full document) becomes
  // self-navigating.
  //
  // Idempotent: safe to call multiple times. opts.title overrides the
  // default subtitle ("Take-Off"); opts.subject lets per-aspect callers
  // (Rooms / Cables / etc) refine the metadata.
  // ---- v5.5.69 — DEBUG BUILD STAMP -----------------------------------
  // Bryn directive 2026-05-20: "put some kind of code in the pdfs so you
  // can debug against versions to save wasting time guessing every time".
  // Single source of truth for the version + pipeline + flag state at
  // export time. Baked into:
  //   1. PDF metadata Keywords (jsPDF + pdf-lib paths) — extractable via
  //      `pdfinfo` from a single shell command.
  //   2. A 6pt grey caption rendered in the footer band — visually tiny
  //      but readable when zoomed, AND extractable via `pdftotext`.
  // Stamp format (pipe-delimited so it's regex-friendly):
  //   SONOR-BUILD:v5.5.69|engine=jsPDF|cover=html|t=20260520T0820Z|kind=Plans
  // Decode in shell:
  //   pdfinfo file.pdf | grep -o 'SONOR-BUILD:[^|]*|engine=[^|]*|cover=[^|]*|t=[^|]*|kind=[^,]*'
  function _buildStamp(opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    const ver = String(meta.appVersion || 'unknown');
    const engine = opts.engine || (
      (typeof window !== 'undefined' && window.__SONOR_LAST_PDF_PATH__ === 'pdf-lib')
        ? 'pdf-lib' : 'jsPDF'
    );
    const cover = opts.cover || (
      (typeof window !== 'undefined' && window.__SONOR_LAST_COVER_PATH__) || 'native'
    );
    const kind = String(opts.kind || opts.title || 'export')
      .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
    const t = new Date().toISOString()
      .replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 14) + 'Z';
    return 'SONOR-BUILD:v' + ver + '|engine=' + engine
      + '|cover=' + cover + '|t=' + t + '|kind=' + kind;
  }

  function _applyDocumentMetadata(pdf, meta, opts) {
    if (!pdf || typeof pdf.setProperties !== 'function') return;
    opts = opts || {};
    meta = meta || {};
    const projectName = String(meta.name || 'Sonor Take-Off');
    const projectRef  = meta.ref ? ` (${meta.ref})` : '';
    const docKind = String(opts.title || 'Take-Off');
    // v5.5.69 — append the build stamp to Subject so it's grep-able from
    // pdfinfo without polluting the human-readable subject line too much.
    const baseSubject = opts.subject
      || (`${docKind}${projectRef} — ${meta.client || 'Sonor Smart Homes'}`);
    const stamp = _buildStamp({ meta, kind: docKind, engine: 'jsPDF' });
    const subject = baseSubject + ' [' + stamp + ']';
    const keywords = [
      'Sonor', 'Smart Homes', 'CEDIA', docKind, projectName,
      meta.client || '', meta.address || '', meta.ref || '',
      'Take-Off', 'Engineering', 'Site Pack',
      stamp   // v5.5.69 — debug stamp baked into Keywords too
    ].filter(Boolean).join(', ');
    try {
      pdf.setProperties({
        title:    `${projectName} — ${docKind}${projectRef}`,
        subject:  subject,
        author:   'Sonor Smart Homes',
        keywords: keywords,
        creator:  `Sonor Takeoffs v${meta.appVersion || ''}`.trim()
      });
    } catch (e) { console.warn('[SonorPdf v5.1.8] setProperties failed:', e); }
    // UseOutlines — open with bookmarks panel visible (when an outline
    // tree exists). Falls through silently on jsPDF builds that don't
    // support setDisplayMode (older 1.x).
    try {
      if (typeof pdf.setDisplayMode === 'function') {
        // signature: setDisplayMode(zoom, layout, pageMode)
        // 'fullwidth' fits page width; 'continuous' = scrollable;
        // 'UseOutlines' surfaces the bookmark sidebar on open.
        pdf.setDisplayMode('fullwidth', 'continuous', 'UseOutlines');
      }
    } catch (e) { /* non-fatal */ }
  }

  // ---- v5.1.8 — Full-document outline tree (TOC sidebar) -------------
  // Builds a hierarchical PDF outline using jsPDF's outline plugin so
  // every Full Document opens in Acrobat / Preview with a clickable
  // bookmark sidebar. Tree shape:
  //
  //   Cover
  //   Reference
  //     ├─ Cabling Information
  //     └─ Bend Radius Reference
  //   Plans
  //     ├─ Combined Plans (one entry per floor)
  //     ├─ CCTV Coverage  (one entry per floor with cameras)
  //     ├─ Electrical Plan (one entry per floor with electrical)
  //     └─ Per-Service Slices (per-service NN with per-floor children)
  //   Cross-app sections
  //     ├─ Rack Build Sheets
  //     ├─ Schematics
  //     └─ Cinema Construction
  //   Schedules
  //     └─ (one entry per non-empty aspect — Rooms / Zones / etc)
  //
  // entries: array of { title, page, parent? } in the order they appear.
  // The function flattens / nests via the `parent` field if provided.
  function _buildOutlineTree(pdf, entries) {
    if (!pdf || !pdf.outline || typeof pdf.outline.add !== 'function') return;
    if (!Array.isArray(entries) || !entries.length) return;
    const refs = {};  // index → outline-item ref
    try {
      entries.forEach((e, i) => {
        if (!e || !e.title) return;
        const parentRef = (e.parentIdx != null && refs[e.parentIdx])
          ? refs[e.parentIdx]
          : null;
        const ref = pdf.outline.add(parentRef, String(e.title), {
          pageNumber: Math.max(1, e.page || 1)
        });
        refs[i] = ref;
      });
    } catch (e) {
      console.warn('[SonorPdf v5.1.8] outline build failed:', e);
    }
  }

  // and _paintScheduleFooter — every painter that emits a page-number stamp.
  // Each entry is { page, x, y, clearW, clearH, clearOffsetY, format, ... }.
  // After all pages are added, this function:
  //   1. Reads pdf.internal.getNumberOfPages() for the actual final total
  //   2. For each registry entry: setPage, paint a body-colour clear rect,
  //      then re-stamp the correct "N / T" or "Page N of T" string in the
  //      same font/size/alignment as the original.
  // ---- v5.87.0 / v5.89.1 — CONTENTS page painter ----
  // v5.89.1 (Bryn: "stylise and colourcode the contents page? preferably
  // make them active links"): every row is COLOUR-CODED (service colours
  // for service rows, section accents elsewhere) with a swatch pip, a
  // light accent wash behind top-level rows, coloured page numbers — and
  // every row is a CLICKABLE INTERNAL LINK (pdf.link → GoTo page; painted
  // LAST so every target page exists). Same one-source contract: rows come
  // from the outline `entries` array.
  function _tocHexToRgb(hex) {
    try {
      const h = String(hex || '').replace('#', '');
      const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
    } catch (_) { return [71, 81, 97]; }
  }
  function _tocMixWhite(rgb, f) {   // f = colour share (0..1)
    return rgb.map(ch => Math.round(ch * f + 255 * (1 - f)));
  }
  function _tocColourFor(title) {
    const t = String(title || '').toUpperCase();
    const svcs = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) ? SERVICES : [];
    const byNn = (nn) => {
      const s = svcs.find(x => x && x.nn === nn);
      if (s && s.colour) return s.colour;
      return (typeof ASPECT_ACCENT !== 'undefined' && ASPECT_ACCENT['svc_' + nn]) || '#475161';
    };
    const mNn = t.match(/^(\d{2})\b/);
    if (mNn) return byNn(mNn[1]);
    if (t.indexOf('CCTV') !== -1) return byNn('08');
    if (t.indexOf('WIFI') !== -1 || t.indexOf('NETWORK') !== -1) return byNn('09');
    if (t.indexOf('LIGHTING') !== -1 || t.indexOf('LKP') !== -1) return byNn('04');
    if (t.indexOf('ELECTRICAL') !== -1) return byNn('11');
    if (t.indexOf('EXTERNAL') !== -1) return '#78ba57';
    if (t.indexOf('RACK') !== -1 || t.indexOf('POINT-TO-POINT') !== -1 ||
        t.indexOf('CINEMA CONSTRUCTION') !== -1 || t.indexOf('CROSS-APP') !== -1) return '#8058a1';
    if (t.indexOf('SCHEDULE') !== -1 || t.indexOf('OVERALL COUNTS') !== -1) return '#302F2E';
    return '#475161';   // slate — cover/contents/reference/plans default
  }
  // v5.146.0 — CONTENTS THROUGH THE HTML PIPELINE (Bryn: "contents still
  // does not have same header as other pages, fix this once and for all").
  // Every page in the deck now renders through the ONE HTML pipeline; the
  // painter below survives ONLY as the module-missing fallback. Rows +
  // absolute layout are computed HERE from the template's exported
  // CONTENTS_METRICS; the SAME rects drive the clickable pdf.link overlay.
  function _tocTitleCaseDisplay(t) {
    t = String(t || '');
    if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      t = t.toLowerCase().replace(/(^|[\s\-—·(])([a-z])/g, (m0, a, b) => a + b.toUpperCase());
      t = t.replace(/\bWifi\b/g, 'WiFi').replace(/\bCctv\b/g, 'CCTV')
           .replace(/\bLkp\b/g, 'LKP').replace(/\bRfi\b/g, 'RFI')
           .replace(/\bLed\b/g, 'LED').replace(/\bHvac\b/g, 'HVAC');
    }
    return t;
  }
  // v5.198.0 — re-order top-level sections by their first page, keeping
  // each section's children (and grandchildren) attached; parentIdx remapped.
  function _sortContentsEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) return entries;
    const tops = [];
    entries.forEach((en, i) => { if (en && en.parentIdx == null) tops.push({ i, en }); });
    const subtreeOf = (rootI) => {
      const out = []; const stack = [rootI];
      while (stack.length) {
        const cur = stack.shift();
        entries.forEach((en, j) => { if (en && en.parentIdx === cur) { out.push(j); stack.push(j); } });
      }
      return out;
    };
    const firstPage = (t) => {
      let pg = Number(t.en.page) || 0;
      subtreeOf(t.i).forEach(j => { const q = Number(entries[j].page) || 0; if (q && (!pg || q < pg)) pg = q; });
      return pg;
    };
    const ordered = tops.map(t => ({ t, pg: firstPage(t) })).sort((a, b) => a.pg - b.pg || a.t.i - b.t.i);
    const out = [], map = new Map();
    ordered.forEach(({ t }) => {
      map.set(t.i, out.length); out.push(Object.assign({}, t.en));
      subtreeOf(t.i).forEach(j => { map.set(j, out.length); out.push(Object.assign({}, entries[j])); });
    });
    out.forEach(en => { if (en.parentIdx != null) en.parentIdx = map.has(en.parentIdx) ? map.get(en.parentIdx) : null; });
    return out;
  }

  function _contentsRowsAndLayout(entries) {
    const M = (typeof window !== 'undefined' && window.SonorPdfHtmlTemplates
        && window.SonorPdfHtmlTemplates.CONTENTS_METRICS)
      || { pageW: 1190, pageH: 842, headerH: 47, footerH: 32, bodyTop: 66,
           sidePad: 36, colGap: 36, rowHTop: 24, rowHChild: 17, bottomPad: 14 };
    const depthOf = (en) => {
      let d = 0, cur = en, g = 0;
      while (cur && cur.parentIdx != null && g++ < 8) { d++; cur = entries[cur.parentIdx]; }
      return d;
    };
    const tops = [];
    (entries || []).forEach((en, i) => {
      if (!en || !en.title) return;
      const d = depthOf(en);
      if (d === 0) tops.push({ en, idx: i, kids: [] });
      else if (d === 1) {
        const t = tops.find(t2 => t2.idx === en.parentIdx);
        if (t) t.kids.push(en);
      }
    });
    const flat = [];
    tops.forEach(t => {
      t.kids.sort((a, b) => (a.page || 0) - (b.page || 0));
      const first = t.kids.length ? (t.kids[0].page || null) : null;
      flat.push({ title: t.en.title, page: first || t.en.page, depth: 0 });
      t.kids.forEach(k => flat.push({ title: k.title, page: k.page, depth: 1 }));
    });
    const colW = (M.pageW - M.sidePad * 2 - M.colGap) / 2;
    const yMax = M.pageH - M.footerH - M.bottomPad;
    let col = 0, y = M.bodyTop;
    const rows = [];
    flat.forEach(r => {
      const hRow = r.depth === 0 ? M.rowHTop : M.rowHChild;
      if (y + hRow > yMax) { col++; y = M.bodyTop; }
      if (col > 1) return;   // overflow safeguard — outline sidebar has the rest
      const hex = _tocColourFor(r.title);
      const rgb = _tocHexToRgb(hex);
      const wash = _tocMixWhite(rgb, 0.10);
      rows.push({
        label: _tocTitleCaseDisplay(r.title), page: r.page, depth: r.depth,
        x: M.sidePad + col * (colW + M.colGap), y: y, w: colW, h: hRow - 3,
        barHex: hex,
        washRgba: 'rgba(' + wash[0] + ',' + wash[1] + ',' + wash[2] + ',1)',
        headCss: 'rgb(' + Math.round(rgb[0] * 0.75) + ',' + Math.round(rgb[1] * 0.75) + ',' + Math.round(rgb[2] * 0.75) + ')'
      });
      y += hRow;
    });
    return { rows, M };
  }
  async function _emitContentsPageHtml(pdf, meta, entries, pageTotal) {
    if (!(typeof window !== 'undefined' && window.SonorPdfHtmlCover
          && typeof window.SonorPdfHtmlCover.renderContents === 'function'
          && typeof window.SonorPdfHtmlCover.available === 'function'
          && window.SonorPdfHtmlCover.available())) return false;
    const { rows, M } = _contentsRowsAndLayout(entries);
    let realTotal = pageTotal;
    try { realTotal = pdf.internal.getNumberOfPages() || pageTotal; } catch (_) {}
    const result = await window.SonorPdfHtmlCover.renderContents({
      accentHex: '#ad9978',   // SONOR GOLD — doc accent (service pages carry their own)
      sectionTitle: 'CONTENTS',
      appName: 'Takeoffs',
      status: meta.status,
      reference: meta.ref || '',
      projectName: meta.name,
      client: meta.client,
      address: meta.address,
      revision: meta.revision,
      issueDate: meta.dateUk || meta.date,
      pageNum: 2, pageTotal: realTotal,
      footerSlim: true,
      rows
    });
    if (!result || !result.dataUrl) return false;
    let prevPage = null;
    try { prevPage = pdf.internal.getCurrentPageInfo().pageNumber; } catch (_) {}
    pdf.setPage(2);
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.addImage(result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'contents-html');
    // Clickable rows — the SAME rects the template rendered (scaled pt/px).
    const sx = pageW / M.pageW, sy = pageH / M.pageH;
    rows.forEach(r => {
      try {
        if (r.page && typeof pdf.link === 'function') {
          pdf.link(r.x * sx, r.y * sy, r.w * sx, r.h * sy, { pageNumber: r.page });
        }
      } catch (_) {}
    });
    if (prevPage) { try { pdf.setPage(prevPage); } catch (_) {} }
    return true;
  }

  function _paintContentsPage(pdf, meta, entries, pageTotal) {
    // v5.144.0 REWRITE (Bryn: "contents does not render in same way as all
    // the other pages and to bring it in line with all other formatting") —
    // the chrome now mirrors the HTML body pages exactly:
    //   · header = .page-header equivalent (chrome #0a1929, 44pt band,
    //     "TAKEOFFS · CONTENTS" letterspaced, 3pt SONOR-GOLD accent stripe
    //     — the doc accent; service pages carry their service colour)
    //   · footer = .page-footer-slim equivalent (navy 32pt strip:
    //     project · ref | PAGE 2 OF N | issue date) — the heavy painted
    //     title block is gone (it matched nothing else in the deck)
    //   · rows resequence into PAGE ORDER (registry order used to leak
    //     through: WIFI 35 listed above ELECTRICAL PLAN 14), each section
    //     row inherits its FIRST CHILD's page ("Per-service blocks 12"
    //     while its children started at 22), ALL-CAPS registry titles are
    //     title-cased for a consistent read.
    //   · page total reads the REAL final page count (the deck is fully
    //     assembled when this paints) rather than the precount estimate.
    // Colour-coded rows + clickable GoTo links (v5.89.1) preserved.
    let prevPage = null;
    try { prevPage = pdf.internal.getCurrentPageInfo().pageNumber; } catch (_) {}
    pdf.setPage(2);
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    let realTotal = pageTotal;
    try { realTotal = pdf.internal.getNumberOfPages() || pageTotal; } catch (_) {}
    try { _paintPageBorder(pdf); } catch (_) {}
    // ---- header band (mirrors .page-header) ----
    pdf.setFillColor(10, 25, 41);            // --chrome-solid-deep #0a1929
    pdf.rect(0, 0, W, 44, 'F');
    pdf.setFillColor(173, 153, 120);         // SONOR GOLD doc-accent stripe
    pdf.rect(0, 44, W, 3, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('TAKEOFFS', 28, 27, { charSpace: 1.9 });
    let hx = 28 + pdf.getTextWidth('TAKEOFFS') + 8 * 1.9 + 12;
    pdf.setTextColor(140, 150, 162);
    pdf.setFont('helvetica', 'normal');
    pdf.text('·', hx, 27);
    hx += 10;
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('CONTENTS', hx, 27, { charSpace: 1.7 });
    // ---- resequence entries: sections in original order, children by page
    const depthOf = (en) => {
      let d = 0, cur = en, guard = 0;
      while (cur && cur.parentIdx != null && guard++ < 8) { d++; cur = entries[cur.parentIdx]; }
      return d;
    };
    const tops = [];
    (entries || []).forEach((en, i) => {
      if (!en || !en.title) return;
      const d = depthOf(en);
      if (d === 0) tops.push({ en, idx: i, kids: [] });
      else if (d === 1) {
        const t = tops.find(t2 => t2.idx === en.parentIdx);
        if (t) t.kids.push(en);
      }
    });
    const rows = [];
    tops.forEach(t => {
      t.kids.sort((a, b) => (a.page || 0) - (b.page || 0));
      const first = t.kids.length ? (t.kids[0].page || null) : null;
      rows.push({ title: t.en.title, page: first || t.en.page, depth: 0 });
      t.kids.forEach(k => rows.push({ title: k.title, page: k.page, depth: 1 }));
    });
    // ALL-CAPS registry titles → title case (consistent with named rows)
    const _tc = (t) => {
      t = String(t || '');
      if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
        t = t.toLowerCase().replace(/(^|[\s\-—·(])([a-z])/g, (m0, a, b) => a + b.toUpperCase());
        t = t.replace(/\bWifi\b/g, 'WiFi').replace(/\bCctv\b/g, 'CCTV')
             .replace(/\bLkp\b/g, 'LKP').replace(/\bRfi\b/g, 'RFI')
             .replace(/\bLed\b/g, 'LED').replace(/\bHvac\b/g, 'HVAC');
      }
      return t;
    };
    // ---- paint rows (two columns, colour-coded, linked) ----
    const FOOT_H = 32;
    const colW = (W - 96) / 2;
    const xCols = [36, 36 + colW + 24];
    const yTop = 70;
    const yBottom = H - FOOT_H - 18;
    let col = 0, y = yTop;
    rows.forEach(r => {
      const depth = r.depth;
      const lineH = depth === 0 ? 16.5 : 12.5;
      if (y + lineH > yBottom) {
        col++;
        if (col > 1) return;   // overflow safeguard — outline sidebar has the rest
        y = yTop;
      }
      const rgb = _tocHexToRgb(_tocColourFor(r.title));
      const xBase = xCols[col];
      const x = xBase + (depth ? 18 : 10);
      const pageX = xBase + colW - 4;
      if (depth === 0) {
        const wash = _tocMixWhite(rgb, 0.10);
        pdf.setFillColor(wash[0], wash[1], wash[2]);
        pdf.rect(xBase - 4, y - 9.5, colW + 8, 13.5, 'F');
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.rect(xBase - 4, y - 9.5, 2.5, 13.5, 'F');
      } else {
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.circle(xBase + 10, y - 2.8, 1.6, 'F');
      }
      pdf.setFont('helvetica', depth === 0 ? 'bold' : 'normal');
      pdf.setFontSize(depth === 0 ? 9.5 : 8.2);
      if (depth === 0) pdf.setTextColor(Math.round(rgb[0] * 0.75), Math.round(rgb[1] * 0.75), Math.round(rgb[2] * 0.75));
      else pdf.setTextColor(90, 90, 90);
      let label = _tc(r.title);
      const maxLabelW = colW - 50 - (depth ? 18 : 10);
      while (label.length > 4 && pdf.getTextWidth(label) > maxLabelW) label = label.slice(0, -2);
      pdf.text(label, x, y);
      const pStr = String(r.page || '');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(depth === 0 ? 9 : 8);
      pdf.setTextColor(48, 47, 46);   // charcoal numbers (v5.142.0 directive)
      pdf.text(pStr, pageX, y, { align: 'right' });
      try {
        const lx0 = x + pdf.getTextWidth(label) + 6;
        const lx1 = pageX - pdf.getTextWidth(pStr) - 6;
        if (lx1 > lx0 + 8) {
          pdf.setDrawColor(48, 47, 46);   // charcoal leaders (uniform)
          pdf.setLineWidth(0.4);
          pdf.setLineDashPattern([0.6, 2.2], 0);
          pdf.line(lx0, y - 2.6, lx1, y - 2.6);
          pdf.setLineDashPattern([], 0);
        }
      } catch (_) {}
      try {
        if (r.page && typeof pdf.link === 'function') {
          pdf.link(xBase - 4, y - 9.5, colW + 8, lineH, { pageNumber: r.page });
        }
      } catch (_) {}
      y += lineH;
    });
    // ---- slim footer strip (mirrors .page-footer-slim) ----
    pdf.setTextColor(150, 150, 150);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.text('Sections are clickable', 36, H - FOOT_H - 7);
    pdf.setFillColor(10, 25, 41);
    pdf.rect(0, H - FOOT_H, W, FOOT_H, 'F');
    const fy = H - FOOT_H / 2 + 2.8;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(196, 202, 210);
    pdf.text(String(meta.name || '') + (meta.ref ? ' · ' + meta.ref : ''), 28, fy);
    const capCol = [140, 150, 162], numCol = [238, 240, 244];
    const midParts = [
      ['PAGE ', capCol, 'normal', 7.5], ['2', numCol, 'bold', 8.5],
      [' OF ', capCol, 'normal', 7.5], [String(realTotal), numCol, 'bold', 8.5]
    ];
    let midW = 0;
    midParts.forEach(pt => { pdf.setFont('helvetica', pt[2]); pdf.setFontSize(pt[3]); midW += pdf.getTextWidth(pt[0]); });
    let mx = (W - midW) / 2;
    midParts.forEach(pt => {
      pdf.setFont('helvetica', pt[2]);
      pdf.setFontSize(pt[3]);
      pdf.setTextColor(pt[1][0], pt[1][1], pt[1][2]);
      pdf.text(pt[0], mx, fy);
      mx += pdf.getTextWidth(pt[0]);
    });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(196, 202, 210);
    // v5.151.0 (Bryn: "put the rev number before the date in all the footers")
    pdf.text('REV ' + String(meta.revision || '00') + '   ·   ' + String(meta.dateUk || meta.date || ''), W - 28, fy, { align: 'right' });
    if (prevPage) { try { pdf.setPage(prevPage); } catch (_) {} }
  }

  // ---- v2.9.0 FULL DOCUMENT — PAGE NUMBERS FROM THE FINAL COUNT ----------------------------------------------------
  // HTML pages carry their "PAGE n of T" baked into the raster, numbered from the precount (_planFinalTotal) when they
  // render. When the precount drifts (a per-service slice that comes back empty, a dropped section) those numbers are
  // wrong and _finalisePagination cannot reach them (it rewrites only native jsPDF stamps). Second pass: every
  // html-cover page added to this document registers the stamp sonor-pdf-html-cover 1.12.0 measured (text box, type,
  // colours, a clean background patch sampled from the raster). After assembly, a page whose baked number differs from
  // its real page / the real total gets the patch over the old number and the true one drawn in the same place, type
  // and colour. A page that was right is never touched; a page with no stamp is left as rendered.
  function _trackHtmlPageStamps(pdf) {
    if (!pdf || pdf.__sonorHtmlStamps__ || typeof pdf.addImage !== 'function') return;
    pdf.__sonorHtmlStamps__ = [];
    const orig = pdf.addImage;
    pdf.addImage = function (data, fmt, x, y, w, h) {
      const r = orig.apply(this, arguments);
      try {
        const H = (typeof window !== 'undefined') ? window.SonorPdfHtmlCover : null;
        if (typeof data === 'string' && !x && !y && w > 0 && h > 0 && H && typeof H.stampFor === 'function') {
          const st = H.stampFor(data);
          if (st && st.vw && st.vh) pdf.__sonorHtmlStamps__.push({ page: pdf.internal.getCurrentPageInfo().pageNumber, st: st, sx: w / st.vw, sy: h / st.vh });
        }
      } catch (_) {}
      return r;
    };
  }
  function _restampHtmlPageNumbers(pdf, total) {
    const list = pdf && pdf.__sonorHtmlStamps__;
    if (!list || !list.length) return 0;
    try { total = total || pdf.internal.getNumberOfPages(); } catch (_) { return 0; }
    let cur = null; try { cur = pdf.internal.getCurrentPageInfo().pageNumber; } catch (_) {}
    const byPage = {};
    list.forEach(e => { if (e && e.page) byPage[e.page] = e; });   // the last image on a page wins (contents is re-painted at the end)
    const fam = _pdfFontFamily();
    let n = 0;
    Object.keys(byPage).forEach(k => {
      const page = +k, e = byPage[k], st = e.st;
      if (!(page >= 1 && page <= total)) return;
      if (st.num === page && st.total === total) return;
      if (!st.patch || !st.patch.url) return;
      try {
        pdf.setPage(page);
        const sx = e.sx, sy = e.sy, P = st.patch;
        pdf.addImage(P.url, 'JPEG', P.x * sx, P.y * sy, P.w * sx, P.h * sy, 'pgstamp-' + page);
        const capT = st.cap || st.digits, dig = st.digits;
        const capStyle = (capT.weight || 400) >= 700 ? 'bold' : ((capT.weight || 400) >= 500 ? 'medium' : 'normal');
        const hasStyle = (style) => { try { const fl = pdf.getFontList ? pdf.getFontList() : null; return !fl || !fl[fam] || fl[fam].indexOf(style) >= 0; } catch (_) { return true; } };
        const cs = hasStyle(capStyle) ? capStyle : 'normal';
        const parts = [
          { t: capT.upper ? 'PAGE' : 'Page', style: cs, size: capT.px * sx, cs: (capT.ls || 0) * sx, rgb: st.capRgb },
          { t: String(page), style: 'bold', size: dig.px * sx, cs: (dig.ls || 0) * sx, rgb: st.digitsRgb },
          { t: capT.upper ? 'OF' : 'of', style: cs, size: capT.px * sx, cs: (capT.ls || 0) * sx, rgb: st.capRgb },
          { t: String(total), style: 'bold', size: dig.px * sx, cs: (dig.ls || 0) * sx, rgb: st.digitsRgb }
        ];
        // gaps between the pieces as the footer laid them out (measured), else one space of the footer's own type
        const M = (Array.isArray(st.parts) && st.parts.length === 4) ? st.parts : null;
        const gaps = [0, 1, 2].map(i => M ? Math.max(0, (M[i + 1].l - M[i].r)) * sx : (st.mid ? st.mid.px : dig.px) * sx * 0.28);
        parts.forEach(p => { pdf.setFont(fam, p.style); pdf.setFontSize(p.size); p.w = pdf.getTextWidth(p.t) + p.cs * p.t.length; });
        const totalW = parts.reduce((a, p) => a + p.w, 0) + gaps.reduce((a, g) => a + g, 0);
        let x = st.cx * sx - totalW / 2;
        parts.forEach((p, i) => {
          pdf.setFont(fam, p.style); pdf.setFontSize(p.size);
          const c = p.rgb || [255, 255, 255]; pdf.setTextColor(c[0], c[1], c[2]);
          const box = M ? M[i] : null;
          const base = box ? ((box.t + box.b) / 2) * sy + p.size * 0.35 : st.cy * sy + p.size * 0.35;
          pdf.text(p.t, x, base, p.cs ? { charSpace: p.cs } : undefined);
          x += p.w + (gaps[i] || 0);
        });
        n++;
      } catch (err) { try { console.warn('[SonorPdf v2.9.0] page-number restamp failed on page ' + page + ':', err); } catch (_) {} }
    });
    try { if (cur) pdf.setPage(cur); } catch (_) {}
    try { pdf.setCharSpace && pdf.setCharSpace(0); } catch (_) {}
    if (n) { try { console.info('[SonorPdf v2.9.0] restamped ' + n + ' HTML page number(s) to the final total ' + total + '.'); } catch (_) {} }
    return n;
  }

  function _finalisePagination(pdf, meta) {
    const total = pdf.internal.getNumberOfPages();
    if (!total || total < 1) return;
    const stamps = pdf.__sonorPageStamps__ || [];
    const ver = (meta && meta.appVersion) ? meta.appVersion : '';

    // ---- Pass 1: walk the explicit registry ----
    let regTouched = 0;
    stamps.forEach(s => {
      try {
        if (!s || !s.page || s.page < 1 || s.page > total) return;
        // v5.4.30 — 'noop' format is a presence-only stamp used to
        // suppress Pass 2 fallback on pages where the visible chrome
        // (e.g. HTML cover) carries its own page reference. Touched=true
        // (so the page isn't picked up by Pass 2) but rewriter does
        // nothing — no white rect, no text.
        if (s.format === 'noop') { regTouched++; return; }
        pdf.setPage(s.page);
        const pageW = pdf.internal.pageSize.getWidth();
        // Clear rect — body colour (#FFFFFF for v2.0.0 schema, falls back to
        // light grey-tint where slate-cover header sits at a different rgb).
        const clearW = s.clearW || 100;
        const clearH = s.clearH || 12;
        const offY  = (s.clearOffsetY != null) ? s.clearOffsetY : -9;
        let rectX;
        if (s.align === 'right') rectX = s.x - clearW;
        else                     rectX = s.x;
        // Cover's brand strip is dark — use slate fill so the patch blends.
        if (s.source === 'cover') {
          pdf.setFillColor(20, 26, 36);   // slate-near-black, matches brand strip
        } else {
          pdf.setFillColor(255, 255, 255);  // white, matches v2.0.0 body fill
        }
        pdf.rect(rectX, s.y + offY, clearW, clearH, 'F');

        // Re-stamp text
        pdf.setFont(_pdfFontFamily(), s.bold ? 'bold' : 'normal');
        pdf.setFontSize(s.fontSize || 8);
        if (s.textColor) {
          const c = _hexToRgb(s.textColor);
          pdf.setTextColor(c.r, c.g, c.b);
        } else if (s.source === 'cover') {
          pdf.setTextColor(122, 128, 144);  // muted-on-slate
        } else if (s.source === 'titleblock') {
          pdf.setTextColor(26, 31, 40);     // COLOURS.text
        } else {
          pdf.setTextColor(99, 108, 122);   // COLOURS.muted
        }
        let txt;
        if (s.format === 'numslash') {
          txt = s.page + ' / ' + total;
        } else if (s.format === 'count-of') {
          // v5.4.25 — "N of T" inline format used by paintFooter CELL C
          // ("Page: N of T") so the title-block page reference rewrites
          // alongside the slim bottom-strip stamp.
          txt = s.page + ' of ' + total;
        } else if (s.format === 'cover-page-of' || s.format === 'sched-page-of') {
          txt = 'Page ' + s.page + ' of ' + total;
        } else if (s.format === 'footer-page-of-version') {
          txt = 'Page ' + s.page + ' of ' + total
                + (ver ? ('   ·   Sonor Takeoffs v' + ver) : '');
        } else {
          txt = s.page + ' / ' + total;
        }
        if (s.align === 'right') pdf.text(txt, s.x, s.y, { align: 'right' });
        else                     pdf.text(txt, s.x, s.y);
        regTouched++;
      } catch (e) { /* non-fatal — skip this stamp */ }
    });

    // ---- Pass 2: legacy fallback for any page that has zero registered ----
    // stamps but still carries a v1.99.1-style "Page X of Y · Sonor Takeoffs"
    // string at the right-edge baseline. Per-service slice pages emitted with
    // pageNum:0 land here. Touches every page that wasn't touched by Pass 1.
    const touchedPages = {};
    stamps.forEach(s => { if (s && s.page) touchedPages[s.page] = true; });
    for (let i = 1; i <= total; i++) {
      if (touchedPages[i]) continue;
      try {
        pdf.setPage(i);
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const wRect = 220, hRect = 14;
        const xRect = pageW - wRect - 6;
        const yRect = pageH - 18;
        pdf.setFillColor(255, 255, 255);
        pdf.rect(xRect, yRect, wRect, hRect, 'F');
        pdf.setFont(_pdfFontFamily(), 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(99, 108, 122);
        const pageStr = 'Page ' + i + ' of ' + total
                        + (ver ? ('   ·   Sonor Takeoffs v' + ver) : '');
        pdf.text(pageStr, pageW - 12, pageH - 9, { align: 'right' });
      } catch (e) { /* non-fatal */ }
    }

    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[SonorPdf v2.0.1] _finalisePagination: ' + regTouched
        + ' registered stamps + ' + (total - Object.keys(touchedPages).length)
        + ' fallback pages renumbered (total=' + total + ').');
    }
  }

  // v1.30.0 — FULL DOCUMENT export: cover + plan + every aspect take-off
  // in one PDF. Mirrors Caldy 78-page reference (cover → plans → all
  // takeoffs). Aspects passed as an ordered array via opts.aspects =
  // [{ aspect, title, report, summary, summaryTitle, totals, groupBy,
  // colWeights }, ...]. Skips aspects with no rows. A3 landscape
  // throughout so wide tables (Shades 14 col) fit without truncation.
  // Page numbering tracks the total deck (cover=1, plan=2, then aspects
  // continue 3, 4, 5...).
  // v1.31.0 — async + multi-floor canvas walk. Captures every floor's
  // snapshot via _captureAllFloors() before assembling the deck so the
  // PDF generation itself stays synchronous (jsPDF.addImage is sync).
  // ============================================================
  // v2.4.0 — pdf-lib INFRASTRUCTURE (Apify research v2 Path C)
  // ============================================================
  // Per reports/PDF-RENDERING-RESEARCH-V2_2026-04-28.md: jsPDF assembly
  // CANNOT access PDF-spec XObject `/Do` references (the format's native
  // image-dedup primitive). pdf-lib exposes them directly — one
  // pdfDoc.embedJpg(bytes) returns one PDFRef, N page.drawImage(ref) calls
  // write N `/Do` operators referencing the same XObject. Result: 22 A3
  // pages with 8 MB plan + vector overlay → ~3.5 MB (internal benchmark).
  //
  // Feature flag (default OFF in v2.4.0 — migration is incremental):
  //   localStorage 'takeoffs-pdf-lib' = '1'   → opt in to pdf-lib assembly
  //   localStorage 'takeoffs-pdf-lib' = '0'   → force jsPDF (default)
  //   absent                                  → jsPDF (v2.3.3 baseline)
  //
  // What v2.4.0 DELIVERS:
  //   ✓ pdf-lib CDN loaded (https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1)
  //   ✓ _pdfLibAvailable() detector + _pdfLibBase64ToBytes() helper
  //   ✓ fullDocumentPdfLib() entry point — opt-in via flag, try/catch
  //     wraps to v2.3.3 jsPDF path on any error
  //   ✓ Plan image dedup via embedJpg + drawImage shared PDFRef
  //   ✓ Bridge from existing jsPDF chrome painters via per-page canvas
  //     snapshot → embedJpg → drawImage (single dedup-eligible image
  //     per CHROME, not per page; plan canvas already deduped separately)
  //
  // What v2.4.x PATCH SERIES will deliver (queued, not in v2.4.0):
  //   • Native vector text on schedule pages via page.drawText (searchable)
  //   • Native vector cover sheet (drawText + drawRectangle)
  //   • Cabling Info + Bend Radii pages as pure vector
  //   • Title block + footer band as native vector
  //   • Default-on once paint-code migration verifies parity
  //
  // Architecture: pdf-lib doc owns the page list + image refs; jsPDF
  // continues to render chrome (via offscreen jsPDF instance whose pages
  // are flattened to JPEG and drawImage'd into the pdf-lib page). This
  // gives us XObject dedup TODAY without breaking the existing chrome.
  function _pdfLibAvailable() {
    // v2.8.2 ROOT-CAUSE FIX: pre-v2.8.2 checked `typeof PDFDocument === 'object'`,
    // but PDFDocument is a CLASS (constructor function). `typeof ClassName`
    // returns 'function', NOT 'object'. The old check ALWAYS returned false
    // when pdf-lib WAS loaded — fullDocument's gate `if (_pdfLibFlagOn() &&
    // _pdfLibAvailable())` silently fell through to jsPDF every time.
    // Bryn confirmed via Producer field "jsPDF 2.5.1" in v2.5.0+ exports.
    // Fix: check for `.create` static method directly — the only thing we
    // actually need from PDFDocument is the static .create() factory.
    const ok = typeof window !== 'undefined'
      && window.PDFLib
      && window.PDFLib.PDFDocument
      && typeof window.PDFLib.PDFDocument.create === 'function';
    try {
      if (!ok) {
        console.warn('[Sonor PDF v2.8.2] _pdfLibAvailable=false — diagnostic:', {
          hasWindow: typeof window !== 'undefined',
          hasPDFLib: typeof window !== 'undefined' && !!window.PDFLib,
          hasPDFDocument: typeof window !== 'undefined' && !!(window.PDFLib && window.PDFLib.PDFDocument),
          typeofPDFDocument: typeof window !== 'undefined' && window.PDFLib ? typeof window.PDFLib.PDFDocument : 'n/a',
          typeofCreate: typeof window !== 'undefined' && window.PDFLib && window.PDFLib.PDFDocument ? typeof window.PDFLib.PDFDocument.create : 'n/a'
        });
      }
    } catch (_) {}
    return ok;
  }

  // ---- v5.5.69 — pdf-lib metadata helper (mirrors _applyDocumentMetadata) ----
  // pdf-lib paths historically left Creator as "pdf-lib (https://github.com/...)".
  // This bakes Sonor's metadata + the debug build stamp into pdfDoc so an
  // exported file is identifiable via `pdfinfo` no matter which engine
  // produced it. Call once just before pdfDoc.save() in every pdf-lib
  // entry point (fullDocumentPdfLib, plansPdfLib, cctvPlanPdfLib,
  // servicePlanPdfLib, planPdfLib, aspectPdfLib).
  function _applyDocumentMetadataPdfLib(pdfDoc, meta, opts) {
    if (!pdfDoc) return;
    opts = opts || {};
    meta = meta || {};
    const projectName = String(meta.name || 'Sonor Take-Off');
    const projectRef  = meta.ref ? ` (${meta.ref})` : '';
    const docKind = String(opts.title || 'Take-Off');
    const stamp = _buildStamp({ meta, kind: docKind, engine: 'pdf-lib' });
    const baseSubject = opts.subject
      || (`${docKind}${projectRef} — ${meta.client || 'Sonor Smart Homes'}`);
    try {
      if (typeof pdfDoc.setTitle === 'function')
        pdfDoc.setTitle(`${projectName} — ${docKind}${projectRef}`);
      if (typeof pdfDoc.setAuthor === 'function')
        pdfDoc.setAuthor('Sonor Smart Homes');
      if (typeof pdfDoc.setSubject === 'function')
        pdfDoc.setSubject(baseSubject + ' [' + stamp + ']');
      if (typeof pdfDoc.setKeywords === 'function')
        pdfDoc.setKeywords([
          'Sonor', 'Smart Homes', 'CEDIA', docKind, projectName,
          meta.client || '', meta.address || '', meta.ref || '',
          'Take-Off', 'Engineering', 'Site Pack',
          stamp
        ].filter(Boolean));
      if (typeof pdfDoc.setCreator === 'function')
        pdfDoc.setCreator(`Sonor Takeoffs v${meta.appVersion || ''}`.trim());
      if (typeof pdfDoc.setProducer === 'function')
        pdfDoc.setProducer(`Sonor PDF Pipeline (pdf-lib)`);
    } catch (e) { console.warn('[SonorPdf v5.5.69] pdf-lib setMetadata failed:', e); }
  }

  function _pdfLibBase64ToBytes(b64) {
    // Strip data:URL prefix if present, decode base64 → Uint8Array.
    const raw = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    const bin = (typeof atob === 'function') ? atob(raw) : '';
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function _pdfLibFlagOn() {
    // v5.5.71 — REVERTED to default OFF (again). Bryn 2026-05-20 v5.5.70
    // verdict: "no, header and footer is wrong" + "black space on plan".
    // The pdf-lib `_paintPlanPagePdfLib` uses a 28pt slate header band +
    // simple 5-col footer; the jsPDF `_emitPlanPageIntoPdf` (legacy v5.4.0
    // path) has the proper gradient hero header + v1.23.0 roomy 5-col
    // footer with wordmark + service dots. Until pdf-lib painter parity
    // lands (gradient hero, roomy footer, no bg/overlay aspect mismatch),
    // legacy jsPDF is the canonical default.
    //
    // The black-on-plan bug in pdf-lib path is a bg/overlay aspect
    // mismatch — jsPDF's full-canvas snapshot doesn't have it because
    // there's only one image (the whole canvas) drawn at one rect.
    //
    // What's preserved post-revert (still engaged in jsPDF path):
    //   ✅ v5.5.66 per-floor live builders — wired in jsPDF path too
    //      (host handler passes window._sonorBuildLegendForActive +
    //      window._sonorBuildSummaryForActive to opts.buildLegendForActive)
    //   ✅ v5.5.69 SONOR-BUILD stamp — added at _applyDocumentMetadata
    //      + jsPDF paintFooter caption (both still active)
    //   ✅ v5.5.65 sonor-pdf-chrome.js module — still loaded for future apps
    //
    // pdf-lib codebase + sonor-pdf-chrome.js stay available for opt-in
    // dev work. When pdf-lib painter parity matches v5.4.0 + v1.23.0
    // jsPDF style, this default flips back via one-line change.
    try {
      if (typeof localStorage === 'undefined') return false;
      if (localStorage.getItem('takeoffs-pdf-lib-disable') === '1') return false;
      if (localStorage.getItem('takeoffs-pdf-lib') === '1') {
        try { console.warn('[Sonor PDF v' + SONOR_PDF_VERSION + '] takeoffs-pdf-lib=1 → opt-in pdf-lib (NOT default — painter parity pending)'); } catch (_) {}
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // v5.12.0 — _pdfLibBridgeJsPdfPageToJpeg deleted (dead): the v2.4.0
  // stop-gap always returned null, the "full bridge" never shipped, and
  // the spec-driven pdf-lib painters superseded the whole bridge idea.

  // ---- v2.4.1 — pdf-lib helpers (alignment + colour) ----
  // pdf-lib drawText has no native align — we measure width via
  // font.widthOfTextAtSize(text, size) and shift x ourselves. Wrappers below
  // mirror the jsPDF helpers used throughout the legacy painters so the new
  // pdf-lib painters can be ported function-for-function with minimal drift.
  function _pdfLibRgbHex(hex) {
    if (!window.PDFLib || !window.PDFLib.rgb) return null;
    const c = _hexToRgb(hex);
    return window.PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255);
  }
  function _pdfLibDrawText(page, text, x, y, opts) {
    opts = opts || {};
    const font = opts.font;
    const size = opts.size || 9;
    const colour = opts.colour || _pdfLibRgbHex('#000000');
    const align = opts.align || 'left';
    const w = (opts.maxWidth != null) ? opts.maxWidth : null;
    const s = String(text == null ? '' : text);
    if (!s) return;
    let drawX = x;
    if (font && align !== 'left') {
      const tw = font.widthOfTextAtSize(s, size);
      if (align === 'right') {
        drawX = (w != null) ? (x + w - tw) : (x - tw);
      } else if (align === 'centre' || align === 'center') {
        drawX = (w != null) ? (x + (w - tw) / 2) : (x - tw / 2);
      }
    }
    page.drawText(s, { x: drawX, y, size, font, color: colour });
  }
  function _pdfLibDrawRect(page, x, y, w, h, color, opts) {
    opts = opts || {};
    const args = { x, y, width: w, height: h };
    if (color) args.color = color;
    if (opts.borderColor) args.borderColor = opts.borderColor;
    if (opts.borderWidth) args.borderWidth = opts.borderWidth;
    if (opts.opacity != null) args.opacity = opts.opacity;
    page.drawRectangle(args);
  }
  // v5.12.0 — _pdfLibY deleted (dead, zero callers): painters convert
  // top-down→bottom-up Y inline per-call instead.
  // pdf-lib word-wrap (no native splitTextToSize). Returns array of lines.
  function _pdfLibSplitText(font, size, text, maxW) {
    const s = String(text == null ? '' : text);
    if (!s) return [''];
    if (font.widthOfTextAtSize(s, size) <= maxW) return [s];
    const words = s.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(word => {
      const candidate = cur ? cur + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        // Word itself longer than maxW — hard-break per-character.
        if (font.widthOfTextAtSize(word, size) > maxW) {
          let buf = '';
          for (let i = 0; i < word.length; i++) {
            const ch = word[i];
            const next = buf + ch;
            if (font.widthOfTextAtSize(next, size) > maxW) {
              if (buf) lines.push(buf);
              buf = ch;
            } else {
              buf = next;
            }
          }
          cur = buf;
        } else {
          cur = word;
        }
      }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function _pdfLibTruncate(font, size, text, maxW) {
    const s = String(text == null ? '' : text);
    if (!s) return s;
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (font.widthOfTextAtSize(s.slice(0, mid) + '…', size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + '…';
  }

  // ---- v5.5.60 — Sonor canonical rounded page-edge border ----
  // pdf-lib mirror of _paintPageBorder. The "printer's mark" frame the
  // workspace uses as a universal Sonor brand signature. Called from
  // every pdf-lib page painter (cover, plan, aspect, reference pages).
  function _pdfLibPageBorder(page) {
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const inset = 8;
    const cBorder = window.PDFLib.rgb(0xa4 / 255, 0xc8 / 255, 0xe0 / 255);  // brand light-blue tint
    // pdf-lib doesn't expose roundedRect natively; emulate with 4 lines + 4 arcs.
    // For the ~6pt corner radius across A3 landscape (1190x842) the visual
    // difference vs straight rect is tiny — we approximate as a plain
    // rectangle (no fill, blue stroke) which still reads as the canonical
    // Sonor frame at print size. Future enhancement: use pdf-lib v1.17+'s
    // drawSvgPath for true rounded corners.
    page.drawRectangle({
      x: inset, y: inset,
      width: pageW - inset * 2, height: pageH - inset * 2,
      borderColor: cBorder, borderWidth: 0.6
      // no color = no fill (this is the one case where we genuinely want
      // border-only; the page is already painted with content underneath
      // and we paint the frame LAST so the no-fill works without overwriting)
    });
  }

  // ---- v5.5.60 — Scale bar (pdf-lib) ----
  // CAD-style segmented scale bar. Bottom-left of plan area.
  // opts: { x, y, metres, pxPerM }  — y is BASELINE (top-down per legacy)
  function _pdfLibScaleBar(page, ctx, opts) {
    const pageH = page.getHeight();
    const x = opts.x || 24;
    const y = opts.y || 100;
    const targetM = opts.metres || 5;
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cBody = _pdfLibRgbHex(COLOURS.body);

    _pdfLibDrawText(page, 'Scale:', x, pageH - y,
      { font: fontReg, size: 8, colour: cMuted });

    const barX = x + 28;
    const barW = 90;
    const barH = 6;
    // Outline rect (frame)
    page.drawRectangle({
      x: barX, y: pageH - y - 1, width: barW, height: barH,
      color: cBody,
      borderColor: cText, borderWidth: 0.6
    });
    // 5 alternating segments (only odd indices filled — produces the
    // black-white-black-white-black CAD pattern)
    const segW = barW / 5;
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) {
        _pdfLibDrawRect(page, barX + i * segW, pageH - y - 1, segW, barH, cText);
      }
    }
    // Tick labels (0 left, Nm right)
    _pdfLibDrawText(page, '0', barX, pageH - y + 9,
      { font: fontReg, size: 7, colour: cMuted });
    _pdfLibDrawText(page, String(targetM) + ' m', barX + barW, pageH - y + 9,
      { font: fontReg, size: 7, colour: cMuted, align: 'right' });
    if (opts.pxPerM) {
      _pdfLibDrawText(page,
        '1m = ' + Number(opts.pxPerM).toFixed(1) + ' px',
        barX + barW + 6, pageH - y,
        { font: fontReg, size: 7, colour: cMuted });
    }
    return barW + 28;
  }

  // ---- v5.5.60 — North arrow (pdf-lib) ----
  // Architectural compass mark. Bottom-right corner of plan area by
  // default. opts: { x, y, size }. y is BASELINE.
  function _pdfLibNorthArrow(page, ctx, opts) {
    const pageH = page.getHeight();
    const x = opts.x || 24;
    const y = opts.y || 100;
    const size = opts.size || 18;
    const r = size / 2;
    const cx = x + r;
    const cyTopDown = y - r;
    const fontBold = ctx.fontBold;
    const fontReg = ctx.fontReg;
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cWhite = _pdfLibRgbHex('#FFFFFF');

    // Outer circle (slate stroke, white fill)
    page.drawCircle({
      x: cx, y: pageH - cyTopDown,
      size: r,
      color: cWhite,
      borderColor: cText, borderWidth: 0.8
    });

    // Arrow tip — slate triangle pointing UP. pdf-lib doesn't have a polygon
    // helper, so we use drawSvgPath. SVG path coords are top-down: y grows
    // DOWN, origin at top-left of SVG. pdf-lib's `drawSvgPath` accepts a
    // global x/y to anchor the path. We anchor at cx (centre), top of arrow
    // at cyTopDown - r*0.6, base at cyTopDown + r*0.55.
    const tipDy = -r * 0.6;
    const baseDy = r * 0.55;
    const wHalf = r * 0.65;
    // SVG path: M (top) L (bottomLeft) L (bottomRight) Z
    const arrowPath = 'M 0 ' + tipDy +
                      ' L ' + (-wHalf) + ' ' + baseDy +
                      ' L ' + wHalf + ' ' + baseDy + ' Z';
    try {
      page.drawSvgPath(arrowPath, {
        x: cx, y: pageH - cyTopDown,
        color: cText,
        scale: 1
      });
    } catch (_) {
      // Fallback: draw 3 lines forming a triangle outline (no fill)
      page.drawLine({
        start: { x: cx, y: pageH - cyTopDown + (-tipDy) },
        end:   { x: cx - wHalf, y: pageH - cyTopDown - baseDy },
        thickness: 1, color: cText
      });
      page.drawLine({
        start: { x: cx - wHalf, y: pageH - cyTopDown - baseDy },
        end:   { x: cx + wHalf, y: pageH - cyTopDown - baseDy },
        thickness: 1, color: cText
      });
      page.drawLine({
        start: { x: cx + wHalf, y: pageH - cyTopDown - baseDy },
        end:   { x: cx, y: pageH - cyTopDown + (-tipDy) },
        thickness: 1, color: cText
      });
    }

    // Tiny "N" inside the circle (white on the arrow body, sits at lower mid)
    _pdfLibDrawText(page, 'N',
      cx, pageH - (cyTopDown + r * 0.15) - 3,
      { font: fontBold, size: 5.5, colour: cWhite, align: 'centre' });

    // "North" caption below circle
    _pdfLibDrawText(page, 'North',
      cx, pageH - (y + 8),
      { font: fontReg, size: 7, colour: cMuted, align: 'centre' });

    return size + 4;
  }

  // ---- v5.5.60 — Status pill (pdf-lib) ----
  // Coloured rounded rect showing project state. Mirrors _statusPill.
  // opts: { fontSize, padX, padY }
  function _pdfLibStatusPill(page, ctx, state, x, y, opts) {
    opts = opts || {};
    const label = String(state || 'ACTIVE').toUpperCase();
    const colourMap = {
      'INITIAL DRAFT':      COLOURS.draftSlate,
      'DRAFT':              COLOURS.draftSlate,
      'REVISED DRAFT':      '#e37c59',
      'FOR REVIEW':         '#f5d05c',
      'FINAL DRAFT FOR SITE REVIEW': '#e37c59',
      'PRELIMINARY':        '#e37c59',
      'ACTIVE':             COLOURS.ok,
      'FOR INSTALL':        COLOURS.installGreen,
      'FOR INSTALLATION':   COLOURS.installGreen,
      'ISSUED FOR INSTALL': COLOURS.installGreen,
      'FINAL ISSUE FOR SITE INSTALLATION': COLOURS.installGreen,
      'FINAL CONSTRUCTION': COLOURS.installGreen,
      'FINAL':              COLOURS.ok,
      'AS-BUILT':           COLOURS.asBuiltAqua,
      'ARCHIVED':           COLOURS.archived
    };
    const fillHex = colourMap[label] || COLOURS.ok;
    const fill = _pdfLibRgbHex(fillHex);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const fontSize = opts.fontSize || 7.5;
    const fontBold = ctx.fontBold;
    const padX = opts.padX || 8;
    const padY = opts.padY || 3;
    const pageH = page.getHeight();
    const txtW = fontBold.widthOfTextAtSize(label, fontSize);
    const w = txtW + padX * 2;
    const h = fontSize + padY * 2;
    // pdf-lib doesn't have a native rounded-rect — drawRectangle gives us
    // squared corners. Close enough for a pill at this size; a 2-3pt radius
    // is barely visible at print size.
    page.drawRectangle({
      x, y: pageH - y - h,
      width: w, height: h,
      color: fill
    });
    _pdfLibDrawText(page, label,
      x + w / 2, pageH - y - h + padY + 1,
      { font: fontBold, size: fontSize, colour: cWhite, align: 'centre' });
    return { w, h };
  }

  // ---- v2.4.1 — Title-block band (full-width architectural footer) ----
  // Pure-vector pdf-lib mirror of `_paintTitleBlock` (jsPDF). 5 cells anchored
  // bottom of every page (cover excluded — cover has its own composition).
  // Cell breakdown matches v2.0.1 exactly:
  //   Cell 1 (~22%) — Sonor wordmark + tagline + integrator address
  //   Cell 2 (~22%) — PROJECT name + ref + site address
  //   Cell 3 (~22%) — REV / DESCRIPTION / BY / DATE row + Status pill + Drawn / Chk / Based on
  //   Cell 4 (~17%) — REVISION NOTES — Added / Moved / Removed pills (counts from meta)
  //   Cell 5 (~17%) — DRG code · PAGE X/Y · SCALE
  // Schedule pages on the pdf-lib path use this footer (per v2.0.1 directive
  // "keep our orignal full width title block across the bottom"). Drawing
  // pages — when migrated in v2.4.2 — will use the same band + add a
  // separate NOTES column on the right side (not in scope for v2.4.1).
  function _paintTitleBlockPdfLib(page, ctx, opts) {
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const meta = opts.meta || {};
    const pageCode = opts.pageCode || 'PAG';
    const pageNum = opts.pageNum || 1;
    const pageTotal = opts.pageTotal || null;
    const status = (meta.status || 'ACTIVE').toUpperCase();
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;

    // Band geometry — bottom-anchored, full-width
    const BH = 70;
    const BY = 0;                       // pdf-lib bottom-origin: band is at y=0
    const BAND_TOP_Y = BH;              // top edge of band (bottom-up)
    const BW = pageW;

    const cBody = _pdfLibRgbHex(COLOURS.body);
    const cBorderHard = _pdfLibRgbHex(COLOURS.borderHard);
    const cBorder = _pdfLibRgbHex(COLOURS.border);
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cText2 = _pdfLibRgbHex(COLOURS.text2);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cWhite = _pdfLibRgbHex('#FFFFFF');

    // Outer fill + top divider
    _pdfLibDrawRect(page, 0, BY, BW, BH, cBody);
    page.drawLine({
      start: { x: 0, y: BAND_TOP_Y },
      end: { x: pageW, y: BAND_TOP_Y },
      thickness: 0.6,
      color: cBorderHard
    });

    // Cell widths / x-origins
    const f1 = 0.22, f2 = 0.22, f3 = 0.22, f4 = 0.17;
    const c1W = pageW * f1;
    const c2W = pageW * f2;
    const c3W = pageW * f3;
    const c4W = pageW * f4;
    const c5W = pageW - c1W - c2W - c3W - c4W;
    const c1X = 0;
    const c2X = c1X + c1W;
    const c3X = c2X + c2W;
    const c4X = c3X + c3W;
    const c5X = c4X + c4W;

    // Vertical dividers
    [c2X, c3X, c4X, c5X].forEach(xv => {
      page.drawLine({
        start: { x: xv, y: BY },
        end: { x: xv, y: BAND_TOP_Y },
        thickness: 0.3,
        color: cBorder
      });
    });

    // Helper: convert a "from-top-of-band" topOffset to pdf-lib y-coord.
    // The legacy painter uses BY + offset (top-down). Here we read offset
    // from the BAND_TOP_Y (top edge) and subtract.
    const yFromTop = (offsetFromBandTop) => BAND_TOP_Y - offsetFromBandTop;

    // ---- CELL 1 — wordmark + tagline + integrator address ----
    const padX1 = 10, topPad = 8;
    if (ctx.wordmarkRef) {
      try {
        const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
        const targetW = Math.min(110, c1W - padX1 * 2);
        const targetH = targetW * (wmDim.h / wmDim.w);
        page.drawImage(ctx.wordmarkRef, {
          x: c1X + padX1,
          y: yFromTop(topPad + targetH),
          width: targetW,
          height: targetH
        });
      } catch (_) {
        _pdfLibDrawText(page, 'SONOR', c1X + padX1, yFromTop(topPad + 12),
          { font: fontBold, size: 13, colour: cText });
      }
    } else {
      _pdfLibDrawText(page, 'SONOR', c1X + padX1, yFromTop(topPad + 12),
        { font: fontBold, size: 13, colour: cText });
    }
    _pdfLibDrawText(page, COMPANY.tagline || 'Smart homes, beautifully done',
      c1X + padX1, yFromTop(42),
      { font: fontReg, size: 6.5, colour: cMuted });
    const cLine = (COMPANY.location || 'Chester') + '  ·  ' + (COMPANY.web || 'sonor.co.uk');
    _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 6.5, cLine, c1W - padX1 * 2),
      c1X + padX1, yFromTop(54),
      { font: fontReg, size: 6.5, colour: cMuted });
    const cLine2 = (COMPANY.email || '') + '  ·  ' + (COMPANY.phone || '');
    _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 6.5, cLine2, c1W - padX1 * 2),
      c1X + padX1, yFromTop(64),
      { font: fontReg, size: 6.5, colour: cMuted });

    // ---- CELL 2 — PROJECT name + ref + site address ----
    const padX2 = 8;
    _pdfLibDrawText(page, 'PROJECT', c2X + padX2, yFromTop(11),
      { font: fontBold, size: 6.5, colour: cMuted });
    _pdfLibDrawText(page, _pdfLibTruncate(fontBold, 11, meta.name || 'Untitled', c2W - padX2 * 2),
      c2X + padX2, yFromTop(26),
      { font: fontBold, size: 11, colour: cText });
    if (meta.ref) {
      _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 7.5, 'Ref: ' + String(meta.ref), c2W - padX2 * 2),
        c2X + padX2, yFromTop(38),
        { font: fontReg, size: 7.5, colour: cMuted });
    }
    if (meta.address) {
      const addrLines = _pdfLibSplitText(fontReg, 7.5, String(meta.address), c2W - padX2 * 2).slice(0, 2);
      let ay = meta.ref ? 50 : 40;
      addrLines.forEach(line => {
        _pdfLibDrawText(page, line, c2X + padX2, yFromTop(ay),
          { font: fontReg, size: 7.5, colour: cText2 });
        ay += 9;
      });
    }

    // ---- CELL 3 — REV/DESCRIPTION/BY/DATE + Status pill + Drawn/Chk/Based on ----
    const padX3 = 8;
    const innerW3 = c3W - padX3 * 2;
    const subCols3 = [
      { lbl: 'REV.',        w: 0.16, val: meta.revision || '00', bold: true },
      { lbl: 'DESCRIPTION', w: 0.50, val: meta.revDescription || (status === 'AS-BUILT' ? 'As-built' : 'Initial issue'), bold: false },
      { lbl: 'BY',          w: 0.14, val: (meta.drawnBy || 'SO').toString().slice(0, 3).toUpperCase(), bold: false },
      { lbl: 'DATE',        w: 0.20, val: (meta.dateUk || meta.date || '—').slice(0, 10), bold: false }
    ];
    let cx3 = c3X + padX3;
    subCols3.forEach(c => {
      const wsub = innerW3 * c.w;
      _pdfLibDrawText(page, c.lbl, cx3, yFromTop(11),
        { font: fontBold, size: 6, colour: cMuted });
      _pdfLibDrawText(page, _pdfLibTruncate(c.bold ? fontBold : fontReg, 8, String(c.val), wsub - 4),
        cx3, yFromTop(23),
        { font: c.bold ? fontBold : fontReg, size: 8, colour: cText });
      cx3 += wsub;
    });
    // Status pill — v5.3.4 brand-aligned via COLOURS canonical tokens
    const pillState = String(status || 'ACTIVE').toUpperCase();
    const pillColourMap = {
      'PRELIMINARY':        '#e37c59',                // svc05 terracotta
      'ACTIVE':             COLOURS.ok,               // svc03 green
      'ISSUED FOR INSTALL': COLOURS.installGreen,     // svc03 darkened
      'AS-BUILT':           COLOURS.asBuiltAqua,      // svc02 aqua
      'ARCHIVED':           COLOURS.archived,         // earthy --text-muted
      'DRAFT':              COLOURS.draftSlate        // matches COLOURS.muted
    };
    const pillFill = _pdfLibRgbHex(pillColourMap[pillState] || pillColourMap.ACTIVE);
    const pillFontSize = 6.5;
    const pillPadX = 6, pillPadY = 2;
    const pillTxtW = fontBold.widthOfTextAtSize(pillState, pillFontSize);
    const pillW = pillTxtW + pillPadX * 2;
    const pillH = pillFontSize + pillPadY * 2;
    const pillTopY = 30;
    _pdfLibDrawRect(page, c3X + padX3, yFromTop(pillTopY + pillH), pillW, pillH, pillFill);
    _pdfLibDrawText(page, pillState,
      c3X + padX3 + pillW / 2, yFromTop(pillTopY + pillH - pillPadY - 1),
      { font: fontBold, size: pillFontSize, colour: cWhite, align: 'centre' });
    // Drawn / Chk / Based on
    _pdfLibDrawText(page, 'Drawn  ' + (meta.drawnBy || 'SO') + '   ·   Chk  —',
      c3X + padX3, yFromTop(50),
      { font: fontReg, size: 6.5, colour: cMuted });
    _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 6, 'Based on ' + (meta.basedOn || 'architect plan'), innerW3),
      c3X + padX3, yFromTop(62),
      { font: fontReg, size: 6, colour: cMuted });

    // ---- CELL 4 — REVISION NOTES (Added / Moved / Removed / RFI pills) ----
    const padX4 = 8;
    _pdfLibDrawText(page, 'REVISION NOTES', c4X + padX4, yFromTop(11),
      { font: fontBold, size: 6, colour: cMuted });
    const pills = [
      { label: 'Added',   count: meta.revAdded   != null ? meta.revAdded   : 0, hex: '#78ba57' },
      { label: 'Moved',   count: meta.revMoved   != null ? meta.revMoved   : 0, hex: '#f5d05c' },
      { label: 'Removed', count: meta.revRemoved != null ? meta.revRemoved : 0, hex: '#ec6061' },
      { label: 'RFI', glyph: '?', count: meta.revRfi != null ? meta.revRfi : 0, hex: '#8058a1' },
      { label: 'Note', glyph: 'i', count: meta.revNote != null ? meta.revNote : 0, hex: '#302f2e' }
    ];
    let pX = c4X + padX4;
    const pTopY = 30;
    pills.forEach(p => {
      const txt = (p.glyph || p.label.charAt(0)) + '  ' + p.count;
      const tw = fontBold.widthOfTextAtSize(txt, 7);
      const w = tw + 10;
      const h = 12;
      // Outline pill (no fill — stroke only via 0.8pt border)
      page.drawRectangle({
        x: pX, y: yFromTop(pTopY + 3),
        width: w, height: h,
        borderColor: _pdfLibRgbHex(p.hex),
        borderWidth: 0.8
      });
      _pdfLibDrawText(page, txt, pX + w / 2, yFromTop(pTopY - 1 + 9),
        { font: fontBold, size: 7, colour: _pdfLibRgbHex(p.hex), align: 'centre' });
      pX += w + 4;
    });
    _pdfLibDrawText(page, 'A added · M moved · R removed · ? RFI', c4X + padX4, yFromTop(50),
      { font: fontReg, size: 6, colour: cMuted });

    // ---- CELL 5 — DRG code · PAGE X/Y · SCALE ----
    const padX5 = 8;
    _pdfLibDrawText(page, 'DRG', c5X + padX5, yFromTop(11),
      { font: fontBold, size: 6, colour: cMuted });
    const drgCode = _drawingCode(meta, pageCode);
    _pdfLibDrawText(page, drgCode, c5X + padX5, yFromTop(24),
      { font: fontBold, size: 11, colour: cText });
    _pdfLibDrawText(page, 'PAGE', c5X + padX5, yFromTop(38),
      { font: fontBold, size: 6, colour: cMuted });
    const pageStr = pageTotal ? (pageNum + ' / ' + pageTotal) : String(pageNum);
    _pdfLibDrawText(page, pageStr, c5X + padX5 + 28, yFromTop(38),
      { font: fontBold, size: 10, colour: cText });
    _pdfLibDrawText(page, 'SCALE', c5X + padX5, yFromTop(54),
      { font: fontBold, size: 6, colour: cMuted });
    _pdfLibDrawText(page, meta.scaleLabel ? meta.scaleLabel : (meta.scale || '1:50 @ A3'),
      c5X + padX5 + 28, yFromTop(54),
      { font: fontBold, size: 9, colour: cText });

    // v5.5.69 — Debug build stamp (5pt grey, bottom-left of page). Visually
    // tiny but extractable via `pdftotext file.pdf - | grep SONOR-BUILD:`.
    // Encodes engine/cover/timestamp/kind so any export's code path is
    // identifiable from the file alone — no more guessing across versions.
    try {
      const stamp = _buildStamp({
        meta,
        kind: opts.pageCode || 'page',
        engine: 'pdf-lib'
      });
      _pdfLibDrawText(page, stamp, 12, 6,
        { font: ctx.fontReg, size: 5, colour: cMuted });
    } catch (_) {}
  }

  // ---- v2.4.1 — Aspect schedule painter (pure vector) ----
  // Mirrors `_emitAspectIntoPdf` (jsPDF) one-for-one:
  //   1. Slate header band (28pt) with title + per-aspect 1pt accent stripe
  //   2. Drawing-reference code top-right of header
  //   3. Schedule title row + summary chip (top-right) — same height contract
  //   4. Table with per-column align (v2.0.2), per-section service colour
  //      (v2.0.2 — Blocks Schedule + per-service slices), grouped section
  //      bands, alt-row stripes, totals row
  //   5. Title-block band at bottom
  // Returns the next page number after this aspect (for fullDocument's
  // sequential numbering). Page-breaks are CURRENTLY single-page only (long
  // schedules truncate at the table-area bottom — multi-page paginate is a
  // v2.4.2 follow-up; for v2.4.1 schedules typically fit one A3 landscape).
  function _paintAspectPdfLib(pdfDoc, ctx, aspect) {
    // v5.5.58 — Phase 4 unification (PDF-UNIFICATION_2026-05-19.md). Pre-v5.5.58
    // this painter truncated long schedules with a "… N additional rows not
    // shown — multi-page paginate ships in v2.4.2" placeholder. Cable Schedule,
    // Per-Room PDF, and any other schedule >~50 rows lost data. The v5.1.6
    // commentary documented this as the reason `_pdfLibFlagOn()` defaulted off.
    // This rewrite extracts chrome painting into a per-page helper and adds
    // a new page when the next row would overflow — repainting slate header,
    // title row, summary chip, and table header on every continuation page.
    // Totals row + title-block band paint ONLY on the final page.
    const A3_LANDSCAPE = [1190, 842];
    const meta = ctx.meta;
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const accent = ASPECT_ACCENT[aspect.aspect] || COLOURS.accent;
    const cAccent = _pdfLibRgbHex(accent);

    // Drawing code + pageCode lookup (mirror _emitAspectIntoPdf v2.0.0)
    const ASPECT_PAGECODE = {
      rooms: 'ROO', symbols: 'BLK', blocks: 'BLK', cables: 'CAB',
      leds: 'LED', lighting: 'LIT', shades: 'SHA', tvs: 'DIS',
      displays: 'DIS', pj_screens: 'PJS', zones: 'ZON', cctv: 'CCT'
    };
    const aspectPageCode = aspect.pageCode
      || ASPECT_PAGECODE[aspect.aspect]
      || (typeof aspect.aspect === 'string' && aspect.aspect.indexOf('svc_') === 0
          ? 'SLI-' + aspect.aspect.slice(4) : null)
      || 'SCH';

    // Common colour refs (resolved once, reused across every continuation page)
    const cBar = _pdfLibRgbHex(COLOURS.bar);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const cFaint = _pdfLibRgbHex('#A8B0BC');
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cText2 = _pdfLibRgbHex(COLOURS.text2);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cAltRow = _pdfLibRgbHex(COLOURS.altRow);
    const cTint = _pdfLibRgbHex(COLOURS.tint);

    // ---- Chrome painter (shared across every continuation page) ----
    // Paints slate header + accent stripe + title row + summary chip on the
    // CURRENT page. Returns the top-down y coord where the table body starts
    // (just below the chrome). NEVER paints the table header — caller decides
    // when to call drawTableHeader after chrome lands.
    function paintChrome(page) {
      const pageW = page.getWidth();
      const pageH = page.getHeight();

      // 1. Slate header band
      const HDR_H = 28;
      _pdfLibDrawRect(page, 0, pageH - HDR_H, pageW, HDR_H, cBar);
      _pdfLibDrawRect(page, 0, pageH - HDR_H - 1, pageW, 1, cAccent);
      _pdfLibDrawText(page, String(aspect.title || 'Take-Off').toUpperCase(),
        24, pageH - 18,
        { font: fontBold, size: 12, colour: cWhite });
      _pdfLibDrawText(page, _drawingCode(meta, aspectPageCode),
        pageW - 24, pageH - 18,
        { font: fontReg, size: 8, colour: cFaint, align: 'right' });

      // 2. Schedule title row + sub-caption
      const bodyTop = HDR_H + 32;
      _pdfLibDrawText(page, aspect.title || 'Take-Off',
        24, pageH - bodyTop - 10,
        { font: fontBold, size: 14, colour: cText });
      const rowCount = (aspect.report && Array.isArray(aspect.report.rows)) ? aspect.report.rows.length : 0;
      // v5.92.0 (B-371b) — 'Floor: <active>' dropped (all-floors schedules).
      const sub = `${rowCount} row${rowCount === 1 ? '' : 's'}`
        + '  ·  Generated ' + meta.dateUk;
      _pdfLibDrawText(page, sub, 24, pageH - bodyTop - 24,
        { font: fontReg, size: 9, colour: cMuted });

      // 3. Summary chip (top-right)
      let tableY = bodyTop + 36;
      if (Array.isArray(aspect.summary) && aspect.summary.length) {
        const sumW = 220;
        const sumX = pageW - sumW - 24;
        const sumTopY = bodyTop - 4;
        const lineH = 12;
        const titleH = 16;
        const sumH = titleH + aspect.summary.length * lineH + 8;
        _pdfLibDrawRect(page, sumX, pageH - sumTopY - sumH, sumW, sumH,
          _pdfLibRgbHex(COLOURS.panel));
        _pdfLibDrawText(page, (aspect.summaryTitle || 'Summary').toUpperCase(),
          sumX + 10, pageH - sumTopY - 12,
          { font: fontBold, size: 8, colour: cAccent });
        let ry = sumTopY + titleH + 4;
        aspect.summary.forEach(s => {
          _pdfLibDrawText(page, String(s.label || ''),
            sumX + 10, pageH - ry - 8,
            { font: fontReg, size: 8, colour: cMuted });
          _pdfLibDrawText(page, String(s.value == null ? '' : s.value),
            sumX + sumW - 10, pageH - ry - 8,
            { font: fontBold, size: 8.5, colour: cText, align: 'right' });
          ry += lineH;
        });
        tableY = Math.max(tableY, sumTopY + sumH + 12);
      }
      return tableY;
    }

    // ---- Open first page, paint chrome ----
    let page = pdfDoc.addPage(A3_LANDSCAPE);
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    let tableY = paintChrome(page);
    const pages = [page];     // track for final pagination renumber

    // ---- 3. Table ----
    const headers = (aspect.report && Array.isArray(aspect.report.headers)) ? aspect.report.headers : [];
    const rows = (aspect.report && Array.isArray(aspect.report.rows)) ? aspect.report.rows : [];
    const totals = Array.isArray(aspect.totals) ? aspect.totals : null;
    const groupBy = (typeof aspect.groupBy === 'number') ? aspect.groupBy : -1;
    const colWeights = Array.isArray(aspect.colWeights) ? aspect.colWeights : null;
    const colAlign = aspect.align
      || (aspect.report && aspect.report.align)
      || null;
    const totalsAlignSrc = aspect.totalsAlign
      || (aspect.report && aspect.report.totalsAlign)
      || colAlign;
    const groupColourByService = !!aspect.groupColourByService;
    const tableX = 24;
    const tableW = pageW - 48;
    const headerH = 18;
    const rowH = 14;
    const groupH = 16;
    const nCols = headers.length || 1;
    const weights = colWeights && colWeights.length === nCols
      ? colWeights : new Array(nCols).fill(1);
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const colWs = weights.map(wt => (tableW * wt) / totalWeight);
    const colXs = []; let runX = tableX;
    colWs.forEach(cw => { colXs.push(runX); runX += cw; });

    // Resolve per-column align
    const _resolveAlign = (i, fallbackCell) => {
      if (colAlign && colAlign[i]) {
        const a = String(colAlign[i]).toLowerCase();
        if (a === 'centre' || a === 'center') return 'centre';
        if (a === 'right') return 'right';
        if (a === 'left') return 'left';
      }
      const isNum = i === nCols - 1 || /^[\-+£\d.,\s%×x–—•✓•]+$/.test(String(fallbackCell || '').trim());
      return isNum ? 'right' : 'left';
    };

    // Header row painter (operates on current `page` + `yTop`)
    let yTop = tableY;          // top-down y of next row's top edge
    const drawTableHeader = () => {
      _pdfLibDrawRect(page, tableX, pageH - yTop - headerH, tableW, headerH, cAccent);
      headers.forEach((h, i) => {
        const cw = colWs[i];
        const pad = 6;
        const txt = _pdfLibTruncate(fontBold, 9, String(h || ''), cw - pad * 2);
        const align = (colAlign && colAlign[i])
          ? String(colAlign[i]).toLowerCase()
          : 'left';
        let drawX, useAlign = 'left';
        if (align === 'right') { drawX = colXs[i] + cw - pad; useAlign = 'right'; }
        else if (align === 'centre' || align === 'center') { drawX = colXs[i] + cw / 2; useAlign = 'centre'; }
        else { drawX = colXs[i] + pad; useAlign = 'left'; }
        _pdfLibDrawText(page, txt, drawX, pageH - yTop - 12,
          { font: fontBold, size: 9, colour: cWhite, align: useAlign });
      });
      yTop += headerH;
    };
    drawTableHeader();

    // Body rows — v5.5.58 Phase 4: MULTI-PAGE.
    // When a row (or group band) would overflow the table area, we addPage(),
    // repaint chrome + table header, and continue.
    //
    // v5.5.63 — CRITICAL FIX. Pre-v5.5.63 the math was:
    //   const TABLE_BOTTOM_LIMIT = pageH - 110;
    // and the check was:
    //   if (pageH - yTop - rowH < TABLE_BOTTOM_LIMIT) pageBreak();
    // For A3 landscape (pageH = 842): TABLE_BOTTOM_LIMIT = 732. The check
    // became "if (728 - yTop < 732)" i.e. "if yTop > -4" — TRUE after one
    // row. So every row triggered a page break → 203-page Four Winds
    // exports. The original v2.4.1 author wrote `pageH - 110` with a
    // comment "pdf-lib y-coord min (above title block + buffer)" but
    // confused the coordinate system: in pdf-lib bottom-up coords the
    // MIN allowed bottom-y of a row is a SMALL number (~90, just above
    // the title-block band), not `pageH - 110`. Pre-v5.5.58 single-page
    // mode hid this by emitting a "+N more rows" footnote; v5.5.58
    // multi-page mode amplified it into the per-row pagination bug.
    //
    // Correct formula: TABLE_BOTTOM_LIMIT is the minimum pdf-lib y a
    // row's BOTTOM edge can occupy. Title block band sits at y=0..70.
    // Add 20pt clearance → 90.
    const TABLE_BOTTOM_LIMIT = 90;
    let lastGroupKey = null;
    let stripeIdx = 0;

    // Page-break helper. Called BEFORE drawing a row/band that would overflow.
    // Adds a new page, repaints chrome + table header, resets yTop.
    // Group repaint: when a continuation page starts mid-group, the group
    // band is re-emitted at the top of the new page with " (cont)" suffix so
    // readers know the section continues — matches legacy jsPDF behaviour.
    function pageBreak(continueGroup) {
      page = pdfDoc.addPage(A3_LANDSCAPE);
      pages.push(page);
      tableY = paintChrome(page);
      yTop = tableY;
      drawTableHeader();
      stripeIdx = 0;
      if (continueGroup && lastGroupKey !== null) {
        // Repaint group band on the new page
        const sectionColour = groupColourByService ? _serviceColourForSection(lastGroupKey) : null;
        if (sectionColour) {
          _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, tableW, groupH,
            _pdfLibRgbHex(_mixWithWhite(sectionColour, 0.85)));
          _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, 4, groupH,
            _pdfLibRgbHex(sectionColour));
        } else {
          _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, tableW, groupH, cTint);
          _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, 2, groupH, cAccent);
        }
        const labelLeftPad = sectionColour ? 12 : 10;
        _pdfLibDrawText(page,
          _pdfLibTruncate(fontBold, 9.5, (lastGroupKey || '(unassigned)') + '  (cont.)', tableW - 16),
          tableX + labelLeftPad, pageH - yTop - 11,
          { font: fontBold, size: 9.5, colour: cText });
        yTop += groupH;
      }
    }

    rows.forEach((row, idx) => {
      // Group separator
      if (groupBy >= 0) {
        const gk = String(row[groupBy] || '');
        if (gk !== lastGroupKey) {
          if (lastGroupKey !== null) yTop += 6;
          // Page-overflow check before drawing band — start band on a fresh
          // page so its first row isn't separated from its label.
          if (pageH - yTop - groupH - rowH < TABLE_BOTTOM_LIMIT) {
            lastGroupKey = gk;  // assign before pageBreak so cont-text not emitted for a fresh group
            pageBreak(false);
          }
          const sectionColour = groupColourByService ? _serviceColourForSection(gk) : null;
          if (sectionColour) {
            _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, tableW, groupH,
              _pdfLibRgbHex(_mixWithWhite(sectionColour, 0.85)));
            _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, 4, groupH,
              _pdfLibRgbHex(sectionColour));
          } else {
            _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, tableW, groupH, cTint);
            _pdfLibDrawRect(page, tableX, pageH - yTop - groupH, 2, groupH, cAccent);
          }
          const labelLeftPad = sectionColour ? 12 : 10;
          _pdfLibDrawText(page,
            _pdfLibTruncate(fontBold, 9.5, gk || '(unassigned)', tableW - 16),
            tableX + labelLeftPad, pageH - yTop - 11,
            { font: fontBold, size: 9.5, colour: cText });
          yTop += groupH;
          stripeIdx = 0;
          lastGroupKey = gk;
        }
      }
      // Row — single-line cells (no wrap, truncate). Wrap support is a
      // future enhancement (legacy jsPDF path handles wrap via splitTextToSize).
      if (pageH - yTop - rowH < TABLE_BOTTOM_LIMIT) {
        pageBreak(groupBy >= 0);   // continue the current group on the new page
      }
      // Alt-stripe
      if (stripeIdx % 2 === 1) {
        _pdfLibDrawRect(page, tableX, pageH - yTop - rowH, tableW, rowH, cAltRow);
      }
      headers.forEach((_h, i) => {
        const cell = row[i] == null ? '' : String(row[i]);
        if (!cell) return;
        const cw = colWs[i];
        const pad = 6;
        const txt = _pdfLibTruncate(fontReg, 8.5, cell, cw - pad * 2);
        const align = _resolveAlign(i, row[i]);
        let drawX, useAlign = 'left';
        if (align === 'right') { drawX = colXs[i] + cw - pad; useAlign = 'right'; }
        else if (align === 'centre') { drawX = colXs[i] + cw / 2; useAlign = 'centre'; }
        else { drawX = colXs[i] + pad; useAlign = 'left'; }
        _pdfLibDrawText(page, txt, drawX, pageH - yTop - 9,
          { font: fontReg, size: 8.5, colour: cText, align: useAlign });
      });
      yTop += rowH;
      stripeIdx++;
    });

    // Empty state
    if (!rows.length) {
      _pdfLibDrawRect(page, tableX, pageH - yTop - rowH, tableW, rowH, cAltRow);
      _pdfLibDrawText(page, 'No rows on this floor.',
        tableX + 8, pageH - yTop - 9,
        { font: fontReg, size: 8.5, colour: cMuted });
      yTop += rowH;
    }

    // Totals row (highlighted) — emit on the LAST page. If overflow, addPage first.
    if (totals && totals.length === nCols) {
      if (pageH - yTop - (rowH + 2) < TABLE_BOTTOM_LIMIT) {
        pageBreak(false);
      }
      _pdfLibDrawRect(page, tableX, pageH - yTop - (rowH + 2), tableW, rowH + 2, cText);
      headers.forEach((_h, i) => {
        const cw = colWs[i];
        const pad = 6;
        const cell = totals[i] == null ? '' : String(totals[i]);
        if (!cell.trim()) return;
        let align;
        if (totalsAlignSrc && totalsAlignSrc[i]) {
          const a = String(totalsAlignSrc[i]).toLowerCase();
          align = (a === 'centre' || a === 'center') ? 'centre'
                : (a === 'right') ? 'right' : 'left';
        } else if (colAlign && colAlign[i]) {
          const a = String(colAlign[i]).toLowerCase();
          align = (a === 'centre' || a === 'center') ? 'centre'
                : (a === 'right') ? 'right' : 'left';
        } else {
          const isNum = i === nCols - 1 || /^[\-+£\d.,\s%×x–—•✓•]+$/.test(cell.trim());
          align = isNum ? 'right' : 'left';
        }
        const txt = _pdfLibTruncate(fontBold, 9, cell, cw - pad * 2);
        let drawX, useAlign = 'left';
        if (align === 'right') { drawX = colXs[i] + cw - pad; useAlign = 'right'; }
        else if (align === 'centre') { drawX = colXs[i] + cw / 2; useAlign = 'centre'; }
        else { drawX = colXs[i] + pad; useAlign = 'left'; }
        _pdfLibDrawText(page, txt, drawX, pageH - yTop - 11,
          { font: fontBold, size: 9, colour: cWhite, align: useAlign });
      });
    }

    // ---- 4. Title-block band — paint on EVERY page ----
    // v5.5.58 multi-page: each schedule page gets its own title-block at the
    // bottom. The pageNum baked here is best-effort (sequential from
    // aspect._pageNumStart); _finalisePaginationPdfLib rewrites the X/Y stamp
    // at the end of the doc with the true final total.
    const startNum = aspect._pageNumStart || 1;
    pages.forEach((p, i) => {
      _paintTitleBlockPdfLib(p, ctx, {
        meta,
        pageNum: startNum + i,
        pageTotal: aspect._pageTotal || null,
        pageCode: aspectPageCode
      });
    });
    // v5.5.60 — Sonor canonical page-edge border on every aspect schedule page.
    pages.forEach(p => { try { _pdfLibPageBorder(p); } catch (_) {} });

    // Hint back to caller (fullDocumentPdfLib's sequential numbering) how
    // many pages this aspect produced — used to bump the running curPageNum.
    aspect._pagesAdded = pages.length;
  }

  // ---- v2.4.2 — Plan page painter (with shared XObject background dedup) ----
  // pdf-lib mirror of `_emitPlanPageIntoPdf` (jsPDF). Paints a plan page —
  // slate header + aspect accent stripe + plan area (background image +
  // overlay) + optional legend / floor totals / notes column on the right
  // + title-block band.
  //
  // The KEY architectural win: planSpec.bgImageRef is a SHARED PDFRef
  // returned by pdfDoc.embedJpg(planBytes) ONCE per floor. Multiple plan
  // pages (Combined / CCTV / Electrical / per-service slices) all
  // reference the same underlying image XObject — pdf-lib emits one /Do
  // operator per page that points at the dedup'd image. Result: 22-page
  // deck with 8 MB plan backgrounds → ~3.5 MB on disk (internal benchmark,
  // Apify research v2).
  async function _paintPlanPagePdfLib(pdfDoc, ctx, planSpec) {
    const A3_LANDSCAPE = [1190, 842];
    const page = pdfDoc.addPage(A3_LANDSCAPE);
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const meta = ctx.meta || {};
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;

    // ---- 1. Slate header band (28pt) + accent stripe ----
    const HDR_H = 28;
    const cBar = _pdfLibRgbHex(COLOURS.bar);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const cFaint = _pdfLibRgbHex('#A8B0BC');
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cAccent = _pdfLibRgbHex(planSpec.aspectAccent || COLOURS.accent);
    const cPanel = _pdfLibRgbHex(COLOURS.panel);
    const cBorder = _pdfLibRgbHex(COLOURS.border);

    _pdfLibDrawRect(page, 0, pageH - HDR_H, pageW, HDR_H, cBar);
    _pdfLibDrawRect(page, 0, pageH - HDR_H - 1, pageW, 1, cAccent);
    _pdfLibDrawText(page, String(planSpec.pageTitle || 'PLAN').toUpperCase(),
      24, pageH - 18, { font: fontBold, size: 14, colour: cWhite });
    if (planSpec.pageHint) {
      _pdfLibDrawText(page, String(planSpec.pageHint),
        pageW - 24, pageH - 14,
        { font: fontReg, size: 9, colour: cFaint, align: 'right' });
    }
    if (planSpec.drawingCode) {
      _pdfLibDrawText(page, String(planSpec.drawingCode),
        pageW - 24, pageH - 26,
        { font: fontReg, size: 7, colour: cFaint, align: 'right' });
    }

    // ---- 2. Plan background — VECTOR (v5.1.4) or raster (v2.4.2) ----
    // The architect's PDF embeds as a `PDFEmbeddedPage` once per floor; we
    // call `page.drawPage(ref, dim)` to render it as native vector — text +
    // linework stay crisp at any zoom, no double-rasterisation, no JPEG
    // block artefacts. The embed is shared across every plan view of the
    // floor (Combined / CCTV / Electrical) so it's a single XObject in the
    // output PDF — same dedup win as the v2.4.2 raster pipeline, with
    // strictly higher quality. Falls back to drawImage(bgImageRef) when
    // embedPdf wasn't possible (image plans, encrypted PDFs, etc).
    //
    // v5.5.67 — Paint a WHITE rect at the plan area FIRST so any area
    // not covered by the bg image (when its aspect ratio doesn't match
    // the planRect aspect) stays white instead of showing through to
    // the overlay JPEG's black background. Bryn report 2026-05-20:
    // "black is introduced on the plans" — the architect's plan was
    // drawn at native aspect, leaving empty space in the planRect that
    // the JPEG overlay (no alpha channel) filled with black.
    if (planSpec.bgImageDim) {
      const cWhite = window.PDFLib.rgb(1, 1, 1);
      page.drawRectangle({
        x: planSpec.bgImageDim.x,
        y: planSpec.bgImageDim.y,
        width: planSpec.bgImageDim.width,
        height: planSpec.bgImageDim.height,
        color: cWhite
      });
    }
    if (planSpec.bgPdfPageRef && planSpec.bgImageDim) {
      try {
        // pdf-lib's drawPage signature accepts the same `{x, y, width,
        // height}` rect shape as drawImage. Aspect-ratio fit is computed by
        // _pdfLibPlanRect so the dim already matches the underlying page.
        page.drawPage(planSpec.bgPdfPageRef, planSpec.bgImageDim);
      } catch (e) {
        console.warn('[SonorPdf v5.1.4] vector drawPage failed, falling back to raster:', e);
        if (planSpec.bgImageRef) {
          try { page.drawImage(planSpec.bgImageRef, planSpec.bgImageDim); }
          catch (e2) { console.warn('[SonorPdf v2.4.2] bg drawImage fallback failed:', e2); }
        }
      }
    } else if (planSpec.bgImageRef && planSpec.bgImageDim) {
      try {
        page.drawImage(planSpec.bgImageRef, planSpec.bgImageDim);
      } catch (e) {
        console.warn('[SonorPdf v2.4.2] bg drawImage failed:', e);
      }
    } else if (planSpec.bgImageDim) {
      page.drawRectangle({
        x: planSpec.bgImageDim.x,
        y: planSpec.bgImageDim.y,
        width: planSpec.bgImageDim.width,
        height: planSpec.bgImageDim.height,
        borderColor: cBorder, borderWidth: 0.4
      });
    }

    // ---- 3. Overlay (per-page Fabric snapshot with bg hidden) ----
    if (planSpec.overlayDataUrl && planSpec.overlayDim) {
      try {
        const raw = String(planSpec.overlayDataUrl);
        const isPng = raw.indexOf('data:image/png') === 0;
        const bytes = _pdfLibBase64ToBytes(raw);
        const ref = isPng
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        page.drawImage(ref, planSpec.overlayDim);
      } catch (e) {
        console.warn('[SonorPdf v2.4.2] overlay embed failed:', e);
      }
    }

    // ---- 4. Plan-area geometry (mirrors _emitPlanPageIntoPdf) ----
    // v2.6.2 — Bryn directive 2026-04-29: "shrink the notes section in pdf
    // export underneath the legend so there is just 1x info column". NOTES
    // is now stacked below FLOOR TOTALS in the SAME inset column, not a
    // separate right-edge strip. Plan canvas area widens accordingly.
    const TITLE_BLOCK_RESERVED = 144;
    const planTop = HDR_H + 12;
    const planBottom = pageH - TITLE_BLOCK_RESERVED;
    const planLeft = 24;
    let planRight = pageW - 24;
    const showNotes = planSpec.showNotes === true;
    // v2.6.2 — separate NOTES strip removed; notes live in inset column.
    const hasInset = (Array.isArray(planSpec.legend) && planSpec.legend.length)
                  || (planSpec.floorTotals && Object.keys(planSpec.floorTotals).length)
                  || showNotes;
    const INSET_W = hasInset ? 200 : 0;
    const INSET_GAP = hasInset ? 16 : 0;
    const planAvailW = (planRight - planLeft) - (INSET_W + INSET_GAP);

    // ---- 5. Inset column (LEGEND → FLOOR TOTALS → NOTES, stacked) ----
    if (hasInset) {
      const insetXTop = planLeft + planAvailW + INSET_GAP;
      let insetTopY = planTop;
      if (Array.isArray(planSpec.legend) && planSpec.legend.length) {
        const drawnH = _paintLegendPdfLib(page, ctx, {
          x: insetXTop, y: insetTopY, w: INSET_W, items: planSpec.legend
        });
        insetTopY += drawnH + 12;
      }
      if (planSpec.floorTotals && Object.keys(planSpec.floorTotals).length) {
        const rows = [];
        const ft = planSpec.floorTotals;
        if (ft.rooms != null)     rows.push({ label: 'Rooms', value: String(ft.rooms) });
        if (ft.blocks != null)    rows.push({ label: 'Blocks', value: String(ft.blocks) });
        // v5.78.0 — Area/Perimeter dropped from ALL pdf outputs (Bryn directive).
        // v5.5.67 — strip trailing " m" if present so we don't render
        // "0.00 m m". The host's _buildPlanPagesForPdfLib forwards
        // window._sonorBuildSummaryForActive's value (already includes " m"
        // because the same builder feeds the legacy paintCoverSheet that
        // needs the unit baked in). Painter appends its own " m" too.
        // Easiest defensive fix: only append " m" when value doesn't end
        // with it already. Works whether caller passes "0.00" or "0.00 m".
        const _ensureMeters = v => {
          const s = String(v == null ? '' : v).trim();
          return /\s*m\s*$/i.test(s) ? s : (s + ' m');
        };
        if (ft.cable_m != null)   rows.push({ label: 'Cable run', value: _ensureMeters(ft.cable_m) });
        if (ft.led_m != null)     rows.push({ label: 'LED run',   value: _ensureMeters(ft.led_m) });
        if (rows.length) {
          _paintSummaryPdfLib(page, ctx, {
            x: insetXTop, y: insetTopY, w: INSET_W,
            accent: ASPECT_ACCENT.plan,
            title: planSpec.floorTotalsTitle || 'Floor totals',
            rows
          });
          // Estimate consumed height (header 18 + row 12 each + bottom pad 4)
          insetTopY += (18 + (rows.length * 12) + 4) + 12;
        }
      }
      // ---- v2.6.2 NOTES section stacked below FLOOR TOTALS in same column.
      // v5.5.59 — FIX solid-black notes column bug (Bryn report 2026-05-07).
      // pdf-lib's drawRectangle defaults to BLACK fill when `color` is not
      // specified, even if `borderColor` IS specified. Pre-v5.5.59 the outer
      // notes rect was passed `borderColor + borderWidth` only — pdf-lib
      // filled it black, the cPanel header strip drew on top of the top
      // 18pt, and the rule lines below were invisible against black. Fix:
      // explicitly set color to body white (the page bg) so the fill is
      // explicitly white-on-white = invisible. Applied to every border-only
      // rectangle in this painter.
      if (showNotes) {
        const colX = insetXTop;
        const colTop = insetTopY;
        const colBottom = planBottom;
        const colH = colBottom - colTop;
        if (colH >= 60) {  // only render if there's room for a useful section
          const colInnerW = INSET_W;
          const cBody = _pdfLibRgbHex(COLOURS.body);
          page.drawRectangle({
            x: colX, y: pageH - colTop - colH,
            width: colInnerW, height: colH,
            color: cBody,        // v5.5.59 explicit white fill (was defaulting to black)
            borderColor: cBorder, borderWidth: 0.3
          });
          _pdfLibDrawRect(page, colX, pageH - colTop - 18, colInnerW, 18, cPanel);
          _pdfLibDrawText(page, 'NOTES', colX + 8, pageH - colTop - 12,
            { font: fontBold, size: 8, colour: cText });
          const cRule = _pdfLibRgbHex(COLOURS.border);
          const linePitch = 14;
          const lineY0 = colTop + 28;
          for (let y = lineY0; y < colBottom - 4; y += linePitch) {
            page.drawLine({
              start: { x: colX + 4, y: pageH - y },
              end:   { x: colX + colInnerW - 4, y: pageH - y },
              thickness: 0.25, color: cRule
            });
          }
        }
      }
    }

    // ---- 6.5 v2.6.1 Footnote (per-service slice cross-app pointer) ----
    if (planSpec.footnote) {
      try {
        const TBH = 144;  // matches TITLE_BLOCK_RESERVED above
        const fnY = TBH + 12;  // sits 12pt above title-block top edge
        _pdfLibDrawText(page,
          _pdfLibTruncate(fontReg, 8, String(planSpec.footnote), pageW - 48),
          pageW / 2, pageH - fnY,
          { font: fontReg, size: 8, colour: cMuted, align: 'center' });
      } catch (e) { console.warn('[SonorPdf v2.6.1] footnote paint failed:', e); }
    }

    // ---- 6.6 v5.5.60 — Scale bar + north arrow (architectural conventions) ----
    // Bottom of plan area (above title-block band, above any footnote).
    // Scale bar at left, north arrow at right. Both pure-vector pdf-lib.
    try {
      const scaleY = planBottom + 16;   // top-down y baseline for both
      // Scale bar — left
      _pdfLibScaleBar(page, ctx, {
        x: planLeft + 4, y: scaleY,
        metres: 5,
        pxPerM: meta.pxPerM
      });
      // North arrow — right (aligned with scale bar baseline)
      _pdfLibNorthArrow(page, ctx, {
        x: planLeft + planAvailW - 24,  // right edge of plan area minus arrow width
        y: scaleY - 12,                 // bumped up so caption "North" sits at scaleY+8
        size: 18
      });
    } catch (e) { console.warn('[SonorPdf v5.5.60] scale+north paint failed:', e); }

    // ---- 7. Title-block band (architectural footer) ----
    _paintTitleBlockPdfLib(page, ctx, {
      meta,
      pageNum: planSpec.pageNum || 1,
      pageTotal: planSpec.pageTotal || null,
      pageCode: planSpec.pageCode || 'PAG'
    });

    // ---- 8. v5.5.60 — Sonor canonical page-edge border (LAST, on top) ----
    // The brand frame sits on top of everything (it's a printer's mark, not
    // content). Painted after the title-block so the border passes cleanly
    // around the slate footer band.
    _pdfLibPageBorder(page);
  }

  // ---- v2.4.2 — Inset legend painter (pdf-lib) ----
  function _paintLegendPdfLib(page, ctx, opts) {
    const x = opts.x || 24;
    const yTop = opts.y || 80;
    const w = opts.w || 180;
    const items = Array.isArray(opts.items) ? opts.items : [];
    if (!items.length) return 0;
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const pageH = page.getHeight();

    const ROW_ITEM = 12, ROW_SVC = 16, ROW_SUB = 11;
    const PAD_TOP = 6, PAD_BOTTOM = 6;
    const cTint = _pdfLibRgbHex(COLOURS.tint);
    const cBorder = _pdfLibRgbHex(COLOURS.border);
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);

    // v5.5.59 — defensive explicit white fill on every border-only rect
    // (see PDF-UNIFICATION_2026-05-19.md Phase 5 commentary). pdf-lib can
    // default to BLACK fill when only borderColor is specified — bake the
    // body bg in so the box stays transparent-looking on every viewer.
    const cBody = _pdfLibRgbHex(COLOURS.body);
    _pdfLibDrawRect(page, x, pageH - yTop - 16, w, 16, cTint);
    page.drawRectangle({
      x, y: pageH - yTop - 16, width: w, height: 16,
      color: cTint,             // v5.5.59 — preserve the tint underneath, no black overwrite
      borderColor: cBorder, borderWidth: 0.4
    });
    _pdfLibDrawText(page, 'LEGEND', x + 6, pageH - yTop - 11,
      { font: fontBold, size: 8, colour: cText });

    const heights = items.map(it => {
      if (it.kind === 'group') return (it.level === 'sub') ? ROW_SUB : ROW_SVC;
      return ROW_ITEM;
    });
    const bodyH = heights.reduce((a, h) => a + h, 0) + PAD_TOP + PAD_BOTTOM;
    page.drawRectangle({
      x, y: pageH - (yTop + 16) - bodyH, width: w, height: bodyH,
      color: cBody,             // v5.5.59 — explicit white fill (was defaulting black)
      borderColor: cBorder, borderWidth: 0.4
    });

    let cursorY = yTop + 16 + PAD_TOP;
    items.forEach((it, i) => {
      const h = heights[i];
      if (it.kind === 'group' && it.level !== 'sub') {
        const baseline = cursorY + h - 5;
        _pdfLibDrawText(page,
          _pdfLibTruncate(fontBold, 8.5, String(it.label || '').toUpperCase(), w - 12),
          x + 6, pageH - baseline,
          { font: fontBold, size: 8.5, colour: cText });
        const cStripe = _pdfLibRgbHex(it.colour || '#999');
        _pdfLibDrawRect(page, x + 6, pageH - (baseline + 2) - 1.4, w - 12, 1.4, cStripe);
      } else if (it.kind === 'group' && it.level === 'sub') {
        const baseline = cursorY + h - 3;
        _pdfLibDrawText(page,
          _pdfLibTruncate(fontBold, 7, String(it.label || '').toUpperCase(), w - 16),
          x + 12, pageH - baseline,
          { font: fontBold, size: 7, colour: cMuted });
      } else {
        const baseline = cursorY + h - 3;
        const cChip = _pdfLibRgbHex(it.colour || '#999');
        page.drawCircle({
          x: x + 14, y: pageH - (baseline - 3),
          size: 3, color: cChip
        });
        _pdfLibDrawText(page,
          _pdfLibTruncate(fontReg, 8, String(it.label || ''), w - 46),
          x + 22, pageH - baseline,
          { font: fontReg, size: 8, colour: cText });
        if (it.qty != null) {
          _pdfLibDrawText(page, '×' + it.qty,
            x + w - 6, pageH - baseline,
            { font: fontBold, size: 8, colour: cText, align: 'right' });
        }
      }
      cursorY += h;
    });
    return 16 + bodyH;
  }

  // ---- v2.4.2 — Inset summary chip painter (pdf-lib) ----
  function _paintSummaryPdfLib(page, ctx, opts) {
    const x = opts.x || 24;
    const yTop = opts.y || 80;
    const w = opts.w || 200;
    const accent = opts.accent || COLOURS.accent;
    const title = opts.title || 'Summary';
    const rows = Array.isArray(opts.rows) ? opts.rows : [];
    const rowH = 13;
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const pageH = page.getHeight();
    const cAccent = _pdfLibRgbHex(accent);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cAltRow = _pdfLibRgbHex(COLOURS.altRow);
    const cBorder = _pdfLibRgbHex(COLOURS.border);

    _pdfLibDrawRect(page, x, pageH - yTop - 16, w, 16, cAccent);
    _pdfLibDrawText(page, String(title).toUpperCase(),
      x + 6, pageH - yTop - 11,
      { font: fontBold, size: 9, colour: cWhite });

    const bodyH = Math.max(1, rows.length) * rowH;
    const cBody = _pdfLibRgbHex(COLOURS.body);
    page.drawRectangle({
      x, y: pageH - (yTop + 16) - bodyH, width: w, height: bodyH,
      color: cBody,             // v5.5.59 — explicit white fill (was defaulting black)
      borderColor: cBorder, borderWidth: 0.4
    });
    rows.forEach((r, i) => {
      const ry = yTop + 16 + (i + 0.7) * rowH;
      if (i % 2 === 1) {
        _pdfLibDrawRect(page, x, pageH - (yTop + 16 + i * rowH) - rowH, w, rowH, cAltRow);
      }
      _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 8, String(r.label || ''), w / 2 - 8),
        x + 6, pageH - ry,
        { font: fontReg, size: 8, colour: cText });
      const valColour = _pdfLibRgbHex(r.accent || COLOURS.text);
      _pdfLibDrawText(page, _pdfLibTruncate(fontBold, 8, String(r.value || ''), w / 2 - 8),
        x + w - 6, pageH - ry,
        { font: fontBold, size: 8, colour: valColour, align: 'right' });
    });
    return 16 + bodyH;
  }

  // ---- v2.4.2 — Helper: build planSpec.bgImageDim from canvas snapshot ----
  function _pdfLibPlanRect(pageW, pageH, snapW, snapH, opts) {
    opts = opts || {};
    const HDR_H = 28;
    const TITLE_BLOCK_RESERVED = 144;
    const planTop = HDR_H + 12;
    const planBottom = pageH - TITLE_BLOCK_RESERVED;
    const planLeft = 24;
    let planRight = pageW - 24;
    if (opts.showNotes) planRight -= 152;
    if (opts.hasInset) planRight -= (200 + 16);
    const availW = planRight - planLeft;
    const availH = planBottom - planTop;
    const ratio = Math.min(availW / Math.max(snapW, 1), availH / Math.max(snapH, 1));
    const drawW = snapW * ratio;
    const drawH = snapH * ratio;
    const imgX_topdown = planLeft + (availW - drawW) / 2;
    const imgY_topdown = planTop + (availH - drawH) / 2;
    return {
      x: imgX_topdown,
      y: pageH - imgY_topdown - drawH,
      width: drawW,
      height: drawH
    };
  }

  // ---- v2.4.3 — Cabling Info reference page (pure vector, pdf-lib) ----
  // Mirrors `_paintCablingInfoPage` (jsPDF) one-for-one. Six sections:
  //   1. Cable ID format with sample AA-S-02 breakdown
  //   2. Cable types & bend radii table (8 rows)
  //   3. Symbol convention (5 examples)
  //   4. Mounting options (4 quadrants)
  //   5. 10-service taxonomy strip
  //   6. 6 standing install notes
  // All pure-vector — drawText + drawRectangle + drawCircle. Title-block
  // band at the bottom is painted via _paintTitleBlockPdfLib for parity.
  function _paintCablingInfoPagePdfLib(pdfDoc, ctx, opts) {
    const A3_LANDSCAPE = [1190, 842];
    const page = pdfDoc.addPage(A3_LANDSCAPE);
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const meta = ctx.meta || {};
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const pageNum = opts && opts.pageNum || 1;
    const pageTotal = opts && opts.pageTotal || null;

    const cBar = _pdfLibRgbHex(COLOURS.bar);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const cFaint = _pdfLibRgbHex('#A8B0BC');
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cText2 = _pdfLibRgbHex(COLOURS.text2);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cPanel = _pdfLibRgbHex(COLOURS.panel);
    const cAltRow = _pdfLibRgbHex(COLOURS.altRow);
    const cBorder = _pdfLibRgbHex(COLOURS.border);
    const cAccent = _pdfLibRgbHex(ASPECT_ACCENT.cabling || '#302F2E');

    // ---- Header band (28pt) + accent stripe ----
    const HDR_H = 28;
    _pdfLibDrawRect(page, 0, pageH - HDR_H, pageW, HDR_H, cBar);
    _pdfLibDrawRect(page, 0, pageH - HDR_H - 1, pageW, 1, cAccent);
    _pdfLibDrawText(page, 'CABLING INFORMATION',
      24, pageH - 18, { font: fontBold, size: 12, colour: cWhite });
    _pdfLibDrawText(page, 'Reference sheet — read with all takeoff drawings',
      pageW / 2, pageH - 18,
      { font: fontReg, size: 9, colour: cFaint, align: 'centre' });
    _pdfLibDrawText(page, _drawingCode(meta, 'CBL'),
      pageW - 24, pageH - 18,
      { font: fontReg, size: 8, colour: cFaint, align: 'right' });

    // Layout — top-down y coords mapped via (pageH - y)
    const M = 32;
    const top = HDR_H + 32;
    const colW = (pageW - M * 3) / 2;
    const leftX = M;
    const rightX = M + colW + M;

    // ---- LEFT COLUMN ----
    let lY = top;
    // Section 1 — Cable ID format
    _pdfLibDrawText(page, '1.  CABLE ID FORMAT', leftX, pageH - lY,
      { font: fontBold, size: 11, colour: cText });
    lY += 18;
    _pdfLibDrawText(page, 'AA-S-02', leftX, pageH - (lY + 22),
      { font: fontBold, size: 28, colour: cAccent });
    lY += 38;
    const idRows = [
      ['AA',          'Lowest Floor (A) · Top Left Room (A)'],
      ['S',           'Speaker Cable (cable type)'],
      ['02',          'ID Number (sequential per type)'],
      ['Destination', 'HE = Audio/Video Head End  ·  RK = Rack  ·  KP = Keypad']
    ];
    idRows.forEach(r => {
      _pdfLibDrawText(page, r[0], leftX, pageH - lY,
        { font: fontBold, size: 8.5, colour: cText });
      _pdfLibDrawText(page, r[1], leftX + 70, pageH - lY,
        { font: fontReg, size: 8.5, colour: cText2 });
      lY += 13;
    });
    lY += 18;

    // Section 2 — Symbol convention (left col, renumbered to 2)
    _pdfLibDrawText(page, '2.  SYMBOL CONVENTION', leftX, pageH - lY,
      { font: fontBold, size: 11, colour: cText });
    lY += 16;
    const symRows = [
      ['Speaker (in-ceiling)',    'SP-AA-1'],
      ['Wall plate (Cat6 + RG6)', 'WP-AA-2'],
      ['Camera (CCTV)',           'CCTV-AA-1'],
      ['Keypad / control',        'KP-AA-1'],
      ['LED strip terminator',    'LED-AA-1']
    ];
    symRows.forEach(r => {
      page.drawCircle({ x: leftX + 4, y: pageH - (lY - 3), size: 2.5, color: cAccent });
      _pdfLibDrawText(page, r[0], leftX + 14, pageH - lY,
        { font: fontReg, size: 8, colour: cText2 });
      _pdfLibDrawText(page, r[1], leftX + colW - 4, pageH - lY,
        { font: fontBold, size: 8, colour: cText, align: 'right' });
      lY += 13;
    });

    // ---- RIGHT COLUMN ----
    let rY = top;
    // Section 3 — Cable types & bend radii table
    _pdfLibDrawText(page, '3.  CABLE TYPES & BEND RADII', rightX, pageH - rY,
      { font: fontBold, size: 11, colour: cText });
    rY += 14;
    const tableRows = [
      ['Speaker 2-core',   '35',  '—'],
      ['Speaker 4-core',   '35',  '—'],
      ['Audio signal',     '25',  '—'],
      ['RG6 coaxial',      '65',  '—'],
      ['Control',          '65',  '—'],
      ['Cat6',             '48',  '—'],
      ['Optical fibre',    '200', 'Special handling'],
      ['Blinds (Sivoia)',  '90',  '—']
    ];
    // Header row
    _pdfLibDrawRect(page, rightX, pageH - rY - 14, colW, 14, cPanel);
    _pdfLibDrawText(page, 'TYPE',   rightX + 6, pageH - (rY + 9),
      { font: fontBold, size: 7.5, colour: cMuted });
    _pdfLibDrawText(page, 'R (mm)', rightX + colW * 0.55, pageH - (rY + 9),
      { font: fontBold, size: 7.5, colour: cMuted, align: 'right' });
    _pdfLibDrawText(page, 'NOTES',  rightX + colW - 6, pageH - (rY + 9),
      { font: fontBold, size: 7.5, colour: cMuted, align: 'right' });
    rY += 14;
    tableRows.forEach((r, i) => {
      if (i % 2 === 1) {
        _pdfLibDrawRect(page, rightX, pageH - rY - 12, colW, 12, cAltRow);
      }
      _pdfLibDrawText(page, r[0], rightX + 6, pageH - (rY + 8),
        { font: fontReg, size: 8, colour: cText });
      _pdfLibDrawText(page, r[1], rightX + colW * 0.55, pageH - (rY + 8),
        { font: fontBold, size: 8, colour: cText, align: 'right' });
      _pdfLibDrawText(page, r[2], rightX + colW - 6, pageH - (rY + 8),
        { font: fontReg, size: 8, colour: cMuted, align: 'right' });
      rY += 12;
    });
    rY += 16;

    // Section 4 — Mounting options (right col)
    _pdfLibDrawText(page, '4.  MOUNTING OPTIONS', rightX, pageH - rY,
      { font: fontBold, size: 11, colour: cText });
    rY += 14;
    const quad = [
      ['Ceiling',  'Recessed flush — fire-rated back-box'],
      ['Wall',     'In-wall pre-wire — flush plate finish'],
      ['Floor',    'Floor box / under-carpet — sealed exit'],
      ['Pre-wire', 'First-fix only — second-fix at fit-out']
    ];
    const quadW = colW / 2;
    quad.forEach((r, i) => {
      const qx = rightX + (i % 2) * quadW;
      const qy = rY + Math.floor(i / 2) * 28;
      _pdfLibDrawRect(page, qx, pageH - qy - 24, quadW - 4, 24, cPanel);
      _pdfLibDrawText(page, r[0], qx + 6, pageH - (qy + 10),
        { font: fontBold, size: 8, colour: cText });
      _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 7, r[1], quadW - 12),
        qx + 6, pageH - (qy + 20),
        { font: fontReg, size: 7, colour: cMuted });
    });
    rY += 60;

    // ---- BOTTOM (full width) — Sections 5 + 6 ----
    let bY = Math.max(lY, rY) + 6;

    // Section 5 — 10-service taxonomy strip
    _pdfLibDrawText(page, '5.  10-SERVICE TAXONOMY', M, pageH - bY,
      { font: fontBold, size: 10.5, colour: cText });
    bY += 12;
    if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
      const stripW = pageW - M * 2;
      const tileW = stripW / 10;
      const tileH = 26;
      SERVICES.slice(0, 10).forEach((s, i) => {
        const tx = M + i * tileW;
        const cSvc = _pdfLibRgbHex(s.colour || '#999');
        _pdfLibDrawRect(page, tx, pageH - (bY + 6), tileW - 2, 6, cSvc);
        _pdfLibDrawRect(page, tx, pageH - (bY + tileH), tileW - 2, tileH - 6, cPanel);
        page.drawRectangle({
          x: tx, y: pageH - (bY + tileH),
          width: tileW - 2, height: tileH,
          color: cPanel,        // v5.5.59 — explicit fill (was risk of default-black overwriting tile content)
          borderColor: cBorder, borderWidth: 0.3
        });
        const nn = String(i + 1).padStart(2, '0');
        _pdfLibDrawText(page, nn, tx + 4, pageH - (bY + 16),
          { font: fontBold, size: 8, colour: cText });
        _pdfLibDrawText(page, _pdfLibTruncate(fontReg, 7, s.name || '', tileW - 16),
          tx + 14, pageH - (bY + 16),
          { font: fontReg, size: 7, colour: cText2 });
      });
      bY += tileH + 16;
    }

    // Section 6 — Standing install notes
    _pdfLibDrawText(page, '6.  STANDING INSTALL NOTES', M, pageH - bY,
      { font: fontBold, size: 10.5, colour: cText });
    bY += 12;
    const notes = [
      'Do not scale from this drawing — all dimensions to be confirmed on-site.',
      'Label cables 150 mm from the cable end (both ends) using approved markers.',
      'Maintain 300 mm minimum parallel separation from mains-voltage cabling.',
      'Where mains and low-voltage cross, cross at 90 degrees only.',
      'Sockets/keypads/wall-plates installed at standard heights per project spec.',
      'Cables loosely coiled 1.0 m above FFL at termination point pending second-fix.'
    ];
    notes.forEach((n, i) => {
      _pdfLibDrawText(page, (i + 1) + '.  ' + n,
        M + 4, pageH - bY,
        { font: fontReg, size: 8.5, colour: cText2 });
      bY += 12;
    });

    // Title-block band
    _paintTitleBlockPdfLib(page, ctx, {
      meta, pageNum, pageTotal, pageCode: 'CBL'
    });
    return page;
  }

  // ---- v2.4.3 — Bend Radius reference page (pure vector, pdf-lib) ----
  // Mirrors `_paintBendRadiusPage` (jsPDF). 7 concentric circles drawn at ~1:1
  // A3 scale (1 mm = 2.835 pt). Bottom-left LEGEND STACK + bottom-right SCALE
  // CHIP. Falls back to scaled-down arcs if 200 mm radius would clip.
  function _paintBendRadiusPagePdfLib(pdfDoc, ctx, opts) {
    const A3_LANDSCAPE = [1190, 842];
    const page = pdfDoc.addPage(A3_LANDSCAPE);
    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const meta = ctx.meta || {};
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const pageNum = opts && opts.pageNum || 1;
    const pageTotal = opts && opts.pageTotal || null;

    const cBar = _pdfLibRgbHex(COLOURS.bar);
    const cWhite = _pdfLibRgbHex('#FFFFFF');
    const cFaint = _pdfLibRgbHex('#A8B0BC');
    const cText = _pdfLibRgbHex(COLOURS.text);
    const cMuted = _pdfLibRgbHex(COLOURS.muted);
    const cBorder = _pdfLibRgbHex(COLOURS.border);
    const cAccent = _pdfLibRgbHex(ASPECT_ACCENT.bend || '#302F2E');

    // Header band
    const HDR_H = 28;
    _pdfLibDrawRect(page, 0, pageH - HDR_H, pageW, HDR_H, cBar);
    _pdfLibDrawRect(page, 0, pageH - HDR_H - 1, pageW, 1, cAccent);
    _pdfLibDrawText(page, 'BEND RADIUS REFERENCE',
      24, pageH - 18, { font: fontBold, size: 12, colour: cWhite });
    _pdfLibDrawText(page, '1:1 scale on A3 — verify with ruler before installation',
      pageW / 2, pageH - 18,
      { font: fontReg, size: 9, colour: cFaint, align: 'centre' });
    _pdfLibDrawText(page, _drawingCode(meta, 'BRD'),
      pageW - 24, pageH - 18,
      { font: fontReg, size: 8, colour: cFaint, align: 'right' });

    const TITLE_BLOCK_H = 70;
    const drawTop = HDR_H + 8;
    const drawBottom = pageH - TITLE_BLOCK_H - 8;
    const drawH = drawBottom - drawTop;

    const MM = 2.834645669;
    const arcs = [
      { mm: 200, label: 'Optical fibre',          hex: '#e37c59', special: true },
      { mm: 90,  label: 'Blinds (Sivoia)',        hex: '#8058a1' },
      { mm: 65,  label: 'RG6 coaxial',            hex: '#4bb9d3' },
      { mm: 65,  label: 'Control',                hex: '#e67eb1', offset: true },
      { mm: 48,  label: 'Cat6',                   hex: '#78ba57' },
      { mm: 35,  label: 'Speaker 2 & 4-core',     hex: '#ad9978' },
      { mm: 25,  label: 'Audio signal',           hex: '#f5d05c' }
    ];
    const maxRmm = Math.max.apply(null, arcs.map(a => a.mm));
    const maxRpt = maxRmm * MM;

    const cx = pageW / 2;
    const cy_topdown = drawTop + drawH / 2;
    const horizSafe = Math.min(cx, pageW - cx) - 12;
    const vertSafe  = Math.min(cy_topdown - drawTop, drawBottom - cy_topdown) - 12;
    const safeR     = Math.min(horizSafe, vertSafe);
    let scale = 1.0;
    if (maxRpt > safeR) {
      scale = Math.max(0.5, safeR / maxRpt);
      scale = Math.floor(scale * 100) / 100;
    }
    const trueRatio = (1 / scale).toFixed(2);

    // Convert centre to pdf-lib bottom-up
    const cy = pageH - cy_topdown;

    // Draw concentric arcs
    arcs.forEach(a => {
      const r = a.mm * MM * scale;
      const cArc = _pdfLibRgbHex(a.hex);
      page.drawCircle({
        x: cx, y: cy, size: r,
        borderColor: cArc,
        borderWidth: a.special ? 1.6 : 1.0
      });
      // Tick at right edge (0°)
      page.drawLine({
        start: { x: cx + r - 4, y: cy },
        end:   { x: cx + r + 4, y: cy },
        thickness: 0.5, color: cArc
      });
    });

    // Centre crosshair
    page.drawLine({
      start: { x: cx - 8, y: cy }, end: { x: cx + 8, y: cy },
      thickness: 0.4, color: cText
    });
    page.drawLine({
      start: { x: cx, y: cy - 8 }, end: { x: cx, y: cy + 8 },
      thickness: 0.4, color: cText
    });
    page.drawCircle({ x: cx, y: cy, size: 1.4, color: cText });

    // Bottom-left LEGEND STACK
    const stackX = 28;
    const stackY_topdown = drawBottom - (arcs.length * 14 + 24);
    const stackW = 220;
    const stackH = arcs.length * 14 + 22;
    _pdfLibDrawRect(page, stackX - 6, pageH - stackY_topdown - 14 + 14 - stackH,
      stackW, stackH, cWhite);
    page.drawRectangle({
      x: stackX - 6, y: pageH - stackY_topdown - 14 + 14 - stackH,
      width: stackW, height: stackH,
      color: cWhite,            // v5.5.59 — explicit white fill (was defaulting black)
      borderColor: cBorder, borderWidth: 0.4
    });
    _pdfLibDrawText(page, 'MIN BEND RADIUS — KEY',
      stackX, pageH - (stackY_topdown - 2),
      { font: fontBold, size: 8, colour: cText });
    let lY = stackY_topdown + 12;
    arcs.forEach(a => {
      const cChip = _pdfLibRgbHex(a.hex);
      page.drawCircle({ x: stackX + 5, y: pageH - (lY - 3), size: 3.2, color: cChip });
      _pdfLibDrawText(page, a.label, stackX + 14, pageH - lY,
        { font: a.special ? fontBold : fontReg, size: 8, colour: cText });
      _pdfLibDrawText(page, a.mm + ' mm',
        stackX + stackW - 18, pageH - lY,
        { font: fontBold, size: 8, colour: cChip, align: 'right' });
      lY += 14;
    });

    // Bottom-right SCALE CHIP
    const chipW = 220;
    const chipH = 50;
    const chipX = pageW - chipW - 28;
    const chipY_topdown = drawBottom - chipH - 4;
    _pdfLibDrawRect(page, chipX, pageH - chipY_topdown - chipH, chipW, chipH, cWhite);
    page.drawRectangle({
      x: chipX, y: pageH - chipY_topdown - chipH,
      width: chipW, height: chipH,
      color: cWhite,            // v5.5.59 — explicit white fill (was defaulting black)
      borderColor: cBorder, borderWidth: 0.4
    });
    const scaleLbl = (scale === 1.0) ? '1 : 1 SCALE @ A3' : (scale.toFixed(2) + ' : 1 SCALE @ A3');
    _pdfLibDrawText(page, scaleLbl,
      chipX + 10, pageH - (chipY_topdown + 14),
      { font: fontBold, size: 10, colour: cText });
    if (scale === 1.0) {
      _pdfLibDrawText(page, 'Place a ruler across the centre to verify 200 mm = 200 mm.',
        chipX + 10, pageH - (chipY_topdown + 26),
        { font: fontReg, size: 7.5, colour: cMuted });
      _pdfLibDrawText(page, 'If the printed sheet has been scaled, multiply all radii proportionally',
        chipX + 10, pageH - (chipY_topdown + 36),
        { font: fontReg, size: 7.5, colour: cMuted });
      _pdfLibDrawText(page, 'before pre-bending cables on site.',
        chipX + 10, pageH - (chipY_topdown + 46),
        { font: fontReg, size: 7.5, colour: cMuted });
    } else {
      _pdfLibDrawText(page, 'Arcs reduced to fit page. Multiply each radius by ' + trueRatio + ' for true mm,',
        chipX + 10, pageH - (chipY_topdown + 26),
        { font: fontReg, size: 7.5, colour: cMuted });
      _pdfLibDrawText(page, 'or print A3 unscaled for true 1:1. Verify with a ruler before pre-bending',
        chipX + 10, pageH - (chipY_topdown + 36),
        { font: fontReg, size: 7.5, colour: cMuted });
      _pdfLibDrawText(page, 'cables on site.',
        chipX + 10, pageH - (chipY_topdown + 46),
        { font: fontReg, size: 7.5, colour: cMuted });
    }

    // Title-block band
    _paintTitleBlockPdfLib(page, ctx, {
      meta, pageNum, pageTotal, pageCode: 'BRD'
    });
    return page;
  }

  // ---- v2.4.3 — Final pagination pass (pdf-lib) ----
  // pdf-lib pages are mutable until save(). We rebuild the bottom-right cell
  // of the title-block band on every page with the FINAL page count once
  // every page has been added. Cheap — overlay a body-coloured rect on the
  // existing PAGE cell + repaint the X / Y stamp.
  // Each painter that needs renumbering tags its page with `_sonorPageInfo`
  // = { pageCode, pageNumPlaceholder, drgRectX, ... }; here we walk all pages
  // and re-stamp using pdfDoc.getPageCount() as the canonical total.
  function _finalisePaginationPdfLib(pdfDoc, ctx) {
    if (!pdfDoc || typeof pdfDoc.getPageCount !== 'function') return;
    const pages = pdfDoc.getPages();
    const total = pages.length;
    const fontBold = ctx && ctx.fontBold;
    const cBody = _pdfLibRgbHex(COLOURS.body);
    const cText = _pdfLibRgbHex(COLOURS.text);
    pages.forEach((page, i) => {
      try {
        const pageW = page.getWidth();
        // 5-cell band; final cell = ~17% width. Re-paint just the page-num
        // stamp inside the DRG cell. The cell starts at c5X = pageW * (1 - f5)
        // where f5 = 0.17.
        const f5 = 0.17;
        const c5X = pageW * (1 - f5);
        const c5W = pageW * f5;
        const padX5 = 8;
        // The page-num "X / Y" sits at top-down y=38 from band top; band is
        // 70pt tall anchored y=0 (bottom). Top of band = y=70 (bottom-up).
        // y = 70 - 38 = 32 (bottom-up) for the text baseline area.
        // The label "PAGE" is at offset 38 from band top; the X/Y value is at
        // (padX5 + 28) horizontal offset, same y. Cover small rect to overpaint.
        const stampX = c5X + padX5 + 28;
        const stampY = 70 - 38;       // bottom-up y (= 32)
        // Width covers ~36pt
        _pdfLibDrawRect(page, stampX - 1, stampY - 2, 60, 12, cBody);
        if (fontBold) {
          const txt = (i + 1) + ' / ' + total;
          page.drawText(txt, {
            x: stampX, y: stampY, size: 10, font: fontBold, color: cText
          });
        }
      } catch (e) {
        console.warn('[SonorPdf v2.4.3] page renumber failed at page ' + i + ':', e);
      }
    });
  }

  // v2.4.0 — Top-level pdf-lib entry point. Opt-in via localStorage flag.
  // On any error, falls back to v2.3.3 jsPDF path automatically.
  // v2.4.1 — extended to paint aspect schedule pages natively in pdf-lib.
  // v2.4.2 — extended to paint plan pages natively with shared XObject
  // background image dedup. Each floor's plan canvas snapshot is embedded
  // ONCE via embedJpg → reused by Combined Plans / CCTV / Electrical /
  // per-service slice pages via drawImage(sharedRef).
  // v2.4.3 — full integration: Cabling Info + Bend Radii reference pages
  // painted natively, page order matches v2.0.4 jsPDF (cover → CBL → BRD →
  // plans → schedules), final pagination pass after all pages added so the
  // PAGE X / Y stamp matches the actual deck length.
  // ---------------------------------------------------------------------
  // v5.5.61 — UNIFICATION Phase 1 (final): spec-driven Full Document
  // ---------------------------------------------------------------------
  // The original Phase 1 of PDF-UNIFICATION_2026-05-19.md. fullDocumentPdfLib
  // refactored from a 420-line monolith into a thin orchestrator that builds
  // a spec, dispatches each page kind to the right painter, and saves. Pure
  // refactor — no user-visible change. Unlocks future work: new export
  // types are one-line spec filters, new section kinds are one-case switch
  // additions, no painter modifications needed.

  // ---- v5.5.61 — Shared pdf-lib resource embed (fonts + wordmark) ----
  // Every pdf-lib painter needs the same standard font refs + wordmark.
  // Embedding once and sharing the refs is both the documented pdf-lib
  // best practice and a meaningful file-size win on multi-page decks.
  async function _embedSharedPdfLibResources(pdfDoc) {
    const { StandardFonts } = window.PDFLib;
    const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let wordmarkRef = null;
    if (window.__SONOR_WORDMARK_PDF__) {
      try {
        const wmStr = String(window.__SONOR_WORDMARK_PDF__);
        const wmBytes = _pdfLibBase64ToBytes(wmStr);
        wordmarkRef = (wmStr.indexOf('image/png') !== -1)
          ? await pdfDoc.embedPng(wmBytes)
          : await pdfDoc.embedJpg(wmBytes);
      } catch (e) { console.warn('[SonorPdf v5.5.61] wordmark embed failed:', e); }
    }
    return { fontReg, fontBold, wordmarkRef };
  }

  // ---- v5.5.61 — Plan-bg dedup map ----
  // For every floor in planPages, embed the architect's PDF bytes (vector
  // path, v5.1.4) OR the canvas snapshot (raster fallback) ONCE, returning
  // a Map<floorId, { ref, pdfPageRef, w, h }> that every plan page on that
  // floor can reference. This is the file-size win — 22-page deck with
  // 8MB plan bg → ~3.5MB on disk via shared XObject.
  async function _buildPlanRefsByFloor(pdfDoc, planPages) {
    const planRefsByFloor = new Map();
    if (!Array.isArray(planPages) || !planPages.length) return planRefsByFloor;
    for (const fp of planPages) {
      if (!fp || planRefsByFloor.has(fp.floorId)) continue;
      let pdfPageRef = null, pdfPageW = 0, pdfPageH = 0;
      if (fp.planPdfBytes && fp.planPdfBytes.byteLength > 0 && typeof pdfDoc.embedPdf === 'function') {
        try {
          const idx = Math.max(1, fp.planPdfPageIndex || 1) - 1;
          const embedded = await pdfDoc.embedPdf(fp.planPdfBytes, [idx]);
          if (Array.isArray(embedded) && embedded.length) {
            pdfPageRef = embedded[0];
            pdfPageW = (typeof pdfPageRef.width === 'number') ? pdfPageRef.width : (fp.planW || 1);
            pdfPageH = (typeof pdfPageRef.height === 'number') ? pdfPageRef.height : (fp.planH || 1);
          }
        } catch (e) {
          console.warn('[SonorPdf v5.5.61] embedPdf failed (raster fallback) for floor', fp.floorId, e);
        }
      }
      let rasterRef = null;
      if (fp.planDataUrl) {
        try {
          const raw = String(fp.planDataUrl);
          const isPng = raw.indexOf('data:image/png') === 0;
          const bytes = _pdfLibBase64ToBytes(raw);
          rasterRef = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        } catch (e) {
          console.warn('[SonorPdf v5.5.61] plan bg embed failed for floor', fp.floorId, e);
        }
      }
      if (pdfPageRef || rasterRef) {
        planRefsByFloor.set(fp.floorId, {
          ref: rasterRef, pdfPageRef, pdfPageW, pdfPageH,
          w: fp.planW || 1, h: fp.planH || 1
        });
      }
    }
    return planRefsByFloor;
  }

  // ---- v5.5.64 — HTML/CSS luxury cover (SonorPdfHtmlCover → JPEG embed) ----
  // The pre-unification jsPDF Full Document rendered the HTML/CSS cover
  // (CSS gradients + Gilroy + status pill + revision timeline + service
  // strip) via hidden iframe + html2canvas → JPEG, then embedded the JPEG
  // as the cover page. THIS is the "blue gradient" luxury cover Bryn
  // expects. My v5.5.61 spec-driven pdf-lib pipeline replaced it with a
  // simpler native pdf-lib composition, losing the gradient visual quality.
  //
  // This helper restores the HTML cover for the pdf-lib path: when
  // SonorPdfHtmlCover is loaded AND html2canvas is loaded AND the opt-out
  // flag is off, render the HTML cover, embed the resulting JPEG via
  // pdfDoc.embedJpg, drawImage at full page size. Returns true on success,
  // false on any failure (caller falls back to the native pdf-lib
  // composition in _paintFullCoverPdfLib).
  //
  // Opt-out (same flags as legacy jsPDF path):
  //   localStorage.takeoffs-pdf-html-cover = '0'
  //   OR window.__SONOR_PDF_HTML_COVER__ = false
  async function _tryPaintHtmlCoverPdfLib(pdfDoc, coverPage, ctx, opts) {
    try {
      const htmlCoverDisabled =
        (typeof window !== 'undefined') && (
          window.__SONOR_PDF_HTML_COVER__ === false ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-cover') === '0')
        );
      if (htmlCoverDisabled) {
        try { console.info('[SonorPdf v5.5.64 cover] HTML cover opted out via flag'); } catch (_) {}
        return false;
      }
      if (typeof window === 'undefined' ||
          !window.SonorPdfHtmlCover ||
          typeof window.SonorPdfHtmlCover.available !== 'function' ||
          !window.SonorPdfHtmlCover.available()) {
        try { console.info('[SonorPdf v5.5.64 cover] HTML cover NOT available — falling back to native pdf-lib cover'); } catch (_) {}
        return false;
      }

      const meta = ctx.meta;
      // Sort floors GF→1F→…→BA→EXT
      const _toNum = v => {
        if (v == null) return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : null;
      };
      const _sortFloorsHtml = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
        ? window.sonorSortFloors
        : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
            && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
           ? window.SonorPdfHtmlHelpers.sortFloors
           : null);
      const _floorsHtmlMapped = (Array.isArray(opts && opts.floorRows) ? opts.floorRows : []).map(r => ({
        name: r.name || r.code || '—',
        code: r.code,
        rooms: r.rooms,
        symbols: r.syms != null ? r.syms : r.symbols,
        areaM2: _toNum(r.areaM2 != null ? r.areaM2 : (r.area_m2 != null ? r.area_m2 : r.area)),
        perimeterM: _toNum(r.perimeterM != null ? r.perimeterM : (r.perimeter_m != null ? r.perimeter_m : r.perimeter))
      }));
      const floorsForHtml = _sortFloorsHtml ? _sortFloorsHtml(_floorsHtmlMapped) : _floorsHtmlMapped;

      // Compose totals from grand totals if available
      let totalsForHtml = null;
      try {
        if (typeof computeProjectTotals === 'function') {
          const t = computeProjectTotals();
          if (t && t.grand) {
            totalsForHtml = {
              floors: t.grand.floors, rooms: t.grand.rooms,
              blocks: (t.grand.symbols || 0) + (t.grand.shades || 0),   // v5.145.0 — drawn shades count as blocks (Bryn)
              areaM2: t.grand.areaM2, perimeterM: t.grand.perimeterM,
              cableM: t.grand.cableM, ledM: t.grand.ledM,
              shades: t.grand.shades
            };
          }
        }
      } catch (_) {}

      const services = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
        ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
        : null;

      if (typeof setStatus === 'function') setStatus('Rendering luxury cover (HTML/CSS, pdf-lib embed)…');
      const result = await window.SonorPdfHtmlCover.renderCover({
        title: (opts && opts.title) || 'FULL TAKE-OFF',
        subtitle: 'PROJECT TAKE-OFF',
        projectName: meta.name,
        client: meta.client,
        address: meta.address,
        reference: meta.ref || '—',
        status: meta.status,
        issueDate: meta.dateUk || meta.date,
        revision: meta.revision,
        revisionHistory: meta.revisionHistory || [],
        // v5.144.0 — forward cloud counts (see jsPDF cover callsite note).
        revCounts: meta.revCounts || null,
        revAdded: meta.revAdded || 0,
        revMoved: (meta.revMoved != null ? meta.revMoved : meta.revChanged) || 0,
        revRemoved: meta.revRemoved || 0,
        revRfi: meta.revRfi || 0,
        revNote: meta.revNote || 0,
        appName: 'Takeoffs',
        appVersion: meta.appVersion,
        accentHex: '#ad9978',   // v5.138.0/v5.143.0 — SONOR GOLD (re-applied to root master)
        backdropImg: (await _coverBackdrop()) || null,   // v5.249.0 — project cover photo (takeoffs-push link metadata.cover_photo) fades to black on the luxury hero (§41)
        services,
        floors: floorsForHtml,
        totals: totalsForHtml
      });
      if (!result || !result.dataUrl) {
        try { console.warn('[SonorPdf v5.5.64 cover] HTML cover renderCover returned no dataUrl'); } catch (_) {}
        return false;
      }

      // Embed the JPEG into pdf-lib and draw it at full page size.
      const raw = String(result.dataUrl);
      const isPng = raw.indexOf('data:image/png') === 0;
      const bytes = _pdfLibBase64ToBytes(raw);
      const ref = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const pageW = coverPage.getWidth();
      const pageH = coverPage.getHeight();
      coverPage.drawImage(ref, { x: 0, y: 0, width: pageW, height: pageH });

      try { window.__SONOR_LAST_COVER_PATH__ = 'html-via-pdflib'; } catch (_) {}
      console.log('[SonorPdf v5.5.64 cover] HTML cover embedded via pdf-lib ✓ (bytes=' +
        (raw ? raw.length : 0) + ')');
      return true;
    } catch (e) {
      console.warn('[SonorPdf v5.5.64 cover] HTML cover render/embed failed — falling back to native pdf-lib composition:', e);
      return false;
    }
  }

  // ---- v5.5.61 — Full branded cover painter (extracted from v5.5.59/60) ----
  // Slate hero band + app-accent stripe + title + subtitle + wordmark +
  // project info grid + project totals strip + service-colour dots + tagline +
  // brand footer + status pill + floor-rows table + page-edge border.
  // Pure painter, no spec assembly.
  async function _paintFullCoverPdfLib(pdfDoc, ctx, opts, pageTotalEstimate) {
    const { rgb } = window.PDFLib;
    const fontReg = ctx.fontReg;
    const fontBold = ctx.fontBold;
    const wordmarkRef = ctx.wordmarkRef;
    const meta = ctx.meta;
    const A3_LANDSCAPE = [1190, 842];
    const cover = pdfDoc.addPage(A3_LANDSCAPE);

    // v5.5.64 — FIRST try the HTML/CSS luxury cover (blue gradients, status
    // pill, revision timeline, service strip — via SonorPdfHtmlCover →
    // html2canvas → JPEG embed). If it succeeds, we're done — paint the
    // title-block band + page border on top and return. If it fails (module
    // not loaded, html2canvas missing, render error), fall through to the
    // native pdf-lib composition below.
    const htmlCoverOk = await _tryPaintHtmlCoverPdfLib(pdfDoc, cover, ctx, opts);
    if (htmlCoverOk) {
      // Footer title-block band + page border still go on top of the HTML JPEG.
      try {
        _paintTitleBlockPdfLib(cover, ctx, {
          meta, pageNum: 1, pageTotal: pageTotalEstimate, pageCode: 'CVR'
        });
      } catch (e) { console.warn('[SonorPdf v5.5.64] cover title-block over HTML cover failed:', e); }
      try { _pdfLibPageBorder(cover); } catch (_) {}
      return cover;
    }

    // ---- Fallback: native pdf-lib composition (v5.5.59/60 style) ----
    const slate = rgb(0x15 / 255, 0x1A / 255, 0x22 / 255);
    const white = rgb(1, 1, 1);
    const cTextDark = rgb(0x1A / 255, 0x1F / 255, 0x28 / 255);
    const cMutedRgb = rgb(0x63 / 255, 0x6C / 255, 0x7A / 255);

    // Slate hero band (180pt deep)
    const HERO_H = 180;
    cover.drawRectangle({ x: 0, y: 842 - HERO_H, width: 1190, height: HERO_H, color: slate });

    // App-accent stripe under hero (3pt service-purple)
    const appAccent = _hexToRgb(COLOURS.appAccent || '#6b4a8a');
    cover.drawRectangle({
      x: 0, y: 842 - HERO_H - 3, width: 1190, height: 3,
      color: rgb(appAccent.r / 255, appAccent.g / 255, appAccent.b / 255)
    });

    // Title + subtitle in hero
    cover.drawText('SONOR — ' + String(opts && opts.title || 'FULL TAKE-OFF').toUpperCase(),
      { x: 48, y: 842 - 80, size: 36, font: fontBold, color: white });
    cover.drawText('PROJECT TAKE-OFF · ARCHITECTURAL DELIVERABLE',
      { x: 48, y: 842 - 110, size: 11, font: fontReg, color: rgb(0xA8 / 255, 0xB0 / 255, 0xBC / 255) });

    // Wordmark in hero, top-right
    if (wordmarkRef) {
      const wmDim = window.__SONOR_WORDMARK_PDF_DIM__ || { w: 300, h: 85 };
      const targetW = 180;
      const targetH = targetW * (wmDim.h / wmDim.w);
      cover.drawImage(wordmarkRef, {
        x: 1190 - targetW - 48, y: 842 - 60 - targetH / 2,
        width: targetW, height: targetH
      });
    }

    // Project info grid (below hero)
    const infoTop = 842 - HERO_H - 36;
    const infoX = 48;
    const infoLabelSize = 8;
    const infoValueSize = 12;
    const infoRowH = 28;
    const fields = [
      ['PROJECT', meta.name || 'Untitled Takeoff'],
      ['CLIENT', meta.client || '—'],
      ['ADDRESS', meta.address || '—'],
      ['REFERENCE', meta.ref || '—'],
      ['ISSUE DATE', meta.dateUk || meta.date || ''],
      ['REVISION', meta.revision || '—']
    ];
    fields.forEach((row, i) => {
      const ry = infoTop - i * infoRowH;
      cover.drawText(String(row[0]).toUpperCase(),
        { x: infoX, y: ry, size: infoLabelSize, font: fontReg, color: cMutedRgb });
      cover.drawText(String(row[1] || ''),
        { x: infoX, y: ry - 14, size: infoValueSize, font: fontBold, color: cTextDark });
    });

    // Project totals strip (right column)
    const totalsX = 720;
    const totalsTop = infoTop;
    cover.drawText('PROJECT TOTALS',
      { x: totalsX, y: totalsTop, size: 9, font: fontBold, color: cMutedRgb });
    try {
      if (Array.isArray(opts && opts.summary)) {
        opts.summary.forEach((s, i) => {
          const ry = totalsTop - 18 - i * 20;
          cover.drawText(String(s.label || ''),
            { x: totalsX, y: ry, size: 9, font: fontReg, color: cMutedRgb });
          cover.drawText(String(s.value == null ? '' : s.value),
            { x: totalsX + 200, y: ry, size: 11, font: fontBold, color: cTextDark });
        });
      }
    } catch (_) {}

    // 10 service-colour dots strip + tagline
    const stripY = 200;
    if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
      SERVICES.slice(0, 10).forEach((s, i) => {
        if (!s || !s.colour) return;
        const c = _hexToRgb(s.colour);
        cover.drawCircle({
          x: 48 + i * 22, y: stripY, size: 7,
          color: rgb(c.r / 255, c.g / 255, c.b / 255)
        });
      });
    }
    cover.drawText((COMPANY.tagline || 'Smart homes, beautifully done').toUpperCase(),
      { x: 48, y: stripY - 24, size: 9, font: fontReg, color: cMutedRgb });

    // Brand footer contact line
    const contactY = 90;
    cover.drawText((COMPANY.location || 'Chester, England') + '  ·  ' +
                   (COMPANY.web || 'sonor.co.uk') + '  ·  ' +
                   (COMPANY.email || '') + '  ·  ' + (COMPANY.phone || ''),
      { x: 48, y: contactY, size: 8.5, font: fontReg, color: cMutedRgb });

    // v5.5.60 — Status pill (top-right of hero)
    try {
      if (meta.status) {
        _pdfLibStatusPill(cover, ctx, meta.status,
          1190 - 240, 36,
          { fontSize: 8.5, padX: 10, padY: 4 });
      }
    } catch (e) { console.warn('[SonorPdf v5.5.61] cover status pill failed:', e); }

    // v5.5.60 — Floor rows table (left column)
    try {
      if (Array.isArray(opts && opts.floorRows) && opts.floorRows.length) {
        const tblTop = 842 - HERO_H - 36 - (fields.length * infoRowH) - 24;
        cover.drawText('PER-FLOOR BREAKDOWN',
          { x: 48, y: tblTop, size: 9, font: fontBold, color: cMutedRgb });
        const rowsTop = tblTop - 18;
        const rowH = 16;
        cover.drawText('FLOOR',  { x: 48,  y: rowsTop, size: 8, font: fontReg, color: cMutedRgb });
        cover.drawText('ROOMS',  { x: 220, y: rowsTop, size: 8, font: fontReg, color: cMutedRgb });
        cover.drawText('BLOCKS', { x: 290, y: rowsTop, size: 8, font: fontReg, color: cMutedRgb });
        cover.drawText('AREA',   { x: 370, y: rowsTop, size: 8, font: fontReg, color: cMutedRgb });
        cover.drawText('CABLE',  { x: 450, y: rowsTop, size: 8, font: fontReg, color: cMutedRgb });
        opts.floorRows.slice(0, 8).forEach((r, i) => {
          const ry = rowsTop - 14 - i * rowH;
          cover.drawText(_pdfLibTruncate(fontBold, 10, String(r.name || r.code || '—'), 160),
            { x: 48, y: ry, size: 10, font: fontBold, color: cTextDark });
          cover.drawText(String(r.rooms || 0),
            { x: 220, y: ry, size: 10, font: fontReg, color: cTextDark });
          cover.drawText(String(r.symbols || 0),
            { x: 290, y: ry, size: 10, font: fontReg, color: cTextDark });
          cover.drawText(r.area ? (r.area + ' m²') : '—',
            { x: 370, y: ry, size: 10, font: fontReg, color: cTextDark });
          cover.drawText(r.cable ? (r.cable + ' m') : '—',
            { x: 450, y: ry, size: 10, font: fontReg, color: cTextDark });
        });
      }
    } catch (e) { console.warn('[SonorPdf v5.5.61] cover floor rows failed:', e); }

    // Footer title-block band (mirrors every other page so the deck reads continuous)
    try {
      _paintTitleBlockPdfLib(cover, ctx, {
        meta, pageNum: 1, pageTotal: pageTotalEstimate, pageCode: 'CVR'
      });
    } catch (e) { console.warn('[SonorPdf v5.5.61] cover title-block paint failed:', e); }

    // v5.5.60 — Sonor canonical page-edge border (LAST, on top)
    try { _pdfLibPageBorder(cover); } catch (_) {}

    return cover;
  }

  // ---- v5.185.2 (B-362) — ONE aspect→section-key map ----
  // Maps an aspect key → Full-Document ticklist section key. Used by BOTH
  // the _buildFullDocSpec precount AND the fullDocument emit filter — the
  // two sites previously carried hand-mirrored copies that diverged on the
  // pjscreen branch (B-359 "PAGE x OF y" drift class). ONE source now.
  // Unknown aspects return null → always emit (never gate what we can't name).
  function _aspectSectionKey(asp) {
    asp = String(asp || '');
    if (asp === 'rooms') return 'rooms';
    if (asp === 'zones') return 'zones';
    if (asp === 'symbols' || asp === 'blocks') return 'blocks';
    // v5.71.0 — cables_lighting was unmapped → ALWAYS included regardless
    // of the ticklist. Both cable schedules ship under the "Cable
    // schedule" section tick.
    if (asp === 'cables_v2' || asp === 'cables' || asp === 'cable_summary'
        || asp === 'cables_lighting') return 'cables';
    if (asp === 'leds' || asp === 'dmx') return 'leds';   // v5.255.0 — the DMX Address Schedule rides the LED tick
    if (asp === 'lighting') return 'lighting';
    if (asp === 'shades') return 'shades';
    if (asp === 'tvs' || asp === 'displays') return 'displays';
    // Prefix match (kept from the precount copy — superset of the emit
    // filter's old enumeration, so any pjscreen_* variant maps consistently).
    if (asp.indexOf('pjscreen') === 0) return 'pjscreens';
    if (asp.indexOf('svc_') === 0) return 'slices';
    return null;
  }

  // ---- v5.5.61 — Full Document spec builder ----
  // Pure data assembly: given opts + an embed context (with planRefsByFloor
  // pre-computed), returns the ordered list of pages to render. Each page
  // is { kind, role, payload } so the renderer can dispatch cleanly.
  //
  // Spec shape:
  //   {
  //     pageTotalEstimate: number,
  //     pages: [
  //       { kind: 'cover',     role: 'project' },
  //       { kind: 'refPage',   role: 'cabling' },
  //       { kind: 'refPage',   role: 'bendRadii' },
  //       { kind: 'planPage',  role: <combined|cctv|electrical|service>, payload: { fp, planPage, sharedRefEntry } },
  //       { kind: 'aspectPage', role: aspect.aspect, payload: aspect },
  //       …
  //     ]
  //   }
  function _buildFullDocSpec(opts, ctx, planRefsByFloor, filteredAspects, planPages) {
    // v5.18.0 — section ticklist gate (parity with the jsPDF fullDocument
    // path). Reads the same takeoffs-fullpdf-sec-<key> localStorage flags.
    const _secOn = (key, legacyKey) => {
      // v5.272.0 — Plans only (#btnReportPlansPdf → opts.plansOnly): cover + floor plans, every optional section off.
      // The flag was only read for the rear page, so the button produced the whole document.
      if (opts && opts.plansOnly) return false;
      try {
        const v = localStorage.getItem('takeoffs-fullpdf-sec-' + key);
        if (v !== null) return v !== '0';
        if (legacyKey) { const lv = localStorage.getItem(legacyKey); if (lv !== null) return lv !== '0'; }
      } catch (_) {}
      // v5.90.0 — UNSET keys resolve through the host's dynamic default
      // (rooms/zones OFF; content-driven schedules follow project content;
      // Bryn: "keep them out the way for now"). Explicit ticks always win.
      return (typeof window !== 'undefined' && typeof window._sonorFullDocSecDefault === 'function')
        ? window._sonorFullDocSecDefault(key) !== false
        : true;
    };
    // v5.185.2 (B-362) — alias of the ONE module-scope map (was a
    // hand-mirrored copy of the fullDocument emit filter's map).
    const _aspecSec = _aspectSectionKey;
    const _incInfo  = _secOn('info');
    const _incCctv  = _secOn('cctv');
    const _incElec  = _secOn('electrical');
    const _incSlice = _secOn('slices', 'takeoffs-fullpdf-svcslices');

    const pages = [];
    pages.push({ kind: 'cover',   role: 'project' });
    if (_incInfo) {
      pages.push({ kind: 'refPage', role: 'cabling' });
      pages.push({ kind: 'refPage', role: 'bendRadii' });
    }
    // Plan pages — Combined / CCTV / Electrical / per-svc slice (host-built order)
    for (const fp of (planPages || [])) {
      if (!fp || !Array.isArray(fp.pages) || !fp.pages.length) continue;
      const sharedRefEntry = planRefsByFloor.get(fp.floorId);
      for (const planPage of fp.pages) {
        // Page-role: COM- = combined, CCT = cctv, ELE = electrical, SLI- = service
        const code = String(planPage.pageCode || '');
        let role = 'plan';
        if (code.indexOf('COM-') === 0)      role = 'combined';
        else if (code === 'CCT')             role = 'cctv';
        else if (code === 'ELE')             role = 'electrical';
        else if (code.indexOf('SLI-') === 0) role = 'service';
        // v5.18.0 — section ticklist: skip optional plan roles when unticked.
        if (role === 'cctv' && !_incCctv) continue;
        if (role === 'electrical' && !_incElec) continue;
        if (role === 'service' && !_incSlice) continue;
        pages.push({
          kind: 'planPage', role,
          payload: { fp, planPage, sharedRefEntry }
        });
      }
    }
    // Aspect schedule pages — v5.18.0 section ticklist filter
    (filteredAspects || []).forEach(a => {
      if (opts && opts.plansOnly) return;   // v5.272.0 — Plans only
      const k = _aspecSec(a && a.aspect);
      if (k && !_secOn(k, k === 'slices' ? 'takeoffs-fullpdf-svcslices' : null)) return;
      pages.push({ kind: 'aspectPage', role: String(a.aspect || 'aspect'), payload: a });
    });
    // Total estimate (refined by renderer after multi-page aspects)
    const totalPlanPages = (planPages || []).reduce((acc, fp) =>
      acc + (Array.isArray(fp && fp.pages) ? fp.pages.length : 0), 0);
    // v5.18.0 — estimate from the ACTUAL gated spec (cover + included
    // ref/plan/aspect pages). Multi-page aspects add more at render time;
    // _finalisePaginationPdfLib restamps every native page with the true
    // total, so a 1-page-per-spec-entry baseline is sufficient.
    void totalPlanPages;
    const pageTotalEstimate = pages.length;
    return { pages, pageTotalEstimate };
  }

  // ---- v5.5.61 — Spec dispatch renderer ----
  // Iterates spec.pages and dispatches each kind to the right painter.
  // Tracks curPageNum + page-totals for renumbering. Multi-page aspect
  // schedules (v5.5.58) hint back `_pagesAdded`; we read it to advance
  // curPageNum past continuation pages.
  async function _renderSpecToPdfLib(spec, pdfDoc, ctx, opts) {
    const counters = { cover: 0, refPages: 0, planPages: 0, aspectPages: 0 };
    let curPageNum = 0;
    const pageTotalEstimate = spec.pageTotalEstimate;

    for (const page of spec.pages) {
      switch (page.kind) {
        case 'cover': {
          // v5.5.64 — await: _paintFullCoverPdfLib is async now so it can
          // try the HTML/CSS luxury cover via SonorPdfHtmlCover first.
          await _paintFullCoverPdfLib(pdfDoc, ctx, opts, pageTotalEstimate);
          counters.cover++;
          curPageNum = 1;
          break;
        }
        case 'refPage': {
          curPageNum++;
          try {
            if (page.role === 'cabling') {
              _paintCablingInfoPagePdfLib(pdfDoc, ctx, {
                pageNum: curPageNum, pageTotal: pageTotalEstimate
              });
            } else if (page.role === 'bendRadii') {
              _paintBendRadiusPagePdfLib(pdfDoc, ctx, {
                pageNum: curPageNum, pageTotal: pageTotalEstimate
              });
            }
            counters.refPages++;
          } catch (e) {
            console.warn('[SonorPdf v5.5.61] refPage ' + page.role + ' paint failed:', e);
          }
          break;
        }
        case 'planPage': {
          curPageNum++;
          const { fp, planPage, sharedRefEntry } = page.payload;
          planPage._pageNum = curPageNum;
          planPage._pageTotal = pageTotalEstimate;
          try {
            const hasInset = (Array.isArray(planPage.legend) && planPage.legend.length)
                          || (planPage.floorTotals && Object.keys(planPage.floorTotals).length);
            const showNotes = planPage.showNotes !== false;
            let pageBgRef = sharedRefEntry ? sharedRefEntry.ref : null;
            let pageBgPdfRef = (sharedRefEntry && !planPage.planOverrideDataUrl)
              ? sharedRefEntry.pdfPageRef : null;
            // Per-page bg override (slice crop) — embed lazily here, not in dedup pass
            if (planPage.planOverrideDataUrl) {
              try {
                const raw = String(planPage.planOverrideDataUrl);
                const isPng = raw.indexOf('data:image/png') === 0;
                const bytes = _pdfLibBase64ToBytes(raw);
                pageBgRef = isPng
                  ? await pdfDoc.embedPng(bytes)
                  : await pdfDoc.embedJpg(bytes);
                pageBgPdfRef = null;
              } catch (e) {
                console.warn('[SonorPdf v5.5.61] per-page bg override embed failed:', e);
              }
            }
            const snapW = (planPage.overlayW || (sharedRefEntry && sharedRefEntry.w) || 1);
            const snapH = (planPage.overlayH || (sharedRefEntry && sharedRefEntry.h) || 1);
            const planRect = _pdfLibPlanRect(1190, 842, snapW, snapH, { showNotes, hasInset });
            await _paintPlanPagePdfLib(pdfDoc, ctx, {
              pageTitle: planPage.pageTitle || 'COMBINED PLANS',
              pageHint: planPage.pageHint || (fp.floorName ? ('Floor — ' + fp.floorName) : null),
              drawingCode: planPage.drawingCode || _drawingCode(ctx.meta, planPage.pageCode || 'COM-01'),
              aspectAccent: planPage.aspectAccent || ASPECT_ACCENT.plan,
              pageCode: planPage.pageCode || 'COM-01',
              pageNum: curPageNum,
              pageTotal: pageTotalEstimate,
              bgImageRef: pageBgRef,
              bgPdfPageRef: pageBgPdfRef,
              bgImageDim: planRect,
              overlayDataUrl: planPage.overlayDataUrl || null,
              overlayDim: planRect,
              legend: planPage.legend || null,
              floorTotals: planPage.floorTotals || null,
              floorTotalsTitle: planPage.floorTotalsTitle || 'Floor totals',
              footnote: planPage.footnote || null,
              showNotes
            });
            counters.planPages++;
          } catch (e) {
            console.warn('[SonorPdf v5.5.61] planPage paint failed:', e);
          }
          break;
        }
        case 'aspectPage': {
          curPageNum++;
          const aspect = page.payload;
          aspect._pageNumStart = curPageNum;
          aspect._pageTotal = pageTotalEstimate;
          _paintAspectPdfLib(pdfDoc, ctx, aspect);
          // v5.5.58 multi-page: read back how many pages this aspect emitted
          const produced = (typeof aspect._pagesAdded === 'number' && aspect._pagesAdded > 0) ? aspect._pagesAdded : 1;
          counters.aspectPages += produced;
          if (produced > 1) curPageNum += produced - 1;
          break;
        }
        default:
          console.warn('[SonorPdf v5.5.61] unknown spec page kind:', page.kind);
      }
    }

    // Final pagination pass — rewrites every page-stamp with actual final total
    try { _finalisePaginationPdfLib(pdfDoc, ctx); }
    catch (e) { console.warn('[SonorPdf v5.5.61] page renumber failed:', e); }

    return counters;
  }

  async function fullDocumentPdfLib(opts) {
    if (!_pdfLibAvailable()) {
      console.warn('[SonorPdf v5.5.61] pdf-lib not loaded — falling back to jsPDF');
      return null;
    }
    // v5.25.0 — reset footer latch (full title-block on first footer page only).
    try { if (typeof window !== 'undefined') window.__SONOR_PDF_FOOTER_LATCH__ = false; } catch (_) {}
    try {
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();

      // 1. Embed shared resources (fonts + wordmark) — once per doc.
      const baseCtx = await _embedSharedPdfLibResources(pdfDoc);
      const meta = collectProjectMeta();
      baseCtx.meta = meta;

      // 2. Build the source data: aspects + plan pages.
      const aspects = (typeof opts.buildAspects === 'function')
        ? opts.buildAspects()
        : (Array.isArray(opts && opts.aspects) ? opts.aspects : []);
      const filteredAspects = (aspects || []).filter(a =>
        a && a.report && Array.isArray(a.report.rows) && a.report.rows.length > 0);
      const planPages = Array.isArray(opts.planPages) ? opts.planPages : [];

      // 3. Dedup plan backgrounds (one XObject per floor — file-size win).
      const planRefsByFloor = await _buildPlanRefsByFloor(pdfDoc, planPages);

      // 4. Build the spec (pure data).
      const spec = _buildFullDocSpec(opts, baseCtx, planRefsByFloor, filteredAspects, planPages);

      // 5. Render the spec (dispatches each page kind to the right painter).
      const counters = await _renderSpecToPdfLib(spec, pdfDoc, baseCtx, opts);

      // v5.5.69 — bake Sonor metadata + debug build stamp before save
      try { _applyDocumentMetadataPdfLib(pdfDoc, meta, { title: opts && opts.title || 'Full Take-Off' }); } catch (_) {}
      // 6. Save + download.
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = meta.date;
      const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const fname = `sonor-${projSlug}-full-pdflib_${stamp}.pdf`;
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof setStatus === 'function') {
        const refTxt = counters.refPages ? ` + ${counters.refPages} ref` : '';
        const planTxt = counters.planPages ? ` + ${counters.planPages} plan${counters.planPages === 1 ? '' : 's'}` : '';
        const aspectTxt = counters.aspectPages ? ` + ${counters.aspectPages} schedule${counters.aspectPages === 1 ? '' : 's'}` : '';
        const dedupTxt = planRefsByFloor.size ? ` · ${planRefsByFloor.size} bg${planRefsByFloor.size === 1 ? '' : 's'} dedup'd` : '';
        setStatus(`pdf-lib export complete — ${fname} (${pdfBytes.length} bytes · cover${refTxt}${planTxt}${aspectTxt}${dedupTxt} · v5.5.61 spec-driven)`);
      }
      return fname;
    } catch (err) {
      console.error('[SonorPdf v5.5.61] pdf-lib path threw — caller will fall back to jsPDF:', err);
      return null;
    }
  }

  // ============================================================
  // v5.5.61 — END Phase 1 (spec-driven Full Document). Pre-refactor
  // monolith below (replaced). The new structure: 6 dedicated helpers
  // (_embedSharedPdfLibResources, _buildPlanRefsByFloor, _paintFullCoverPdfLib,
  // _buildFullDocSpec, _renderSpecToPdfLib, fullDocumentPdfLib orchestrator)
  // make every page kind one-case in the dispatch switch. Adding a new page
  // kind (e.g. "section divider", "scoreboard", "QR code page") is now a
  // 5-line change: add a case to _renderSpecToPdfLib + emit it from
  // _buildFullDocSpec when appropriate.
  // ============================================================
  // v5.11.0 — v5.5.61 LEGACY-INLINE-ASIDE deleted (423 commented-out lines: fullDocumentPdfLib_LEGACY_v5_5_60 stub + the 420-line pre-Phase-1 ORIGINAL BODY). Retention window ('one release cycle') long expired; restore from git history if ever needed. fullDocument() dispatcher below is LIVE.

  async function fullDocument(opts) {
    // v2.4.4 — pdf-lib path is now the DEFAULT. Try it FIRST and fall back
    // to v2.3.3 jsPDF raster on null return / thrown error. The window flag
    // window.__SONOR_LAST_PDF_PATH__ records which path produced the file.
    // v2.8.2 — DIAGNOSTIC LOGGING UPGRADE. Pre-v2.8.2 the dispatcher silently
    // fell back when pdf-lib failed; only a console.warn with no error stack.
    // Now: capture err on window.__SONOR_LAST_PDF_ERROR__ so Bryn can inspect
    // after a Full Document export. Also distinguish (a) flag off (b) lib
    // unavailable (c) returned null (d) thrown error.
    try { window.__SONOR_LAST_PDF_ERROR__ = null; } catch (_) {}
    const flagOn = _pdfLibFlagOn();
    const libOk  = _pdfLibAvailable();
    try {
      console.log('[Sonor PDF v2.8.2] Full Document dispatcher:', {
        flagOn, libOk,
        pdfLibLoaded: typeof window !== 'undefined' && !!window.PDFLib,
        jsPdfLoaded:  typeof window !== 'undefined' && !!(window.jspdf && window.jspdf.jsPDF)
      });
    } catch (_) {}
    if (flagOn && libOk) {
      if (typeof setStatus === 'function') setStatus('Generating via pdf-lib pipeline (v2.8.2)…');
      try {
        const result = await fullDocumentPdfLib(opts);
        if (result) {
          try { window.__SONOR_LAST_PDF_PATH__ = 'pdf-lib'; } catch (_) {}
          try { console.log('[Sonor PDF v2.8.2] pdf-lib path SUCCEEDED'); } catch (_) {}
          return result;
        }
        try { window.__SONOR_LAST_PDF_ERROR__ = new Error('pdf-lib returned null'); } catch (_) {}
        console.warn('[Sonor PDF v2.8.2] pdf-lib path returned null — investigate window.__SONOR_LAST_PDF_ERROR__. Falling back to legacy raster.');
      } catch (err) {
        try { window.__SONOR_LAST_PDF_ERROR__ = err; } catch (_) {}
        console.error('[Sonor PDF v2.8.2] pdf-lib path THREW — falling back to jsPDF:', err);
        try { console.error('[Sonor PDF v2.8.2] Stack:', err && err.stack); } catch (_) {}
      }
    } else {
      try {
        console.warn('[Sonor PDF v2.8.2] pdf-lib path skipped:', { flagOn, libOk, reason: !flagOn ? 'flag off (localStorage takeoffs-pdf-lib-disable=1 or takeoffs-pdf-lib=0)' : 'pdf-lib not loaded — see _pdfLibAvailable() diagnostic above' });
      } catch (_) {}
    }
    try { window.__SONOR_LAST_PDF_PATH__ = 'jspdf-raster'; } catch (_) {}
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof setStatus === 'function') setStatus('PDF library not loaded — check network.');
      return null;
    }
    opts = opts || {};
    // v5.25.0 — reset the footer latch so the FIRST footer-bearing page of
    // this deck (the first INFO page — the cover carries no pageFooter) gets
    // the full title-block; every later page gets the slim page-number strip.
    try { if (typeof window !== 'undefined') window.__SONOR_PDF_FOOTER_LATCH__ = false; } catch (_) {}
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3', compress: true }); // v5.39.0 (B-350)
    _registerSonorFonts(pdf);
    _trackHtmlPageStamps(pdf);   // v2.9.0 — HTML page numbers restamped from the final count after assembly
    const meta = collectProjectMeta();
    const title = opts.title || 'FULL TAKE-OFF';

    // v5.18.0 — FULL-PACK SECTION TICKLIST. The export panel's "Sections to
    // include" checklist writes per-section localStorage flags
    // (takeoffs-fullpdf-sec-<key>, '1'/'0'). Cover + Combined plans are the
    // spine (always emitted). Every other section is gated by _secOn() at
    // BOTH the page-total precompute AND the emit site so pagination stays
    // exact. slices + dividers honour their legacy keys too (back-compat).
    const _secOn = (key, legacyKey) => {
      // v5.272.0 — Plans only (#btnReportPlansPdf → opts.plansOnly): cover + floor plans, every optional section off.
      // The flag was only read for the rear page, so the button produced the whole document.
      if (opts && opts.plansOnly) return false;
      try {
        const v = localStorage.getItem('takeoffs-fullpdf-sec-' + key);
        if (v !== null) return v !== '0';
        if (legacyKey) { const lv = localStorage.getItem(legacyKey); if (lv !== null) return lv !== '0'; }
      } catch (_) {}
      // v5.90.0 — UNSET keys resolve through the host's dynamic default
      // (rooms/zones OFF; content-driven schedules follow project content;
      // Bryn: "keep them out the way for now"). Explicit ticks always win.
      return (typeof window !== 'undefined' && typeof window._sonorFullDocSecDefault === 'function')
        ? window._sonorFullDocSecDefault(key) !== false
        : true;
    };
    const _incInfo     = _secOn('info');
    const _incOverall  = _secOn('overall');
    const _incCctv     = _secOn('cctv');
    const _incElec     = _secOn('electrical');
    const _incLightPlan = _secOn('lightingplan');   // v5.69.0
    const _incLkpPlan   = _secOn('lkpplan');        // v5.69.0
    const _incExternal = _secOn('external');   // v5.42.0 — External Areas plan page
    const _incDividers = _secOn('dividers', 'takeoffs-fullpdf-dividers');
    // v5.198.0 — the "Cinema Construction" cross-app divider is meaningless
    // on a project with no cinema (Heybridge: 0 × service 01) — drop it.
    const _cinemaPresent = (() => {
      try { return (collectTakeoffAllFloors().symbols || []).some(s => s && String(s.service_nn || s.nn || '').padStart(2, '0') === '01'); }
      catch (_) { return true; }
    })();
    const _dividerCount = () => (_cinemaPresent ? 3 : 2);
    const _rearPageOn = () => !(opts && opts.plansOnly) && !(opts && opts.noRearPage);   // v5.249.0 §41 — every full document ends on the contact page
    const _incSlices   = _secOn('slices',   'takeoffs-fullpdf-svcslices');
    // v5.157.0 (Bryn: "need a subsection of service slices ticks in case we
    // dont want every one") — per-service slice tick, default ON. Host hook
    // first (SSOT with the exports panel), localStorage fallback for harness
    // runs. Skips PLAN pages only — the service schedule + special plans in
    // that service's block still emit.
    const _sliceSvcOn = (nn) => {
      if (opts && opts.plansOnly) return false;   // v5.272.0 — Plans only
      try {
        if (typeof window !== 'undefined' && typeof window._sonorSliceSvcOn === 'function') {
          return window._sonorSliceSvcOn(nn) !== false;
        }
      } catch (_) {}
      try { return localStorage.getItem('takeoffs-fullpdf-slice-' + nn) !== '0'; } catch (_) { return true; }
    };
    // v5.168.0 (Bryn: "we need a plan and shedule tick per service because we
    // dont necessarily want everything") — separate SCHEDULE tick per service.
    const _svcSchedOn = (nn) => {
      if (opts && opts.plansOnly) return false;   // v5.272.0 — Plans only
      try {
        if (typeof window !== 'undefined' && typeof window._sonorSvcSchedOn === 'function') {
          return window._sonorSvcSchedOn(nn) !== false;
        }
      } catch (_) {}
      try { return localStorage.getItem('takeoffs-fullpdf-svcsched-' + nn) !== '0'; } catch (_) { return true; }
    };
    // v5.170.0 (Bryn: "information and standards should be broken down also")
    // — per-page ticks inside the Info & standards section, keyed through the
    // SAME _secOn store as every other section (persistence, presets and
    // all/none come free). Master 'info' still gates the whole block.
    // v5.185.0 — INFO SPLIT (Bryn: "info 00.3, 00.5, 00.1, 00.7 should all
    // go to a new section before the cable schedule"): FRONT pages (plan-
    // reading info) emit after the cover as before; the CABLING STANDARDS
    // pack (template pageIndex 3 + 4) + the bend-radius page now emit
    // immediately BEFORE the first cable schedule aspect. Tick keys are
    // unchanged so persisted export presets keep working — infoinstall /
    // infotails now gate the two pack pages.
    // v5.253.0 (Bryn: "the intro plan notes and revisions … seems to be duplicated in an odd way") — ONE merged front page:
    // revision history + notes + taxonomy + symbol convention + mounting + annotations (html-templates 1.17.0). The taxonomy
    // / key ticks now switch those sections inside the page instead of adding sheets; the legacy 00.4 revision-table page
    // (idx 5) is gone — it repeated the revision panel.
    const _INFO_FRONT = [
      { key: 'inforev',     idx: 0 }    // PROJECT INFORMATION (merged)
    ];
    const _frontSectionsOn = () => ({ tax: _secOn('infotax'), key: _secOn('infokey') });
    const _builderPagesCount = () => { try { const b = (typeof window !== 'undefined' && typeof window._builderRequirementsData === 'function') ? window._builderRequirementsData() : null; return (b && b.total) ? 1 : 0; } catch (_) { return 0; } };
    const _INFO_PACK = [
      { key: 'infoinstall', idx: 3 },   // 00.5 Cable ID + 00.6 Types & Bend Radii
      { key: 'infotails',   idx: 4 }    // 00.7 Install Notes + 00.8 Tails Protocol
    ];
    // v5.243.0 (Bryn: "the pdf full version doesnt continue the notes on to more pages") — the PLAN NOTES card on the
    // revision-history page was a fixed A3 page, so a long notes / RFI list was cut off at the page edge. Split the export
    // notes into page-sized chunks (estimated lines: ~190 chars per line on the full-width card; the first page shares the
    // sheet with the revision history, so it takes fewer) and emit continuation pages (pageIndex 100+k) straight after it.
    const _NOTES_FIRST_LINES = 22, _NOTES_CONT_LINES = 50, _NOTES_CHARS = 215;
    const _pdfNoteChunks = () => {
      let notes = [];
      try { notes = (typeof window !== 'undefined' && typeof window._planNotesForExport === 'function') ? (window._planNotesForExport() || []) : []; } catch (_) { notes = []; }
      const chunks = [[]]; let used = 0;
      notes.forEach(n => {
        const lines = Math.max(1, Math.ceil((String(n.text || '').length + 24) / _NOTES_CHARS)) + 0.35;
        const budget = chunks.length === 1 ? _NOTES_FIRST_LINES : _NOTES_CONT_LINES;
        if (used + lines > budget && chunks[chunks.length - 1].length) { chunks.push([]); used = 0; }
        chunks[chunks.length - 1].push(n); used += lines;
      });
      return chunks;
    };
    const _infoCablingIdxFor = (hasRev) => {
      // FRONT pages only (the pack emits later, before the Cable Schedule).
      const l = _INFO_FRONT.filter(pg => _secOn(pg.key)).map(pg => pg.idx);
      if (l.indexOf(0) >= 0) { const nC = _pdfNoteChunks().length; const extra = []; for (let k = 1; k < nC; k++) extra.push(100 + k); l.splice(l.indexOf(0) + 1, 0, ...extra); }
      return l;   // v5.253.0 — no legacy 00.4 revision-table page (duplicate of the revision panel)
    };
    const _infoPackIdxList = () => _INFO_PACK.filter(pg => _secOn(pg.key)).map(pg => pg.idx);
    // Map an aspect key → ticklist section key. Unknown aspects always emit.
    // v5.185.2 (B-362) — alias of the ONE module-scope map. The old inline
    // copy here enumerated pjscreen keys exactly and had already drifted
    // from the precount's prefix match (B-359 page-total drift class).
    const _aspectSecKey = _aspectSectionKey;
    const _aspectIncluded = (a) => {
      if (opts && opts.plansOnly) return false;   // v5.272.0 — Plans only: no schedule / aspect pages (unmapped aspects used to slip through)
      const k = a && _aspectSecKey(a.aspect);
      if (!k) return true;
      return _secOn(k, k === 'slices' ? 'takeoffs-fullpdf-svcslices' : null);
    };

    if (typeof setStatus === 'function') setStatus('Capturing floors…');
    const captured = await _captureAllFloors(opts);
    if (!captured.length || !captured[0].snap) {
      if (typeof setStatus === 'function') setStatus('Plan canvas not ready.');
      return null;
    }

    // v1.31.0 — aspect collectors run AFTER all floors captured so the
    // active floor has been restored. _captureAllFloors's finally-block
    // restores activeFloorId, then aspect collectors walk the live
    // canvas state (now == original active floor again).
    const aspects = (typeof opts.buildAspects === 'function')
      ? opts.buildAspects()
      : (Array.isArray(opts.aspects) ? opts.aspects : []);
    const filtered = aspects
      .filter(a => a && a.report && Array.isArray(a.report.rows) && a.report.rows.length > 0)
      .filter(_aspectIncluded);  // v5.18.0 — section ticklist gate

    const pageTotalEstimate = 1 + captured.length + filtered.length;

    // v5.4.60 — Compute floors[] + totals{} ONCE up-front so BOTH the cover
    // render (lighter, info-grid + revision-timeline only) AND the page-2
    // 00.1 Taxonomy emit (which now hosts FLOORS + PROJECT TOTALS in its
    // LHS column per Bryn directive 2026-05-10) read the same data. The
    // cover's existing inline compute (lines ~7903-7950) is kept for now
    // but reads from these vars when present.
    const _toNum_pre = v => (typeof v === 'number' ? v : (typeof v === 'string' && v !== '' ? parseFloat(v) : null));
    const _sortFloorsHtml_pre = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
      ? window.sonorSortFloors
      : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
          && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
         ? window.SonorPdfHtmlHelpers.sortFloors
         : null);
    const _floorsForPages = (Array.isArray(opts.floorRows) ? opts.floorRows : []).map(r => ({
      name: r.name || r.code || '—',
      code: r.code,
      rooms: r.rooms,
      symbols: r.syms != null ? r.syms : r.symbols,
      areaM2: _toNum_pre(r.areaM2 != null ? r.areaM2 : (r.area_m2 != null ? r.area_m2 : r.area)),
      perimeterM: _toNum_pre(r.perimeterM != null ? r.perimeterM : (r.perimeter_m != null ? r.perimeter_m : r.perimeter))
    }));
    const _floorsForPagesSorted = _sortFloorsHtml_pre ? _sortFloorsHtml_pre(_floorsForPages) : _floorsForPages;
    let _totalsForPages = null;
    try {
      if (typeof computeProjectTotals === 'function') {
        const _t = computeProjectTotals();
        if (_t && _t.grand) {
          _totalsForPages = {
            floors: _t.grand.floors, rooms: _t.grand.rooms,
            blocks: _t.grand.symbols,
            areaM2: _t.grand.areaM2, perimeterM: _t.grand.perimeterM,
            cableM: _t.grand.cableM, ledM: _t.grand.ledM,
            shades: _t.grand.shades
          };
        }
      }
    } catch (_) {}
    // Stash on meta so any consumer reading meta gets them automatically.
    meta.floors = _floorsForPagesSorted;
    meta.totals = _totalsForPages;

    // v5.4.35 — Compute the FINAL deck page total up-front so HTML chrome
    // pages bake the correct "Page X of Y" at render time. Pre-v5.4.35 each
    // plan emit passed a different pageTotal value (pageTotalEstimate + 2,
    // pageTotalEstimate + cctvPagesAdded + 2, etc.) → HTML chrome stamped
    // inconsistent totals (Page 4 of 15, Page 6 of 14, Page 7 of 16 in the
    // same deck). Native pages get restamped by _finalisePagination at the
    // end, but HTML chrome is baked into the image — restamping isn't
    // possible. Pre-counting solves it.
    // v5.198.0 — ONE builder for a schedule page's render/measure opts. Both
    // emit sites and the measured paginator use it, so what is measured is
    // exactly what is rendered. `pgPageNum` 0 = measurement (numbers don't
    // affect layout).
    const _schedPageOptsFor = (a, rows, fl, pgPageNum) => {
      const isFirst = !!(fl && fl.isFirst), isLast = !!(fl && fl.isLast);
      const _svcChrome = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
        ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
        : null;
      if (!a._schedParts) {
        a._schedParts = { headers: scheduleHeadersFor(a), totalRow: scheduleTotalRowFor(a), summary: scheduleSummaryFor(a) };
      }
      const P = a._schedParts;
      return {
        accentHex: (ASPECT_ACCENT[a.aspect] || COLOURS.accent || '#6b4a8a'),   // inline: _aspectAccentHex is declared later in this scope (TDZ)
        status: meta.status,
        sectionTitle: isFirst ? a.title : (a.title + '  (continued)'),
        reference: meta.ref || '',
        projectName: meta.name,
        client: meta.client,
        address: meta.address,
        revision: meta.revision,
        issueDate: meta.dateUk || meta.date,
        pageNum: pgPageNum,
        pageTotal: (typeof _planFinalTotal === 'number' ? _planFinalTotal : 0),
        serviceNotes: (isFirst && /^svc_(\d{2})$/.test(String(a.aspect || '')))
          ? _svcNotesFor(String(a.aspect).slice(4), 'schedule') : null,
        services: _svcChrome,
        appName: 'Takeoffs',
        revAdded:   meta.revAdded   || 0,
        revMoved:   meta.revMoved   || 0,
        revRemoved: meta.revRemoved || 0,
        revRfi:     meta.revRfi     || 0,
        revNote:    meta.revNote    || 0,
        headerBadge: (isFirst && a.headerBadge) ? a.headerBadge : null,
        summary: isFirst ? P.summary : { headline: null, chips: [] },
        table: Object.assign({ headers: P.headers, rows, total: isLast ? P.totalRow : null }, scheduleTableOptsFor(a))
      };
    };
    let _planFinalTotal = pageTotalEstimate;
    try {
      // v5.4.51 — info ref pages = REF_PAGES_COUNT (5 base + 1 conditional
      // 00.11). Computed later in the orchestrator so use the same _hasRevHistory.
      // +1 page for the Overall Counts scoreboard inserted right after Combined
      // Plans (v5.4.51 — Bryn directive 2026-05-08 "combined plans and overall
      // counts come after the info pages").
      // v5.170.0 — count ONLY the ticked info pages (shared list with the emit loop)
      // v5.185.0 — total info pages = FRONT + CABLING PACK + bend (position
      // moved, count unchanged — _planFinalTotal stays exact).
      const _refForCount = _incInfo
        ? (_infoCablingIdxFor(!!(meta && meta.revisionHistory && meta.revisionHistory.length)).length
           + _infoPackIdxList().length
           + (_secOn('infobend') ? 1 : 0))
        : 0;
      let total = 1 /* cover */ + _refForCount /* ref pages incl 00.10 */ + captured.length + (_incOverall ? 1 : 0) /* overall counts */;
      if (_secOn('contents')) total += 1;   // v5.87.0 — CONTENTS page 2 (painted at the end, reserved after the cover)
      // v5.70.0 — SPECIAL SERVICE PLANS counted from THE registry: one page
      // per (enabled plan × floor holding its devices). The emit loop reads
      // the SAME registry + predicates — count and emission cannot drift.
      try {
        const _all2 = (typeof collectTakeoffAllFloors === 'function') ? collectTakeoffAllFloors() : { symbols: [] };
        _specialPlanRegistry().forEach(p => {
          if (!_secOn(p.sec || p.key)) return;   // v5.87.0 — p.sec = shared ticklist key (externals/wifi ext)
          // v5.111.0 (Bryn: "these should always be visible if selected for
          // export, all floors and external even if no blocks placed") —
          // electrical emits for EVERY floor (+1 requirements spec page),
          // regardless of device presence. All other plans keep the
          // devices-present gate.
          if (p.key === 'electrical') {
            total += ((typeof floors !== 'undefined' && Array.isArray(floors)) ? floors.length : 0) + 1;
            total += _builderPagesCount();   // v5.253.0 — TRADES REQUIREMENTS — BUILDER sheet (niches / pattresses / pockets)
            return;
          }
          total += _specialPlanFloorSet(p, _all2.symbols).size;   // v5.71.0 — shared helper
        });
      } catch (_) {}
      // v5.42.0 — External Areas detection (1 page if any external room AND ticked)
      try {
        const _hasExt = _incExternal && canvas.getObjects().some(o =>
          o && o.sonorMeasure && o.sonorMeasure.kind === 'area' && o.sonorMeasure.external === true);
        if (_hasExt) total += 1;
      } catch (_) {}
      // (v5.70.0 — CCTV / Electrical / Lighting / LKP plan counts all come
      // from the registry block above.)
      // Per-service slice plans (services with ≥1 placement × N floors)
      try {
        const includeSlices = (typeof localStorage !== 'undefined')
          ? (localStorage.getItem('takeoffs-fullpdf-svcslices') !== '0') : true;
        if (includeSlices && typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)
            && typeof floors !== 'undefined' && Array.isArray(floors)) {
          const _present = {};
          let _allSyms = [];
          try {
            const _all = collectTakeoffAllFloors();
            _allSyms = _all.symbols || [];
            _allSyms.forEach(s => {
              if (!s || !s.service) return;
              const svc = SERVICES.find(x => x.key === s.service);
              if (svc) _present[svc.nn] = true;
            });
          } catch (_) {}
          // v5.71.0 — count per (service, floor-with-devices) via the shared
          // matrix — matches the emit loop's new skip rule exactly.
          const _matrix = _slicesFloorMatrix(_allSyms);
          // v5.159.0 (Bryn: "12 service is missing everywhere and any future
          // services should always be included") — FULL registry minus 11
          // (electrical has its dedicated block). Never slice(0, N).
          SERVICES.filter(s => s && s.nn !== '11').forEach(s2 => {
            if (!_sliceSvcOn(s2.nn)) return;   // v5.157.0 — per-service slice tick
            if (_present[s2.nn] && _matrix[s2.nn]) total += _matrix[s2.nn].size;
          });
        }
      } catch (_) {}
      // Section dividers (3 hardcoded — Rack Build, Schematics, Cinema Construction)
      if (_incDividers) total += _dividerCount();  // v5.18.0 — honour the dividers ticklist flag (v5.198.0: Cinema divider only when 01 blocks exist)
      if (_rearPageOn()) total += 1;   // v5.249.0 — rear contact page (§41) — counter twin of the emitter before pdf.save
      // v5.70.0 — Schedules counted EXACTLY: the paginator is deterministic
      // and cheap, so run it per aspect up-front (was 1-page-per-aspect —
      // every multi-page schedule broke "PAGE x OF y" from that point on).
      // v5.198.0 — MEASURED pages (real row heights; see scheduleMeasuredPages)
      // so the precount and the emit loop agree AND nothing is clipped.
      for (const a of filtered) {
        try {
          // v5.168.0 — per-service schedule tick: unticked services' schedule
          // pages don't count (matches the emit gate exactly).
          const _svcM = /^svc_(\d{2})$/.exec(String((a && a.aspect) || ''));
          if (_svcM && !_svcSchedOn(_svcM[1])) continue;
          const _pages = await scheduleMeasuredPages(a, (rows, fl) => _schedPageOptsFor(a, rows, fl, 0));
          total += Math.max(1, _pages.length);
        } catch (_) { total += 1; }
      }
      _planFinalTotal = total;
    } catch (_) { _planFinalTotal = pageTotalEstimate + 5; /* defensive bump */ }

    // v1.99.0 (SC-1) — Build svcCounts so the cover's service tally strip
    // (paintCoverSheet inline implementation, v1.78) shows project-wide
    // distribution for ALL 10 services (zeros included). Walks
    // collectTakeoffAllFloors so multi-floor projects roll up correctly.
    let svcCounts = null;
    try {
      svcCounts = {};
      if (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)) {
        SERVICES.forEach(s => { svcCounts[s.nn] = 0; });   // v5.159.0 — full registry (12/20/future + 11 included)
      }
      const all = (typeof collectTakeoffAllFloors === 'function') ? collectTakeoffAllFloors() : null;
      if (all && Array.isArray(all.symbols)) {
        all.symbols.forEach(s => {
          if (!s) return;
          const nn = String(s.nn || s.service_nn || '').padStart(2, '0');
          if (svcCounts[nn] != null) svcCounts[nn] += 1;
          else if (nn) svcCounts[nn] = 1;
        });
      }
    } catch (e) { svcCounts = null; }

    // Page 1 — COVER
    // v6 PHASE 1 (v5.4.28) — opt-in HTML/CSS cover via SonorPdfHtmlCover
    // (CSS grid + gradients + Gilroy + status pill + revision timeline,
    // rendered through hidden iframe + html2canvas → JPEG embed). Fall
    // back to native jsPDF paintCoverSheet when:
    //   - opt-in flag is OFF (default)
    //   - SonorPdfHtmlCover module not loaded
    //   - html2canvas not loaded
    //   - render throws
    // v5.4.28 — DEFAULT ON. User explicitly chose path A (HTML cover) for
    // the v6 architecture migration. Opt OUT for safety / debugging via:
    //   localStorage.setItem('takeoffs-pdf-html-cover', '0')
    //   OR window.__SONOR_PDF_HTML_COVER__ = false
    let htmlCoverUsed = false;
    // v2.8.0 — the house ART cover (Service Contracts front page) unless the project has a cover photo, which keeps the photo cover.
    let _fdBackdrop = null; try { _fdBackdrop = await _coverBackdrop(); } catch (_) { _fdBackdrop = null; }
    if (!_fdBackdrop) {
      try {
        if (typeof setStatus === 'function') setStatus('Painting the cover …');
        if (await _paintArtCoverJsPdf(pdf, _artCoverOpts(meta, title))) { htmlCoverUsed = true; _noopCoverStamp(pdf, 'art-cover-full'); }
      } catch (e) { console.warn('[fullDocument] art cover failed — HTML cover instead:', e); }
    }
    const htmlCoverDisabled =
      (typeof window !== 'undefined') && (
        window.__SONOR_PDF_HTML_COVER__ === false ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-cover') === '0')
      );
    const htmlCoverEnabled = !htmlCoverDisabled;
    // v5.4.44 — diagnostic logging for cover-path selection. Pre-v5.4.44
    // when HTML cover failed to fire, we silently fell back to native
    // paintCoverSheet. The user couldn't tell whether available() was
    // returning false (CDN/module not loaded) or renderCover was throwing
    // (CSS / template / html2canvas error). These logs make the path
    // selection visible without DevTools spelunking.
    try {
      const _diagAvail = (typeof window !== 'undefined' && window.SonorPdfHtmlCover
        && typeof window.SonorPdfHtmlCover.available === 'function')
        ? window.SonorPdfHtmlCover.available() : null;
      console.log('[SonorPdf-COVER] enabled=' + htmlCoverEnabled +
        ' SonorPdfHtmlCover=' + (typeof window !== 'undefined' && !!window.SonorPdfHtmlCover) +
        ' available=' + _diagAvail +
        ' html2canvas=' + (typeof html2canvas) +
        ' helpers=' + (typeof window !== 'undefined' && !!window.SonorPdfHtmlHelpers) +
        ' components=' + (typeof window !== 'undefined' && !!window.SonorPdfHtmlComponents) +
        ' templates=' + (typeof window !== 'undefined' && !!window.SonorPdfHtmlTemplates));
    } catch (_) {}
    if (!htmlCoverUsed && htmlCoverEnabled &&
        typeof window !== 'undefined' &&
        window.SonorPdfHtmlCover &&
        window.SonorPdfHtmlCover.available()) {
      try {
        if (typeof setStatus === 'function') setStatus('Rendering luxury cover (HTML/CSS) …');
        // Compose floors[] from opts.floorRows. v5.4.30 fix: the host
        // (sonor-takeoffs.html line ~7971) builds floorRows with keys
        // `name / rooms / area (string) / perimeter (string) / cable
        // (string) / led (string) / symbols`. The v5.4.28 mapping looked
        // for `areaM2 / area_m2 / perimeterM / perimeter_m / syms` —
        // none matched, so Floors panel showed "—" for area/perimeter.
        // Now parses the formatted strings back to numbers OR reads
        // numeric variants directly.
        const _toNum = v => {
          if (v == null) return null;
          if (typeof v === 'number') return Number.isFinite(v) ? v : null;
          const n = parseFloat(String(v));
          return Number.isFinite(n) ? n : null;
        };
        // v5.4.42 — bake-in canonical floor sequence (Bryn 2026-05-08).
        // Sort floorsForHtml into GF → 1F → 2F → BA → EXT before renderCover
        // sees it. The mapping happens FIRST (so the resulting objects carry
        // .name + .code in the shape sortFloors expects), then the sort.
        const _sortFloorsHtml = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
          ? window.sonorSortFloors
          : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
              && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
             ? window.SonorPdfHtmlHelpers.sortFloors
             : null);
        const _floorsHtmlMapped = (Array.isArray(opts.floorRows) ? opts.floorRows : []).map(r => ({
          name: r.name || r.code || '—',
          code: r.code,
          rooms: r.rooms,
          symbols: r.syms != null ? r.syms : r.symbols,
          areaM2: _toNum(r.areaM2 != null ? r.areaM2 : (r.area_m2 != null ? r.area_m2 : r.area)),
          perimeterM: _toNum(r.perimeterM != null ? r.perimeterM : (r.perimeter_m != null ? r.perimeter_m : r.perimeter))
        }));
        const floorsForHtml = _sortFloorsHtml ? _sortFloorsHtml(_floorsHtmlMapped) : _floorsHtmlMapped;
        // Compose totals from grand totals if available — re-walk via a
        // best-effort fallback to the summary array provided by caller.
        let totalsForHtml = null;
        try {
          if (typeof computeProjectTotals === 'function') {
            const t = computeProjectTotals();
            if (t && t.grand) {
              totalsForHtml = {
                floors: t.grand.floors, rooms: t.grand.rooms,
                blocks: (t.grand.symbols || 0) + (t.grand.shades || 0),   // v5.145.0 — drawn shades count as blocks (Bryn)
                areaM2: t.grand.areaM2, perimeterM: t.grand.perimeterM,
                cableM: t.grand.cableM, ledM: t.grand.ledM,
                shades: t.grand.shades
              };
            }
          }
        } catch (_) {}
        const services = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
          ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
          : null;
        const result = await window.SonorPdfHtmlCover.renderCover({
          title: title,
          subtitle: 'PROJECT TAKE-OFF',
          projectName: meta.name,
          client: meta.client,
          address: meta.address,
          reference: meta.ref || '—',
          status: meta.status,
          issueDate: meta.dateUk || meta.date,
          revision: meta.revision,
          revisionHistory: meta.revisionHistory || [],
          // v5.144.0 (Bryn export: cover pills read +0 ~0 -0 ?0 while the
          // title block said ?4) — the cover callsites never forwarded the
          // cloud counts, so revPillsPanel fell back to an all-zero object.
          revCounts: meta.revCounts || null,
          revAdded: meta.revAdded || 0,
          revMoved: (meta.revMoved != null ? meta.revMoved : meta.revChanged) || 0,
          revRemoved: meta.revRemoved || 0,
          revRfi: meta.revRfi || 0,
          revNote: meta.revNote || 0,
          appName: 'Takeoffs',
          appVersion: meta.appVersion,
          accentHex: '#ad9978',   // v5.138.0/v5.143.0 — SONOR GOLD (re-applied to root master)
          backdropImg: (await _coverBackdrop()) || null,   // v5.249.0 — project cover photo (takeoffs-push link metadata.cover_photo) fades to black on the luxury hero (§41)
          services,
          floors: floorsForHtml,
          totals: totalsForHtml,
          // v5.25.0 — project-wide BLOCK LEGEND on the cover summary (Bryn
          // 2026-06-14 "more summary info, like legend for the total blocks").
          // Aggregates each captured floor's legend into one merged legend
          // (qty summed across floors). Renders on the cover RHS above a
          // compact PROJECT TOTALS strip. Null/empty → cover falls back to
          // the FLOORS + PROJECT TOTALS summary card (v5.18.0).
          coverLegend: (function () {
            try { return _aggregateMergedLegendFromCapture(captured); } catch (_) { return null; }
          })()
        });
        if (result && result.dataUrl) {
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          // The HTML template was rendered at 1190 x 842 (A3 landscape pt).
          pdf.addImage(result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'cover-html');
          htmlCoverUsed = true;
          try { window.__SONOR_LAST_COVER_PATH__ = 'html'; } catch (_) {}
          console.log('[SonorPdf-COVER] HTML cover rendered OK ✓ (dataUrl bytes=' +
            (result.dataUrl ? result.dataUrl.length : 0) + ')');
          // v5.4.30 — Register a NO-OP stamp on the cover page so
          // _finalisePagination Pass 2 doesn't fire the legacy fallback
          // that paints "Page X of Y · Sonor Takeoffs vX.X.X" over the
          // top-right of our HTML cover image. Pass 2 only fires for
          // pages with NO registered stamps; an opaque-suppress stamp
          // here keeps the cover image untouched.
          try {
            pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
            pdf.__sonorPageStamps__.push({
              page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                      ? pdf.internal.getCurrentPageInfo().pageNumber
                      : pdf.internal.pages.length - 1),
              x: 0, y: 0,
              clearW: 0, clearH: 0, clearOffsetY: 0,
              format: 'noop',
              source: 'html-cover-suppress'
            });
          } catch (_) { /* non-fatal */ }
        }
      } catch (e) {
        console.warn('[fullDocument v6] HTML cover failed, falling back to native paintCoverSheet:', e);
        // v5.4.44 — surface the underlying error message + name (not just
        // the toString) so the user can paste back the cause cleanly.
        try {
          console.warn('[SonorPdf-COVER] error.name=' + (e && e.name) +
            ' message=' + (e && e.message) +
            ' lastErr=' + (window.__SONOR_HTMLCOVER_LAST_ERROR__ &&
                          (window.__SONOR_HTMLCOVER_LAST_ERROR__.message || String(window.__SONOR_HTMLCOVER_LAST_ERROR__))));
        } catch (_) {}
        try { window.__SONOR_LAST_COVER_PATH__ = 'jspdf-fallback'; } catch (_) {}
      }
    } else if (htmlCoverEnabled && !htmlCoverUsed) {
      console.warn('[SonorPdf-COVER] HTML cover SKIPPED — module gate failed. ' +
        'Check the [SonorPdf-COVER] line above for which dep is missing.');
    }
    if (!htmlCoverUsed) {
      paintCoverSheet(pdf, {
        title, meta,
        floorRows: opts.floorRows,
        summary: opts.summary,
        summaryTitle: opts.summaryTitle,
        svcCounts,
        pageTotal: pageTotalEstimate
      });
    }

    // v5.87.0 — CONTENTS page reserved as PAGE 2 (Bryn: "create a contents
    // page 2"). Painted at the very end — after the outline entries are
    // built — so every page number on it is exact. The noop stamp stops
    // _finalisePagination scribbling chrome over the reserved blank.
    let contentsPagesAdded = 0;
    if (_secOn('contents')) {
      pdf.addPage();
      contentsPagesAdded = 1;
      try {
        pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
        pdf.__sonorPageStamps__.push({
          page: 2, x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
          format: 'noop', source: 'contents-reserved'
        });
      } catch (_) {}
    }

    // v5.4.35 — Pages 2+3 (cabling info + bend radius) now also go through
    // the HTML pipeline for full chrome consistency. Native fallback if
    // HTML render fails. Pre-flight check uses _planFinalTotal so chrome
    // bakes the correct "Page X of Y".
    const _htmlInfoEnabled = (typeof window !== 'undefined') &&
      window.SonorPdfHtmlCover &&
      typeof window.SonorPdfHtmlCover.renderCablingInfo === 'function' &&
      window.SonorPdfHtmlCover.available();
    const _servicesForChrome = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
      : null;

    // v5.4.45 — Information & Standards now spans 4 pages with 00.X section
    // numbering (Taxonomy first as 00.1 full-width hero, then 00.2-00.9
    // distributed across 3 more pages, plus 00.10 Bend Radius as page 5
    // emitted below). Bryn directive 2026-05-08: "give everything its own
    // row under the info pages sections, 00.x ... make service taxonomy the
    // first one 00.1 in this full page width way ... make info pages roll
    // on for as long as is needed not just crammed to one or two page max."
    // v5.4.48 — sections stack as full-width rows; paired sections share
    // a page. 5 cabling info pages (or 6 with revision history) + 1 bend
    // radius = 6 (or 7) info pages total.
    // v5.4.49 — declare _hasRevHistory HERE (before TOTAL_INFO_PAGES uses
    // it). Pre-v5.4.49 the variable was declared 500+ lines later, causing
    // a temporal-dead-zone ReferenceError that hung the PDF export. The
    // catch in _emitCablingPage swallowed it and the loop spun. Same
    // declaration is duplicated inline below in REF_PAGES_COUNT block —
    // both should resolve to the same value (idempotent const decl is
    // not allowed twice in the same scope, but they're in different
    // block scopes — the outer `async function fullDocument` wraps both).
    const _hasRevHistory = !!(meta && meta.revisionHistory && meta.revisionHistory.length);
    const TOTAL_INFO_PAGES = _hasRevHistory ? 7 : 6;
    let _refPagesAdded = 0;
    const _emitCablingPage = async (pageIndex, pageNumOverride, pageOrdinal, enabledTotal) => {
      pdf.addPage();
      _refPagesAdded++;
      let _ok = false;
      if (_htmlInfoEnabled) {
        try {
          if (typeof setStatus === 'function') setStatus(`Rendering information & standards ${(typeof pageOrdinal === 'number' ? pageOrdinal : pageIndex) + 1}/${enabledTotal || TOTAL_INFO_PAGES} (HTML/CSS) …`);
          const _result = await window.SonorPdfHtmlCover.renderCablingInfo({
            accentHex: '#475161',
            status: meta.status,
            // sectionTitle is now derived per-page inside the template
            // (TAXONOMY / CONVENTIONS & KEY / INSTALL & ANNOTATIONS /
            // REVISIONS & TAILS) — pass null so the template's per-page
            // header label takes precedence.
            sectionTitle: null,
            appName: 'TAKEOFFS',
            reference: meta.ref || '',
            projectName: meta.name,
            client: meta.client,
            address: meta.address,
            revision: meta.revision,
            issueDate: meta.dateUk || meta.date,
            pageNum: pageNumOverride,
            pageTotal: _planFinalTotal,
            pageIndex,
            pageOrdinal: (typeof pageOrdinal === 'number') ? pageOrdinal : pageIndex,   // v5.170.0 — '(x of y)' with skips
            frontSections: _frontSectionsOn(),   // v5.253.0 — which sections the merged front page carries
            // v5.152.0 (Bryn: "give the pdf page the same footer as all
            // others") — the REVISION HISTORY page (pageIndex 0) takes the
            // slim strip; the once-per-doc full title block latches onto
            // the next info page instead.
            footerSlim: pageIndex === 0 || pageIndex >= 100,
            totalInfoPages: enabledTotal || TOTAL_INFO_PAGES,   // v5.170.0 — enabled count
            services: _servicesForChrome,
            // v5.4.60 — floors + totals + revision-cloud counts piped to
            // page 2 (00.1) so the project-at-a-glance panels can render
            // alongside the taxonomy strip. Cover stays light.
            floors: meta.floors || null,
            totals: meta.totals || null,
            revAdded:   meta.revAdded   || 0,
            revMoved:   meta.revMoved   || 0,
            revRemoved: meta.revRemoved || 0,
            revRfi:     meta.revRfi     || 0,
            revNote:    meta.revNote    || 0,
            revisionGeneralComments: meta.revisionGeneralComments || '',   // v5.102.0
            revisionHistory: (meta.revisionHistory || []).map(r => ({
              code: r.code || '', date: r.date || '',
              version: r.version || '', notes: r.notes || '',
              label: r.label || '',
              id: r.id || null,
              // Per-revision cloud counts (preserved when present in cache)
              added: r.added, moved: r.moved, removed: r.removed, rfi: r.rfi
            })),
            // v5.4.70 — Revision-cloud notes grouped by revisionId +
            // status. Walks every cloud on the canvas, buckets by
            // revisionId → { added: [text], moved: [text], removed:
            // [text] }. Clouds with no revisionId roll into a
            // sentinel '__current' bucket so the in-progress (A0)
            // row can still surface them. Bryn directive 2026-05-10:
            // "the text from revision clouds should also display
            // here in pdf. added > numbered bullet list. moved >
            // bullet list etc."
            // v5.148.0 (Bryn: "notes should have a tickbox for making visible
            // on export... displayed at the top of the revisions page") —
            // notes flagged 'export' in 📋 Notes render above the revision
            // history panel.
            exportNotes: (pageIndex === 0 || pageIndex >= 100) ? ((_pdfNoteChunks()[pageIndex >= 100 ? pageIndex - 100 : 0]) || []) : [],
            notesMore: (pageIndex === 0 || pageIndex >= 100) ? ((pageIndex >= 100 ? pageIndex - 100 : 0) + 1 < _pdfNoteChunks().length) : false,
            revisionCloudsByRev: (function () {
              const map = {};
              try {
                if (typeof canvas !== 'undefined' && canvas && typeof canvas.getObjects === 'function') {
                  // v5.131.0/v5.143.0 (RE-APPLIED TO THE ROOT MASTER — the
                  // original landed in data/ and was clobbered by sync):
                  // items are { note, room, blocks:[{svg, code}] }.
                  canvas.getObjects().forEach(o => {
                    if (!o || !o.sonorRevCloud || o.__sonorRevCloudIsChip) return;
                    const m = o.sonorRevCloud;
                    const key = m.revisionId || '__current';
                    if (!map[key]) map[key] = { added: [], moved: [], removed: [], rfi: [], note: [] };
                    const status = String(m.status || '').toLowerCase();
                    const note = String(m.note || '').trim();
                    let room = '', blocks = [];
                    try {
                      const rect = m.rect;
                      if (rect && Number.isFinite(rect.x) && rect.w > 0 && rect.h > 0) {
                        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
                        if (typeof pointInPolygon === 'function') {
                          // v5.148.0 (Bryn: "RFI 005 doesnt show as being in the
                          // external 'room'") — centre-only hit-testing missed
                          // rooms the cloud OVERLAPS without containing its
                          // centre; try the centre then each rect corner.
                          const _hitPts = [{ x: cx, y: cy },
                            { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
                            { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }];
                          const roomObj = canvas.getObjects().find(r =>
                            r && r.sonorMeasure && r.sonorMeasure.kind === 'area'
                            && Array.isArray(r.sonorMeasure.points)
                            && _hitPts.some(pt => pointInPolygon(pt, r.sonorMeasure.points)));
                          if (roomObj) room = String(roomObj.sonorMeasure.name || '');
                          // v5.149.0 (Bryn: "RFI 005 gate intercom doesnt show
                          // external even though the cloud is outside building
                          // outline") — no room + centre outside the outline
                          // ⇒ label 'External'.
                          if (!room) {
                            try {
                              const _olObj = canvas.getObjects().find(oo => oo && oo.sonorBuildingOutline);
                              const _olPts = (_olObj && _olObj.sonorBuildingOutline && Array.isArray(_olObj.sonorBuildingOutline.points))
                                ? _olObj.sonorBuildingOutline.points : null;
                              if (_olPts && _olPts.length > 2 && !pointInPolygon({ x: cx, y: cy }, _olPts)) room = 'EXT';   // v5.150.0 — short form (Bryn: GF, 1F, EXT)
                            } catch (_) {}
                          }
                        }
                        canvas.getObjects().forEach(sObj => {
                          if (!sObj || !sObj.sonorSymbol) return;
                          const cp = sObj.getCenterPoint ? sObj.getCenterPoint() : { x: sObj.left || 0, y: sObj.top || 0 };
                          if (cp.x < rect.x || cp.x > rect.x + rect.w || cp.y < rect.y || cp.y > rect.y + rect.h) return;
                          const sym = sObj.sonorSymbol;
                          let svg = '';
                          try {
                            const libRow = (typeof LIBRARY !== 'undefined' && Array.isArray(LIBRARY))
                              ? LIBRARY.find(r => r && r.block_code === sym.block_code) : null;
                            if (libRow && window.SonorBlockSymbol && typeof window.SonorBlockSymbol.fromLibraryRow === 'function') {
                              svg = window.SonorBlockSymbol.fromLibraryRow(libRow, { size: 11 });
                            }
                          } catch (_) {}
                          blocks.push({ svg, code: sym.labelText || (sym.autoId && sym.autoId.id) || sym.block_code || '' });
                        });
                      }
                    } catch (_) {}
                    const item = { id: String(m.id || ''), note, room, blocks };   // v5.148.0 — full id itemisation
                    if (status === 'added' || status === 'add') map[key].added.push(item);
                    else if (status === 'moved' || status === 'changed' || status === 'mov') map[key].moved.push(item);
                    else if (status === 'removed' || status === 'rem' || status === 'deleted') map[key].removed.push(item);
                    else if (status === 'rfi' || status === 'query') map[key].rfi.push(item);
                    else if (status === 'note' || status === 'info') map[key].note.push(item);   // v5.165.0 — charcoal note clouds   // purple RFI
                  });
                }
              } catch (_) { /* canvas walk shouldn't ever throw, but defensively swallow */ }
              // v5.144.0 (Bryn: "rev history does not show all rfi's and
              // other clouds") — the walk above only sees the ACTIVE
              // floor's live canvas; whichever floor happened to be active
              // at export time was the only one listed (Heybridge: 1 of 4
              // RFIs). Fold in every OTHER floor's saved revisionClouds[],
              // enriching room/blocks from the saved areas/symbols buckets.
              try {
                const _afId = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
                if (typeof floors !== 'undefined' && Array.isArray(floors)) {
                  floors.forEach(fl => {
                    if (!fl || fl.id === _afId) return;
                    (fl.revisionClouds || []).forEach(cRec => {
                      const m = (cRec && cRec.sonorRevCloud) || null;
                      if (!m) return;
                      const key = m.revisionId || '__current';
                      if (!map[key]) map[key] = { added: [], moved: [], removed: [], rfi: [], note: [] };
                      const status = String(m.status || '').toLowerCase();
                      const note = String(m.note || '').trim();
                      const rect = (m.rect && Number.isFinite(m.rect.x) && m.rect.w > 0)
                        ? m.rect : { x: cRec.x, y: cRec.y, w: cRec.w, h: cRec.h };
                      let room = '', blocks = [];
                      try {
                        if (rect && Number.isFinite(rect.x) && rect.w > 0 && rect.h > 0) {
                          const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
                          if (typeof pointInPolygon === 'function') {
                            // v5.148.0 — centre + rect-corner fallback (see canvas walk)
                            const _hitPts = [{ x: cx, y: cy },
                              { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
                              { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }];
                            const rm = (fl.areas || []).find(a => a && Array.isArray(a.points)
                              && _hitPts.some(pt => pointInPolygon(pt, a.points)));
                            if (rm) room = String(rm.name || '');
                            // v5.149.0 — outside the floor's outline ⇒ 'External'
                            if (!room && Array.isArray(fl.buildingOutline) && fl.buildingOutline[0]
                                && Array.isArray(fl.buildingOutline[0].points) && fl.buildingOutline[0].points.length > 2
                                && !pointInPolygon({ x: cx, y: cy }, fl.buildingOutline[0].points)) {
                              room = 'EXT';   // v5.150.0 — short form (Bryn: GF, 1F, EXT)
                            }
                          }
                          (fl.symbols || []).forEach(sRec => {
                            if (!sRec || !sRec.sonorSymbol) return;
                            const sx = sRec.x, sy = sRec.y;
                            if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
                            if (sx < rect.x || sx > rect.x + rect.w || sy < rect.y || sy > rect.y + rect.h) return;
                            const sym = sRec.sonorSymbol;
                            let svg = '';
                            try {
                              const libRow = (typeof LIBRARY !== 'undefined' && Array.isArray(LIBRARY))
                                ? LIBRARY.find(r => r && r.block_code === sym.block_code) : null;
                              if (libRow && window.SonorBlockSymbol && typeof window.SonorBlockSymbol.fromLibraryRow === 'function') {
                                svg = window.SonorBlockSymbol.fromLibraryRow(libRow, { size: 11 });
                              }
                            } catch (_) {}
                            blocks.push({ svg, code: sym.labelText || (sym.autoId && sym.autoId.id) || sym.block_code || '' });
                          });
                        }
                      } catch (_) {}
                      const item = { id: String(m.id || ''), note, room, blocks };   // v5.148.0 — full id itemisation
                      if (status === 'added' || status === 'add') map[key].added.push(item);
                      else if (status === 'moved' || status === 'changed' || status === 'mov') map[key].moved.push(item);
                      else if (status === 'removed' || status === 'rem' || status === 'deleted') map[key].removed.push(item);
                      else if (status === 'rfi' || status === 'query') map[key].rfi.push(item);
                    else if (status === 'note' || status === 'info') map[key].note.push(item);   // v5.165.0 — charcoal note clouds
                    });
                  });
                }
              } catch (_) {}
              // v5.154.0 (Bryn: "need an option to mark a note as an RFI,
              // so it ends up in the list and count with an ID") — note-RFIs
              // from the Notes hub join the current revision's RFI bucket.
              try {
                if (typeof window !== 'undefined' && typeof window._planNotesRfis === 'function') {
                  const _nr = window._planNotesRfis();
                  if (Array.isArray(_nr) && _nr.length) {
                    if (!map.__current) map.__current = { added: [], moved: [], removed: [], rfi: [], note: [] };
                    _nr.forEach(r => map.__current.rfi.push({
                      id: String(r.id || ''), note: String(r.note || ''),
                      room: r.floor ? String(r.floor) : '', blocks: []
                    }));
                  }
                }
              } catch (_) {}
              // v5.149.0 (Bryn: "RFI's not in number order") — floor
              // iteration order leaked through (RFI-005 listed before 004).
              // Sort every bucket by the numeric id suffix.
              try {
                const _idN = (it) => {
                  const m = /-(\d+)$/.exec(String((it && it.id) || ''));
                  return m ? parseInt(m[1], 10) : 1e9;
                };
                Object.keys(map).forEach(k => ['added', 'moved', 'removed', 'rfi', 'note'].forEach(g => {
                  if (Array.isArray(map[k][g])) map[k][g].sort((a, b) => _idN(a) - _idN(b));
                }));
              } catch (_) {}
              return map;
            })()
          });
          if (_result && _result.dataUrl) {
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            pdf.addImage(_result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'cabling-html-' + pageIndex);
            _ok = true;
            try {
              pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
              pdf.__sonorPageStamps__.push({
                page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                        ? pdf.internal.getCurrentPageInfo().pageNumber
                        : pdf.internal.pages.length - 1),
                x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
                format: 'noop', source: 'html-cabling-suppress-' + pageIndex
              });
            } catch (_) {}
          }
        } catch (e) {
          console.warn('[fullDocument v5.4.45] HTML info page ' + (pageIndex + 1) + ' failed — fallback:', e);
        }
      }
      if (!_ok) {
        try { _paintCablingInfoPage(pdf, meta, pageNumOverride, _planFinalTotal); }
        catch (e) { console.warn('[fullDocument] cabling fallback failed:', e); }
      }
    };

    // Pages 2..N — INFORMATION & STANDARDS (one section per page).
    // v5.4.47 — was 4 pages (Taxonomy hero + 3 grouped pages); now 9 (or
    // 10 with revision history) so each 00.X gets its own dedicated page.
    // Bend Radius (00.10) emits separately below as the last info page.
    // v5.18.0 — whole Information & Standards block gated by the section
    // ticklist. When unticked, _refForCount/REF_PAGES_COUNT resolve to 0 so
    // the page-total math stays exact (cover + plans + remaining sections).
    // v5.185.0 — FRONT info pages only (the CABLING STANDARDS pack + bend
    // radius emit immediately before the Cable Schedule — see
    // _emitCablingStandardsPack below). Ordinals span the whole info
    // family so "(x of y)" stays continuous across the split.
    const _infoIdxList = _incInfo ? _infoCablingIdxFor(_hasRevHistory) : [];
    const _packIdxListResolved = _incInfo ? _infoPackIdxList() : [];
    const _infoEnabledTotal = _infoIdxList.length + _packIdxListResolved.length + (_secOn('infobend') ? 1 : 0);
    if (_incInfo) {
    for (let _p = 0; _p < _infoIdxList.length; _p++) {
      await _emitCablingPage(_infoIdxList[_p], 2 + contentsPagesAdded + _p, _p, _infoIdxList.length);   // v5.253.0 — front family numbered on its own
    }

    }  // v5.18.0 — end _incInfo (FRONT info block)

    // BEND RADIUS (00.9) — its own page, full-canvas SVG.
    // v5.185.0 — REFACTORED into a callable + RELOCATED: emits with the
    // CABLING STANDARDS pack immediately before the Cable Schedule (was
    // the last front info page). pageNum now passed by the caller.
    async function _emitBendRadiusPageAt(_bendPageNum) {
    pdf.addPage();
    let bendHtmlOk = false;
    if (_htmlInfoEnabled) {
      try {
        if (typeof setStatus === 'function') setStatus('Rendering 00.10 bend radius reference (HTML/CSS) …');
        const _result = await window.SonorPdfHtmlCover.renderBendRadius({
          accentHex: '#e37c59',
          status: meta.status,
          sectionTitle: 'CABLING STANDARDS — BEND RADIUS REFERENCE',
          totalInfoPages: _packIdxListResolved.length + 1,   // v5.253.0 — pack family
          appName: 'TAKEOFFS',
          reference: meta.ref || '',
          projectName: meta.name,
          client: meta.client,
          address: meta.address,
          revision: meta.revision,
          issueDate: meta.dateUk || meta.date,
          pageNum: _bendPageNum,
          pageTotal: _planFinalTotal,
          services: _servicesForChrome
        });
        if (_result && _result.dataUrl) {
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          pdf.addImage(_result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'bend-html');
          bendHtmlOk = true;
          try {
            pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
            pdf.__sonorPageStamps__.push({
              page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                      ? pdf.internal.getCurrentPageInfo().pageNumber
                      : pdf.internal.pages.length - 1),
              x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
              format: 'noop', source: 'html-bend-suppress'
            });
          } catch (_) {}
        }
      } catch (e) {
        console.warn('[fullDocument v5.4.36] HTML bend page failed — falling back to native:', e);
      }
    }
    if (!bendHtmlOk) {
      // v5.4.45 — bend radius is now page 6, not 4 (info pages expanded
      // from 3 to 5).
      try { _paintBendRadiusPage(pdf, meta, _bendPageNum, _planFinalTotal); }
      catch (e) { console.warn('[fullDocument v2.0.0] bend radius page failed:', e); }
    }
    }  // v5.185.0 — end _emitBendRadiusPageAt

    // v5.185.0 — CABLING STANDARDS pack (00.5-00.8 pages + 00.9 bend
    // radius): emits ONCE, immediately before the first cables-family
    // schedule aspect (after the v5.111.0 electrical block). Returns pages
    // added; records real start pages for the outline/contents.
    let _cablePackDone = false;
    let _cablePackPageStart = null;
    let _bendPageReal = null;
    async function _emitCablingStandardsPack(currentPageNumIn) {
      if (_cablePackDone || !_incInfo) return 0;
      _cablePackDone = true;
      let added = 0;
      try {
        const _packTotal = _packIdxListResolved.length + (_secOn('infobend') ? 1 : 0);   // v5.253.0 — pack family numbered on its own
        for (let _q = 0; _q < _packIdxListResolved.length; _q++) {
          if (added === 0) _cablePackPageStart = currentPageNumIn + 1;
          await _emitCablingPage(_packIdxListResolved[_q], currentPageNumIn + added + 1,
            _q, _packTotal);
          added++;
        }
        if (_secOn('infobend')) {
          _bendPageReal = currentPageNumIn + added + 1;
          if (_cablePackPageStart === null) _cablePackPageStart = _bendPageReal;
          await _emitBendRadiusPageAt(_bendPageReal);
          added++;
        }
      } catch (e) { console.warn('[v5.185.0] cabling standards pack emit failed:', e); }
      return added;
    }

    // Pages 4..(3+N) — one PLAN canvas page per floor (shifted +2 by ref pages)
    // v5.4.34 — try HTML chrome path first; fall back to native jsPDF on failure.
    // Captured.forEach was sync; converted to for-of so we can await renderPlanPage.
    const htmlPlanDisabled = (typeof window !== 'undefined') && (
      window.__SONOR_PDF_HTML_PLAN__ === false ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-plan') === '0')
    );
    const htmlPlanEnabled = !htmlPlanDisabled
      && (typeof window !== 'undefined')
      && window.SonorPdfHtmlCover
      && typeof window.SonorPdfHtmlCover.renderPlanPage === 'function'
      && window.SonorPdfHtmlCover.available();

    for (let i = 0; i < captured.length; i++) {
      const c = captured[i];
      pdf.addPage();
      // v5.4.55b — fix Combined Plans pageNum stamp. Pre-fix: hardcoded
      // `5 + i` (v5.4.36 era when REF_PAGES_COUNT = 3 [cabling-1 +
      // cabling-2 + bend] so plans started at page 5). After v5.4.45
      // info pages expanded to 5 (or 6 with revs) + bend, and v5.4.51
      // added Overall Counts after Combined Plans, the hardcoded offset
      // became wrong. Both Ground + First Floor stamped "Page 5 of N"
      // even though they were pages 8 and 9 of the file — created the
      // impression of a duplicate-floor bug.
      // Fix: use the live PDF page index (pdf has just had addPage()
      // called above, so getCurrentPageInfo().pageNumber returns the
      // correct deck position). Falls back to a computed offset
      // (1 cover + REF_PAGES_COUNT info pages + i) when getCurrentPageInfo
      // isn't available.
      const _livePageNum = (typeof pdf.internal.getCurrentPageInfo === 'function')
        ? pdf.internal.getCurrentPageInfo().pageNumber
        : (1 + (_hasRevHistory ? 7 : 6) + i);
      const planOpts = {
        title: 'COMBINED PLANS',
        subtitle: c.floor && c.floor.name ? ('Floor ' + (i + 1) + ' of ' + captured.length + ' — ' + c.floor.name) : null,
        floorName: c.floor && c.floor.name,
        legend: c.legend,
        summary: c.summary,
        summaryTitle: opts.perFloorSummaryTitle || 'Floor totals',
        dataUrl: c.snap.dataUrl,
        canvasW: c.snap.w,
        canvasH: c.snap.h,
        pageNum: _livePageNum,
        pageTotal: _planFinalTotal,
        pageCode: 'COM-' + String(i + 1).padStart(2, '0'),
        useTitleBlock: true,
        withNotesColumn: true,
        showNotes: false,
        showDrawingKey: false,  // v5.4.35 — drawing key is on info pages, not plans
        floorIndex: i,           // v5.4.35 — drives totals lookup in HTML wrapper
        // v5.22.2 — floor name in the header after "COMBINED PLANS" + drop
        // the FLOOR TOTALS sidebar panel (Bryn 2026-06-14).
        headerSubtitle: c.floor && c.floor.name,
        hideTotals: true,
        aspect: 'plan'
      };
      const baseMeta = Object.assign({}, meta, { floor: c.floor && c.floor.name });
      let usedHtml = false;
      if (htmlPlanEnabled) {
        if (typeof setStatus === 'function') setStatus('Rendering ' + (c.floor && c.floor.name || 'Floor ' + (i + 1)) + ' (HTML/CSS) …');
        usedHtml = await _emitPlanPageIntoPdfHtml(pdf, planOpts, baseMeta);
      }
      if (!usedHtml) {
        _emitPlanPageIntoPdf(pdf, planOpts, baseMeta);
      }
    }

    // v5.4.51 — OVERALL COUNTS scoreboard page. Single overview of every
    // service's totals, emitted right after Combined Plans so the engineer
    // / sub-contractor sees "what's in this project?" before drilling into
    // per-service slice plans + schedules. Bryn directive 2026-05-08:
    // "combined plans and overall counts come after the info pages, then
    // per service by category". Pure HTML render — no native fallback
    // because it's a brand-new surface and the catch logs to the console
    // diagnostics for debugging if the HTML pipeline fails. Fallback case:
    // the page is added but blank (engineer can ignore it on first run).
    let overallCountsAdded = 0;
    if (_incOverall && (typeof window !== 'undefined') && window.SonorPdfHtmlCover &&
        typeof window.SonorPdfHtmlCover.renderOverallCounts === 'function') {
      try {
        if (typeof setStatus === 'function') setStatus('Rendering overall counts (HTML/CSS) …');
        // Build per-service rollup from computeProjectTotals — grand.byService
        // already has { name, colour, symbols } per NN. Augment with cable /
        // led metres if grand.perCable / perLed have per-service breakdowns
        // (v1.16.0+ feature). For v5.4.51 just symbols + grand totals.
        const totalsForCounts = (typeof computeProjectTotals === 'function')
          ? computeProjectTotals() : null;
        const grandForCounts = (totalsForCounts && totalsForCounts.grand) || {};
        // Compose service rows — every canonical service NN even when zero,
        // so the scoreboard shows the full taxonomy.
        const SERVICES_LIST = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
          ? SERVICES.slice() : [];   // v5.159.0 — full registry so 12/20/future rows show (zero or not)
        const servicesData = SERVICES_LIST.map(s => {
          const byNn = (grandForCounts.byService && grandForCounts.byService[s.nn]) || {};
          // v5.4.54 — per-service Cable + LED metres now flow through.
          // Template renders the wide row layout (Blocks | Cable | LED)
          // when ANY service has cableM or ledM > 0, otherwise the narrow
          // (Blocks-only) layout. cableM/ledM are populated in
          // computeProjectTotals via CABLE_CODE_TO_SVC_NN mapping +
          // LED-runs-credit-to-04 rule.
          const cab = (typeof byNn.cableM === 'number' && byNn.cableM > 0) ? byNn.cableM : null;
          const led = (typeof byNn.ledM   === 'number' && byNn.ledM   > 0) ? byNn.ledM   : null;
          return {
            nn: s.nn,
            key: s.key,
            name: s.name,
            colour: s.colour,
            symbols: byNn.symbols || 0,
            cableM: cab,
            ledM: led
          };
        });
        // v5.145.0 (Bryn: "although shades are drawn differently, they
        // should still appear in block count summaries") — drawn shades
        // fold into service 05 + the TOTAL BLOCKS figure on this page.
        const _ocShades = grandForCounts.shades || 0;
        if (_ocShades) {
          const _s05 = servicesData.find(x => x && x.nn === '05');
          if (_s05) _s05.symbols = (_s05.symbols || 0) + _ocShades;
        }
        pdf.addPage();
        const _ocResult = await window.SonorPdfHtmlCover.renderOverallCounts({
          accentHex: '#475161',
          status: meta.status,
          sectionTitle: 'OVERALL COUNTS',
          appName: 'TAKEOFFS',
          reference: meta.ref || '',
          projectName: meta.name,
          client: meta.client,
          address: meta.address,
          revision: meta.revision,
          issueDate: meta.dateUk || meta.date,
          pageNum: (typeof pdf.internal.getCurrentPageInfo === 'function')
            ? pdf.internal.getCurrentPageInfo().pageNumber
            : (1 + 6 + captured.length + 1),
          pageTotal: _planFinalTotal,
          services: _servicesForChrome,
          servicesData,
          grand: {
            floors: grandForCounts.floors,
            rooms: grandForCounts.rooms,
            symbols: (grandForCounts.symbols || 0) + _ocShades,   // v5.145.0 — + drawn shades
            areaM2: grandForCounts.areaM2,
            perimeterM: grandForCounts.perimeterM,
            cableM: grandForCounts.cableM,
            ledM: grandForCounts.ledM,
            shades: grandForCounts.shades
          }
        });
        if (_ocResult && _ocResult.dataUrl) {
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          pdf.addImage(_ocResult.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'overall-counts-html');
          overallCountsAdded = 1;
          try {
            pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
            pdf.__sonorPageStamps__.push({
              page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                      ? pdf.internal.getCurrentPageInfo().pageNumber
                      : pdf.internal.pages.length - 1),
              x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
              format: 'noop', source: 'html-overall-counts-suppress'
            });
          } catch (_) {}
        }
      } catch (e) {
        console.warn('[fullDocument v5.4.51] HTML overall counts failed:', e);
      }
    }

    // ============================================================
    // v5.70.0 — SERVICE PLANS, THE MASTER PLAN (Bryn: "electrical plan
    // should only exist if service devices are present, currently it
    // renders gf only randomly near the start, all service plans should
    // appear in number order"). ONE ordered registry drives BOTH the
    // page-count estimator (see _countSpecialPlanPages) and this emit
    // loop — they can never disagree about what exists. Each plan:
    //   · emits PER FLOOR (floor-walk via switchFloor, slice-loop
    //     pattern) and ONLY for floors that actually hold its devices
    //   · appears in SERVICE NUMBER order: 04 LTG → 04 LKP → 08 CCT →
    //     11 ELE (Electrical now gates on service 11 devices ONLY —
    //     lighting has its own plans)
    // ============================================================
    let cctvPagesAdded = 0;   // legacy name kept — downstream fallbacks read it
    let elecPagesAdded = 0;
    // v5.84.0 — RELOCATED + INTERLEAVED (Bryn: "lkp and cctv are near start
    // when everything should be in service order at the end of the pdf,
    // including electrical"). Special plans no longer emit here (right after
    // Combined) — this now only DEFINES _emitSpecialPlansForNn. The
    // per-service block loop below calls it after each service's slice +
    // schedule (04 LTG/LKP with service 04, 08 CCT with 08, 09 WIFI with 09,
    // 11 ELE last) and a trailing NN-ordered sweep catches leftovers (incl.
    // when slices are disabled). Gate is the GENERIC _secOn(p.key) — the old
    // hardcoded key map silently dropped new registry entries (wifiheatmap
    // was counted by the estimator but NEVER emitted).
    const _specialPlansEmitted = new Set();
    // v5.87.1 (B-373) — real first-page record per special plan, read by the
    // outline builder (the sequential page walk pointed 20+ pages early ever
    // since v5.84.0 moved these plans into the per-service blocks).
    const _specialPlanPageStarts = {};
    // ============================================================
    // v5.111.0 — ELECTRICAL REQUIREMENTS BLOCK (Bryn 2026-07-12: "build the
    // electrical requirements page before bulk cable and design this nicely
    // with specs and info. also move the electrical plans after this. these
    // should always be visible if selected for export, all floors and
    // external even if no blocks placed. if no blocks per floor, put a
    // large diagonal watermark text across the page 'NO REQUIREMENTS'").
    //   · 1 spec page (fused spurs / panel + rack supplies / svc-11 items /
    //     standards) rendered via SonorPdfHtmlCover.renderElectricalRequirements
    //   · ELECTRICAL PLAN for EVERY floor (External included — it's a floor),
    //     device presence irrelevant; empty floors get the NO REQUIREMENTS
    //     diagonal watermark
    //   · emits immediately BEFORE the first cables-family schedule in
    //     PASS 2; marks 'electrical' emitted so the per-service + trailing
    //     sweeps never duplicate it.
    // ============================================================
    let _elecBlockDone = false;
    // v5.253.0 — one BUILDER sheet rides with the electrical block when there is builder's work (0 pages when none)
    async function _emitBuilderRequirementsPage(pageNum) {
      const b = (typeof window !== 'undefined' && typeof window._builderRequirementsData === 'function') ? window._builderRequirementsData() : null;
      if (!b || !b.total) return 0;
      pdf.addPage();
      const _pg = (typeof pdf.internal.getCurrentPageInfo === 'function') ? pdf.internal.getCurrentPageInfo().pageNumber : pageNum;
      if (_pg) _specialPlanPageStarts['builderreq'] = { title: 'Trades Requirements — Builder', page: _pg };
      let ok = false;
      try {
        if (window.SonorPdfHtmlCover && typeof window.SonorPdfHtmlCover.renderBuilderRequirements === 'function' && window.SonorPdfHtmlCover.available()) {
          const _res = await window.SonorPdfHtmlCover.renderBuilderRequirements({
            accentHex: (typeof ASPECT_ACCENT !== 'undefined' && ASPECT_ACCENT['svc_12']) || '#8d6e4b',
            status: meta.status, sectionTitle: 'TRADES REQUIREMENTS — BUILDER', appName: 'TAKEOFFS',
            reference: meta.ref || '', projectName: meta.name, client: meta.client, address: meta.address,
            revision: meta.revision, issueDate: meta.dateUk || meta.date, pageNum: _pg, pageTotal: _planFinalTotal,
            services: _servicesForChrome, builder: b, revAdded: meta.revAdded || 0, revMoved: meta.revMoved || 0, revRemoved: meta.revRemoved || 0, revRfi: meta.revRfi || 0, revNote: meta.revNote || 0
          });
          if (_res && _res.dataUrl) {
            pdf.addImage(_res.dataUrl, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), 'builderreq-html');
            ok = true;
          }
        }
      } catch (e) { console.warn('[v5.253.0] builder requirements html failed:', e); }
      if (!ok) {
        try {
          paintHeader(pdf, { title: 'TRADES REQUIREMENTS — BUILDER', subtitle: "Builder's work — niches, pattresses, blind pockets", aspect: 'cabling', meta });
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5);
          let _y = 58;
          ['TV niches: ' + b.niches.length, 'Ply pattresses: ' + b.pattresses.length, 'Blind pockets: ' + b.pockets.length].forEach(l => { pdf.text(l, 24, _y); _y += 7; });
        } catch (e) { console.warn('[v5.253.0] builder requirements native fallback failed:', e); }
      }
      return 1;
    }
    async function _emitElectricalRequirementsBlock() {
      if (_elecBlockDone) return 0;
      _elecBlockDone = true;
      if (!_secOn('electrical')) return 0;
      _specialPlansEmitted.add('electrical');
      let added = 0;
      try {
        try { if (typeof window !== 'undefined' && typeof window._ledSpecPrefetch === 'function') await window._ledSpecPrefetch(); } catch (_) {}   // v5.268.0 — LED Calc's led_spec.electrical
        const elec = (typeof window !== 'undefined' && typeof window._electricalRequirementsData === 'function')
          ? window._electricalRequirementsData()
          : { spurs: [], panels: [], racks: [], svc11Rows: [], svc11ByFloor: {}, floors: [] };
        const _accent = (typeof ASPECT_ACCENT !== 'undefined' && ASPECT_ACCENT['svc_11']) || '#e63946';
        // v5.157.0 (Bryn: "a toggle as to whether the electrical plan shows
        // our blocks or whether it is fully overidden with the watermark") —
        // override mode hides ALL Sonor blocks / cables / links / HVAC on the
        // 11 slice and stamps the watermark across every floor.
        const _elecOverride = (typeof window !== 'undefined' && typeof window._sonorElecPlanMode === 'function')
          ? (window._sonorElecPlanMode() === 'override') : false;
        // ---- 1. ELECTRICAL REQUIREMENTS spec page ----
        pdf.addPage(); added++;
        const _reqPage = (typeof pdf.internal.getCurrentPageInfo === 'function')
          ? pdf.internal.getCurrentPageInfo().pageNumber : null;
        if (_reqPage) _specialPlanPageStarts['elecreq'] = { title: 'Trades Requirements — Electrical', page: _reqPage };
        let _reqOk = false;
        try {
          if (typeof window !== 'undefined' && window.SonorPdfHtmlCover
              && typeof window.SonorPdfHtmlCover.renderElectricalRequirements === 'function'
              && window.SonorPdfHtmlCover.available()) {
            if (typeof setStatus === 'function') setStatus('Rendering Electrical Requirements (HTML/CSS) …');
            const _res = await window.SonorPdfHtmlCover.renderElectricalRequirements({
              accentHex: _accent,
              status: meta.status, sectionTitle: 'TRADES REQUIREMENTS — ELECTRICAL', appName: 'TAKEOFFS',
              reference: meta.ref || '', projectName: meta.name, client: meta.client,
              address: meta.address, revision: meta.revision, issueDate: meta.dateUk || meta.date,
              pageNum: _reqPage || 0, pageTotal: _planFinalTotal,
              services: _servicesForChrome,
              revAdded: meta.revAdded || 0, revMoved: meta.revMoved || 0, revRemoved: meta.revRemoved || 0, revRfi: meta.revRfi || 0, revNote: meta.revNote || 0,
              // v5.198.0 — the standards note describes the plan-page stamp that
              // will actually follow (override mode → AS ARCHITECT SPEC).
              planMode: _elecOverride ? 'override' : 'blocks',
              watermarkText: (typeof window !== 'undefined' && typeof window._sonorElecWatermarkText === 'function')
                ? (window._sonorElecWatermarkText() || (_elecOverride ? 'AS ARCHITECT SPEC' : 'NO REQUIREMENTS'))
                : (_elecOverride ? 'AS ARCHITECT SPEC' : 'NO REQUIREMENTS'),
              elec
            });
            if (_res && _res.dataUrl) {
              pdf.addImage(_res.dataUrl, 'JPEG', 0, 0,
                pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), 'elecreq-html');
              try {
                pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
                pdf.__sonorPageStamps__.push({ page: _reqPage, x: 0, y: 0, clearW: 0, clearH: 0,
                  clearOffsetY: 0, format: 'noop', source: 'html-elecreq-suppress' });
              } catch (_) {}
              _reqOk = true;
            }
          }
        } catch (e) { console.warn('[v5.111.0] elec requirements HTML render failed — native fallback:', e); }
        if (!_reqOk) {
          // Native fallback — headline + counts so the page is never blank.
          try {
            paintHeader(pdf, { title: 'ELECTRICAL REQUIREMENTS',
              subtitle: 'Provisions by electrical contractor — read with the electrical plans following', aspect: 'cabling', meta });
            _setText(pdf, '#1a1f28');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
            pdf.text('BY ELECTRICAL CONTRACTOR', 24, 46);
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5);
            const _lines = [
              'Fused spurs (shade systems): ' + elec.spurs.length,
              'Panel supplies (shade + lighting): ' + elec.panels.length,
              'Equipment rack radials: ' + elec.racks.length,
              'Service 11 electrical placements: ' + elec.svc11Rows.length,
              'HVAC 240V-side items (stats + manifolds): ' + ((elec.hvac || []).length),   // v5.153.0
              '',
              'All 230 V works BY the electrical contractor to BS 7671. Unswitched 13 A fused',
              'connection units adjacent to each flagged shade motor. Panel + rack supplies on',
              'dedicated radials, in place and certified before second-fix commissioning.',
              'Maintain 300 mm parallel separation from Sonor ELV cabling; cross at 90°.'
            ];
            let _y = 58;
            _lines.forEach(l => { pdf.text(l, 24, _y); _y += 7; });
          } catch (e) { console.warn('[v5.111.0] elec requirements native fallback failed:', e); }
        }
        // ---- 1b. TRADES REQUIREMENTS — BUILDER (v5.253.0) ----
        try { added += await _emitBuilderRequirementsPage((_reqPage || 0) + 1); } catch (e) { console.warn('[v5.253.0] builder page emit failed:', e); }
        // ---- 2. ELECTRICAL PLAN — every floor, watermark when empty ----
        if (typeof floors !== 'undefined' && Array.isArray(floors) && floors.length
            && typeof switchFloor === 'function') {
          const _sortF = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
            ? window.sonorSortFloors : (a => a.slice());
          const sortedFloors = _sortF(floors.slice());
          const origActive = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
          let lastSwitched = origActive;
          try {
            for (const f of sortedFloors) {
              if (!f) continue;
              if (lastSwitched !== f.id) {
                try { await switchFloor(f.id, { force: true }); }
                catch (e) { console.warn('[v5.111.0] elec plan switchFloor failed:', e); }
                lastSwitched = f.id;
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await new Promise(r => setTimeout(r, 250));
              }
              const snap = _withExportLayerBoost('electrical', () => _snapshotCanvasByService('11', _elecOverride ? 'override' : undefined));
              if (!snap || !snap.dataUrl) continue;
              pdf.addPage(); added++; elecPagesAdded++;
              const _pg = (typeof pdf.internal.getCurrentPageInfo === 'function')
                ? pdf.internal.getCurrentPageInfo().pageNumber : null;
              if (_pg && !_specialPlanPageStarts['electrical']) {
                _specialPlanPageStarts['electrical'] = { title: 'ELECTRICAL PLAN', page: _pg };
              }
              const hasBlocks = !_elecOverride                     // v5.157.0 — override forces the watermark path
                && (((elec.svc11ByFloor && elec.svc11ByFloor[f.name || '']) || 0)
                + ((elec.hvacByFloor && elec.hvacByFloor[f.name || '']) || 0)) > 0;   // v5.153.0 — HVAC counts as electrical scope
              const _pIns = _svcInsetsForActiveFloor((sym, o) => {
                try { return String((sym && sym.service_nn) || '') === '11'; }
                catch (_) { return false; }
              }, '11');
              const pOpts = {
                title: 'ELECTRICAL PLAN',
                headerSubtitle: f.name || null,   // v5.146.0 — dot-spacer header (matches Combined)
                serviceNotes: _svcNotesFor('11', 'plan'),   // v5.151.0
                subtitle: _elecOverride
                  ? 'Electrical works by others — Sonor device blocks withheld'   // v5.157.0 — override mode
                  : 'Sub-contractor handover — electrical scope (service 11)',
                aspect: 'svc_11',
                legend: _pIns.legend, totals: _pIns.totals, summary: _pIns.summary,
                dataUrl: snap.dataUrl, canvasW: snap.w, canvasH: snap.h,
                pageNum: _pg || 6, pageTotal: _planFinalTotal, pageCode: 'ELE',
                useTitleBlock: true, withNotesColumn: true,
                showNotes: false, showDrawingKey: false,
                floorName: String(f.name || 'FLOOR').toUpperCase() + ' · ELECTRICAL SCOPE',
                // v5.147.0 (Bryn: "we could maybe do with a selector for the
                // electrical watermark") — text comes from the exports-panel
                // config (NO REQUIREMENTS / NOT SPECIFIED / AS ARCHITECT
                // SPEC / none); '' disables the stamp.
                watermarkText: hasBlocks ? null
                  : ((((typeof window !== 'undefined' && typeof window._sonorElecWatermarkText === 'function')
                      ? window._sonorElecWatermarkText() : 'NO REQUIREMENTS')
                      // v5.157.0 — override mode never emits a bare empty plan:
                      // '(no watermark)' selected still stamps the default text.
                      || (_elecOverride ? 'AS ARCHITECT SPEC' : null)))
              };
              const _fMeta = Object.assign({}, meta, { floor: f.name || '' });
              let usedHtml = false;
              if (htmlPlanEnabled) usedHtml = await _emitPlanPageIntoPdfHtml(pdf, pOpts, _fMeta);
              if (!usedHtml) _emitPlanPageIntoPdf(pdf, pOpts, _fMeta);
            }
          } finally {
            if (origActive && lastSwitched !== origActive) {
              try { await switchFloor(origActive, { force: true }); }
              catch (e) { console.warn('[v5.111.0] elec block floor restore failed:', e); }
            }
          }
        }
      } catch (e) { console.warn('[v5.111.0] electrical requirements block failed:', e); }
      return added;
    }
    async function _emitSpecialPlansForNn(nnWanted) {
    try {
      const plans = (typeof _specialPlanRegistry === 'function') ? _specialPlanRegistry() : [];
      const enabled = plans.filter(p => _secOn(p.sec || p.key)   // v5.87.0 — sec override
        && !_specialPlansEmitted.has(p.key)
        && (nnWanted == null || String(p.svcNn) === String(nnWanted)));
      if (enabled.length && typeof floors !== 'undefined' && Array.isArray(floors) && floors.length) {
        // Per-floor device presence WITHOUT switching floors (saved payloads).
        const _all = (typeof collectTakeoffAllFloors === 'function') ? collectTakeoffAllFloors() : { symbols: [] };
        const _floorsFor = (p) => _specialPlanFloorSet(p, _all.symbols);   // v5.71.0 — shared with the estimator
        const _sortF = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
          ? window.sonorSortFloors : (a => a.slice());
        const sortedFloors = _sortF(floors.slice());
        const origActive = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
        let lastSwitched = origActive;
        try {
          for (const p of enabled) {
            _specialPlansEmitted.add(p.key);
            const floorSet = _floorsFor(p);
            console.log('[SonorPdf-DIAG v5.84.0] special plan ' + p.key + ' floors=[' + Array.from(floorSet).join(', ') + ']');
            if (!floorSet.size) continue;   // no devices anywhere → no pages
            for (const f of sortedFloors) {
              if (!f || !floorSet.has(f.name || '')) continue;   // this floor has none
              if (typeof switchFloor === 'function' && lastSwitched !== f.id) {
                try { await switchFloor(f.id, { force: true }); } catch (e) { console.warn('[servicePlans] switchFloor failed:', e); }
                lastSwitched = f.id;
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await new Promise(r => setTimeout(r, 250));
              }
              const snap = _withExportLayerBoost(p.key, () => p.snap());   // v5.84.0 — force needed layers for the capture only
              if (!snap || !snap.dataUrl) continue;
              pdf.addPage();
              try {   // v5.87.1 (B-373) — record the plan's REAL first page
                const _pg = (typeof pdf.internal.getCurrentPageInfo === 'function')
                  ? pdf.internal.getCurrentPageInfo().pageNumber : null;
                if (_pg && !_specialPlanPageStarts[p.key]) {
                  _specialPlanPageStarts[p.key] = { title: p.title, page: _pg };
                }
              } catch (_) {}
              if (p.key === 'cctv') cctvPagesAdded++;
              if (p.key === 'electrical') elecPagesAdded++;
              // v5.87.0 — service-scoped legend + short data (never the
              // whole-floor rollup). Wifi plans override with the signal
              // legend via p.legend(); block counting reuses the registry
              // predicate with the saved-record shape (x/y/floor added so
              // the externals predicates can classify geometry).
              const _pIns = _svcInsetsForActiveFloor((sym, o) => {
                try {
                  return !!p.has(Object.assign({}, sym, {
                    x: Math.round((o && o.left) || 0),
                    y: Math.round((o && o.top) || 0),
                    floor: f.name || ''
                  }));
                } catch (_) { return false; }
              }, p.svcNn);
              const _pLegend = (typeof p.legend === 'function') ? (p.legend() || null) : _pIns.legend;
              const pOpts = {
                title: p.title,
                headerSubtitle: f.name || null,   // v5.146.0 — dot-spacer header (matches Combined)
                serviceNotes: _svcNotesFor(p.svcNn, 'plan'),   // v5.151.0
                subtitle: p.subtitle,
                aspect: 'svc_' + p.svcNn,
                legend: _pLegend,
                totals: _pIns.totals,
                summary: _pIns.summary,
                dataUrl: snap.dataUrl, canvasW: snap.w, canvasH: snap.h,
                pageNum: (typeof pdf.internal.getCurrentPageInfo === 'function')
                  ? pdf.internal.getCurrentPageInfo().pageNumber : 6,
                pageTotal: _planFinalTotal,
                pageCode: p.code,
                useTitleBlock: true, withNotesColumn: true,
                showNotes: false, showDrawingKey: false,
                floorName: (f.name || p.scopeLabel).toUpperCase() + ' · ' + p.scopeLabel
              };
              let usedHtml = false;
              // v5.92.0 (B-371a) — per-floor meta, mirroring the Combined loop:
              // export-start `meta` froze the floor at export time, so the
              // native fallback stamped the WRONG floor name on every page
              // after the first.
              const _pFloorMeta = Object.assign({}, meta, { floor: f.name || '' });
              if (htmlPlanEnabled) usedHtml = await _emitPlanPageIntoPdfHtml(pdf, pOpts, _pFloorMeta);
              if (!usedHtml) _emitPlanPageIntoPdf(pdf, pOpts, _pFloorMeta);
            }
          }
        } finally {
          if (typeof switchFloor === 'function' && origActive != null && lastSwitched !== origActive) {
            try { await switchFloor(origActive, { force: true }); } catch (_) {}
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
        }
      }
    } catch (e) { console.warn('[fullDocument] service plans failed:', e); }
    }   // end _emitSpecialPlansForNn (v5.84.0 — invoked from the per-service block loop below)

    // v5.42.0 — EXTERNAL AREAS plan inserted after Electrical. Only emitted
    // when at least one room is classed external (building-outline auto or
    // manual toggle) AND the External section is ticked. Main plan renders
    // at 25% opacity for reference; external rooms/symbols at full.
    let extPagesAdded = 0;
    try {
      const hasExternal = _incExternal && canvas.getObjects().some(o =>
        o && o.sonorMeasure && o.sonorMeasure.kind === 'area' && o.sonorMeasure.external === true);
      if (hasExternal) {
        const extSnap = _snapshotCanvasExternalOnly();
        if (extSnap && extSnap.dataUrl) {
          pdf.addPage();
          extPagesAdded = 1;
          const extOpts = {
            title: 'EXTERNAL AREAS PLAN',
            subtitle: 'Outside the building footprint — patios, driveways, garden zones (plan dimmed for reference)',
            aspect: 'external',
            dataUrl: extSnap.dataUrl,
            canvasW: extSnap.w,
            canvasH: extSnap.h,
            pageNum: (typeof pdf.internal.getCurrentPageInfo === 'function')
              ? pdf.internal.getCurrentPageInfo().pageNumber
              : (5 + captured.length + cctvPagesAdded + elecPagesAdded),
            pageTotal: _planFinalTotal,
            pageCode: 'EXT',
            useTitleBlock: true,
            withNotesColumn: true,
            showNotes: false,
            showDrawingKey: false,
            floorName: 'EXTERNAL AREAS'
          };
          if (typeof SonorPdf !== 'undefined' && SonorPdf.ASPECT_ACCENT) {
            SonorPdf.ASPECT_ACCENT['external'] = '#78ba57';   // garden green accent
          }
          let extUsedHtml = false;
          if (htmlPlanEnabled) extUsedHtml = await _emitPlanPageIntoPdfHtml(pdf, extOpts, meta);
          if (!extUsedHtml) _emitPlanPageIntoPdf(pdf, extOpts, meta);
        }
      }
    } catch (e) { console.warn('[fullDocument] External Areas plan failed:', e); }

    // v5.4.58 — Per-service plan slices RELOCATED to AFTER PASS 2 so each
    // service's plan(s) + schedule emit as a CONTIGUOUS BLOCK (Bryn directive
    // 2026-05-08 "per-service block grouping"). Declarations kept here so
    // `currentPageNum` init + outline tree below stay valid; the relocated
    // loop populates these counters.
    let svcSliceCount = 0;
    let svcScheduleCount = 0;  // schedule pages emitted inline within per-service blocks
    // v5.11.0 — v5.4.58 legacy per-service emit block (197 commented-out lines) deleted; dead by its own comment since relocation below PASS 2. See git history.

    // v5.87.0 — RELOCATED (Bryn: "move the place holders for cinema etc to
    // the very end"). The cross-app divider block now emits AFTER the
    // trailing special-plans sweep — see the very end of the deck below.
    let dividerPagesAdded = 0;

    // Pages (4+N+cctv+elec+slices+dividers)..end — each non-empty aspect's table take-off
    // v5.4.33 — pre-v5.4.33 we missed the +2 for the cabling info + bend
    // radius reference pages that always sit between cover (1) and the
    // first plan page. Result: HTML schedule chrome stamped "Page X of N-2"
    // (e.g. v5.4.32 showed "of 24" when the PDF was 26 pages). Adding
    // REF_PAGES = 2 to the live page counter.
    // v5.4.48 — Bryn clarification 2026-05-08: "not necessarily own page,
    // depends on content size, just own row rather than dual columns per
    // page". Sections stack as full-width rows; pairs of short sections
    // share a page. Total cabling info pages = 5 (or 6 with revision
    // history) + 1 bend radius:
    //   page 0 → 00.1 Taxonomy hero
    //   page 1 → 00.2 + 00.3 (Cable ID + Symbol Convention)
    //   page 2 → 00.4 + 00.5 (Drawing Key + Mounting Options)
    //   page 3 → 00.6 + 00.7 (Install Notes + Drawing Annotations)
    //   page 4 → 00.8 + 00.9 (Clouds + Tails)
    //   page 5 → 00.11 Revision History (only when present)
    //   bend radius (00.10) → its own page via separate template
    // v5.4.49 — _hasRevHistory now declared at the cabling-emit block
    // above (line ~8019) so TOTAL_INFO_PAGES can resolve it. Re-using
    // the same value here without redeclaring (TDZ-safe — outer fn scope).
    // v5.18.0 — 0 when the Information & Standards section is unticked, so
    // currentPageNum + the outline page offsets below stay exact.
    const _cablingSectionPages = _incInfo ? _infoCablingIdxFor(_hasRevHistory).length : 0;   // v5.170.0 — ticked pages only; v5.185.0 — FRONT pages only
    // v5.185.0 — the seed counts only pages that emit BEFORE the plans.
    // The CABLING STANDARDS pack + bend radius now emit inside the
    // schedule loop (before the Cable Schedule) and advance currentPageNum
    // there, so they must NOT be pre-counted here.
    const REF_PAGES_COUNT = _incInfo ? _cablingSectionPages : 0;
    // v5.4.51 — Overall Counts scoreboard adds 1 page between Combined Plans
    // and CCTV/Electrical/per-service slices. Counted separately so existing
    // page-num math stays explicit.
    let currentPageNum = 1 + contentsPagesAdded + REF_PAGES_COUNT + captured.length + overallCountsAdded + cctvPagesAdded + elecPagesAdded + svcSliceCount + dividerPagesAdded;   // v5.87.0 — + contents; dividers now emit at the END so dividerPagesAdded is 0 here (correct — schedules come 3 pages earlier)

    // v5.4.31/v5.4.32 — HTML/CSS schedule rendering for ALL eligible aspects
    // with full pagination support. Rationale: schedules previously fought
    // pixel-coordinate math for column alignment, text wrap, group separator
    // placement, and summary-chip overlap. The HTML pipeline (cover v5.4.28+,
    // Rooms v5.4.31) gives us real CSS — proper tables, brand-coherent zebra
    // rows, no truncation, page-width-aware columns. v5.4.32 extends to every
    // schedule type AND paginates multi-page schedules through the same pipeline.
    //
    // Two-pass strategy: pre-render every HTML page's image to dataURLs BEFORE
    // committing any addPage() calls. This means a mid-render failure can fall
    // back to native cleanly without leaving orphan blank pages. Once all
    // images are in hand, commit them sequentially with correct page-num stamps
    // baked into each image (we know the final pageTotal because we pre-counted
    // every aspect's HTML page count).
    //
    // Opt OUT for safety / debugging via:
    //   localStorage.setItem('takeoffs-pdf-html-schedule', '0')
    //   OR window.__SONOR_PDF_HTML_SCHEDULE__ = false
    const htmlSchedDisabled =
      (typeof window !== 'undefined') && (
        window.__SONOR_PDF_HTML_SCHEDULE__ === false ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-html-schedule') === '0')
      );
    const htmlSchedEnabled = !htmlSchedDisabled
      && (typeof window !== 'undefined')
      && window.SonorPdfHtmlCover
      && typeof window.SonorPdfHtmlCover.renderSchedule === 'function'
      && window.SonorPdfHtmlCover.available();
    // v5.4.32 — every schedule aspect with a report.rows[] is eligible. The
    // exclude set is for things that aren't classic schedules (cabling /
    // bend reference pages render via separate paths and don't enter this
    // loop). Per-service slice aspects ('svc_NN') are auto-eligible — their
    // accent colour is already populated by wirePerServicePdfButtons.
    const HTML_EXCLUDE_ASPECTS = new Set(['cabling', 'bend']);
    const _aspectAccentHex = (asp) => {
      const acc = ASPECT_ACCENT[asp];
      return acc || COLOURS.accent || '#6b4a8a';
    };
    const _isHtmlEligibleSchedule = (a) => {
      if (!a || !a.report || !Array.isArray(a.report.rows)) return false;
      if (HTML_EXCLUDE_ASPECTS.has(a.aspect)) return false;
      return true;
    };

    // Row-budget heuristic per html2canvas page (1190x842 A3 landscape):
    //   header ~44px, footer ~96px, body ~702px usable.
    //   Section title block ~80px (first page only).
    //   Each data row ~28px, group separator ~32px, table head ~30px.
    //   Total row ~38px (last page only).
    // Conservative: 22 items first page, 28 items continuation pages.
    // (item = row OR group separator)
    const HTML_FIRST_PAGE_ITEMS = 22;
    const HTML_CONT_PAGE_ITEMS  = 28;
    // v5.4.43 — pagination primitive extracted to sonor-pdf-paginate.js
    // (workspace-shared module, single source of truth, Cinema Takeoff +
    // any future PDF producer inherits via sync). The closure-scope
    // _paginateScheduleItems below now delegates to SonorPdfPaginate.paginate
    // when loaded, falling back to the inline implementation when the module
    // hasn't reached the page (offline / pre-load / module load failure).
    // First canary in the orchestrator de-monolithisation pass per Bryn
    // directive 2026-05-08 ("no monoliths").
    const _SonorPaginate = (typeof window !== 'undefined' && window.SonorPdfPaginate
      && typeof window.SonorPdfPaginate.paginate === 'function')
      ? window.SonorPdfPaginate.paginate
      : null;

    // Build the flat item list (rows + group separators interspersed)
    // for one aspect.
    // v5.47.1 — shim → SHARED builder (see scheduleItemsFor above).
    const _buildHtmlScheduleItems = (a) => scheduleItemsFor(a);

    // Split a flat item list into pages of ITEMS_PER_PAGE budget. When a
    // continuation page begins inside a group, re-emit a synthesised group
    // separator at the top so the reader still sees the section label.
    // v5.4.43 — delegates to SonorPdfPaginate.paginate when available;
    // otherwise falls back to the inline implementation below (preserves
    // pre-v5.4.43 behaviour when sonor-pdf-paginate.js hasn't loaded).
    // v5.47.1 — shim → SHARED paginator (canonical budgets + callbacks).
    const _paginateScheduleItems = (items, a) => schedulePaginate(items, {
      hasChips: !!(a && Array.isArray(a.summary) && a.summary.length),
      // v5.54.2 — dense budgets only for specs that ask (cables_v2).
      dense: !!(a && a.denseSchedule)
    });

    // v5.4.58 — extract PASS 2's per-aspect render+commit into a reusable
    // helper so the per-service plan loop can pair each service's
    // schedule inline with its plans (full block grouping per Bryn
    // directive 2026-05-08 "per service by category").
    //
    // Helper takes one aspect + current page num, emits its schedule
    // page(s) into the PDF (HTML preferred, native fallback), returns
    // the new currentPageNum. Uses _planFinalTotal as the chrome page
    // total (the precount estimate that the rest of the deck uses).
    const _emitAspectInline = async (a, currentPageNumIn) => {
      let curr = currentPageNumIn;
      // Build per-aspect plan (was PASS 1 inline)
      let useHtml = false;
      let pages = null;
      if (htmlSchedEnabled && _isHtmlEligibleSchedule(a)) {
        // v5.198.0 — measured pages (cached from the precount when it ran).
        pages = await scheduleMeasuredPages(a, (rows, fl) => _schedPageOptsFor(a, rows, fl, 0));
        useHtml = true;
      }
      // HTML render+commit (was PASS 2 inline)
      if (useHtml && pages && pages.length) {
        let aspectImages = [];
        let failed = false;
        try {
          if (typeof setStatus === 'function') setStatus('Rendering ' + a.title + ' (HTML/CSS) …');
          for (let pi = 0; pi < pages.length; pi++) {
            const isFirst = pi === 0;
            const isLast  = pi === pages.length - 1;
            const pgPageNum = curr + 1 + pi;
            const pageOpts = _schedPageOptsFor(a, pages[pi].items, { isFirst, isLast }, pgPageNum);
            const result = await window.SonorPdfHtmlCover.renderSchedule(pageOpts);
            if (!result || !result.dataUrl) throw new Error('renderSchedule returned no dataUrl');
            // v5.198.0 — safety net: if the renderer still had to hide rows,
            // carry them forward rather than lose them (re-render this page).
            if (result.overflow && _rebalanceSchedulePages(pages, pi, result)) { pi--; continue; }
            aspectImages.push(result.dataUrl);
          }
          // v5.39.0 (B-350) — floor-banner pages for outline children (v5.198.0:
          // computed from the FINAL pages, after any measured carry-forward).
          a._floorBookmarks = [];
          try {
            pages.forEach((pg, pi) => (pg.items || []).forEach(it => {
              if (it && it.group === true && it.kind !== 'sub' && it.label && !/\(continued\)$/i.test(String(it.label))) {
                a._floorBookmarks.push({ label: String(it.label), page: curr + 1 + pi });
              }
            }));
          } catch (_) {}
        } catch (e) {
          console.warn('[fullDocument v5.4.58] HTML schedule failed for ' + a.aspect + ' — falling back to native:', e);
          aspectImages = null;
          failed = true;
          try { window.__SONOR_LAST_SCHED_PATH__ = 'jspdf-fallback'; } catch (_) {}
        }
        if (!failed && Array.isArray(aspectImages) && aspectImages.length === pages.length) {
          for (const dataUrl of aspectImages) {
            pdf.addPage();
            curr++;
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            pdf.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH, 'sched-html-' + a.aspect + '-p' + curr);
            try { window.__SONOR_LAST_SCHED_PATH__ = 'html'; } catch (_) {}
            try {
              pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
              pdf.__sonorPageStamps__.push({
                page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                        ? pdf.internal.getCurrentPageInfo().pageNumber
                        : pdf.internal.pages.length - 1),
                x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
                format: 'noop',
                source: 'html-schedule-suppress'
              });
            } catch (_) {}
          }
          return curr;
        }
        // fallthrough to native
      }
      // NATIVE PATH
      pdf.addPage();
      curr++;
      a._floorBookmarks = [];   // v5.39.0 (B-350) — reset (html attempt may have part-filled)
      const finalPage = _emitAspectIntoPdf(pdf, {
        onGroupBanner: (label, pg) => { try { a._floorBookmarks.push({ label: String(label), page: pg }); } catch (_) {} },
        title: a.title, subtitle: a.subtitle, aspect: a.aspect,
        report: a.report, summary: a.summary, summaryTitle: a.summaryTitle,
        totals: a.totals, colWeights: a.colWeights, groupBy: a.groupBy,
        align: a.align || (a.report && a.report.align) || null,
        totalsAlign: a.totalsAlign || (a.report && a.report.totalsAlign) || null,
        groupColourByService: !!a.groupColourByService,
        _pageNumStart: curr,
        _pageTotal: _planFinalTotal
      }, meta);
      return finalPage;
    };
    // servicesForChrome shared between PASS 2 + per-service inline
    const _emitInline_servicesForChrome = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
      : null;

    // v5.4.58 — partition filtered into general + per-service map. PASS 2
    // now iterates only the general aspects; per-service aspects are
    // emitted INLINE inside the per-service plan loop (relocated to
    // after PASS 2 below) so each service's plan + schedule appear as
    // a contiguous block in the deck.
    const filteredSvcMap = new Map();
    const filteredGeneral = filtered.filter(a => {
      if (a && a.aspect && /^svc_/.test(a.aspect)) {
        filteredSvcMap.set(a.aspect, a);
        return false;
      }
      return true;
    });

    // PASS 1 — Pre-walk every aspect, decide if it's HTML-renderable, and
    // if so, count its HTML page count. This gives us the exact final
    // pageTotal so HTML chrome bakes the correct "Page X of Y".
    let htmlPlannedPageCount = 0;
    const aspectPlans = [];
    for (const a of filteredGeneral) {
      if (!htmlSchedEnabled || !_isHtmlEligibleSchedule(a)) { aspectPlans.push({ a, useHtml: false, pages: null }); continue; }
      // v5.198.0 — measured pages (cached from the precount).
      const pages = await scheduleMeasuredPages(a, (rows, fl) => _schedPageOptsFor(a, rows, fl, 0));
      htmlPlannedPageCount += pages.length;
      aspectPlans.push({ a, useHtml: true, pages });
    }
    // pageTotalEstimate (pre-computed earlier) assumed each aspect = 1 page.
    // If HTML plans give a different count, fix the estimate now so chrome
    // and footer stamps stay in sync.
    const nativeAspectsCount = aspectPlans.filter(p => !p.useHtml).length;
    // Each native aspect is approximated 1 page here (matches the original
    // estimate logic). Multi-page native is restamped by _finalisePagination.
    const finalPageTotal = (currentPageNum) + nativeAspectsCount + htmlPlannedPageCount;
    const servicesForChrome = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
      ? SERVICES.slice(0, 10).map(s => ({ nn: s.nn, key: s.key, name: s.name, colour: s.colour }))
      : null;

    // PASS 2 — For each aspect, pre-render every HTML page's image. If any
    // page fails, mark the aspect as failed → falls back to native at commit
    // time. Otherwise commit all pages once we have all images.
    const _isCablesFamilyAspect = (asp) => asp === 'cables' || asp === 'cables_v2'
      || asp === 'cable_summary' || asp === 'cables_lighting';
    for (const plan of aspectPlans) {
      const a = plan.a;
      // v5.111.0 — ELECTRICAL REQUIREMENTS + ELECTRICAL PLANS land
      // immediately BEFORE the first bulk-cable schedule (Bryn: "build the
      // electrical requirements page before bulk cable … move the
      // electrical plans after this").
      if (a && _isCablesFamilyAspect(a.aspect) && !_elecBlockDone) {
        try { currentPageNum += await _emitElectricalRequirementsBlock(); }
        catch (_e) { console.warn('[v5.111.0] electrical block emit failed:', _e); }
      }
      // v5.185.0 — CABLING STANDARDS pack (00.5-00.8 + 00.9 bend radius)
      // lands directly before the first cable schedule (after the
      // electrical block per the v5.111.0 ordering law).
      if (a && _isCablesFamilyAspect(a.aspect) && !_cablePackDone) {
        try { currentPageNum += await _emitCablingStandardsPack(currentPageNum); }
        catch (_e) { console.warn('[v5.185.0] cabling standards pack failed:', _e); }
      }
      if (plan.useHtml && plan.pages && plan.pages.length) {
        let aspectImages = [];
        let failed = false;
        try {
          if (typeof setStatus === 'function') setStatus('Rendering ' + a.title + ' (HTML/CSS) …');
          // Build the summary chip + total once per aspect (not per page);
          // first page gets the summary, last page gets the total row.
                    // v5.47.1 — SHARED assembly (headers/total/summary) — one place.
          for (let pi = 0; pi < plan.pages.length; pi++) {
            const isFirst = pi === 0;
            const isLast  = pi === plan.pages.length - 1;
            const pgPageNum = currentPageNum + 1 + pi;  // pageNum AFTER addPage
            if (pi === 0) a._pageNumStart = pgPageNum;
            // v5.198.0 — shared opts builder (what was measured is what renders).
            const pageOpts = _schedPageOptsFor(a, plan.pages[pi].items, { isFirst, isLast }, pgPageNum);
            const result = await window.SonorPdfHtmlCover.renderSchedule(pageOpts);
            if (!result || !result.dataUrl) throw new Error('renderSchedule returned no dataUrl');
            // v5.198.0 — safety net: carry hidden-overflow rows forward, never lose them.
            if (result.overflow && _rebalanceSchedulePages(plan.pages, pi, result)) { pi--; continue; }
            aspectImages.push(result.dataUrl);
          }
          // v5.39.2 (B-350) — floor-banner pages for outline children, from the
          // FINAL pages (v5.198.0: after any measured carry-forward).
          a._floorBookmarks = [];
          try {
            plan.pages.forEach((pg, pi) => (pg.items || []).forEach(it => {
              if (it && it.group === true && it.kind !== 'sub' && it.label && !/\(continued\)$/i.test(String(it.label))) {
                a._floorBookmarks.push({ label: String(it.label), page: currentPageNum + 1 + pi });
              }
            }));
          } catch (_) {}
        } catch (e) {
          console.warn('[fullDocument v5.4.32] HTML schedule failed for ' + a.aspect + ' — falling back to native:', e);
          aspectImages = null;
          failed = true;
          try { window.__SONOR_LAST_SCHED_PATH__ = 'jspdf-fallback'; } catch (_) {}
        }
        // COMMIT: if every page rendered, place them. Otherwise fall through
        // to native emit below.
        if (!failed && Array.isArray(aspectImages) && aspectImages.length === plan.pages.length) {
          for (const dataUrl of aspectImages) {
            pdf.addPage();
            currentPageNum++;
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            pdf.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH, 'sched-html-' + a.aspect + '-p' + currentPageNum);
            try { window.__SONOR_LAST_SCHED_PATH__ = 'html'; } catch (_) {}
            // noop stamp suppresses _finalisePagination Pass 2 over the chrome
            try {
              pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
              pdf.__sonorPageStamps__.push({
                page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                        ? pdf.internal.getCurrentPageInfo().pageNumber
                        : pdf.internal.pages.length - 1),
                x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
                format: 'noop',
                source: 'html-schedule-suppress'
              });
            } catch (_) {}
          }
          continue;  // next aspect
        }
        // fallthrough → native
      }
      // NATIVE PATH (also runs when aspect ineligible / html disabled / failed)
      pdf.addPage();
      currentPageNum++;
      a._pageNumStart = currentPageNum;   // v5.39.2 (B-350 fix) — real outline target
      a._floorBookmarks = [];   // v5.39.0 (B-350) — reset (html attempt may have part-filled)
      const finalPage = _emitAspectIntoPdf(pdf, {
        onGroupBanner: (label, pg) => { try { a._floorBookmarks.push({ label: String(label), page: pg }); } catch (_) {} },
        title: a.title,
        subtitle: a.subtitle,
        aspect: a.aspect,
        report: a.report,
        summary: a.summary,
        summaryTitle: a.summaryTitle,
        totals: a.totals,
        colWeights: a.colWeights,
        groupBy: a.groupBy,
        // v2.0.2 — forward per-column align + per-section service-colour
        // flags so Full Document pages render identically to standalone
        // schedule PDFs.
        align:        a.align || (a.report && a.report.align) || null,
        totalsAlign:  a.totalsAlign || (a.report && a.report.totalsAlign) || null,
        groupColourByService: !!a.groupColourByService,
        _pageNumStart: currentPageNum,
        _pageTotal: _planFinalTotal   // v5.144.0 — deck-wide total (was stale finalPageTotal)
      }, meta);
      currentPageNum = finalPage;
    }

    // v5.111.0 — bulk-cable schedule absent/unticked: the electrical block
    // still emits (requirements page + all-floor plans) right after the
    // general schedules, before the per-service blocks.
    if (!_elecBlockDone) {
      try { currentPageNum += await _emitElectricalRequirementsBlock(); }
      catch (_e) { console.warn('[v5.111.0] electrical block (fallback slot) failed:', _e); }
    }

    // ============================================================
    // v5.4.58 — PER-SERVICE BLOCKS (plan + schedule paired)
    // ============================================================
    // Bryn directive 2026-05-08: each service should appear as a
    // CONTIGUOUS BLOCK in the deck — its plan page(s) immediately
    // followed by its schedule. Pre-v5.4.58 the per-service plans ran
    // BEFORE general schedules, and per-service schedules ran at the
    // END of PASS 2 (separated by 10+ pages of unrelated tables).
    //
    // Now: after PASS 2 (general schedules), iterate every service that
    // has placements, walk floors emitting per-service plans, then call
    // _emitAspectInline(filteredSvcMap.get('svc_NN'), ...) to drop that
    // service's schedule directly after.
    //
    // Toggle: localStorage `takeoffs-fullpdf-svcslices` ('0' to disable).
    // Default ON. Skips a service entirely when no placements exist.
    try {
      const includeSlices = (typeof localStorage !== 'undefined')
        ? (localStorage.getItem('takeoffs-fullpdf-svcslices') !== '0')
        : true;
      if (includeSlices && typeof SERVICES !== 'undefined' && Array.isArray(SERVICES)
          && typeof switchFloor === 'function' && typeof floors !== 'undefined' && Array.isArray(floors)) {
        const servicePresent = {};
        try {
          const all = collectTakeoffAllFloors();
          (all.symbols || []).forEach(s => {
            if (!s || !s.service) return;
            const svc = SERVICES.find(x => x.key === s.service);
            if (svc) servicePresent[svc.nn] = true;
          });
        } catch (e) {}
        const slicesToEmit = SERVICES.filter(s => s && s.nn !== '11' && servicePresent[s.nn]);   // v5.159.0 — full registry minus 11
        if (slicesToEmit.length) {
          const _sortFloorsSlice = (typeof window !== 'undefined' && typeof window.sonorSortFloors === 'function')
            ? window.sonorSortFloors
            : ((typeof window !== 'undefined' && window.SonorPdfHtmlHelpers
                && typeof window.SonorPdfHtmlHelpers.sortFloors === 'function')
               ? window.SonorPdfHtmlHelpers.sortFloors
               : (arr => Array.isArray(arr) ? arr.slice() : arr));
          const allFloors = _sortFloorsSlice(floors.slice());
          const origActiveId = (typeof activeFloorId !== 'undefined') ? activeFloorId : null;
          try {
            let _sliceLastSwitched = null;
            console.log('[SonorPdf-DIAG v5.4.58] per-service block loop START. services=' + slicesToEmit.length +
              ' floors=' + allFloors.length + ' filteredSvcMap.size=' + filteredSvcMap.size);
            // v5.71.0 — skip floors WITHOUT the service's devices (was
            // emitting an empty full-floor plan for them). Shares
            // _slicesFloorMatrix with the estimator so counts match.
            const _sliceMatrix = (function () {
              try {
                const _a = (typeof collectTakeoffAllFloors === 'function') ? collectTakeoffAllFloors() : { symbols: [] };
                return _slicesFloorMatrix(_a.symbols || []);
              } catch (_) { return {}; }
            })();
            for (const svc of slicesToEmit) {
              // v5.157.0 — per-service slice tick: unticked services skip
              // their PLAN pages; the schedule + special plans below still emit.
              const _svcPlanOn = _sliceSvcOn(svc.nn);
              // ----- service plan(s) — one per floor WITH devices -----
              for (let i = 0; _svcPlanOn && i < allFloors.length; i++) {
                const f = allFloors[i];
                if (!f) continue;
                if (!(_sliceMatrix[svc.nn] && _sliceMatrix[svc.nn].has(f.name || ''))) continue;
                // v5.5.53 — force-mode switchFloor + correct sonorPlan wait
                if (_sliceLastSwitched !== f.id) {
                  try {
                    await switchFloor(f.id, { force: true });
                  } catch (e) { console.warn('[fullDocument] slice switchFloor failed for ' + f.id, e); }
                  _sliceLastSwitched = f.id;
                }
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await new Promise(r => setTimeout(r, 250));
                try {
                  if (typeof canvas !== 'undefined' && canvas && typeof canvas.getObjects === 'function') {
                    const planObj = canvas.getObjects().find(o => o && o.sonorPlan);
                    if (planObj) {
                      const img = planObj._element || (planObj.getElement && planObj.getElement());
                      if (img && img.complete === false) {
                        const startWait = Date.now();
                        while (img.complete === false && (Date.now() - startWait) < 3000) {
                          await new Promise(r => setTimeout(r, 50));
                        }
                      }
                    }
                  }
                  if (typeof canvas !== 'undefined' && canvas && typeof canvas.renderAll === 'function') {
                    canvas.renderAll();
                  }
                  await new Promise(r => requestAnimationFrame(r));
                } catch (_) {}
                let snap = null;
                const bboxZoomEnabled = (typeof window !== 'undefined') &&
                  (window.__SONOR_PDF_SLICE_BBOX_ZOOM__ === true ||
                   (typeof localStorage !== 'undefined' && localStorage.getItem('takeoffs-pdf-slice-bbox') === '1'));
                if (bboxZoomEnabled) {
                  try {
                    const bbox = (typeof window._serviceBoundingBox === 'function')
                      ? window._serviceBoundingBox(svc.nn, svc.key) : null;
                    if (bbox && typeof window._snapshotSliceCropped === 'function') {
                      const cropped = window._snapshotSliceCropped((o) => {
                        if (!o) return false;
                        if (o.sonorMeasure && o.sonorMeasure.kind === 'area') return true;
                        if (o.sonorSymbol) {
                          const sk = o.sonorSymbol.service;
                          const sn = o.sonorSymbol.service_nn;
                          if (sk === svc.key || sn === svc.nn || sk === svc.nn || sn === svc.key) return true;
                        }
                        if (o._sonorViewCone === true && svc.nn === '08') return true;
                        return false;
                      }, bbox);
                      if (cropped && cropped.overlayDataUrl) {
                        const compW = cropped.w;
                        const compH = cropped.h;
                        const off = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
                        if (off && compW > 0 && compH > 0) {
                          off.width = compW; off.height = compH;
                          const ctx = off.getContext('2d');
                          const drawImg = (url) => new Promise((res) => {
                            if (!url) return res();
                            const img = new Image();
                            img.onload = () => { try { ctx.drawImage(img, 0, 0, compW, compH); } catch (_) {} res(); };
                            img.onerror = () => res();
                            img.src = url;
                          });
                          await drawImg(cropped.planDataUrl);
                          await drawImg(cropped.overlayDataUrl);
                          snap = { dataUrl: off.toDataURL('image/jpeg', 0.85), w: compW, h: compH };
                        }
                      }
                    }
                  } catch (e) {
                    console.warn('[fullDocument] slice bbox-zoom failed:', svc.key, e);
                  }
                }
                if (!snap) {
                  snap = _snapshotCanvasByService(svc.nn);
                }
                if (!snap || !snap.dataUrl) continue;
                pdf.addPage();
                svcSliceCount++;
                currentPageNum++;
                if (typeof SonorPdf !== 'undefined' && SonorPdf.ASPECT_ACCENT) {
                  SonorPdf.ASPECT_ACCENT['svc_' + svc.nn] = svc.colour;
                }
                const livePageNum = (typeof pdf.internal.getCurrentPageInfo === 'function')
                  ? pdf.internal.getCurrentPageInfo().pageNumber
                  : currentPageNum;
                // v5.87.0 — combined-style legend filtered to THIS service on
                // THIS floor + service-scoped short data (Bryn: floor totals
                // per service were the whole-floor rollup — wrong).
                const _sIns = _svcInsetsForActiveFloor((sym) => (
                  sym.service === svc.key || sym.service_nn === svc.nn
                  || sym.service === svc.nn || sym.service_nn === svc.key
                ), svc.nn);
                const sliceOpts = {
                  title: `${svc.nn} ${svc.name.toUpperCase()} — PLAN`,
                  serviceNotes: _svcNotesFor(svc.nn, 'plan'),   // v5.151.0
                  // v5.146.0 (Bryn: "all other plans should have the same
                  // header formatting with dot spacers as the combined
                  // plans") — floor moves to the header subtitle slot
                  // ("TAKEOFFS · 02 AUDIO — PLAN · Ground Floor").
                  headerSubtitle: f.name || null,
                  subtitle: `Sub-contractor handover — ${svc.name} only · Floor ${i + 1} of ${allFloors.length} — ${f.name || ''}`,
                  floorName: f.name || '',
                  aspect: 'svc_' + svc.nn,
                  legend: _sIns.legend,
                  totals: _sIns.totals,
                  summary: _sIns.summary,
                  dataUrl: snap.dataUrl,
                  canvasW: snap.w,
                  canvasH: snap.h,
                  pageNum: livePageNum,
                  pageTotal: _planFinalTotal,
                  pageCode: 'SLI-' + svc.nn,
                  useTitleBlock: true,
                  withNotesColumn: true,
                  showNotes: false,
                  showDrawingKey: false
                };
                let sliceUsedHtml = false;
                // v5.92.0 (B-371a) — per-floor meta (see special-plan loop note).
                const _sFloorMeta = Object.assign({}, meta, { floor: f.name || '' });
                if (htmlPlanEnabled) sliceUsedHtml = await _emitPlanPageIntoPdfHtml(pdf, sliceOpts, _sFloorMeta);
                if (!sliceUsedHtml) _emitPlanPageIntoPdf(pdf, sliceOpts, _sFloorMeta);
              }
              // ----- service schedule (paired immediately after this service's plans) -----
              try {
                const _svcSched = filteredSvcMap.get('svc_' + svc.nn);
                if (_svcSched && _svcSchedOn(svc.nn)) {   // v5.168.0 — per-service schedule tick
                  const _liveBefore = (typeof pdf.internal.getCurrentPageInfo === 'function')
                    ? pdf.internal.getCurrentPageInfo().pageNumber
                    : currentPageNum;
                  const _liveAfter = await _emitAspectInline(_svcSched, _liveBefore);
                  const _added = Math.max(0, _liveAfter - _liveBefore);
                  svcScheduleCount += _added;
                  currentPageNum = _liveAfter;
                  // tag aspect with starting page so outline tree picks it up
                  try { _svcSched._pageNumStart = _liveBefore + 1; } catch (_) {}
                }
              } catch (_e) {
                console.warn('[fullDocument v5.4.58] inline svc schedule failed for ' + svc.nn + ':', _e);
              }
              // v5.84.0 — special plans slot into their service position
              // (04 LTG/LKP · 08 CCT · 09 WIFI) right after this service's
              // slice + schedule block.
              try { await _emitSpecialPlansForNn(svc.nn); }
              catch (_e2) { console.warn('[v5.84.0] special plans for svc ' + svc.nn + ' failed:', _e2); }
            }
          } finally {
            // v5.5.55 — force-mode restore matches v5.5.54 _captureAllFloors fix.
            if (origActiveId) {
              try { await switchFloor(origActiveId, { force: true }); }
              catch (e) { console.warn('[fullDocument] failed to restore active floor after slices:', e); }
            }
          }
        }
      }
    } catch (e) { console.warn('[fullDocument v5.4.58] Per-service block loop failed:', e); }

    // v5.84.0 — trailing sweep: special plans whose service had no slice
    // block (or slices disabled) still emit — NN order, end of the deck.
    // Electrical (11) always lands here, after the 01-10 blocks.
    try {
      for (const _nn of ['01','02','03','04','05','06','07','08','09','10','11']) {
        await _emitSpecialPlansForNn(_nn);
      }
    } catch (e) { console.warn('[v5.84.0] trailing special plans failed:', e); }

    // ---- v5.1.7 — Section divider pages for cross-app deliverables ----
    // v5.87.0 — moved here (VERY END of the deck, after every takeoffs
    // section incl. the trailing special-plan sweep) per Bryn 2026-07-10.
    // Placeholder pages that signal the boundary between Takeoffs content
    // and content owned by sister Sonor apps. Each is a single A3
    // landscape page with the standard chrome + a centred WIP badge +
    // cross-app pointer panel. The unified-package vision (Bryn directive
    // 2026-05-07) is that Project Master / Packs / Engineering / Cinema
    // Takeoff all converge on the same PDF style guide
    // (docs/SONOR-PDF-STYLE-GUIDE.md) — these dividers reserve the slots
    // until cross-app assembly lands in v6.x.
    //
    // Toggle: localStorage 'takeoffs-fullpdf-dividers' === '0' disables.
    // Default ON.
    try {
      const includeDividers = _incDividers;  // v5.18.0 — section ticklist (legacy key honoured)
      if (includeDividers) {
        const dividers = [
          {
            sectionTitle: 'Rack Build Sheets',
            sectionSubtitle: 'Front + rear rack elevations, bill of materials, technical schematic per rack',
            crossAppLabel: 'Sonor Packs',
            crossAppDetail: 'Open the project in the Packs app to generate the latest rack drawings, BOM tables, and per-rack cable IDs. Live build sheets are exported separately and bound into this deck before site issue.',
            accent: '#ad9978',   // §41 — gold (was slate)
            pageCode: 'DIV-PCK',
            wipBadge: true
          },
          {
            sectionTitle: 'Point-to-Point Schematics',
            sectionSubtitle: 'Distributed audio, video, control, network, lighting and power schematics',
            crossAppLabel: 'Sonor Engineering',
            crossAppDetail: 'Schematic deliverables (audio + cinema, distributed video + IR, control + network + PoE, lighting circuits, power) are owned by the Engineering app. Cross-app integration ships in v6.0.0 — for now, request the latest schematic export directly from the design team.',
            accent: '#ad9978',   // §41 — gold (purple stays the 01 service colour on the Cinema divider only)
            pageCode: 'DIV-ENG',
            wipBadge: true
          },
          {
            sectionTitle: 'Cinema Construction',
            sectionSubtitle: 'Plan, sightlines, screen + side wall elevations, fabric track, acoustic detail',
            crossAppLabel: 'Sonor Cinema Takeoff',
            crossAppDetail: 'Detailed cinema construction drawings (RP22 compliant) are produced in the Cinema Takeoff app. Open sonor-cinema-takeoff for the active cinema room build sheet, sightlines, and elevations.',
            accent: '#8058a1',
            pageCode: 'DIV-CIN',
            wipBadge: true
          }
        ];
        if (!_cinemaPresent) dividers.pop();   // v5.198.0 — no cinema, no Cinema Construction divider
        // v5.4.37 — Section dividers go through HTML pipeline for full
        // chrome consistency. Native fallback if HTML render fails.
        const _htmlDividerEnabled = (typeof window !== 'undefined') &&
          window.SonorPdfHtmlCover &&
          typeof window.SonorPdfHtmlCover.renderSectionDivider === 'function' &&
          window.SonorPdfHtmlCover.available();
        for (const d of dividers) {
          pdf.addPage();
          dividerPagesAdded++;
          let _divHtmlOk = false;
          if (_htmlDividerEnabled) {
            try {
              if (typeof setStatus === 'function') setStatus('Rendering ' + d.sectionTitle + ' (HTML/CSS) …');
              const _result = await window.SonorPdfHtmlCover.renderSectionDivider({
                accentHex: d.accent || '#ad9978',   // §41 — gold, never purple chrome
                title: d.sectionTitle,
                subtitle: d.sectionSubtitle,
                services: _servicesForChrome,
                projectMeta: {
                  name: meta.name,
                  ref: meta.ref,
                  status: meta.status,
                  date: meta.dateUk || meta.date,
                  code: (meta.ref || '') + '-' + (meta.revision || '00') + '-' + (d.pageCode || 'DIV')
                },
                owner: {
                  name: d.crossAppLabel,
                  body: d.crossAppDetail,
                  status: d.wipBadge ? 'WORK IN PROGRESS' : ''
                }
              });
              if (_result && _result.dataUrl) {
                const pageW = pdf.internal.pageSize.getWidth();
                const pageH = pdf.internal.pageSize.getHeight();
                pdf.addImage(_result.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'div-html-' + (d.pageCode || ''));
                _divHtmlOk = true;
                try {
                  pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
                  pdf.__sonorPageStamps__.push({
                    page: (typeof pdf.internal.getCurrentPageInfo === 'function'
                            ? pdf.internal.getCurrentPageInfo().pageNumber
                            : pdf.internal.pages.length - 1),
                    x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0,
                    format: 'noop', source: 'html-divider-suppress'
                  });
                } catch (_) {}
              }
            } catch (e) {
              console.warn('[fullDocument v5.4.37] HTML section divider failed for ' + d.sectionTitle + ':', e);
            }
          }
          if (!_divHtmlOk) {
            // pageNum + pageTotal are restamped by _finalisePagination below.
            _paintSectionDividerPage(pdf, meta, d, 0, 0);
          }
        }
      }
    } catch (e) { console.warn('[fullDocument] Section dividers failed:', e); }

    // v5.249.0 (2026-10-16, §41 — Bryn: the running footer carries page numbers only, the full contact details go on a rear
    // page) — REAR CONTACT PAGE, last page of every Full Document (not on plans-only). Counter twin: _rearPageOn() in the estimator.
    try {
      if (_rearPageOn() && window.SonorPdfHtmlCover && typeof window.SonorPdfHtmlCover.renderRearPage === 'function' && window.SonorPdfHtmlCover.available()) {
        if (typeof setStatus === 'function') setStatus('Rendering rear contact page (HTML/CSS) …');
        const _rear = await window.SonorPdfHtmlCover.renderRearPage({ projectMeta: { ref: meta.ref, name: meta.name } });
        if (_rear && _rear.dataUrl) {
          pdf.addPage();
          const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
          pdf.addImage(_rear.dataUrl, 'JPEG', 0, 0, pageW, pageH, 'rear-html');
          try {
            pdf.__sonorPageStamps__ = pdf.__sonorPageStamps__ || [];
            pdf.__sonorPageStamps__.push({ page: (typeof pdf.internal.getCurrentPageInfo === 'function' ? pdf.internal.getCurrentPageInfo().pageNumber : pdf.internal.pages.length - 1), x: 0, y: 0, clearW: 0, clearH: 0, clearOffsetY: 0, format: 'noop', source: 'html-rear-suppress' });
          } catch (_) {}
        }
      }
    } catch (e) { console.warn('[fullDocument v5.249.0] rear page failed:', e); }

    // v1.99.1 — Final pagination pass. The page-total estimate computed
    // before CCTV / Electrical / per-service slice pages is stale by the
    // time those conditional pages are added. Bryn report on Caldy v1.97.2:
    // footers read inconsistently (Page 1 of 8 / 4 of 9 / 5 of 10 / 6 of 8).
    // This walks every page in the finished PDF, paints a solid body-colour
    // rectangle over the right-side footer strip, and re-stamps the
    // canonical "Page X of Y" + version line with the actual final Y.
    // Cheap (every page already has a footer; we just overwrite the
    // bottom-right cell). Runs AFTER all pages added, BEFORE save.
    try { _finalisePagination(pdf, meta); }
    catch (e) { console.warn('[fullDocument] page renumber failed:', e); }

    // ---- v5.1.8 — Build hierarchical PDF outline (TOC sidebar) ----
    // Every Full Document opens in Acrobat / Preview with a clickable
    // navigation sidebar. Page numbers reconstruct the layout produced
    // above: cover (1) → references (2-3) → plans (4..) → dividers →
    // schedules. Aspect schedules can span multiple pages so we use
    // _pageNumStart from the captured aspect spec.
    try {
      let entries = [];   // v5.198.0 — reassigned by _sortContentsEntries
      let p = 1;
      // Cover
      entries.push({ title: 'Cover · ' + (meta.name || 'Take-Off'), page: p });
      p++;  // → 2
      // v5.87.0 — CONTENTS page 2
      if (contentsPagesAdded) { entries.push({ title: 'Contents', page: p }); p++; }
      // Reference parent
      // v5.12.0 FIX (audit #1): the tree still assumed the legacy
      // 2-reference-page layout (Cabling=2, Bend=3, plans from 4). The
      // deck actually carries _cablingSectionPages (5-6) info pages + the
      // bend radius page + the v5.4.51 Overall Counts page, so every
      // bookmark from "Bend Radius" onward landed 4-6 pages early. Seed
      // with the SAME variables currentPageNum uses (REF_PAGES_COUNT /
      // overallCountsAdded — both in scope, declared above PASS 2).
      // v5.18.0 — Reference bookmarks + their page offset only when the
      // Information & Standards section is included (REF_PAGES_COUNT === 0
      // otherwise, so p must NOT advance here).
      if (_incInfo && REF_PAGES_COUNT > 0) {   // v5.170.0 — bookmarks follow the ticked pages
        const refIdx = entries.length;
        entries.push({ title: 'Project Information', page: p });   // v5.253.0
        if (_cablingSectionPages > 0) {
          // v5.198.0 — one child per FRONT info page (was a single "Project
          // Information" row pointing at page 3 for three pages).
          const _INFO_TITLES = { 0: 'Project Information', 1: 'Taxonomy & Conventions', 2: 'Key & Annotations', 3: 'Cable ID Format & Types', 4: 'Install Notes & Tails', 5: 'Revision Table' };   // v5.253.0 — 0 = merged front page
          _infoIdxList.forEach((idx, k) => entries.push({ title: _INFO_TITLES[idx] || (idx >= 100 ? 'Plan Notes (continued)' : ('Information ' + (k + 1))), page: p + k, parentIdx: refIdx }));
          p += _cablingSectionPages;
        }
        // v5.185.0 — bend radius rides the CABLING STANDARDS pack now
        // (bookmarked below at its REAL emitted page).
      }
      // Plans parent
      const plansIdx = entries.length;
      entries.push({ title: 'Plans', page: p });
      // Combined plans — one per floor
      const combinedIdx = entries.length;
      entries.push({ title: 'Combined Plans', page: p, parentIdx: plansIdx });
      captured.forEach((c, i) => {
        const fname = (c && c.floor && c.floor.name) || ('Floor ' + (i + 1));
        entries.push({ title: fname, page: p + i, parentIdx: combinedIdx });
      });
      p += captured.length;
      // v5.12.0 — Overall Counts scoreboard sits between Combined Plans
      // and CCTV (v5.4.51); bookmark it + account for the page offset.
      if (overallCountsAdded) {
        entries.push({ title: 'Overall Counts', page: p, parentIdx: plansIdx });
        p += overallCountsAdded;
      }
      // v5.87.1 (B-373 FIX) — special plans (CCTV / Electrical / Lighting /
      // LKP / WiFi / per-service externals) bookmark their REAL recorded
      // first pages. They emit inside the per-service blocks near the END
      // of the deck (v5.84.0), so the old sequential entries here pointed
      // 20+ pages early AND wrongly shifted every later bookmark by
      // advancing p — p must NOT advance for them.
      try {
        const _spOrder = (typeof _specialPlanRegistry === 'function') ? _specialPlanRegistry() : [];
        // v5.111.0 — Electrical Requirements spec page (emits with the
        // electrical plans, before the bulk-cable schedule) — listed just
        // ahead of the ELECTRICAL PLAN entry the registry loop adds.
        const _spRecs = [];
        const _erq = _specialPlanPageStarts['elecreq'];
        if (_erq) _spRecs.push(_erq);
        const _brq = _specialPlanPageStarts['builderreq'];   // v5.253.0
        if (_brq) _spRecs.push(_brq);
        _spOrder.forEach(sp => {
          const rec = _specialPlanPageStarts[sp.key];
          if (rec) _spRecs.push(rec);
        });
        // v5.144.0 — PAGE order, not registry order (the WIFI HEATMAP entry
        // sat above ELECTRICAL PLAN despite living 21 pages later).
        _spRecs.sort((a, b) => (a.page || 0) - (b.page || 0));
        _spRecs.forEach(rec => entries.push({ title: rec.title, page: rec.page, parentIdx: plansIdx }));
      } catch (_) {}
      // v5.42.0 — External Areas bookmark
      if (typeof extPagesAdded === 'number' && extPagesAdded) {
        entries.push({ title: 'External Areas', page: p, parentIdx: plansIdx });
        p += extPagesAdded;
      }
      // v5.87.0 — cross-app dividers moved to the VERY END of the deck;
      // their outline entries are appended after the per-service blocks
      // below (computed from the live page count, exact by construction).
      // v5.4.58 — General schedules (filteredGeneral aspects only — per-service
      // svc_NN aspects are now emitted INSIDE their per-service block below).
      // v5.185.0 — CABLING STANDARDS pack bookmarks (real recorded pages;
      // sits between the plans block and the schedules in page order).
      if (_cablePackPageStart) {
        const packIdx = entries.length;
        entries.push({ title: 'Cabling Standards', page: _cablePackPageStart });
        // v5.198.0 — every pack page is listed (Cable ID format / install
        // notes were unlisted; only the bend page had a row).
        const _PACK_TITLES = { 3: 'Cable ID Format & Types', 4: 'Install Notes & Tails' };
        _packIdxListResolved.forEach((idx, k) => entries.push({ title: _PACK_TITLES[idx] || ('Cabling ' + (k + 1)), page: _cablePackPageStart + k, parentIdx: packIdx }));
        if (_bendPageReal) {
          entries.push({ title: 'Bend Radius Reference', page: _bendPageReal, parentIdx: packIdx });
        }
      }
      if (filteredGeneral.length) {
        const schedIdx = entries.length;
        entries.push({ title: 'Schedules', page: p });
        // v5.185.1 — parent points at the FIRST schedule's REAL page after
        // the loop (the sequential counter doesn't know about the cabling
        // pack pages emitted mid-loop).
        filteredGeneral.forEach(a => {
          if (!a) return;
          const aTitle = (a.title || a.aspect || 'Schedule').replace(/\s+Schedule$/i, '');
          const aPage = a._pageNumStart || p;
          const aIdx = entries.length;
          entries.push({ title: aTitle, page: aPage, parentIdx: schedIdx });
          // v5.39.0 (B-350) — per-floor children under multi-floor schedules
          // (recorded at emit time by both html + native paths). Dedup by
          // label, only when 2+ floors so single-floor jobs stay clean.
          if (Array.isArray(a._floorBookmarks) && a._floorBookmarks.length) {
            const seen = new Set();
            const fbs = a._floorBookmarks.filter(fb => {
              const k = String(fb && fb.label || '').toUpperCase();
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            });
            if (fbs.length >= 2) {
              fbs.forEach(fb => entries.push({ title: fb.label, page: fb.page, parentIdx: aIdx }));
            }
          }
        });
        // v5.185.1 — snap the Schedules parent to its first child's real page.
        const _schedFirst = entries.reduce((mn, e) =>
          (e && e.parentIdx === schedIdx && e.page && e.page < mn) ? e.page : mn, Infinity);
        if (isFinite(_schedFirst)) entries[schedIdx].page = _schedFirst;
      }
      // v5.4.58 — Per-service blocks (plans + paired schedule). Each entry
      // is the service plan(s) section header; the inline schedule
      // appears as a child entry pointing at its first page (recorded
      // by `_pageNumStart` set during the per-service block emit).
      if (svcSliceCount || svcScheduleCount) {
        const blocksIdx = entries.length;
        entries.push({ title: 'Per-service blocks', page: p });
        // Iterate filteredSvcMap in service-order (svc_01 → svc_10).
        const _svcOrder = (typeof SERVICES !== 'undefined' && Array.isArray(SERVICES))
          ? SERVICES.slice(0, 10) : [];
        for (const svc of _svcOrder) {
          const a = filteredSvcMap.get('svc_' + svc.nn);
          // Only services with placements got a block (plans were emitted).
          // Schedule presence in filteredSvcMap = aspect existed; plan emit
          // is gated independently. Use _pageNumStart as authoritative source.
          if (a && a._pageNumStart) {
            entries.push({
              title: svc.nn + ' ' + svc.name,
              page: a._pageNumStart - 1,  // jump to the plan page (one before schedule)
              parentIdx: blocksIdx
            });
          }
        }
        // v5.144.0 — the parent's page was the stale sequential counter
        // (read "12" while its first child started at 22). Point it at the
        // first child's real page.
        const _psbFirst = entries.reduce((mn, e) =>
          (e && e.parentIdx === blocksIdx && e.page && e.page < mn) ? e.page : mn, Infinity);
        if (isFinite(_psbFirst)) entries[blocksIdx].page = _psbFirst;
      }
      // v5.87.0 — Cross-app placeholders now close the deck (Bryn: "move
      // the place holders for cinema etc to the very end"). Their start
      // page = live page count minus the pages they added — exact.
      if (dividerPagesAdded) {
        const xappIdx = entries.length;
        const _divStart = pdf.internal.getNumberOfPages() - dividerPagesAdded + 1;
        entries.push({ title: 'Cross-app sections', page: _divStart });
        const dividerTitles = ['Rack Build Sheets', 'Point-to-Point Schematics', 'Cinema Construction'];
        for (let i = 0; i < dividerPagesAdded; i++) {
          entries.push({
            title: dividerTitles[i] || ('Section ' + (i + 1)),
            page: _divStart + i,
            parentIdx: xappIdx
          });
        }
      }
      // v5.198.0 — contents + outline in PAGE order (Cabling Standards was
      // listed before Schedules while sitting on page 23 vs 11).
      entries = _sortContentsEntries(entries);
      _buildOutlineTree(pdf, entries);
      // v5.87.0 — paint the reserved CONTENTS page (page 2) from the SAME
      // entries that drive the outline sidebar — one source, no drift.
      if (contentsPagesAdded) {
        // v5.146.0 — HTML pipeline first (same chrome as every other page);
        // jsPDF painter only when the module is missing or the render throws.
        let _tocHtmlDone = false;
        try { _tocHtmlDone = await _emitContentsPageHtml(pdf, meta, entries, _planFinalTotal); }
        catch (e) { console.warn('[fullDocument v5.146.0] HTML contents failed — painter fallback:', e); }
        if (!_tocHtmlDone) {
          try { _paintContentsPage(pdf, meta, entries, _planFinalTotal); }
          catch (e) { console.warn('[fullDocument v5.87.0] contents page paint failed:', e); }
        }
      }
    } catch (e) {
      console.warn('[fullDocument] outline tree build failed:', e);
    }

    const stamp = meta.date;
    const projSlug = (meta.name || 'takeoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname = opts.filename || `sonor-${projSlug}-full_${stamp}.pdf`;
    // v5.1.8 — opts.title=Full Document signals the metadata helper to
    // pick the right Subject string ("Full Document — <client>" rather
    // than the default "Take-Off — <client>").
    try { _applyDocumentMetadata(pdf, meta, { title: 'Full Document' }); } catch (_) {}
    // v2.9.0 — SECOND PASS: every HTML page number from the FINAL page count (the precount can drift — see the
    // self-check below; before this the drift shipped as "Page 2 of 121" on a 117-page file).
    try { _restampHtmlPageNumbers(pdf); } catch (e) { console.warn('[fullDocument v2.9.0] page-number restamp failed:', e); }
    // v5.3.0 — Cross-app contract for SonorPdfBind. When opts.asBuffer is
    // true, return the PDF bytes (ArrayBuffer) instead of triggering a
    // browser download. The cross-app orchestrator (sonor-pdf-bind.js)
    // collects buffers from each Sonor app and merges them via pdf-lib's
    // copyPages() into one unified deliverable.
    if (opts.asBuffer) {
      try {
        // jsPDF .output('arraybuffer') returns the in-memory bytes
        // without triggering a download. Cleanest hand-off to pdf-lib.
        const buf = pdf.output('arraybuffer');
        if (typeof setStatus === 'function') {
          setStatus(`Full document bytes ready (${(buf.byteLength / 1024).toFixed(0)} KB) — cross-app bind hand-off.`);
        }
        return buf;
      } catch (e) {
        console.warn('[fullDocument] asBuffer mode failed, falling through to download:', e);
      }
    }
    // ============================================================
    // v5.70.0 — PAGE-TOTAL SELF-CHECK (the "never breaks" guarantee).
    // The estimator (search '_planFinalTotal = total') must count every
    // page the emitters produce. RULE FOR EVERY FUTURE SECTION: add its
    // emitter AND its counter twin (special plans: extend
    // _specialPlanRegistry — count + emit share it automatically). If a
    // section forgets, this check catches it ON THE FIRST EXPORT with an
    // actionable error instead of silently shipping wrong "PAGE x OF y".
    // ============================================================
    try {
      const _actualPages = pdf.internal.getNumberOfPages();
      if (_actualPages !== _planFinalTotal) {
        // v2.9.0 — the HTML page numbers were restamped to the real count above, so this is a note, not a broken deck.
        const msg = '[fullDocument] PAGE-TOTAL DRIFT: estimator said ' + _planFinalTotal +
          ', document has ' + _actualPages + ' pages — page numbers restamped from the final count. ' +
          'A section emitter is missing its counter twin or came back empty (see the self-check comment at pdf.save).';
        console.warn(msg);
      } else {
        console.info('[fullDocument] page-total self-check OK: ' + _actualPages + ' pages.');
      }
    } catch (_) {}
    pdf.save(fname);
    if (typeof setStatus === 'function') {
      const sliceTxt = svcSliceCount ? ` + ${svcSliceCount} service slice${svcSliceCount === 1 ? '' : 's'}` : '';
      setStatus(`Full document exported — ${fname} (${currentPageNum} pages: cover + ${captured.length} plan${captured.length === 1 ? '' : 's'}${sliceTxt} + ${filtered.length} take-off${filtered.length === 1 ? '' : 's'}).`);
    }
    return fname;
  }

  return {
    collectProjectMeta,
    // v5.47.1 — SHARED SCHEDULE BUILDER (single source for the standalone A3
    // export AND the Full Document — see scheduleItemsFor et al above).
    scheduleItemsFor, schedulePaginate, scheduleHeadersFor, scheduleTableOptsFor,
    scheduleTotalRowFor, scheduleSummaryFor,
    paintHeader, paintFooter, paintLegend, paintScaleBar, paintSummary, paintTable, paintCoverSheet, paintNorthArrow,
    // v5.1.7 — DRAWING KEY panel + cross-app section divider page painter.
    // Exposed publicly so other Sonor apps (Project Master, Packs,
    // Engineering, Cinema Takeoff) can render matching dividers when
    // unified-package assembly lands in v6.x. See
    // docs/SONOR-PDF-STYLE-GUIDE.md at workspace root for the contract.
    paintDrawingKey,
    paintSectionDivider: _paintSectionDividerPage,
    aspect, plan, plans, cctvPlan, servicePlan, wifiHeatmap, fullDocument,
    // v2.4.0 — pdf-lib pipeline (opt-in via localStorage 'takeoffs-pdf-lib'='1')
    fullDocumentPdfLib,
    // v3.1.0 — UNIFICATION (PDF-UNIFICATION_2026-05-19.md). Plans-only via
    // pdf-lib using SAME painter as Full Document. plans() dispatcher routes
    // here when opts.planPages is supplied + pdf-lib loaded + flag on.
    plansPdfLib,
    // v3.2.0 — Phase 3 unification. Single-page exports (CCTV-only,
    // Service-only, Plan) now share the same _renderPlanDeckPdfLib
    // pipeline. Their public shims (cctvPlan / servicePlan / plan) became
    // dispatchers: pdf-lib first, jsPDF heavy-sidebar fallback retained.
    cctvPlanPdfLib, servicePlanPdfLib, planPdfLib,
    // v3.3.0 / v5.5.58 — Phase 4 unification. Standalone aspect schedules
    // (12 toolbar buttons: Rooms / Symbols / Cables / CableSchedV2 / LEDs /
    // Lighting / Shades / TVs / PJ / Snags / Zones / PerRoom) route through
    // _paintAspectPdfLib — same painter Full Doc uses. _paintAspectPdfLib
    // gained TRUE multi-page in v5.5.58 (was the v2.4.x truncation blocker).
    aspectPdfLib,
    pdfLibAvailable: _pdfLibAvailable,
    COLOURS, ASPECT_ACCENT,
    serviceColourForSection: _serviceColourForSection,  // v2.0.2 — exposed for callers + tests
    // v2.0.0 painters (exposed for unit-testing + advanced callers)
    drawingCode: _drawingCode,
    statusPill: _statusPill,
    paintHeaderDrawingCode,
    paintTitleBlock: _paintTitleBlock,
    paintNotesColumn: _paintNotesColumn,
    paintScheduleFooter: _paintScheduleFooter,
    paintCablingInfoPage: _paintCablingInfoPage,
    paintBendRadiusPage: _paintBendRadiusPage,
    // v5.4.15 — Sonor canonical rounded page-edge border. Exposed
    // publicly so other Sonor apps (Project Master, Packs, RAMS,
    // Cinema Takeoff) can paint the same printer's-mark frame on
    // their PDF deliverables — uniform brand expression across the
    // workspace. Pure helper, no opts.
    paintPageBorder: _paintPageBorder,
    // v2.4.3 — pdf-lib reference-page painters + final pagination pass
    paintCablingInfoPagePdfLib: _paintCablingInfoPagePdfLib,
    paintBendRadiusPagePdfLib: _paintBendRadiusPagePdfLib,
    finalisePaginationPdfLib: _finalisePaginationPdfLib,
    // v2.9.0 — HTML page numbers from the final count (second pass after assembly)
    trackHtmlPageStamps: _trackHtmlPageStamps,
    restampHtmlPageNumbers: _restampHtmlPageNumbers
  };
})();

  // Expose to window so external call sites (sonor-takeoffs.html click
  // handlers, future Cinema Takeoff consumers) resolve the same object
  // they did when the module was an inline IIFE.
  if (typeof window !== 'undefined') {
    window.SonorPdf = SonorPdf;
    try { window.SonorPdf.__version = SONOR_PDF_VERSION; } catch (_) {}
  }
})();
