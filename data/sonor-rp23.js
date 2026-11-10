// =============================================================================
// sonor-rp23.js — Video design reference data + math (RP23-ready scaffold)
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master lives at data/sonor-rp23.js,
// synced into each consumer app's data/ via sync-everything.sh. Edit master
// only — never hand-edit per-app copies. (Sibling of data/sonor-rp22.js.)
//
// Purpose: hold the VIDEO side of cinema design as a SINGLE source of truth,
// the same way sonor-rp22.js holds the AUDIO side. Two kinds of data live here:
//
//   1. PUBLISHED, STABLE geometry + photometry — the maths of viewing angle,
//      resolution-vs-distance and projector brightness. These come from
//      SMPTE EG-18 / SMPTE 196M, THX, CTA/CEDIA CEB23 (Home Theater Video
//      Design) and ITU-R BT.2020/2100. Safe to consume in apps TODAY.
//
//   2. PROVISIONAL RP23 performance levels (L1–L4) + image-fidelity field
//      dictionary — scaffold for the forthcoming CEDIA/CTA-RP23 Immersive
//      Video Design Recommended Practice. RP23 is NOT yet published (still
//      "a work in progress" at ISE 2025/2026). The L1–L4 *structure* is
//      confirmed (it mirrors RP22, developed by CEDIA + Imaging Science
//      Foundation, Joel Silver chairing). The numeric thresholds are marked
//      TODO(RP23) and MUST be reconciled against the published spec on release.
//
// No DOM, no app-state — pure data + pure functions (same contract as RP22).
//
// Public API (window.SonorRP23):
//
//   SonorRP23.STANDARDS                 — named constants + provenance for
//                                          every published figure used below.
//   SonorRP23.VIDEO_LEVELS              — provisional RP23 L1–L4 tiers
//                                          (descriptive + TODO thresholds).
//   SonorRP23.IMAGE_FIELDS              — data dictionary for the image-fidelity
//                                          layer Sonor does not yet capture
//                                          (peak luminance, contrast, gamut,
//                                          HDR, screen gain, ambient…).
//   SonorRP23.horizontalFovDeg(scrW, dist)              — subtended H viewing
//                                                          angle (°). Same
//                                                          units in, angle out.
//   SonorRP23.screenWidthForFov(fovDeg, dist)           — screen width to hit a
//                                                          target H FoV at a
//                                                          given seat distance.
//   SonorRP23.fovVerdict(fovDeg, {resKlass})            — pass/warn/fail +
//                                                          band label vs
//                                                          SMPTE/THX/CEB23/ITU.
//   SonorRP23.pixelsPerDegree(hPixels, fovDeg)          — angular resolution.
//   SonorRP23.resolutionVerdict(hPixels, fovDeg)        — is the pixel grid
//                                                          resolved / soft /
//                                                          has immersion
//                                                          headroom (60 ppd
//                                                          acuity limit).
//   SonorRP23.footLamberts(lumens, gain, areaFt2)       — on-screen luminance.
//   SonorRP23.requiredLumens(targetFl, gain, areaFt2)   — projector lumens to
//                                                          hit a target fL.
//   SonorRP23.brightnessVerdict(fl, {ambient})          — vs SMPTE/DCI SDR
//                                                          reference band.
//   SonorRP23.flToNits(fl) / nitsToFl(nits)             — unit bridge.
//   SonorRP23.classifyVideoLevel(spec)                  — PROVISIONAL best-guess
//                                                          RP23 level from a spec
//                                                          object. Returns
//                                                          { level, why[], todo }.
//
// Versioning:
//   v0.1.0 (2026-07-17) — initial scaffold. Geometry + photometry helpers are
//                         production-usable; RP23 L1–L4 numeric thresholds are
//                         TODO pending publication. Not yet wired into apps or
//                         sync-everything.sh (see reports/VIDEO-SPEC-STANDARDS-
//                         AUDIT_2026-07-17.md for the rollout plan).

