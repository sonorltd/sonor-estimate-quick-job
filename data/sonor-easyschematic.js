/**
 * sonor-easyschematic.js  v1.1.0
 * Shared EasySchematic integration module for all Sonor apps.
 *
 * Spine v1.2.5 compliant — workspace-root canonical, synced to apps by
 * sync-everything.sh. GH Pages compatible (pure browser JS, no Node deps).
 *
 * Responsibilities:
 *   1. Look up device → EasySchematic template mappings from Supabase
 *   2. Generate EasySchematic-compatible JSON from a device list (flat or package-based)
 *   3. Package-based signal flow: pre-wired topology templates for the 10 common
 *      Sonor system architectures — audio matrices, cinema chains, video distribution,
 *      CCTV, network. Colour-coded by Sonor service swatch.
 *   4. Save / load generated diagrams to/from easyschematic_diagrams in Supabase
 *   5. Trigger browser download of JSON for manual EasySchematic import
 *
 * All constants (PACKAGE_TEMPLATES, EXAMPLES, SERVICE_COLOURS) are embedded in
 * this file — no external JSON fetch required. Works offline and from any GH Pages URL.
 *
 * Dependencies:
 *   sonor-db.js (SonorDB) — optional, falls back to raw fetch with anon key.
 *
 * Usage:
 *   const es = window.SonorEasySchematic;
 *
 *   // Flat device list (no wiring):
 *   const json = await es.generate(devices, { title: 'Room Plan' });
 *
 *   // Package-based (auto-wired signal chain):
 *   const json = await es.generatePackage('audio-16zone', {
 *     streamer: ['SONOS-PORT-1', 'SONOS-PORT-2'],
 *     matrix:   ['TRIAD-AMS16'],
 *     amp:      ['TRIAD-PAMP8-A', 'TRIAD-PAMP8-B'],
 *   }, { title: 'Whole-Home Audio' });
 *
 *   // Multiple packages in one diagram:
 *   const json = await es.generateMultiPackage([
 *     { id: 'cinema-processor', slots: { ... } },
 *     { id: 'audio-16zone',     slots: { ... } },
 *   ], { title: 'Full System' });
 *
 *   await es.save(json, { projectId: 'proj-123', sourceApp: 'cinema' });
 *   es.download(json, 'schematic.json');
 *
 * Version history:
 *   v1.0.0  2026-05-11  Mappings lookup, flat generate, save/load/download
 *   v1.1.0  2026-05-11  Package system — pre-wired topologies, service colour coding,
 *                        linear signal-flow layout, multi-package diagrams, examples
 *   v1.2.0  2026-05-11  CEDIA engineering pack analysis (YB-02-C-WH):
 *                        + netvio-video package (Netvio matrix + Blustream TX/RX)
 *                        + control4-lighting package (Control4 EA + dimmers + Neeo keypads)
 *                        + room_controller category in CATEGORY_MAP
 *                        + Updated audio-8zone description (Sonance SA-8175)
 *   v1.2.1  2026-05-11  Brand correction — Sonor uses Control4/Netvio/Blustream/Sonance
 *   v1.3.0  2026-05-11  Library seam — v_library_with_es view, BLOCK_CATEGORY_MAP,
 *                        getLibraryForSlot(), getLibraryForPackage(). Consumer apps can
 *                        query Library blocks by ES slot category. es_ready flag live.
 *   v1.3.1  2026-05-11  Schema fix — view join changed to COALESCE(device_model_id,
 *                        block_code) so Library blocks without a specific device_model_id
 *                        resolve against their canonical block_code ES mapping row.
 *                        52 CL-SON-* / SON-TO-* blocks now es_ready = true.
 */

