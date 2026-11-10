// sonor-pdf-bind.js — Sonor cross-app PDF merge orchestrator
// =================================================================
// CANONICAL MASTER at $SONOR_ROOT/sonor-pdf-bind.js
// Synced to every app's data/sonor-pdf-bind.js by sync-everything.sh
// (per Spine S-4.2 — never hand-edit the per-app copies).
//
// Purpose: merge multiple per-app PDF buffers into ONE deliverable PDF
// so the unified-package vision (Bryn directive 2026-05-07: "everything
// singing from the same page") becomes reality without rewriting any
// per-app painter.
//
// Usage:
//   const buffers = await Promise.all([
//     SonorTakeoffs.SonorPdf.fullDocument({ asBuffer: true }),
//     SonorPacks.fullDocument({ asBuffer: true }),
//     SonorEngineering.fullDocument({ asBuffer: true }),
//   ]);
//   const merged = await SonorPdfBind.merge(buffers, {
//     title: 'Caldy — Engineering Pack',
//     filename: 'sonor-caldy-engineering-pack.pdf'
//   });
//   SonorPdfBind.download(merged, 'sonor-caldy-engineering-pack.pdf');
//
// Spine v1.2.5 — additive workspace-shared seam. Compliance:
//   S-4.2: this file lives at workspace root; per-app copies in data/
//   S-4.3: companion to atomic version bumps in each app
//   S-4.5: registered in sync-everything.sh
//
// Module: window.SonorPdfBind
// Version: 1.0.0 (2026-05-07, Takeoffs v5.3.0)
//
// Dependency: pdf-lib (window.PDFLib) — already loaded by every Sonor
// app for the v2.4.x vector path. Falls back to a no-op + console.warn
// if pdf-lib isn't on the page.

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const VERSION = '1.0.0';

  function _pdfLibAvailable() {
    return !!(window.PDFLib && window.PDFLib.PDFDocument);
  }

  // ---- merge(buffers, opts) -----------------------------------------
  // buffers: Array<ArrayBuffer | Uint8Array | Blob> — per-app PDF bytes
  // opts: {
  //   title?: string,        // PDF metadata Title (defaults to "Sonor Pack")
  //   subject?: string,      // PDF metadata Subject
  //   author?: string,       // PDF metadata Author (defaults to "Sonor Smart Homes")
  //   keywords?: string,     // PDF metadata Keywords (defaults to "Sonor, Smart Homes, CEDIA")
  //   creator?: string       // PDF metadata Creator (defaults to "Sonor Cross-App Bind v1.0.0")
  // }
  // returns: Uint8Array of the merged PDF bytes
  async function merge(buffers, opts) {
    opts = opts || {};
    if (!_pdfLibAvailable()) {
      console.warn('[SonorPdfBind] pdf-lib not loaded — cannot merge');
      return null;
    }
    if (!Array.isArray(buffers) || !buffers.length) {
      console.warn('[SonorPdfBind] merge() called with no buffers');
      return null;
    }

    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();

    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (!buf) continue;
      try {
        const bytes = await _coerceToBytes(buf);
        if (!bytes) continue;
        const src = await PDFDocument.load(bytes, { updateMetadata: false });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } catch (e) {
        console.warn(`[SonorPdfBind] failed to merge buffer ${i}:`, e);
      }
    }

    // Metadata — single source of truth on the merged deck
    try {
      merged.setTitle(opts.title || 'Sonor Pack');
      merged.setSubject(opts.subject || 'Cross-app PDF deliverable');
      merged.setAuthor(opts.author || 'Sonor Smart Homes');
      merged.setKeywords([
        opts.keywords || 'Sonor, Smart Homes, CEDIA, Cross-app pack'
      ]);
      merged.setCreator(opts.creator || `Sonor Cross-App Bind v${VERSION}`);
      merged.setProducer(`Sonor Cross-App Bind v${VERSION} (pdf-lib)`);
      merged.setCreationDate(new Date());
      merged.setModificationDate(new Date());
    } catch (e) { console.warn('[SonorPdfBind] setMetadata failed:', e); }

    return await merged.save();
  }

  // ---- download(bytes, filename) ------------------------------------
  // Convenience: trigger a browser download for the merged bytes.
  function download(bytes, filename) {
    if (!bytes || (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer))) {
      console.warn('[SonorPdfBind] download() called with invalid bytes');
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'sonor-pack.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ---- assembleProject(projectId, opts) -----------------------------
  // High-level orchestrator stub. Each Sonor app should expose a
  // window.SonorAppExports.fullDocument({ asBuffer: true, projectId })
  // contract — the bind module will iterate the registered apps and
  // request a buffer from each, then merge them in canonical order.
  //
  // Canonical assembly order (per docs/SONOR-PDF-STYLE-GUIDE.md):
  //   1. Takeoffs     — Cover + Cabling Info + Bend Radius + Plans + Schedules
  //   2. Packs        — Rack Build Sheets + BOM
  //   3. Engineering  — Point-to-point schematics
  //   4. Cinema       — Cinema construction drawings
  //   5. RAMS         — Site safety pack (optional)
  //
  // Section dividers between blocks are owned by Takeoffs (already
  // shipping in Takeoffs v5.1.7+ via SonorPdf.paintSectionDivider).
  //
  // For v5.3.0 this is a STUB — the actual cross-app contract requires
  // each app to expose its asBuffer entry point. Takeoffs v5.3.0 ships
  // its half (SonorPdf.fullDocument({ asBuffer: true }) returns the
  // bytes); other apps will follow incrementally.
  async function assembleProject(projectId, opts) {
    opts = opts || {};
    console.warn(
      '[SonorPdfBind] assembleProject() v1.0.0 is a stub.\n' +
      'Each Sonor app must expose SonorAppExports.fullDocument({ asBuffer: true, projectId }) before this works end-to-end.\n' +
      'Takeoffs v5.3.0 ships the asBuffer mode; Packs / Engineering / Cinema / RAMS will follow.\n' +
      'For now, callers should invoke merge() directly with manually-collected buffers.'
    );
    return null;
  }

  // ---- internal helpers ---------------------------------------------
  async function _coerceToBytes(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      const ab = await input.arrayBuffer();
      return new Uint8Array(ab);
    }
    if (typeof input === 'string' && input.startsWith('data:application/pdf')) {
      // base64-data-URL fallback
      const bin = atob(input.split(',')[1] || '');
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    console.warn('[SonorPdfBind] _coerceToBytes — unsupported input shape:', typeof input);
    return null;
  }

  // Public API
  window.SonorPdfBind = {
    __version: VERSION,
    merge,
    download,
    assembleProject,
    available: _pdfLibAvailable
  };

})();