(function () {
  'use strict';

  const MODULE_VERSION = '0.1.0';

  // ── PUBLISHED STANDARDS CONSTANTS (stable — safe to consume now) ──────────
  // Every figure carries its source so a future session can audit it. These
  // are NOT RP23 (which is unpublished); they are the existing, stable body of
  // video-design practice that RP23 will build on.
  const STANDARDS = {
    // Horizontal viewing angle (subtended by screen width at the seat), degrees.
    hFov: {
      thxBackRowMin:   30,   // THX: ≥30° maintained to the LAST row (Sonor already checks this)
      thxAbsoluteMin:  26,   // THX absolute floor before "too small"
      thxDesignTarget: 36,   // THX recommended design target from the back row
      ceb23Reference:  40,   // CTA/CEDIA CEB23 reference band ~36–40°+ (2.35:1 ≈ 3× picture height)
      sweetSpotLo:     45,   // Where SMPTE/THX/studio practice converge (front-row immersive)
      ituUhdReference: 58,   // ITU reference FoV for UHD/4K content (≈58–60°)
      immersiveMax:    60,   // Practical immersive ceiling for 4K; beyond → edge/neck fatigue
      src: 'SMPTE EG-18-1994, THX, CTA/CEDIA CEB23-B-2017, ITU-R BT.2246/2020'
    },
    // Vertical sightlines, degrees from the primary eye position.
    vFov: {
      smpteMaxToTop:   35,   // SMPTE EG-18: ≤35° from eye to TOP of screen (Sonor already checks this)
      comfortToEdge:   15,   // CEDIA comfort guidance: ≤~15° to top/bottom is easy on the neck
      src: 'SMPTE EG-18-1994; CEDIA CEB23 comfort guidance'
    },
    // Resolution-vs-distance. ppd = angular resolution; ~60 ppd (1 arc-minute)
    // is the normal-acuity limit where a pixel grid becomes invisible.
    resolution: {
      acuityPpd:       60,   // 20/20 vision resolving limit (1 arc-min per line pair ≈ 60 px/deg)
      // Distance at which each format is "fully resolved" (no visible pixels),
      // expressed as a multiple of SCREEN WIDTH. Closer than this on a lower
      // format shows structure; further than this on a higher format "wastes"
      // resolution (image could be bigger / seats closer).
      fullBenefitDistInScreenWidths: { '1080p': 1.7, '4k': 0.8, '8k': 0.4 },
      hPixels: { '1080p': 1920, '4k': 3840, '8k': 7680 },
      src: 'ITU-R BT.2246; CEB23 resolution guidance; visual-acuity limit'
    },
    // On-screen luminance (brightness), foot-lamberts. 1 fL ≈ 3.4263 cd/m².
    luminance: {
      sdrReferenceFl:      16,   // SMPTE 196M open-gate reference white (2D SDR)
      dciDeliveredFl:      14,   // DCI delivered white (16 fL open-gate ≈ 14 fL through content), ±3
      sdrBandLoFl:         12,   // Practical SDR band low
      sdrBandHiFl:         22,   // Practical SDR band high (headroom for lamp aging)
      designInitialFl:     28,   // Design initial for bulb PJs so EOL lands ~14 fL
      ambientMinFl:        40,   // Rooms with ambient light: ≥40 fL to hold contrast
      ambientHighFl:       60,   // High-ambient (media room / multipurpose)
      flToNits:            3.4263,
      src: 'SMPTE 196M; DCI DCSS; Acoustic Frontiers brightness guidance'
    },
    // Colour / gamut references (used by the fidelity layer + RP23 levels).
    gamut: {
      sdr:      'Rec.709 / sRGB',
      hdrWide:  'DCI-P3',
      hdrRef:   'ITU-R BT.2020',
      whitePoint: 'D65 (6500K)',
      hdrTransfer: 'PQ (ST 2084) / HLG (BT.2100)',
      src: 'ITU-R BT.709 / BT.2020 / BT.2100; SMPTE ST 2084'
    }
  };

  // ── PROVISIONAL RP23 PERFORMANCE LEVELS (L1–L4) ──────────────────────────
  // STRUCTURE is confirmed (mirrors RP22's 4 levels). NUMBERS are TODO(RP23) —
  // RP23 is unpublished as of 2026-07. Descriptions are distilled from CEDIA/
  // ISF conference material (ISE 2025/2026) and are directional, not spec.
  // When RP23 publishes: fill numeric thresholds, drop the `provisional` flag.
  const VIDEO_LEVELS = {
    provisional: true,
    src: 'CEDIA/CTA-RP23 (work in progress) — CEDIA + Imaging Science Foundation, Joel Silver chair',
    1: {
      name: 'L1 — Entry / verified',
      intent: 'Right display for the content, signal path verified, basic picture set-up. Achievable in minutes, no calibration gear.',
      checks: ['Native resolution matches source (no scaling penalty)',
               'HDMI/HDCP handshake + correct EOTF flag (SDR/HDR) verified',
               'Picture mode set to the accurate preset (Filmmaker/Cinema/ISF)',
               'Basic brightness + contrast set to avoid clipping'],
      todo: { minGamut: 'Rec.709', luminanceFl: 'TODO(RP23)', tolerances: 'TODO(RP23)' }
    },
    2: {
      name: 'L2 — Measured',
      intent: 'Metered set-up: luminance in band, white point near D65, screen/gain matched to room.',
      checks: ['On-screen luminance measured, within SDR band',
               'White point measured near D65',
               'Screen gain + type matched to ambient conditions',
               'Basic grayscale sanity (no gross tint)'],
      todo: { minGamut: 'Rec.709', luminanceFl: 'TODO(RP23) — expect SDR reference band', tolerances: 'TODO(RP23)' }
    },
    3: {
      name: 'L3 — Calibrated',
      intent: 'Reference-approaching: calibrated grayscale + gamma/EOTF, wide gamut for HDR, ambient controlled.',
      checks: ['Grayscale + gamma/EOTF calibrated to tolerance',
               'DCI-P3 coverage verified for HDR content',
               'Ambient light controlled (low room reflectance / bias light)',
               'Luminance + black level within tolerance'],
      todo: { minGamut: 'DCI-P3', luminanceFl: 'TODO(RP23)', tolerances: 'TODO(RP23)' }
    },
    4: {
      name: 'L4 — Reference',
      intent: 'Reference-grade dedicated cinema: full calibration, HDR tone-mapping verified, blacked-out room.',
      checks: ['Full calibration (grayscale, gamut, gamma/EOTF) to tight tolerance',
               'HDR tone-mapping verified against mastering targets',
               'Blackout room, controlled reflectance, treated screen wall',
               'Luminance + colour hold across the seating area'],
      todo: { minGamut: 'BT.2020 / DCI-P3', luminanceFl: 'TODO(RP23)', tolerances: 'TODO(RP23)' }
    }
  };

  // ── IMAGE-FIDELITY FIELD DICTIONARY ──────────────────────────────────────
  // The data Sonor does NOT capture today but RP23 (and good practice) needs.
  // This is the schema for a future `metadata.video.fidelity` block. Types +
  // units only — no thresholds (those live in VIDEO_LEVELS once published).
  const IMAGE_FIELDS = {
    displayType:      { type:'enum',   values:['projector','direct-view-led','flat-panel'], unit:null },
    contentResolution:{ type:'enum',   values:['1080p','4k','8k'], unit:null },
    peakLuminance:    { type:'number', unit:'nits (cd/m²)',  note:'Flat-panel/LED peak white; projector via footLamberts()' },
    onScreenFl:       { type:'number', unit:'foot-lamberts', note:'Projector on-screen white — computed or measured' },
    blackLevel:       { type:'number', unit:'nits',          note:'For native/sequential contrast' },
    contrastRatio:    { type:'number', unit:'ratio (N:1)',   note:'On/off or ANSI — record which' },
    colourGamut:      { type:'enum',   values:['Rec.709','DCI-P3','Rec.2020'], unit:null },
    hdrFormats:       { type:'array',  values:['SDR','HDR10','HDR10+','Dolby Vision','HLG'], unit:null },
    whitePointK:      { type:'number', unit:'kelvin', note:'Target 6500K (D65)' },
    projectorLumens:  { type:'number', unit:'ANSI lumens' },
    screenGain:       { type:'number', unit:'gain (×)', note:'Acoustically-transparent screens are often ~1.0 or negative' },
    screenType:       { type:'enum',   values:['matte-white','acoustically-transparent','ALR','grey/high-contrast'], unit:null },
    ambientClass:     { type:'enum',   values:['blackout','controlled','some-ambient','high-ambient'], unit:null },
    calibrationStatus:{ type:'enum',   values:['none','basic-preset','metered','calibrated-reference'], unit:null },
    rp23Level:        { type:'enum',   values:[1,2,3,4], unit:null, note:'PROVISIONAL until RP23 publishes' }
  };

  // ── PUBLIC API — GEOMETRY (published, stable) ─────────────────────────────

  const _rad = d => d * Math.PI / 180;
  const _deg = r => r * 180 / Math.PI;

  // Horizontal field of view subtended by the screen width at a seat distance.
  // Units must match (mm & mm, or m & m). Returns degrees.
  function horizontalFovDeg(screenW, viewingDist) {
    if (!(screenW > 0) || !(viewingDist > 0)) return null;
    return _deg(2 * Math.atan((screenW / 2) / viewingDist));
  }

  // Screen width needed to hit a target horizontal FoV at a given seat distance.
  function screenWidthForFov(fovDeg, viewingDist) {
    if (!(fovDeg > 0) || !(viewingDist > 0)) return null;
    return 2 * viewingDist * Math.tan(_rad(fovDeg) / 2);
  }

  // Verdict for a horizontal FoV against the published bands.
  // Returns { pass:'pass'|'warn'|'fail', band, note }.
  function fovVerdict(fovDeg) {
    const H = STANDARDS.hFov;
    if (fovDeg == null) return { pass:'fail', band:'unknown', note:'no geometry' };
    if (fovDeg < H.thxAbsoluteMin)
      return { pass:'fail', band:'below THX floor', note:`< ${H.thxAbsoluteMin}° — screen too small / seat too far` };
    if (fovDeg < H.thxBackRowMin)
      return { pass:'warn', band:'THX minimum', note:`${H.thxAbsoluteMin}–${H.thxBackRowMin}° — meets THX floor, below SMPTE 30°` };
    if (fovDeg < H.thxDesignTarget)
      return { pass:'warn', band:'SMPTE minimum', note:`≥${H.thxBackRowMin}° SMPTE, below ${H.thxDesignTarget}° THX design target` };
    if (fovDeg <= H.immersiveMax)
      return { pass:'pass', band:'reference / immersive', note:`${H.thxDesignTarget}–${H.immersiveMax}° — THX design target to ITU UHD reference` };
    return { pass:'warn', band:'over-immersive', note:`> ${H.immersiveMax}° — edge visibility / neck travel; justify per row` };
  }

  // Angular resolution: how many pixels fall within one degree of view.
  function pixelsPerDegree(hPixels, fovDeg) {
    if (!(hPixels > 0) || !(fovDeg > 0)) return null;
    return hPixels / fovDeg;
  }

  // Is the pixel grid resolved at this seat? Compares ppd to the ~60 ppd limit.
  // Returns { ppd, pass, note }.
  //   ppd >= 60  → grid invisible (good); if >> 60 there is immersion headroom
  //   ppd <  60  → pixel structure potentially visible (soft / could go bigger)
  function resolutionVerdict(hPixels, fovDeg) {
    const ppd = pixelsPerDegree(hPixels, fovDeg);
    if (ppd == null) return { ppd:null, pass:'fail', note:'no geometry' };
    const lim = STANDARDS.resolution.acuityPpd;
    if (ppd < lim * 0.85)
      return { ppd, pass:'warn', note:`${ppd.toFixed(0)} ppd < ${lim} — pixel grid may be visible; larger image OK only with higher-res source` };
    if (ppd > lim * 1.6)
      return { ppd, pass:'pass', note:`${ppd.toFixed(0)} ppd — grid invisible with immersion headroom (screen could be larger / seats closer)` };
    return { ppd, pass:'pass', note:`${ppd.toFixed(0)} ppd — pixel grid resolved at the acuity limit` };
  }

  // ── PUBLIC API — PHOTOMETRY (published, stable) ───────────────────────────

  // On-screen luminance in foot-lamberts from projector lumens, screen gain and
  // image area in square feet.  fL = (lumens / areaFt²) × gain
  function footLamberts(lumens, gain, areaFt2) {
    if (!(lumens > 0) || !(gain > 0) || !(areaFt2 > 0)) return null;
    return (lumens / areaFt2) * gain;
  }

  // Projector lumens required to hit a target fL at a given gain + image area.
  function requiredLumens(targetFl, gain, areaFt2) {
    if (!(targetFl > 0) || !(gain > 0) || !(areaFt2 > 0)) return null;
    return (targetFl * areaFt2) / gain;
  }

  const flToNits = fl => (fl == null ? null : fl * STANDARDS.luminance.flToNits);
  const nitsToFl = nits => (nits == null ? null : nits / STANDARDS.luminance.flToNits);

  // Verdict for an on-screen fL against the SDR reference band (opts.ambient
  // switches to the higher ambient-room targets).
  function brightnessVerdict(fl, opts) {
    const L = STANDARDS.luminance;
    const ambient = opts && opts.ambient;
    if (fl == null) return { pass:'fail', note:'no luminance' };
    if (ambient) {
      if (fl < L.ambientMinFl) return { pass:'warn', note:`${fl.toFixed(0)} fL < ${L.ambientMinFl} fL — low for an ambient room` };
      return { pass:'pass', note:`${fl.toFixed(0)} fL — adequate for ambient (${L.ambientMinFl}–${L.ambientHighFl} fL)` };
    }
    if (fl < L.sdrBandLoFl) return { pass:'warn', note:`${fl.toFixed(0)} fL < ${L.sdrBandLoFl} fL — dim vs SMPTE ${L.sdrReferenceFl} fL reference` };
    if (fl > L.designInitialFl) return { pass:'warn', note:`${fl.toFixed(0)} fL > ${L.designInitialFl} fL — bright; fine as design-initial if lamp will age down` };
    return { pass:'pass', note:`${fl.toFixed(0)} fL — within SDR reference band (~${L.sdrReferenceFl} fL)` };
  }

  // ── PUBLIC API — PROVISIONAL RP23 LEVEL CLASSIFIER ────────────────────────
  // Best-guess RP23 level from a partial spec. PROVISIONAL — the real gates are
  // TODO(RP23). This is a scaffold so the UI can show *a* level today and the
  // logic has one place to harden when the spec lands.
  //   spec: { calibrationStatus, colourGamut, ambientClass, onScreenFl, hdrFormats[] }
  function classifyVideoLevel(spec) {
    spec = spec || {};
    const why = [];
    let level = 1;
    const cal = spec.calibrationStatus;
    const gamut = spec.colourGamut;
    const ambient = spec.ambientClass;
    if (cal === 'metered')            { level = Math.max(level, 2); why.push('metered set-up → ≥L2'); }
    if (cal === 'calibrated-reference'){ level = Math.max(level, 3); why.push('calibrated → ≥L3'); }
    if (gamut === 'DCI-P3' || gamut === 'Rec.2020') { level = Math.max(level, 3); why.push('wide gamut → ≥L3'); }
    if (cal === 'calibrated-reference' && (ambient === 'blackout') &&
        (gamut === 'Rec.2020' || gamut === 'DCI-P3')) { level = 4; why.push('calibrated + blackout + wide gamut → L4'); }
    return { level, why, provisional: true, todo: 'RP23 numeric gates unpublished — verify on release' };
  }

  // ── Module export ─────────────────────────────────────────────────────────
  const API = {
    __version: MODULE_VERSION,
    STANDARDS, VIDEO_LEVELS, IMAGE_FIELDS,
    horizontalFovDeg, screenWidthForFov, fovVerdict,
    pixelsPerDegree, resolutionVerdict,
    footLamberts, requiredLumens, brightnessVerdict, flToNits, nitsToFl,
    classifyVideoLevel
  };
  if (typeof window !== 'undefined') window.SonorRP23 = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
