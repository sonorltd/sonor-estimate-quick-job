/* sonor-plan-image.js — SHARED PLAN IMAGE (canonical master at workspace root, synced to every app's data/)
 * v1.0.0 (2026-11-07) — extracted from APP - Survey's plan loader (v0.6) for the new Site app (HARMONY §3, no copies).
 * Floors' ACTIVE plan comes from Takeoffs (takeoffs_floor_plans / bucket takeoffs-plans) — a field app never keeps its own plan.
 * The image is fitted EXACTLY as Takeoffs' loadBackgroundImage does (k = min(1400/W, 900/H), anchored top-left), so a point
 * picked on it is a Takeoffs world point. PDFs render at 4600 px long edge (pdf.js 3.11.174, isEvalSupported:false).
 *
 *   SonorPlanImage.activePlan(supa, projectId, floorId) → row | null
 *   SonorPlanImage.loadImage(supa, planRow, { blobGet?, blobSet?, bucket?, space? }) → { image, fit:{x,y,w,h}, basis:{w,h,k} }
 *       blobGet / blobSet (e.g. a SonorOutbox) cache the rendered PNG under 'plan:<id>:hd' for offline
 *   SonorPlanImage.loadBitmap(blob) · SonorPlanImage.preparePhoto(file, maxSide?, quality?) → { blob, w, h }  (EXIF-safe JPEG)
 *   SonorPlanImage.SPACE = { w: 1400, h: 900 }   — the Takeoffs frame; never change
 * Edit THIS master; `bash sync-everything.sh --only sonor-plan-image.js`.
 */
(function (root) {
  'use strict';
  var VERSION = '1.0.0', SPACE = { w: 1400, h: 900 }, BUCKET = 'takeoffs-plans';
  async function activePlan(supa, pid, floorId) {
    var r = await supa.from('takeoffs_floor_plans').select('id,revision_label,filename,mime_type,page_index,storage_path,is_active,created_at')
      .eq('project_id', pid).eq('floor_id', floorId).order('created_at', { ascending: false });
    if (r.error || !r.data || !r.data.length) return null;
    return r.data.find(function (x) { return x.is_active; }) || r.data[0];
  }
  async function signedUrl(supa, bucket, path) { var r = await supa.storage.from(bucket).createSignedUrl(path, 3600); if (r.error) throw new Error(r.error.message); return r.data.signedUrl; }
  async function renderPdf(buf, pageIndex) {
    if (!root.pdfjsLib) throw new Error('pdf.js not loaded');
    var doc = await root.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    var page = await doc.getPage(Math.min(Math.max(1, pageIndex | 0), doc.numPages));
    var vp1 = page.getViewport({ scale: 1 }), scale = Math.min(6, 4600 / Math.max(vp1.width, vp1.height)), vp = page.getViewport({ scale: scale });
    var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    return await new Promise(function (res) { c.toBlob(res, 'image/png'); });
  }
  function loadBitmap(blob) {
    if (root.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(blob); });
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(blob); });
  }
  async function loadImage(supa, planRow, o) {
    o = o || {}; var sp = o.space || SPACE, key = 'plan:' + planRow.id + ':hd', blob = null;
    if (o.blobGet) { try { blob = await o.blobGet(key); } catch (e) { } }
    if (!blob) {
      var resp = await fetch(await signedUrl(supa, o.bucket || BUCKET, planRow.storage_path)), raw = await resp.blob();
      blob = (/pdf/i.test(planRow.mime_type || '') || /\.pdf$/i.test(planRow.filename || '')) ? await renderPdf(await raw.arrayBuffer(), planRow.page_index || 1) : raw;
      if (o.blobSet) { try { await o.blobSet(key, blob); } catch (e) { } }
    }
    var img = await loadBitmap(blob), k = Math.min(sp.w / img.width, sp.h / img.height);
    return { image: img, fit: { x: 0, y: 0, w: img.width * k, h: img.height * k }, basis: { w: img.width, h: img.height, k: k } };
  }
  async function preparePhoto(file, maxSide, q) {
    var bmp = await loadBitmap(file), s = Math.min(1, (maxSide || 1600) / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', q || 0.86); });
    return { blob: blob, w: c.width, h: c.height };
  }
  root.SonorPlanImage = { VERSION: VERSION, SPACE: SPACE, activePlan: activePlan, loadImage: loadImage, loadBitmap: loadBitmap, preparePhoto: preparePhoto, renderPdf: renderPdf };
})(typeof self !== 'undefined' ? self : this);
