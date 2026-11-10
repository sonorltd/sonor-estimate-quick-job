/* ═══════════════════════════════════════════════════════════════════════
   SonorPhase — the ONE build-phase list for every Sonor project (v1.0.0, 2026-11-05)
   ROOT MASTER: ~/mnt/Sonor/data/sonor-phase.js — apps carry byte-identical copies in data/.
   Bryn 2026-11-05: "as project progresses through planning, 1st fix, 2nd fix etc stages, the overview
   changes based on stage, so we need a project phase parameter across each project".

   Stored in projects.phase (text, CHECK = these keys) + projects.phase_set_at (when it last moved).
   projects.status stays COMMERCIAL (enquiry / quoted / won / active / install / complete / lost);
   phase is where the BUILD is. NULL = not set yet (read it as 'design', and say it isn't set).
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var LIST = [
    { key: 'design',        label: 'Design & planning',       short: 'Design',        blurb: 'Drawings, specs, quotes and requirements agreed before anyone is on site.' },
    { key: 'first_fix',     label: '1st fix',                 short: '1st fix',       blurb: 'Cables, back boxes and containment in before the walls and ceilings close.' },
    { key: 'second_fix',    label: '2nd fix',                 short: '2nd fix',       blurb: 'Devices, faceplates, panels and equipment fitted and terminated.' },
    { key: 'commissioning', label: 'Commissioning & testing', short: 'Commissioning', blurb: 'Everything tested, energised, programmed and checked.' },
    { key: 'handover',      label: 'Handover',                short: 'Handover',      blurb: 'Client walk-through, as-installed documents and sign-off.' },
    { key: 'aftercare',     label: 'Aftercare / service',     short: 'Aftercare',     blurb: 'Living with it — service plan, visits and support.' }];
  function index(key) { for (var i = 0; i < LIST.length; i++) if (LIST[i].key === key) return i; return -1; }
  function get(key) { var i = index(key); return i < 0 ? null : LIST[i]; }
  global.SonorPhase = {
    VERSION: '1.0.0',
    list: LIST.map(function (p) { return Object.assign({}, p); }),
    keys: LIST.map(function (p) { return p.key; }),
    index: index,
    get: get,
    label: function (key) { var p = get(key); return p ? p.label : 'Phase not set'; },
    short: function (key) { var p = get(key); return p ? p.short : 'Not set'; },
    next: function (key) { var i = index(key); return i >= 0 && i < LIST.length - 1 ? LIST[i + 1].key : null; },
    options: function () { return [{ value: '', label: '— not set —' }].concat(LIST.map(function (p) { return { value: p.key, label: p.label }; })); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
