/**
 * sonor-pdf-theme.js — CANONICAL MASTER (workspace root → data/ in every app via sync-everything)
 * v1.0.0 · 2026-10-16 — Bryn: "the cover page and PDF theme should be more inline with what we have elsewhere too, neutral
 *   greys for tables etc but black gold for the more stylish parts, we've had a few versions over the time but need to gel
 *   all the branding now so minor tweaks can be system wide".
 *
 * ONE place for every PDF colour / mode / cover rule. The three PDF pipelines READ this and never carry their own palette:
 *   · data/sonor-pdf-luxury.js (pdf-lib · Seating / Cinema / Lighting / Service Contracts / Takeover)  → THEMES via luxury()
 *   · sonor-pdf-v6-tokens.js   (pdf-lib SVG drawings + schedules)                                       → BASE / THEMES via v6()
 *   · sonor-pdf-html-cover.css (HTML → html2canvas → jsPDF: Takeoffs full document, extracts, Packs…)   → :root overrides via htmlCss()
 * Edit a value HERE, run sync-everything, and every export moves together.
 *
 * The law (sonor-platform §41):
 *   · STYLISH parts — cover hero, section dividers, page header bars, floor banners, totals rows — are BLACK with GOLD rules,
 *     eyebrows and accents; cream/white type on them. Never navy, never purple chrome (service colours are the ONLY per-area
 *     colour, as a strip or a pill).
 *   · WORKING parts — tables, cards, chips, rules — are NEUTRAL GREYS on white. No cream page tint outside the luxury client
 *     proposals (mode 'luxury' = Seating / Lighting / Cinema). Mode 'neutral' = everything else (schedules, surveys, scope).
 *   · Cover anatomy = the Service Contracts front page: dark hero (optional photo fading to black), gold inset frame, gold
 *     hairline + tracked gold eyebrow, big title, 3-cell info row, brand mark top-left, CEDIA / partner strip at the foot.
 *   · Footer = page numbering only; the full contact block lives on the rear page.
 *   · Traffic lights use AMBER (#E8A317), never yellow (04 Lighting yellow is a service colour, not a status).
 */
