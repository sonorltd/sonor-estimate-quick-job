// =============================================================================
// sonor-pdf-html-components.js — reusable HTML component builders
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root.
// One responsibility: pure functions that return HTML fragment strings for
// the discrete visual components used on cover + section divider pages.
// Each component is independently testable, restylable (via CSS classes
// in sonor-pdf-html-cover.css), and composable.
//
// Depends on: window.SonorPdfHtmlHelpers (esc, statusColour, statusInkOn)
//
// Public API (window.SonorPdfHtmlComponents):
//   serviceStrip(services, opts?)            — 10 colour dots
//   statusPill(status, opts?)                — pill matching status hex
//   infoCell(caption, value, opts?)          — single grid cell
//   infoGrid(cells)                          — 2x2 cell grid
//   floorsTable(floors)                      — floors panel + table
//   totalsPanel(totals)                      — totals dl-list panel
//   revisionTimeline(history, latestCode)    — connected dots strip
//   ownerCard(owner)                         — section-divider OWNED BY card
//   scheduleTable(opts)                      — v1.13.0: + opts.textColourRules [{col, re, hex}] (cell text colour)
//                                              v1.14.0: rows may carry { floorTotal: true, values } → .sch-floor-total band
//
// Each function returns a String of HTML. Pure — no DOM, no side effects.

