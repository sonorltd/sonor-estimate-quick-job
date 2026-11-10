// =============================================================================
// sonor-rp22.js — Canonical CEDIA/CTA-RP22 v1.2 reference data + math
// =============================================================================
//
// Workspace-shared module (Spine S-4.2). Master at workspace root, synced into
// each consumer app's data/ via sync-everything.sh. Edit master only — never
// hand-edit per-app copies.
//
// Purpose: hold the CEDIA/CTA-RP22 v1.2 + Sonor Haddock v3 reference design
// data (label key, performance-level targets, Appendix E recipe channel lists,
// 3-axis offset maths) as a SINGLE source of truth so Cinema Takeoff and
// Cinema Design (and future RAMS / Packs / Project Master surfaces) all
// consume identical RP22 facts. No DOM, no app-state — pure data + pure
// functions.
//
// Phase 2 of the merge plan extracts these from Cinema Takeoff's
// js/02a1b-cd-rp22-recipes.js + js/02a1f-cd-rp22-foundations.js into this
// canonical workspace master. Cinema Takeoff's CD._getPerfLevelTargets,
// CD.RP22_LABELS, CD._rp22Layouts can wrap this module's exports.
//
// Public API (window.SonorRP22):
//
//   SonorRP22.LABELS                                    — full RP22 label key
//                                                          dict (FL → TBR with
//                                                          atmos/auro/dts
//                                                          aliases per Table E-1)
//   SonorRP22.getPerfLevelTargets(level)                — RP22 Appendix A
//                                                          numeric thresholds
//                                                          per Performance
//                                                          Level (1–4). Returns
//                                                          PL2 if input invalid.
//   SonorRP22.getLayout(recipeKey)                      — recipe { discrete,
//                                                          desc, channels[] }
//                                                          for keys '5.1' →
//                                                          '13.1.6'.
//   SonorRP22.LAYOUT_KEYS                                — array of all recipe
//                                                          keys in canonical
//                                                          order.
//   SonorRP22.getLayer(channel)                         — 'ear' | 'height' |
//                                                          'top' | null.
//   SonorRP22.formatLabel(channel, format)              — friendly name +
//                                                          format-specific
//                                                          label (atmos / auro
//                                                          / dts / canonical).
//
// Versioning:
//   v1.0.0 (2026-05-08) — initial extraction from Cinema Takeoff v0.15.4

