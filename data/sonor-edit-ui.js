// sonor-edit-ui.js — CANONICAL MASTER (Spine v1.2.1 §15, S-4.15)
//
// App-agnostic editable-surface primitive library. This file is the single
// source of truth for inline-edit / drag / live-draw interactions across every
// Sonor browser app. Propagated to `APP - */data/sonor-edit-ui.js` by
// `sync-everything.sh` (S-4.2). NEVER hand-edit the per-app copies — edit
// this master and re-run the sync.
//
// Cinema Design additionally loads this via `js/00-edit-ui.js` (a literal copy
// kept in the js/ folder so `build.sh` concat still sees it). When Cinema is
// re-synced, `js/00-edit-ui.js` is overwritten from this master too. All other
// apps consume via a `data/sonor-edit-ui.js` script tag before their own app
// script. (Literal tag syntax avoided in this comment — Cinema inlines this
// file inside a <script> block, and an unescaped closing tag would truncate
// the built HTML at the HTML-parser layer.)
//
// Namespace: window.SonorEdit
// Consumption pattern (non-breaking, additive):
//   if (window.SonorEdit && SonorEdit.makeDraggable) { SonorEdit.makeDraggable(el, opts); }
//
// Exports (v1.1.0 — every v1.0.0 signature preserved):
//   inlineInput(el, opts)               — swap element for <input>, commit on blur/Enter.
//   makeEditable(el, opts)              — click/Enter/Space-to-open inlineInput wrapper.
//   makeDraggable(el, opts)             — pointer drag + keyboard nudge with snap, bounds, HUD.
//   drawLine(svg, opts)                 — click-start → click-end, rubber-band preview (pointer).
//   drawPolyline(svg, opts)             — multi-click polygon, Enter/dbl-click close (pointer).
//   calibrateScale(svg, opts)           — two clicks + known distance → returns px/unit ratio (pointer).
//   promptRename(current, cb)           — fallback prompt() rename (legacy path).
//   showCoordBadge / hideCoordBadge     — floating position HUD (viewport-flipping).
//   getOverride / setOverride / clearOverride — PROJECT.metadata override wrapper.
//   applyOverride(value, bucket, key)   — read-helper used inside render templates.
//   wireEditableCells(root, bucket)     — post-render sweep to wire [data-edit-key] cells.
//   wireEditableSvgText(svg, bucket)    — prompt-based rename for SVG <text> labels.
//   setSaveScheduler(fn)                — inject per-app save scheduler (see v1.1.0 note below).
//
// Promoted 2026-04-21 from Cinema Design v4.0.3 (B-190). History in sonor-cinema
// git log prior to that date.
//
// ─── v1.1.0 (2026-04-21) — additive, zero breaking changes ────────────────────
//   1. PointerEvent unification across drawLine / drawPolyline / calibrateScale.
//      Adds touch + pen support with setPointerCapture + touch-action guard.
//      Desktop behaviour unchanged. Fixes tablet/iPad use (Takeoffs, Portal).
//   2. Keyboard nudge for makeDraggable (WCAG 2.2 SC 2.5.7 AA). Arrow = 1px,
//      Shift+Arrow = 10px, Home/End = large nudge. Opt out via
//      opts.keyboardNudge: false.
//   3. ARIA annotations on wired editables. makeEditable sets role="textbox",
//      tabindex="0", and derives aria-label via data-edit-label → <label for>
//      → row <th> fallback chain. makeDraggable sets role="button" and an
//      instructive aria-label. No visual change.
//   4. SE.setSaveScheduler(fn) — inject per-app save callback, removes global
//      `scheduleSave` coupling. Falls back to window.scheduleSave when not
//      injected so every v1.0.0 consumer keeps working untouched.
//   5. _svgPt() now uses getScreenCTM().inverse() matrix transforms when
//      available, falling back to viewBox+rect math. Future-proofs ancestor
//      transforms, pan/zoom, and nested <g transform> layers.
//   6. JSDoc annotations on every exported function — IDE hover + type hints.
//   7. showCoordBadge viewport-flip — badge never renders off-screen; flips
//      side/edge based on available space around the anchor point.
//
// Every v1.0.0 caller keeps working. New behaviour is opt-out via opts flags.

window.SONOR_EDIT_VERSION = '1.1.0';

window.SonorEdit = window.SonorEdit || {};

