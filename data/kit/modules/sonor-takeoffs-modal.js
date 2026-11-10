// @ts-check
/**
 * Sonor Takeoffs — SonorModal shared class
 * ==========================================
 *
 * Workspace-shared canonical master per HARMONY §2 / Spine S-4.2.
 * Synced into APP - Takeoffs/data/sonor-takeoffs-modal.js by
 * sync-everything.sh; never hand-edit the per-app copy.
 *
 * @version 0.3.0   (2026-09-28 — Lucide icons: leading chrome emoji in the title + action buttons swapped via root sonor-icons.js when present, B-478)   (0.2.1 — action `attrs` (data-*), `title`, `disabled` honoured; `el` alias of `element`)   (0.2.0 2026-09-27 — slate theme tokens: no hard-coded cream; falls back to slate when the app defines no vars)   (introduced in Sonor Takeoffs v4.6.0 — Phase 6 skeleton)
 * @license proprietary — Sonor Smart Homes
 *
 * THE PROBLEM
 *
 * Pre-v4.6.0 the host had 15+ hand-built modals (newProject,
 * editProject, planRevisions, blockEdit, calibration, shadeEdit,
 * pjScreenEdit, revCloudEdit, tvEdit, mixEditor, revisions, guard,
 * pagePicker, floorPicker, roomsSettings, ...). Each had its own
 * Esc/backdrop/focus-trap behaviour — inconsistent across the app.
 * Audit §3.2 calls for a `SonorModal` shared class.
 *
 * THE FIX
 *
 * One factory + lifecycle. Modals declare title + body element +
 * actions; the class provides:
 *   - shared chrome (`.sonor-modal-overlay` + `.sonor-modal`)
 *   - Esc to dismiss (configurable)
 *   - backdrop click to dismiss (configurable)
 *   - focus trap with restore-focus-on-close
 *   - ARIA role="dialog" + aria-modal="true" + aria-labelledby
 *   - imperative open() / close() with promise-based result
 *
 * Phase 6 (v4.6.0) — module ships + tested. Existing modals adopt
 * progressively in Phase 6.x patches via SonorModal.create({...}).
 *
 * USAGE
 *
 *   const modal = SonorModal.create({
 *     title: 'Edit Block',
 *     body: someElement,
 *     actions: [
 *       { label: 'Cancel', kind: 'ghost', onClick: (m) => m.close('cancel') },
 *       { label: 'Save',   kind: 'primary', onClick: (m) => m.close('save') },
 *     ],
 *     dismissOnEsc: true,
 *     dismissOnBackdrop: true,
 *   });
 *   const result = await modal.open();   // 'cancel' | 'save' | 'esc' | 'backdrop'
 *
 * PUBLIC API (v0.1.0)
 *
 *   create(opts) → ModalInstance
 *
 *   ModalInstance:
 *     open()      → Promise<resultString>
 *     close(result)
 *     element     → root DOM node
 *     bodyEl      → user-provided body element
 *     isOpen      → boolean
 *
 * Both ES module exports and a window.SonorModal pin are emitted.
 */
