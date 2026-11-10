/*!
 * sonor-block-glow.js — BLOCK GLOW + INFO CARD (root master, synced to every app's data/) — v1.6.1 · 2026-11-05
 * ----------------------------------------------------------------------------------------------------------------
 * Bryn: "make the takeoffs icons glow and be ref'd to info … without it becoming a ball and chain to manage".
 *
 * ONE module for "a placed thing on a plan canvas glows in its service colour and tells you what it is":
 *   · hover  → soft halo in the block's own colour (+ a fainter halo on related blocks: pair master/slaves, same zone)
 *   · card   → a small card beside the block: what it is, where it is, the product it maps to, where it came from,
 *              and the notes / RFIs that sit on it. Click (select) pins the card so its links can be used.
 * Nothing here is stored: halos are painted on a separate overlay <canvas> (pointer-events:none, never saved, never
 * exported) and the card is built on demand from data the block ALREADY carries (+ the live Library row + plan notes).
 * So there is no second list to maintain — the "ball and chain" Bryn ruled out.
 *
 * API
 *   SonorBlockGlow.attachFabric(canvas, {
 *     resolve(obj)  -> info | null     // info = { colour, title, sub, rows:[[k,v,warn?]], chips:[{t,warn}], notes:[{id,text}], links:[{label,href|onClick}] }
 *     related(obj)  -> [obj]           // optional — fainter halos
 *     enabled()     -> bool            // optional — false while drawing tools are active
 *   })
 *   SonorBlockGlow.attachSvg(svgEl, {
 *     selector: '.cd-el',               // the hoverable element groups inside the svg (default '[data-id]')
 *     resolve(el)  -> info | null,      // same info shape as attachFabric — built from the element's own data
 *     related(el)  -> [el],             // optional — fainter halos (a speaker's pair, a zone's strips)
 *     selected()   -> el | null,        // optional — the app's current selection keeps its halo (no card)
 *     enabled()    -> bool              // optional — false while a drawing tool is active
 *     clickPins: false,                  // v1.6.0 — click-to-pin is the DEFAULT in every app (attachFabric + attachSvg): hover = a light
 *                                        //          card with no buttons that never takes the pointer; a CLICK (no drag) pins the full card
 *                                        //          (links + ✕) beside the item until ✕ / Esc / a click elsewhere / the same item again; a drag
 *                                        //          hides it. info.hint shows on hover, info.pinHint when pinned. false = the old 1.4 linger.
 *     haloShape: 'circle'|'rect'|'auto', // optional — 'auto' draws a rounded-rect halo around wide / tall elements (device cards)
 *     hot(el)      -> [el],             // optional — elements tagged .sbg-hot while el is hovered / selected (a device's wires)
 *     boxOf(el,pt) -> {left,top,width,height} | null   // optional — host-space box to glow instead of el's rect (a wire: around the pointer)
 *   })                                   // v1.2.0 — SVG canvases (Cinema Takeoff / Design). Same painter, same card, same rules.
 *                                        // v1.3.0 — any positioned DOM host (React Flow panes, HTML rack grids): haloShape / hot / boxOf,
 *                                        //          info.halo === false (card only — a wire), api.destroy() for component unmount.
 *   SonorBlockGlow.paintHalo(ctx, cx, cy, r, colour, {dpr, strength})   // pure painter (other canvases can reuse)
 *   SonorBlockGlow.cardHtml(info)                                        // pure HTML builder
 * Styling uses kit tokens (graphite first, slate fallback). The halo is a canvas effect for plan blocks — it is NOT
 * a control hover (sonor-platform §18 still governs buttons/rows; §32 governs this).
 */
