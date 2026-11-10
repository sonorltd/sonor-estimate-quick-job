/* ============================================================================
   sonor-pdf-v6-status.js  ·  v1.0.0  ·  2026-05-27
   Workspace-shared (canonical at workspace root, synced to consumer apps).
   ----------------------------------------------------------------------------
   Visible PDF-export status overlay. Floating bottom-right panel that shows
   the current export phase (loading WASM / capturing CT view / painting page
   N of M / etc), success message + filename on completion, or red error
   panel on failure. Replaces the silent "did nothing" experience when
   exports fail mid-flight (Bryn 2026-05-27).

   The orchestrator (sonor-pdf-v6.js), the adapter (per-app), the Resvg
   loader (sonor-pdf-v6-resvg.js) all call into this module via the public
   API. If the host page has no DOM (Node tests etc), every method is a
   silent no-op.

   Public API:
     window.SonorPdfV6Status.show(text)        — pop up + start spinner
     window.SonorPdfV6Status.update(text)      — replace text, keep spinner
     window.SonorPdfV6Status.progress(n, total) — append "(N/M)" suffix
     window.SonorPdfV6Status.success(text)     — green checkmark + auto-hide
     window.SonorPdfV6Status.error(err)        — red border + reveal + stay
     window.SonorPdfV6Status.hide()            — dismiss now

   Spine v1.2.6 · HARMONY §3 · per Bryn 2026-05-27 ("make a status bar of
   whats happening during export").
   ============================================================================ */
(function () {
  'use strict';

  if (window.SonorPdfV6Status && window.SonorPdfV6Status.VERSION) return;

  const PANEL_ID = '__sonor_pdf_v6_status__';
  let _autoHideTimer = null;

  function _ensurePanel() {
    if (typeof document === 'undefined') return null;
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:20px',
      'z-index:2147483647',
      'min-width:280px',
      'max-width:480px',
      'padding:14px 18px',
      'background:rgba(20,20,24,0.96)',
      'color:#f3efe9',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px',
      'box-shadow:0 10px 40px rgba(0,0,0,0.45)',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'display:none',
      'opacity:0',
      'transform:translateY(8px)',
      'transition:opacity 200ms ease,transform 200ms ease,border-color 200ms ease',
      'pointer-events:none', // can't interfere with the app while up
    ].join(';');
    panel.innerHTML = [
      '<div style="display:flex;align-items:center;gap:12px;">',
      '  <div id="' + PANEL_ID + '_spinner" style="',
      '    width:18px;height:18px;flex-shrink:0;',
      '    border:2px solid rgba(255,255,255,0.2);',
      '    border-top-color:#4bb9d3;border-radius:50%;',
      '    animation:sonor_spin 800ms linear infinite;',
      '  "></div>',
      '  <div style="flex:1;min-width:0;">',
      '    <div id="' + PANEL_ID + '_title" style="font-weight:600;color:#fff;margin-bottom:2px;">PDF export</div>',
      '    <div id="' + PANEL_ID + '_text" style="color:#c5bfb6;font-size:12px;line-height:1.4;">Working…</div>',
      '  </div>',
      '</div>',
    ].join('');
    // Inject keyframes once
    if (!document.getElementById(PANEL_ID + '_styles')) {
      const style = document.createElement('style');
      style.id = PANEL_ID + '_styles';
      style.textContent = '@keyframes sonor_spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
    document.body.appendChild(panel);
    return panel;
  }

  function _clearAutoHide() {
    if (_autoHideTimer) { clearTimeout(_autoHideTimer); _autoHideTimer = null; }
  }

  function show(text) {
    _clearAutoHide();
    const p = _ensurePanel(); if (!p) return;
    const spinner = document.getElementById(PANEL_ID + '_spinner');
    const txt = document.getElementById(PANEL_ID + '_text');
    if (spinner) { spinner.style.display = ''; spinner.style.borderTopColor = '#4bb9d3'; }
    if (txt) txt.textContent = text || 'Working…';
    p.style.borderColor = 'rgba(255,255,255,0.12)';
    p.style.display = 'block';
    // Trigger reflow then fade in
    void p.offsetHeight;
    p.style.opacity = '1';
    p.style.transform = 'translateY(0)';
  }

  function update(text) {
    const p = _ensurePanel(); if (!p) return;
    const txt = document.getElementById(PANEL_ID + '_text');
    if (txt) txt.textContent = text;
    if (p.style.display === 'none' || p.style.opacity === '0') show(text);
  }

  function progress(n, total, prefix) {
    update((prefix || 'Painting page') + ' ' + n + ' of ' + total);
  }

  function success(text) {
    _clearAutoHide();
    const p = _ensurePanel(); if (!p) return;
    const spinner = document.getElementById(PANEL_ID + '_spinner');
    const txt = document.getElementById(PANEL_ID + '_text');
    if (spinner) {
      // Replace spinner with green check (CSS only)
      spinner.style.animation = 'none';
      spinner.style.border = 'none';
      spinner.style.background = '#78ba57';
      spinner.style.borderRadius = '50%';
      spinner.style.position = 'relative';
      spinner.innerHTML = '<svg viewBox="0 0 18 18" style="width:18px;height:18px;display:block;"><path d="M4 9 L8 13 L14 6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (txt) txt.textContent = text || 'Done';
    p.style.borderColor = '#78ba57';
    _autoHideTimer = setTimeout(hide, 5000);
  }

  function error(err) {
    _clearAutoHide();
    const p = _ensurePanel(); if (!p) return;
    const spinner = document.getElementById(PANEL_ID + '_spinner');
    const txt = document.getElementById(PANEL_ID + '_text');
    if (spinner) {
      spinner.style.animation = 'none';
      spinner.style.border = 'none';
      spinner.style.background = '#ec6061';
      spinner.style.borderRadius = '50%';
      spinner.innerHTML = '<svg viewBox="0 0 18 18" style="width:18px;height:18px;display:block;"><path d="M5 5 L13 13 M13 5 L5 13" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';
    }
    if (txt) {
      const msg = (err && err.message) || (typeof err === 'string' ? err : String(err));
      txt.textContent = 'FAILED: ' + msg;
    }
    const title = document.getElementById(PANEL_ID + '_title');
    if (title) title.textContent = 'PDF export';
    p.style.borderColor = '#ec6061';
    p.style.pointerEvents = 'auto'; // allow user to click to dismiss
    p.style.cursor = 'pointer';
    p.onclick = hide;
    // No auto-hide for errors — stay until user clicks
  }

  function hide() {
    _clearAutoHide();
    const p = document.getElementById(PANEL_ID); if (!p) return;
    p.style.opacity = '0';
    p.style.transform = 'translateY(8px)';
    p.style.pointerEvents = 'none';
    p.onclick = null;
    setTimeout(() => {
      if (p && p.style.opacity === '0') p.style.display = 'none';
    }, 250);
  }

  window.SonorPdfV6Status = {
    VERSION: '1.0.0',
    show, update, progress, success, error, hide,
  };
})();