(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') root.SonorModal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  'use strict';

  const __version = '0.3.0';

  let _modalIdSeq = 0;

  /** Selectors of focusable elements for focus-trap. */
  const FOCUS_SELECTOR =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), button:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"])';

  function _focusableInside(el) {
    if (!el || !el.querySelectorAll) return [];
    return Array.from(el.querySelectorAll(FOCUS_SELECTOR));
  }

  /**
   * @param {object} opts
   * @param {string} [opts.title]
   * @param {HTMLElement} [opts.body]
   * @param {Array<{label: string, kind?: string, attrs?: Object<string,string>, title?: string, disabled?: boolean, onClick?: (m: any) => void}>} [opts.actions]
   * @param {boolean} [opts.dismissOnEsc=true]
   * @param {boolean} [opts.dismissOnBackdrop=true]
   * @param {string} [opts.size='md']
   */
  function create(opts) {
    const o = opts || {};
    const id = 'sonor-modal-' + (++_modalIdSeq);
    const titleId = id + '-title';

    if (typeof document === 'undefined') {
      // Headless — return a minimal object so contract tests can probe.
      const stub = {
        __version,
        element: null,
        bodyEl: o.body || null,
        isOpen: false,
        open() { return Promise.resolve('headless'); },
        close() {},
      };
      return stub;
    }

    // Build the chrome.
    const overlay = document.createElement('div');
    overlay.className = 'sonor-modal-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);' +
                            'display:none;align-items:center;justify-content:center;' +
                            'z-index:9999;';

    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'sonor-modal sonor-modal-' + (o.size || 'md');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (o.title) modal.setAttribute('aria-labelledby', titleId);
    modal.tabIndex = -1;
    modal.style.cssText = 'background:var(--card,#FFFFFF);color:var(--text,#0F172A);border-radius:8px;' +
                          'min-width:300px;max-width:90vw;max-height:90vh;' +
                          'display:flex;flex-direction:column;overflow:hidden;' +
                          'box-shadow:0 16px 48px rgba(0,0,0,0.4);';

    // Header
    if (o.title) {
      const head = document.createElement('div');
      head.className = 'sonor-modal-head';
      head.style.cssText = 'padding:14px 20px;border-bottom:1px solid var(--border,#CBD5E1);' +
                           'display:flex;align-items:center;gap:12px;';
      const titleEl = document.createElement('h3');
      titleEl.id = titleId;
      titleEl.textContent = o.title;
      titleEl.style.cssText = 'margin:0;flex:1 1 auto;font-size:15px;font-weight:700;';
      head.appendChild(titleEl);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'sonor-modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'background:none;border:none;font-size:22px;' +
                                'cursor:pointer;color:var(--muted,#64748B);line-height:1;padding:4px 8px;';
      closeBtn.addEventListener('click', () => instance.close('close'));
      head.appendChild(closeBtn);
      modal.appendChild(head);
    }

    // Body
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'sonor-modal-body';
    bodyWrap.style.cssText = 'padding:18px 20px;overflow:auto;flex:1 1 auto;';
    if (o.body instanceof HTMLElement) bodyWrap.appendChild(o.body);
    else if (typeof o.body === 'string') bodyWrap.innerHTML = o.body;
    modal.appendChild(bodyWrap);

    // Actions
    if (Array.isArray(o.actions) && o.actions.length) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'sonor-modal-actions';
      actionsRow.style.cssText = 'padding:12px 20px;border-top:1px solid var(--border,#CBD5E1);' +
                                  'display:flex;justify-content:flex-end;gap:8px;';
      for (const a of o.actions) {
        const btn = document.createElement('button');
        btn.className = 'sonor-modal-btn sonor-modal-btn-' + (a.kind || 'ghost');
        btn.textContent = a.label || '';
        // v0.2.1 — hooks so callers can find / disable a button later (e.g. data-wqp-push)
        if (a.attrs && typeof a.attrs === 'object') { for (const k of Object.keys(a.attrs)) { try { btn.setAttribute(k, String(a.attrs[k])); } catch (_) {} } }
        if (a.title) btn.title = a.title;
        if (a.disabled) btn.disabled = true;
        btn.style.cssText = 'padding:8px 14px;border-radius:6px;font-weight:600;' +
                            'cursor:pointer;border:1px solid ' + (a.kind === 'primary' ? 'var(--cta-bg,var(--accent,#2d718b))' : 'var(--border-strong,var(--border,#CBD5E1))') + ';' +
                            'background:' + (a.kind === 'primary' ? 'var(--cta-bg,var(--accent,#2d718b))' : 'transparent') + ';' +
                            'color:' + (a.kind === 'primary' ? 'var(--cta-text,#fff)' : 'var(--text,#15202D)') + ';';   // 2026-10-13 — graphite tokens, no purple chrome (Bryn)
        btn.addEventListener('click', () => {
          if (typeof a.onClick === 'function') {
            try { a.onClick(instance); } catch (e) { console.warn('[SonorModal] action handler threw:', e && e.message); }
          } else {
            instance.close(a.label || 'action');
          }
        });
        actionsRow.appendChild(btn);
      }
      modal.appendChild(actionsRow);
    }

    // v0.3.0 (B-478) — icons instead of chrome emoji when the shared icon set is on the page
    try { if (window.SonorIcons) window.SonorIcons.replaceEmoji(modal, { selector: '.sonor-modal-head h3, .sonor-modal-btn', size: 15 }); } catch (_) {}
    overlay.appendChild(modal);

    /** Focus-trap key handler. */
    function onKeyDown(e) {
      if (!instance.isOpen) return;
      if (e.key === 'Escape' && o.dismissOnEsc !== false) {
        e.preventDefault();
        instance.close('esc');
        return;
      }
      if (e.key === 'Tab') {
        const focusable = _focusableInside(modal);
        if (focusable.length === 0) {
          e.preventDefault();
          modal.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !modal.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    function onBackdropClick(e) {
      if (e.target === overlay && o.dismissOnBackdrop !== false) {
        instance.close('backdrop');
      }
    }

    let _resolveOpen = null;
    let _previousFocus = null;

    const instance = {
      __version,
      element: overlay,
      el: overlay,          // v0.2.1 alias
      bodyEl: bodyWrap,
      isOpen: false,
      open() {
        return new Promise((resolve) => {
          if (instance.isOpen) { resolve('already-open'); return; }
          _resolveOpen = resolve;
          _previousFocus = document.activeElement;
          document.body.appendChild(overlay);
          overlay.style.display = 'flex';
          instance.isOpen = true;
          document.addEventListener('keydown', onKeyDown, true);
          overlay.addEventListener('click', onBackdropClick);
          // Focus the first focusable inside the modal, falling back to the modal itself.
          const focusable = _focusableInside(modal);
          (focusable[0] || modal).focus();
        });
      },
      close(result) {
        if (!instance.isOpen) return;
        instance.isOpen = false;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.removeEventListener('click', onBackdropClick);
        try { overlay.parentNode && overlay.parentNode.removeChild(overlay); } catch (_) {}
        if (_previousFocus && typeof _previousFocus.focus === 'function') {
          try { _previousFocus.focus(); } catch (_) {}
        }
        if (typeof _resolveOpen === 'function') {
          const r = _resolveOpen;
          _resolveOpen = null;
          r(result || 'close');
        }
      },
    };
    return instance;
  }

  return {
    __version,
    create,
  };
});
