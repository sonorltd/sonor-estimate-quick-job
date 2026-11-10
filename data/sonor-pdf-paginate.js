// =============================================================================
// sonor-pdf-paginate.js — schedule pagination primitive
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root.
//
// Single responsibility: split a flat schedule item list into pages, honouring
// per-page item budgets. When a continuation page begins inside a group, the
// previous group's separator label is re-emitted at the top of the new page
// (with " (continued)" appended) so the reader doesn't lose context across
// page breaks.
//
// Pure function, deterministic, zero canvas/DOM/host scope. Extracted from
// sonor-takeoffs-pdf.js v5.4.42 _emitAspectIntoPdfHtml's closure-scope
// _paginateScheduleItems. Same algorithm; only the budgets are now opts
// (defaulting to the long-standing 22 / 28 constants — first page is tighter
// because chrome takes more vertical space, continuation pages are looser).
//
// First consumer: Takeoffs schedule emitter (rooms / symbols / cables / leds /
// lighting / shades / tvs). Cinema Takeoff inherits via sync.
//
// Public API:
//   SonorPdfPaginate.paginate(items, opts) → [{items, lastGroup}, ...]
//
// Item shape:
//   { group: true, label: string, accent?: string, _groupKey?: string }  ← group separator
//   { values: [...] }                                                    ← data row
//
// Behaviour contract:
//   - Empty input returns a single empty page so callers can iterate uniformly.
//   - First page budget defaults to 22; continuation pages default to 28.
//     Both overridable via opts.{firstPageBudget, contPageBudget}.
//   - When a continuation page starts mid-group, the synthesised separator
//     row counts toward the budget (matches original behaviour).
//   - lastGroup tracks the last group encountered; useful if the caller
//     wants to render a "group X continues" footer on the previous page.
//   - Stable: input array is not mutated. Returned page items are the SAME
//     references (not deep-cloned) — caller can rely on identity.
//
// Versioning:
//   v1.0.0 (2026-05-08) — initial extraction.
//   v1.1.0 (2026-05-11) — atomic device + soft-break room packing. Bryn
//     directive: "page break if a whole room doesn't fit the page —
//     especially dont split mid device". New opts:
//       - isDeviceStart(item) → bool: detects a row that begins a new
//         placement (atomic unit). Subsequent non-banner rows belong to
//         the same device until the next device-start. If the whole
//         device doesn't fit on the current page, the paginator forces
//         a page break BEFORE the device-start (never mid-device).
//       - isSoftBreakBanner(item) → bool: detects a banner that begins a
//         "preferred-atomic" group (e.g. a room sub-banner). If the
//         whole group fits in remaining budget keep it together; if not
//         AND >40% of the current page is already used, break first.
//         Falls back to splitting when a single room is bigger than a
//         whole page (acceptable degradation).
//     Both opts default to no-op (matches v1.0.0 behaviour).
//   v1.1.2 (2026-09-15) — floor banners soft-break only when the page is
//     ≥ 50% full (no more six-row pages before a new floor).

