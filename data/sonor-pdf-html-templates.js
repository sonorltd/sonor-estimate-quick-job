// =============================================================================
// sonor-pdf-html-templates.js — page-level HTML structure assemblers
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root.
// One responsibility: page-level HTML structure assemblers that compose the
// components from sonor-pdf-html-components.js into complete cover pages
// and section divider pages. No styling decisions — just structure.
//
// Depends on:
//   window.SonorPdfHtmlHelpers     (esc)
//   window.SonorPdfHtmlComponents  (every visual component)
//
// Public API (window.SonorPdfHtmlTemplates):
//   buildCover(opts, css)          — full HTML doc string for the cover page
//   buildSectionDivider(opts, css) — full HTML doc string for a section divider
//
// `css` is the stylesheet text injected into <head><style>...</style></head>.
// The orchestrator (sonor-pdf-html-cover.js) fetches the .css file and passes
// it in. Templates never hardcode CSS.

(function () {
  // 2026-10-16 §41 — chrome inks from sonor-pdf-theme when present
  const _TH = (typeof window !== 'undefined' && window.SonorPdfTheme && window.SonorPdfTheme.HEX) || {};
  const INK = _TH.ink || '#1a1f28', GOLD = _TH.gold || '#ad9978', INK2 = _TH.ink2 || '#302F2E';
  'use strict';

  function _h() { return window.SonorPdfHtmlHelpers || { esc: s => String(s == null ? '' : s) }; }
  function _c() { return window.SonorPdfHtmlComponents || {}; }

  function _wrapDoc(body, css, title, opts) {
    const h = _h();
    const o = opts || {};
    // v1.5.0 — theme attribute on <html>. Cascades into every component
    // that uses var(--theme-*) tokens. Pass pdfTheme:'cinema' on any
    // render call to switch the whole deck to deep purple + cinema accent.
    const themeAttr = o.pdfTheme ? ` data-pdf-theme="${h.esc(o.pdfTheme)}"` : '';
    return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
<meta charset="UTF-8">
<title>${h.esc(title || 'Sonor PDF')}</title>
<style>${css || ''}</style>
</head>
<body>${body}</body>
</html>`;
  }

  // ---- buildCover ----------------------------------------------------------
  function buildCover(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    // v1.6.2 — Bryn directive 2026-05-08: "use the white version of sonor
    // logo in footers and elsewhere so it contrasts properly". The cover
    // footer sits on a chrome-gradient (deep navy → aqua) — the dark
    // wordmark vanished into it. White wordmark for dark surfaces.
    const wordmarkUrl = (typeof window !== 'undefined' &&
      (window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__)) || '';
    const accent = o.accentHex || GOLD;

    // Hero inline-style — accent is the only template-injected style; the
    // backdrop image is also inline because the URL is data-driven. Everything
    // else lives in the CSS file.
    const heroStyle = [`--accent: ${accent}`];
    if (o.backdropImg) {
      heroStyle.push(
        `background-image: linear-gradient(180deg, rgba(9,8,7,0.35) 0%, rgba(9,8,7,0.72) 55%, rgba(9,8,7,0.96) 100%), url('${o.backdropImg}')`   /* v1.16.0 — photo fades to BLACK (§41), not slate */,
        `background-size: cover`,
        `background-position: center`
      );
    }
    const heroStyleAttr = heroStyle.join('; ');

    const services = (Array.isArray(o.services) && o.services.length) ? o.services : null;
    const serviceStripHero  = c.serviceStrip(services, { wrapClass: 'footer-svc-strip' });
    const serviceStripUnder = c.serviceStrip(services, { wrapClass: 'service-strip' });
    const serviceStripFoot  = c.serviceStrip(services, { wrapClass: 'footer-svc-strip' });

    // v5.4.73 — Revision default '00' (numeric scheme — drops "A" prefix
     //  per Bryn directive 2026-05-10 "keep revision naming conventions to
     //  numbers only starting at 00, 01, 02 etc, no letters").
    const infoCells = [
      c.infoCell('Reference',  o.reference || '—'),
      c.infoCell('Status',     (o.status || 'DRAFT').toUpperCase(), { pill: true }),
      c.infoCell('Issue date', o.issueDate || '—'),
      c.infoCell('Revision',   o.revision || '00')
    ];

    // v5.4.69 — Bryn directive 2026-05-10:
    //   "use big logo on the cover and sharpen up the layout of it"
    //   "use same charcoal bar throughout, including info pages and cover"
    // Cover hero gets a HERO-sized white wordmark above the project title
    // (replaces the small "SONOR · Smart Homes" text label at hero-bottom).
    // Cover footer swapped from the bespoke 2-col layout to the standard
    // pageFooter component so the title-block / charcoal contact strip
    // is identical to every other page in the deck.
    //
    // v5.5.76 — Bryn directive 2026-05-21 reversed: "plans is ok, just
    // take the footer off the cover page". The cover is meant to be a
    // standalone hero / front sheet — the title-block footer belongs on
    // deck pages, not the front. Now hidden by DEFAULT. Pass
    // o.showCoverFooter === true to restore (backwards-compat for any
    // caller that wants the original v5.4.69 behaviour).
    const heroLogo = wordmarkUrl
      ? `<img class="hero-logo" src="${wordmarkUrl}" alt="SONOR">`
      : '<span class="hero-logo-fallback">SONOR</span>';

    // Pass through the same opts the pageFooter consumer expects (project,
    // ref, rev, date, page-num, services, revAdded/Moved/Removed). Cover
    // is page 1.
    const coverFooterOpts = Object.assign({}, o, {
      pageNum: 1,
      pageTotal: o.pageTotal || 0,
      // Cover is informational — REVISIONS pills show project totals
      // (counts of revision clouds across the deck). Pulled from opts
      // when the orchestrator passes them through (see fullDocument
      // wiring v5.4.59+).
      revAdded:   o.revAdded   || 0,
      revMoved:   o.revMoved   || 0,
      revRemoved: o.revRemoved || 0,
      revRfi:     o.revRfi     || 0,
    });

    // v5.5.77 — Bryn directive 2026-05-21: "dont need the text or date
    // top right and left". The hero-top strip is now HIDDEN by default —
    // the "TAKEOFFS · PLANS" label and the issue date were already
    // surfaced in the info grid / footer chrome, so the cover hero is
    // cleaner with just the centred logo / eyebrow / project title.
    // Opt-in via o.showHeroTopBar === true to restore (back-compat for
    // any caller that wants the original v5.4.73 behaviour).
    const heroTopHtml = (o.showHeroTopBar === true)
      ? `
    <div class="hero-top">
      <div class="hero-top-left">
        <span>${h.esc((o.appName || '').toUpperCase() + (o.appName ? ' · ' : '') + (o.title || 'TAKE-OFF'))}</span>
      </div>
      <div class="hero-top-right">
        <span>${h.esc(o.issueDate || '')}</span>
      </div>
    </div>`
      : '';

    // v5.5.78 — RHS column renders the FULL itemised legend (same component
    // as on-plan-page sidebars — `legendPanel`) when opts.coverLegend is a
    // non-empty array of legend rows (service-group header → sub-group
    // header → item row × N, qty summed across floors). Bryn directive
    // 2026-05-21 (with screenshot): cover must read like the plan-page
    // legend, not a separate summary card. Falls back to revisionTimeline
    // when no legend rows (e.g. Full Doc cover with rich revision
    // history). If neither is meaningful, the column renders empty
    // (graceful — the body grid keeps a 1.2fr · 1fr split).
    //
    // v5.5.79 — ADAPTIVE DENSITY. Cover body is fixed 416pt — when the
    // legend has many rows (10 services × multiple sub-tiers × N items),
    // the panel would clip the bottom. Pick a density tier based on row
    // count and attach a class — CSS overrides progressively shrink font
    // size + padding so the whole legend fits without scrolling. Bryn
    // directive 2026-05-21 (follow-on): "cover legend needs to be smaller
    // / adaptive so it all fits".
    //
    // v5.5.80 — Bryn follow-on 2026-05-21: "front legend still too big".
    // Halved tier thresholds + dropped base sizes ~3px. Even a tiny legend
    // now reads as a reference catalogue (compact, scannable) rather than
    // a stretched-out poster. Tier-1 now matches the on-plan-page sidebar
    // sizing (9.5px) as its baseline; the other tiers go progressively
    // smaller from there to handle the dense 10-service-spread case.
    let rhsHtml = '';
    if (Array.isArray(o.coverLegend) && o.coverLegend.length && typeof c.legendPanel === 'function') {
      const n = o.coverLegend.length;
      // Density tiers calibrated against the 416pt cover-body height +
      // Bryn's directive to keep the legend tight at all scales.
      let density;
      if      (n <= 12) density = 'dense-1';   // small (~9.5px)
      else if (n <= 22) density = 'dense-2';   // medium (~8px)
      else if (n <= 40) density = 'dense-3';   // compact (~7px)
      else              density = 'dense-4';   // very compact (~6px)
      // v5.25.0 — compact PROJECT TOTALS strip above the block legend so the
      // cover summary carries BOTH the high-level totals and the per-block
      // legend (Bryn 2026-06-14 "more summary info, like legend for total blocks").
      // v5.140.0 (Bryn) — the stat cards moved to column 2 of the LHS
      // revisions row (see .cover-rev-two below); AREA dropped. The RHS is
      // now the SUMMARY panel alone, with the recovered hero height.
      let totalsStrip = '';
      rhsHtml = '<div class="cover-legend-wrap cover-legend-' + density + '" data-legend-rows="' + n + '">' +
                totalsStrip +
                c.legendPanel(o.coverLegend) +
                '</div>';
    }
    if (!rhsHtml) {
      // v5.18.0 — when there's no itemised legend, fill the cover's right
      // half with a PROJECT-AT-A-GLANCE summary (FLOORS + PROJECT TOTALS)
      // so it never reads as an empty half-page. The revision timeline alone
      // is blank for A0 / single-revision projects. Timeline (when it has
      // ≥2 entries) sits beneath the summary.
      const _summaryParts = [];
      const _floorsTbl = (typeof c.floorsTable === 'function') ? c.floorsTable(o.floors) : '';
      const _totalsTbl = (typeof c.totalsPanel === 'function') ? c.totalsPanel(o.totals) : '';
      if (_floorsTbl || _totalsTbl) {
        _summaryParts.push('<div class="cover-summary-card">' + _floorsTbl + _totalsTbl + '</div>');
      }
      const _timelineHtml = c.revisionTimeline(o.revisionHistory, o.revision, o.status) || '';
      rhsHtml = _summaryParts.join('') + _timelineHtml;
    }

    // v1.16.0 (2026-10-16, sonor-platform §41 — Bryn: "cover page and PDF theme should be more inline with what we have
    // elsewhere") — the hero takes the SERVICE CONTRACTS / luxury cover anatomy: dark hero (project cover photo fading to black
    // when one is set), gold inset frame, mark + wordmark top-left, gold hairline + tracked gold eyebrow, left-aligned title,
    // subtitle. The light body below (info grid, revisions, summary / legend) is unchanged. Active whenever sonor-pdf-theme is
    // on the page; o.heroStyle === 'centred' restores the v5.4.69 centred hero.
    const luxuryHero = (typeof window !== 'undefined' && window.SonorPdfTheme && o.heroStyle !== 'centred');
    const heroInner = luxuryHero ? `
    <div class="hero-lux-frame"></div>
    <div class="hero-lux-brand">${wordmarkUrl ? `<img class="hero-lux-logo" src="${wordmarkUrl}" alt="SONOR">` : '<span class="hero-lux-logo-fallback">SONOR</span>'}</div>
    <div class="hero-lux-block">
      <div class="hero-lux-eyebrow"><span class="hero-lux-rule"></span>${h.esc(o.subtitle || 'PROJECT TAKE-OFF')}</div>
      <div class="hero-lux-title">${h.esc(o.projectName || 'Untitled Project')}</div>
      ${o.client ? `<div class="hero-lux-sub">${h.esc(o.client)}${o.address ? ' · ' + h.esc(o.address) : ''}</div>` : (o.address ? `<div class="hero-lux-sub">${h.esc(o.address)}</div>` : '')}
      ${o.extract && o.extract.label ? `<div class="hero-lux-extract"><span class="hero-lux-extract-pill">${h.esc(o.extract.label)}</span><span class="hero-lux-extract-note">${h.esc(o.extract.note || 'Extract — refer to the full take-off export for complete project information.')}</span></div>` : ''}
    </div>` : '';
    const body = `
  <section class="hero hero-cover${luxuryHero ? ' hero-lux' : ''}" style="${heroStyleAttr}">
    ${heroTopHtml}
    ${heroInner}
    <div class="hero-centre hero-centre-cover"${luxuryHero ? ' style="display:none"' : ''}>
      <div class="hero-logo-wrap">${heroLogo}</div>
      <div class="hero-eyebrow">${h.esc(o.subtitle || 'PROJECT TAKE-OFF')}</div>
      <div class="hero-title">${h.esc(o.projectName || 'Untitled Project')}</div>
      <!-- v5.142.0 (Bryn: "accent line is in wrong place (which we dont
           actually need or client name)") — accent line + client REMOVED;
           address dropped too: at the 280px hero it overflowed into the
           SUMMARY panel (the "overlapped text" — harness-reproduced). -->
      <!-- v5.185.0 — EXTRACT BANNER (Bryn: "smaller per aspect exports
           should have the cover page included but only relevant info plus
           a bold note to say which document it is with a sub head to
           explain to refer to full takeoff export for all info").
           o.extract = { label, note } renders a bold document-type banner
           under the project title on standalone per-aspect covers. -->
      ${o.extract && o.extract.label ? `
      <div style="margin-top:14px; display:inline-block; text-align:left;">
        <div style="font-size:21px; font-weight:800; letter-spacing:0.10em; text-transform:uppercase; color:#ffffff; background:${h.esc(accent)}; padding:8px 18px; border-radius:6px; display:inline-block;">${h.esc(o.extract.label)}</div>
        <div style="margin-top:8px; font-size:11.5px; font-weight:600; letter-spacing:0.05em; color:rgba(255,255,255,0.85); text-transform:uppercase;">${h.esc(o.extract.note || 'Extract — refer to the full take-off export for complete project information.')}</div>
      </div>` : ''}
    </div>
    <div class="hero-bottom">
      <!-- v5.5.78 — Bryn directive 2026-05-21: "remove the cedia from front
           cover". The hero-cedia badge is now hidden by DEFAULT. Pass
           o.showHeroCedia === true to restore (back-compat for any caller
           that wants the v5.4.69 badge). When hidden, the version meta
           drops to the right edge alone via justify-content on hero-bottom. -->
      ${o.showHeroCedia === true ? `<div class="hero-cedia">
        <span class="hero-cedia-c">C E D I A</span><span class="hero-cedia-m">MEMBER</span>
      </div>` : '<div class="hero-cedia-spacer"></div>'}
      <!-- v5.143.0 (Bryn: "takeoffs version should only appear on project
           at glance page not cover") — hero-bottom-meta removed. -->
    </div>
  </section>

  <div class="service-strip">${serviceStripUnder.replace(/^<span class="footer-svc-strip">/, '').replace(/<\/span>$/, '')}</div>

  <div class="body cover-body-light" style="--accent: ${accent}">
    <div class="cover-body-col cover-body-col-lhs">
      ${c.infoGrid(infoCells)}
      <!-- v5.136.0 (Bryn: "this graphic should be displayed on the cover
           page under the project info and needs to include RFI's and any
           future cloud types") — registry-driven pill panel on a dark card
           so the footer pill palette reads on the light cover body. -->
      ${typeof c.revPillsPanel === 'function' ? `
      <!-- v5.140.0 (Bryn: "the revs should not be full width make this
           section a 2 column area, and the cards above legend can move
           column 2 here. dont need area") -->
      <div class="cover-rev-two">
        <div class="cover-rev-panel">
          <div class="cover-rev-cap">REVISIONS</div>
          ${c.revPillsPanel(o.revCounts || { added: o.revAdded || 0, changed: o.revMoved || 0, removed: o.revRemoved || 0, rfi: o.revRfi || 0 })}
        </div>
        <div class="cover-stat-cards">
          ${(() => {
            const t = o.totals || {};
            const cards = [];
            if (t.blocks != null) cards.push(['BLOCKS', String(t.blocks)]);
            if (t.rooms  != null) cards.push(['ROOMS',  String(t.rooms)]);
            if (typeof t.cableM === 'number' && t.cableM > 0) cards.push(['CABLE EST', Math.round(t.cableM) + ' m']);
            return cards.map(([k, v]) =>
              '<div class="cover-stat-card"><div class="csc-v">' + h.esc(v) + '</div><div class="csc-k">' + h.esc(k) + '</div></div>').join('');
          })()}
        </div>
      </div>` : ''}
    </div>
    <div class="cover-body-col cover-body-col-rhs">
      ${rhsHtml}
    </div>
  </div>

  ${o.showCoverFooter === true ? c.pageFooter(coverFooterOpts) : ''}
    `;

    return _wrapDoc(body, css, 'Sonor — ' + (o.projectName || 'Cover'), { pdfTheme: o.pdfTheme });
  }

  // ---- buildSchedule -------------------------------------------------------
  // Composes pageHeader + section title + summary chip + schedule table +
  // pageFooter into a complete A3 landscape document.
  // opts shape: {
  //   accentHex, status, sectionTitle, reference, projectName, client, address,
  //   revision, issueDate, pageNum, pageTotal, services,
  //   summary: { headline?: {label,value}, chips?: [{label,value,accent}] },   — per-floor card (top right)
  //   summaryEnd?: same shape — PROJECT TOTAL card after the table (v1.15.0, last page of a floor-grouped schedule)
  //   table:   { headers, rows, total }   — see scheduleTable
  // }
  function buildSchedule(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);

    // v5.4.71 — Bryn directive 2026-05-10: "we don't need the second
    // title and sub title in main body, this is just taking up space".
    // The page-section-head block (eyebrow "SCHEDULE" + big section
    // name + accent line) was redundant with the pageHeader strip
    // above (which already shows "TAKEOFFS · DISPLAYS SCHEDULE"). Body
    // now leads straight into the summary chip + table.
    //
    // v1.8.0 — Optional `auxSvg` opt for inline visual aid above the
    // table (e.g. Materials BOQ visual map showing room plan with
    // hatched treatment zones cross-referenced to row IDs). Caller
    // passes raw SVG markup string. Renders right-aligned alongside
    // the summary chip when present. Bryn improvements list #15.
    const auxBlock = o.auxSvg
      ? `<div class="page-aux-block" style="display:flex;justify-content:flex-end;align-items:flex-start;padding:0 0 12px;">${o.auxSvg}</div>`
      : '';

    const body = `
  <div class="page page-schedule" style="--accent: ${accent}">
    ${c.pageHeader(o)}
    <main class="page-body page-body-schedule">
      ${Array.isArray(o.serviceNotes) && o.serviceNotes.length ? `
      <div class="sched-svcnotes">
        <span class="sched-svcnotes-cap">SERVICE NOTES</span>
        ${o.serviceNotes.map(n => `<span class="sched-svcnote">${h.esc(n.text || '')}${n.floor ? ` <i>${h.esc(n.floor)}</i>` : ''}</span>`).join('')}
      </div>` : ''}
      <div class="page-section-head page-section-head-bare">
        ${c.summaryChip(o.summary || {})}
      </div>
      ${auxBlock}
      <div class="page-table-wrap">
        ${c.scheduleTable(o.table || {})}
      </div>
      ${(o.summaryEnd && (o.summaryEnd.headline || (o.summaryEnd.chips && o.summaryEnd.chips.length)))
        ? `<div class="page-section-foot">${c.summaryChip(o.summaryEnd)}</div>`   /* v1.15.0 — PROJECT TOTAL card after the last floor */
        : ''}
      ${(Array.isArray(o.legend) && o.legend.length && typeof c.legendPanel === 'function')
        ? `<div class="schedule-legend-block">${c.legendPanel(o.legend)}</div>`
        : ''}
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — ' + (o.sectionTitle || 'Schedule'), { pdfTheme: o.pdfTheme });
  }

  // ---- buildPlanPage -------------------------------------------------------
  // Composes pageHeader + main canvas image + sidebar (drawingKey + legend +
  // floorTotals + notes) + pageFooter into a complete A3 landscape document.
  // The canvas snapshot is passed in as opts.canvasDataUrl (a JPEG dataURL
  // produced by Fabric.toDataURL or _snapshotCanvas). The image fills the
  // .page-plan-canvas area; sidebar renders to the right.
  //
  // opts shape: {
  //   accentHex, status, sectionTitle, reference, projectName, client, address,
  //   revision, issueDate, pageNum, pageTotal, services, appName,
  //   floorName,                     — big "GROUND FLOOR" heading inside canvas area
  //   illustrationBanner,            — pink "ALL POSITIONS FOR ILLUSTRATION ONLY" banner
  //   canvasDataUrl,                 — the floor plan bitmap
  //   legend: [...]                  — array of legend rows (see legendPanel)
  //   totals: {...}                  — per-floor totals (see floorTotalsPanel)
  //   totalsTitle?: 'FLOOR TOTALS',  — title override
  //   showNotes?: false,             — engineer-facing pages set this true
  //   cableTypes?: [...],            — drawing key cable types
  //   cableIdFormat?: 'AA-S-02',
  //   subInfo?: '4K Video Distribution Zones · 1) Cinema · GF',
  //   ledColourSpec?: { rows: [{label, dotColour, sub}], title? }
  // }
  function buildPlanPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);

    const ledSpec = o.ledColourSpec || null;
    const ledHtml = ledSpec && Array.isArray(ledSpec.rows) && ledSpec.rows.length ? `
      <div class="plan-led-spec">
        <header class="plan-led-spec-head">${h.esc((ledSpec.title || 'LED COLOUR SPECIFICATION').toUpperCase())}</header>
        <div class="plan-led-spec-body">
          ${ledSpec.rows.map(r => `
            <div class="plan-led-spec-row">
              <span class="plan-led-spec-dot" style="background:${h.esc(r.dotColour || '#999')}"></span>
              <span class="plan-led-spec-label">${h.esc(r.label || '')}</span>
              ${r.sub ? `<span class="plan-led-spec-sub">${h.esc(r.sub)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const subInfoHtml = o.subInfo ? `
      <div class="plan-subinfo-card">${h.esc(o.subInfo)}</div>
    ` : '';

    const sidebarParts = [];
    // v1.3.0: Drawing Key removed from plan-page sidebar by default.
    // Only renders when explicitly enabled (showDrawingKey:true) — the
    // canonical info pages (Cabling Information) carry the drawing key
    // inline as part of their content. Plan pages get Legend + Floor
    // Totals + Notes only, per Sonor canonical.
    if (o.showDrawingKey === true) {
      sidebarParts.push(c.drawingKey({ cableTypes: o.cableTypes, cableIdFormat: o.cableIdFormat }));
    }
    if (Array.isArray(o.legend) && o.legend.length) {
      sidebarParts.push(c.legendPanel(o.legend));
    }
    if (o.totals) {
      sidebarParts.push(c.floorTotalsPanel(o.totals, { title: o.totalsTitle || 'FLOOR TOTALS' }));
    }
    // v5.151.0 (Bryn: "a way to add a note to services... tickboxes of
    // where to display e.g. general page, service plan, service schedule")
    // — notes tagged to this page's service render in their own sidebar
    // panel beneath the totals.
    if (Array.isArray(o.serviceNotes) && o.serviceNotes.length) {
      sidebarParts.push(`
      <section class="panel-card panel-svcnotes">
        <header class="panel-card-head">SERVICE NOTES</header>
        <div class="panel-card-body">
          <ul class="svc-notes-list">
            ${o.serviceNotes.map(n => `<li>${h.esc(n.text || '')}${n.floor ? ` <span class="rev-cloud-room">${h.esc(n.floor)}</span>` : ''}</li>`).join('')}
          </ul>
        </div>
      </section>`);
    }
    // v5.4.71 — Bryn directive 2026-05-10: "On plans, we will have to
    // lose the notes block as there is not enough room for the full
    // legend." Notes panel default flipped OFF — only renders when
    // explicitly opted-in (showNotes === true). Legend + floor totals
    // get the freed sidebar height.
    if (o.showNotes === true) {
      sidebarParts.push(c.notesPanel({ lines: o.notesLines || 14 }));
    }

    const body = `
  <div class="page page-plan" style="--accent: ${accent}">
    ${c.pageHeader(o)}
    <main class="page-body page-body-plan">
      <div class="plan-canvas-area">
        <div class="plan-canvas-frame">
          ${subInfoHtml}
          ${o.illustrationBanner !== false ? (() => {
            // v1.3.0 — when caller passes truthy non-string (e.g. true),
            // render the canonical banner text. Pre-v1.3.0 the boolean
            // got escaped as the literal "TRUE" word.
            const bannerText = (typeof o.illustrationBanner === 'string' && o.illustrationBanner)
              ? o.illustrationBanner
              : 'ALL POSITIONS FOR ILLUSTRATION ONLY · TO BE CONFIRMED ON-SITE';
            return `<div class="plan-illustration-banner">${h.esc(bannerText)}</div>`;
          })() : ''}
          ${(o.floorName && o.showFloorNameWatermark === true) ? `<div class="plan-floor-name">${h.esc(o.floorName.toUpperCase())}</div>` : ''}
          ${o.canvasDataUrl ? `<img class="plan-canvas-img" src="${o.canvasDataUrl}" alt="Floor plan">` : '<div class="plan-canvas-empty">No plan</div>'}
          ${o.watermarkText ? `<div class="plan-watermark">${h.esc(o.watermarkText)}</div>` : ''}
          ${ledHtml}
          ${o.scaleLabel ? `<div class="plan-scale-label">${h.esc(o.scaleLabel)}</div>` : ''}
        </div>
      </div>
      <aside class="plan-sidebar${(() => {
        // v5.198.0 — auto-densify long legends so the last services never clip
        // (Heybridge GF: 44 legend rows → 09.3 / 10 fell off the sidebar).
        const n = Array.isArray(o.legend) ? o.legend.length : 0;
        return n > 42 ? ' plan-legend-dense-2' : (n > 30 ? ' plan-legend-dense-1' : '');
      })()}">
        ${sidebarParts.join('')}
      </aside>
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — ' + (o.sectionTitle || 'Plan'), { pdfTheme: o.pdfTheme });
  }

  // ---- buildContents (v5.146.0) --------------------------------------------
  // THE CONTENTS PAGE IS AN HTML PAGE like every other page in the deck
  // (Bryn: "contents still does not have same header as other pages, fix
  // this once and for all"). Same pageHeader band + slim pageFooter as the
  // body pages. The orchestrator computes the absolute row layout (x/y/w/h
  // from CONTENTS_METRICS) so the SAME rectangles drive this rendering AND
  // the clickable pdf.link overlays added over the embedded image — one
  // geometry, zero drift. Visual row language (accent washes, pips,
  // charcoal dotted leaders + page numbers) is UNCHANGED from the approved
  // painter look — this swaps the chrome, not the design.
  const CONTENTS_METRICS = Object.freeze({
    pageW: 1190, pageH: 842,
    headerH: 47,            // 44 band + 3 accent (mirrors .page-header)
    footerH: 32,            // slim footer strip
    bodyTop: 66, sidePad: 36, colGap: 36,
    rowHTop: 24, rowHChild: 17,
    bottomPad: 14
  });
  function buildContents(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);
    const rows = Array.isArray(o.rows) ? o.rows : [];
    const rowsHtml = rows.map(r => {
      const label = h.esc(r.label || '');
      const page = h.esc(String(r.page || ''));
      const pos = 'position:absolute; left:' + (Number(r.x) || 0) + 'px; top:' + (Number(r.y) || 0)
        + 'px; width:' + (Number(r.w) || 100) + 'px; height:' + (Number(r.h) || 14) + 'px;';
      if (r.depth === 0) {
        return '<div class="toc-row toc-row-top" style="' + pos + ' background:' + h.esc(r.washRgba || 'rgba(71,81,97,0.10)') + ';">'
          + '<span class="toc-bar" style="background:' + h.esc(r.barHex || GOLD) + '"></span>'
          + '<span class="toc-label" style="color:' + h.esc(r.headCss || INK2) + '">' + label + '</span>'
          + '<span class="toc-leader"></span>'
          + '<span class="toc-page">' + page + '</span>'
          + '</div>';
      }
      return '<div class="toc-row toc-row-child" style="' + pos + '">'
        + '<span class="toc-pip" style="background:' + h.esc(r.barHex || GOLD) + '"></span>'
        + '<span class="toc-label">' + label + '</span>'
        + '<span class="toc-leader"></span>'
        + '<span class="toc-page">' + page + '</span>'
        + '</div>';
    }).join('');
    const body = `
  <div class="page page-contents" style="--accent: ${accent}">
    ${c.pageHeader(o)}
    <main class="page-body page-body-contents"></main>
    ${c.pageFooter(o)}
    <div class="toc-abs">
      ${rowsHtml}
      <div class="toc-hint">Sections are clickable</div>
    </div>
  </div>
    `;
    return _wrapDoc(body, css, 'Sonor — Contents', { pdfTheme: o.pdfTheme });
  }

  // ---- buildCablingInfoPage -----------------------------------------------
  // Reference page: 10-service taxonomy, cable ID format, symbol convention,
  // cable types & bend radii (DRAWING KEY), mounting options, install notes,
  // drawing annotations, revision-status clouds, tails protocol, revision
  // history. Each section gets its own 00.X numbered identity per the canonical
  // service-number convention.
  //
  // v1.6.0 — Bryn directive 2026-05-08: "give everything its own row under
  // the info pages sections, 00.x, rather than clumped in random sections,
  // make service taxonomy the first one 00.1 in this full page width way …
  // make info pages roll on for as long as is needed not just crammed to one
  // or two page max". Sections renumbered + reordered:
  //   00.1  10-Service Taxonomy   (full-width hero, page 0)
  //   00.2  Cable ID Format
  //   00.3  Symbol Convention
  //   00.4  Cable Types & Bend Radii (DRAWING KEY)
  //   00.5  Mounting Options
  //   00.6  Standing Install Notes
  //   00.7  Drawing Annotations
  //   00.8  Revision-Status Clouds
  //   00.9  Tails Protocol
  //   00.10 Bend Radius — Visual Reference (full-width SVG, separate page,
  //         emitted via buildBendRadiusPage but labelled 00.10 in chrome)
  //   00.11 Revision History (when present)
  //
  // Page allocation:
  //   pageIndex 0 → 00.1 Taxonomy (full-width hero, no 2-col grid)
  //   pageIndex 1 → 00.2 + 00.3 + 00.4 (2-col)
  //   pageIndex 2 → 00.5 + 00.6 + 00.7 (2-col)
  //   pageIndex 3 → 00.8 + 00.9 + 00.11 (2-col)
  //   (00.10 is its own page via buildBendRadiusPage)
  // 4 info pages from this template + 1 bend radius page = 5 info pages total.
  // Roll on if we add more sections — pageIndex extends naturally.
  function buildCablingInfoPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);
    // v1.6.3 — pageIndex 0..5 (5 cabling info pages + optional 00.11).
    // Clamp at 5 (max possible). Total pages = cabling pages + bend radius
    // (always +1 page from separate buildBendRadiusPage).
    const pageIndex = Math.max(0, Math.min(5, (typeof o.pageIndex === 'number') ? o.pageIndex : 0));
    // v5.243.0 (Bryn: "the pdf full version doesnt continue the notes on to more pages") — pageIndex 100+k = PLAN NOTES
    // continuation page k; the orchestrator splits the notes into page-sized chunks and passes this page's chunk.
    const _notesContIdx = (typeof o.pageIndex === 'number' && o.pageIndex >= 100) ? o.pageIndex - 100 : -1;
    const totalInfoPages = (typeof o.totalInfoPages === 'number') ? o.totalInfoPages : 6;

    // Canonical cable types + bend radii + drawing colour chip. This is
    // the cable-colour drawing key — engineers cross-reference the chip
    // letter (S/V/D/C/K/L/F/B) on the Combined Plans canvas back to the
    // cable type listed here. v1.4.0 — added chip column so this table
    // is the single source of truth for both bend radii AND drawing
    // colour code, per user directive: "the drawing key should be here."
    const cableTypes = [
      { type: 'Speaker 2-core',  r: '35',  notes: '—',                code: 'S', colour: '#8058a1', darkText: false },
      { type: 'Speaker 4-core',  r: '35',  notes: '—',                code: 'S', colour: '#8058a1', darkText: false },
      { type: 'Audio signal',    r: '25',  notes: '—',                code: 'A', colour: '#4bb9d3', darkText: false },
      { type: 'RG6 coaxial',     r: '65',  notes: '—',                code: 'C', colour: '#e37c59', darkText: false },
      { type: 'Cat6 / Cat6a',    r: '48',  notes: 'Data + PoE',       code: 'D', colour: '#4bb9d3', darkText: false },
      { type: 'Control',         r: '65',  notes: '—',                code: 'K', colour: '#e67eb1', darkText: false },
      { type: 'Lighting (LX)',   r: '60',  notes: 'CC/DALI/DMX feeds',code: 'L', colour: '#f5d05c', darkText: true  },
      { type: 'Optical fibre',   r: '200', notes: 'Special handling', code: 'F', colour: '#78ba57', darkText: false },
      { type: 'Shades / Blinds', r: '90',  notes: 'Somfy 4-core mains (default) · Lutron QS where specified', code: 'B', colour: '#ad9978', darkText: false }   // v5.185.0 — Sivoia-era label refreshed (somfy-4core is the project default since v5.147.0)
    ];
    const cableRowsHtml = cableTypes.map(r => {
      const ink = r.darkText ? INK : '#ffffff';
      return `
      <tr>
        <td class="info-cable-chip-cell"><span class="info-cable-chip" style="background:${h.esc(r.colour)};color:${ink}">${h.esc(r.code)}</span></td>
        <td>${h.esc(r.type)}</td>
        <td class="info-num">${h.esc(r.r)}</td>
        <td>${h.esc(r.notes)}</td>
      </tr>`;
    }).join('');

    const services = (Array.isArray(o.services) && o.services.length) ? o.services : c.DEFAULT_SERVICES;
    const taxonomyHtml = services.slice(0, 10).map(s => `
      <div class="info-svc-band" style="background:${h.esc(s.colour || '#999')}">
        <span class="info-svc-nn">${h.esc(s.nn || '')}</span>
        <span class="info-svc-name">${h.esc(s.name || '')}</span>
      </div>
    `).join('');

    const tailsRows = [
      ['TV / Display',          '1.0 m', '5.0 m', ''],
      ['Ceiling Speaker',       '2.0 m', '5.0 m', ''],
      ['Wall Speaker',          '1.0 m', '5.0 m', ''],
      ['Data / Cat6',           '0.5 m', '5.0 m', ''],
      ['Wireless Access Point', '0.5 m', '5.0 m', ''],
      ['Shade / Blind',         '1.0 m', '3.0 m', '(SHPNL)'],   // v5.185.0 — canonical shade-panel code
      ['Lighting Keypad',       '0.3 m', '5.0 m', '(LPNL)'],
      ['CCTV Camera',           '0.5 m', '5.0 m', '(NVR)']
    ];
    const tailsRowsHtml = tailsRows.map(r => `
      <tr><td>${h.esc(r[0])}</td><td>${h.esc(r[1])}</td><td>${h.esc(r[2])} ${h.esc(r[3])}</td></tr>
    `).join('');

    const revHistory = Array.isArray(o.revisionHistory) ? o.revisionHistory : [];
    const revRowsHtml = revHistory.length ? revHistory.map(r => `
      <tr><td>${h.esc(r.code || '')}</td><td>${h.esc(r.date || '')}</td><td>${h.esc(r.version || '')}</td><td>${h.esc(r.notes || '')}</td></tr>
    `).join('') : '<tr><td colspan="4" class="info-empty">No revisions yet</td></tr>';

    // ---- Section helpers — each emits ONE numbered section block -----------
    // v1.6.0 — sections refactored into discrete builders so they can be
    // composed onto pages without duplicating markup. Each section heads
    // with a "00.X" tag in slate pill + the section title in matching style
    // for unmistakable identity.

    const _sec = (num, title, inner, extraClass) => `
      <section class="info-section info-section-numbered${extraClass ? ' ' + extraClass : ''}">
        <div class="info-section-head-row">
          <span class="info-section-num">${h.esc(num)}</span>
          <h3 class="info-section-head">${h.esc(title)}</h3>
        </div>
        <div class="info-section-body">${inner}</div>
      </section>`;

    // 00.1 — 12-Service Taxonomy (compact one-line cards) + project-at-a-glance
    // v5.4.60 — Bryn directive 2026-05-10:
    //   · Taxonomy cards reduced to NN + name (description tagline removed)
    //   · 10 services row 1, services 11 (Electrical, red) + 12 (Trades, brown)
    //     row 2 — covers the full sub-trade scope
    //   · FLOORS + PROJECT TOTALS panels relocated from the cover to this
    //     page's LHS column (so cover stays light)
    //   · RHS column = REVISION HISTORY with per-version cloud counts
    //     (added / moved / removed) — leverages meta.revAdded etc. for the
    //     latest revision row; older rows show '—' until per-revision
    //     cloud metadata lands.
    // v5.198.0 — names/colours from the live registry when the host passes it
    // (o.services carries every service incl. 11/12); the Heybridge export
    // printed "12 Trades" here but "12 Construction" on Overall Counts.
    const _svcAll = Array.isArray(o.services) ? o.services : [];
    const _svcNamed = (nn, fallback) => { const f = _svcAll.find(x => x && String(x.nn) === nn); return f ? { nn, name: f.name || fallback.name, colour: f.colour || fallback.colour } : fallback; };
    const TAXONOMY_EXTRA = [
      _svcNamed('11', { nn: '11', name: 'Electrical',   colour: '#c84545' }),
      _svcNamed('12', { nn: '12', name: 'Construction', colour: '#8b6f4a' })
    ];
    const _taxCard = (s) => `
      <div class="info-tax-card info-tax-card-compact">
        <div class="info-tax-card-bar" style="background:${h.esc(s.colour || '#999')}"></div>
        <div class="info-tax-card-body">
          <span class="info-tax-card-nn" style="color:${h.esc(s.colour || '#999')}">${h.esc(s.nn || '')}</span>
          <span class="info-tax-card-name">${h.esc(s.name || '')}</span>
        </div>
      </div>
    `;
    const taxonomyRow1Html = services.slice(0, 10).map(_taxCard).join('');
    const taxonomyRow2Html = TAXONOMY_EXTRA.map(_taxCard).join('');

    // ---- Floors + totals panels (relocated from cover) ----
    const _floorsPanelHtml = c.floorsTable(o.floors);
    const _totalsPanelHtml = c.totalsPanel(o.totals);

    // ---- Revision history with cloud counts (RHS col) ----
    // Per-revision clouds: when a row carries .added/.moved/.removed, render
    // colour chips with the count. Fall back to project-wide totals on the
    // most-recent row only (fair attribution since clouds aren't yet stamped
    // per-version). Older rows render '—' chips. When no revisions exist
    // we still emit the section so the RHS column isn't empty — just shows
    // the project-wide cloud counts as a single "CURRENT" row.
    const _projectAdded   = (o.revAdded   != null) ? Number(o.revAdded)   : 0;
    const _projectMoved   = (o.revMoved   != null) ? Number(o.revMoved)   : 0;
    const _projectRemoved = (o.revRemoved != null) ? Number(o.revRemoved) : 0;
    const _projectRfi     = (o.revRfi     != null) ? Number(o.revRfi)     : 0;
    const _projectNote    = (o.revNote    != null) ? Number(o.revNote)    : 0;   // v5.172.0 — note clouds
    // v5.172.0 — CANONICAL CLOUD ORDER: added, moved, removed, RFI, note.
    const _renderCloudPills = (a, m, r, q, n) => `
      <span class="rev-cloud-pill rev-cloud-add">+ ${h.esc(String(a))}</span>
      <span class="rev-cloud-pill rev-cloud-mov">~ ${h.esc(String(m))}</span>
      <span class="rev-cloud-pill rev-cloud-rem">− ${h.esc(String(r))}</span>
      <span class="rev-cloud-pill rev-cloud-rfi">? ${h.esc(String(q == null ? 0 : q))}</span>
      <span class="rev-cloud-pill rev-cloud-note">i ${h.esc(String(n == null ? 0 : n))}</span>
    `;
    // v5.4.70 — Bryn directive 2026-05-10: revision rows now show the
    // freeform notes per revision + the revision-cloud notes grouped
    // by status (Added → numbered list, Moved → bulleted list,
    // Removed → bulleted list). Cloud notes come from
    // o.revisionCloudsByRev (a map keyed by revision id, OR the
    // canonical "current" key for clouds with no revisionId set).
    // The orchestrator builds this map from the canvas walk.
    const _cloudsByRev = (o.revisionCloudsByRev && typeof o.revisionCloudsByRev === 'object')
      ? o.revisionCloudsByRev : {};
    function _renderCloudNotesGrouped(buckets) {
      if (!buckets) return '';
      const added   = Array.isArray(buckets.added)   ? buckets.added   : [];
      const moved   = Array.isArray(buckets.moved)   ? buckets.moved   : [];
      const removed = Array.isArray(buckets.removed) ? buckets.removed : [];
      const rfi     = Array.isArray(buckets.rfi)     ? buckets.rfi     : [];
      const note    = Array.isArray(buckets.note)    ? buckets.note    : [];   // v5.165.0 — charcoal note clouds
      if (!added.length && !moved.length && !removed.length && !rfi.length && !note.length) return '';
      const renderBucket = (label, klass, items, ordered) => {
        if (!items.length) return '';
        // v5.131.0 (Bryn: "revision cloud notes should have the room and
        // affected blocks noted here too, preferably with the block symbols
        // in a small way") — items may be enriched objects { note, room,
        // blocks:[{svg, code}] }; block svg comes from the shared
        // SonorBlockSymbol renderer (trusted internal markup, injected raw;
        // note/room/codes are escaped). Plain-string items still render.
        const list = items
          .map(t => {
            if (t && typeof t === 'object' && !Array.isArray(t)) {
              const note = h.esc(String(t.note || '').trim() || '—');
              const room = t.room ? ` <span class="rev-cloud-room">${h.esc(t.room)}</span>` : '';
              const blocks = (Array.isArray(t.blocks) && t.blocks.length)
                ? `<span class="rev-cloud-blks">${t.blocks.map(b =>
                    `<span class="rev-cloud-blk">${b && b.svg ? b.svg : ''}${h.esc((b && b.code) || '')}</span>`).join('')}</span>`
                : '';
              // v5.148.0 (Bryn: "clouds should be itemised in the pdf by the
              // full id, because the bulleted list does not match the numbers
              // anyway") — each line leads with ITS cloud id; the numbered
              // <ol> is retired for enriched items.
              const idChip = t.id ? `<b class="rev-cloud-id">${h.esc(t.id)}</b> — ` : '';
              return `<li class="${t.id ? 'rev-cloud-li-id' : ''}">${idChip}${note}${room}${blocks}</li>`;
            }
            return `<li>${h.esc(String(t || '').trim() || '—')}</li>`;
          })
          .join('');
        const hasIds = items.some(t => t && typeof t === 'object' && t.id);
        return `
          <div class="rev-row-cloudgroup rev-row-cloudgroup-${klass}">
            <div class="rev-row-cloudgroup-head">${label} (${items.length})</div>
            ${(ordered && !hasIds) ? `<ol class="rev-row-cloudlist">${list}</ol>` : `<ul class="rev-row-cloudlist${hasIds ? ' rev-row-cloudlist-ids' : ''}">${list}</ul>`}
          </div>`;
      };
      return `
        <div class="rev-row-cloudbody">
          ${renderBucket('Added',   'add', added,   true)}
          ${renderBucket('Moved',   'mov', moved,   false)}
          ${renderBucket('Removed', 'rem', removed, false)}
          ${renderBucket('RFI',     'rfi', rfi,     true)}
          ${renderBucket('Notes',   'note', note,   false)}
        </div>`;
    }

    let revisionRowsHtml;
    if (revHistory.length) {
      const lastIdx = revHistory.length - 1;
      revisionRowsHtml = revHistory.map((r, i) => {
        const a = (r.added   != null) ? Number(r.added)   : (i === lastIdx ? _projectAdded   : null);
        const m = (r.moved   != null) ? Number(r.moved)   : (i === lastIdx ? _projectMoved   : null);
        const x = (r.removed != null) ? Number(r.removed) : (i === lastIdx ? _projectRemoved : null);
        const q = (r.rfi     != null) ? Number(r.rfi)     : (i === lastIdx ? _projectRfi     : null);
        const nn2 = (r.note  != null) ? Number(r.note)    : (i === lastIdx ? _projectNote    : null);   // v5.172.0
        const cloudsHtml = (a == null && m == null && x == null && q == null)
          ? '<span class="rev-cloud-pill rev-cloud-empty">—</span>'
          : _renderCloudPills(a == null ? '—' : a, m == null ? '—' : m, x == null ? '—' : x, q == null ? '—' : q, nn2 == null ? '—' : nn2);
        // Per-revision freeform note (from metadata.notes) + grouped
        // cloud-note bullets (from canvas-walked clouds keyed by id).
        const notesHtml = (r.notes && String(r.notes).trim())
          ? `<div class="rev-row-notes">${h.esc(String(r.notes).trim())}</div>`
          : '';
        const buckets = (r.id && _cloudsByRev[r.id]) || null;
        const groupedHtml = _renderCloudNotesGrouped(buckets);
        return `
          <div class="rev-row-with-clouds">
            <div class="rev-row-head">
              <div class="rev-row-meta">
                <span class="rev-row-code">${h.esc(r.code || '')}</span>
                <span class="rev-row-label">${h.esc(r.label || '')}</span>
                <span class="rev-row-date">${h.esc(r.date || '')}</span>
              </div>
              <div class="rev-row-clouds">${cloudsHtml}</div>
            </div>
            ${notesHtml}
            ${groupedHtml}
          </div>
        `;
      }).join('');
    } else {
      const buckets = _cloudsByRev.__current || _cloudsByRev[''] || null;
      revisionRowsHtml = `
        <div class="rev-row-with-clouds rev-row-current">
          <div class="rev-row-head">
            <div class="rev-row-meta">
              <span class="rev-row-code">${h.esc(o.revision || '00')}</span>
              <span class="rev-row-label">CURRENT — UNRELEASED</span>
              <span class="rev-row-date">—</span>
            </div>
            <div class="rev-row-clouds">${_renderCloudPills(_projectAdded, _projectMoved, _projectRemoved, _projectRfi, _projectNote)}</div>
          </div>
          ${_renderCloudNotesGrouped(buckets)}
        </div>
      `;
    }

    // v1.12.0 (Bryn 2026-07-11: "revision status clouds info should go under
    // the actual revision history on the project glance page and we need to
    // make space and add revision general comments from the main app") —
    // (a) project-level GENERAL COMMENTS (revisions modal textarea, persisted
    //     on projects.metadata.revision_general_comments) render in their own
    //     band under the revision rows;
    // (b) the revision-status cloud CONVENTION legend (red removed / orange
    //     moved / green added) moved here from its old 00.7 reference-page
    //     slot — the reader sees the convention next to the counts it
    //     explains. The old page-5 slot now carries Tails Protocol alone.
    const _revGeneralCommentsHtml = (o.revisionGeneralComments && String(o.revisionGeneralComments).trim())
      ? `
        <div class="rev-general-comments">
          <div class="rev-general-comments-head">GENERAL COMMENTS</div>
          <div class="rev-general-comments-body">${h.esc(String(o.revisionGeneralComments).trim())}</div>
        </div>`
      : '';
    // v5.146.0 (Bryn: "revision history should have the cloud legend
    // separated rather than part of same table and make the cloud symbols
    // better") — the legend is now its OWN card (rendered after the
    // revision panel, see _section00_1), and each chip is the REAL cloud
    // geometry: SonorTakeoffsClouds.scallopedPath — the exact generator
    // that draws clouds on the plan — traced as a mini SVG. Colours come
    // from the STATUS registry (SSOT), never hardcoded here.
    const _CL = (typeof window !== 'undefined' && window.SonorTakeoffsClouds) || null;
    const _cloudCol = (k, fb) => (_CL && _CL.STATUS && _CL.STATUS[k] && _CL.STATUS[k].colour) || fb;
    const _cloudChip = (hex) => {
      let d = null;
      try { if (_CL && typeof _CL.scallopedPath === 'function') d = _CL.scallopedPath(3, 3, 26, 12); } catch (_) {}
      if (d) {
        return `<svg class="rev-cloud-chip" viewBox="0 0 32 18" aria-hidden="true">` +
          `<path d="${d}" fill="none" stroke="${hex}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
      return `<span class="info-cloud" style="border-color:${hex}"></span>`;
    };
    const _revCloudLegendHtml = `
      <section class="rev-cloud-legend rev-cloud-legend-card">
        <header class="panel-head">REVISION-STATUS CLOUDS <span class="rev-cloud-legend-sub">drawn around the affected symbol</span></header>
        <ul class="info-cloud-key info-cloud-key-compact rev-cloud-key-grid">
          <li>${_cloudChip(_cloudCol('added', '#78ba57'))}<span><strong>GREEN</strong> — Added in this revision</span></li>
          <li>${_cloudChip(_cloudCol('changed', '#e08a2e'))}<span><strong>ORANGE</strong> — Moved in this revision</span></li>
          <li>${_cloudChip(_cloudCol('removed', '#ec6061'))}<span><strong>RED</strong> — Removed in this revision</span></li>
          <li>${_cloudChip(_cloudCol('rfi', '#8058a1'))}<span><strong>PURPLE</strong> — RFI / query on this region</span></li>
          <li>${_cloudChip(_cloudCol('note', '#302f2e'))}<span><strong>CHARCOAL</strong> — Note / general information</span></li>
        </ul>
      </section>`;

    // v5.4.63 — Bryn directive 2026-05-10:
    //   "taxonomy 00.0 needs to move to top of page 3"
    // Page 2 = PROJECT AT A GLANCE — Floors+Totals (LHS) + Revisions (RHS).
    // No taxonomy strip; cleaner read.
    // Page 3 (00.0+00.1+00.2) gets a compact taxonomy strip pinned at the
    // top, labelled 00.0, then the existing 00.1 Cable ID + 00.2 Symbol
    // Convention sections beneath.
    // v5.145.0 (Bryn: "forget project at a glance, just make that page
    // revision history and have it full width") — the FLOORS + PROJECT
    // TOTALS panels are gone (Overall Counts already carries the numbers);
    // the page is a single full-width REVISION HISTORY. The floors/totals
    // panel builders above stay (other layouts may reuse them).
    void _floorsPanelHtml; void _totalsPanelHtml;
    // v5.148.0 (Bryn: "notes should have a tickbox for making visible on
    // export or not and displayed in the appropriate section of the pdf,
    // which is probably top of the revisions page") — notes flagged for
    // export in 📋 Notes render first, above the revision history panel.
    const _exportNotesHtml = (Array.isArray(o.exportNotes) && o.exportNotes.length) ? `
        <section class="rev-plan-notes-card">
          <header class="panel-head">PLAN NOTES${_notesContIdx >= 0 ? ' <span class="rev-cloud-legend-sub">continued</span>' : ''}</header>
          <ul class="rev-plan-notes-list">
            ${o.exportNotes.map(n => `<li>${h.esc(n.text || '')}${(Array.isArray(n.services) ? n.services : []).map(sv => ` <span class="rev-svc-chip" style="background:${h.esc((sv && sv.colour) || '#475161')}">${h.esc((sv && sv.nn) || '')}</span>`).join('')}${n.floor ? ` <span class="rev-cloud-room">${h.esc(n.floor)}</span>` : ''}${n.done ? ' <span class="rev-plan-note-done">✓ done</span>' : ''}</li>`).join('')}
          </ul>
          ${o.notesMore ? '<div class="rev-plan-notes-more">Notes continue on the next page →</div>' : ''}
        </section>` : '';
    // v5.154.0 (Bryn: "rev history still has 1st header duplicate first,
    // delete it") — the hero band duplicated the panel head; the page now
    // opens straight onto the PLAN NOTES card.
    const _section00_1 = `
      <section class="info-section info-section-fullwidth info-section-taxonomy">
        ${_exportNotesHtml}
        <section class="rev-history-panel rev-history-panel-full">
          <header class="panel-head">REVISION HISTORY</header>
          <div class="rev-history-body">${revisionRowsHtml}</div>
          ${_revGeneralCommentsHtml}
        </section>
        ${_revCloudLegendHtml}
      </section>
    `;

    // v5.4.63 — Standalone taxonomy strip rendered at the top of page 3
    // (the first 00.x reference page). Compact head ("00.0  SERVICE
    // TAXONOMY") + the same 10-card row + 2-card extras row. Pre-v5.4.63
    // this lived inside _section00_1 on page 2.
    const _section00_taxonomy = `
      <section class="info-section info-section-fullwidth info-section-taxonomy info-section-numbered">
        <div class="info-section-head-row">
          <span class="info-section-num">00.0</span>
          <h3 class="info-section-head">Service Taxonomy</h3>
        </div>
        <div class="info-taxonomy-strip info-taxonomy-strip-compact">
          <div class="info-taxonomy-row info-taxonomy-row-main">${taxonomyRow1Html}</div>
          <div class="info-taxonomy-row info-taxonomy-row-extra">${taxonomyRow2Html}</div>
        </div>
      </section>
    `;

    // v5.4.61 — 00.X SECTIONS RENUMBERED. Bryn directive 2026-05-10:
    //   "start the 00.x from page 3"
    // Page 2 = PROJECT AT A GLANCE (taxonomy + floors/totals + revision
    // history) — NO 00.x label. Page 3 onwards carries 00.1 → 00.N.
    // Pre-v5.4.61 the taxonomy held the 00.1 slot; everything else
    // shifts down by one to fill the freed numbers.
    //
    // v5.185.0 numbering (front vs CABLING STANDARDS pack):
    //   00.0  Service Taxonomy            (front)
    //   00.1  Symbol Convention           (front)
    //   00.2  Mounting Options            (front)
    //   00.3  Drawing Annotations         (front)
    //   00.4  Revision History            (front, conditional)
    //   00.5  Cable ID Format             (CABLING PACK — before Cable Schedule)
    //   00.6  Cable Types & Bend Radii    (CABLING PACK)
    //   00.7  Standing Install Notes      (CABLING PACK)
    //   00.8  Tails Protocol              (CABLING PACK)
    //   00.9  Bend Radius                 (own page, rides with the pack)

    // v5.185.0 — 00.5 Cable ID Format (was 00.1): moved to the CABLING
    // STANDARDS pack that emits immediately before the Cable Schedule
    // (Bryn: "info 00.3, 00.5, 00.1, 00.7 should all go to a new section
    // before the cable schedule and also be included on the cs only export").
    // v5.198.0 — describes the ID scheme the schedules and plans ACTUALLY use
    // ({SHORT}-{FLOOR}-{ROOM}-{NN} + /letter per cable); the old B2ES-S-01
    // text matched nothing in the document.
    const _section00_2 = _sec('00.5', 'Cable ID Format', `
      <div class="info-id-format">TV4K-GF-LNGE-01/A</div>
      <dl class="info-id-key">
        <dt>TV4K</dt><dd>Block short code (drawn on the plan symbol) — TV point 4K. Same code on Blocks / Cable / Device schedules.</dd>
        <dt>GF</dt><dd>Floor code — GF Ground · 1F First · 2F Second · BA Basement · EXT external.</dd>
        <dt>LNGE</dt><dd>Room code (4-char, per floor — see Rooms Schedule). EXT-{floor} = outside the building outline · omitted when no room applies.</dd>
        <dt>01</dt><dd>Instance number within the room — omitted when the room holds only one of that block.</dd>
        <dt>/A</dt><dd>Cable letter — one per cable the block needs (A, B, C …). Origin column = head-end / panel it runs from (N0 = Node 0 head end · SHP = shade panel · LPNL = lighting panel).</dd>
        <dt>Cameras</dt><dd>CCTV-{ROOM}-A/B/C… clockwise within the room · CCTV-01, 02 … clockwise around the site for cameras outside any room.</dd>
      </dl>
    `);

    // v5.185.0 — 00.1 Symbol Convention (was 00.2): front info block.
    const _section00_3 = _sec('00.1', 'Symbol Convention', `
      <ul class="info-symbol-list">
        <li><span class="info-bullet"></span><span>Every placed block is a service-coloured symbol carrying its short code (LKCB, CP, TS, TV4K …) and an auto-ID label</span><span class="info-code">{SHORT}-{FLOOR}-{ROOM}-{NN}</span></li>
        <li><span class="info-bullet"></span><span>Lighting keypad, Ground Floor, Lounge, second of two</span><span class="info-code">LKCB-GF-LNGE-02</span></li>
        <li><span class="info-bullet"></span><span>Ceiling PIR, First Floor, Master Bedroom — only one in the room, so no number</span><span class="info-code">CP-1F-MBED</span></li>
        <li><span class="info-bullet"></span><span>Outdoor access point outside the building outline</span><span class="info-code">AP-GF-EXT-01</span></li>
        <li><span class="info-bullet"></span><span>Room-less block (e.g. a doorbell on the entrance)</span><span class="info-code">DB-GF</span></li>
        <li><span class="info-bullet"></span><span>Shades are drawn window treatments — RL roller · CT curtain track</span><span class="info-code">RL-GF-KITD-01</span></li>
      </ul>
    `);

    // v5.185.0 — 00.6 Cable Types & Bend Radii (was 00.3): CABLING
    // STANDARDS pack (before the Cable Schedule).
    const _section00_4 = `
      <section class="info-section info-section-numbered info-section-key">
        <div class="info-section-head-row">
          <span class="info-section-num">00.6</span>
          <h3 class="info-section-head">Cable Types &middot; Bend Radii &middot; Drawing Colour</h3>
          <span class="info-section-key-tag">DRAWING KEY</span>
        </div>
        <div class="info-section-body">
          <table class="info-table">
            <thead><tr><th class="info-cable-chip-h">Code</th><th>Type</th><th class="info-num">R (mm)</th><th>Notes</th></tr></thead>
            <tbody>${cableRowsHtml}</tbody>
          </table>
          <p class="info-footnote">Cable colour on Combined Plans matches chip code above. Sub-contractor handover slices keep the same colour cue.</p>
        </div>
      </section>`;

    // v5.185.0 — 00.2 Mounting Options (was 00.4): front info block.
    const _section00_5 = _sec('00.2', 'Mounting Options', `
      <div class="info-mount-grid">
        <div class="info-mount-cell">
          <div class="info-mount-head">Ceiling</div>
          <div class="info-mount-body">Recessed flush — fire-rated back-box</div>
        </div>
        <div class="info-mount-cell">
          <div class="info-mount-head">Wall</div>
          <div class="info-mount-body">In-wall pre-wire — flush plate finish</div>
        </div>
        <div class="info-mount-cell">
          <div class="info-mount-head">Floor</div>
          <div class="info-mount-body">Floor box / under-carpet — sealed exit</div>
        </div>
        <div class="info-mount-cell">
          <div class="info-mount-head">Pre-wire</div>
          <div class="info-mount-body">First-fix only — second-fix at fit-out</div>
        </div>
      </div>
    `);

    // v5.185.0 — 00.7 Standing Install Notes (was 00.5): CABLING
    // STANDARDS pack (before the Cable Schedule).
    const _section00_6 = _sec('00.7', 'Standing Install Notes', `
      <ol class="info-numbered">
        <li>Do not scale from this drawing — all dimensions to be confirmed on-site.</li>
        <li>Label cables 150 mm from the cable end (both ends) using approved markers.</li>
        <li>Maintain 300 mm minimum parallel separation from mains-voltage cabling.</li>
        <li>Where mains and low-voltage cross, cross at 90 degrees only.</li>
        <li>Sockets/keypads/wall-plates installed at standard heights per project spec.</li>
        <li>Cables loosely coiled 1.0 m above FFL at termination point pending second-fix.</li>
        <li>All terminations to manufacturer spec; test + record before second-fix sign-off.</li>
        <li>Report any deviation from this drawing to design before installation.</li>
      </ol>
    `);

    // v5.185.0 — 00.3 Drawing Annotations (was 00.6): front info block.
    const _section00_7 = _sec('00.3', 'Drawing Annotations — Height Prefix', `
      <div class="info-section-sublabel">Small letter inside the outlet symbol</div>
      <dl class="info-prefix-key">
        <dt><span class="info-prefix-box">C</span></dt><dd>High level — under ceiling</dd>
        <dt><span class="info-prefix-box">T</span></dt><dd>TV level — 1500 mm AFFL</dd>
        <dt><span class="info-prefix-box">M</span></dt><dd>Middle — switch / worktop</dd>
        <dt><span class="info-prefix-box">F</span></dt><dd>Low — standard outlet / floor</dd>
        <dt><span class="info-prefix-box">S</span></dt><dd>To suit furniture — confirm pre-fit</dd>
        <dt><span class="info-prefix-box">D</span></dt><dd>To suit bedhead — confirm with ID</dd>
      </dl>
    `);

    // v1.12.0 — 00.7 Revision-Status Clouds section MOVED to the glance
    // page (under Revision History); Tails Protocol takes the 00.7 slot.
    // v5.185.0 — was 00.7; CABLING STANDARDS pack. (v5.198.0 — this note used
    // to sit INSIDE the template literal and printed on the client PDF.)
    const _section00_9 = _sec('00.8', 'Tails Protocol', `
      <div class="info-section-sublabel">SERVICE LOOP @ EACH END (per outlet · per head-end)</div>
      <table class="info-table">
        <thead><tr><th>Outlet Type</th><th>@ Outlet</th><th>@ Head-end</th></tr></thead>
        <tbody>${tailsRowsHtml}</tbody>
      </table>
      <p class="info-footnote">Coil cables loosely 1.0 m above FFL at termination point pending second-fix. Loop where indicated.</p>
    `);

    // v5.185.0 — 00.4 Revision History (was 00.9; only emits when there ARE
    // revisions — an empty table looks like a section bug to the reader).
    const _section00_11 = revHistory.length ? _sec('00.4', 'Revision History', `
      <table class="info-table">
        <thead><tr><th>Rev</th><th>Date</th><th>Version</th><th>Notes</th></tr></thead>
        <tbody>${revRowsHtml}</tbody>
      </table>
    `) : '';

    // ---- Page composition by pageIndex --------------------------------------
    // v5.185.0 — INFO CATEGORIES REORGANISED (Bryn: "info 00.3, 00.5, 00.1,
    // 00.7 should all go to a new section before the cable schedule and
    // also be included on the cs only export. make more sense of the info
    // categories in general"). The cable-focused sections (Cable ID Format,
    // Cable Types & Bend Radii, Install Notes, Tails Protocol) now form the
    // CABLING STANDARDS pack — pageIndex 3 + 4 — which the orchestrator
    // emits immediately BEFORE the Cable Schedule (and the standalone Cable
    // Schedule exports carry as preface pages). The plan-reading sections
    // stay at the front of the document.
    //
    // Page composition:
    //   pageIndex 0 → REVISION HISTORY (glance panel — unnumbered)
    //   pageIndex 1 → 00.0 Taxonomy + 00.1 Symbol Convention        (FRONT)
    //   pageIndex 2 → 00.2 Mounting Options + 00.3 Annotations      (FRONT)
    //   pageIndex 3 → 00.5 Cable ID + 00.6 Types & Bend Radii       (CABLING PACK)
    //   pageIndex 4 → 00.7 Install Notes + 00.8 Tails Protocol      (CABLING PACK)
    //   pageIndex 5 → 00.4 Revision History (conditional — FRONT)
    //   (00.9 Bend Radius on its own page via buildBendRadiusPage — rides
    //    with the CABLING PACK in the full document)
    //
    // Each section heads with the 00.X numbered pill + title in a tinted
    // banner (.info-section-head-row), then its body block underneath.
    // v1.17.0 (Bryn 16.10.26: "check how the intro plan notes and revisions is generated because it seems to be duplicated in
    // an odd way") — ONE front page. Revision history + notes, taxonomy, symbol convention, mounting and annotations used to
    // spread over three mostly-empty A3 sheets (and the legacy 00.4 revision table repeated the revision panel). They now
    // share a single PROJECT INFORMATION page in a two-column grid; long plan notes still continue on their own pages.
    const _fs = Object.assign({ tax: true, key: true }, (o.frontSections || {}));
    const _section_front = `
      <section class="info-section info-section-fullwidth info-section-taxonomy info-front-merged">
        ${_exportNotesHtml}
        ${_fs.tax ? _section00_taxonomy : ''}
        <div class="info-front-grid">
          <div class="info-front-col">
            <section class="rev-history-panel rev-history-panel-full">
              <header class="panel-head">REVISION HISTORY</header>
              <div class="rev-history-body">${revisionRowsHtml}</div>
              ${_revGeneralCommentsHtml}
            </section>
            ${_revCloudLegendHtml}
            ${_fs.key ? _section00_5 : ''}
          </div>
          <div class="info-front-col">
            ${_fs.tax ? _section00_3 : ''}
            ${_fs.key ? _section00_7 : ''}
          </div>
        </div>
      </section>
    `;
    const _PAGE_ROWS = [
      { label: 'PROJECT INFORMATION',   rows: [_section_front], full: true },   // v1.17.0 — merged front page (was REVISION HISTORY + 2 more)
      { label: 'TAXONOMY & CONVENTIONS',rows: [_section00_taxonomy, _section00_3] },
      { label: 'KEY & ANNOTATIONS',     rows: [_section00_5, _section00_7] },
      { label: 'CABLING STANDARDS — CABLE ID & TYPES', rows: [_section00_2, _section00_4] },
      { label: 'CABLING STANDARDS — INSTALL & TAILS', rows: [_section00_6, _section00_9] }
    ];
    if (revHistory.length) {
      _PAGE_ROWS.push({ label: 'REVISION HISTORY', rows: [_section00_11] });
    }
    const safeIndex = Math.min(pageIndex, _PAGE_ROWS.length - 1);
    const _page = (_notesContIdx >= 0)
      ? { label: 'PLAN NOTES (CONTINUED)', rows: [`<section class="info-section info-section-fullwidth info-section-taxonomy">${_exportNotesHtml}</section>`], full: true }
      : _PAGE_ROWS[safeIndex];
    const innerBody = _page.full
      ? `<div class="info-fullpage">${_page.rows.join('')}</div>`
      : `<div class="info-fullpage info-rowstack">${_page.rows.join('')}</div>`;
    // v1.17.0 — two families, each numbered on its own: PROJECT INFORMATION (front) and CABLING STANDARDS (the pack before the
    // cable schedule). The old single 'INFORMATION & STANDARDS (x of 6)' ran across both and read as a duplicated section.
    const _isPack = (_notesContIdx < 0) && pageIndex >= 3;
    const _fam = _isPack ? 'CABLING STANDARDS' : 'PROJECT INFORMATION';
    const _sub = String(_page.label).replace(/^(CABLING STANDARDS|PROJECT INFORMATION)( — )?/, '');
    const sectionTitle = _fam + (_sub && _sub !== _fam ? ' — ' + _sub : '');
    // v5.170.0 — with per-page ticks, skipped pages must not leave holes in
    // the '(x of y)' label: the orchestrator passes the emit ORDINAL.
    const _ord = (typeof o.pageOrdinal === 'number') ? o.pageOrdinal : pageIndex;
    const pageLabel = (Number(totalInfoPages) > 1) ? `(${_ord + 1} of ${totalInfoPages})` : '';   // v1.17.0 — no '(1 of 1)'

    const body = `
  <div class="page page-info" style="--accent: ${accent}">
    ${c.pageHeader(Object.assign({}, o, {
      sectionTitle: (sectionTitle + ' ' + pageLabel).trim()
    }))}
    <main class="page-body page-body-info">
      ${innerBody}
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — Information & Standards', { pdfTheme: o.pdfTheme });
  }

  // ---- buildBendRadiusPage -------------------------------------------------
  // Reference page: 7 concentric circles drawn at scale showing minimum bend
  // radii for cable types. SVG inline so it reproduces crisply at any zoom.
  function buildBendRadiusPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || '#e37c59');

    // Canonical cable bend radii — drawn as concentric circles at scale.
    // v1.4.0 — proper scale calculation. A3 paper is 420mm wide; SVG
    // viewBox is 1200 units wide and renders at ~95% of canvas width.
    // VIEWBOX_PER_MM = (1200 / 420) * targetScale_at_A3
    //                = 2.857 * 0.55 = 1.57
    // → 200mm optical-fibre circle = 314 viewBox units = ~580mm at A3
    //   → 0.55:1 of true mm. Engineers can verify with a ruler.
    const TARGET_SCALE_AT_A3 = 0.55;
    const SCALE = (1200 / 420) * TARGET_SCALE_AT_A3;
    const cables = [
      { name: 'Optical fibre',     r: 200, colour: '#e37c59' },
      { name: 'Blinds (Sivoia)',   r: 90,  colour: '#a76eb6' },
      { name: 'RG6 coaxial',       r: 65,  colour: '#4bb9d3' },
      { name: 'Control',           r: 65,  colour: '#e67eb1' },
      { name: 'Cat6',              r: 48,  colour: '#78ba57' },
      { name: 'Speaker 2 & 4-core',r: 35,  colour: '#8b6f4a' },
      { name: 'Audio signal',      r: 25,  colour: '#f5d05c' }
    ];
    const cx = 600, cy = 380;
    const circlesHtml = cables.map(c => `
      <circle cx="${cx}" cy="${cy}" r="${(c.r * SCALE).toFixed(1)}" fill="none" stroke="${h.esc(c.colour)}" stroke-width="1.6" opacity="0.85"/>
    `).join('');
    // Cross-hair tick marks: arms extending right of centre at each radius
    const ticksHtml = cables.map(c => {
      const r = c.r * SCALE;
      return `<line x1="${cx + r - 6}" y1="${cy}" x2="${cx + r + 6}" y2="${cy}" stroke="#1a1f28" stroke-width="0.8"/>`;
    }).join('');
    const keyRowsHtml = cables.map(c => `
      <tr>
        <td><span class="bend-key-dot" style="background:${h.esc(c.colour)}"></span><strong>${h.esc(c.name)}</strong></td>
        <td class="bend-key-r" style="color:${h.esc(c.colour)}">${h.esc(String(c.r))} mm</td>
      </tr>
    `).join('');

    // v1.12.0 — header carries 00.8 (clouds legend left the reference pages
    // for the glance page, everything after shuffled up one).
    // v5.4.61 — header carries 00.9 (was 00.10 pre-v5.4.61 when the
    // taxonomy held 00.1). The 00.X numbering shifted up one when the
    // taxonomy lost its 00.x label per Bryn directive 2026-05-10.
    const _sectionTitle = (o.sectionTitle || 'INFORMATION & STANDARDS — BEND RADIUS REFERENCE');
    const _pageLabel = (typeof o.totalInfoPages === 'number') ? `(${o.totalInfoPages} of ${o.totalInfoPages})` : '';
    const body = `
  <div class="page page-info" style="--accent: ${accent}">
    ${c.pageHeader(Object.assign({}, o, { sectionTitle: _sectionTitle + (_pageLabel ? ' ' + _pageLabel : '') }))}
    <main class="page-body page-body-bend">
      <div class="info-section-head-row info-section-head-row-bend">
        <span class="info-section-num">00.8</span>
        <h3 class="info-section-head">Bend Radius — Visual Reference</h3>
      </div>
      <div class="bend-canvas">
        <svg viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid meet" class="bend-svg">
          ${circlesHtml}
          ${ticksHtml}
          <line x1="${cx - 8}" y1="${cy}" x2="${cx + 8}" y2="${cy}" stroke="#1a1f28" stroke-width="1.4"/>
          <line x1="${cx}" y1="${cy - 8}" x2="${cx}" y2="${cy + 8}" stroke="#1a1f28" stroke-width="1.4"/>
        </svg>
        <div class="bend-key">
          <div class="bend-key-head">MIN BEND RADIUS — KEY</div>
          <table class="bend-key-table">
            <tbody>${keyRowsHtml}</tbody>
          </table>
        </div>
        <div class="bend-scale-note">
          <div class="bend-scale-head">${TARGET_SCALE_AT_A3.toFixed(2)} : 1 SCALE @ A3</div>
          <p>Arcs reduced to fit page. Multiply each radius by ${(1 / TARGET_SCALE_AT_A3).toFixed(2)} for true mm,
          or print A3 unscaled and use the key as a reference (not 1:1). Verify with a ruler before pre-bending cables on site.</p>
        </div>
      </div>
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — Bend Radius Reference', { pdfTheme: o.pdfTheme });
  }

  // ---- buildOverallCountsPage ----------------------------------------------
  // v1.7.0 (2026-05-09) — single scoreboard page that consolidates every
  // service's totals into one reference. Goes immediately after Combined
  // Plans so the engineer/sub-contractor sees "what's in this project?"
  // before drilling into per-service plans + schedules. Per Bryn directive
  // 2026-05-08: "combined plans and overall counts come after the info
  // pages, then per service by category".
  //
  // Data shape (passed via opts):
  //   grand:    { floors, rooms, symbols, areaM2, perimeterM, cableM, ledM, shades, tvs }
  //   services: [{ nn, key, name, colour, symbols, sub }, ... 01..10..11]
  //             where .symbols is the count of placements for that service
  //             and .sub is an optional list of sub-service rollups for
  //             future expansion (currently empty).
  //
  // Layout: header chrome + grand-totals row at top + service grid below
  // (one row per service NN with colour bar + name + symbol count + sub
  // metrics where applicable). Footer chrome.
  function buildOverallCountsPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);
    const grand = o.grand || {};
    const services = Array.isArray(o.servicesData) ? o.servicesData : [];

    // Format helpers — keep concise so the row reads as a scoreboard.
    const fmtNum = (v) => (v == null) ? '—' : (typeof v === 'number' ? v.toFixed(0) : String(v));
    const fmtArea = (v) => (typeof v === 'number') ? v.toFixed(2) + ' m²' : '—';
    const fmtMetres = (v) => (typeof v === 'number') ? v.toFixed(2) + ' m' : '—';

    // Grand totals row — top metrics shown as 5-cell strip
    const grandCells = [
      { cap: 'Floors',    val: fmtNum(grand.floors)    },
      { cap: 'Rooms',     val: fmtNum(grand.rooms)     },
      { cap: 'Total Blocks', val: fmtNum(grand.symbols) },
      { cap: 'Area',      val: fmtArea(grand.areaM2)   },
      { cap: 'Perimeter', val: fmtMetres(grand.perimeterM) }
    ];
    const grandStripHtml = grandCells.map(g => `
      <div class="oc-grand-cell">
        <div class="oc-grand-cap">${h.esc(g.cap)}</div>
        <div class="oc-grand-val">${h.esc(g.val)}</div>
      </div>
    `).join('');

    // Per-service rows — one per NN that has placements; empty services
    // still render so the engineer sees the full 10-service taxonomy
    // grid (zero count is informative). Sorted in canonical 01→10 order
    // with service 11 last when present.
    const servicesSorted = services.slice().sort((a, b) => {
      const an = parseInt(a.nn, 10), bn = parseInt(b.nn, 10);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(a.nn).localeCompare(String(b.nn));
    });
    // v1.7.2 — collapse empty Cable / LED columns when NO service has those
    // metrics. v5.4.51 first ship rendered 3 metric slots per row regardless,
    // but with most projects the per-service cable / LED breakdown isn't
    // populated yet (needs cable-type → service mapping). Empty cells made
    // the page feel half-populated. Now the row layout adapts: Blocks-only
    // when no cable/LED data, full 3-col when present.
    const anyCable = servicesSorted.some(s => s.cableM != null);
    const anyLed   = servicesSorted.some(s => s.ledM   != null);
    const svcRowClass = (anyCable || anyLed) ? 'oc-svc-row oc-svc-row-wide' : 'oc-svc-row oc-svc-row-narrow';
    const svcRowsHtml = servicesSorted.map(s => {
      const sym = (s.symbols != null) ? s.symbols : 0;
      const cab = (s.cableM != null) ? s.cableM : null;
      const led = (s.ledM != null) ? s.ledM : null;
      const isZero = sym === 0;
      const cableCell = anyCable ? (cab != null ? `
            <div class="oc-svc-metric">
              <span class="oc-svc-metric-cap">Cable</span>
              <span class="oc-svc-metric-val">${h.esc(fmtMetres(cab))}</span>
            </div>` : '<div class="oc-svc-metric oc-svc-metric-empty"></div>') : '';
      const ledCell = anyLed ? (led != null ? `
            <div class="oc-svc-metric">
              <span class="oc-svc-metric-cap">LED</span>
              <span class="oc-svc-metric-val">${h.esc(fmtMetres(led))}</span>
            </div>` : '<div class="oc-svc-metric oc-svc-metric-empty"></div>') : '';
      return `
        <div class="${svcRowClass}${isZero ? ' oc-svc-row-zero' : ''}">
          <div class="oc-svc-bar" style="background:${h.esc(s.colour || '#999')}"></div>
          <div class="oc-svc-nn">${h.esc(s.nn || '')}</div>
          <div class="oc-svc-name">${h.esc(s.name || '')}</div>
          <div class="oc-svc-metric oc-svc-metric-blocks">
            <span class="oc-svc-metric-cap">Blocks</span>
            <span class="oc-svc-metric-val">${h.esc(String(sym))}</span>
          </div>
          ${cableCell}${ledCell}
        </div>`;
    }).join('');

    // v1.16.0 (Takeoffs v5.201.0, B-468) — HEAD END (ESTIMATE): the kit the takeoff never places, sized by the
    // Library's derived rules from this plan's metrics (o.headEnd = window._headEndEstimate()). Every row carries
    // its basis so the reader sees WHY ("52 lighting.circuits.dimmed +20% @ 8/unit"). Absent → page unchanged.
    const he = o.headEnd || null;
    const heRows = (he && Array.isArray(he.rows)) ? he.rows : [];
    const heMetrics = (he && Array.isArray(he.metricRows)) ? he.metricRows : [];
    const headEndHtml = heRows.length ? `
      <section class="oc-headend">
        <header class="oc-headend-head">HEAD END (${he.source === 'engineered' ? 'ENGINEERED' : 'ESTIMATE'}) <span class="oc-headend-sub">${h.esc(String(he.totals ? he.totals.lines : heRows.length))} items · ${h.esc(String((he.totals && he.totals.u_used) || 0))}U · ${h.esc(String((he.totals && he.totals.power_w) || 0))} W${he.racks && he.racks.length ? ' · ' + h.esc(he.racks.map(r => r.basis).join('; ')) : ''}</span></header>
        <div class="oc-headend-body">
          <div class="oc-headend-metrics">${heMetrics.map(mr => `<div class="oc-he-metric"><span class="oc-he-metric-val">${h.esc(String(mr.value))}</span><span class="oc-he-metric-cap">${h.esc(mr.label)}</span></div>`).join('')}</div>
          <table class="oc-headend-table"><thead><tr><th>Item</th><th>Qty</th><th>Basis</th><th>Pass</th></tr></thead><tbody>
            ${heRows.map(r => `<tr class="${r.priced ? '' : 'oc-he-unpriced'}"><td>${h.esc(r.label)}${r.priced ? '' : ' <span class="oc-he-tag">no WQ product</span>'}</td><td class="oc-he-qty">${h.esc(String(r.qty))}</td><td class="oc-he-basis">${h.esc(r.basis || '')}</td><td class="oc-he-pass">${h.esc(r.pass || '')}</td></tr>`).join('')}
          </tbody></table>
          <p class="oc-headend-foot">${he.source === 'engineered' ? 'From the Engineering schematic racks (' + h.esc((he.racks || []).map(r => r.basis).join(', ')) + ') — replaces the rules estimate.' : 'Estimate only — sized by the Library\'s derived-item rules from the placements on this plan. The engineered list comes from the Engineering schematic and replaces these rows in the next quote revision.'}</p>
        </div>
      </section>` : '';

    const sectionTitle = o.sectionTitle || 'OVERALL COUNTS';
    const body = `
  <div class="page page-counts${headEndHtml ? ' page-counts-he' : ''}" style="--accent: ${accent}">
    ${c.pageHeader(Object.assign({}, o, { sectionTitle }))}
    <main class="page-body page-body-counts">
      <div class="page-section-head">
        <div class="page-section-title">
          <span class="page-section-eyebrow">SCOREBOARD</span>
          <span class="page-section-name">Overall Counts</span>
          <span class="page-section-accent-line"></span>
        </div>
      </div>
      <section class="oc-grand">
        <header class="oc-grand-head">PROJECT TOTALS</header>
        <div class="oc-grand-strip">${grandStripHtml}</div>
      </section>
      <section class="oc-services${headEndHtml ? ' oc-services-with-he' : ''}">
        <header class="oc-services-head">PER SERVICE</header>
        <div class="oc-services-list">${svcRowsHtml}</div>
        <p class="oc-services-foot">Service rows ordered canonically 01 → 10 → 11. A "0 Blocks" row means no placements yet on this project for that service. Cable / LED metres aggregate across all floors.</p>
      </section>
      ${headEndHtml}
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — Overall Counts', { pdfTheme: o.pdfTheme });
  }

  // ---- buildElectricalRequirementsPage --------------------------------------
  // v1.13.0 (Bryn 2026-07-12: "build the electrical requirements page before
  // bulk cable and design this nicely with specs and info"). One A3 landscape
  // page, svc-11 red accent, consolidating EVERYTHING the electrical
  // contractor must provide: fused spurs (shade systems flagged BY
  // ELECTRICAL), panel + rack 230V supplies, service-11 placements, and the
  // standing electrical standards/coordination notes. Data arrives via
  // o.elec = window._electricalRequirementsData() (reports module SSOT).
  function buildElectricalRequirementsPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || '#e63946');
    const d = o.elec || {};
    const spurs   = Array.isArray(d.spurs)   ? d.spurs   : [];
    const panels  = Array.isArray(d.panels)  ? d.panels  : [];
    const racks   = Array.isArray(d.racks)   ? d.racks   : [];
    const svc11   = Array.isArray(d.svc11Rows) ? d.svc11Rows : [];
    const hvac    = Array.isArray(d.hvac)    ? d.hvac    : [];   // v5.153.0
    const led     = (d.led && Array.isArray(d.led.rows)) ? d.led.rows : [];   // v5.268.0 — SonorLedEng.electrical rows (LED Calc / engine)

    // v5.198.0 — the row cap is a PAGE budget shared across the populated
    // sections (a fixed 14 per section let 4 supplies + 12 stats push the
    // Standards block off the page); dense pages also get a compact class.
    const _populated = [spurs, panels.concat(racks), svc11, hvac, led].filter(a => a && a.length).length;
    const _totalRows = spurs.length + panels.length + racks.length + svc11.length + hvac.length + led.length;
    const MAX_ROWS = Math.max(4, Math.floor(18 / Math.max(1, _populated)));
    const _compact = _totalRows > 10 ? ' er-compact' : '';
    const _rows = (arr, fn, emptyMsg, moreLabel) => {
      if (!arr.length) return `<tr class="er-empty"><td colspan="4">${h.esc(emptyMsg)}</td></tr>`;
      let html = arr.slice(0, MAX_ROWS).map(fn).join('');
      if (arr.length > MAX_ROWS) {
        html += `<tr class="er-more"><td colspan="4">+ ${arr.length - MAX_ROWS} more — ${h.esc(moreLabel)}</td></tr>`;
      }
      return html;
    };

    const spurRows = _rows(spurs, r => `
      <tr>
        <td>${h.esc(r.floor || '—')}</td>
        <td>${h.esc(r.room || '—')}</td>
        <td>${h.esc(r.system || 'Shade')}${r.id ? ` <span class="er-dim">· ${h.esc(r.id)}</span>` : ''}</td>
        <td class="er-req">${h.esc(r.note || 'Fused spur — BY ELECTRICAL')}</td>
      </tr>`, 'No fused spurs required on this takeoff.', 'see Shades Schedule for the full list');

    const supplyItems = panels.map(p => ({
      what: p.name || (p.kind === 'lighting' ? 'Lighting panel' : 'Shade panel'),
      kind: (p.kind === 'lighting') ? 'LIGHTING PANEL' : 'SHADE PANEL',
      floor: p.floor || '—', room: p.room || '—',
      req: p.supply || '230 V supply — BY ELECTRICAL',
      extra: (p.count != null && p.cap != null) ? (p.count + ' / ' + p.cap + ' ways') : ''
    })).concat(racks.map(r => ({
      what: r.name || 'Equipment rack', kind: 'EQUIPMENT RACK',
      floor: r.floor || '—', room: r.room || '—',
      req: 'Dedicated 230 V radial · 2 × 13 A double sockets adjacent — BY ELECTRICAL',
      extra: ''
    })));
    const supplyRows = supplyItems.length
      ? supplyItems.slice(0, MAX_ROWS).map(x => `
      <tr>
        <td><span class="er-kind">${h.esc(x.kind)}</span> ${h.esc(x.what)}${x.extra ? ` <span class="er-dim">· ${h.esc(x.extra)}</span>` : ''}</td>
        <td>${h.esc(x.floor)}</td>
        <td>${h.esc(x.room)}</td>
        <td class="er-req">${h.esc(x.req)}</td>
      </tr>`).join('') + (supplyItems.length > MAX_ROWS
        ? `<tr class="er-more"><td colspan="4">+ ${supplyItems.length - MAX_ROWS} more supplies</td></tr>` : '')
      : `<tr class="er-empty"><td colspan="4">No panels or racks placed yet — supplies to be confirmed at design freeze.</td></tr>`;

    const svc11Rows = _rows(svc11, r => `
      <tr>
        <td>${h.esc(r.floor || '—')}</td>
        <td>${h.esc(r.room || '—')}</td>
        <td colspan="2">${h.esc(r.label || r.code || '—')}</td>
      </tr>`, 'No service-11 electrical placements on this takeoff.', 'see the Electrical Plans following this page');

    // v5.153.0 (Bryn: "similar to blinds, HVAC stats and manifold etc need
    // to be included in the electrical section as the 240v side will almost
    // always be done by electrician") — UFH manifolds + thermostats.
    const hvacRows = _rows(hvac, r => `
      <tr>
        <td><span class="er-kind">${h.esc(r.kind === 'manifold' ? 'MANIFOLD' : 'THERMOSTAT')}</span> ${h.esc(r.name || '—')}</td>
        <td>${h.esc(r.floor || '—')}</td>
        <td>${h.esc(r.room || '—')}</td>
        <td class="er-req">${h.esc(r.supply || '240 V side — BY ELECTRICAL')}</td>
      </tr>`, 'No HVAC electrical items on this takeoff.', 'see the HVAC Schedule for the full list');

    // v5.268.0 — LED lighting 230 V side (head-end radials + dimmed feeds, local spurs / dimmed lives) from the one LED engine
    const ledRows = _rows(led, r => `
      <tr>
        <td><span class="er-kind">${h.esc(r.kind || 'LED')}</span> ${h.esc(r.what || '—')}</td>
        <td>${h.esc(r.floor || '—')}</td>
        <td>${h.esc(r.room || '—')}</td>
        <td class="er-req">${h.esc(r.req || '230 V supply — BY ELECTRICAL')}</td>
      </tr>`, 'No LED strip drivers on this project.', 'see the LED pack (LED Calc) for every circuit');
    const ledTot = (d.led && d.led.totals) || null;
    const ledHead = 'LED LIGHTING — DRIVERS &amp; HEAD ENDS' + (ledTot ? ` <span class="er-dim">· ${h.esc(String(Math.round(ledTot.input_w || 0)))} W PSU input${d.led.source ? ' · ' + h.esc(d.led.source) : ''}</span>` : '');
    const chips = [
      { cap: 'Fused spurs',     val: spurs.length },
      { cap: 'Shade panels',    val: panels.filter(p => p.kind !== 'lighting').length },
      { cap: 'Lighting panels', val: panels.filter(p => p.kind === 'lighting').length },
      { cap: 'Racks',           val: racks.length },
      { cap: 'HVAC items',      val: hvac.length },   // v5.153.0
      { cap: 'LED supplies',    val: led.length },    // v5.268.0
      { cap: '11 Electrical items', val: svc11.length }
    ].map(x => `
      <div class="er-chip">
        <div class="er-chip-val">${h.esc(String(x.val))}</div>
        <div class="er-chip-cap">${h.esc(x.cap)}</div>
      </div>`).join('');

    const notes = [
      'All 230 V works shown are BY THE ELECTRICAL CONTRACTOR and must be installed, tested and certified to BS 7671 (18th Edition) by others. Sonor items are extra-low-voltage unless flagged here.',
      'Fused spurs for shade systems: unswitched 13 A fused connection unit adjacent to the motor position (motor side as drawn), fed from a local lighting or dedicated circuit as directed by the electrical designer.',
      'Shade / lighting panel supplies must be in place, energised and certified BEFORE second-fix commissioning. Panel locations as drawn — confirm final positions on site with the Sonor engineer.',
      'Maintain 300 mm minimum parallel separation between mains-voltage runs and all Sonor ELV cabling; cross at 90° where separation cannot be held.',
      'UFH manifold wiring centres need a local 230 V supply; stat 230 V sides and switched lives wire to the wiring centre — all BY THE ELECTRICAL CONTRACTOR (Sonor provides control/ELV integration only). Equipment racks require ventilated locations. Rack supplies must be on dedicated radials — no shared ring finals.',
      // v5.198.0 — the watermark sentence follows the export mode (override
      // = AS ARCHITECT SPEC stamped on every floor; the old text promised a
      // NO REQUIREMENTS stamp the reader then couldn't find).
      (o.planMode === 'override'
        ? 'Coordinate containment routes with the Sonor first-fix package; electrical plans for every floor follow this sheet, stamped ' + (o.watermarkText || 'AS ARCHITECT SPEC') + ' — the 230 V works are defined by the architect / electrical designer, Sonor blocks are withheld from those sheets.'
        : 'Coordinate containment routes with the Sonor first-fix package; electrical plans for every floor follow this sheet (a ' + (o.watermarkText || 'NO REQUIREMENTS') + ' watermark marks floors with nothing in electrical scope).')
    ].map(n => `<li>${h.esc(n)}</li>`).join('');

    const body = `
  <div class="page page-elecreq${_compact}" style="--accent: ${accent}">
    ${c.pageHeader(Object.assign({}, o, { sectionTitle: o.sectionTitle || 'TRADES REQUIREMENTS — ELECTRICAL' }))}
    <main class="page-body page-body-elecreq">
      <div class="page-section-head">
        <div class="page-section-title">
          <span class="page-section-eyebrow">BY ELECTRICAL CONTRACTOR</span>
          <span class="page-section-name">Electrical Requirements</span>
          <span class="page-section-accent-line"></span>
        </div>
        <div class="er-chips">${chips}</div>
      </div>
      <div class="er-grid">
        <div class="er-col">
          <section class="er-card">
            <header class="er-card-head">FUSED SPURS — SHADE SYSTEMS</header>
            <table class="er-table">
              <thead><tr><th>Floor</th><th>Room</th><th>System</th><th>Requirement</th></tr></thead>
              <tbody>${spurRows}</tbody>
            </table>
          </section>
          <section class="er-card">
            <header class="er-card-head">230 V SUPPLIES — PANELS &amp; RACKS</header>
            <table class="er-table">
              <thead><tr><th>Item</th><th>Floor</th><th>Room / Zone</th><th>Requirement</th></tr></thead>
              <tbody>${supplyRows}</tbody>
            </table>
          </section>
          ${led.length ? `<section class="er-card">
            <header class="er-card-head">${ledHead}</header>
            <table class="er-table">
              <thead><tr><th>Item</th><th>Floor</th><th>Room / Location</th><th>Requirement</th></tr></thead>
              <tbody>${ledRows}</tbody>
            </table>
          </section>` : ''}
        </div>
        <div class="er-col er-col-side">
          <section class="er-card">
            <header class="er-card-head">HVAC — 240 V SIDE BY ELECTRICAL</header>
            <table class="er-table">
              <thead><tr><th>Item</th><th>Floor</th><th>Room</th><th>Requirement</th></tr></thead>
              <tbody>${hvacRows}</tbody>
            </table>
          </section>
          <section class="er-card">
            <header class="er-card-head">SERVICE 11 — ELECTRICAL PLACEMENTS</header>
            <table class="er-table">
              <thead><tr><th>Floor</th><th>Room</th><th colspan="2">Item</th></tr></thead>
              <tbody>${svc11Rows}</tbody>
            </table>
          </section>
          <section class="er-card er-card-notes">
            <header class="er-card-head">STANDARDS &amp; COORDINATION</header>
            <ul class="er-notes">${notes}</ul>
          </section>
        </div>
      </div>
    </main>
    ${c.pageFooter(o)}
  </div>
    `;
    return _wrapDoc(body, css, 'Sonor — Electrical Requirements', { pdfTheme: o.pdfTheme });
  }


  // ---- buildBuilderRequirementsPage (v1.17.0, 2026-10-16) -----------------
  // TRADES REQUIREMENTS — BY BUILDER (Bryn: "the pdf needs a trades requirements section for listing parts like this"):
  // TV niches, ply pattresses (TV stud walls + AT screens), blind pockets. Same er-* chrome as the electrical page so the two
  // trades sheets read as one family. o.builder = window._builderRequirementsData().
  function buildBuilderRequirementsPage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || '#8d6e4b');   // 12 Construction
    const d = o.builder || {};
    const niches = Array.isArray(d.niches) ? d.niches : [];
    const pats = Array.isArray(d.pattresses) ? d.pattresses : [];
    const pockets = Array.isArray(d.pockets) ? d.pockets : [];
    const _populated = [niches, pats, pockets].filter(a => a.length).length;
    const MAX_ROWS = Math.max(6, Math.floor(30 / Math.max(1, _populated)));
    const _compact = (niches.length + pats.length + pockets.length) > 14 ? ' er-compact' : '';
    const _rows = (arr, emptyMsg) => {
      if (!arr.length) return `<tr class="er-empty"><td colspan="5">${h.esc(emptyMsg)}</td></tr>`;
      let html = arr.slice(0, MAX_ROWS).map(r => `
      <tr>
        <td>${h.esc(r.floor || '—')}</td>
        <td>${h.esc(r.room || '—')}${r.id ? ` <span class="er-dim">· ${h.esc(r.id)}</span>` : ''}</td>
        <td>${h.esc(r.what || '')}</td>
        <td class="er-req">${h.esc(r.dims || '')}</td>
        <td>${h.esc(r.note || '')}</td>
      </tr>`).join('');
      if (arr.length > MAX_ROWS) html += `<tr class="er-more"><td colspan="5">+ ${arr.length - MAX_ROWS} more — see the Displays / Shades schedules</td></tr>`;
      return html;
    };
    const chips = [
      { cap: 'TV niches', val: niches.length }, { cap: 'Ply pattresses', val: pats.length }, { cap: 'Blind pockets', val: pockets.length }
    ].map(x => `<div class="er-chip"><div class="er-chip-val">${h.esc(String(x.val))}</div><div class="er-chip-cap">${h.esc(x.cap)}</div></div>`).join('');
    const notes = [
      'All builder\'s work shown is BY THE MAIN CONTRACTOR / JOINER and must be complete before Sonor second fix. Sizes are the finished opening — confirm the chosen display and bracket with the Sonor engineer before forming any niche.',
      'TV niches: form with a solid back (18 mm ply) for the bracket fixings; allow a 230 V double socket and the Sonor back-boxes INSIDE the recess, with cable access to the adjacent containment. Equipment recesses need ventilation top and bottom.',
      'Ply pattresses on stud walls: 18 mm WBP ply let in flush between studs over the full bracket footprint, screwed to studs, before boarding. Full-motion and motorised brackets carry the panel 600 mm+ off the wall — the pattress takes the whole load.',
      'Blind pockets: minimum 120 × 120 mm clear, square and plumb, full width of the opening plus 25 mm each side; motor side as drawn. Wired systems need the control cable brought into the pocket before plastering.',
      'Keep every opening clear of 230 V runs except the sockets shown; maintain 300 mm separation from Sonor ELV cabling.'
    ].map(n => `<li>${h.esc(n)}</li>`).join('');
    const body = `
  <div class="page page-elecreq${_compact}" style="--accent: ${accent}">
    ${c.pageHeader(Object.assign({}, o, { sectionTitle: o.sectionTitle || 'TRADES REQUIREMENTS — BUILDER' }))}
    <main class="page-body page-body-elecreq">
      <div class="page-section-head">
        <div class="page-section-title">
          <span class="page-section-eyebrow">BY MAIN CONTRACTOR / JOINER</span>
          <span class="page-section-name">Builder's Work</span>
          <span class="page-section-accent-line"></span>
        </div>
        <div class="er-chips">${chips}</div>
      </div>
      <div class="er-grid">
        <div class="er-col">
          <section class="er-card">
            <header class="er-card-head">TV NICHES — FLUSH &amp; EQUIPMENT RECESSES</header>
            <table class="er-table">
              <thead><tr><th>Floor</th><th>Room</th><th>Item</th><th>Opening (W × H × D)</th><th>Notes</th></tr></thead>
              <tbody>${_rows(niches, 'No TV niches on this takeoff.')}</tbody>
            </table>
          </section>
          <section class="er-card">
            <header class="er-card-head">PLY PATTRESSES — STUD WALLS &amp; SCREENS</header>
            <table class="er-table">
              <thead><tr><th>Floor</th><th>Room</th><th>Item</th><th>Requirement</th><th>Notes</th></tr></thead>
              <tbody>${_rows(pats, 'No pattresses flagged — every display is on a solid wall.')}</tbody>
            </table>
          </section>
        </div>
        <div class="er-col er-col-side">
          <section class="er-card">
            <header class="er-card-head">BLIND POCKETS &amp; RECESSED HEADERS</header>
            <table class="er-table">
              <thead><tr><th>Floor</th><th>Room</th><th>Item</th><th>Size</th><th>Notes</th></tr></thead>
              <tbody>${_rows(pockets, 'No pocketed or recessed blinds on this takeoff.')}</tbody>
            </table>
          </section>
          <section class="er-card er-card-notes">
            <header class="er-card-head">STANDARDS &amp; COORDINATION</header>
            <ul class="er-notes">${notes}</ul>
          </section>
        </div>
      </div>
    </main>
    ${c.pageFooter(o)}
  </div>
    `;
    return _wrapDoc(body, css, 'Sonor — Trades Requirements (Builder)', { pdfTheme: o.pdfTheme });
  }

  // ---- buildRearPage (v1.16.0, 2026-10-16, §41) --------------------------
  // The REAR CONTACT PAGE every Sonor document ends on (Bryn 2026-10-16: the running footer carries page numbers only — the full
  // contact details go on a rear page). Mirrors sonor-pdf-luxury rearPage(): dark page, mark + wordmark, tagline, gold hairline,
  // four contact cells, company line, CEDIA. opts: { tagline, emailNew, emailService, phone, web, company, projectMeta }.
  function buildRearPage(opts, css) {
    const o = opts || {};
    const h = _h();
    const wordmarkUrl = (typeof window !== 'undefined' && (window.__SONOR_WORDMARK_PDF_WHITE__ || window.__SONOR_WORDMARK_PDF__)) || '';
    const cells = [
      ['NEW PROJECTS & PROPOSALS', o.emailNew || 'projects@sonor.co.uk'],
      ['SERVICE & SUPPORT', o.emailService || 'service@sonor.co.uk'],
      ['TELEPHONE', o.phone || '+44 7933 684 000'],
      ['WEB', o.web || 'sonor.co.uk']
    ];
    const body = `
  <section class="rear-page">
    <div class="hero-lux-frame"></div>
    <div class="hero-lux-brand">${wordmarkUrl ? `<img class="hero-lux-logo" src="${wordmarkUrl}" alt="SONOR">` : '<span class="hero-lux-logo-fallback">SONOR</span>'}</div>
    <div class="rear-block">
      <div class="rear-tagline">${h.esc(o.tagline || 'Smart homes, beautifully done.')}</div>
      <div class="rear-rule"></div>
      <div class="rear-cells">${cells.map(c => `<div class="rear-cell"><div class="rear-cell-k">${h.esc(c[0])}</div><div class="rear-cell-v">${h.esc(c[1])}</div></div>`).join('')}</div>
      <div class="rear-company">${h.esc(o.company || 'Sonor Ltd  ·  Chester, England  ·  Trusted by homeowners across the North West & Wales')}</div>
    </div>
    <div class="rear-foot"><span class="rear-cedia">CEDIA MEMBER</span>${o.projectMeta && o.projectMeta.ref ? `<span class="rear-ref">${h.esc(o.projectMeta.ref)}</span>` : ''}</div>
  </section>`;
    return _wrapDoc(body, css, 'Sonor — Contact', { pdfTheme: o.pdfTheme });
  }

  // ---- buildSectionDivider -------------------------------------------------
  // v1.4.0 — divider polish: bigger eyebrow, accent corner ornament,
  // service strip echoed at the bottom, the divider acts as a visual
  // breath between deliverable sections.
  function buildSectionDivider(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = o.accentHex || GOLD;
    const meta = o.projectMeta || {};
    const owner = o.owner || {};
    const services = (Array.isArray(o.services) && o.services.length) ? o.services : null;

    const body = `
  <div class="section-divider section-divider-v2" style="--accent: ${accent}">
    <div class="sd-header">
      <span>SECTION DIVIDER</span>
      <span class="sd-header-right">${h.esc(meta.code || '')}</span>
    </div>
    <div class="sd-accent-bar"></div>
    <!-- v5.18.0 — Top-right brand mark. Replaces the v1.4.1 fading 2×2
         accent squares (read as a broken placeholder). The divider canvas
         is light, so prefer the DARK wordmark; the white variant is tinted
         dark via CSS when that's all that's loaded. -->
    ${(function () {
      const wmDark  = (typeof window !== 'undefined') && window.__SONOR_WORDMARK_PDF__;
      const wmWhite = (typeof window !== 'undefined') && window.__SONOR_WORDMARK_PDF_WHITE__;
      if (wmDark)  return `<img class="sd-corner-mark" src="${wmDark}" alt="SONOR" aria-hidden="true">`;
      if (wmWhite) return `<img class="sd-corner-mark sd-corner-mark-tintdark" src="${wmWhite}" alt="SONOR" aria-hidden="true">`;
      return '';
    })()}
    <div class="sd-hero">
      <div class="sd-eyebrow">— SECTION —</div>
      <div class="sd-title">${h.esc(o.title || '')}</div>
      <div class="sd-accent-line"></div>
      ${o.subtitle ? `<div class="sd-subtitle">${h.esc(o.subtitle)}</div>` : ''}
      ${owner.status ? `<div class="sd-status-pill">${h.esc(owner.status.toUpperCase())}</div>` : ''}
      ${c.ownerCard(owner)}
    </div>
    ${services ? `<div class="sd-service-strip">${c.serviceStrip(services, { wrapClass: 'footer-svc-strip footer-svc-strip-sd' }).replace(/^<span/, '<span').replace(/<\/span>$/, '</span>')}</div>` : ''}
    <div class="sd-footer">
      <span>${h.esc(meta.name || '')} · ${h.esc(meta.ref || '')} · ${h.esc(meta.status || '')}</span>
      <span>${h.esc(meta.date || '')} · Sonor</span>
    </div>
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — ' + (o.title || 'Section'), { pdfTheme: o.pdfTheme });
  }

  // ---- buildImagePage ------------------------------------------------------
  // v1.7.4 — Snapshot/drawing pages with the same Takeoffs-style chrome
  // wrapped around a single embedded image.
  // v1.8.0 — Optional CAD title block overlay at bottom-right of the
  // snapshot (CAD-standard convention). Includes room dim summary,
  // scale bar, drawing code, and view orientation marker. Caller passes
  // opts.dimsBlock = { dimsLine, scaleBar, drawingCode, viewLabel }.
  //
  // Bryn improvements list #13: 'Snapshot pages — dimension overlay
  // layer. Render an overlay layer on the PDF side that adds the room
  // W × D / wall H dimension callouts + scale bar + view orientation
  // + the title block in the bottom-right corner (CAD-standard).'
  //
  // opts: {
  //   pdfTheme, accentHex, appName, sectionTitle, subtitle,
  //   reference, projectName, revision, status, issueDate,
  //   pageNum, pageTotal, services,
  //   imageDataUrl,                 — required: full-page snapshot image
  //   imageAlt?,                    — img alt text
  //   summary { headline, chips }?  — optional top-right summary card
  //   sectionEyebrow?               — defaults to 'PLAN'
  //   dimsBlock?: {                 — v1.8.0 CAD title block overlay
  //     dimsLine,                   — e.g. '3850 × 3700 × 2500 mm (L×W×H)'
  //     scaleBar?,                  — e.g. '1 : 50 @ A3'
  //     drawingCode?,               — e.g. 'CD-PLN-01'
  //     viewLabel?,                 — e.g. 'PLAN VIEW' / 'SCREEN WALL'
  //     northArrow?: 'plan'|'none'  — show N↑ arrow for plan-view pages
  //   }
  //   legendItems?: [               — v1.8.1 compact legend strip top-left
  //     { symbol: 'dot'|'line'|'rect', colour, label }
  //   ]
  // }
  function buildImagePage(opts, css) {
    const o = opts || {};
    const h = _h(), c = _c();
    const accent = h.esc(o.accentHex || GOLD);
    const eyebrow = h.esc(o.sectionEyebrow || 'PLAN');
    const imgSrc = o.imageDataUrl || '';
    const imgAlt = h.esc(o.imageAlt || o.sectionTitle || 'Cinema view');
    const db = o.dimsBlock || null;

    // v1.8.1 — Compact legend strip (top-left of image-wrap). Bryn list #14.
    // Tiny per-view symbol legend rendered as a horizontal pill row so it
    // doesn't reduce snapshot real estate the way a full sidebar would.
    let legendStrip = '';
    if (Array.isArray(o.legendItems) && o.legendItems.length) {
      const items = o.legendItems.map(item => {
        const col = h.esc(item.colour || accent);
        const lab = h.esc(item.label || '');
        let mark = '';
        if (item.symbol === 'line') {
          mark = `<span style="display:inline-block;width:14px;height:2.5px;background:${col};vertical-align:middle;margin-right:5px;border-radius:1px;"></span>`;
        } else if (item.symbol === 'rect') {
          mark = `<span style="display:inline-block;width:9px;height:9px;background:${col};opacity:.5;vertical-align:middle;margin-right:5px;border:1px solid ${col};"></span>`;
        } else { // dot (default)
          mark = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};vertical-align:middle;margin-right:5px;"></span>`;
        }
        return `<span style="display:inline-flex;align-items:center;font-size:8.5px;color:#2c2218;font-weight:500;">${mark}${lab}</span>`;
      }).join('<span style="display:inline-block;width:1px;height:10px;background:#d4cec2;margin:0 8px;vertical-align:middle;"></span>');
      legendStrip = `
        <div class="page-legend-strip" style="position:absolute;top:8px;left:30px;background:rgba(255,255,255,0.96);border:1px solid #d4cec2;border-radius:3px;padding:4px 10px;display:inline-flex;align-items:center;gap:0;font-family:Helvetica, Arial, sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <span style="font-size:7.5px;color:#888;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-right:9px;border-right:1px solid #d4cec2;padding-right:9px;">KEY</span>
          ${items}
        </div>
      `;
    }

    // CAD title block overlay (positioned absolute bottom-right of image-wrap)
    let titleBlock = '';
    if (db) {
      const dimsLine = h.esc(db.dimsLine || '');
      const scaleBar = h.esc(db.scaleBar || '');
      const drawingCode = h.esc(db.drawingCode || '');
      const viewLabel = h.esc(db.viewLabel || eyebrow);
      const northArrow = db.northArrow === 'plan' ? `
        <svg width="34" height="34" viewBox="0 0 40 40" style="position:absolute;top:8px;right:8px;opacity:.85;">
          <circle cx="20" cy="20" r="18" fill="#fff" stroke="${accent}" stroke-width="1"/>
          <polygon points="20,4 24,22 20,18 16,22" fill="${accent}"/>
          <text x="20" y="35" text-anchor="middle" font-size="9" font-weight="700" fill="${accent}" font-family="Helvetica, Arial, sans-serif">N</text>
        </svg>
      ` : '';
      titleBlock = `
        <div class="cad-title-block" style="position:absolute;bottom:14px;right:30px;background:rgba(255,255,255,0.96);border:1px solid ${accent};border-radius:3px;padding:0;font-family:Helvetica, Arial, sans-serif;font-size:9px;color:#2c2218;box-shadow:0 1px 4px rgba(0,0,0,0.08);min-width:240px;max-width:300px;">
          <div style="background:${accent};color:#fff;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:0.5px;font-size:8.5px;text-transform:uppercase;">
            <span>${viewLabel}</span>
            ${drawingCode ? `<span style="opacity:.85">${drawingCode}</span>` : ''}
          </div>
          <div style="padding:6px 10px 7px;display:grid;grid-template-columns:auto 1fr;gap:3px 10px;align-items:baseline;">
            ${dimsLine ? `<span style="color:#888;font-size:7.5px;text-transform:uppercase;letter-spacing:0.4px;">DIMS</span><span style="font-weight:600;font-family:'DM Mono', Menlo, monospace;font-size:8.5px;">${dimsLine}</span>` : ''}
            ${scaleBar ? `<span style="color:#888;font-size:7.5px;text-transform:uppercase;letter-spacing:0.4px;">SCALE</span><span style="font-weight:600;">${scaleBar}</span>` : ''}
          </div>
        </div>
        ${northArrow}
      `;
    }

    const body = `
  <div class="page page-image" style="--accent: ${accent}">
    ${c.pageHeader(o)}
    <main class="page-body page-body-image">
      <div class="page-section-head">
        <div class="page-section-title">
          <span class="page-section-eyebrow">${eyebrow}</span>
          <span class="page-section-name">${h.esc(o.sectionTitle || '')}</span>
          <span class="page-section-accent-line"></span>
        </div>
        ${c.summaryChip(o.summary || {})}
      </div>
      <div class="page-image-wrap" style="flex:1;display:flex;align-items:center;justify-content:center;padding:12px 24px 24px;background:#fff;position:relative;">
        ${imgSrc
          ? `<img src="${h.esc(imgSrc)}" alt="${imgAlt}" style="max-width:100%;max-height:100%;object-fit:contain;display:block;border:1px solid var(--border-soft, #e6e0d4);border-radius:4px;background:#fff;" />`
          : `<div style="color:#8B7D6B;font-size:13px;font-style:italic;">Snapshot unavailable — open Cinema Takeoff to view live.</div>`}
        ${legendStrip}
        ${titleBlock}
      </div>
    </main>
    ${c.pageFooter(o)}
  </div>
    `;

    return _wrapDoc(body, css, 'Sonor — ' + (o.sectionTitle || 'View'), { pdfTheme: o.pdfTheme });
  }

  if (typeof window !== 'undefined') {
    window.SonorPdfHtmlTemplates = {
      __version: '1.16.1',   // v1.16.x — OVERALL COUNTS head-end estimate / engineered section (B-468)
      buildCover, buildSectionDivider, buildRearPage, buildSchedule, buildPlanPage,
      buildContents, CONTENTS_METRICS,   // v5.146.0 — contents through the HTML pipeline
      buildCablingInfoPage, buildBendRadiusPage, buildOverallCountsPage,
      buildElectricalRequirementsPage,
      buildBuilderRequirementsPage,
      buildImagePage
    };
  }
})();