(function () {
  'use strict';

  const MODULE_VERSION = '1.0.0';

  // ── RP22 LABEL KEY (Table E-1) ───────────────────────────────────────────
  // Cross-references RP22 canonical channel names to Atmos / Auro-3D / DTS:X
  // labels per Appendix E.1. layer ∈ {'ear','height','top'} drives Z-height
  // assignment.
  const LABELS = {
    // Listener-level (ear)
    FL:  { layer:'ear',    name:'Front Left',          atmos:'L',  auro:'L',  dts:'L'  },
    FC:  { layer:'ear',    name:'Front Center',        atmos:'C',  auro:'C',  dts:'C'  },
    FR:  { layer:'ear',    name:'Front Right',         atmos:'R',  auro:'R',  dts:'R'  },
    FCL: { layer:'ear',    name:'Front Center Left',   atmos:'Lc', auro:'-',  dts:'-'  },
    FCR: { layer:'ear',    name:'Front Center Right',  atmos:'Rc', auro:'-',  dts:'-'  },
    FWL: { layer:'ear',    name:'Front Wide Left',     atmos:'Lw', auro:'-',  dts:'-'  },
    FWR: { layer:'ear',    name:'Front Wide Right',    atmos:'Rw', auro:'-',  dts:'-'  },
    SL:  { layer:'ear',    name:'Surround Left',       atmos:'Ls', auro:'Ls', dts:'Ls' },
    SR:  { layer:'ear',    name:'Surround Right',      atmos:'Rs', auro:'Rs', dts:'Rs' },
    SL1: { layer:'ear',    name:'Surround Left 1',     atmos:'Ls1',auro:'Ls', dts:'Ls' },
    SR1: { layer:'ear',    name:'Surround Right 1',    atmos:'Rs1',auro:'Rs', dts:'Rs' },
    SBL: { layer:'ear',    name:'Surround Back Left',  atmos:'Lrs',auro:'Lb', dts:'Lsr'},
    SBR: { layer:'ear',    name:'Surround Back Right', atmos:'Rrs',auro:'Rb', dts:'Rsr'},
    // Upper (height + top)
    HFL: { layer:'height', name:'Height Front Left',   atmos:'Lfh',auro:'HL', dts:'Lh' },
    HFC: { layer:'height', name:'Height Front Center', atmos:'-',  auro:'HC', dts:'Ch' },
    HFR: { layer:'height', name:'Height Front Right',  atmos:'Rfh',auro:'HR', dts:'Rh' },
    HBL: { layer:'height', name:'Height Back Left',    atmos:'Lrh',auro:'HLs',dts:'Lhr'},
    HBR: { layer:'height', name:'Height Back Right',   atmos:'Rrh',auro:'HRs',dts:'Rhr'},
    TFL: { layer:'top',    name:'Top Front Left',      atmos:'Ltf',auro:'-',  dts:'Ltf'},
    TFR: { layer:'top',    name:'Top Front Right',     atmos:'Rtf',auro:'-',  dts:'Rtf'},
    TML: { layer:'top',    name:'Top Middle Left',     atmos:'Ltm',auro:'-',  dts:'Ltm'},
    TMR: { layer:'top',    name:'Top Middle Right',    atmos:'Rtm',auro:'-',  dts:'Rtm'},
    TMC: { layer:'top',    name:'Top Middle Center',   atmos:'-',  auro:'T',  dts:'OH' },
    TBL: { layer:'top',    name:'Top Back Left',       atmos:'Ltr',auro:'-',  dts:'Ltr'},
    TBR: { layer:'top',    name:'Top Back Right',      atmos:'Rtr',auro:'-',  dts:'Rtr'},
  };

  // ── PERFORMANCE LEVEL TARGETS (RP22 Appendix A Table A-1) ────────────────
  // Numeric thresholds per Performance Level (1–4). Cross-referenced from
  // §3 + §4 + §5 of the spec. Pure lookup, no calc — SPL/dB checks are done
  // by the caller using these as comparators.
  const PERF_LEVEL_TARGETS = {
    1: {
      seatToWallMm:     500,    // RP22 §4.1.4 #1 (>0.5 m)
      maxScreenSplDb:   6,      // §5.5.4 #4
      maxSurroundSplDb: 10,     // §5.6.2.1 #6
      maxUpperSplDb:    12,     // §5.8.2 #10
      maxAdjSurroundDeg: null,  // N/A at L1
      maxUpperRowDeg:   null,   // N/A at L1
      upfiringOk:       true,   // §5.8.2 #8
      wideMaxDevDeg:    10,     // §5.7 #7 (±10°)
      sptSeatToSeatDb:  5,      // §5.5.4 #16
      zonalLocsOnly:    true,   // §5.5.4 #3 (always 0 outside zone)
    },
    2: {
      seatToWallMm:     800,    // >0.8 m
      maxScreenSplDb:   5,
      maxSurroundSplDb: 6,
      maxUpperSplDb:    8,
      maxAdjSurroundDeg: 80,
      maxUpperRowDeg:   80,
      upfiringOk:       true,
      wideMaxDevDeg:    7,
      sptSeatToSeatDb:  3,
      zonalLocsOnly:    true,
    },
    3: {
      seatToWallMm:     1200,   // >1.2 m
      maxScreenSplDb:   4,
      maxSurroundSplDb: 4,
      maxUpperSplDb:    5,
      maxAdjSurroundDeg: 60,
      maxUpperRowDeg:   60,
      upfiringOk:       false,
      wideMaxDevDeg:    5,
      sptSeatToSeatDb:  1.5,
      zonalLocsOnly:    true,
    },
    4: {
      seatToWallMm:     1500,   // >1.5 m
      maxScreenSplDb:   2,
      maxSurroundSplDb: 2,
      maxUpperSplDb:    2,
      maxAdjSurroundDeg: 50,
      maxUpperRowDeg:   50,
      upfiringOk:       false,
      wideMaxDevDeg:    2,
      sptSeatToSeatDb:  1.5,
      zonalLocsOnly:    true,
    },
  };

  // ── APPENDIX E LAYOUT RECIPES (RP22 §E.2.1 .. §E.2.8) ────────────────────
  // Channel lists for each canonical Atmos-format layout. Each entry has a
  // `discrete` count, a human-readable description (with RP22 section ref),
  // and the ordered channel list. Spatial placement (x, y, z) is computed
  // by callers using room geometry + LA + RSP — this module is just data.
  const LAYOUTS = {
    '5.1':    { discrete: 5,  desc: '5 main + LFE — entry-level immersive (RP22 §E.2.1)',  channels: ['FL','FC','FR','SL','SR'] },
    '5.1.2':  { discrete: 7,  desc: '5.1 + 2 top middle (RP22 §E.2.2)',                    channels: ['FL','FC','FR','SL','SR','TML','TMR'] },
    '5.1.4':  { discrete: 9,  desc: '5.1 + 4 top (RP22 §E.2.3 — recommended PL1)',         channels: ['FL','FC','FR','SL','SR','TFL','TFR','TBL','TBR'] },
    '7.1.4':  { discrete: 11, desc: '7.1 + 4 top (RP22 §E.2.4 — minimum PL2)',             channels: ['FL','FC','FR','SL','SR','SBL','SBR','TFL','TFR','TBL','TBR'] },
    '9.1.4':  { discrete: 13, desc: '7.1.4 + front wides (RP22 §E.2.5)',                   channels: ['FL','FC','FR','FWL','FWR','SL','SR','SBL','SBR','TFL','TFR','TBL','TBR'] },
    '9.1.6':  { discrete: 15, desc: '7.1.4 + front wides + top middle (RP22 §E.2.6)',      channels: ['FL','FC','FR','FWL','FWR','SL','SR','SBL','SBR','TFL','TFR','TML','TMR','TBL','TBR'] },
    '11.1.6': { discrete: 17, desc: '7.1.4 + wides + 2 surround pairs for 2 rows (RP22 §E.2.7 — minimum PL3/4 with multi-row)', channels: ['FL','FC','FR','FWL','FWR','SL','SL1','SR','SR1','SBL','SBR','TFL','TFR','TML','TMR','TBL','TBR'] },
    '13.1.6': { discrete: 19, desc: 'All RP22 channels for any-format optimisation (RP22 §E.2.8)', channels: ['FL','FC','FR','FWL','FWR','SL','SL1','SR','SR1','SBL','SBR','HFC','TFL','TFR','TMC','TML','TMR','TBL','TBR'] },
  };

  const LAYOUT_KEYS = ['5.1', '5.1.2', '5.1.4', '7.1.4', '9.1.4', '9.1.6', '11.1.6', '13.1.6'];

  // ── PUBLIC API ───────────────────────────────────────────────────────────

  function getPerfLevelTargets(level) {
    const n = parseInt(level, 10);
    return PERF_LEVEL_TARGETS[n] || PERF_LEVEL_TARGETS[2];
  }

  function getLayout(recipeKey) {
    return LAYOUTS[recipeKey] || null;
  }

  function getLayer(channel) {
    return LABELS[channel] ? LABELS[channel].layer : null;
  }

  // formatLabel — returns the format-specific name for a channel.
  // format: 'atmos' | 'auro' | 'dts' | 'name' | 'rp22' (default 'rp22' = the canonical key)
  function formatLabel(channel, format) {
    const f = format || 'rp22';
    if (f === 'rp22') return channel;
    const e = LABELS[channel];
    if (!e) return channel;
    if (f === 'name') return e.name;
    if (f === 'atmos') return e.atmos;
    if (f === 'auro')  return e.auro;
    if (f === 'dts')   return e.dts;
    return channel;
  }

  // ── Module export ────────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.SonorRP22 = {
      __version: MODULE_VERSION,
      LABELS,
      LAYOUTS,
      LAYOUT_KEYS,
      PERF_LEVEL_TARGETS,
      getPerfLevelTargets,
      getLayout,
      getLayer,
      formatLabel
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      LABELS, LAYOUTS, LAYOUT_KEYS, PERF_LEVEL_TARGETS,
      getPerfLevelTargets, getLayout, getLayer, formatLabel
    };
  }
})();