(function () {
  'use strict';

  const MODULE_VERSION = '1.1.2';
  const DEFAULT_FIRST_PAGE_BUDGET = 22;
  const DEFAULT_CONT_PAGE_BUDGET  = 28;

  // Look ahead from index i and return the index AFTER the last item that
  // belongs to the same atomic device. Returns i+1 when no device-start
  // detector is configured. Stops at any banner (banner ends the device).
  function _atomicDeviceEnd(items, i, isDeviceStart) {
    if (typeof isDeviceStart !== 'function') return i + 1;
    if (i >= items.length) return i;
    let j = i + 1;
    while (j < items.length) {
      const it = items[j];
      if (!it) { j++; continue; }
      if (it.group === true) break;     // banner ends the device
      if (isDeviceStart(it)) break;     // next device starts
      j++;
    }
    return j;
  }

  // Look ahead from index i and return the index AFTER the last item that
  // belongs to the same soft-break group (typically a room sub-banner +
  // every device within it). Stops at the next soft-break banner or any
  // higher-level (non-sub) banner.
  function _softBreakEnd(items, i, isSoftBreakBanner) {
    if (typeof isSoftBreakBanner !== 'function') return i + 1;
    if (i >= items.length) return i;
    let j = i + 1;
    while (j < items.length) {
      const it = items[j];
      if (!it) { j++; continue; }
      if (it.group === true) {
        if (isSoftBreakBanner(it)) break;   // next room
        if (it.kind !== 'sub') break;       // floor banner = hard boundary
      }
      j++;
    }
    return j;
  }

  function paginate(items, opts) {
    const o = opts || {};
    const firstBudget = Number.isFinite(o.firstPageBudget) ? o.firstPageBudget : DEFAULT_FIRST_PAGE_BUDGET;
    const contBudget  = Number.isFinite(o.contPageBudget)  ? o.contPageBudget  : DEFAULT_CONT_PAGE_BUDGET;
    const isDeviceStart    = (typeof o.isDeviceStart    === 'function') ? o.isDeviceStart    : null;
    const isSoftBreakBanner = (typeof o.isSoftBreakBanner === 'function') ? o.isSoftBreakBanner : null;
    // v1.1.0 (Takeoffs v5.47.0) — hard-break banners: a matching banner
    // (floor tier) ALWAYS starts a new page unless the current page has no
    // data rows yet (Bryn: "there should be a page break when a new floor
    // starts").
    const isHardBreakBanner = (typeof o.isHardBreakBanner === 'function') ? o.isHardBreakBanner : null;
    if (!Array.isArray(items) || items.length === 0) {
      return [{ items: [], lastGroup: null }];
    }
    const pages = [];
    let i = 0;
    let lastGroupBeforeBoundary = null;
    while (i < items.length) {
      const isFirst = pages.length === 0;
      const budget = isFirst ? firstBudget : contBudget;
      const chunk = [];
      // If continuation page starts mid-group, prepend the group label.
      // v1.1.1 — SKIP the "(continued)" banner when the page opens with a
      // real banner anyway (floor hard-break / next group) — otherwise the
      // previous floor's last room label prints above the new floor banner.
      if (!isFirst && lastGroupBeforeBoundary != null
          && !(items[i] && items[i].group === true)) {
        chunk.push({
          group: true,
          label: String(lastGroupBeforeBoundary.label || '') + ' (continued)',
          accent: lastGroupBeforeBoundary.accent,
          _groupKey: lastGroupBeforeBoundary._groupKey,
          kind: lastGroupBeforeBoundary.kind
        });
      }
      while (chunk.length < budget && i < items.length) {
        const it = items[i];
        // v1.1.0 — floor hard-break: new floor banner → new page, unless
        // this page carries no data rows yet (banners only / fresh page).
        if (isHardBreakBanner && it && it.group === true && isHardBreakBanner(it)) {
          let dataRowsOnPage = 0;
          for (const c of chunk) { if (c && !c.group) dataRowsOnPage++; }
          if (dataRowsOnPage > 0) break;   // start the floor on a fresh page
        }
        // Soft-break check: if this is a room sub-banner and the whole room
        // doesn't fit the remaining budget (but WOULD fit a fresh page),
        // break first. v1.1.0 — the old >40%-used condition dropped (Bryn:
        // "dont split rooms or devices over pages if they end up running
        // over"); rooms larger than a whole page still split (unavoidable).
        // Skipped on the very first row of a new page (empty-page guard).
        if (isSoftBreakBanner && it && it.group === true && isSoftBreakBanner(it)
            && chunk.length > (isFirst && lastGroupBeforeBoundary == null ? 0 : 1)) {
          const roomEnd = _softBreakEnd(items, i, isSoftBreakBanner);
          const roomLen = roomEnd - i;
          const remaining = budget - chunk.length;
          // v1.1.2 (Takeoffs v5.198.0) — a FLOOR banner only forces a fresh
          // page when the current page is at least half full; otherwise a
          // whole floor was pushed off a page holding six rows (Heybridge
          // Blocks Schedule p12). Room banners keep the strict rule.
          const isFloorBanner = it.kind === 'floor';
          if (roomLen > remaining && roomLen <= budget && (!isFloorBanner || chunk.length >= budget * 0.5)) {
            break;   // start new page first
          }
        }
        // Atomic device check: if this row starts a new device, see if
        // the whole device fits in the remaining budget. If not, break
        // the page before the device-start so the device prints as one
        // contiguous block. Skipped on a near-empty page (chunk only
        // carries banner labels) — a device larger than a whole page is
        // unavoidable and gets a regular split.
        if (isDeviceStart && it && !it.group && isDeviceStart(it)) {
          const deviceEnd = _atomicDeviceEnd(items, i, isDeviceStart);
          const deviceLen = deviceEnd - i;
          const remaining = budget - chunk.length;
          // Count meaningful (non-banner) rows already on the page.
          let nonBannerOnPage = 0;
          for (const c of chunk) { if (c && !c.group) nonBannerOnPage++; }
          if (deviceLen > remaining && nonBannerOnPage > 0 && deviceLen <= budget) {
            break;   // start new page first
          }
        }
        chunk.push(it);
        if (it && it.group === true) lastGroupBeforeBoundary = it;
        i++;
      }
      pages.push({ items: chunk, lastGroup: lastGroupBeforeBoundary });
    }
    return pages;
  }

  if (typeof window !== 'undefined') {
    window.SonorPdfPaginate = {
      __version: MODULE_VERSION,
      paginate,
      DEFAULT_FIRST_PAGE_BUDGET,
      DEFAULT_CONT_PAGE_BUDGET
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { paginate, DEFAULT_FIRST_PAGE_BUDGET, DEFAULT_CONT_PAGE_BUDGET };
  }
})();