(function () {
  // 2026-10-16 §41 — chrome inks come from sonor-pdf-theme when it is on the page (service colours stay literal: they ARE the per-area colour)
  const _TH = (typeof window !== 'undefined' && window.SonorPdfTheme && window.SonorPdfTheme.HEX) || {};
  const INK = _TH.ink || '#1a1f28', GOLD = _TH.gold || '#ad9978', LABEL = _TH.label || '#8b7d6b', G500 = _TH.g500 || '#94a3b8', G600 = _TH.g600 || '#636c7a';
  'use strict';

  function _h() {
    return (typeof window !== 'undefined' && window.SonorPdfHtmlHelpers) || {
      esc: s => String(s == null ? '' : s),
      statusColour: () => G600,
      statusInkOn: () => '#ffffff'
    };
  }

  const DEFAULT_SERVICES = [
    { nn: '01', name: 'Cinema',          colour: '#8058a1' },
    { nn: '02', name: 'Audio',           colour: '#4bb9d3' },
    { nn: '03', name: 'Video',           colour: '#78ba57' },
    { nn: '04', name: 'Lighting',        colour: '#f5d05c' },
    { nn: '05', name: 'Automation',      colour: '#e37c59' },
    { nn: '06', name: 'HVAC',            colour: '#ec6061' },
    { nn: '07', name: 'Control',         colour: '#e67eb1' },
    { nn: '08', name: 'Security',        colour: '#ad9978' },
    { nn: '09', name: 'Network',         colour: '#b7b1a7' },
    { nn: '10', name: 'Infrastructure',  colour: '#302f2e' }
  ];

  // ---- serviceStrip --------------------------------------------------------
  function serviceStrip(services, opts) {
    const h = _h();
    const list = (Array.isArray(services) && services.length) ? services.slice(0, 10) : DEFAULT_SERVICES;
    const wrapClass = (opts && opts.wrapClass) || 'service-strip';
    const dotClass  = (opts && opts.dotClass) || '';
    const inner = list.map(s => {
      const colour = h.esc(s.colour || '#999');
      const title  = h.esc(`${s.nn || ''} ${s.name || ''}`).trim();
      return `<span class="${dotClass}" style="background:${colour}" title="${title}"></span>`;
    }).join('');
    return `<span class="${wrapClass}">${inner}</span>`;
  }

  // ---- statusPill ----------------------------------------------------------
  function statusPill(status, opts) {
    const h = _h();
    const upper = String(status || 'DRAFT').toUpperCase();
    const fill = h.statusColour(upper);
    const ink  = h.statusInkOn(fill);
    const cls  = (opts && opts.className) || 'status-pill';
    // data-status drives CSS variant when stylesheet is the source of truth;
    // inline style is a hard fallback so the pill renders correctly even if
    // the CSS file fails to load.
    return `<span class="${cls}" data-status="${h.esc(upper)}" style="background:${fill};color:${ink}">${h.esc(upper)}</span>`;
  }

  // ---- infoCell + infoGrid -------------------------------------------------
  function infoCell(caption, value, opts) {
    const h = _h();
    if (opts && opts.pill) {
      return `
        <div class="info-cell">
          <div class="info-cap">${h.esc(caption)}</div>
          ${statusPill(value, { className: 'status-pill' })}
        </div>
      `;
    }
    return `
      <div class="info-cell">
        <div class="info-cap">${h.esc(caption)}</div>
        <div class="info-val">${h.esc(value == null ? '—' : value)}</div>
      </div>
    `;
  }

  function infoGrid(cells) {
    return `<div class="info-grid">${(cells || []).join('')}</div>`;
  }

  // ---- floorsTable ---------------------------------------------------------
  function floorsTable(floors) {
    const h = _h();
    if (!Array.isArray(floors) || !floors.length) return '';
    const rows = floors.map(f => {
      // v5.78.0 (module v1.6.0) — Area/Perimeter columns dropped from all
      // pdf outputs (Bryn directive: "we don't really need that info").
      return `<tr>
        <td class="fl-name">${h.esc(f.name || f.code || '—')}</td>
        <td class="fl-rooms">${h.esc(String(f.rooms == null ? '—' : f.rooms))}</td>
        <td class="fl-syms">${h.esc(String(f.symbols == null ? '—' : f.symbols))}</td>
      </tr>`;
    }).join('');
    return `
      <section class="floors-panel">
        <header class="panel-head">FLOORS</header>
        <table class="floors-table">
          <thead><tr>
            <th class="fl-name">Floor</th>
            <th class="fl-rooms">Rooms</th>
            <th class="fl-syms">Blocks</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }

  // ---- totalsPanel ---------------------------------------------------------
  // v1.7.0 (2026-05-08) — accepts `totals._skipNull` to suppress rows where
  // the value is missing (vs the default which renders '—'). Used by Cinema
  // Design's cover so the Takeoffs-shaped fields (Floors / Blocks / Cable /
  // LED / Shades) don't pollute the cinema totals panel with em-dashes.
  // Pre-v1.7.0 the panel always rendered all 8 rows. Default behaviour
  // unchanged for existing consumers — only opt-in.
  function totalsPanel(totals) {
    const h = _h();
    if (!totals) return '';
    const skipNull = !!totals._skipNull;
    const fmt = (v, suffix) => (typeof v === 'number') ? (v.toFixed(2) + (suffix || '')) : (v != null ? String(v) : '—');
    const rows = [
      ['Floors',     totals.floors,           totals.floors  != null ? totals.floors  : '—'],
      ['Rooms',      totals.rooms,            totals.rooms   != null ? totals.rooms   : '—'],
      ['Blocks',     totals.blocks,           totals.blocks  != null ? totals.blocks  : '—'],
      // v5.78.0 — Area/Perimeter dropped from pdf outputs
      ['Cable',      totals.cableM,           fmt(totals.cableM, ' m')],
      ['LED',        totals.ledM,             fmt(totals.ledM, ' m')],
      ['Shades',     totals.shades,           totals.shades  != null ? totals.shades  : '—']
    ];
    const filtered = skipNull ? rows.filter(([_, raw]) => raw != null) : rows;
    return `
      <section class="totals-panel">
        <header class="panel-head">PROJECT TOTALS</header>
        <dl class="totals-list">
          ${filtered.map(([k, _, v]) => `<dt>${h.esc(k)}</dt><dd>${h.esc(String(v))}</dd>`).join('')}
        </dl>
      </section>
    `;
  }

  // ---- revisionTimeline ----------------------------------------------------
  function revisionTimeline(history, latestCode, latestStatus) {
    const h = _h();
    if (!Array.isArray(history) || history.length < 2) return '';
    const cap = Math.min(history.length, 8);
    const showRows = history.length > cap
      ? [history[0], { code: '…', label: '(' + (history.length - cap) + ' more)', date: '' }, ...history.slice(-(cap - 2))]
      : history;
    const accentForLatest = h.statusColour(latestStatus);
    const dotsHtml = showRows.map(r => {
      if (r.code === '…') {
        return `<div class="rev-dot rev-dot-ellipsis"><span class="rev-ellipsis">…</span></div>`;
      }
      const isLatest = (r.code === latestCode);
      const dotFill = isLatest ? accentForLatest : LABEL;
      const dateShort = (r.date || '').slice(0, 5);
      const abBadge = r.as_built && !isLatest ? `<span class="rev-ab-badge">AB</span>` : '';
      return `
        <div class="rev-dot ${isLatest ? 'rev-dot-latest' : ''}">
          <span class="rev-date">${h.esc(dateShort)}</span>
          <span class="rev-mark" style="background:${dotFill}">${abBadge}</span>
          <span class="rev-code">${h.esc(r.code)}</span>
        </div>
      `;
    }).join('');
    return `
      <section class="rev-timeline">
        <div class="rev-caption">REVISIONS</div>
        <div class="rev-track">
          <div class="rev-line"></div>
          <div class="rev-dots">${dotsHtml}</div>
        </div>
      </section>
    `;
  }

  // ---- pageHeader / pageFooter (shared chrome for non-cover pages) -------
  // Every non-cover page wraps the same header strip + 5-col footer. Cover
  // page uses its own bigger hero, so it doesn't call these. Section
  // dividers also have their own variant.
  function pageHeader(opts) {
    const h = _h();
    const o = opts || {};
    const accent = h.esc(o.accentHex || GOLD);   // §41 gold, never purple chrome
    // v1.4.0 — optional subtitle renders muted below the section name on
    // the same strip.
    const subtitleHtml = o.subtitle
      ? `<span class="page-header-sep">·</span><span class="page-header-subtitle">${h.esc(o.subtitle)}</span>`
      : '';
    // v5.4.71 — Status pill relocated to footer STATUS row.
    // v5.4.73 — Bryn directive 2026-05-10: "remove the reference from
    // header top right". Reference duplicates the footer's REF row; the
    // header right side now carries the issue date only (cleaner read,
    // matches Caldy reference). Date format dd/mm/yyyy stable across
    // locales. Reference still rendered if explicitly opted-in via
    // `o.showReferenceInHeader === true`, but defaults off.
    // Accept either `date` or `issueDate` — orchestrator uses issueDate
     // throughout (per existing convention); date is the friendly alias.
    // v5.4.75 — Optional `headerBadge` opt for a per-schedule metric
    // (e.g. "Total cables: 88" on the Cable Estimate, matching the
    // Gallops reference). Shape: { label, value, accent? }. Sits
    // before the date on the right side. Suppressed when missing.
    // v5.47.0 (Bryn 2026-07-06): header date REMOVED from all PDF exports —
    // the date lives in the footer title-block / slim strip. const retired.
    // const dateText = h.esc(o.date || o.issueDate || '');
    const refText = (o.showReferenceInHeader === true && o.reference)
      ? `<span class="page-header-sep">·</span><span class="page-header-ref">${h.esc(o.reference)}</span>`
      : '';
    const badgeText = (o.headerBadge && o.headerBadge.value != null)
      ? `<span class="page-header-badge"><span class="page-header-badge-label">${h.esc(o.headerBadge.label || '')}</span><span class="page-header-badge-value">${h.esc(String(o.headerBadge.value))}</span></span>`
      : '';
    return `
      <header class="page-header" style="--accent: ${accent}">
        <div class="page-header-left">
          <span class="page-header-app">${h.esc((o.appName || 'TAKEOFFS').toUpperCase())}</span>
          <span class="page-header-sep">·</span>
          <span class="page-header-section">${h.esc((o.sectionTitle || '').toUpperCase())}</span>
          ${subtitleHtml}
        </div>
        <div class="page-header-right">
          ${badgeText}
          ${refText}
        </div>
        <div class="page-header-accent" style="background:${accent}"></div>
      </header>
    `;
  }

  function pageFooter(opts) {
    const h = _h();
    const o = opts || {};
    // v5.4.61 — prefer the WHITE wordmark variant on dark chrome
    // (footer / hero / divider). Falls back to the dark variant + CSS
    // invert filter when the white asset isn't loaded. Inline data URL
    // already loaded via data/sonor-pdf-wordmark.js.
    const wordmarkUrl = (typeof window !== 'undefined' &&
      (window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__)) || '';
    const wordmarkClass = (typeof window !== 'undefined' && window.__SONOR_WORDMARK_PDF_WHITE__)
      ? 'footer-wordmark'
      : 'footer-wordmark footer-wordmark-white';
    const services = (Array.isArray(o.services) && o.services.length) ? o.services : null;
    // v5.4.59 — "PAGE" caption stays, value drops the "Page" prefix.
    // v5.4.71 — Bryn directive 2026-05-10: "make the text 'page' and
    // 'of' in the charcoal bar non bold, keep the numbers bold". Build
    // the page-num HTML with explicit <b> wrappers around the digits.
    let pageNumValue = '';
    let pageNumHtml  = '';
    if (o.pageNum != null) {
      const num = String(o.pageNum);
      const tot = o.pageTotal ? String(o.pageTotal) : '';
      pageNumValue = num + (tot ? ' of ' + tot : '');
      pageNumHtml  =
        '<span class="page-cap-page">PAGE</span>' +
        ' <b>' + h.esc(num) + '</b>' +
        (tot ? ' <span class="page-cap-page">of</span> <b>' + h.esc(tot) + '</b>' : '');
    }

    // v5.4.69 — Bryn directive 2026-05-10: "use same charcoal bar
    // throughout, including info pages and cover". Slim variant
    // dropped — `o.slim` is now ignored; every consumer (info pages
    // included) gets the full charcoal title block.
    //
    // Revisions counts come from meta (v5.4.59).
    const revAdded   = (o.revAdded   != null) ? o.revAdded   : 0;
    const revMoved   = (o.revMoved   != null) ? o.revMoved   : 0;
    const revRemoved = (o.revRemoved != null) ? o.revRemoved : 0;
    const revRfi     = (o.revRfi     != null) ? o.revRfi     : 0;   // 2026-07-12 — purple RFI clouds
    const revNote    = (o.revNote    != null) ? o.revNote    : 0;   // v5.172.0 — charcoal Note clouds

    // v5.25.0 — FULL TITLE-BLOCK FOOTER ONCE PER DOCUMENT (Bryn 2026-06-14
    // "we dont need the whole title footer on every page, just the page
    // numbering, keep it for the first page"). A document-level latch renders
    // the heavy 5-col title-block on the FIRST footer-bearing page only; every
    // subsequent page gets the slim page-number strip. The latch resets when a
    // page numbered 1 is seen (standalone single/first page) and is reset
    // explicitly at the start of fullDocument()/fullDocumentPdfLib() (the deck
    // cover has no footer, so the first INFO page is the first full footer).
    // `footerForceFull` overrides the latch (e.g. one-page exports that must
    // always carry the title-block); `footerSlim` forces slim.
    if (o.pageNum === 1 && typeof window !== 'undefined') {
      try { window.__SONOR_PDF_FOOTER_LATCH__ = false; } catch (_) {}
    }
    const forceFull = (o.footerForceFull === true);
    // v5.168.0 (Bryn: "combined plans still has the old footer make it
    // consistent") — the v5.25.0 once-per-doc latch put the heavy 5-col
    // title-block on the FIRST footer-bearing page; with Info & standards
    // unticked that page is the first COMBINED PLAN (Bryn's export). The
    // latch is RETIRED: every full-document page takes the slim strip —
    // project identity lives on the cover. Standalone one-page exports keep
    // the title-block via footerForceFull (unchanged).
    let useSlim = !forceFull;
    if (useSlim) {
      // Slim strip (reuses the .page-footer-slim left/mid/right layout):
      // project · ref (left, sheet identity) · PAGE x of y (centre) · issue
      // date (right). No heavy 5-col title-block.
      const refBit = o.reference ? ' · ' + h.esc(o.reference) : '';
      return `
      <footer class="page-footer page-footer-slim">
        <span class="page-footer-slim-left">${h.esc(o.projectName || '')}${refBit}</span>
        <span class="page-footer-slim-mid">${pageNumHtml}</span>
        <span class="page-footer-slim-right">${o.revision ? `<span class="page-cap-page">REV</span> <b>${h.esc(String(o.revision))}</b><span class="page-footer-slim-sep">·</span>` : ''}${h.esc(o.issueDate || '')}</span>
      </footer>
    `;
    }
    // v5.4.69 — Bryn directive 2026-05-10: "put the dots back on the
    // logo in footer". Service-colour dot strip restored beneath the
    // wordmark in the brand col.
    return `
      <footer class="page-footer">
        <div class="page-footer-grid">
          <div class="page-footer-col page-footer-brand">
            ${wordmarkUrl ? `<img class="${wordmarkClass}" src="${wordmarkUrl}" alt="SONOR">` : '<span class="page-footer-mark">SONOR</span>'}
            ${serviceStrip(services, { wrapClass: 'footer-svc-strip footer-svc-strip-wide' })}
          </div>
          <div class="page-footer-col page-footer-project">
            <div class="page-footer-cap">PROJECT</div>
            <div class="page-footer-val">${h.esc(o.projectName || '—')}</div>
            <div class="page-footer-sub">${h.esc(o.client || '')}</div>
            <div class="page-footer-sub">${h.esc(o.address || '')}</div>
          </div>
          <div class="page-footer-col page-footer-meta">
            <div class="page-footer-row"><span class="page-footer-cap">REF</span><span class="page-footer-val">${h.esc(o.reference || '—')}</span></div>
            <div class="page-footer-row"><span class="page-footer-cap">REV</span><span class="page-footer-val">${h.esc(o.revision || 'A0')}</span></div>
            <div class="page-footer-row"><span class="page-footer-cap">DATE</span><span class="page-footer-val">${h.esc(o.issueDate || '—')}</span></div>
            <div class="page-footer-row page-footer-row-status"><span class="page-footer-cap">STATUS</span>${statusPill((o.status || 'DRAFT').toUpperCase(), { className: 'status-pill page-footer-status-pill' })}</div>
          </div>
          <div class="page-footer-col page-footer-disclaimer">
            <div class="page-footer-cap">QUANTITIES TBC</div>
            <div class="page-footer-disclaimer-body">All quantities are illustrative pre-build estimates derived from a calibrated take-off. Final figures reconciled at As-Built.</div>
          </div>
          <div class="page-footer-col page-footer-revisions">
            <div class="page-footer-cap">REVISIONS</div>
            ${revPillsPanel(o.revCounts || { added: revAdded, changed: revMoved, removed: revRemoved, rfi: revRfi, note: revNote })}
          </div>
        </div>
        <div class="page-footer-contactline">
          <span class="page-footer-contactline-side page-footer-contactline-left">projects@sonor.co.uk · 07933 684 000</span>
          <span class="page-footer-contactline-mid">${pageNumHtml}</span>
          <span class="page-footer-contactline-side"></span>
        </div>
      </footer>
    `;
  }

  // ---- scheduleTable -------------------------------------------------------
  // Renders a schedule's data table with optional group separators + total row.
  // headers: [{key, label, align?: 'left'|'right'|'center', width?: 'XXpx'|'XX%'}]
  // rows:    [{values: ['Cell1', 'Cell2', ...], group?: false}]   — values length matches headers
  //          or [{group: true, label: 'GROUP NAME', accent?: '#hex'}]  — full-width separator row
  // total:   {label, values: [...]}                                — bold total row at bottom
  function scheduleTable(opts) {
    const h = _h();
    const o = opts || {};
    // v1.11.0 — tickCols: column indices that render an empty tick box on
    // data rows (Takeoffs v5.50.0 Pulled/Checked site-marking columns).
    const tickCols = Array.isArray(o.tickCols) ? o.tickCols : null;
    const headers = Array.isArray(o.headers) ? o.headers : [];
    const rows = Array.isArray(o.rows) ? o.rows : [];
    const total = o.total || null;
    const colCount = headers.length;
    const colgroupHtml = headers.map(c => {
      const w = c.width ? ` style="width:${h.esc(c.width)}"` : '';
      return `<col${w}>`;
    }).join('');
    const headHtml = headers.map(c => {
      const align = c.align ? ` style="text-align:${h.esc(c.align)}"` : '';
      return `<th${align}>${h.esc(c.label || c.key || '')}</th>`;
    }).join('');
    const bodyHtml = rows.map((r, i) => {
      // v1.7.4 — group-divider row supports two shapes:
      //   (a) { group: true, label: 'X', accent? }  — Takeoffs convention
      //   (b) { _group: 'X', accent? }              — Cinema Design convention
      // v5.4.75 — `kind: 'sub'` flag styles the row as a lighter
      // secondary banner (used for Floor → Room nesting on the Cable
      // Estimate). Default banner styling unchanged.
      const groupLabel = (r && r.group === true) ? r.label
                       : (r && typeof r._group === 'string') ? r._group
                       : null;
      if (groupLabel != null) {
        const accent = r && r.accent ? ` style="border-left-color:${h.esc(r.accent)}"` : '';
        const subClass = (r && r.kind === 'sub') ? ' sch-group-sub' : '';
        return `<tr class="sch-group${subClass}"${accent}><td colspan="${colCount}">${h.esc(groupLabel)}</td></tr>`;
      }
      // v5.4.76 — Sub-rows render as data rows but with a lighter visual
      // treatment (italic muted text, soft alt-band) so they read as
      // nested under the preceding parent row. Used by Blocks Schedule
      // to expand LC Estimate mix breakdowns ("↳ Mix · Est. Switched ×1"
      // etc.). `total: true` sub-rows get a heavier weight for the
      // terminal "↳ Total 6 lc" line.
      // v1.14.0 — per-floor total row ({ floorTotal: true, values }) — bold slate band, numeric sums per column
      if (r && !Array.isArray(r) && r.floorTotal === true) {
        const cells = headers.map((col, ci) => {
          const v = (Array.isArray(r.values) && r.values[ci] != null) ? r.values[ci] : '';
          const align = col.align ? ` style="text-align:${h.esc(col.align)}"` : '';
          return `<td${align}>${h.esc(String(v))}</td>`;
        }).join('');
        return `<tr class="sch-floor-total">${cells}</tr>`;
      }
      const isSubRow = !!(r && r.subRow);
      const isSubTotal = isSubRow && !!r.total;
      const stripe = isSubRow ? '' : ((i % 2) === 1 ? ' sch-row-alt' : '');
      const subRowClass = isSubRow ? (isSubTotal ? ' sch-row-sub sch-row-sub-total' : ' sch-row-sub') : '';
      // v1.10.0 — paired-slave indent (Takeoffs cable schedule v5.49.0):
      // rows flagged {indent:true} get .sch-row-pair — CSS pads the first
      // cell so the slave's symbol sits visibly under its master.
      const indentClass = (!isSubRow && r && !Array.isArray(r) && r.indent) ? ' sch-row-pair' : '';
      // v5.5.13 — Device-start detection. When `o.deviceStartCol` is set
      // (typically 0 — the Aspect cell on Cable Schedule), a data row
      // whose value at that column is non-empty marks the start of a
      // new placement. v5.5.9 already blanks Aspect cells on continuation
      // member-rows, so this directly correlates with "leader row of a
      // device". CSS class `.sch-row-device-start` adds a top-stripe +
      // padding to visually separate placements. Skip on sub-rows
      // (mix expansion etc.) — those aren't device boundaries.
      let deviceStartClass = '';
      if (!isSubRow && typeof o.deviceStartCol === 'number' && r && Array.isArray(r.values)) {
        const probe = r.values[o.deviceStartCol];
        if (probe != null && String(probe).trim() !== '') {
          deviceStartClass = ' sch-row-device-start';
        }
      }
      // v1.7.4 — cell value lookup: prefer row.values[ci] array (Takeoffs
      // convention), fall back to row[col.key] (Cinema Design convention).
      // Pre-v1.7.4 the object form silently rendered empty cells across
      // every CD schedule page (TOC, intro, room, audio-approach, video,
      // seating). Bryn directive 2026-05-10: 'lots of text content
      // missing from various pages'.
      const cells = headers.map((col, ci) => {
        let v;
        if (r && Array.isArray(r.values)) {
          v = r.values[ci];
        } else if (r && col && col.key && Object.prototype.hasOwnProperty.call(r, col.key)) {
          v = r[col.key];
        } else {
          v = '';
        }
        const align = col.align ? ` style="text-align:${h.esc(col.align)}"` : '';
        // v1.9.0 (2026-05-11) — Symbol-cell render for a configured column.
        // When `o.symbolCol` matches this col index AND `r.symbolHTML` is
        // a non-empty string, render the cell with the raw SVG markup
        // (escape bypassed — caller controls the HTML). Rows without
        // `symbolHTML` (e.g. continuation member-rows of a placement)
        // fall through to text rendering with the escaped value, so
        // engineers still see something if the data is malformed.
        // Bryn directive 2026-05-11: "actual block symbol as it is on
        // plans shown in the first column · as the device icon".
        if (typeof o.symbolCol === 'number' && o.symbolCol === ci
            && r && typeof r.symbolHTML === 'string' && r.symbolHTML.trim() !== '') {
          // v1.12.0 — nested rows (pair slaves etc.) carry a ↳ return-arrow
          // before the symbol (Bryn: "use a sort of upside down return
          // symbol arrow at start of the nested line").
          const nest = (!Array.isArray(r) && r.indent) ? '<span class="sch-nest-arrow">↳</span>' : '';
          return `<td${align} class="sch-cell-symbol">${nest}${r.symbolHTML}</td>`;
        }
        // v1.12.0 — nested rows without a symbol still get the ↳ marker on
        // the first column.
        if (ci === 0 && r && !Array.isArray(r) && r.indent) {
          return `<td${align}><span class="sch-nest-arrow">↳</span>${h.esc(v == null ? '' : String(v))}</td>`;
        }
        // v1.11.0 — tick-box cells (empty square for on-site marking). Only
        // on data rows; a non-empty value falls through to text so callers
        // can pre-fill ("✓" / "n/a") if they ever need to.
        if (tickCols && tickCols.indexOf(ci) !== -1
            && (v == null || String(v).trim() === '')) {
          return `<td${align} class="sch-cell-tick"><span class="sch-tick-box"></span></td>`;
        }
        // v5.4.75 — Colour-pill render for a configured column (e.g.
        // Aspect column on the Cable Estimate). When `o.colourPillCol`
        // matches this col index AND `o.colourPillMap[value]` resolves
        // to a hex, render the cell as a tinted pill instead of plain
        // text. Unknown values fall back to plain text. Empty/null
        // values render blank.
        // v1.9.1 (2026-05-11) — The v1.9.0 "symbol path wins over pill"
        // guard was overzealous: rows missing symbolHTML (e.g. library
        // row not found for an exotic block_code) used to fall all the
        // way through to plain text, losing the pill colour entirely.
        // Now symbol path + pill path can co-exist on the same column —
        // symbol-path returns early when symbolHTML is present, so the
        // pill only ever runs as the fallback for missing-icon rows.
        // Empty continuation rows (value === '') still render blank
        // because the trim check below filters them out.
        if (typeof o.colourPillCol === 'number' && o.colourPillCol === ci
            && v != null && String(v).trim() !== '') {
          const key = String(v).trim().toUpperCase();
          const hex = (o.colourPillMap && (o.colourPillMap[key] || o.colourPillMap[String(v).trim()]))
            || null;
          if (hex) {
            return `<td${align}><span class="sch-cell-pill" style="background:${h.esc(hex)}">${h.esc(String(v))}</span></td>`;
          }
        }
        // v5.200.3 — TEXT-COLOUR rules: `o.textColourRules = [{ col, re, hex }]` paints a matching cell's
        // text (e.g. Origin "GF LKP RING" in orange — keypad ring, not a home run). Plain text otherwise.
        if (Array.isArray(o.textColourRules) && v != null && String(v).trim() !== '') {
          const _rule = o.textColourRules.find(rl => rl && rl.col === ci && rl.re && rl.re.test(String(v).trim()));
          if (_rule && _rule.hex) {
            return `<td${align} style="color:${h.esc(_rule.hex)};font-weight:600">${h.esc(String(v))}</td>`;
          }
        }
        // v5.5.9 — Colour-dot render for a configured column (e.g. Colour
        // column on the Cable Schedule). When `o.colourDotCol` matches
        // this col index AND `o.colourDotMap[value]` resolves to a hex,
        // prepend a small filled circle to the text. Bryn 2026-05-11:
        // "the colour have the dot of the colour from the library as
        // well as the text description". Unknown colour names render
        // plain text. Empty/null cells render blank as usual.
        if (typeof o.colourDotCol === 'number' && o.colourDotCol === ci
            && v != null && String(v).trim() !== '') {
          const raw = String(v).trim();
          // v5.102.0 (Bryn: "dont think cable bulk and schedule use the exact
          // library colours still") — TOLERANT lookup: exact (case-insensitive)
          // → separator-normalised (hyphen⇄space, e.g. 'foil shielded' hits
          // 'foil-shielded') → first token of a compound value ('white/green',
          // 'white, green'). Unknown names still render plain text.
          const map = o.colourDotMap || {};
          const _hit = (k) => (k && (map[k] || map[String(k).toLowerCase()])) || null;
          const key = raw.toLowerCase();
          // v5.102.1 — the reports module's canonical resolver knows sleeve
          // CODES (C6-GRN) and compounds; prefer it when loaded.
          let hex = (typeof window !== 'undefined' && typeof window._sonorCableColourHex === 'function'
              ? window._sonorCableColourHex(raw) : null)
            || _hit(raw) || _hit(key)
            || _hit(key.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim())
            || _hit(key.replace(/\s+/g, '-'))
            || _hit(key.split(/[\/,+]/)[0].trim());
          if (hex) {
            return `<td${align}><span class="sch-colour-dot" style="background:${h.esc(hex)}"></span>${h.esc(raw)}</td>`;
          }
        }
        // v5.102.0 (Bryn: "all electrical notes everywhere should be in the
        // 11 service colour red") — any schedule cell carrying an electrical
        // trade note renders in service-11 red (#e63946), bold.
        if (v != null && /BY ELECTRICAL|FUSED SPUR/i.test(String(v))) {
          return `<td${align} class="sch-cell-electrical">${h.esc(String(v))}</td>`;
        }
        return `<td${align}>${h.esc(v == null ? '' : String(v))}</td>`;
      }).join('');
      return `<tr class="sch-row${stripe}${subRowClass}${deviceStartClass}${indentClass}">${cells}</tr>`;
    }).join('');
    const totalHtml = total ? (() => {
      const cells = headers.map((col, ci) => {
        const v = (total.values && total.values[ci] != null) ? total.values[ci] : '';
        const align = col.align ? ` style="text-align:${h.esc(col.align)}"` : '';
        const isLabelCol = ci === 0 && total.label;
        let content = isLabelCol ? h.esc(total.label) : h.esc(String(v));
        // v1.3.0 — strip stray 'TOTAL' / 'TOTALS' word from non-label cells.
        // Native paintTable repeats 'TOTAL' in multiple cells of wide tables
        // for visual emphasis, but in the HTML render that reads as duplicate
        // text in random columns. The label column already shows TOTAL.
        if (!isLabelCol && /^TOTALS?$/i.test(String(v).trim())) content = '';
        return `<td${align}>${content}</td>`;
      }).join('');
      return `<tr class="sch-total">${cells}</tr>`;
    })() : '';
    return `
      <table class="schedule-table">
        <colgroup>${colgroupHtml}</colgroup>
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}${totalHtml}</tbody>
      </table>
    `;
  }

  // ---- summaryChip ---------------------------------------------------------
  // Top-right summary chip on schedule pages — total + per-type tally.
  // chips: [{label, value, accent?}]   — per-type pills
  // headline: {label, value}            — bigger top line (e.g. "Total: 124")
  function summaryChip(opts) {
    const h = _h();
    const o = opts || {};
    const headline = o.headline || null;
    const chips = Array.isArray(o.chips) ? o.chips : [];
    // v1.2.0 — return empty string when there's nothing to render so the
    // template's container row collapses cleanly instead of leaving an
    // empty chip box on schedules with no summary data.
    if (!headline && !chips.length) return '';
    const headlineHtml = headline ? `
      <div class="sum-chip-headline">
        <span class="sum-chip-headline-label">${h.esc(headline.label || '')}</span>
        <span class="sum-chip-headline-value">${h.esc(String(headline.value == null ? '—' : headline.value))}</span>
      </div>
    ` : '';
    const chipsHtml = chips.length ? `
      <div class="sum-chip-pills">
        ${chips.map(c => {
          const accent = c.accent ? ` style="--chip-accent:${h.esc(c.accent)}"` : '';
          return `<span class="sum-chip-pill"${accent}>
            <span class="sum-chip-pill-label">${h.esc(c.label || '')}</span>
            <span class="sum-chip-pill-value">${h.esc(String(c.value == null ? '—' : c.value))}</span>
          </span>`;
        }).join('')}
      </div>
    ` : '';
    return `
      <aside class="summary-chip">
        ${headlineHtml}
        ${chipsHtml}
      </aside>
    `;
  }

  // ---- Plan-page sidebar panels ------------------------------------------
  // Three panels appear in the right sidebar of every plan page (Combined
  // Plans, CCTV, Electrical, per-service slices):
  //   • drawingKey      — mounting symbols + cable type swatches + ID format
  //   • legendPanel     — service-grouped placement breakdown (qty per block)
  //   • floorTotalsPanel — rooms / blocks / area / perim / cable / led / shades

  // Mounting glyphs are drawn as inline SVG so they reproduce crisply at any
  // print scale (no font rendering artefacts).
  const _MOUNT_TYPES = [
    { glyph: '<svg viewBox="0 0 14 14" width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="' + INK + '" stroke-width="1.5"/></svg>', label: 'Ceiling-mounted' },
    { glyph: '<svg viewBox="0 0 14 14" width="14" height="14"><rect x="2" y="2" width="10" height="10" fill="none" stroke="' + INK + '" stroke-width="1.5"/></svg>', label: 'Wall-mounted' },
    { glyph: '<svg viewBox="0 0 14 14" width="14" height="14"><rect x="3" y="3" width="8" height="8" fill="none" stroke="' + INK + '" stroke-width="1.5" transform="rotate(45 7 7)"/></svg>', label: 'Floor-mounted' },
    { glyph: '<svg viewBox="0 0 14 14" width="14" height="14"><rect x="2" y="2" width="10" height="10" fill="none" stroke="' + INK + '" stroke-width="1.5" stroke-dasharray="2 2"/></svg>', label: 'Pre-wire only' }
  ];

  function drawingKey(opts) {
    const h = _h();
    const o = opts || {};
    const cableTypes = Array.isArray(o.cableTypes) && o.cableTypes.length ? o.cableTypes : [
      { code: 'S', colour: '#8058a1', label: 'Speaker' },
      { code: 'V', colour: '#78ba57', label: 'Video' },
      { code: 'D', colour: '#4bb9d3', label: 'Data' },
      { code: 'C', colour: '#e37c59', label: 'Coax' },
      { code: 'K', colour: '#e67eb1', label: 'Control' },
      { code: 'L', colour: '#f5d05c', label: 'Lighting' }
    ];
    const cableHtml = cableTypes.slice(0, 8).map(c => `
      <div class="dk-cable-row">
        <span class="dk-cable-chip" style="background:${h.esc(c.colour || '#999')}">${h.esc(c.code || '')}</span>
        <span class="dk-cable-label">${h.esc(c.label || '')}</span>
      </div>
    `).join('');
    const mountHtml = _MOUNT_TYPES.map(m => `
      <div class="dk-mount-row">
        <span class="dk-mount-glyph">${m.glyph}</span>
        <span class="dk-mount-label">${h.esc(m.label)}</span>
      </div>
    `).join('');
    return `
      <section class="panel-card panel-drawing-key">
        <header class="panel-card-head">DRAWING KEY</header>
        <div class="panel-card-body">
          <div class="dk-section-label">MOUNTING</div>
          <div class="dk-mount-list">${mountHtml}</div>
          <div class="dk-section-label">CABLE TYPES</div>
          <div class="dk-cable-list">${cableHtml}</div>
          <div class="dk-section-label">CABLE ID FORMAT</div>
          <div class="dk-cable-format">${h.esc(o.cableIdFormat || 'AA-S-02')}</div>
          <div class="dk-cable-format-sub">floor · room · type · NN</div>
        </div>
      </section>
    `;
  }

  // v5.4.63 — Inline SVG badge generator that mirrors the on-canvas
  // _symbolBadgeSvg in sonor-takeoffs.html. Same shape switch (square /
  // diamond / pill / hex / triangle / circle), same size + stroke. Used
  // by the legend chip so the PDF legend reads "this is the actual
  // symbol you'll see on the plan" rather than a generic colour square.
  // Bryn directive 2026-05-10: "block legends show same block symbol
  // as the app, rather than generic".
  function _legendBadgeSvg(shape, fill, glyph) {
    const R = 9, cx = 10, cy = 10;
    const key = String(shape || '').toLowerCase().trim();
    const stroke = 'stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"';
    let body = '';
    switch (key) {
      case 'square': case 'wall': case 'box': case 'bracket':
      case 'surface': case 'freestanding':
        body = `<rect x="${cx - R}" y="${cy - R}" width="${R * 2}" height="${R * 2}" fill="${fill}" ${stroke}/>`;
        break;
      case 'diamond': case 'floor':
        body = `<rect x="${cx - R * 0.9}" y="${cy - R * 0.9}" width="${R * 1.8}" height="${R * 1.8}" transform="rotate(45 ${cx} ${cy})" fill="${fill}" ${stroke}/>`;
        break;
      case 'pill': case 'in-line': case 'screen':
        body = `<ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${(R * 0.55).toFixed(2)}" fill="${fill}" ${stroke}/>`;
        break;
      case 'hex': case 'node': case 'ic': case 'terminator': {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          pts.push(`${(cx + R * Math.cos(a)).toFixed(2)},${(cy + R * Math.sin(a)).toFixed(2)}`);
        }
        body = `<polygon points="${pts.join(' ')}" fill="${fill}" ${stroke}/>`;
        break;
      }
      case 'triangle':
        body = `<polygon points="${cx},${cy - R} ${cx + R * 0.9},${cy + R * 0.75} ${cx - R * 0.9},${cy + R * 0.75}" fill="${fill}" ${stroke}/>`;
        break;
      case 'circle': case 'ceiling': case 'spkr': case 'abstract':
      default:
        body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}" ${stroke}/>`;
        break;
    }
    const g = String(glyph || '').slice(0, 3);
    const escG = g.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<svg viewBox="0 0 20 20" width="20" height="20" class="lg-item-svg" aria-hidden="true">${body}` +
      `<text x="${cx}" y="${cy + 0.5}" text-anchor="middle" dominant-baseline="central" ` +
      `font-size="${g.length >= 3 ? 6 : 7.5}" font-weight="800" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${escG}</text></svg>`;
  }

  // legendPanel renders the placements grouped by service NN → sub-service
  // tier. Each row is one of:
  //   { kind: 'group', level: 'service'|'sub', label, accent?, colour? }
  //   { kind: 'item', code, label, qty, accent?, colour?, shape?, short? }
  // Mirrors the v1.34.0 Sonor canonical legend grouping.
  // v5.4.63 — Item rows now render the actual block shape via inline SVG
  // (matches the on-canvas symbol). Falls back to the legacy text chip
  // when shape/short aren't passed.
  function legendPanel(rows) {
    const h = _h();
    if (!Array.isArray(rows) || !rows.length) return '';
    const html = rows.map(r => {
      if (r.kind === 'group' && r.level === 'service') {
        const accent = h.esc(r.accent || r.colour || INK);
        return `<div class="lg-svc"><span class="lg-svc-bar" style="background:${accent}"></span><span class="lg-svc-label">${h.esc(r.label || '')}</span></div>`;
      }
      if (r.kind === 'group' && r.level === 'sub') {
        return `<div class="lg-sub">${h.esc(r.label || '')}</div>`;
      }
      // item row — prefer real shape SVG when we have shape + short
      const accent = h.esc(r.accent || r.colour || '#999');
      const short = r.short || (r.code || '').slice(0, 2);
      let chip;
      if (r.shape) {
        chip = `<span class="lg-item-shape">${_legendBadgeSvg(r.shape, accent, short)}</span>`;
      } else {
        chip = `<span class="lg-item-chip" style="background:${accent}">${h.esc(short.toUpperCase())}</span>`;
      }
      return `<div class="lg-item">
        ${chip}
        <span class="lg-item-label">${(() => {
          // v5.143.0 (Bryn: "bold for the tag, non bold for the descrip")
          const raw = String(r.label || '');
          const i = raw.indexOf(' — ');
          if (i > 0) return '<b>' + h.esc(raw.slice(0, i)) + '</b><span class="lg-item-desc"> — ' + h.esc(raw.slice(i + 3)) + '</span>';
          return '<b>' + h.esc(raw) + '</b>';
        })()}</span>
        <span class="lg-item-qty">×${h.esc(String(r.qty == null ? 1 : r.qty))}</span>
      </div>`;
    }).join('');
    return `
      <section class="panel-card panel-legend">
        <header class="panel-card-head">SUMMARY</header><!-- v5.140.0 — Bryn: "legend can be renamed summary" -->
        <div class="panel-card-body">${html}</div>
      </section>
    `;
  }

  // floorTotalsPanel — flat dl-list of per-floor metrics (drives the
  // right-sidebar "FLOOR TOTALS" panel on plan pages).
  function floorTotalsPanel(totals, opts) {
    const h = _h();
    if (!totals) return '';
    const o = opts || {};
    const fmt = (v, suffix) => (typeof v === 'number') ? (v.toFixed(2) + (suffix || '')) : (v != null ? String(v) : '—');
    const rows = [
      ['Rooms',         totals.rooms != null ? totals.rooms : '—'],
      ['Blocks',        totals.blocks != null ? totals.blocks : '—'],
      // v5.78.0 — Area/Perimeter dropped from pdf outputs
      ['Cable measured', fmt(totals.cableM, ' m')],
      ['LED measured',   fmt(totals.ledM, ' m')],
      ['Shades',         totals.shades != null ? totals.shades : '—']
    ];
    const headLabel = (o.title || 'FLOOR TOTALS').toUpperCase();
    return `
      <section class="panel-card panel-floor-totals">
        <header class="panel-card-head">${h.esc(headLabel)}</header>
        <div class="panel-card-body">
          <dl class="ft-list">
            ${rows.map(([k, v]) => `<dt>${h.esc(k)}</dt><dd>${h.esc(String(v))}</dd>`).join('')}
          </dl>
        </div>
      </section>
    `;
  }

  // legendTotalsPanel (v5.5.77) — cover-RHS aggregate of every block
  // placed across every floor, grouped by service. Shape:
  //   {
  //     totalBlocks: 156,
  //     byService: [ { nn: '01', name: 'Cinema', colour: '#8058a1', qty: 12 }, ... ],
  //     byFloor:   [ { name: 'Ground Floor', blocks: 64 }, ... ]   (optional)
  //   }
  // Replaces the empty `revisionTimeline` slot on the Plans cover so the
  // RHS column carries useful project-scale information at-a-glance.
  // Per Bryn 2026-05-21: "add the legend count total of all floors to
  // the RHS of cover page".
  function legendTotalsPanel(totals) {
    const h = _h();
    if (!totals) return '';
    const totalBlocks = totals.totalBlocks != null ? totals.totalBlocks : 0;
    const byService = Array.isArray(totals.byService) ? totals.byService.filter(s => s && s.qty > 0) : [];
    const byFloor   = Array.isArray(totals.byFloor)   ? totals.byFloor.filter(f => f && f.blocks > 0) : [];
    const svcRows = byService.map(s => `
      <div class="lt-row">
        <span class="lt-row-bar" style="background:${h.esc(s.colour || '#999')}"></span>
        <span class="lt-row-nn">${h.esc(s.nn || '')}</span>
        <span class="lt-row-name">${h.esc(s.name || '')}</span>
        <span class="lt-row-qty">${h.esc(String(s.qty))}</span>
      </div>
    `).join('');
    const floorRows = byFloor.length ? byFloor.map(f => `
      <div class="lt-floor-row">
        <span class="lt-floor-name">${h.esc(f.name || '—')}</span>
        <span class="lt-floor-qty">${h.esc(String(f.blocks))}</span>
      </div>
    `).join('') : '';
    return `
      <section class="legend-totals-panel">
        <header class="panel-head">PROJECT LEGEND TOTALS</header>
        <div class="lt-headline">
          <span class="lt-headline-num">${h.esc(String(totalBlocks))}</span>
          <span class="lt-headline-cap">BLOCKS · ${byFloor.length || 0} FLOOR${byFloor.length === 1 ? '' : 'S'}</span>
        </div>
        ${svcRows ? `<div class="lt-svc-list">${svcRows}</div>` : ''}
        ${floorRows ? `<div class="lt-floor-list"><div class="lt-section-cap">PER FLOOR</div>${floorRows}</div>` : ''}
      </section>
    `;
  }

  // notesPanel — empty pre-formatted notes column for engineer site
  // annotations (matches the right-sidebar 'NOTES' lined panel on
  // CCTV / Electrical / per-service slice plan pages).
  function notesPanel(opts) {
    const o = opts || {};
    const lines = (o.lines && o.lines > 0) ? o.lines : 24;
    const rows = Array.from({ length: lines }, () => '<div class="np-line"></div>').join('');
    return `
      <section class="panel-card panel-notes">
        <header class="panel-card-head">NOTES</header>
        <div class="panel-card-body np-body">${rows}</div>
      </section>
    `;
  }

  // ---- revPillsPanel — REGISTRY-DRIVEN revision-cloud count pills ----------
  // v5.136.0 (Bryn: "this graphic should be displayed on the cover page
  // under the project info and needs to include RFI's and any future cloud
  // types"). One renderer for footer + cover: the four canonical statuses
  // in canonical order, then ANY future status found in the clouds master
  // STATUS registry (styled inline from its registry colour — a new cloud
  // type appears everywhere with zero template edits).
  function revPillsPanel(counts) {
    const h = _h();
    counts = counts || {};
    const KNOWN = [
      { key: 'added',   klass: 'add', glyph: '+', label: 'added' },
      { key: 'changed', klass: 'mov', glyph: '~', label: 'moved' },
      { key: 'removed', klass: 'rem', glyph: '−', label: 'removed' },
      { key: 'rfi',     klass: 'rfi', glyph: '?', label: 'RFI' }
    ];
    const REG = (typeof window !== 'undefined' && window.SonorTakeoffsClouds && window.SonorTakeoffsClouds.STATUS)
      ? window.SonorTakeoffsClouds.STATUS : null;
    const extras = REG ? Object.keys(REG).filter(k => !KNOWN.some(x => x.key === k)) : [];
    const pills = KNOWN
      .map(k => ({ k: k, n: Number(counts[k.key] != null ? counts[k.key] : (k.key === 'changed' ? counts.moved : 0)) || 0 }))
      .concat(extras.map(key => ({
        k: { key: key, klass: null,
             glyph: (REG[key].short || '•'),
             label: String(REG[key].label || key).toLowerCase(),
             colour: REG[key].colour || G500 },
        n: Number(counts[key]) || 0
      })));
    return `<div class="rev-pills">` + pills.map(p => {
      const cls = p.k.klass ? ('rev-pill rev-pill-' + p.k.klass) : 'rev-pill';
      const st = p.k.klass ? '' : ` style="background:${p.k.colour}30;color:${p.k.colour}"`;
      return `<span class="${cls}"${st}><span class="rev-pill-glyph">${h.esc(p.k.glyph)}</span><span class="rev-pill-num">${h.esc(String(p.n))}</span><span class="rev-pill-lbl">${h.esc(p.k.label)}</span></span>`;
    }).join('') + `</div>`;
  }

  // ---- ownerCard (section divider) ----------------------------------------
  function ownerCard(owner) {
    const h = _h();
    if (!owner || !owner.name) return '';
    return `
      <div class="sd-owner-card">
        <div class="sd-owner-cap">OWNED BY</div>
        <div class="sd-owner-name">${h.esc(owner.name)}</div>
        ${owner.body ? `<div class="sd-owner-body">${h.esc(owner.body)}</div>` : ''}
      </div>
    `;
  }

  if (typeof window !== 'undefined') {
    window.SonorPdfHtmlComponents = {
      __version: '1.6.0',
      serviceStrip, statusPill, infoCell, infoGrid,
      floorsTable, totalsPanel, revisionTimeline, ownerCard, revPillsPanel,
      pageHeader, pageFooter, scheduleTable, summaryChip,
      drawingKey, legendPanel, floorTotalsPanel,
      legendTotalsPanel, notesPanel,
      DEFAULT_SERVICES
    };
  }
})();