(function (SE) {
  'use strict';

  // ═══ internals ══════════════════════════════════════════════════════════════

  /** @type {null | (() => void)} — app-injected save scheduler; set via setSaveScheduler. */
  let _saveScheduler = null;

  /**
   * Register a per-app save scheduler. Primitives call this after every
   * committed mutation. Replaces the legacy `window.scheduleSave` global lookup
   * (which still works as a fallback for v1.0.0 consumers).
   *
   * @param {(() => void) | null} fn  — function to call on mutations. Pass null to detach.
   * @returns {void}
   *
   * @example
   *   SonorEdit.setSaveScheduler(cinemaScheduleSave);   // on app boot
   *   SonorEdit.setSaveScheduler(null);                 // on teardown / test reset
   */
  SE.setSaveScheduler = function setSaveScheduler(fn) {
    _saveScheduler = (typeof fn === 'function') ? fn : null;
  };

  /** Internal — fire whichever save scheduler is registered. Never throws. */
  function _save() {
    try {
      if (_saveScheduler) { _saveScheduler(); return; }
      if (typeof window.scheduleSave === 'function') { window.scheduleSave(); return; }
    } catch (err) {
      try { console.error('[SonorEdit] save scheduler threw:', err); } catch { /* ok */ }
    }
  }

  /**
   * Client → SVG user-space coordinate conversion.
   *
   * Preferred path: SVGMatrix from getScreenCTM().inverse(). Survives every
   * ancestor <g transform>, viewport zoom, and preserveAspectRatio variant.
   * Falls back to rect + viewBox math, then bare rect coords, when the CTM is
   * unavailable (detached SVG, zero-dimension, etc.).
   *
   * @param {SVGSVGElement} svg
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}} — user-space coordinates, or (0,0) on failure.
   */
  function _svgPt(svg, clientX, clientY) {
    try {
      // Preferred: matrix-accurate — works through every ancestor transform.
      if (typeof svg.createSVGPoint === 'function' && typeof svg.getScreenCTM === 'function') {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = svg.createSVGPoint();
          pt.x = clientX;
          pt.y = clientY;
          const inv = ctm.inverse();
          const local = pt.matrixTransform(inv);
          return { x: local.x, y: local.y };
        }
      }
      // Fallback: rect + viewBox math.
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && rect.width > 0 && rect.height > 0) {
        const x = vb.x + ((clientX - rect.left) / rect.width) * vb.width;
        const y = vb.y + ((clientY - rect.top) / rect.height) * vb.height;
        return { x, y };
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    } catch { return { x: 0, y: 0 }; }
  }

  /** Internal — apply toUnit / snap / bounds from opts to a raw svg point. */
  function _applyOpts(p, opts) {
    let q = opts.toUnit ? opts.toUnit(p.x, p.y) : p;
    if (opts.snap && opts.snap > 0) {
      q = { x: Math.round(q.x / opts.snap) * opts.snap, y: Math.round(q.y / opts.snap) * opts.snap };
    }
    if (typeof opts.bounds === 'function') q = opts.bounds(q.x, q.y);
    return q;
  }

  /**
   * Best-effort aria-label derivation for an editable cell. Walks: explicit
   * attributes → associated <label for> → row header <th> → aria-labelledby
   * target. Returns null if nothing useful is found.
   *
   * @param {Element} el
   * @returns {string | null}
   */
  function _nearestLabel(el) {
    try {
      if (!el || !el.getAttribute) return null;
      const ds = el.getAttribute('data-edit-label');
      if (ds) return ds.trim();
      if (el.id) {
        const lblFor = document.querySelector('label[for="' + el.id + '"]');
        if (lblFor && lblFor.textContent) return lblFor.textContent.trim();
      }
      // Table-row pattern — first <th> in the same <tr>.
      const row = el.closest && el.closest('tr');
      if (row) {
        const th = row.querySelector('th');
        if (th && th.textContent) return th.textContent.trim();
      }
      // aria-labelledby target.
      const aby = el.getAttribute('aria-labelledby');
      if (aby) {
        const lbl = document.getElementById(aby);
        if (lbl && lbl.textContent) return lbl.textContent.trim();
      }
      return null;
    } catch { return null; }
  }

  /** Internal — is a pointer event a primary (left) click / touch / pen? */
  function _isPrimaryPointer(e) {
    if (e.pointerType === 'mouse') return e.button === 0;
    // Touch and pen: pointerdown always fires for the primary contact.
    return true;
  }

  // ═══ inline text/number edit ════════════════════════════════════════════════

  /**
   * Swap an element's text for an `<input>`; commit on blur / Enter, cancel on
   * Escape. Idempotent — a second call while an edit is open is a no-op.
   *
   * @param {HTMLElement} el
   * @param {object} [opts]
   * @param {'text'|'number'} [opts.type='text']
   * @param {number} [opts.min]
   * @param {number} [opts.max]
   * @param {number} [opts.step]
   * @param {(raw: string) => any} [opts.parser]      — raw input → stored value.
   * @param {(val: any) => string} [opts.formatter]   — stored value → rendered text.
   * @param {(val: any, original: string) => void} [opts.onCommit]
   * @param {() => void} [opts.onCancel]
   * @param {boolean} [opts.select=true]              — auto-select contents on open.
   * @returns {void}
   */
  SE.inlineInput = function inlineInput(el, opts) {
    if (!el || el.dataset._editOpen === '1') return;
    opts = opts || {};
    const type = opts.type || 'text';
    const parser = opts.parser || (v => type === 'number' ? Number(v) : v);
    const formatter = opts.formatter || (v => String(v));
    const original = el.textContent;
    const originalHTML = el.innerHTML;

    const input = document.createElement('input');
    input.type = type;
    if (opts.min != null) input.min = opts.min;
    if (opts.max != null) input.max = opts.max;
    if (opts.step != null) input.step = opts.step;
    input.value = original;
    input.className = 'sonor-edit-input';
    // Mirror aria-label from host so the input announces the same context.
    const hostLabel = el.getAttribute && el.getAttribute('aria-label');
    if (hostLabel) input.setAttribute('aria-label', hostLabel);
    input.style.cssText = [
      'font: inherit',
      'color: inherit',
      'background: var(--panel, #1a1a1a)',
      'border: 1px solid var(--accent, #6b4a8a)',
      'border-radius: 3px',
      'padding: 1px 4px',
      'width: ' + Math.max(el.offsetWidth, 60) + 'px',
      'box-sizing: border-box',
      'outline: none',
    ].join(';');

    el.dataset._editOpen = '1';
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    if (opts.select !== false) input.select();

    let committed = false;
    const cleanup = () => {
      el.dataset._editOpen = '0';
      if (input.parentNode) input.remove();
    };
    const commit = () => {
      if (committed) return;
      committed = true;
      let val;
      try { val = parser(input.value); }
      catch { val = input.value; }
      if (type === 'number' && !Number.isFinite(val)) {
        cancel();
        return;
      }
      cleanup();
      el.textContent = formatter(val);
      try { opts.onCommit && opts.onCommit(val, original); } catch (e) { console.error(e); }
      _save();
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      cleanup();
      el.innerHTML = originalHTML;
      try { opts.onCancel && opts.onCancel(); } catch (e) { console.error(e); }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  };

  // ═══ click-to-open wrapper ══════════════════════════════════════════════════

  /**
   * Make an element click-to-edit. Adds ARIA role="textbox", tabindex, and a
   * derived aria-label. Keyboard-activatable via Enter and Space.
   *
   * @param {HTMLElement} el
   * @param {object} [opts]                 — forwarded to inlineInput.
   * @param {string} [opts.ariaLabel]       — override the derived aria-label.
   * @param {boolean} [opts.aria=true]      — set false to skip ARIA annotation.
   * @returns {void}
   */
  SE.makeEditable = function makeEditable(el, opts) {
    if (!el || el.dataset._editWired === '1') return;
    el.dataset._editWired = '1';
    opts = opts || {};
    el.style.cursor = el.style.cursor || 'text';
    el.title = el.title || 'Click to edit';

    // Accessibility: focusable, announced as textbox, keyboard-activatable.
    if (opts.aria !== false) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'textbox');
      if (!el.hasAttribute('aria-label')) {
        const label = opts.ariaLabel
          || _nearestLabel(el)
          || 'Editable value — press Enter to edit';
        el.setAttribute('aria-label', label);
      }
    }

    const open = (e) => {
      if (el.dataset._editOpen === '1') return;
      if (e && e.stopPropagation) e.stopPropagation();
      if (e && e.preventDefault) e.preventDefault();
      SE.inlineInput(el, opts);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  };

  // ═══ pointer drag + keyboard nudge with snap + bounds + HUD ═════════════════

  /**
   * Make an element draggable in unit-space. Pointer + keyboard input, with
   * snap, bounds clamp, and coord HUD. Safe on touch/pen/mouse.
   *
   * Keyboard nudge (WCAG 2.2 SC 2.5.7): Arrow = 1px, Shift+Arrow = 10px,
   * Home/End = 50px. Disable via `opts.keyboardNudge: false`.
   *
   * @param {HTMLElement} el
   * @param {object} [opts]
   * @param {(dx: number, dy: number) => {x:number, y:number}} [opts.toUnit]
   *        — convert pixel delta to app-units (metres, mm, whatever). Default pass-through.
   * @param {number} [opts.snap=0]          — snap unit in app-units; 0 disables.
   * @param {(x:number, y:number) => {x:number, y:number}} [opts.bounds]
   *        — clamp fn applied after snap.
   * @param {(pos: {x:number,y:number}) => void} [opts.onDrag]
   * @param {(pos: {x:number,y:number}) => void} [opts.onCommit]
   * @param {(pos: {x:number,y:number}) => string} [opts.label]
   *        — coord-badge label builder. Default: "x, y" rounded to 2dp.
   * @param {boolean} [opts.showBadge=true]
   * @param {boolean} [opts.keyboardNudge=true]   — enable arrow-key nudging.
   * @param {string}  [opts.ariaLabel]            — override default aria-label.
   * @returns {void}
   */
  SE.makeDraggable = function makeDraggable(el, opts) {
    if (!el || el.dataset._dragWired === '1') return;
    el.dataset._dragWired = '1';
    opts = opts || {};
    const snap = Number(opts.snap) || 0;
    const toUnit = opts.toUnit || ((dx, dy) => ({ x: dx, y: dy }));
    el.style.cursor = el.style.cursor || 'grab';

    // Accessibility: focusable + role + instructive label.
    if (opts.aria !== false) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label',
          opts.ariaLabel || 'Draggable handle — arrow keys to nudge, Shift+arrow for larger steps');
      }
    }

    // Pointer drag.
    el.addEventListener('pointerdown', function (e) {
      if (!_isPrimaryPointer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      let lastPos = null;
      try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch { /* ok */ }
      el.style.cursor = 'grabbing';

      const onMove = (ev) => {
        const pxDx = ev.clientX - startX;
        const pxDy = ev.clientY - startY;
        let raw = toUnit(pxDx, pxDy);
        if (snap > 0) {
          raw = { x: Math.round(raw.x / snap) * snap, y: Math.round(raw.y / snap) * snap };
        }
        if (typeof opts.bounds === 'function') raw = opts.bounds(raw.x, raw.y);
        lastPos = raw;
        try { opts.onDrag && opts.onDrag(raw); } catch (err) { console.error(err); }
        if (opts.showBadge !== false) {
          const txt = typeof opts.label === 'function' ? opts.label(raw)
                    : `${(raw.x || 0).toFixed(2)}, ${(raw.y || 0).toFixed(2)}`;
          SE.showCoordBadge(ev.clientX + 14, ev.clientY + 14, txt);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        el.style.cursor = 'grab';
        SE.hideCoordBadge();
        if (lastPos == null) return;
        try { opts.onCommit && opts.onCommit(lastPos); } catch (err) { console.error(err); }
        _save();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    // Keyboard nudge (WCAG 2.2 SC 2.5.7).
    if (opts.keyboardNudge !== false) {
      el.addEventListener('keydown', function (e) {
        let pxDx = 0, pxDy = 0;
        const big = e.shiftKey ? 10 : 1;
        switch (e.key) {
          case 'ArrowLeft':  pxDx = -big; break;
          case 'ArrowRight': pxDx =  big; break;
          case 'ArrowUp':    pxDy = -big; break;
          case 'ArrowDown':  pxDy =  big; break;
          case 'Home':       pxDx = -50; break;
          case 'End':        pxDx =  50; break;
          default: return;
        }
        e.preventDefault();
        let raw = toUnit(pxDx, pxDy);
        if (snap > 0) {
          raw = { x: Math.round(raw.x / snap) * snap, y: Math.round(raw.y / snap) * snap };
        }
        if (typeof opts.bounds === 'function') raw = opts.bounds(raw.x, raw.y);
        try { opts.onDrag && opts.onDrag(raw); } catch (err) { console.error(err); }
        try { opts.onCommit && opts.onCommit(raw); } catch (err) { console.error(err); }
        _save();
        // Flash the coord badge briefly so keyboard users see their delta.
        if (opts.showBadge !== false) {
          const rect = el.getBoundingClientRect();
          const txt = typeof opts.label === 'function' ? opts.label(raw)
                    : `${(raw.x || 0).toFixed(2)}, ${(raw.y || 0).toFixed(2)}`;
          SE.showCoordBadge(rect.right + 8, rect.top - 4, txt);
          clearTimeout(el._nudgeBadgeTimer);
          el._nudgeBadgeTimer = setTimeout(() => SE.hideCoordBadge(), 900);
        }
      });
    }
  };

  // ═══ live-draw: two-click line (rubber-band preview) ════════════════════════

  /**
   * Start a rubber-band two-click line draw on an SVG. Pointer-driven (mouse,
   * touch, pen). Escape cancels. Returns a dispose() that tears listeners down.
   *
   * @param {SVGSVGElement} svg
   * @param {object} [opts]
   * @param {(dx:number,dy:number)=>{x:number,y:number}} [opts.toUnit]
   * @param {number} [opts.snap=0]
   * @param {(x:number,y:number)=>{x:number,y:number}} [opts.bounds]
   * @param {(p: {x:number,y:number}) => void} [opts.onStart]
   * @param {(p1, p2) => void} [opts.onPreview]
   * @param {(p1, p2) => void} [opts.onCommit]
   * @param {() => void} [opts.onCancel]
   * @param {(p1, p2) => string} [opts.label]
   * @param {boolean} [opts.showBadge=true]
   * @param {string}  [opts.cursor='crosshair']
   * @returns {() => void} dispose — idempotent teardown.
   */
  SE.drawLine = function drawLine(svg, opts) {
    if (!svg) return function () {};
    opts = opts || {};
    let p1 = null;
    let capturedId = null;
    const prevCursor = svg.style.cursor;
    const prevTouchAction = svg.style.touchAction;
    svg.style.cursor = opts.cursor || 'crosshair';
    svg.style.touchAction = 'none'; // prevent scroll-swallow on touch devices

    const releaseCapture = () => {
      if (capturedId != null) {
        try { svg.releasePointerCapture && svg.releasePointerCapture(capturedId); } catch { /* ok */ }
        capturedId = null;
      }
    };

    const onDown = (e) => {
      if (!_isPrimaryPointer(e)) return;
      const raw = _svgPt(svg, e.clientX, e.clientY);
      const p = _applyOpts(raw, opts);
      if (!p1) {
        p1 = p;
        capturedId = e.pointerId;
        try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch { /* ok */ }
        try { opts.onStart && opts.onStart(p1); } catch (err) { console.error(err); }
        e.preventDefault();
      } else {
        try { opts.onCommit && opts.onCommit(p1, p); } catch (err) { console.error(err); }
        _save();
        releaseCapture();
        p1 = null;
        if (opts.showBadge !== false) SE.hideCoordBadge();
        e.preventDefault();
      }
    };
    const onMove = (e) => {
      if (!p1) return;
      const raw = _svgPt(svg, e.clientX, e.clientY);
      const p2 = _applyOpts(raw, opts);
      try { opts.onPreview && opts.onPreview(p1, p2); } catch (err) { console.error(err); }
      if (opts.showBadge !== false) {
        const txt = typeof opts.label === 'function' ? opts.label(p1, p2)
                  : (() => {
                      const dx = p2.x - p1.x, dy = p2.y - p1.y;
                      const len = Math.round(Math.sqrt(dx*dx + dy*dy));
                      return `${Math.round(p2.x)}, ${Math.round(p2.y)}  •  ${len}`;
                    })();
        SE.showCoordBadge(e.clientX + 14, e.clientY + 14, txt);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && p1) {
        releaseCapture();
        p1 = null;
        if (opts.showBadge !== false) SE.hideCoordBadge();
        try { opts.onCancel && opts.onCancel(); } catch (err) { console.error(err); }
      }
    };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);

    let disposed = false;
    return function dispose() {
      if (disposed) return;
      disposed = true;
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      svg.style.cursor = prevCursor;
      svg.style.touchAction = prevTouchAction || '';
      releaseCapture();
      if (p1 && opts.showBadge !== false) SE.hideCoordBadge();
      p1 = null;
    };
  };

  // ═══ live-draw: multi-click polyline / polygon ══════════════════════════════

  /**
   * Start a multi-click polyline/polygon draw on an SVG. Pointer-driven.
   * Enter or double-click closes (configurable). Escape cancels.
   *
   * @param {SVGSVGElement} svg
   * @param {object} [opts]
   * @param {(dx:number,dy:number)=>{x:number,y:number}} [opts.toUnit]
   * @param {number} [opts.snap=0]
   * @param {(x:number,y:number)=>{x:number,y:number}} [opts.bounds]
   * @param {number}  [opts.minPoints=2]
   * @param {boolean} [opts.closeOnDouble=true]
   * @param {boolean} [opts.closeOnEnter=true]
   * @param {(p, points) => void} [opts.onAddPoint]
   * @param {(points, cursor) => void} [opts.onPreview]
   * @param {(points: Array<{x,y}>) => void} [opts.onCommit]
   * @param {() => void} [opts.onCancel]
   * @param {(points, cursor) => string} [opts.label]
   * @param {boolean} [opts.showBadge=true]
   * @param {string}  [opts.cursor='crosshair']
   * @returns {() => void} dispose
   */
  SE.drawPolyline = function drawPolyline(svg, opts) {
    if (!svg) return function () {};
    opts = opts || {};
    const minPoints = Math.max(2, Number(opts.minPoints) || 2);
    const closeOnDouble = opts.closeOnDouble !== false;
    const closeOnEnter = opts.closeOnEnter !== false;
    const points = [];
    let capturedId = null;
    const prevCursor = svg.style.cursor;
    const prevTouchAction = svg.style.touchAction;
    svg.style.cursor = opts.cursor || 'crosshair';
    svg.style.touchAction = 'none';

    const releaseCapture = () => {
      if (capturedId != null) {
        try { svg.releasePointerCapture && svg.releasePointerCapture(capturedId); } catch { /* ok */ }
        capturedId = null;
      }
    };

    const commit = () => {
      if (points.length < minPoints) return false;
      try { opts.onCommit && opts.onCommit(points.slice()); } catch (err) { console.error(err); }
      _save();
      points.length = 0;
      releaseCapture();
      if (opts.showBadge !== false) SE.hideCoordBadge();
      return true;
    };
    const cancel = () => {
      points.length = 0;
      releaseCapture();
      if (opts.showBadge !== false) SE.hideCoordBadge();
      try { opts.onCancel && opts.onCancel(); } catch (err) { console.error(err); }
    };

    const onDown = (e) => {
      if (!_isPrimaryPointer(e)) return;
      const raw = _svgPt(svg, e.clientX, e.clientY);
      const p = _applyOpts(raw, opts);
      // Capture the first pointer so subsequent moves always route to us.
      if (points.length === 0) {
        capturedId = e.pointerId;
        try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch { /* ok */ }
      }
      points.push(p);
      try { opts.onAddPoint && opts.onAddPoint(p, points.slice()); } catch (err) { console.error(err); }
      e.preventDefault();
    };
    const onMove = (e) => {
      if (points.length === 0) return;
      const raw = _svgPt(svg, e.clientX, e.clientY);
      const cursor = _applyOpts(raw, opts);
      try { opts.onPreview && opts.onPreview(points.slice(), cursor); } catch (err) { console.error(err); }
      if (opts.showBadge !== false) {
        const txt = typeof opts.label === 'function' ? opts.label(points.slice(), cursor)
                  : `pt ${points.length + 1}  ${Math.round(cursor.x)}, ${Math.round(cursor.y)}`;
        SE.showCoordBadge(e.clientX + 14, e.clientY + 14, txt);
      }
    };
    const onDouble = (e) => {
      if (!closeOnDouble) return;
      if (points.length >= minPoints) { commit(); e.preventDefault(); }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { cancel(); }
      else if (e.key === 'Enter' && closeOnEnter) {
        if (points.length >= minPoints) { commit(); e.preventDefault(); }
      }
    };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('dblclick', onDouble);
    window.addEventListener('keydown', onKey);

    let disposed = false;
    return function dispose() {
      if (disposed) return;
      disposed = true;
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('dblclick', onDouble);
      window.removeEventListener('keydown', onKey);
      svg.style.cursor = prevCursor;
      svg.style.touchAction = prevTouchAction || '';
      releaseCapture();
      if (opts.showBadge !== false && points.length) SE.hideCoordBadge();
      points.length = 0;
    };
  };

  // ═══ scale calibration: two clicks + known distance → px-per-mm ratio ═══════

  /**
   * Calibrate an SVG's drawing scale. User clicks two points representing a
   * known real-world distance (e.g. a 1000mm wall). Returns a ratio (svg-units
   * per mm) via `opts.onCalibrated`. Pointer-driven.
   *
   * @param {SVGSVGElement} svg
   * @param {object} [opts]
   * @param {number} [opts.knownMm]         — skip the prompt by passing this.
   * @param {string} [opts.promptText='Enter known distance in mm:']
   * @param {(p1, cursor) => void} [opts.onPreview]
   * @param {(ratio: number, p1, p2, knownMm: number) => void} [opts.onCalibrated]
   * @param {() => void} [opts.onCancel]
   * @param {(p1, cursor) => string} [opts.label]
   * @returns {() => void} dispose
   */
  SE.calibrateScale = function calibrateScale(svg, opts) {
    if (!svg) return function () {};
    opts = opts || {};
    let p1 = null;
    let capturedId = null;
    const prevCursor = svg.style.cursor;
    const prevTouchAction = svg.style.touchAction;
    svg.style.cursor = 'crosshair';
    svg.style.touchAction = 'none';

    const releaseCapture = () => {
      if (capturedId != null) {
        try { svg.releasePointerCapture && svg.releasePointerCapture(capturedId); } catch { /* ok */ }
        capturedId = null;
      }
    };

    const finish = (p2) => {
      let km = opts.knownMm;
      if (km == null) {
        const v = window.prompt(opts.promptText || 'Enter known distance in mm:');
        if (v == null) { cancel(); return; }
        km = parseFloat(v);
      }
      if (!Number.isFinite(km) || km <= 0) { cancel(); return; }
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const ratio = dist / km;
      try { opts.onCalibrated && opts.onCalibrated(ratio, p1, p2, km); }
      catch (err) { console.error(err); }
      releaseCapture();
      SE.hideCoordBadge();
      p1 = null;
    };
    const cancel = () => {
      releaseCapture();
      p1 = null;
      SE.hideCoordBadge();
      try { opts.onCancel && opts.onCancel(); } catch (err) { console.error(err); }
    };

    const onDown = (e) => {
      if (!_isPrimaryPointer(e)) return;
      const p = _svgPt(svg, e.clientX, e.clientY);
      if (!p1) {
        p1 = p;
        capturedId = e.pointerId;
        try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch { /* ok */ }
        e.preventDefault();
      } else {
        finish(p);
        e.preventDefault();
      }
    };
    const onMove = (e) => {
      if (!p1) return;
      const cursor = _svgPt(svg, e.clientX, e.clientY);
      try { opts.onPreview && opts.onPreview(p1, cursor); } catch (err) { console.error(err); }
      const dx = cursor.x - p1.x, dy = cursor.y - p1.y;
      const dist = Math.round(Math.sqrt(dx*dx + dy*dy));
      const txt = typeof opts.label === 'function' ? opts.label(p1, cursor)
                : `calibrate: ${dist} svg-units`;
      SE.showCoordBadge(e.clientX + 14, e.clientY + 14, txt);
    };
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);

    let disposed = false;
    return function dispose() {
      if (disposed) return;
      disposed = true;
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      svg.style.cursor = prevCursor;
      svg.style.touchAction = prevTouchAction || '';
      releaseCapture();
      SE.hideCoordBadge();
      p1 = null;
    };
  };

  // ═══ floating coord HUD (viewport-flipping) ═════════════════════════════════

  let _badgeEl = null;

  /**
   * Show the floating coord badge at (x,y) in client coords. Auto-flips to the
   * opposite side/edge if it would render off-screen. Announces politely to
   * assistive tech via role="status" + aria-live="polite".
   *
   * @param {number} x  — client X (anchor point; badge renders near here).
   * @param {number} y  — client Y.
   * @param {string} text
   * @returns {void}
   */
  SE.showCoordBadge = function showCoordBadge(x, y, text) {
    if (!_badgeEl) {
      _badgeEl = document.createElement('div');
      _badgeEl.className = 'sonor-edit-coord-badge';
      _badgeEl.setAttribute('role', 'status');
      _badgeEl.setAttribute('aria-live', 'polite');
      _badgeEl.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'z-index: 9999',
        'font: 600 11px/1 system-ui, -apple-system, sans-serif',
        'color: #fff',
        'background: var(--accent, #6b4a8a)',
        'padding: 4px 7px',
        'border-radius: 3px',
        'box-shadow: 0 2px 6px rgba(0,0,0,0.35)',
        'white-space: nowrap',
        'max-width: 280px',
        'overflow: hidden',
        'text-overflow: ellipsis',
      ].join(';');
      document.body.appendChild(_badgeEl);
    }
    _badgeEl.textContent = text;
    _badgeEl.style.display = 'block';

    // Measure after content is set so flipping uses real dimensions.
    const margin = 6;
    const w = _badgeEl.offsetWidth;
    const h = _badgeEl.offsetHeight;
    const vw = window.innerWidth  || document.documentElement.clientWidth  || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    let left = x;
    let top  = y;
    // Flip horizontally if we'd overflow the right edge.
    if (left + w + margin > vw) left = Math.max(margin, x - w - 28);
    // Flip vertically if we'd overflow the bottom edge.
    if (top  + h + margin > vh) top  = Math.max(margin, y - h - 28);
    // Clamp to left/top margins.
    if (left < margin) left = margin;
    if (top  < margin) top  = margin;

    _badgeEl.style.left = left + 'px';
    _badgeEl.style.top  = top  + 'px';
  };

  /** Hide the coord badge. No-op if not yet shown. @returns {void} */
  SE.hideCoordBadge = function hideCoordBadge() {
    if (_badgeEl) _badgeEl.style.display = 'none';
  };

  // ═══ legacy prompt-based rename (fallback path) ═════════════════════════════

  /**
   * Fallback rename using window.prompt(). Kept for consumers that can't wire
   * inline editing (e.g. headless/test paths). Fires the save scheduler after
   * a non-null commit.
   *
   * @param {string | null | undefined} current
   * @param {(next: string) => void} [cb]
   * @returns {void}
   */
  SE.promptRename = function promptRename(current, cb) {
    const v = window.prompt('Edit value:', current == null ? '' : String(current));
    if (v == null) return;
    try { cb && cb(v); } catch (e) { console.error(e); }
    _save();
  };

  // ═══ override wrapper (PROJECT.metadata buckets) ════════════════════════════

  /**
   * Read an override from `window.PROJECT.metadata[bucket][key]`. Safe when
   * PROJECT isn't initialised.
   *
   * @param {string} bucket  — e.g. 'materialOverrides', 'labelOverrides'.
   * @param {string} key
   * @returns {*} stored value, or undefined.
   */
  SE.getOverride = function getOverride(bucket, key) {
    try {
      const P = window.PROJECT;
      if (!P || !P.metadata) return undefined;
      const b = P.metadata[bucket];
      if (!b) return undefined;
      return b[key];
    } catch { return undefined; }
  };

  /**
   * Write an override to `window.PROJECT.metadata[bucket][key]` and fire the
   * save scheduler. Auto-creates the bucket.
   *
   * @param {string} bucket
   * @param {string} key
   * @param {*} value
   * @returns {boolean} true on success, false if PROJECT is unavailable.
   */
  SE.setOverride = function setOverride(bucket, key, value) {
    try {
      const P = window.PROJECT;
      if (!P) return false;
      P.metadata = P.metadata || {};
      P.metadata[bucket] = P.metadata[bucket] || {};
      P.metadata[bucket][key] = value;
      _save();
      return true;
    } catch { return false; }
  };

  /**
   * Clear an override. If `key` is null/undefined, drops the entire bucket.
   *
   * @param {string} bucket
   * @param {string} [key]   — omit to clear the whole bucket.
   * @returns {boolean} true on success, false if bucket/PROJECT absent.
   */
  SE.clearOverride = function clearOverride(bucket, key) {
    try {
      const P = window.PROJECT;
      if (!P || !P.metadata || !P.metadata[bucket]) return false;
      if (key == null) { delete P.metadata[bucket]; }
      else { delete P.metadata[bucket][key]; }
      _save();
      return true;
    } catch { return false; }
  };

  // ═══ render-template helper: value OR override ══════════════════════════════

  /**
   * Return the override from `PROJECT.metadata[bucket][key]` if set, else the
   * raw value. Use inside `${}` interpolations when building innerHTML.
   *
   * @param {*} raw
   * @param {string} bucket
   * @param {string} key
   * @returns {*}
   */
  SE.applyOverride = function applyOverride(raw, bucket, key) {
    const v = SE.getOverride(bucket, key);
    return (v !== undefined && v !== null && v !== '') ? v : raw;
  };

  // ═══ post-render sweep: wire SVG <text data-edit-key> elements ══════════════

  /**
   * Wire every `<text data-edit-key="…">` descendant of an SVG for
   * prompt-based rename. Honours per-node `data-edit-bucket` override.
   *
   * @param {SVGElement} svgRoot
   * @param {string | object} [optsOrBucket]  — bucket name string, or an options object.
   * @param {string} [optsOrBucket.bucket='labelOverrides']
   * @param {(key, val, bucket) => void} [optsOrBucket.onChange]
   * @param {(key, bucket) => void} [optsOrBucket.onReset]
   * @param {(key: string) => string} [optsOrBucket.promptLabel]
   * @returns {number} count of newly-wired nodes.
   */
  SE.wireEditableSvgText = function wireEditableSvgText(svgRoot, optsOrBucket) {
    if (!svgRoot || !svgRoot.querySelectorAll) return 0;
    const opts = (typeof optsOrBucket === 'string')
      ? { bucket: optsOrBucket }
      : (optsOrBucket || {});
    const bucket = opts.bucket || 'labelOverrides';
    const nodes = svgRoot.querySelectorAll('text[data-edit-key]');
    let wired = 0;
    nodes.forEach(function (node) {
      if (node.dataset._editWired === '1') return;
      node.dataset._editWired = '1';
      const key = node.getAttribute('data-edit-key');
      if (!key) return;
      const cellBucket = node.getAttribute('data-edit-bucket') || bucket;
      node.style.cursor = 'text';
      node.setAttribute('tabindex', '0');
      // Give assistive tech a hint at what this SVG text node does.
      if (!node.hasAttribute('role')) node.setAttribute('role', 'textbox');
      if (!node.hasAttribute('aria-label')) {
        node.setAttribute('aria-label', 'Rename label: ' + key);
      }
      if (!node.querySelector('title')) {
        const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        tt.textContent = 'Click to rename';
        node.insertBefore(tt, node.firstChild);
      }
      const trigger = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const current = node.textContent || '';
        const label = (opts.promptLabel && opts.promptLabel(key)) || 'Rename label';
        const next = window.prompt(label, current);
        if (next === null) return; // user cancelled
        const trimmed = String(next);
        if (trimmed === '') {
          SE.clearOverride(cellBucket, key);
          if (opts.onReset) { try { opts.onReset(key, cellBucket); } catch (err) { console.error(err); } }
          // Don't blank the label visually — next render will restore raw value.
        } else {
          SE.setOverride(cellBucket, key, trimmed);
          node.textContent = trimmed;
          if (opts.onChange) { try { opts.onChange(key, trimmed, cellBucket); } catch (err) { console.error(err); } }
        }
      };
      node.addEventListener('click', trigger);
      node.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(e); }
      });
      wired++;
    });
    return wired;
  };

  // ═══ post-render sweep: wire [data-edit-key] cells inside a container ═══════

  /**
   * Wire every `[data-edit-key]` descendant for click-to-edit. Idempotent.
   * Honours per-node `data-edit-bucket`, `data-edit-type`, `data-edit-label`
   * overrides.
   *
   * @param {Element} root
   * @param {string | object} [optsOrBucket]
   * @param {string} [optsOrBucket.bucket='materialOverrides']
   * @param {(key, val, bucket) => void} [optsOrBucket.onChange]
   * @param {(key, bucket) => void} [optsOrBucket.onReset]
   * @param {boolean} [optsOrBucket.parseNumber=false]
   * @returns {number} count of newly-wired cells.
   */
  SE.wireEditableCells = function wireEditableCells(root, optsOrBucket) {
    if (!root || !root.querySelectorAll) return 0;
    const opts = (typeof optsOrBucket === 'string')
      ? { bucket: optsOrBucket }
      : (optsOrBucket || {});
    const defaultBucket = opts.bucket || 'materialOverrides';
    const nodes = root.querySelectorAll('[data-edit-key]');
    let wired = 0;
    nodes.forEach(function (node) {
      if (node.dataset._editWired === '1') return;
      const key = node.getAttribute('data-edit-key');
      if (!key) return;
      const bucket = node.getAttribute('data-edit-bucket') || defaultBucket;
      const type = node.getAttribute('data-edit-type') || 'text';
      SE.makeEditable(node, {
        type: type,
        // Let wireEditableCells drive the aria-label; respects data-edit-label
        // and nearest <th>/<label> fallback via makeEditable's chain.
        ariaLabel: node.getAttribute('data-edit-label') || undefined,
        onCommit: function (val) {
          // Empty string ⇒ clear override (restore raw value on next render)
          if (val === '' || val == null) {
            SE.clearOverride(bucket, key);
            if (opts.onReset) { try { opts.onReset(key, bucket); } catch (e) { console.error(e); } }
          } else {
            const stored = (type === 'number' || opts.parseNumber) ? Number(val) : val;
            SE.setOverride(bucket, key, stored);
            if (opts.onChange) { try { opts.onChange(key, stored, bucket); } catch (e) { console.error(e); } }
          }
        }
      });
      // Visual affordance: subtle underline so users know the cell is editable.
      // Skipped if the caller has added their own affordance class.
      if (!node.classList.contains('sonor-edit-cell')) {
        node.classList.add('sonor-edit-cell');
      }
      wired++;
    });
    return wired;
  };

})(window.SonorEdit);