window.SonorEasySchematic = (() => {
  'use strict';

  // ─── Version ─────────────────────────────────────────────────────────────────

  const VERSION = '1.3.1';

  // ─── Supabase ─────────────────────────────────────────────────────────────────

  const SUPABASE_URL  = 'https://ysmvklstkzodlocttspy.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbXZrbHN0a3pvZGxvY3R0c3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Njc0OTMsImV4cCI6MjA4OTM0MzQ5M30.08kRS_dtbwz0rSYezNGMJHnOU_st8GKZseQPefcMEMc';

  // ─── Sonor service colours ────────────────────────────────────────────────────
  // Maps service_nn → brand hex. Used to colour-code device nodes in diagrams.
  // Permanent — these are the 10 locked Sonor service swatches (brand-core.xml).

  const SERVICE_COLOURS = {
    '01': '#8058a1',   // Cinema         — Purple
    '02': '#4bb9d3',   // Multiroom Audio — Aqua
    '03': '#78ba57',   // TV Everywhere   — Green
    '04': '#f5d05c',   // Smart Lighting  — Yellow
    '05': '#e37c59',   // Home Automation — Terracotta
    '06': '#ec6061',   // Climate         — Red
    '07': '#e67eb1',   // Control         — Pink
    '08': '#ad9978',   // Security        — Gold
    '09': '#b7b1a7',   // WiFi            — Silver
    '10': '#302f2e',   // Infrastructure  — Charcoal
  };

  // ─── Category map ─────────────────────────────────────────────────────────────

  const CATEGORY_MAP = {
    projector:          'Projector',
    receiver:           'AV Receiver',
    processor:          'AV Processor',
    amplifier:          'Amplifier',
    speaker:            'Speaker',
    subwoofer:          'Subwoofer',
    streamer:           'Media Streamer',
    matrix_audio:       'Audio Matrix',
    tv:                 'Display',
    tv_outdoor:         'Display',
    display:            'Display',
    media_player:       'Media Player',
    matrix_video:       'Video Matrix',
    hdbt_transmitter:   'HDBaseT Transmitter',
    hdbt_receiver:      'HDBaseT Receiver',
    hdmi_ip_tx:         'HDMI over IP Transmitter',
    hdmi_ip_rx:         'HDMI over IP Receiver',
    multiviewer:        'Multiviewer',
    lighting_processor: 'Lighting Processor',
    lighting_dimmer:    'Lighting Dimmer',
    projector_lift:     'Motorised Mount',
    tv_lift:            'Motorised Mount',
    tv_mount:           'Motorised Mount',
    motion_sensor:      'Sensor',
    presence_sensor:    'Sensor',
    thermostat:         'Thermostat',
    hub:                'Control Hub',
    bridge:             'Control Hub',
    controller:         'Control Processor',
    room_controller:    'Room Controller',
    keypad:             'Keypad',
    remote:             'Remote Control',
    touchscreen:        'Touch Panel',
    io_expander:        'I/O Extender',
    camera:             'IP Camera',
    nvr:                'NVR',
    intercom:           'Intercom Station',
    intercom_monitor:   'Intercom Monitor',
    router:             'Network Router',
    switch:             'Network Switch',
    wap:                'Wireless Access Point',
    rack:               null,
    patch_panel:        'Patch Panel',
    ups:                'UPS',
    cable:              null,
    hdd:                null,
    conditioner:        'Power Conditioner',
  };

  // ─── Library category bridge ─────────────────────────────────────────────────
  //
  // Maps EasySchematic slot category keys (used in PACKAGE_TEMPLATES) to the
  // short-code category values used in sonor_blocks.  One slot key can map to
  // multiple Library codes (e.g. 'switch' covers 'SW' and 'SW-L').
  //
  // This is the seam between the Library (source of truth for devices Sonor
  // actually specifies) and the EasySchematic package system.
  //
  // When a Library block has device_model_id set, the full ES mapping (signal
  // types, port data, confidence) flows through v_library_with_es automatically.
  // Until then, getLibraryForSlot() returns Library blocks matched by category
  // so the slot picker is already populated with the right device types.
  //
  // Enrichment step (to do): set device_model_id on Library blocks that have a
  // confirmed match in easyschematic_mappings. The Library app is the right
  // surface for this — an "ES badge" per block linking to its mapping row.

  const BLOCK_CATEGORY_MAP = {
    // Slot key          → Library category codes
    projector:           ['PROJ'],
    receiver:            ['AMP'],          // AV receivers sit in AMP in Library
    processor:           ['AMP'],          // AV processors too
    amplifier:           ['AMP'],
    streamer:            ['SRC'],          // media streamers / sources
    matrix_audio:        ['MATRIX'],
    matrix_video:        ['MATRIX'],
    tv:                  ['TV'],
    display:             ['TV', 'SCRN'],
    media_player:        ['SRC', 'device'],
    hdbt_transmitter:    ['TX'],
    hdbt_receiver:       ['RX'],
    hdmi_ip_tx:          ['TX'],
    hdmi_ip_rx:          ['RX'],
    room_controller:     ['HUB', 'device'],
    controller:          ['HUB'],
    lighting_dimmer:     ['DIM'],
    lighting_processor:  ['HUB'],
    keypad:              ['KP', 'LKP', 'KEYPAD', 'KEYSTATION'],
    touchscreen:         ['TP'],
    io_expander:         ['IO', 'MOD'],
    camera:              ['CAM'],
    nvr:                 ['NVR'],
    router:              ['RTR', 'FW'],
    switch:              ['SW', 'SW-L'],
    wap:                 ['WAP'],
    patch_panel:         ['PP'],
    ups:                 ['PDU', 'PSU'],
    conditioner:         ['PDU'],
    hub:                 ['HUB', 'BRIDGE'],
    thermostat:          ['TSTAT', 'STAT'],
    remote:              ['RMT'],
  };

  const SKIP_CATEGORIES = new Set([
    'rack', 'cable', 'hdd', 'speaker', 'subwoofer',
    'tv_mount', 'projector_lift', 'tv_lift',
    'motion_sensor', 'presence_sensor',
  ]);

  // ─── Package templates ────────────────────────────────────────────────────────
  //
  // Each package defines a reusable signal-chain topology for a standard Sonor
  // system type. Packages are embedded here so they are available from any GH
  // Pages URL without an extra network fetch.
  //
  // Slot spec keys:
  //   label     {string}   Human name for the slot
  //   category  {string}   Expected Sonor device category
  //   count     [min, max] Acceptable device count range
  //   preferred {string}   Suggested model label (display only)
  //   order     {number}   Signal-flow position (leftmost = 0)
  //
  // Wiring spec keys:
  //   from      {string}   Source slot ID
  //   to        {string}   Target slot ID
  //   signal    {string}   EasySchematic signalType string
  //   strategy  {string}   'first' | 'fan-out' | 'parallel'
  //     first      — connect first device of each slot (1→1)
  //     fan-out    — connect one source to all targets (1→N)
  //     parallel   — connect source[i] to target[i] (N→N by index)
  //   label     {string}   Optional connection label (e.g. cable run name)

  const PACKAGE_TEMPLATES = {

    // ── 01 Cinema ───────────────────────────────────────────────────────────────

    'cinema-receiver': {
      label:       'Cinema (AV Receiver)',
      service_nn:  '01',
      color:       SERVICE_COLOURS['01'],
      description: 'Media sources feed an AV receiver which drives the projector and speaker system.',
      slots: {
        source:    { label: 'Media Sources',  category: 'media_player', count: [1, 4], preferred: 'Apple TV 4K / Sky Q', order: 0 },
        receiver:  { label: 'AV Receiver',    category: 'receiver',     count: [1, 1], preferred: 'Denon AVR-X4800H',   order: 1 },
        projector: { label: 'Projector',      category: 'projector',    count: [1, 1], preferred: 'JVC DLA-NZ9',        order: 2 },
      },
      wiring: [
        { from: 'source',   to: 'receiver',  signal: 'hdmi',         strategy: 'fan-out' },
        { from: 'receiver', to: 'projector', signal: 'hdmi',         strategy: 'first',  label: 'HDMI Main Out' },
      ],
    },

    'cinema-processor': {
      label:       'Cinema (Separate Processor + Amp)',
      service_nn:  '01',
      color:       SERVICE_COLOURS['01'],
      description: 'High-end cinema: discrete processor handles AV decoding, separate amp drives speakers, projector on HDMI output.',
      slots: {
        source:    { label: 'Media Sources', category: 'media_player', count: [1, 4], preferred: 'Apple TV 4K / Sky Q', order: 0 },
        processor: { label: 'AV Processor',  category: 'processor',    count: [1, 1], preferred: 'Arcam AV41',          order: 1 },
        amplifier: { label: 'Amplifier',     category: 'amplifier',    count: [1, 2], preferred: 'Arcam PA720',         order: 2 },
        projector: { label: 'Projector',     category: 'projector',    count: [1, 1], preferred: 'JVC DLA-NZ9',         order: 3 },
      },
      wiring: [
        { from: 'source',    to: 'processor', signal: 'hdmi',          strategy: 'fan-out', label: 'Source HDMI' },
        { from: 'processor', to: 'projector', signal: 'hdmi',          strategy: 'first',   label: 'HDMI Out' },
        { from: 'processor', to: 'amplifier', signal: 'analog-audio',  strategy: 'fan-out', label: 'Balanced XLR' },
      ],
    },

    // ── 02 Multiroom Audio ───────────────────────────────────────────────────────

    'audio-4zone': {
      label:       '4-Zone Multiroom Audio',
      service_nn:  '02',
      color:       SERVICE_COLOURS['02'],
      description: 'Streamer → audio matrix → 4-zone power amp → 4 rooms. Sonance SA-4175 or SA-4125 as the amp; Nuvo or Control4 matrix for source switching.',
      slots: {
        streamer: { label: 'Streamer(s)',  category: 'streamer',    count: [1, 2], preferred: 'Sonos Port',         order: 0 },
        matrix:   { label: 'Audio Matrix', category: 'matrix_audio', count: [1, 1], preferred: 'Nuvo / Control4 Matrix', order: 1 },
        amp:      { label: 'Power Amp',    category: 'amplifier',   count: [1, 1], preferred: 'Sonance SA-4175',    order: 2 },
      },
      wiring: [
        { from: 'streamer', to: 'matrix', signal: 'analog-audio', strategy: 'fan-out', label: 'RCA / Balanced' },
        { from: 'matrix',   to: 'amp',    signal: 'analog-audio', strategy: 'fan-out', label: 'Zone Outputs' },
      ],
    },

    'audio-8zone': {
      label:       '8-Zone Multiroom Audio',
      service_nn:  '02',
      color:       SERVICE_COLOURS['02'],
      description: 'Streamers → 8-zone audio matrix → Sonance 8-channel power amp → 8 rooms. Source connects via RCA; zone outputs via terminal block to speaker pairs.',
      slots: {
        streamer: { label: 'Streamer(s)',  category: 'streamer',    count: [1, 4], preferred: 'Sonos Port',     order: 0 },
        matrix:   { label: 'Audio Matrix', category: 'matrix_audio', count: [1, 1], preferred: 'Nuvo / Control4 Matrix', order: 1 },
        amp:      { label: 'Power Amp',    category: 'amplifier',   count: [1, 1], preferred: 'Sonance SA-8175', order: 2 },
      },
      wiring: [
        { from: 'streamer', to: 'matrix', signal: 'analog-audio', strategy: 'fan-out', label: 'RCA / Balanced' },
        { from: 'matrix',   to: 'amp',    signal: 'analog-audio', strategy: 'fan-out', label: 'Zone Outputs' },
      ],
    },

    'audio-16zone': {
      label:       '16-Zone Multiroom Audio',
      service_nn:  '02',
      color:       SERVICE_COLOURS['02'],
      description: 'Up to 4 streamers → 16-zone audio matrix → two Sonance 8-channel power amps → 16 zones across the property.',
      slots: {
        streamer: { label: 'Streamer(s)',   category: 'streamer',    count: [1, 4], preferred: 'Sonos Port',       order: 0 },
        matrix:   { label: 'Audio Matrix',  category: 'matrix_audio', count: [1, 1], preferred: 'Nuvo / Control4 Matrix', order: 1 },
        amp:      { label: 'Power Amp ×2',  category: 'amplifier',   count: [2, 2], preferred: 'Sonance SA-8175',  order: 2 },
      },
      wiring: [
        { from: 'streamer', to: 'matrix', signal: 'analog-audio', strategy: 'fan-out',  label: 'Sources In' },
        { from: 'matrix',   to: 'amp',    signal: 'analog-audio', strategy: 'fan-out',  label: 'Zone Outputs (16 ch)' },
      ],
    },

    // ── 03 Video Distribution ────────────────────────────────────────────────────

    'netvio-video': {
      label:       'Video Distribution (Netvio Matrix)',
      service_nn:  '03',
      color:       SERVICE_COLOURS['03'],
      description: 'Sonor standard video distribution: media sources → Netvio HDMI matrix → one Blustream HDBaseT RX per room (Cat6A, carries HDMI + IR control) → display. The matrix handles source switching; Blustream handles the structured-wiring long-run to each room. Room controller slot used where a Control4 room endpoint (SR-260, CA-10) sits alongside the display.',
      slots: {
        source:    { label: 'Media Sources',   category: 'media_player',    count: [1, 8],  preferred: 'Apple TV 4K / Sky Q / Kaleidescape', order: 0 },
        matrix:    { label: 'Video Matrix',    category: 'matrix_video',    count: [1, 1],  preferred: 'Netvio',                             order: 1 },
        hdbt_tx:   { label: 'HDBaseT TX',      category: 'hdbt_transmitter', count: [1, 12], preferred: 'Blustream HEX100ARC-TX',            order: 2 },
        hdbt_rx:   { label: 'HDBaseT RX',      category: 'hdbt_receiver',   count: [1, 12], preferred: 'Blustream HEX100ARC-RX',            order: 3 },
        tv:        { label: 'Displays',        category: 'tv',              count: [1, 12], preferred: 'Samsung / LG OLED',                 order: 4 },
      },
      wiring: [
        { from: 'source',  to: 'matrix',  signal: 'hdmi',    strategy: 'fan-out',  label: 'HDMI Source Inputs' },
        { from: 'matrix',  to: 'hdbt_tx', signal: 'hdmi',    strategy: 'fan-out',  label: 'Matrix Zone Outputs' },
        { from: 'hdbt_tx', to: 'hdbt_rx', signal: 'hdbaset', strategy: 'parallel', label: 'Cat6A Long Run' },
        { from: 'hdbt_rx', to: 'tv',      signal: 'hdmi',    strategy: 'parallel', label: 'HDMI to Display' },
      ],
    },

    'tv-direct': {
      label:       'TV Room (Direct HDMI)',
      service_nn:  '03',
      color:       SERVICE_COLOURS['03'],
      description: 'Single media source directly to a TV via HDMI — simplest video room.',
      slots: {
        source: { label: 'Media Source', category: 'media_player', count: [1, 2], preferred: 'Apple TV 4K', order: 0 },
        tv:     { label: 'Display',      category: 'tv',           count: [1, 1], preferred: 'LG OLED',     order: 1 },
      },
      wiring: [
        { from: 'source', to: 'tv', signal: 'hdmi', strategy: 'first', label: 'HDMI' },
      ],
    },

    'tv-hdbt': {
      label:       'TV Room (HDBaseT Long-Run)',
      service_nn:  '03',
      color:       SERVICE_COLOURS['03'],
      description: 'Sources → video matrix → HDBaseT TX at rack → structured Cat6 run → HDBaseT RX at TV location.',
      slots: {
        source:   { label: 'Media Sources',     category: 'media_player',   count: [1, 4], preferred: 'Apple TV / Sky Q',     order: 0 },
        matrix:   { label: 'Video Matrix',      category: 'matrix_video',   count: [0, 1], preferred: 'Wyrestorm MXV-0808',   order: 1 },
        hdbt_tx:  { label: 'HDBaseT TX',        category: 'hdbt_transmitter', count: [1, 8], preferred: 'Blustream HEX100ARC', order: 2 },
        hdbt_rx:  { label: 'HDBaseT RX',        category: 'hdbt_receiver',  count: [1, 8], preferred: 'Generic HDBaseT RX',   order: 3 },
        tv:       { label: 'Display',           category: 'tv',             count: [1, 8], preferred: 'Samsung / LG OLED',    order: 4 },
      },
      wiring: [
        { from: 'source',  to: 'matrix',  signal: 'hdmi',    strategy: 'fan-out', label: 'Sources' },
        { from: 'matrix',  to: 'hdbt_tx', signal: 'hdmi',    strategy: 'fan-out', label: 'Zone Outputs' },
        { from: 'source',  to: 'hdbt_tx', signal: 'hdmi',    strategy: 'fan-out', label: 'Direct' },  // when no matrix
        { from: 'hdbt_tx', to: 'hdbt_rx', signal: 'hdbaset', strategy: 'parallel', label: 'Cat6 / Cat6A' },
        { from: 'hdbt_rx', to: 'tv',      signal: 'hdmi',    strategy: 'parallel', label: 'HDMI Local' },
      ],
    },

    'video-matrix-ip': {
      label:       'Video Distribution (HDMI over IP)',
      service_nn:  '03',
      color:       SERVICE_COLOURS['03'],
      description: 'Sources → HDMI IP encoders → 1Gb/10Gb network switch → HDMI IP decoders → displays. Scales to any number of rooms.',
      slots: {
        source:  { label: 'Media Sources',  category: 'media_player', count: [1, 8],  preferred: 'Apple TV / Sky Q',      order: 0 },
        ip_tx:   { label: 'HDMI IP TX',     category: 'hdmi_ip_tx',   count: [1, 16], preferred: 'Blustream IP200UHD-TX', order: 1 },
        switch:  { label: 'Network Switch', category: 'switch',       count: [1, 2],  preferred: 'Ubiquiti USW-Pro-24-PoE', order: 2 },
        ip_rx:   { label: 'HDMI IP RX',     category: 'hdmi_ip_rx',   count: [1, 16], preferred: 'Blustream IP200UHD-RX', order: 3 },
        tv:      { label: 'Displays',       category: 'tv',           count: [1, 16], preferred: 'Samsung / LG',          order: 4 },
      },
      wiring: [
        { from: 'source', to: 'ip_tx',  signal: 'hdmi',     strategy: 'parallel', label: 'HDMI In' },
        { from: 'ip_tx',  to: 'switch', signal: 'ethernet', strategy: 'fan-out',  label: '1Gb Uplink' },
        { from: 'switch', to: 'ip_rx',  signal: 'ethernet', strategy: 'fan-out',  label: 'PoE Feed' },
        { from: 'ip_rx',  to: 'tv',     signal: 'hdmi',     strategy: 'parallel', label: 'HDMI Out' },
      ],
    },

    // ── 04 Smart Lighting ────────────────────────────────────────────────────────

    'control4-lighting': {
      label:       'Smart Lighting (Control4)',
      service_nn:  '04',
      color:       SERVICE_COLOURS['04'],
      description: 'Control4 lighting control: EA controller communicates over the Control4 network to in-wall dimmer/switch modules. Keypads and touch panels in each room trigger scenes and sequences.',
      slots: {
        controller: { label: 'Control4 Controller', category: 'controller',      count: [1, 1],  preferred: 'Control4 EA-5 / EA-3',       order: 0 },
        dimmer:     { label: 'Dimmer Modules',      category: 'lighting_dimmer', count: [1, 30], preferred: 'Control4 In-Wall Dimmer',     order: 1 },
        keypad:     { label: 'Keypads',             category: 'keypad',          count: [1, 20], preferred: 'Control4 Keypad / Neeo',      order: 2 },
      },
      wiring: [
        { from: 'controller', to: 'dimmer', signal: 'ethernet', strategy: 'fan-out', label: 'Control4 Network' },
        { from: 'controller', to: 'keypad', signal: 'ethernet', strategy: 'fan-out', label: 'PoE Keypads' },
      ],
    },

    // ── 08 Security ──────────────────────────────────────────────────────────────

    'cctv-nvr': {
      label:       'CCTV (IP Camera + NVR)',
      service_nn:  '08',
      color:       SERVICE_COLOURS['08'],
      description: 'IP cameras on a dedicated PoE switch → NVR for recording → monitor at desk or TV.',
      slots: {
        camera:  { label: 'IP Cameras',  category: 'camera',  count: [1, 16], preferred: 'Hikvision DS-2CD2343G2', order: 0 },
        switch:  { label: 'PoE Switch',  category: 'switch',  count: [1, 1],  preferred: 'Ubiquiti USW-Pro-8-PoE', order: 1 },
        nvr:     { label: 'NVR',         category: 'nvr',     count: [1, 1],  preferred: 'Hikvision DS-7608NXI',   order: 2 },
        monitor: { label: 'Monitor/TV',  category: 'tv',      count: [0, 2],  preferred: 'Any display',            order: 3 },
      },
      wiring: [
        { from: 'camera', to: 'switch',  signal: 'ethernet', strategy: 'fan-out',  label: 'PoE' },
        { from: 'switch', to: 'nvr',     signal: 'ethernet', strategy: 'first',    label: 'Uplink' },
        { from: 'nvr',    to: 'monitor', signal: 'hdmi',     strategy: 'first',    label: 'Live View' },
      ],
    },

    // ── 09 Network ───────────────────────────────────────────────────────────────

    'unifi-network': {
      label:       'UniFi Network Core',
      service_nn:  '09',
      color:       SERVICE_COLOURS['09'],
      description: 'ISP router/ONT → Ubiquiti Dream Machine Pro (gateway + firewall) → core PoE switch → access points and distribution.',
      slots: {
        router:      { label: 'Gateway/Router',  category: 'router',  count: [1, 1],  preferred: 'Ubiquiti UDM-Pro',       order: 0 },
        core_switch: { label: 'Core Switch',     category: 'switch',  count: [1, 2],  preferred: 'Ubiquiti USW-Pro-24-PoE', order: 1 },
        wap:         { label: 'Access Points',   category: 'wap',     count: [1, 16], preferred: 'Ubiquiti U6 Pro',        order: 2 },
      },
      wiring: [
        { from: 'router',      to: 'core_switch', signal: 'ethernet', strategy: 'fan-out', label: '10Gb Uplink' },
        { from: 'core_switch', to: 'wap',         signal: 'ethernet', strategy: 'fan-out', label: 'PoE 802.3at' },
      ],
    },

  };

  // ─── Pre-built examples ───────────────────────────────────────────────────────
  // Concrete slot assignments using real model IDs from the Sonor device catalogue.
  // Used by saveExamples() to seed the easyschematic_diagrams table in Supabase,
  // and by consuming apps as demo configurations.

  const EXAMPLES = {

    'example-cinema-processor': {
      packageId:   'cinema-processor',
      title:       'Example — High-End Cinema (Arcam + JVC)',
      description: 'Arcam AV41 processor + PA720 amps + JVC NZ9 projector',
      slots: {
        source:    ['APPLE-TV4K', 'SKY-Q-2TB'],
        processor: ['ARCAM-AV41'],
        amplifier: ['ARCAM-PA720'],
        projector: ['JVC-DLA-NZ9'],
      },
    },

    'example-cinema-receiver': {
      packageId:   'cinema-receiver',
      title:       'Example — Cinema AV Receiver (Denon + Optoma)',
      description: 'Denon AVR-X4800H all-in-one with Optoma projector',
      slots: {
        source:    ['APPLE-TV4K', 'SKY-Q-2TB'],
        receiver:  ['DENON-AVRX4800H'],
        projector: ['OPTOMA-UHZ65LV'],
      },
    },

    'example-audio-16zone': {
      packageId:   'audio-16zone',
      title:       'Example — 16-Zone Whole-Home Audio (Sonance)',
      description: 'Two Sonos Ports → 16-zone audio matrix → two Sonance SA-8175 amps → 16 rooms',
      slots: {
        streamer: ['SONOS-PORT-1', 'SONOS-PORT-2'],
        matrix:   ['AUDIO-MATRIX-16'],
        amp:      ['SONANCE-SA8175-A', 'SONANCE-SA8175-B'],
      },
    },

    'example-audio-8zone': {
      packageId:   'audio-8zone',
      title:       'Example — 8-Zone Multiroom Audio (Sonance)',
      description: 'Sonos Port → 8-zone audio matrix → Sonance SA-8175 → 8 zones',
      slots: {
        streamer: ['SONOS-PORT-1'],
        matrix:   ['AUDIO-MATRIX-8'],
        amp:      ['SONANCE-SA8175-1'],
      },
    },

    'example-tv-hdbt': {
      packageId:   'tv-hdbt',
      title:       'Example — 4-Room HDBaseT (Blustream, no matrix)',
      description: 'Apple TV + Sky Q direct → Blustream HEX100ARC TX/RX → Samsung TVs — simple 2-source 4-room setup without a central matrix',
      slots: {
        source:  ['APPLE-TV4K', 'SKY-Q-2TB'],
        matrix:  ['WYRESTORM-MXV-0808-H2A'],
        hdbt_tx: ['BS-HEX100ARC-1', 'BS-HEX100ARC-2', 'BS-HEX100ARC-3', 'BS-HEX100ARC-4'],
        hdbt_rx: ['HDBT-RX-1', 'HDBT-RX-2', 'HDBT-RX-3', 'HDBT-RX-4'],
        tv:      ['SAMSUNG-QE65-1', 'SAMSUNG-QE65-2', 'SAMSUNG-QE65-3', 'SAMSUNG-QE65-4'],
      },
    },

    'example-netvio-video': {
      packageId:   'netvio-video',
      title:       'Example — 6-Room Video Distribution (Netvio + Blustream)',
      description: 'Apple TV + Sky Q + Kaleidescape → Netvio matrix → Blustream HEX100ARC TX/RX → Samsung TVs across 6 rooms',
      slots: {
        source:  ['APPLE-TV4K', 'SKY-Q-2TB', 'KALEIDESCAPE-CINEMA-ONE'],
        matrix:  ['NETVIO-MATRIX-1'],
        hdbt_tx: ['BS-HEX100ARC-TX-1', 'BS-HEX100ARC-TX-2', 'BS-HEX100ARC-TX-3',
                  'BS-HEX100ARC-TX-4', 'BS-HEX100ARC-TX-5', 'BS-HEX100ARC-TX-6'],
        hdbt_rx: ['BS-HEX100ARC-RX-1', 'BS-HEX100ARC-RX-2', 'BS-HEX100ARC-RX-3',
                  'BS-HEX100ARC-RX-4', 'BS-HEX100ARC-RX-5', 'BS-HEX100ARC-RX-6'],
        tv:      ['SAMSUNG-QE65-1', 'SAMSUNG-QE65-2', 'SAMSUNG-QE65-3',
                  'SAMSUNG-QE65-4', 'SAMSUNG-QE65-5', 'SAMSUNG-QE65-6'],
      },
    },

    'example-video-matrix-ip': {
      packageId:   'video-matrix-ip',
      title:       'Example — HDMI over IP (Blustream) 4-Room',
      description: 'Apple TV + Sky Q → Blustream IP200 TX → UniFi switch → IP RX → LG OLEDs',
      slots: {
        source: ['APPLE-TV4K', 'SKY-Q-2TB'],
        ip_tx:  ['BS-IP200UHD-TX-1', 'BS-IP200UHD-TX-2'],
        switch: ['UI-USW-PRO-24-POE'],
        ip_rx:  ['BS-IP200UHD-RX-1', 'BS-IP200UHD-RX-2', 'BS-IP200UHD-RX-3', 'BS-IP200UHD-RX-4'],
        tv:     ['LG-OLED55-1', 'LG-OLED55-2', 'LG-OLED65-1', 'LG-OLED65-2'],
      },
    },

    'example-cctv-nvr': {
      packageId:   'cctv-nvr',
      title:       'Example — 8-Camera CCTV System (Hikvision)',
      description: 'Hikvision turret cameras → UniFi PoE switch → Hikvision 8-ch NVR',
      slots: {
        camera:  ['HIK-DS2CD-1', 'HIK-DS2CD-2', 'HIK-DS2CD-3', 'HIK-DS2CD-4',
                  'HIK-DS2CD-5', 'HIK-DS2CD-6', 'HIK-DS2CD-7', 'HIK-DS2CD-8'],
        switch:  ['UI-USW-PRO-8-POE'],
        nvr:     ['HIK-DS7608NXI'],
        monitor: ['SAMSUNG-QE43-MONITOR'],
      },
    },

    'example-unifi-network': {
      packageId:   'unifi-network',
      title:       'Example — UniFi Network (UDM-Pro + USW-Pro-24)',
      description: 'Ubiquiti UDM-Pro → USW-Pro-24-PoE → U6 Pro access points',
      slots: {
        router:      ['UI-UDM-PRO'],
        core_switch: ['UI-USW-PRO-24-POE'],
        wap:         ['UI-U6-PRO-1', 'UI-U6-PRO-2', 'UI-U6-PRO-3', 'UI-U6-PRO-4'],
      },
    },

  };

  // ─── Supabase helpers ────────────────────────────────────────────────────────

  async function _sbFetch(path, opts = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const res = await fetch(url, {
      ...opts,
      headers: {
        apikey:          SUPABASE_ANON,
        Authorization:   `Bearer ${SUPABASE_ANON}`,
        'Content-Type':  'application/json',
        Prefer:          opts.prefer || 'return=representation',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${path} — ${body}`);
    }
    return res.json().catch(() => null);
  }

  // ─── Library integration ──────────────────────────────────────────────────────

  /**
   * Return Library blocks (from v_library_with_es) that can fill a given package
   * slot category.  Results are ordered es_ready DESC so ES-mapped blocks appear
   * first, then all other matching blocks.
   *
   * @param {string}  slotCategory  Slot category key from PACKAGE_TEMPLATES
   *                                e.g. 'amplifier', 'switch', 'projector'
   * @param {object}  [opts]
   * @param {boolean} [opts.esReadyOnly=false]  If true, only return blocks with
   *                  a confirmed ES mapping (es_ready = true).
   * @param {string}  [opts.serviceNn]  Filter to a specific Sonor service number
   *                  e.g. '02' for Multiroom Audio, '09' for Network.
   * @returns {Promise<object[]>}  Array of v_library_with_es rows, newest first.
   *
   * Usage:
   *   const amps = await es.getLibraryForSlot('amplifier');
   *   // → [{ block_code, label, device_model_id, es_ready, es_template_id, ... }, ...]
   *
   *   // In a slot picker — group by es_ready:
   *   const esReady = amps.filter(b => b.es_ready);   // show with ES badge
   *   const rest    = amps.filter(b => !b.es_ready);  // show without badge
   */
  async function getLibraryForSlot(slotCategory, opts = {}) {
    const codes = BLOCK_CATEGORY_MAP[slotCategory] || [];
    if (!codes.length) {
      console.warn(`[SonorEasySchematic] No Library category map for slot: ${slotCategory}`);
      return [];
    }

    // Build PostgREST OR filter: category.eq.AMP,category.eq.SRC,...
    const orFilter = codes.map(c => `category.eq.${encodeURIComponent(c)}`).join(',');
    let path = `v_library_with_es?or=(${orFilter})&order=es_ready.desc,label.asc`;

    if (opts.esReadyOnly) path += '&es_ready=eq.true';
    if (opts.serviceNn)   path += `&service_nn=eq.${encodeURIComponent(opts.serviceNn)}`;

    const rows = await _sbFetch(path);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Return all Library blocks for every slot in a package template, keyed by
   * slot ID.  Useful for populating a full slot-picker UI in one call.
   *
   * @param {string} packageId  e.g. 'audio-8zone'
   * @param {object} [opts]     Same options as getLibraryForSlot
   * @returns {Promise<object>} { slotId: block[], ... }
   *
   * Usage:
   *   const options = await es.getLibraryForPackage('audio-8zone');
   *   // → { streamer: [...], matrix: [...], amp: [...] }
   */
  async function getLibraryForPackage(packageId, opts = {}) {
    const pkg = PACKAGE_TEMPLATES[packageId];
    if (!pkg) throw new Error(`Unknown package: ${packageId}`);

    const entries = await Promise.all(
      Object.entries(pkg.slots).map(async ([slotId, slot]) => {
        const blocks = await getLibraryForSlot(slot.category, opts);
        return [slotId, blocks];
      })
    );

    return Object.fromEntries(entries);
  }

  // ─── Mapping lookup ──────────────────────────────────────────────────────────

  async function getMappings(modelIds) {
    if (!modelIds || modelIds.length === 0) return new Map();
    const ids = modelIds.filter(Boolean);
    if (ids.length === 0) return new Map();
    const rows = await _sbFetch(
      `easyschematic_mappings?model_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`
    );
    const map = new Map();
    if (Array.isArray(rows)) rows.forEach(r => map.set(r.model_id, r));
    return map;
  }

  // ─── Port helpers ─────────────────────────────────────────────────────────────

  /**
   * Find the port ID (in-N or out-N) for the Nth occurrence of a signal type.
   * @param {object} mapping  Row from easyschematic_mappings
   * @param {'input'|'output'} direction
   * @param {string} signalType  e.g. 'hdmi', 'analog-audio', 'ethernet'
   * @param {number} occurrence  Which occurrence (0-indexed)
   * @returns {string}  e.g. 'in-2'
   */
  function _findPort(mapping, direction, signalType, occurrence = 0) {
    const types = direction === 'input'
      ? (mapping.signal_in_types  || [])
      : (mapping.signal_out_types || []);
    let seen = -1;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === signalType) {
        seen++;
        if (seen === occurrence) return `${direction === 'input' ? 'in' : 'out'}-${i}`;
      }
    }
    // Fallback: first port of the direction if no type match
    return `${direction === 'input' ? 'in' : 'out'}-0`;
  }

  /**
   * Build connection objects from a package wiring spec and resolved slot nodes.
   *
   * @param {object[]} wiringSpec  Array of wiring entries from PACKAGE_TEMPLATES
   * @param {object}   slotNodes  { slotId: [ nodeObj, ... ] }
   * @param {Map}      mappings   model_id → mapping row
   * @returns {object[]}          Connection objects
   */
  function _resolveWiring(wiringSpec, slotNodes, mappings) {
    const connections = [];
    let connIdx = 0;

    wiringSpec.forEach(wire => {
      const fromNodes = slotNodes[wire.from] || [];
      const toNodes   = slotNodes[wire.to]   || [];
      if (!fromNodes.length || !toNodes.length) return;

      const strategy = wire.strategy || 'first';
      const signal   = wire.signal;

      if (strategy === 'first') {
        // Connect node[0] of from to node[0] of to
        const src = fromNodes[0];
        const dst = toNodes[0];
        const srcMap = mappings.get(src.model_id) || {};
        const dstMap = mappings.get(dst.model_id) || {};
        connections.push({
          id:         `pkg-conn-${connIdx++}`,
          from:       { deviceId: src._nodeId, portId: _findPort(srcMap, 'output', signal) },
          to:         { deviceId: dst._nodeId, portId: _findPort(dstMap, 'input',  signal) },
          signalType: signal,
          label:      wire.label || null,
        });

      } else if (strategy === 'parallel') {
        // Connect from[i] → to[i] (by matching index)
        const count = Math.min(fromNodes.length, toNodes.length);
        for (let i = 0; i < count; i++) {
          const src = fromNodes[i];
          const dst = toNodes[i];
          const srcMap = mappings.get(src.model_id) || {};
          const dstMap = mappings.get(dst.model_id) || {};
          connections.push({
            id:         `pkg-conn-${connIdx++}`,
            from:       { deviceId: src._nodeId, portId: _findPort(srcMap, 'output', signal, i) },
            to:         { deviceId: dst._nodeId, portId: _findPort(dstMap, 'input',  signal, 0) },
            signalType: signal,
            label:      wire.label ? `${wire.label} ${i + 1}` : null,
          });
        }

      } else if (strategy === 'fan-out') {
        // Connect from[0] to every to[i], OR from[i] to cumulative to ports
        if (fromNodes.length === 1) {
          // Single source to all targets
          const src = fromNodes[0];
          const srcMap = mappings.get(src.model_id) || {};
          toNodes.forEach((dst, i) => {
            const dstMap = mappings.get(dst.model_id) || {};
            connections.push({
              id:         `pkg-conn-${connIdx++}`,
              from:       { deviceId: src._nodeId, portId: _findPort(srcMap, 'output', signal, i) },
              to:         { deviceId: dst._nodeId, portId: _findPort(dstMap, 'input',  signal, 0) },
              signalType: signal,
              label:      wire.label ? `${wire.label} → Zone ${i + 1}` : null,
            });
          });
        } else {
          // Multiple sources fanning out to multiple targets (round-robin)
          toNodes.forEach((dst, i) => {
            const src = fromNodes[i % fromNodes.length];
            const srcMap = mappings.get(src.model_id) || {};
            const dstMap = mappings.get(dst.model_id) || {};
            connections.push({
              id:         `pkg-conn-${connIdx++}`,
              from:       { deviceId: src._nodeId, portId: _findPort(srcMap, 'output', signal, Math.floor(i / fromNodes.length)) },
              to:         { deviceId: dst._nodeId, portId: _findPort(dstMap, 'input',  signal, 0) },
              signalType: signal,
              label:      wire.label ? `${wire.label} ${i + 1}` : null,
            });
          });
        }
      }
    });

    return connections;
  }

  // ─── Layout helpers ──────────────────────────────────────────────────────────

  /**
   * Package layout — left-to-right signal flow, one column per slot order.
   * Devices within a slot are stacked vertically.
   *
   * @param {object}  pkg          Package template
   * @param {object}  slotNodes    { slotId: [nodeObj, ...] }
   * @param {number}  yBase        Y offset for this package (for stacking packages)
   * @returns {Map<string, {x,y}>} nodeId → position
   */
  function _packageLayout(pkg, slotNodes, yBase = 40) {
    const CARD_W = 160, CARD_H = 90, GAP_X = 100, GAP_Y = 30;
    const positions = new Map();

    // Sort slots by their order field
    const slotOrder = Object.entries(pkg.slots)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
      .map(([id]) => id);

    slotOrder.forEach((slotId, col) => {
      const nodes = slotNodes[slotId] || [];
      nodes.forEach((node, row) => {
        positions.set(node._nodeId, {
          x: 40 + col * (CARD_W + GAP_X),
          y: yBase + row * (CARD_H + GAP_Y),
        });
      });
    });

    return positions;
  }

  /**
   * Simple grid layout for flat device lists (no package structure).
   */
  function _autoLayout(devices) {
    const positions = new Map();
    const CARD_W = 160, CARD_H = 100, GAP_X = 60, GAP_Y = 40;
    const PER_ROW = 4;
    const groups = {};
    devices.forEach(d => {
      const g = d.service_nn || '00';
      (groups[g] = groups[g] || []).push(d);
    });
    let rowBase = 40;
    Object.keys(groups).sort().forEach(g => {
      const group = groups[g];
      group.forEach((d, i) => {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        positions.set(d._nodeId, {
          x: 40 + col * (CARD_W + GAP_X),
          y: rowBase + row * (CARD_H + GAP_Y),
        });
      });
      const rows = Math.ceil(group.length / PER_ROW);
      rowBase += rows * (CARD_H + GAP_Y) + 60;
    });
    return positions;
  }

  // ─── Node builder ────────────────────────────────────────────────────────────

  /**
   * Build an EasySchematic device node object from a raw device + mapping row.
   */
  function _buildNode(device, mapping, position) {
    const fallback  = CATEGORY_MAP[device.category] || device.category || 'Generic Device';
    const svcColour = SERVICE_COLOURS[device.service_nn] || '#888888';

    const signalIn  = mapping.signal_in_types  || [];
    const signalOut = mapping.signal_out_types || [];
    const connIn    = mapping.connector_in     || [];
    const connOut   = mapping.connector_out    || [];

    const inputs  = signalIn.map((sig, i) => ({
      id: `in-${i}`, label: connIn[i] || sig, signalType: sig, connector: connIn[i] || null, direction: 'input',
    }));
    const outputs = signalOut.map((sig, i) => ({
      id: `out-${i}`, label: connOut[i] || sig, signalType: sig, connector: connOut[i] || null, direction: 'output',
    }));

    return {
      id:            device._nodeId,
      templateId:    mapping.es_template_id   || null,
      category:      mapping.es_category      || fallback,
      label:         device.label || `${device.make || ''} ${device.model || ''}`.trim(),
      manufacturer:  device.make  || '',
      model:         device.model || '',
      quantity:      device._qty  || 1,
      serviceNn:     device.service_nn || null,
      // Service colour — used by EasySchematic and any Sonor diagram viewer
      color:          svcColour,
      backgroundColor: `${svcColour}1a`,   // 10% opacity fill
      borderColor:    svcColour,
      style: {
        color:           svcColour,
        backgroundColor: `${svcColour}1a`,
        borderColor:     svcColour,
        borderWidth:     2,
      },
      position,
      ports: { inputs, outputs },
      _sonor: {
        model_id:     device.model_id   || null,
        confidence:   mapping.confidence || 'pending',
        mapped_by:    mapping.mapped_by  || 'none',
        serviceColor: svcColour,
        slotId:       device._slotId    || null,
        packageId:    device._packageId || null,
      },
    };
  }

  // ─── Core generator (flat) ───────────────────────────────────────────────────

  /**
   * Generate an EasySchematic-compatible JSON from a flat device list.
   * Devices are grouped by service_nn and laid out in a grid.
   * No connections are auto-wired — use generatePackage() for wired signal chains.
   *
   * @param {object[]} devices  Each: { model_id, make, model, category, service_nn, [qty], [label] }
   * @param {object}   options  { title, projectId, sourceApp, includeAll, connections }
   * @returns {Promise<object>} EasySchematic JSON document
   */
  async function generate(devices, options = {}) {
    const {
      title       = 'Sonor Signal Flow',
      projectId   = null,
      sourceApp   = 'sonor',
      includeAll  = false,
      connections = [],
    } = options;

    const eligible = includeAll ? devices : devices.filter(d => !SKIP_CATEGORIES.has(d.category));

    // De-duplicate by model_id
    const deduped = [];
    const seen = new Map();
    eligible.forEach(d => {
      const key = d.model_id || `${d.make}-${d.model}`;
      if (seen.has(key)) {
        seen.get(key)._qty = (seen.get(key)._qty || 1) + (d.qty || 1);
      } else {
        const node = { ...d, _nodeId: `node-${deduped.length}`, _qty: d.qty || 1 };
        seen.set(key, node);
        deduped.push(node);
      }
    });

    const modelIds = deduped.map(d => d.model_id).filter(Boolean);
    const mappings = await getMappings(modelIds);
    const positions = _autoLayout(deduped);

    const esDevices = deduped.map(d => {
      const mapping = mappings.get(d.model_id) || {};
      return _buildNode(d, mapping, positions.get(d._nodeId) || { x: 0, y: 0 });
    });

    const esConnections = connections.map((c, i) => ({
      id: `conn-${i}`,
      from: { deviceId: c.fromId, portId: c.fromPort },
      to:   { deviceId: c.toId,   portId: c.toPort   },
      signalType: c.signalType || 'unknown',
      label:      c.label || null,
    }));

    return _assembleDiagram({ title, projectId, sourceApp, esDevices, esConnections });
  }

  // ─── Package generator ───────────────────────────────────────────────────────

  /**
   * Generate a wired EasySchematic diagram for a single package topology.
   *
   * Slots are positioned left-to-right (signal flow direction).
   * Devices in each slot are stacked vertically.
   * Connections are auto-wired by signal type according to the package wiring spec.
   *
   * @param {string} packageId  Key in PACKAGE_TEMPLATES (e.g. 'audio-16zone')
   * @param {object} slots      { slotId: string[] }  model_id per device in each slot
   *   Slot devices are looked up in easyschematic_mappings for port data.
   *   Devices without a Supabase mapping get a generic node with the slot's category.
   * @param {object} options    { title, projectId, sourceApp, yBase, extraConnections }
   * @returns {Promise<object>} EasySchematic JSON document
   */
  async function generatePackage(packageId, slots, options = {}) {
    const pkg = PACKAGE_TEMPLATES[packageId];
    if (!pkg) throw new Error(`Unknown package: ${packageId}. Available: ${Object.keys(PACKAGE_TEMPLATES).join(', ')}`);

    const {
      title             = pkg.label,
      projectId         = null,
      sourceApp         = 'sonor',
      yBase             = 40,
      extraConnections  = [],
    } = options;

    // 1. Collect all model IDs across all slots
    const allModelIds = Object.values(slots).flat().filter(Boolean);
    const mappings = await getMappings(allModelIds);

    // 2. Build node objects per slot
    const slotNodes = {};
    let nodeIdx = 0;
    const slotSpec = pkg.slots;

    Object.entries(slotSpec)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
      .forEach(([slotId, spec]) => {
        const slotModelIds = slots[slotId] || [];
        slotNodes[slotId] = slotModelIds.map(modelId => {
          const mapping = mappings.get(modelId) || {};
          const category = mapping.es_category ? spec.category : spec.category;
          return {
            model_id:    modelId,
            make:        '',
            model:       modelId,
            category:    spec.category,
            service_nn:  pkg.service_nn,
            _nodeId:     `pkg-${packageId}-${slotId}-${nodeIdx++}`,
            _qty:        1,
            _slotId:     slotId,
            _packageId:  packageId,
          };
        });
      });

    // 3. Compute layout positions
    const positions = _packageLayout(pkg, slotNodes, yBase);

    // 4. Build device nodes
    const esDevices = [];
    Object.values(slotNodes).forEach(nodes => {
      nodes.forEach(device => {
        const mapping = mappings.get(device.model_id) || {};
        esDevices.push(_buildNode(device, mapping, positions.get(device._nodeId) || { x: 0, y: 0 }));
      });
    });

    // 5. Resolve wiring
    const autoConnections = _resolveWiring(pkg.wiring, slotNodes, mappings);
    const esConnections = [
      ...autoConnections,
      ...extraConnections.map((c, i) => ({
        id: `extra-conn-${i}`,
        from: { deviceId: c.fromId, portId: c.fromPort },
        to:   { deviceId: c.toId,   portId: c.toPort   },
        signalType: c.signalType || 'unknown',
        label:      c.label || null,
      })),
    ];

    return _assembleDiagram({ title, projectId, sourceApp, esDevices, esConnections, packageId, packageColor: pkg.color });
  }

  // ─── Multi-package generator ─────────────────────────────────────────────────

  /**
   * Generate a single diagram containing multiple packages stacked vertically.
   * Each package gets its own labelled section in signal-flow order (L→R per package).
   *
   * @param {object[]} packages  Array of { id, slots, [label] }
   *   id     {string}  Package key in PACKAGE_TEMPLATES
   *   slots  {object}  { slotId: model_id[] }
   *   label  {string}  Optional override for section label
   * @param {object}   options   { title, projectId, sourceApp }
   * @returns {Promise<object>}  EasySchematic JSON document
   */
  async function generateMultiPackage(packages, options = {}) {
    const {
      title      = 'Sonor Full System Schematic',
      projectId  = null,
      sourceApp  = 'sonor',
    } = options;

    // Collect all model IDs in one batch fetch
    const allModelIds = packages.flatMap(p => Object.values(p.slots || {}).flat()).filter(Boolean);
    const mappings = await getMappings(allModelIds);

    const PACKAGE_GAP_Y = 80;
    const CARD_H = 90, GAP_Y = 30;

    let yBase = 40;
    const allDevices    = [];
    const allConnections = [];
    let nodeIdx = 0;

    for (const pkgConfig of packages) {
      const pkg = PACKAGE_TEMPLATES[pkgConfig.id];
      if (!pkg) { console.warn(`SonorEasySchematic: unknown package "${pkgConfig.id}" — skipped`); continue; }

      const slots = pkgConfig.slots || {};

      // Build slot nodes
      const slotNodes = {};
      Object.entries(pkg.slots)
        .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
        .forEach(([slotId, spec]) => {
          const slotModelIds = slots[slotId] || [];
          slotNodes[slotId] = slotModelIds.map(modelId => ({
            model_id:   modelId,
            make:       '',
            model:      modelId,
            category:   spec.category,
            service_nn: pkg.service_nn,
            _nodeId:    `mp-${pkgConfig.id}-${slotId}-${nodeIdx++}`,
            _qty:       1,
            _slotId:    slotId,
            _packageId: pkgConfig.id,
          }));
        });

      // Layout within this package block
      const positions = _packageLayout(pkg, slotNodes, yBase);

      // Build device nodes
      Object.values(slotNodes).forEach(nodes => {
        nodes.forEach(device => {
          const mapping = mappings.get(device.model_id) || {};
          allDevices.push(_buildNode(device, mapping, positions.get(device._nodeId) || { x: 0, y: yBase }));
        });
      });

      // Wire connections
      allConnections.push(..._resolveWiring(pkg.wiring, slotNodes, mappings));

      // Advance Y for next package — find tallest slot
      const maxSlotHeight = Math.max(
        ...Object.values(slotNodes).map(nodes => nodes.length * (CARD_H + GAP_Y))
      );
      yBase += maxSlotHeight + PACKAGE_GAP_Y;
    }

    return _assembleDiagram({ title, projectId, sourceApp, esDevices: allDevices, esConnections: allConnections });
  }

  // ─── Diagram assembly ────────────────────────────────────────────────────────

  function _assembleDiagram({ title, projectId, sourceApp, esDevices, esConnections, packageId, packageColor }) {
    return {
      _schema:   'sonor-easyschematic',
      version:   '1.0',
      generated: new Date().toISOString(),
      meta: {
        title,
        projectId,
        sourceApp,
        sonorVersion:  VERSION,
        deviceCount:   esDevices.length,
        connectionCount: esConnections.length,
        packageId:     packageId  || null,
        packageColor:  packageColor || null,
      },
      devices:     esDevices,
      connections: esConnections,
      layout: {
        autoLayout:     true,
        groupByService: !packageId,
        signalFlow:     !!packageId,
        direction:      'left-to-right',
      },
    };
  }

  // ─── Persistence (Supabase) ──────────────────────────────────────────────────

  async function save(diagramJson, meta = {}) {
    const {
      projectId  = diagramJson.meta?.projectId || null,
      sourceApp  = diagramJson.meta?.sourceApp || 'manual',
      sourceRef  = null,
      title      = diagramJson.meta?.title || 'Untitled Schematic',
      notes      = null,
      createdBy  = 'sonor-app',
    } = meta;

    let revision = 1;
    if (projectId) {
      const existing = await _sbFetch(
        `easyschematic_diagrams?project_id=eq.${encodeURIComponent(projectId)}&select=revision&order=revision.desc&limit=1`
      );
      if (Array.isArray(existing) && existing.length > 0) {
        revision = (existing[0].revision || 0) + 1;
      }
    }

    const modelIds = (diagramJson.devices || []).map(d => d._sonor?.model_id).filter(Boolean);
    const mappingRows = await getMappings(modelIds);
    const mappingSnapshot = {};
    mappingRows.forEach((v, k) => { mappingSnapshot[k] = v; });

    const row = {
      project_id:       projectId,
      source_app:       sourceApp,
      source_ref:       sourceRef,
      title,
      revision,
      diagram_json:     diagramJson,
      devices_used:     modelIds,
      mapping_snapshot: mappingSnapshot,
      created_by:       createdBy,
      notes,
    };

    const saved = await _sbFetch('easyschematic_diagrams', {
      method: 'POST',
      prefer: 'return=representation',
      body:   JSON.stringify(row),
    });
    return Array.isArray(saved) ? saved[0] : saved;
  }

  async function load(projectId, opts = {}) {
    if (!projectId) return null;
    let path = `easyschematic_diagrams?project_id=eq.${encodeURIComponent(projectId)}&order=revision.desc&limit=1`;
    if (opts.revision)  path += `&revision=eq.${opts.revision}`;
    if (opts.sourceApp) path += `&source_app=eq.${opts.sourceApp}`;
    const rows = await _sbFetch(path);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  async function listRevisions(projectId) {
    if (!projectId) return [];
    const rows = await _sbFetch(
      `easyschematic_diagrams?project_id=eq.${encodeURIComponent(projectId)}&select=id,title,revision,source_app,source_ref,devices_used,created_at,updated_at&order=revision.desc`
    );
    return Array.isArray(rows) ? rows : [];
  }

  // ─── Example seeding ─────────────────────────────────────────────────────────

  /**
   * Generate and save all EXAMPLES to Supabase under project_id 'example-*'.
   * Idempotent — skips examples already saved.
   * Call once from the Library app or a setup screen to seed demo diagrams.
   *
   * @returns {Promise<{ saved, skipped, errors }>}
   */
  async function saveExamples() {
    const results = { saved: [], skipped: [], errors: [] };

    for (const [exampleId, ex] of Object.entries(EXAMPLES)) {
      try {
        // Skip if already saved
        const existing = await load(exampleId, { sourceApp: 'example' });
        if (existing) { results.skipped.push(exampleId); continue; }

        const json = await generatePackage(ex.packageId, ex.slots, {
          title:     ex.title,
          projectId: exampleId,
          sourceApp: 'example',
        });

        await save(json, {
          projectId: exampleId,
          sourceApp: 'example',
          title:     ex.title,
          notes:     ex.description,
          createdBy: 'sonor-easyschematic-examples',
        });
        results.saved.push(exampleId);
      } catch (e) {
        results.errors.push({ id: exampleId, error: e.message });
      }
    }
    return results;
  }

  // ─── Download ─────────────────────────────────────────────────────────────────

  function download(diagramJson, filename = 'sonor-schematic.json') {
    const blob = new Blob([JSON.stringify(diagramJson, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Coverage helper ─────────────────────────────────────────────────────────

  async function mappingCoverage(modelIds) {
    const map = await getMappings(modelIds);
    const summary = { total: modelIds.length, exact: 0, close: 0, generic: 0, pending: 0, skip: 0, unmapped: 0 };
    modelIds.forEach(id => {
      const m = map.get(id);
      if (!m) { summary.unmapped++; return; }
      summary[m.confidence] = (summary[m.confidence] || 0) + 1;
    });
    return summary;
  }

  // ─── Package listing ─────────────────────────────────────────────────────────

  /**
   * Return all available package templates as an array (sorted by service_nn).
   * Each entry has: { id, label, service_nn, color, description, slotCount }.
   */
  function listPackages() {
    return Object.entries(PACKAGE_TEMPLATES)
      .map(([id, pkg]) => ({
        id,
        label:       pkg.label,
        service_nn:  pkg.service_nn,
        color:       pkg.color,
        description: pkg.description,
        slotCount:   Object.keys(pkg.slots).length,
        slots:       Object.fromEntries(
          Object.entries(pkg.slots).map(([k, v]) => [k, { label: v.label, category: v.category, count: v.count, preferred: v.preferred }])
        ),
      }))
      .sort((a, b) => a.service_nn.localeCompare(b.service_nn));
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    VERSION,
    SERVICE_COLOURS,
    CATEGORY_MAP,
    BLOCK_CATEGORY_MAP,
    SKIP_CATEGORIES,
    PACKAGE_TEMPLATES,
    EXAMPLES,

    // Mapping
    getMappings,
    mappingCoverage,

    // Library integration (v_library_with_es seam)
    getLibraryForSlot,    // blocks for one slot category → slot picker
    getLibraryForPackage, // blocks for every slot in a package → full picker UI

    // Generation
    generate,             // Flat device list → diagram (no wiring)
    generatePackage,      // Single package → wired diagram
    generateMultiPackage, // Multiple packages → combined wired diagram

    // Packages
    listPackages,

    // Persistence
    save,
    load,
    listRevisions,
    saveExamples,

    // Download
    download,
  };

})();
