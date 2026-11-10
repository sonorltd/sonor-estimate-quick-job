/* ============================================================================
   sonor-pdf-v6-schedule.js  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   Native vector schedule painter. Replaces:
     • CD's _paintNativeScheduleInline (~270 LOC, with v5.41.1 hotfix)
     • Takeoffs' schedule path inside the 11,817-line monolith
     • CT's schedule emission for the BoM tab

   Single contract per audit §7:
     paint(page, ctx, table, opts) → { y, overflow, overflowRows }

   Table shape:
     {
       title?: string,                  // small caps subtitle above the table
       headers: [{ key, label, align?, width?, weight? }],
       rows:    [
         { values: [...] },              // value row (positional)
         { ...keyed },                   // value row (keyed by header.key)
         { _group: 'GROUP LABEL', _accent?: '#hex' },
         { paragraph: 'text...' },       // single-column body text row
       ],
       total?:  { label, values: [...] }
     }

   Auto-paginates: when a row would cross the body bounds, the painter returns
   `{ overflow: true, overflowRows: remainingRows }` and the orchestrator adds
   a new page and recurses. Group separators always start a new page if there
   isn't room for the separator + at least 1 row.

   Selectable + searchable: every cell is a real pdf-lib text run, never an
   image. Closes audit finding §3 (HTML pipeline rasterised tables to JPEG).

   Exposes window.SonorPdfV6Schedule = { paint, estimateRows }.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Schedule && window.SonorPdfV6Schedule.VERSION) return;

  const H = window.SonorPdfV6Helpers;
  const T = window.SonorPdfV6Tokens;
  const C = window.SonorPdfV6Chrome;

  // --- Standard row metrics (pt) ---
  const ROW_H        = 22;
  const HEADER_H     = 24;
  const GROUP_H      = 22;
  const TOTAL_H      = 32;
  const PARAGRAPH_H  = 18;
  const PAD_X        = 14;
  const SUBTITLE_GAP = 22;

  /**
   * Resolve a cell value from a row, by index OR key.
   * Supports both shapes used across Sonor PDF history (Takeoffs uses values[i],
   * CD uses keyed objects, CT uses both).
   */
  function _cellValue(row, header, idx) {
    if (Array.isArray(row.values) && row.values[idx] != null) return row.values[idx];
    if (header && header.key && row[header.key] != null) return row[header.key];
    return '';
  }

  /**
   * Estimate how many rows fit in a given vertical budget. Useful for
   * pre-walking how many pages a long schedule will take so the orchestrator
   * can stamp accurate "Page X of Y" totals.
   *
   * @param {number}   availableH  vertical budget (pt)
   * @param {Array}    rows
   * @returns {number} approx rows that fit
   */
  function estimateRows(availableH, rows) {
    if (!availableH || !Array.isArray(rows)) return 0;
    let used = HEADER_H + SUBTITLE_GAP;
    let n = 0;
    for (const r of rows) {
      const h = r._group ? GROUP_H : (r.paragraph ? PARAGRAPH_H : ROW_H);
      if (used + h > availableH) return n;
      used += h;
      n++;
    }
    return n;
  }

  /**
   * Paint one (or part of one) schedule onto the current page.
   * Returns `{ overflow: false }` if it fully fit, otherwise
   * `{ overflow: true, overflowRows: [...] }` so the orchestrator can
   * continue on the next page (with the same chrome).
   *
   * @param {PDFPage} page
   * @param {object}  ctx       paint context (chrome ctx)
   * @param {object}  table     { title, headers, rows, total }
   * @param {object}  [opts]
   *   - x, y       top-left of table (default: chrome body-bounds top)
   *   - w          table width (default: body width)
   *   - subtitle   small-caps text above the table
   *   - accent     theme accent override for header row
   */
  function paint(page, ctx, table, opts) {
    const o = Object.assign({}, opts);
    const fonts = ctx.fonts;
    const bounds = C.bodyBounds(ctx.format || 'A3', ctx.orientation || 'landscape');
    const accent = o.accent || T.themeAccent(ctx.theme || 'cinema');

    const x = (o.x != null) ? o.x : bounds.x;
    const w = (o.w != null) ? o.w : bounds.w;
    let   y = (o.y != null) ? o.y : (bounds.y + bounds.h);    // top of table

    const bodyBottom = bounds.y + 30; // reserve 30pt above footer

    // ---- Optional subtitle row -----------------------------------------
    if (o.subtitle) {
      y -= 16;
      H.drawText(page, String(o.subtitle).toUpperCase(), {
        x, y, font: fonts.bold, size: 11, color: accent, letterSpacing: 3,
      });
      y -= 8;
    }

    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
      return { overflow: false };
    }

    // ---- Header row ----------------------------------------------------
    y -= HEADER_H;
    page.drawRectangle({
      x, y, width: w, height: HEADER_H,
      color: H.toLibRgb(T.themeColours(ctx.theme || 'cinema').dark),
    });
    table.headers.forEach((hdr) => {
      const cellX = _colX(x, w, table.headers, hdr);
      const align = hdr.align || 'left';
      const lblX  = align === 'right' ? cellX + _colW(w, table.headers, hdr) - PAD_X
                  : align === 'center' ? cellX + _colW(w, table.headers, hdr) / 2
                  : cellX + PAD_X;
      H.drawText(page, String(hdr.label || '').toUpperCase(), {
        x: lblX, y: y + 8,
        font: fonts.bold, size: 10, color: T.BASE.white,
        align, letterSpacing: 1.5,
      });
    });

    // ---- Data rows -----------------------------------------------------
    const remaining = [];
    let overflowed = false;
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];

      // -- Group separator --
      // v6.0.0-rc.2 — accept BOTH shapes: v6-native {_group, _accent} and
      // v5-legacy {group:true, label, accent}. Lets adapters pass through
      // existing v5 row structures without rewriting every data extractor.
      const groupLabel = row._group || (row.group === true ? row.label : null);
      if (groupLabel) {
        const groupColour = row._accent || row.accent || accent;
        // v7.5.0 — pagination polish: a group header must NOT be the last
        // visible row on a page (orphaned group). Require GROUP_H + at least
        // one ROW_H of headroom before emitting. If the next row is a
        // paragraph, demand PARAGRAPH_H instead. Forces the group + its
        // first data row onto the same page, every time.
        const nextRow = table.rows[i + 1];
        const followingH = (nextRow && nextRow.paragraph) ? PARAGRAPH_H : ROW_H;
        const needed = GROUP_H + followingH;
        if (y - needed < bodyBottom + (table.total ? TOTAL_H : 0)) {
          overflowed = true; remaining.push(...table.rows.slice(i)); break;
        }
        y -= GROUP_H;
        page.drawRectangle({
          x, y, width: w, height: GROUP_H,
          color: H.toLibRgb(groupColour),
          opacity: 0.14,
        });
        // v6.0.0-rc.4 (2026-08-01) — draw the COMPUTED groupLabel. The rc.2
        // dual-shape acceptance derived groupLabel from either {_group} or
        // v5-legacy {group:true,label} but this draw still read row._group —
        // every v5-shape group banner would have rendered "UNDEFINED".
        H.drawText(page, String(groupLabel).toUpperCase(), {
          x: x + PAD_X, y: y + 7,
          font: fonts.bold, size: 10, color: groupColour,
          letterSpacing: 2,
        });
        continue;
      }

      // -- Single-column paragraph row --
      if (row.paragraph) {
        const lines = H.wrapText(row.paragraph, { font: fonts.reg, size: 11, maxWidth: w - 2 * PAD_X });
        const needed = Math.max(PARAGRAPH_H, lines.length * 14 + 6);
        if (y - needed < bodyBottom + (table.total ? TOTAL_H : 0)) {
          overflowed = true; remaining.push(...table.rows.slice(i)); break;
        }
        y -= needed;
        lines.forEach((line, li) => {
          H.drawText(page, line, {
            x: x + PAD_X, y: y + needed - 14 - li * 14,
            font: fonts.reg, size: 11, color: T.BASE.text,
          });
        });
        // Faint divider below paragraph
        page.drawLine({
          start: { x: x + PAD_X, y: y - 1 },
          end:   { x: x + w - PAD_X, y: y - 1 },
          color: H.toLibRgb(T.BASE.muted),
          thickness: 0.3,
          opacity: 0.4,
        });
        continue;
      }

      // -- Standard value row --
      if (y - ROW_H < bodyBottom + (table.total ? TOTAL_H : 0)) {
        overflowed = true; remaining.push(...table.rows.slice(i)); break;
      }
      // v7.5.0 — widow guard: don't leave a single orphan row on the next
      // page. If this is the SECOND-TO-LAST row AND emitting it would force
      // the last row alone onto a new page (i.e., last row is a standard
      // data row and we have exactly enough space for ME but not for both),
      // defer overflow so the final two rows ship together on the next page.
      // Only applies when at least 3 rows have already shipped on this page
      // (avoid spuriously triggering at top of page when everything fits).
      const isSecondToLast = (i === table.rows.length - 2);
      const lastRow = isSecondToLast ? table.rows[i + 1] : null;
      const lastIsDataRow = lastRow && !lastRow._group && !lastRow.paragraph && !(lastRow.group === true);
      if (isSecondToLast && lastIsDataRow) {
        const bothNeeded = 2 * ROW_H;
        const rowsShippedHere = (table.rows.length - i);  // including ME
        const headroom = y - bodyBottom - (table.total ? TOTAL_H : 0);
        if (headroom < bothNeeded && rowsShippedHere < table.rows.length) {
          overflowed = true; remaining.push(...table.rows.slice(i)); break;
        }
      }
      y -= ROW_H;
      // Zebra-strip every other row (very faint)
      if (i % 2 === 1) {
        page.drawRectangle({
          x, y, width: w, height: ROW_H,
          color: H.toLibRgb('#f5efe4'),
          opacity: 0.5,
        });
      }
      table.headers.forEach((hdr, hi) => {
        const cellX = _colX(x, w, table.headers, hdr);
        const cellW = _colW(w, table.headers, hdr);
        const align = hdr.align || 'left';
        const valX  = align === 'right' ? cellX + cellW - PAD_X
                    : align === 'center' ? cellX + cellW / 2
                    : cellX + PAD_X;
        const val = _cellValue(row, hdr, hi);
        const weight = hdr.weight || (hi === table.headers.length - 1 && align === 'right' ? 'bold' : 'reg');
        const font = H.resolveFont(fonts, weight);
        const truncated = _truncate(String(val), font, 11, cellW - PAD_X * 2);
        H.drawText(page, truncated, {
          x: valX, y: y + 7,
          font, size: 11, color: T.BASE.text,
          align,
        });
      });
    }

    // ---- Total row (only if not overflowed) ----------------------------
    if (!overflowed && table.total) {
      if (y - TOTAL_H < bodyBottom) {
        // Total row doesn't fit on this page — emit overflow with just the total row.
        return {
          overflow: true,
          overflowRows: [{ _totalOnly: true, total: table.total }],
        };
      }
      y -= TOTAL_H;
      page.drawRectangle({
        x, y, width: w, height: TOTAL_H,
        color: H.toLibRgb(T.themeColours(ctx.theme || 'cinema').dark),
      });
      H.drawText(page, (table.total.label || 'TOTAL').toUpperCase(), {
        x: x + PAD_X, y: y + 12,
        font: fonts.bold, size: 11, color: T.BASE.white, letterSpacing: 1.5,
      });
      if (Array.isArray(table.total.values)) {
        table.headers.forEach((hdr, hi) => {
          const val = table.total.values[hi];
          if (val == null || val === '') return;
          const cellX = _colX(x, w, table.headers, hdr);
          const cellW = _colW(w, table.headers, hdr);
          const align = hdr.align || 'left';
          const valX = align === 'right' ? cellX + cellW - PAD_X
                     : align === 'center' ? cellX + cellW / 2
                     : cellX + PAD_X;
          H.drawText(page, String(val), {
            x: valX, y: y + 12,
            font: fonts.bold, size: 11, color: T.BASE.white,
            align,
          });
        });
      }
    }

    // v7.6.0 — section sign-off footer. When the schedule completes on this
    // page (not overflowed), drop a small "Designed by Sonor · {date} · Rev"
    // line below the last row / totals row. Engineering doc convention —
    // every schedule closes with provenance. Skipped if the meta is missing
    // or there's no headroom. Pulls date + rev from ctx.meta (set by adapter
    // from _todayShort + project revision letter).
    if (!overflowed) {
      try {
        const meta = ctx.meta || {};
        const date = meta.issueDate || meta.date || '';
        const rev  = meta.revision || '';
        // Build sign-off — graceful when meta is partial
        const parts = ['Designed by Sonor'];
        if (date) parts.push(date);
        if (rev)  parts.push('Rev ' + rev);
        const signOff = parts.join('  ·  ');
        // Only stamp if there's room below the table (10pt clearance above footer)
        if (y - 18 > bodyBottom + 10) {
          y -= 18;
          // Tiny separator line above the sign-off, matching the muted-grey tone
          page.drawLine({
            start: { x: x + PAD_X,    y: y + 10 },
            end:   { x: x + w - PAD_X, y: y + 10 },
            color: H.toLibRgb(T.BASE.muted),
            thickness: 0.4,
            opacity: 0.5,
          });
          H.drawText(page, signOff, {
            x: x + w - PAD_X, y: y - 2,
            font: fonts.reg, size: 8, color: T.BASE.muted,
            align: 'right', letterSpacing: 1,
          });
        }
      } catch (_) { /* sign-off is decorative; never fail the export */ }
    }
    return overflowed
      ? { overflow: true, overflowRows: remaining, total: table.total }
      : { overflow: false, lastY: y };
  }

  /* ---- column width / x helpers --------------------------------------- */
  // Columns use either explicit `width: '120pt'` / `width: '20%'` or auto-equal.
  function _colW(tableW, headers, hdr) {
    if (hdr._cachedW != null) return hdr._cachedW;
    let totalFixed = 0, autoCount = 0;
    headers.forEach(h => {
      if (h.width) {
        const m = /^(\d+(?:\.\d+)?)(pt|%)?$/.exec(String(h.width));
        if (m) {
          h._fixedPt = m[2] === '%' ? tableW * parseFloat(m[1]) / 100 : parseFloat(m[1]);
          totalFixed += h._fixedPt;
        } else autoCount++;
      } else autoCount++;
    });
    const autoW = autoCount > 0 ? Math.max(40, (tableW - totalFixed) / autoCount) : 0;
    headers.forEach(h => { h._cachedW = h._fixedPt != null ? h._fixedPt : autoW; });
    return hdr._cachedW;
  }
  function _colX(tableX, tableW, headers, hdr) {
    let acc = tableX;
    for (const h of headers) {
      if (h === hdr) return acc;
      acc += _colW(tableW, headers, h);
    }
    return acc;
  }

  /* ---- truncate ------------------------------------------------------- */
  // v6.0.3 — sanitize input via the helpers' winAnsiSafe so widthOfTextAtSize
  // measures the same string that drawText will later paint. Also uses '...'
  // (three ASCII dots) instead of '…' (U+2026 ellipsis) for the truncation
  // marker since drawText itself would sanitize to '...' anyway.
  function _truncate(str, font, size, maxW) {
    const safe = (H && H.winAnsiSafe) ? H.winAnsiSafe(str) : str;
    if (!safe || font.widthOfTextAtSize(safe, size) <= maxW) return safe;
    let lo = 0, hi = safe.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const t = safe.slice(0, mid) + '...';
      if (font.widthOfTextAtSize(t, size) <= maxW) lo = mid; else hi = mid - 1;
    }
    return safe.slice(0, lo) + '...';
  }

  window.SonorPdfV6Schedule = {
    VERSION: '1.2.0',
    paint,
    estimateRows,
    ROW_H, HEADER_H, GROUP_H, TOTAL_H, PARAGRAPH_H,
  };
})();