(function (global) {
  'use strict';
  var VERSION = '1.6.1';   // 1.6.1 (2026-11-05, Bryn: "the clicked version jumps around everywhere") — a card picks its spot ONCE when it opens and then stays anchored to its item (follows only a pan / zoom / scroll), never chases the pointer   // 1.6.0 (2026-11-05, Bryn: "we need same behaviours across all apps, no monoliths rules") — click-to-pin is the default for BOTH attachers, every app: hover card buttonless + click-through, click (no drag) pins with links + ✕, drag hides, Esc / ✕ / click elsewhere / same item again closes   // 1.5.0 (2026-11-05, owner on the client portal plan: "mouseovers disappear before raise ticket button can be clicked how to solve this without tooltip being in the way of everything?") — attachSvg({ clickPins:true }): hover card is buttonless + click-through; click pins the card with its links and a ✕   // 1.4.0 (2026-11-01, owner: "the tool tips on takeoffs site version buttons cannot be clicked because it disappears once mouse moves") — a card with links stays up for a short grace (GRACE_MS) after the pointer leaves the item, holds while the pointer is on it (and stops moving), and hides when the pointer leaves the card; both attachFabric and attachSvg   // 1.3.1 (2026-10-31, owner: "can tool tips not be direct under mouse") — attachSvg(): the card never sits under the pointer or over the hovered item (pointer corners as candidates)   // 1.3.0 (2026-10-30, Engineering polish: "flashy mouseovers like takeoffs" on React / HTML canvases) — attachSvg(): haloShape 'rect'|'auto' (rounded-rect halo for device cards), opts.hot (wires brighten with .sbg-hot), opts.boxOf, info.halo === false, api.destroy()   // 1.2.0 (2026-10-16, Bryn: "things like the glowing and mouseovers we now have in main takeoffs app, CD and CT has fallen well behind") — attachSvg(): the same halo + card for SVG canvases (Cinema Takeoff, Cinema Design plans)   // 1.1.0 (2026-10-13, Bryn: "needs to also disappear upon click and drag because it obscures the view") — card hides on mouse-down / drag; selection keeps the halo only; ⌥-click (Alt) pins the card

  function hexA(hex, a) {
    var h = String(hex || '#f5d05c').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h.slice(0, 6), 16); if (!isFinite(n)) n = 0xf5d05c;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function paintHalo(ctx, cx, cy, r, colour, o) {
    o = o || {}; var dpr = o.dpr || 1, k = o.strength == null ? 1 : o.strength;
    ctx.save();
    var g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r * 1.55);
    g.addColorStop(0, hexA(colour, 0.22 * k)); g.addColorStop(1, hexA(colour, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = hexA(colour, 0.95 * k); ctx.shadowBlur = 14 * dpr * k;
    ctx.strokeStyle = hexA(colour, 0.85 * k); ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // v1.3.0 — the same breathing halo around a rectangle (a device card / rack face): soft wash + glowing edge.
  function paintHaloRect(ctx, b, colour, o) {
    o = o || {}; var dpr = o.dpr || 1, k = o.strength == null ? 1 : o.strength, pad = 5 * dpr, rad = (o.radius == null ? 7 : o.radius) * dpr;
    function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    ctx.save();
    for (var i = 4; i >= 1; i--) { ctx.fillStyle = hexA(colour, 0.045 * k); rr(b.x - pad * i, b.y - pad * i, b.w + 2 * pad * i, b.h + 2 * pad * i, rad + pad * i); ctx.fill(); }
    ctx.shadowColor = hexA(colour, 0.95 * k); ctx.shadowBlur = 14 * dpr * k;
    ctx.strokeStyle = hexA(colour, 0.85 * k); ctx.lineWidth = 2 * dpr;
    rr(b.x - pad / 2, b.y - pad / 2, b.w + pad, b.h + pad, rad); ctx.stroke();
    ctx.restore();
  }

  function ensureStyles() {
    if (document.getElementById('sbg-styles')) return;
    var css = [
      '.sbg-card{position:absolute;z-index:7;max-width:300px;min-width:200px;pointer-events:none;box-sizing:border-box;',
      ' background:var(--card,var(--bg-1,#242426));color:var(--text-primary,#F5F5F7);border:1px solid var(--border,#3a3a3c);',
      ' border-left:3px solid var(--sbg-c,#f5d05c);border-radius:8px;padding:8px 10px;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      ' box-shadow:0 8px 28px rgba(0,0,0,.35);transition:opacity var(--motion,120ms ease);}',
      '.sbg-card.pinned,.sbg-card.live{pointer-events:auto;}',   /* 1.4.0 — a card with links can be reached and clicked */
      '.sbg-h{display:flex;align-items:center;gap:7px;font-weight:700;font-size:12.5px;}',
      '.sbg-dot{width:9px;height:9px;border-radius:50%;background:var(--sbg-c,#f5d05c);box-shadow:0 0 8px var(--sbg-c,#f5d05c);flex:none;}',
      '.sbg-sub{font-family:"DM Mono",ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--text-muted,#98989D);margin:1px 0 5px 16px;}',
      '.sbg-rows{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;}',
      '.sbg-k{color:var(--text-muted,#98989D);white-space:nowrap;}',
      '.sbg-v{color:var(--text-secondary,#C7C7CC);overflow-wrap:anywhere;}',
      '.sbg-warn{color:var(--status-amber,#E8A317)!important;}',
      '.sbg-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}',
      '.sbg-chip{font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;border:1px solid var(--border,#3a3a3c);color:var(--text-secondary,#C7C7CC);}',
      '.sbg-chip.warn{border-color:var(--status-amber,#E8A317);color:var(--status-amber,#E8A317);}',
      '.sbg-notes{margin:6px 0 0;padding:5px 0 0;border-top:1px solid var(--border,#3a3a3c);list-style:none;}',
      '.sbg-notes li{margin:2px 0;color:var(--text-secondary,#C7C7CC);} .sbg-notes b{color:#8058a1;margin-right:4px;}',
      '.sbg-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}',
      '.sbg-links a,.sbg-links button{font-size:11px;font-weight:600;color:var(--text-primary,#F5F5F7);background:transparent;',
      ' border:1px solid var(--border,#3a3a3c);border-radius:5px;padding:2px 8px;cursor:pointer;text-decoration:none;}',
      '.sbg-hint{margin-top:6px;font-size:10px;color:var(--text-muted,#98989D);}',
      '.sbg-card.pinned{box-shadow:0 0 0 1px var(--sbg-c,#f5d05c),0 0 22px -4px var(--sbg-c,#f5d05c),0 10px 30px rgba(0,0,0,.45);padding-right:28px;animation:sbgPin .18s cubic-bezier(.2,.8,.2,1);}',
      '.sbg-x{position:absolute;top:5px;right:6px;width:20px;height:20px;border:0;border-radius:50%;background:transparent;color:var(--text-muted,#98989D);font-size:15px;line-height:20px;cursor:pointer;padding:0;}',
      '.sbg-x:hover{color:var(--text-primary,#F5F5F7);background:rgba(255,255,255,.08);}',
      '.sbg-links button:hover,.sbg-links a:hover{border-color:var(--sbg-c,#f5d05c);box-shadow:0 0 12px -2px var(--sbg-c,#f5d05c);}',
      '@keyframes sbgPin{from{transform:scale(.96);opacity:.4}to{transform:none;opacity:1}}',
      '.sbg-hot{--sbg-hot:1;}'   /* v1.3.0 — the app styles .sbg-hot (a hovered device\'s wires brighten); the class alone changes nothing */
    ].join('\n');
    var el = document.createElement('style'); el.id = 'sbg-styles'; el.textContent = css; document.head.appendChild(el);
  }

  function cardHtml(info) {
    if (!info) return '';
    var h = '<div class="sbg-h"><span class="sbg-dot"></span><span>' + esc(info.title || 'Block') + '</span></div>';
    if (info.sub) h += '<div class="sbg-sub">' + esc(info.sub) + '</div>';
    var rows = (info.rows || []).filter(function (r) { return r && r[1] != null && r[1] !== ''; });
    if (rows.length) h += '<div class="sbg-rows">' + rows.map(function (r) {
      return '<span class="sbg-k">' + esc(r[0]) + '</span><span class="sbg-v' + (r[2] ? ' sbg-warn' : '') + '">' + esc(r[1]) + '</span>';
    }).join('') + '</div>';
    if (info.chips && info.chips.length) h += '<div class="sbg-chips">' + info.chips.map(function (c) { return '<span class="sbg-chip' + (c.warn ? ' warn' : '') + '">' + esc(c.t) + '</span>'; }).join('') + '</div>';
    if (info.notes && info.notes.length) h += '<ul class="sbg-notes">' + info.notes.slice(0, 4).map(function (n) {
      return '<li>' + (n.id ? '<b>' + esc(n.id) + '</b>' : '') + esc(String(n.text || '').slice(0, 140)) + '</li>';
    }).join('') + '</ul>';
    if (info.links && info.links.length) h += '<div class="sbg-links">' + info.links.map(function (l, i) {
      return l.href ? '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>' : '<button type="button" data-sbg-link="' + i + '">' + esc(l.label) + '</button>';
    }).join('') + '</div>';
    if (info.hint) h += '<div class="sbg-hint">' + esc(info.hint) + '</div>';
    return h;
  }

  // 1.6.0 — ONE card behaviour for every app. Hover shows what the thing is (no buttons, click-through, so it is never in
  // the way); a click pins the full card with its links and a close button.
  var CLICK_PX = 5;
  function shownInfo(info, pin) {
    if (pin) return Object.assign({}, info, { hint: info.pinHint || '' });
    var has = info.links && info.links.length;
    return Object.assign({}, info, { links: [], hint: info.hint || (has ? 'Click for options' : '') });
  }
  function fillCard(card, info, pin, onLink, onClose) {
    card.style.setProperty('--sbg-c', info.colour || '#f5d05c');
    card.__at = null;   // 1.6.1 — new card → pick its spot once
    card.innerHTML = (pin ? '<button type="button" class="sbg-x" data-sbg-close aria-label="Close">×</button>' : '') + cardHtml(info);
    card.classList.toggle('pinned', !!pin); card.classList.toggle('live', !!(info.links && info.links.length)); card.style.display = '';
    Array.prototype.forEach.call(card.querySelectorAll('[data-sbg-link]'), function (btn) {
      var l = info.links[+btn.getAttribute('data-sbg-link')];
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); onLink(l); });
    });
    var x = card.querySelector('[data-sbg-close]'); if (x) x.addEventListener('click', function (ev) { ev.stopPropagation(); onClose(); });
  }

  // 1.4.0 — the reach-the-card rule. A card carrying links ("live") does not vanish the moment the pointer leaves the
  // item: hide waits GRACE_MS, entering the card cancels it and holds the card still, leaving the card hides it (after a
  // short beat, so stepping back onto the item keeps it). A card without links still hides at once.
  var GRACE_MS = 450, CARD_OUT_MS = 180;
  function linger(card, hideNow) {
    var t = 0, onCard = false;
    function cancel() { if (t) { clearTimeout(t); t = 0; } }   // a pending hide keeps the card frozen in place (it must not flee the pointer heading for it)
    function later(ms) { cancel(); t = setTimeout(function () { t = 0; if (!onCard) hideNow(); }, ms); }
    card.addEventListener('pointerenter', function () { onCard = true; cancel(); });
    // presses, clicks and wheel on the card belong to the card: they must not pan / zoom / deselect in the host page
    ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'].forEach(function (n) { card.addEventListener(n, function (ev) { ev.stopPropagation(); }, n === 'wheel' ? { passive: true } : false); });
    card.addEventListener('pointerleave', function () { onCard = false; if (card.style.display !== 'none') later(CARD_OUT_MS); });
    return {
      leave: function () {   // the pointer left the hovered item
        if (card.style.display !== 'none' && card.classList.contains('live') && !card.classList.contains('pinned')) { if (!t && !onCard) later(GRACE_MS); return; }
        cancel(); hideNow();
      },
      cancel: cancel,
      reset: function () { cancel(); onCard = false; },
      onCard: function () { return onCard; },
      still: function () { return onCard || !!t; },   // hold the card where it is (pointer on it, or on its way)
      owns: function (el) { return !!(el && card.contains(el)); }
    };
  }

  function attachFabric(canvas, opts) {
    opts = opts || {};
    if (!canvas || !canvas.on || canvas.__sonorBlockGlow) return canvas && canvas.__sonorBlockGlow;
    ensureStyles();
    var hostEl = canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentNode;
    var ov = document.createElement('canvas'); ov.className = 'sonor-block-glow-layer'; ov.setAttribute('aria-hidden', 'true');
    ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:5;';
    var card = document.createElement('div'); card.className = 'sbg-card'; card.style.display = 'none';
    if (hostEl) { hostEl.appendChild(ov); hostEl.appendChild(card); }
    var ctx = ov.getContext('2d'), hover = null, pinned = null, sel = null, info = null, raf = 0;   // sel 1.1.0 — selected block keeps its halo, no card
    var CLICK = opts.clickPins !== false, downAt = null;   // 1.6.0

    function enabled() { try { return opts.enabled ? !!opts.enabled() : true; } catch (e) { return true; } }
    function resolve(o) { try { return o ? opts.resolve(o) : null; } catch (e) { console.warn('[block-glow] resolve', e && e.message); return null; } }
    function related(o) { try { return (o && opts.related) ? (opts.related(o) || []) : []; } catch (e) { return []; } }
    function screenBox(o) {
      var r = o.getBoundingRect(false, true);   // viewport (screen) coords
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: Math.max(8, Math.max(r.width, r.height) / 2 + 5), box: r };
    }
    function paint() {
      var W = canvas.getWidth(), H = canvas.getHeight(), dpr = (canvas.getRetinaScaling && canvas.getRetinaScaling()) || global.devicePixelRatio || 1;
      if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); ov.style.width = W + 'px'; ov.style.height = H + 'px'; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ov.width, ov.height);
      var focus = pinned || hover || sel; if (!focus) return; if (!info) { info = resolve(focus); if (!info) return; }
      if (canvas.getObjects().indexOf(focus) < 0) { clear(); return; }
      var t = (Date.now() % 1600) / 1600, breathe = 0.82 + 0.18 * Math.sin(t * Math.PI * 2);
      var rel = [];
      related(focus).forEach(function (o) { if (canvas.getObjects().indexOf(o) < 0) return; var rb = screenBox(o); rel.push(rb); paintHalo(ctx, rb.cx * dpr, rb.cy * dpr, rb.r * dpr, info.colour, { dpr: dpr, strength: 0.5 }); });
      var b = screenBox(focus); paintHalo(ctx, b.cx * dpr, b.cy * dpr, b.r * dpr, info.colour, { dpr: dpr, strength: breathe });
      place(b, rel);
    }
    function place(b, rel) {
      if (card.style.display === 'none' || lg.still()) return;   // 1.4.0 — the card holds still while the pointer heads for it / is on it
      if (card.__at) { card.style.left = Math.round(b.cx + card.__at[0]) + 'px'; card.style.top = Math.round(b.cy + card.__at[1]) + 'px'; return; }   // 1.6.1 — anchored to its item's centre (a pulsing / scaling item doesn't shake it)
      var W = canvas.getWidth(), H = canvas.getHeight(), cw = card.offsetWidth || 240, ch = card.offsetHeight || 120, g = 14;
      try {   // v1.0.1 — clamp to the VISIBLE part of the canvas (the canvas can be taller/wider than the window or its scroller)
        var hr = hostEl.getBoundingClientRect(), vw = global.innerWidth || W, vh = global.innerHeight || H;
        W = Math.min(W, vw - hr.left); H = Math.min(H, vh - hr.top - 34);   // 34 = fixed status bar
      } catch (e) { }
      var cands = [[b.box.left + b.box.width + g, b.cy - ch / 2], [b.box.left - cw - g, b.cy - ch / 2], [b.cx - cw / 2, b.box.top + b.box.height + g], [b.cx - cw / 2, b.box.top - ch - g]];
      var best = null, bestScore = 1e9;
      cands.forEach(function (c, i) {
        var x = Math.max(6, Math.min(W - cw - 6, c[0])), y = Math.max(6, Math.min(H - ch - 6, c[1]));
        var cover = (rel || []).concat([b]).filter(function (r) { return r.cx > x - r.r && r.cx < x + cw + r.r && r.cy > y - r.r && r.cy < y + ch + r.r; }).length;
        var score = cover * 100 + i;   // fewest blocks hidden, then right > left > below > above
        if (score < bestScore) { bestScore = score; best = [x, y]; }
      });
      card.style.left = Math.round(best[0]) + 'px'; card.style.top = Math.round(best[1]) + 'px';
      card.__at = [best[0] - b.cx, best[1] - b.cy];   // 1.6.1
    }
    function loop() { cancelAnimationFrame(raf); if (!(hover || pinned || sel)) return; paint(); raf = requestAnimationFrame(loop); }
    function show(o, pin) {
      info = resolve(o); if (!info) { clear(); return; }
      fillCard(card, CLICK ? shownInfo(info, pin) : info, pin && CLICK, function (l) { try { l.onClick && l.onClick(o); } catch (e) { console.warn('[block-glow] link', e && e.message); } if (CLICK) clear(); }, clear);
      lg.cancel();
      loop();
    }
    function clear() { hover = null; pinned = null; sel = null; info = null; card.style.display = 'none'; lg.reset(); cancelAnimationFrame(raf); paint(); }
    function unhover() { hover = null; info = null; card.style.display = 'none'; if (sel) loop(); else paint(); }
    var lg = linger(card, function () { if (!pinned) unhover(); });

    canvas.on('mouse:over', function (e) {
      if (pinned || suppressed || !enabled()) return; var o = e && e.target; if (!o || !resolve(o)) return;
      hover = o; show(o, false);
    });
    canvas.on('mouse:out', function (e) { if (pinned) return; if (e && e.target === hover) lg.leave(); });   // 1.4.0 — a card with links lingers so it can be reached
    // 1.1.0 — the card gets out of the way: any mouse-down on the canvas hides it (click, drag, marquee) and it stays hidden
    // until the pointer leaves and re-enters a block. Selecting a block keeps the HALO (paint) but no card; ⌥/Alt-click pins
    // the interactive card on purpose.
    var suppressed = false;
    canvas.on('mouse:down', function (e) {
      var ev = e && e.e, o = e && e.target;
      if (ev && ev.altKey && o && o.type !== 'activeSelection' && enabled() && resolve(o)) { pinned = o; hover = null; suppressed = false; show(o, true); downAt = null; return; }
      downAt = ev ? { x: ev.clientX, y: ev.clientY, o: o, prev: pinned } : null;   // 1.6.0 — a click (no drag) pins on mouse-up
      if (pinned) { pinned = null; }
      suppressed = true; hover = null; info = null; card.style.display = 'none'; lg.reset(); cancelAnimationFrame(raf); paint();
    });
    canvas.on('mouse:up', function (e) {   // 1.6.0 — click-to-pin
      var d = downAt, ev = e && e.e; downAt = null; if (!CLICK || !d || !ev || !d.o) return;
      if (Math.abs(ev.clientX - d.x) > CLICK_PX || Math.abs(ev.clientY - d.y) > CLICK_PX) return;   // a drag never pins
      var o = d.o; if (o === d.prev || o.type === 'activeSelection' || !enabled() || !resolve(o)) return;   // same item again = let go
      pinned = o; hover = null; suppressed = false; show(o, true);
    });
    if (CLICK) document.addEventListener('pointerdown', function (ev) { if (pinned && hostEl && !hostEl.contains(ev.target)) clear(); }, true);   // 1.6.0 — a click elsewhere lets go
    canvas.on('mouse:out', function () { suppressed = false; });
    function onSel() {
      var a = canvas.getActiveObject && canvas.getActiveObject();
      if (pinned && a !== pinned) { pinned = null; card.style.display = 'none'; }
      sel = (a && a.type !== 'activeSelection' && enabled() && resolve(a)) ? a : null; info = null; loop();
    }
    canvas.on('selection:created', onSel); canvas.on('selection:updated', onSel); canvas.on('selection:cleared', function () { sel = null; if (pinned) clear(); else { info = null; cancelAnimationFrame(raf); paint(); } });
    canvas.on('object:moving', function () { if (hover || pinned) { hover = null; card.style.display = 'none'; } paint(); });
    canvas.on('after:render', function () { if (!(hover || pinned || sel)) { if (ov.width) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ov.width, ov.height); } } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && (pinned || hover)) clear(); });
    var api = { clear: clear, refresh: function () { var o = pinned || hover; if (o) show(o, !!pinned); else if (sel) { info = null; paint(); } }, VERSION: VERSION };
    canvas.__sonorBlockGlow = api; return api;
  }

  // ── v1.2.0 — SVG canvases (Cinema Takeoff #drawSvg, Cinema Design plans): same halo painted on an overlay <canvas>
  //    over the svg's positioned parent, same card, same rules (hover → halo + card · mouse-down hides the card ·
  //    selection keeps the halo · ⌥-click pins · Esc clears). Screen coords come from getBoundingClientRect, so zoom /
  //    pan / viewBox changes need no bookkeeping. Nothing is written into the svg (exports stay clean).
  function attachSvg(svg, opts) {
    opts = opts || {};
    if (!svg || svg.__sonorBlockGlow) return svg && svg.__sonorBlockGlow;
    ensureStyles();
    var hostEl = opts.host || svg.parentNode; if (!hostEl) return null;   // v1.3.0 — opts.host: paint over a given positioned element (the host may BE the listened element)
    try { if (getComputedStyle(hostEl).position === 'static') hostEl.style.position = 'relative'; } catch (e) {}
    var ov = document.createElement('canvas'); ov.className = 'sonor-block-glow-layer'; ov.setAttribute('aria-hidden', 'true');
    ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:5;';
    var card = document.createElement('div'); card.className = 'sbg-card'; card.style.display = 'none';
    hostEl.appendChild(ov); hostEl.appendChild(card);
    var ctx = ov.getContext('2d'), hover = null, pinned = null, sel = null, info = null, raf = 0, suppressed = false, pressed = false, downId = null;
    var CLICK = opts.clickPins !== false, downAt = null;   // 1.6.0 — click-to-pin is the default
    var selector = opts.selector || '[data-id]', haloShape = opts.haloShape || 'circle', lastPt = null, hotEls = [];
    function idOf(o) { return o && o.getAttribute ? (o.getAttribute('data-id') || o.getAttribute('data-spk') || o.getAttribute('data-device') || o.getAttribute('data-item-id') || null) : null; }
    function enabled() { try { return opts.enabled ? !!opts.enabled() : true; } catch (e) { return true; } }
    function resolve(o) { try { return o ? opts.resolve(o) : null; } catch (e) { console.warn('[block-glow] resolve', e && e.message); return null; } }
    function related(o) { try { return (o && opts.related) ? (opts.related(o) || []) : []; } catch (e) { return []; } }
    function selected() { try { return opts.selected ? opts.selected() : null; } catch (e) { return null; } }
    function inHost(o) { if (!o) return false; if (svg.contains(o)) return true; try { var r = o.getRootNode && o.getRootNode(); return !!(r && r.host && svg.contains(r.host)); } catch (e) { return false; } }   // v1.3.0 — shadow-DOM items (web-component grids) count when their host is inside
    function alive(o) { return !!(o && o.isConnected && inHost(o)); }
    function findLike(o) {   // v1.3.0 — the re-rendered twin of an element, by any id attribute, honouring a comma selector
      var i = idOf(o); if (!i) return null; var q = CSS.escape(i), all = svg.querySelectorAll('[data-id="' + q + '"], [data-device="' + q + '"], [data-item-id="' + q + '"]');
      for (var k = 0; k < all.length; k++) { if (all[k].matches(selector)) return all[k]; } return null;
    }
    function screenBox(o) {
      var box = null;
      if (opts.boxOf) { try { box = opts.boxOf(o, lastPt) || null; } catch (e) { box = null; } }
      if (!box) { var r = o.getBoundingClientRect(), h = hostEl.getBoundingClientRect(); box = { left: r.left - h.left + hostEl.scrollLeft, top: r.top - h.top + hostEl.scrollTop, width: r.width, height: r.height }; }
      return { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r: Math.max(8, Math.max(box.width, box.height) / 2 + 5), box: box };
    }
    // v1.3.0 — circle (plan blocks) or rounded rect (device cards / rack faces); 'auto' picks by aspect
    function halo(b, colour, o) {
      var shape = haloShape; if (shape === 'auto') { var a = b.box.width / Math.max(1, b.box.height); shape = (a > 1.6 || a < 0.625 || Math.max(b.box.width, b.box.height) > 140) ? 'rect' : 'circle'; }
      if (shape === 'rect') paintHaloRect(ctx, { x: b.box.left * o.dpr, y: b.box.top * o.dpr, w: b.box.width * o.dpr, h: b.box.height * o.dpr }, colour, o);
      else paintHalo(ctx, b.cx * o.dpr, b.cy * o.dpr, b.r * o.dpr, colour, o);
    }
    function setHot(o) {
      hotEls.forEach(function (el) { try { el.classList.remove('sbg-hot'); } catch (e) {} }); hotEls = [];
      if (!o || !opts.hot) return;
      try { hotEls = (opts.hot(o) || []).filter(Boolean); } catch (e) { hotEls = []; }
      hotEls.forEach(function (el) { try { el.classList.add('sbg-hot'); } catch (e) {} });
    }
    function size() {
      var W = hostEl.clientWidth, H = hostEl.clientHeight, dpr = global.devicePixelRatio || 1;
      if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); ov.style.width = W + 'px'; ov.style.height = H + 'px'; }
      return { W: W, H: H, dpr: dpr };
    }
    function paint() {
      var s = size(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ov.width, ov.height);
      var focus = pinned || hover || sel; if (!focus) return; if (!alive(focus)) { clear(); return; }
      if (!info) { info = resolve(focus); if (!info) return; }
      var t = (Date.now() % 1600) / 1600, breathe = 0.82 + 0.18 * Math.sin(t * Math.PI * 2), rel = [];
      related(focus).forEach(function (o) { if (!alive(o)) return; var rb = screenBox(o); rel.push(rb); halo(rb, info.colour, { dpr: s.dpr, strength: 0.45 }); });
      var b = screenBox(focus); if (info.halo !== false) halo(b, info.colour, { dpr: s.dpr, strength: breathe });
      place(b, rel, s);
    }
    function place(b, rel, s) {
      if (card.style.display === 'none' || lg.still()) return;   // 1.4.0 — the card holds still while the pointer heads for it / is on it
      if (card.__at) { card.style.left = Math.round(b.cx + card.__at[0]) + 'px'; card.style.top = Math.round(b.cy + card.__at[1]) + 'px'; return; }   // 1.6.1 — anchored to its item's centre (a pulsing / scaling item doesn't shake it)
      var W = s.W, H = s.H, cw = card.offsetWidth || 240, ch = card.offsetHeight || 120, g = 14;
      var hr = { left: 0, top: 0 };
      try { hr = hostEl.getBoundingClientRect(); var vw = global.innerWidth || W, vh = global.innerHeight || H; W = Math.min(W, vw - hr.left); H = Math.min(H, vh - hr.top - 34); } catch (e) {}
      var cands = [[b.box.left + b.box.width + g, b.cy - ch / 2], [b.box.left - cw - g, b.cy - ch / 2], [b.cx - cw / 2, b.box.top + b.box.height + g], [b.cx - cw / 2, b.box.top - ch - g]];
      // v1.3.1 (owner 2026-10-31: "can tool tips not be direct under mouse so clicking and moving devices is still possible")
      // — the card never sits under the pointer or over the hovered item: corners round the pointer join the candidates,
      // and a spot covering the pointer (+ a 28 px margin) or the hovered item's own box is ruled out before anything else.
      var P = lastPt, M = 28;
      if (P) cands.push([P.x + M, P.y + M], [P.x - cw - M, P.y + M], [P.x + M, P.y - ch - M], [P.x - cw - M, P.y - ch - M]);
      var minX = 6, minY = 6;   // v1.3.0 — a host scrolled partly off the top / left (a tall rack frame) keeps the card on screen
      try { if (hr.left < 0) minX = 6 - hr.left; if (hr.top < 0) minY = 6 - hr.top; } catch (e) {}
      var bx = b.box, best = null, bestScore = 1e9;
      cands.forEach(function (c, i) {
        var x = Math.max(minX, Math.min(W - cw - 6, c[0])), y = Math.max(minY, Math.min(H - ch - 6, c[1]));
        var underPointer = P && P.x > x - M && P.x < x + cw + M && P.y > y - M && P.y < y + ch + M;
        var overItem = bx && x < bx.left + bx.width && x + cw > bx.left && y < bx.top + bx.height && y + ch > bx.top;
        var cover = (rel || []).concat([b]).filter(function (r) { return r.cx > x - r.r && r.cx < x + cw + r.r && r.cy > y - r.r && r.cy < y + ch + r.r; }).length;
        var score = (underPointer ? 100000 : 0) + (overItem ? 10000 : 0) + cover * 100 + i; if (score < bestScore) { bestScore = score; best = [x, y]; }
      });
      card.style.left = Math.round(best[0]) + 'px'; card.style.top = Math.round(best[1]) + 'px';
      card.__at = [best[0] - b.cx, best[1] - b.cy];   // 1.6.1
    }
    function loop() { cancelAnimationFrame(raf); if (!(hover || pinned || sel)) return; paint(); raf = requestAnimationFrame(loop); }
    function show(o, pin) {
      info = resolve(o); if (!info) { clear(); return; }
      card.style.setProperty('--sbg-c', info.colour || '#f5d05c');
      fillCard(card, CLICK ? shownInfo(info, pin) : info, pin && CLICK, function (l) { try { l.onClick && l.onClick(o); } catch (e) { console.warn('[block-glow] link', e && e.message); } if (CLICK) clear(); }, clear);
      lg.cancel();
      setHot(o);
      loop();
    }
    function clear() { hover = null; pinned = null; sel = null; info = null; card.style.display = 'none'; setHot(null); lg.reset(); cancelAnimationFrame(raf); paint(); }
    function unhover() { hover = null; info = null; card.style.display = 'none'; setHot(null); if (sel) loop(); else paint(); }
    var lg = linger(card, function () { if (!pinned) unhover(); });
    function target(ev) {
      // v1.3.0 — walk the composed path first so items inside a web component's shadow root (e.g. a slot grid) resolve
      var path = ev.composedPath ? ev.composedPath() : null;
      if (path) { for (var i = 0; i < path.length; i++) { var n = path[i]; if (n === svg) break; if (n && n.matches && n.matches(selector) && inHost(n)) return n; } }
      var t = ev.target && ev.target.closest ? ev.target.closest(selector) : null; return (t && inHost(t)) ? t : null;
    }
    function pt(ev) { try { var h = hostEl.getBoundingClientRect(); lastPt = { x: ev.clientX - h.left + hostEl.scrollLeft, y: ev.clientY - h.top + hostEl.scrollTop }; } catch (e) {} }
    var L = [];   // v1.3.0 — every listener, so destroy() can take them off (React unmount / re-mount)
    function on(el, ev, fn, cap) { el.addEventListener(ev, fn, cap); L.push([el, ev, fn, cap]); }
    on(svg, 'pointermove', function (ev) {
      if (lg.owns(ev.target)) return;   // 1.4.0 — the card can sit inside the listened element (opts.host === svg)
      pt(ev);
      // v1.3.0 — pointerover is not reliable across shadow roots / SVG faces (Chromium skips the boundary event when the
      // pointer crosses from a label into an <svg> inside a web component), so the move itself settles the hover too
      if (pinned || pressed || !enabled()) return;
      var o = target(ev); if (o === hover) return;
      if (!o || !resolve(o)) { if (hover) lg.leave(); return; }
      if (suppressed) { if (idOf(o) && idOf(o) === downId) return; suppressed = false; }
      hover = o; show(o, false);
    }, true);
    on(svg, 'pointerover', function (ev) {
      if (lg.owns(ev.target)) return;
      if (pinned || pressed || !enabled()) return; var o = target(ev); if (!o || o === hover || !resolve(o)) return;
      // after a click the card stays away from THAT element (and its re-rendered twin) until the pointer moves to another
      if (suppressed) { if (idOf(o) && idOf(o) === downId) return; suppressed = false; }
      hover = o; show(o, false);
    }, true);
    on(svg, 'pointerout', function (ev) {
      if (pinned || lg.owns(ev.target)) return; var o = target(ev); var rt = ev.relatedTarget;
      // v1.3.0 — a relatedTarget inside a shadow root is retargeted to its host; look through to what is really under the pointer
      try { while (rt && rt.shadowRoot && rt.shadowRoot.elementFromPoint) { var deep = rt.shadowRoot.elementFromPoint(ev.clientX, ev.clientY); if (!deep || deep === rt) break; rt = deep; } } catch (e) {}
      var to = rt && rt.closest ? rt.closest(selector) : null;
      if (o && o === hover && to !== o) lg.leave();
      // suppression lifts only when the pointer truly leaves the svg (pointerleave) — a re-render swapping the node under a
      // still-pressed / just-clicked pointer must NOT bring the card straight back
    }, true);
    on(svg, 'pointerdown', function (ev) {
      if (lg.owns(ev.target)) return;   // 1.4.0 — a click on the card's own links never hides it first
      var o = target(ev); pressed = true; downId = idOf(o); pt(ev);
      if (ev.altKey && o && enabled() && resolve(o)) { pinned = o; hover = null; suppressed = false; show(o, true); ev.preventDefault(); return; }
      downAt = { x: ev.clientX, y: ev.clientY, o: o, prev: pinned };   // 1.6.0 — a click (no drag) pins on release; any press hides first
      if (pinned) pinned = null;
      suppressed = true; hover = null; info = null; card.style.display = 'none'; setHot(null); lg.reset(); cancelAnimationFrame(raf); paint();
    }, true);   // capture — the app's own element handlers may stop propagation (drag engines do)
    on(document, 'pointerup', function (ev) {   // 1.6.0 — click-to-pin (a drag never pins; the same item again lets go)
      pressed = false; var d = downAt; downAt = null; if (!CLICK || !d || !d.o) return;
      if (Math.abs(ev.clientX - d.x) > CLICK_PX || Math.abs(ev.clientY - d.y) > CLICK_PX) return;
      var o = alive(d.o) ? d.o : findLike(d.o); if (!o) return;
      if (d.prev && (o === d.prev || (idOf(o) && idOf(o) === idOf(d.prev)))) return;
      if (!enabled() || !resolve(o)) return;
      pinned = o; hover = null; suppressed = false; show(o, true);
    }, true);
    on(document, 'pointercancel', function () { pressed = false; }, true);
    // a real leave (no button down — pointer-capture release fires a synthetic leave/enter pair while pressed) clears the hover
    on(svg, 'pointerleave', function (ev) { if (pressed || (ev && ev.buttons)) return; suppressed = false; downId = null; if (!pinned && hover) lg.leave(); });   // 1.4.0 — leaving towards the card keeps it
    on(document, 'keydown', function (ev) { if (ev.key === 'Escape' && (pinned || hover)) clear(); });
    if (CLICK) on(document, 'pointerdown', function (ev) { if (pinned && !inHost(ev.target) && !lg.owns(ev.target)) clear(); }, true);   // 1.6.0 — a click elsewhere lets go
    // selection: the app tells us (api.select(el)) or we poll its selected() on refresh
    var api = {
      VERSION: VERSION,
      clear: clear,
      destroy: function () {   // v1.3.0 — take the overlay, card and listeners away (React unmount); the host can be attached again later
        clear(); L.forEach(function (l) { try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {} }); L = [];
        try { ov.remove(); card.remove(); } catch (e) {} delete svg.__sonorBlockGlow;
      },
      select: function (el) { if (pinned && el !== pinned) { pinned = null; card.style.display = 'none'; } sel = (el && enabled() && resolve(el)) ? el : null; info = null; loop(); },
      _state: function () { return { hover: !!hover, pinned: !!pinned, sel: !!sel, suppressed: suppressed, card: card.style.display !== 'none', onCard: lg.onCard() }; },
      refresh: function () {   // call after the svg re-renders (elements are rebuilt): re-find hover/sel by data-id
        var find = findLike;
        if (hover && !alive(hover)) hover = find(hover); if (pinned && !alive(pinned)) pinned = find(pinned);
        var s2 = selected(); if (s2 !== undefined) sel = (s2 && resolve(s2)) ? s2 : null;
        info = null; var o = pinned || hover; if (o) show(o, !!pinned); else loop();
      }
    };
    svg.__sonorBlockGlow = api; return api;
  }

  global.SonorBlockGlow = { VERSION: VERSION, attachFabric: attachFabric, attachSvg: attachSvg, paintHalo: paintHalo, paintHaloRect: paintHaloRect, cardHtml: cardHtml, ensureStyles: ensureStyles, hexA: hexA };
})(typeof window !== 'undefined' ? window : this);
