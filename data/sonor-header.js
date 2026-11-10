// Sonor Shared Header — injects the standard header into any app
// Load AFTER sonor-brand.js, BEFORE app script
// Usage: SonorHeader.init({ appName: 'Leads', repo: 'sonor-leads' });
//
// Provides:
//   SonorHeader.init(opts)              — build + inject the header
//   SonorHeader.updateDbStatus(state)   — update DB indicator (connecting/live/offline/error)
//   SonorHeader.timeAgo(timestamp)      — human-readable time diff

window.SonorHeader = (function() {
  const B = window.__SONOR_BRAND__ || {};
  const svcs = B.services || [];

  // ── SONOR wordmark SVG (compact, inline for instant render) ──
  const WORDMARK_SVG = `<svg width="112" height="32" viewBox="0 0 332 95" xmlns="http://www.w3.org/2000/svg">
    <path fill="#F2EDE5" d="M92.02,38.41v51.4c0,2.63-2.13,4.75-4.75,4.75h-3.34c-2.62,0-4.75-2.12-4.75-4.75v-45.34c0-2.45-1.11-4.77-3.01-6.31l-25.23-20.41c-2.8-2.27-6.76-2.42-9.73-.36l-23.15,16.05.45,1.55c22.38,9.5,40.47,30.05,47.71,53.39.95,3.06-1.32,6.18-4.53,6.18h-5.36c-2.08,0-3.9-1.37-4.54-3.35-6.96-21.83-24.83-38.23-46.17-46.13-1.31-.49-2.31-1.5-2.79-2.75-.2-.51-.31-1.06-.32-1.64l-.12-9.11c-.02-1.58.75-3.06,2.05-3.96L28.74,10.74,42.11,1.45c.16-.11.32-.22.49-.31,2.35-1.4,5.22-1.5,7.64-.34.57.26,1.12.61,1.63,1.03l37.16,30.29c1.89,1.54,2.99,3.85,2.99,6.29Z"/>
    <path fill="#F2EDE5" d="M34.59,94.55h-5.25c-1.6,0-3.09-.81-3.97-2.15-5.47-8.37-11.98-15.35-20.72-20.32-1.5-.85-2.45-2.42-2.45-4.15v-5.58c0-3.52,3.68-5.79,6.85-4.26,12.79,6.15,23.95,16.91,29.85,29.73,1.45,3.14-.86,6.73-4.32,6.73h0Z"/>
    <path fill="#F2EDE5" d="M4.26,83.39c7.65-1.71,9.39,9.06,4.03,10.83-8.9,2.94-11.25-9.22-4.03-10.83Z"/>
    <path fill="#F2EDE5" d="M114.89,64.04l5.96-3.49c1.5,4.28,4.76,7.11,10.48,7.11s7.83-2.47,7.83-5.54c0-3.73-3.31-5-9.58-6.93-6.56-1.99-12.95-4.4-12.95-12.35s6.44-12.17,13.55-12.17,12.04,3.67,14.7,9.27l-5.84,3.37c-1.51-3.37-4.16-5.9-8.85-5.9-4.04,0-6.62,2.05-6.62,5.24s2.35,4.64,8.49,6.56c6.99,2.23,14.03,4.4,14.03,12.77,0,7.71-6.14,12.41-14.94,12.41-8.31,0-14.03-4.1-16.26-10.36h0Z"/>
    <path fill="#F2EDE5" d="M152.65,52.53c0-12.23,9.7-21.86,21.86-21.86s21.86,9.64,21.86,21.86-9.64,21.86-21.86,21.86-21.86-9.64-21.86-21.86ZM189.45,52.53c0-8.67-6.5-15.12-14.94-15.12s-14.94,6.44-14.94,15.12,6.5,15.12,14.94,15.12,14.94-6.44,14.94-15.12Z"/>
    <path fill="#F2EDE5" d="M237.93,31.45v42.16h-5.42l-19.88-28.61v28.61h-6.93V31.45h5.42l19.88,28.61v-28.61h6.93Z"/>
    <path fill="#F2EDE5" d="M247.26,52.53c0-12.23,9.7-21.86,21.86-21.86s21.86,9.64,21.86,21.86-9.64,21.86-21.86,21.86-21.86-9.64-21.86-21.86ZM284.06,52.53c0-8.67-6.5-15.12-14.94-15.12s-14.94,6.44-14.94,15.12,6.5,15.12,14.94,15.12,14.94-6.44,14.94-15.12Z"/>
    <path fill="#F2EDE5" d="M315.43,58.25h-8.19v15.36h-6.93V31.45h16.86c7.53,0,13.55,6.02,13.55,13.55,0,5.42-3.43,10.24-8.37,12.23l9.58,16.38h-7.59l-8.91-15.36h0ZM307.24,52.05h9.94c3.67,0,6.62-3.13,6.62-7.05s-2.95-7.05-6.62-7.05h-9.94v14.09h0Z"/>
  </svg>`;

  // ── GitHub icon SVG ──
  const GH_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

  // ── Supabase icon SVG ──
  const SB_ICON = `<svg viewBox="0 0 109 113" fill="none"><path d="M63.7 110.3c-2.6 3.3-8 1.6-8.1-2.5l-1.2-51.1h44.5c4.7 0 7.3 5.4 4.3 8.9L63.7 110.3z" fill="currentColor" opacity=".5"/><path d="M45.3 2.7c2.6-3.3 8-1.6 8.1 2.5l.7 51.1H10.3c-4.7 0-7.3-5.4-4.3-8.9L45.3 2.7z" fill="currentColor"/></svg>`;

  // ── 10 service dots (from brand config or fallback hex) ──
  const DOT_COLOURS = svcs.length === 10
    ? svcs.map(s => s.hex)
    : ['#8058a1','#4bb9d3','#78ba57','#f5d05c','#e37c59','#ec6061','#e67eb1','#ad9978','#b7b1a7','#302f2e'];
  const DOT_LABELS = svcs.length === 10
    ? svcs.map(s => s.badge)
    : ['Cinema','Audio','Video','Lighting','Automation','Climate','Control','Security','WiFi','Structure'];

  function init(opts) {
    opts = opts || {};
    const appName = opts.appName || 'App';
    const repo = opts.repo || '';
    const versionId = opts.versionId || 'nav-version';
    const targetId = opts.targetId || 'sonor-header';
    const ghUrl = repo ? 'https://github.com/sonorltd/' + repo : 'https://github.com/sonorltd';
    const sbUrl = 'https://supabase.com/dashboard/project/ysmvklstkzodlocttspy';

    // ── Tab title + favicon bake-in (Spine v1.2 — brand-wide identity) ──
    // Apps only declare appName/appKey; the Spine handles document.title + <link rel=icon>.
    // If the HTML's <title> was left as a scaffold/default, we overwrite with appName.
    // If the author set a specific title, we leave it alone.
    try {
      const curTitle = (document.title || '').trim();
      const isDefaultish =
        !curTitle ||
        /^sonor\s*(app|scaffold)?$/i.test(curTitle) ||
        /—\s*prototype$/i.test(curTitle) ||
        curTitle === 'Sonor ' + appName ||
        curTitle === 'Sonor ' + appName + ' — Prototype';
      if (isDefaultish) document.title = appName;
    } catch (e) { /* non-browser context */ }

    try {
      if (!document.querySelector('link[rel="icon"]')) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        // Default path resolves relative to the app HTML.
        // Dashboard apps (dashboard/sonor-{slug}.html) override via opts.faviconHref='../data/favicon.svg'.
        link.href = opts.faviconHref || 'data/favicon.svg';
        document.head.appendChild(link);
      }
    } catch (e) { /* non-browser context */ }

    // Auto-detect local (Google Drive / file://) vs hosted (GitHub Pages)
    const isLocal = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '';
    const hubUrl = opts.hubUrl || (isLocal
      ? (B.appUrls && B.appUrls.local ? B.appUrls.local.master : '../sonor-master/index.html')
      : (B.appUrls && B.appUrls.hosted ? B.appUrls.hosted.master : 'https://apps.sonor.co.uk/sonor-master/'));

    // 2026-09-29 (Bryn): the 10 service dots are GONE from the header by default — they ate right-hand space and said
    // nothing the app needed. Opt back in per app with opts.showDots === true (nothing does today).
    const dots = opts.showDots === true ? DOT_COLOURS.map((hex, i) =>
      `<div class="svc-dot" style="background:${hex}" title="${DOT_LABELS[i] || ''}"></div>`
    ).join('') : '';

    // showLinks: only Master Hub renders the GH + Supabase quicklinks.
    // Apps show version + DB status (+ the ◐ theme toggle the kit mounts into .header-right).
    const showLinks = opts.showLinks === true;
    const linksHtml = showLinks ? `
        <div class="header-links">
          <a href="${ghUrl}" target="_blank" title="GitHub: ${repo || 'sonorltd'}">${GH_ICON}</a>
          <a href="${sbUrl}" target="_blank" title="Supabase Dashboard">${SB_ICON}</a>
        </div>` : '';

    const html = `
      <div class="logo">
        <a class="logo-link" href="${hubUrl}" title="Back to Master Hub">${WORDMARK_SVG}</a>
        <div class="app-name">${appName}</div>
      </div>
      <div class="header-right">
        <span id="${versionId}" style="font-size:11px;color:#8B7D6B;opacity:.8;font-weight:500;"></span>
        <div class="db-status" id="dbStatus">
          <div class="db-dot" id="dbDot"></div>
          <span class="db-label" id="dbLabel">Connecting…</span>
          <span class="live-badge">LIVE</span>
        </div>${linksHtml}${dots ? `
        <div class="badge-row">${dots}</div>` : ''}
      </div>`;

    const el = document.getElementById(targetId);
    if (el) {
      el.classList.add('header');
      el.innerHTML = html;
    }
  }

  function updateDbStatus(state, text) {
    const dot = document.getElementById('dbDot');
    const label = document.getElementById('dbLabel');
    if (!dot || !label) return;
    dot.className = 'db-dot';
    if (state === 'live')       { dot.classList.add('live');  label.textContent = text || 'Supabase'; }
    else if (state === 'error') { dot.classList.add('error'); label.textContent = text || 'DB Error'; }
    else if (state === 'connecting') { label.textContent = text || 'Connecting…'; }
    else { label.textContent = text || 'Local only'; }
  }

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  return { init, updateDbStatus, timeAgo };
})();