(function (global) {
  'use strict';
  var VERSION = '1.1.0';   // 1.1.0 (2026-10-22) — PAPER: cream gone from every PDF; one very slight warm tint everywhere (Bryn: "drop the cream backgrounds too, or maybe just a very slight tint" → "yes all pdfs re cream")

  var HEX = {
    black: '#090807', dark2: '#161318', graphite: '#2c2a27',
    ink: '#1a1814', ink2: '#3c372f', muted: '#787060', label: '#968a74', info: '#a89c88', pageNo: '#aaa08c',
    gold: '#ad9978', goldLight: '#c8b48e', goldDeep: '#8c743c', goldTint: '#d9c9a8',
    cream: '#fbfaf7', creamLine: '#d6cdbc', paper: '#fbfaf7',   // 1.1.0 — 'cream' is now the slight tint; kept under its old key so every reader keeps working
    white: '#ffffff', g50: '#f7f8fa', g100: '#f4f5f7', g200: '#eceef1', g300: '#d9dde3', g350: '#e2e5ea', g400: '#c9ced6', g500: '#8b8f96', g600: '#636c7a',
    amber: '#E8A317', green: '#78ba57', red: '#ec6061', blue: '#4bb9d3'
  };
  var SERVICES = [
    { nn: '01', name: 'Cinema', hex: '#8058a1' }, { nn: '02', name: 'Audio', hex: '#4bb9d3' }, { nn: '03', name: 'Video', hex: '#78ba57' },
    { nn: '04', name: 'Lighting', hex: '#f5d05c' }, { nn: '05', name: 'Automation', hex: '#e37c59' }, { nn: '06', name: 'Climate', hex: '#ec6061' },
    { nn: '07', name: 'Control', hex: '#e67eb1' }, { nn: '08', name: 'Security', hex: '#ad9978' }, { nn: '09', name: 'Network', hex: '#b7b1a7' },
    { nn: '10', name: 'Infrastructure', hex: '#302f2e' }
  ];
  var STATUS = {   // §23 traffic light — amber, never yellow
    DRAFT: { hex: HEX.g500, ink: HEX.ink }, PRELIMINARY: { hex: HEX.amber, ink: '#3d2a08' }, PRELIM: { hex: HEX.amber, ink: '#3d2a08' },
    'FOR REVIEW': { hex: HEX.gold, ink: HEX.white }, REVIEW: { hex: HEX.gold, ink: HEX.white }, TENDER: { hex: HEX.gold, ink: HEX.white },
    ACTIVE: { hex: HEX.green, ink: '#143020' }, ISSUED: { hex: '#5a8b40', ink: HEX.white }, 'ISSUED FOR CONSTRUCTION': { hex: '#5a8b40', ink: HEX.white }, IFC: { hex: '#5a8b40', ink: HEX.white },
    'AS-BUILT': { hex: HEX.blue, ink: HEX.white }, 'AS BUILT': { hex: HEX.blue, ink: HEX.white }, SUPERSEDED: { hex: HEX.g500, ink: HEX.ink }, OBSOLETE: { hex: HEX.g500, ink: HEX.ink }, CANCELLED: { hex: '#9F978B', ink: HEX.white }
  };

  function rgb(h) { h = String(h).replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(a, b, t) { var A = rgb(a), B = rgb(b); return '#' + A.map(function (v, i) { return ('0' + Math.round(v + (B[i] - v) * t).toString(16)).slice(-2); }).join(''); }

  // ── the chrome gradient every dark surface shares: black → dark graphite → a whisper of gold ──
  var CHROME = { deep: HEX.black, mid: HEX.dark2, end: mix(HEX.dark2, HEX.gold, 0.18) };
  function gradient(deg) { return 'linear-gradient(' + (deg || 120) + 'deg, ' + CHROME.deep + ' 0%, ' + CHROME.mid + ' 38%, ' + CHROME.end + ' 100%)'; }

  // ── pdf-luxury COL sets (RGB arrays) — luxury keeps the cream page, neutral is white; both share black/gold chrome ──
  function luxury() {
    return {
      shared: { GOLD: rgb(HEX.gold), GOLDL: rgb(HEX.goldLight), GDEEP: rgb(HEX.goldDeep), DARK: rgb(HEX.black), DARK2: rgb(HEX.dark2), PUR: [128, 88, 161] },
      luxury: { CREAM: rgb(HEX.cream), INK: rgb(HEX.ink), INK2: rgb(HEX.ink2), MUT: rgb(HEX.muted), LINE: rgb(HEX.creamLine), LABEL: rgb(HEX.label), PAGE_NO: rgb(HEX.pageNo), INFO: rgb(HEX.info) },
      neutral: { CREAM: rgb(HEX.paper), INK: [24, 24, 24], INK2: [62, 62, 62], MUT: [118, 118, 118], LINE: rgb(HEX.g300), LABEL: [138, 138, 138], PAGE_NO: [164, 164, 164], INFO: [172, 172, 172] }
    };
  }
  // ── v6 tokens: white paper, black/gold 'sonor' theme as the default drawing + schedule chrome ──
  function v6() {
    return {
      BASE: { paper: HEX.paper, body: HEX.g100, text: HEX.ink, muted: HEX.muted, line: HEX.g300, footer: HEX.black, white: HEX.white },
      THEMES: {
        sonor:   { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 },
        takeoff: { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 },
        packs:   { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 },
        cineca:  { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 },
        cinema:  { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 },   // purple is the 01 service colour, not chrome
        rams:    { primary: HEX.gold, dark: HEX.black, mid: HEX.dark2, pale: HEX.g200 }
      },
      STATUS: STATUS
    };
  }
  // ── HTML pipeline: :root overrides appended after sonor-pdf-html-cover.css (literal hex in gradients — html2canvas) ──
  function htmlCss() {
    return '\n/* sonor-pdf-theme ' + VERSION + ' — black / gold chrome, neutral grey working surfaces (overrides the slate defaults) */\n' +
      ':root, [data-pdf-theme], [data-pdf-theme="cinema"], [data-pdf-theme="studio"] {\n' +
      '  --theme-deep: ' + CHROME.deep + '; --theme-mid: ' + CHROME.mid + '; --theme-bright: ' + HEX.gold + '; --theme-mix-pct: 18%;\n' +
      '  --chrome-gradient: ' + gradient(120) + '; --chrome-gradient-mirror: ' + gradient(300) + '; --chrome-gradient-end: ' + CHROME.end + ';\n' +
      '  --chrome-solid: ' + CHROME.mid + '; --chrome-solid-deep: ' + CHROME.deep + ';\n' +
      '  --accent: ' + HEX.gold + '; --slate-text: ' + HEX.ink + '; --slate-muted: ' + HEX.muted + '; --slate-faint: ' + HEX.label + ';\n' +
      '  --paper: ' + HEX.paper + '; --paper-tint: ' + HEX.g100 + '; --paper-rule: ' + HEX.g200 + '; --paper-soft: ' + HEX.g50 + '; --paper-edge: ' + HEX.g300 + '; --slate-tint-total: ' + HEX.g350 + ';\n' +
      '  --status-for-review: ' + HEX.amber + '; --status-revised: ' + HEX.amber + ';\n' +
      '}\n' +
      '.hero-eyebrow { color: ' + HEX.goldTint + '; }\n' +
      '.hero-accent-line { background: ' + HEX.gold + ' !important; }\n';
  }

  global.SonorPdfTheme = { VERSION: VERSION, HEX: HEX, CHROME: CHROME, SERVICES: SERVICES, STATUS: STATUS, rgb: rgb, mix: mix, gradient: gradient, luxury: luxury, v6: v6, htmlCss: htmlCss,
    MODES: { luxury: 'slight-tint page, warm ink + gold lines — Seating / Lighting / Cinema client proposals', neutral: 'slight-tint page, grey working surfaces — every other document' } };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
