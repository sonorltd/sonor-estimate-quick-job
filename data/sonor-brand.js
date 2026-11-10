// Sonor Brand Config — shared across all apps
// Source of truth: brand-core.xml → Supabase brand_config → this file
// Load via <script src="../data/sonor-brand.js"> BEFORE app script
// Apps read window.__SONOR_BRAND__ — never hardcode these values
//
// To update: edit brand-core.xml → run generate-brand.py → update this file
// Or: read from Supabase brand_config table at Phase 2 init

window.__SONOR_BRAND__ = {
  version: "1.0.0",

  // ── Company ──────────────────────────────────────────
  company: {
    name:     "Sonor Smart Homes",
    legal:    "Sonor Ltd",
    tagline:  "Smart homes, beautifully done",
    trustLine:"Trusted by homeowners across the North West & Wales",
    location: "Chester, England",
    url:      "https://sonor.co.uk",
    phone:    "07933 684 000",
    email:    "projects@sonor.co.uk",
    office:   "office@sonor.co.uk",
    phoneSupport: "07933 684 000",
    emailSupport: "service@sonor.co.uk"
  },

  // ── 10 Services (permanent — never reassign) ─────────
  services: [
    { nn: "01", hex: "#8058a1", colour: "Purple",    brand: "Home Cinema",       client: "Cinema & Media",            core: "01 Cinema",         badge: "Cinema"      },
    { nn: "02", hex: "#4bb9d3", colour: "Aqua",      brand: "Multiroom Audio",   client: "Multiroom Audio",           core: "02 Audio",          badge: "Audio"       },
    { nn: "03", hex: "#78ba57", colour: "Green",      brand: "TV Everywhere",     client: "TV & Video",                core: "03 Video",          badge: "Video"       },
    { nn: "04", hex: "#f5d05c", colour: "Yellow",     brand: "Smart Lighting",    client: "Smart Lighting",            core: "04 Lighting",       badge: "Lighting"    },
    { nn: "05", hex: "#e37c59", colour: "Terracotta", brand: "Home Automation",   client: "Home Automation",           core: "05 Automation",     badge: "Automation"  },
    { nn: "06", hex: "#ec6061", colour: "Red",        brand: "Climate",           client: "Climate",                   core: "06 HVAC",           badge: "Climate"     },
    { nn: "07", hex: "#e67eb1", colour: "Pink",       brand: "Control",           client: "Control",                   core: "07 Control",        badge: "Control"     },
    { nn: "08", hex: "#ad9978", colour: "Gold",       brand: "CCTV & Security",   client: "CCTV, Security & Access",   core: "08 Security",       badge: "Security"    },
    { nn: "09", hex: "#b7b1a7", colour: "Silver",     brand: "Whole Home WiFi",   client: "WiFi & Data",               core: "09 Network",        badge: "WiFi"        },
    { nn: "10", hex: "#302f2e", colour: "Charcoal",   brand: "Design & Cabling",  client: "Infrastructure",            core: "10 Infrastructure", badge: "Structure"   }
  ],

  // ── Earthy Theme (locked — from brand-core.xml) ──────
  theme: {
    body:        "#F2EDE5",
    section1:    "#EDE6D9",
    section2:    "#CFC5B2",
    clay:        "#D9CFC0",
    textPrimary: "#2C2218",
    textSecondary:"#5a4e3e",
    textMuted:   "#8B7D6B",
    footerBg:    "#141008",
    ctaBg:       "#1e1810",
    accent:      "#2d718b",
    accentLight: "#4bb9d3",
    border:      "rgba(44,34,24,0.12)",
    borderStrong:"rgba(44,34,24,0.22)"
  },

  // ── Partners (trade associations + platform brands) ──
  partners: [
    { name: "Control4",     role: "Home automation & control platform", level: "Gold Dealer" },
    { name: "Lutron",       role: "Lighting control & shading systems", level: "Dealer" },
    { name: "CEDIA Member", role: "Custom Electronic Design & Installation Association", level: "Member" }
  ],

  // ── Personnel ────────────────────────────────────────
  personnel: [
    { name: "Bryn Bradley",  role: "Director", email: "bryn@sonor.co.uk" },
    { name: "Phil Bradley",  role: "Director", email: "phil@sonor.co.uk" },
    { name: "Mark Rimmer",   role: "Lead Engineer", email: "mark@sonor.co.uk" }
  ],

  // ── Fleet (vehicles) ─────────────────────────────────
  // Canonical list — mirrors brand-core.xml <vehicles>. Every app referencing
  // a van (Inventory, Accounts, Portal, RAMS, etc.) reads from here.
  // Keyed by van_code. Do NOT add SV3+ without Bryn explicitly confirming.
  vehicles: [
    { van_code: "SV1", reg: "CX67XEK", driver_slug: "bryn", driver_name: "Bryn Bradley", active: true, description: "Bryn's van" },
    { van_code: "SV2", reg: "S90NOR",  driver_slug: "mark", driver_name: "Mark",         active: true, description: "Mark's van" }
  ],

  // ── Contact contexts (which email/phone for which purpose) ──
  contacts: [
    { context: "Office",       usage: "Website, proposals, correspondence", phone: "07933 684 000", email: "projects@sonor.co.uk" },
    { context: "Support",      usage: "Client support, service calls",      phone: "07933 684 000", email: "service@sonor.co.uk" },
    { context: "General Docs", usage: "RAMS, formal documents",             phone: "07933 684 000", email: "office@sonor.co.uk" }
  ],

  // ── Fonts (by context) ──────────────────────────────
  fonts: {
    web:   { primary: "DM Sans", mono: "DM Mono", source: "Google Fonts" },
    print: { primary: "Gilroy",  weights: ["Heavy","Bold","Medium","Regular","Light"], source: "Local TTF" }
  },

  // ── App URLs (from Supabase app_versions) ───────────
  // Used by setAppSource() in all apps to switch between Drive and GitHub Pages
  appUrls: {
    local: {
      master:      './index.html',
      pm:          '../APP - Project Master/sonor-project-master.html',
      takeoffs:    '../APP - Takeoffs/sonor-takeoffs.html',
      takeoffsSite: '../APP - Takeoffs/site.html',   // read-only site view (Takeoffs v5.263.0+)
      netmap:      '../APP - Network Map/sonor-network-map.html',
      rams:        '../APP - RAMS Generator/sonor-rams-generator.html',
      leads:       '../APP - Leads/dashboard/sonor-leads.html',
      accounts:    '../APP - Accounts/dashboard/sonor-accounts.html',
      printworkwear: '../APP - Print & Workwear/dashboard/sonor-print-workwear.html',
      packs:       '../APP - Packs/dashboard/sonor-packs.html',
      cinema:         '../APP - Cinema Design/dashboard/sonor-cinema.html',
      cinemaTakeoff:  '../APP - Cinema Design/index.html?tab=takeoff',
      'cinema-takeoff': '../APP - Cinema Takeoff/index.html',
      engineering: '../APP - Engineering/index.html',
      'studio-hub': '../STUDIO - Hub/studio-hub.html',
      cinecacfg:   '../sonor-cineca/index.html',
      portal:      '../APP - Portal/dashboard/sonor-portal.html',
      inventory:   '../APP - Inventory/dashboard/sonor-inventory.html',
      email:       '../APP - Leads/dashboard/email-preview.html',
      webHome:     '../Website - WIP/index.html',
      webAbout:    '../Website - WIP/about.html',
      webPrice:    '../Website - WIP/pricing.html',
      swatches:    '../Branding - CORE/brand-swatches.html',
      tools:       '../Branding - CORE/brand-tools.html',
      subcontractors: 'subcontractors.html',
      board:       'board.html',
      dmx:         'https://github.com/sonorltd/sonor-dmx',
      wled:        'https://github.com/sonorltd/sonor-wled',
      arduino:     'https://github.com/sonorltd/sonor-arduino',
      resDatasheets: '../HUB - Resources/datasheets/product-datasheets.html',
      workshop:    '../sonor-workshop/dashboard/sonor-workshop.html',
      library:     '../APP - Library/sonor-library.html',
      tasks:       '../APP - Tasks/sonor-tasks.html',
      studio:      '../STUDIO - Hub/studio-hub.html',
      studioPortal:'../STUDIO - Hub/studio-portal.html',
      flyers:      '../MARKETING - Flyers/index.html',
      followup:    '../APP - Follow-Up Portal/dashboard/sonor-followup.html',
      tender:      '../APP - Tender/sonor-tender.html',
      seating:     '../APP - Seating Configurator/dashboard/sonor-seating.html',
      'cinema-aesthetic': '../APP - Cinema Aesthetic/dashboard/sonor-cinema-aesthetic.html',
      'lighting-design': '../APP - Lighting Design/dashboard/sonor-lighting-design.html',
      'garden-lighting': '../APP - Garden Lighting/dashboard/sonor-garden-lighting.html',
      'stretched-fabric': '../APP - Stretched Fabric/dashboard/sonor-stretched-fabric.html',
      'media-wall': '../APP - Media Wall/dashboard/sonor-media-wall.html',
      survey: '../APP - Survey/dashboard/sonor-survey.html',
      site: '../APP - Site/dashboard/sonor-site.html',
      'fractal-rig':     '../STUDIO - Fractal Rig/web/index.html',
      'elf-machine':     '../STUDIO - Elf Machine/web/index.html',
      crystowl:          '../STUDIO - Crystowl/index.html',
      'crystowl-plugins': '../STUDIO - Crystowl/plugins/index.html',
      'crystal-delay':   '../STUDIO - Crystowl/plugins/crystal-delay/index.html',
      'spectral-delay':  '../STUDIO - Crystowl/plugins/spectral-delay/index.html',
      riser:             '../STUDIO - Crystowl/plugins/riser/index.html',
      'prism-filter':     '../STUDIO - Crystowl/plugins/prism-filter/index.html',
      'glacier-reverb':   '../STUDIO - Crystowl/plugins/glacier-reverb/index.html',
      'quartz-drive':     '../STUDIO - Crystowl/plugins/quartz-drive/index.html',
      'geode-glue':       '../STUDIO - Crystowl/plugins/geode-glue/index.html',
      'aurora-chorus':    '../STUDIO - Crystowl/plugins/aurora-chorus/index.html',
      'tide-pump':        '../STUDIO - Crystowl/plugins/tide-pump/index.html',
      shard:              '../STUDIO - Crystowl/plugins/shard/index.html',
      'group-planner':    '../STUDIO - Crystowl/ableton/group-planner/index.html',
      'song-builder':     '../STUDIO - Crystowl/ableton/song-builder/index.html',
      'db-shifter':       '../STUDIO - Crystowl/ableton/db-shifter/index.html',
      'bus-chains':       '../STUDIO - Crystowl/ableton/bus-chains/index.html',
      'korg-m1':          '../STUDIO - Crystowl/hardware/korg-m1/index.html',
      'midi-map':         '../STUDIO - Crystowl/hardware/midi-map/index.html',
      'studio-map':       '../STUDIO - Crystowl/hardware/studio-map/index.html',
      'avb-map':          '../STUDIO - Crystowl/hardware/avb-map/index.html',
      'gear-library':     '../STUDIO - Crystowl/hardware/gear-library/index.html',
      'plugin-library':   '../STUDIO - Crystowl/hardware/plugin-library/index.html',
      lighting:           '../STUDIO - Crystowl/hardware/lighting/index.html',
      'plugin-research': '../STUDIO - Hub/docs/plugins-ableton-research.html',
      'sacred-missions': '../STUDIO - Sacred Missions Map/index.html',
      'missions-archive': '../STUDIO - Missions Archive/index.html',
      'pixel-conductor': '../STUDIO - Pixel Conductor/web/index.html',
      'artnet-node':     '../STUDIO - ArtNet Node/index.html',
      cbus:              '../APP - C-Bus/index.html',
      'cinema-tools': '../APP - Cinema Tools/dashboard/sonor-cinema-tools.html',
      // 2026-10-12 Hub audit — keys the Hub cards use that had no hosted entry (404'd on Pages, URL law)
      workmats:    '../PRINT - Work Mats/output/',
      bizcards:    '../PRINT - Biz Cards/output/',
      rackplates:  '../PRINT - Rack Plates/output/',
      stickers:    '../PRINT - Stickers/output/',
      igcards:     '../IG Cards - WIP/',
      resPinouts:  '../HUB - Resources/pinouts/connector-cheat-sheet.html',
      resRacks:    '../HUB - Resources/racks/rack-best-practices.html',
      resCabling:  '../HUB - Resources/cabling/av-cabling-guide.html',
      resNetwork:  '../HUB - Resources/networking/av-networking-guide.html',
      resXeroApi:  '../HUB - Resources/xero-api/index.html',
      resWqApi:    'https://github.com/sonorltd/sonor-wq-api',
      landingPages:   'landing-pages.html',
      gbpPhotos:      'gbp-photos.html',
      emailTemplates: 'email-templates.html',
      manufacturers:  'manufacturers.html',
      c4Demo:         'c4-demo.html',
      igstrategy:     'ig-strategy.html',
      listrategy:     'li-strategy.html',
      business:       'business-snapshot.html',
      audit:          'audit-snapshot.html',
      health:         'health.html',
      kit:            '../sonor-kit/catalogue/index.html',
      partners:       '../HUB - Partners/index.html',
      'service-contracts': '../APP - Service Contracts/dashboard/sonor-service-contracts.html',
      takeover:       '../APP - Takeover/dashboard/sonor-takeover.html',
      'estimate-cinema': '../APP - ESTIMATE - Cinema/dashboard/sonor-estimate-cinema.html',   // B-809
      'estimate-media-wall': '../APP - ESTIMATE - Media Wall/dashboard/sonor-estimate-media-wall.html',   // B-809
      'estimate-media-room': '../APP - ESTIMATE - Media Room/dashboard/sonor-estimate-media-room.html',   // B-809
      'estimate-whole-home': '../APP - ESTIMATE - Whole House/dashboard/sonor-estimate-whole-home.html',   // B-809
      'led-calc':     '../APP - LED Calc/dashboard/sonor-led-calc.html',
      'knx-panel':    '../APP - KNX Panel Builder/dashboard/sonor-knx-panel.html',
      'c4-integration': '../APP - C4 Integration/dashboard/sonor-c4-integration.html',
      'power-map':    '../APP - Power Map/dashboard/sonor-power-map.html'
    },
    hosted: {
      master:      'https://apps.sonor.co.uk/sonor-master/',
      pm:          'https://apps.sonor.co.uk/sonor-project-master/',
      takeoffs:    'https://apps.sonor.co.uk/sonor-takeoffs/',
      takeoffsSite: 'https://apps.sonor.co.uk/sonor-takeoffs/site.html',   // read-only site view (Takeoffs v5.263.0+)
      netmap:      'https://apps.sonor.co.uk/sonor-network-map/',
      rams:        'https://apps.sonor.co.uk/sonor-rams/',
      leads:       'https://apps.sonor.co.uk/sonor-leads/',
      accounts:    'https://apps.sonor.co.uk/sonor-accounts/',
      printworkwear: 'https://apps.sonor.co.uk/sonor-print-workwear/',
      packs:       'https://apps.sonor.co.uk/sonor-packs/',
      cinema:         'https://apps.sonor.co.uk/sonor-cinema/',
      cinemaTakeoff:  'https://apps.sonor.co.uk/sonor-cinema/?tab=takeoff',
      'cinema-takeoff': 'https://apps.sonor.co.uk/sonor-cinema-takeoff/',
      engineering: 'https://apps.sonor.co.uk/sonor-engineering/',
      'studio-hub': 'https://apps.sonor.co.uk/sonor-studio/',
      cinecacfg:   'https://apps.sonor.co.uk/sonor-cineca/',
      portal:      'https://apps.sonor.co.uk/sonor-portal/',
      inventory:   'https://apps.sonor.co.uk/sonor-inventory/',
      email:       'https://apps.sonor.co.uk/sonor-leads/dashboard/email-preview.html',
      webHome:     'https://apps.sonor.co.uk/sonor-website/',
      webAbout:    'https://apps.sonor.co.uk/sonor-website/about.html',
      webPrice:    'https://apps.sonor.co.uk/sonor-website/pricing.html',
      swatches:    'https://apps.sonor.co.uk/sonor-brand/brand-swatches.html',
      tools:       'https://apps.sonor.co.uk/sonor-brand/brand-tools.html',
      subcontractors: 'https://apps.sonor.co.uk/sonor-master/subcontractors.html',
      board:        'https://apps.sonor.co.uk/sonor-master/board.html',
      dmx:          'https://github.com/sonorltd/sonor-dmx',
      wled:         'https://github.com/sonorltd/sonor-wled',
      arduino:      'https://github.com/sonorltd/sonor-arduino',
      resDatasheets: 'https://apps.sonor.co.uk/sonor-resources/datasheets/product-datasheets.html',
      workshop:    'https://apps.sonor.co.uk/sonor-workshop/',
      library:     'https://apps.sonor.co.uk/sonor-library/',
      tasks:       'https://apps.sonor.co.uk/sonor-tasks/',
      studio:      'https://apps.sonor.co.uk/sonor-studio/',
      studioPortal:'https://sonorltd.github.io/sonor-studio/studio-portal.html',
      flyers:      'https://apps.sonor.co.uk/sonor-flyers/',
      followup:    'https://apps.sonor.co.uk/sonor-followup-portal/',
      tender:      'https://apps.sonor.co.uk/sonor-tender/',
      seating:     'https://apps.sonor.co.uk/sonor-seating/',
      'cinema-aesthetic': 'https://apps.sonor.co.uk/sonor-cinema-aesthetic/',
      'lighting-design': 'https://apps.sonor.co.uk/sonor-lighting-design/',
      'garden-lighting': 'https://apps.sonor.co.uk/sonor-garden-lighting/',
      'stretched-fabric': 'https://apps.sonor.co.uk/sonor-stretched-fabric/',
      'media-wall': 'https://apps.sonor.co.uk/sonor-media-wall/',
      survey: 'https://apps.sonor.co.uk/sonor-survey/',
      site: 'https://apps.sonor.co.uk/sonor-site/',
      'fractal-rig':     'https://apps.sonor.co.uk/sonor-fractal-rig/',
      'elf-machine':     'https://apps.sonor.co.uk/sonor-elf-machine/',
      crystowl:          'https://apps.sonor.co.uk/sonor-crystowl/',
      'crystowl-plugins': 'https://studio.sonor.co.uk/plugins/',
      'crystal-delay':   'https://apps.sonor.co.uk/sonor-crystowl/plugins/crystal-delay/',
      'spectral-delay':  'https://apps.sonor.co.uk/sonor-crystowl/plugins/spectral-delay/',
      riser:             'https://apps.sonor.co.uk/sonor-crystowl/plugins/riser/',
      'prism-filter':     'https://apps.sonor.co.uk/sonor-crystowl/plugins/prism-filter/',
      'glacier-reverb':   'https://apps.sonor.co.uk/sonor-crystowl/plugins/glacier-reverb/',
      'quartz-drive':     'https://apps.sonor.co.uk/sonor-crystowl/plugins/quartz-drive/',
      'geode-glue':       'https://apps.sonor.co.uk/sonor-crystowl/plugins/geode-glue/',
      'aurora-chorus':    'https://apps.sonor.co.uk/sonor-crystowl/plugins/aurora-chorus/',
      'tide-pump':        'https://apps.sonor.co.uk/sonor-crystowl/plugins/tide-pump/',
      shard:              'https://apps.sonor.co.uk/sonor-crystowl/plugins/shard/',
      'group-planner':    'https://apps.sonor.co.uk/sonor-crystowl/ableton/group-planner/',
      'song-builder':     'https://apps.sonor.co.uk/sonor-crystowl/ableton/song-builder/',
      'db-shifter':       'https://apps.sonor.co.uk/sonor-crystowl/ableton/db-shifter/',
      'bus-chains':       'https://apps.sonor.co.uk/sonor-crystowl/ableton/bus-chains/',
      'korg-m1':          'https://apps.sonor.co.uk/sonor-crystowl/hardware/korg-m1/',
      'midi-map':         'https://apps.sonor.co.uk/sonor-crystowl/hardware/midi-map/',
      'studio-map':       'https://apps.sonor.co.uk/sonor-crystowl/hardware/studio-map/',
      'avb-map':          'https://apps.sonor.co.uk/sonor-crystowl/hardware/avb-map/',
      'gear-library':     'https://apps.sonor.co.uk/sonor-crystowl/hardware/gear-library/',
      'plugin-library':   'https://apps.sonor.co.uk/sonor-crystowl/hardware/plugin-library/',
      lighting:           'https://apps.sonor.co.uk/sonor-crystowl/hardware/lighting/',
      'plugin-research': 'https://apps.sonor.co.uk/sonor-studio/docs/plugins-ableton-research.html',
      'sacred-missions': 'https://apps.sonor.co.uk/sonor-sacred-missions-map/',
      'missions-archive': 'https://apps.sonor.co.uk/sonor-missions-archive/',
      'pixel-conductor': 'https://apps.sonor.co.uk/sonor-pixel-conductor/',
      'artnet-node':     'https://apps.sonor.co.uk/sonor-artnet-node/',
      cbus:              'https://apps.sonor.co.uk/sonor-cbus/',
      'cinema-tools': 'https://apps.sonor.co.uk/sonor-cinema-tools/',
      // 2026-10-12 Hub audit — hosted forms for every Hub card key (repo-slug law; print = GitHub tree, renders PNGs inline)
      workmats:    'https://github.com/sonorltd/sonor-workmats/tree/main/output',
      bizcards:    'https://github.com/sonorltd/sonor-bizcards/tree/main/output',
      rackplates:  'https://github.com/sonorltd/sonor-rack-plates/tree/main/output',
      stickers:    'https://github.com/sonorltd/sonor-stickers/tree/main/output',
      igcards:     'https://github.com/sonorltd/sonor-ig-cards/tree/main',
      resPinouts:  'https://apps.sonor.co.uk/sonor-resources/pinouts/connector-cheat-sheet.html',
      resRacks:    'https://apps.sonor.co.uk/sonor-resources/racks/rack-best-practices.html',
      resCabling:  'https://apps.sonor.co.uk/sonor-resources/cabling/av-cabling-guide.html',
      resNetwork:  'https://apps.sonor.co.uk/sonor-resources/networking/av-networking-guide.html',
      resXeroApi:  'https://apps.sonor.co.uk/sonor-resources/xero-api/',
      resWqApi:    'https://github.com/sonorltd/sonor-wq-api',
      landingPages:   'https://apps.sonor.co.uk/sonor-master/landing-pages.html',
      gbpPhotos:      'https://apps.sonor.co.uk/sonor-master/gbp-photos.html',
      emailTemplates: 'https://apps.sonor.co.uk/sonor-master/email-templates.html',
      manufacturers:  'https://apps.sonor.co.uk/sonor-master/manufacturers.html',
      c4Demo:         'https://apps.sonor.co.uk/sonor-master/c4-demo.html',
      igstrategy:     'https://apps.sonor.co.uk/sonor-master/ig-strategy.html',
      listrategy:     'https://apps.sonor.co.uk/sonor-master/li-strategy.html',
      business:       'https://apps.sonor.co.uk/sonor-master/business-snapshot.html',
      audit:          'https://apps.sonor.co.uk/sonor-master/audit-snapshot.html',
      health:         'https://apps.sonor.co.uk/sonor-master/health.html',
      kit:            'https://apps.sonor.co.uk/sonor-kit/catalogue/',
      partners:       'https://apps.sonor.co.uk/sonor-partners/',
      'service-contracts': 'https://apps.sonor.co.uk/sonor-service-contracts/',
      takeover:       'https://apps.sonor.co.uk/sonor-takeover/',
      'estimate-cinema': 'https://apps.sonor.co.uk/sonor-estimate-cinema/',   // B-809
      'estimate-media-wall': 'https://apps.sonor.co.uk/sonor-estimate-media-wall/',   // B-809
      'estimate-media-room': 'https://apps.sonor.co.uk/sonor-estimate-media-room/',   // B-809
      'estimate-whole-home': 'https://apps.sonor.co.uk/sonor-estimate-whole-home/',   // B-809
      'led-calc':     'https://apps.sonor.co.uk/sonor-led-calc/',
      'knx-panel':    'https://apps.sonor.co.uk/sonor-knx-panel/',
      'c4-integration': 'https://apps.sonor.co.uk/sonor-c4-integration/',
      'power-map':    'https://apps.sonor.co.uk/sonor-power-map/'
    }
  },

  // ── Deep-link contracts (cross-app navigation) ──────────
  // Document the URL-param shape every app accepts so QR codes / printed
  // labels / Slack links / cross-app handoffs can be built consistently.
  // Apps own their own consumers (parse window.location.search + act); this
  // block is the canonical SCHEMA. Builders helper at sonor-brand.deepLink(...)
  // below stitches together base URL + params.
  deepLinks: {
    pm: {
      // ?project=<ref>&rack=<rackId>&row=<rowId>#sched-rack-spec
      // Scrolls to the Rack Spec view + highlights the matching rack/row.
      // Used by: PRINT - Rack Plates QR codes (v4.1.x), Portal "Open in PM"
      // button on rack snags, Network Map device → rack handoff.
      rackRow: { params: ['project', 'rack', 'row'], hash: 'sched-rack-spec' },
      // ?project=<ref>&device=<deviceId>#sched-{disc}
      // Scrolls to the relevant schedule view + highlights the matching device.
      device:  { params: ['project', 'device', 'disc'], hash: null }
    },
    takeoffs: {
      // ?project=<projects.id>&floor=<takeoffs_floors.id>&uid=<sonorSymbol.uid>&device=<device ID e.g. CS-GF-LIV-1>
      // Same params as the site view below; the editor ignores the ones it does not read yet.
      device:  { params: ['project', 'floor', 'uid', 'device'], hash: null }
    },
    takeoffsSite: {
      // site.html?project=<projects.id>&floor=<takeoffs_floors.id | floor_id>&uid=<sonorSymbol.uid>&device=<device ID>
      // Read-only site view (Takeoffs v5.264.0+): opens the floor holding the device, centres on it, opens its panel
      // (uid first, then device ID — TVs / LED runs have no uid; floor only → that floor).
      // Used by: Tasks punch lists (v2.100.0) "📐 Open on site plan".
      device:  { params: ['project', 'floor', 'uid', 'device'], hash: null }
    },
    engineering: {
      // ?project=<projects.id>&node=<eng_state.nodes[].id>&uid=<sonorSymbol.uid>&rack=<eng_state.racks[].id>
      //   &panel=<lighting_control.panels[].id>&circuit=<lighting_control.circuits key>&device=<device ID>
      // Opens the sheet holding the node and selects it (node first, uid fallback); &rack= opens that rack,
      // &panel= / &circuit= the lighting panel / circuit. &device= is the label shown, for a fallback search.
      // Used by: Tasks punch lists (v2.100.0) "Open in Engineering".
      device:  { params: ['project', 'node', 'uid', 'rack', 'panel', 'circuit', 'device'], hash: null }
    },
    netmap: {
      // ?pid=<projects.id>&uid=<Takeoffs uid / eng:<node>>&device=<device ID>
      // Opens the project's network config; uid / device pick the row once Network Map reads them.
      // Used by: Service Contracts Equipment tab, Tasks equipment card (2026-10-31).
      device:  { params: ['pid', 'uid', 'device'], hash: null }
    },
    tasks: {
      // ?project=<projects.id>&view=list&device=<device ID>&uid=<source uid>
      // Opens Tasks on the project; &device / &uid filter to that device's punch tasks (Tasks v2.101.0+).
      // Used by: Service Contracts Equipment tab.
      device:  { params: ['project', 'view', 'device', 'uid'], hash: null }
    },
    'service-contracts': {
      // ?pid=<projects.id>&uid=<client_assets.source_uid>#equipment
      // Opens Service Contracts on that project's equipment register (v0.19.0+); &uid highlights the row.
      // Used by: Tasks equipment card / asset register.
      equipment: { params: ['pid', 'uid'], hash: 'equipment' }
    }
  },

  // ── Helpers ──────────────────────────────────────────
  // Build a deep link from app key + contract id + param object.
  // Example: deepLink('pm', 'rackRow', {project: '1343', rack: 'AV1'})
  //       → 'https://apps.sonor.co.uk/sonor-project-master/?project=1343&rack=AV1#sched-rack-spec'
  // Defaults to hosted; pass {source: 'local'} to use the Drive path instead.
  deepLink: function(appKey, contractId, params) {
    var src    = (params && params.source === 'local') ? 'local' : 'hosted';
    var base   = (this.appUrls[src] || {})[appKey];
    var contract = (this.deepLinks[appKey] || {})[contractId];
    if (!base || !contract) return null;
    var qs = new URLSearchParams();
    (contract.params || []).forEach(function(k){
      if (params && params[k] != null && params[k] !== '') qs.set(k, String(params[k]));
    });
    var qstr = qs.toString();
    var hash = contract.hash ? ('#' + contract.hash) : '';
    return base + (qstr ? ('?' + qstr) : '') + hash;
  },

  // ── Print render outputs (2026-10-31) ─────────────────
  // PRINT repos serve their versioned renders from the apps gateway at
  // https://apps.sonor.co.uk/<slug>/output/… — the slug comes from
  // appUrls.hosted[key] (github.com/sonorltd/<slug>/…), the folder from
  // appUrls.local[key] ('../PRINT - X/output/'). No second list.
  // printAsset('bizcards', 'v1.1.0/300dpi/dark/front_300dpi.png')
  //   → local:  '../PRINT - Biz Cards/output/v1.1.0/300dpi/…'  (prefix opts.up extra '../')
  //   → hosted: 'https://apps.sonor.co.uk/sonor-bizcards/output/v1.1.0/300dpi/…'
  // Source: opts.source, else file: → local, anything else → hosted.
  printAsset: function(appKey, relPath, opts) {
    opts = opts || {};
    var src = opts.source || ((typeof location !== 'undefined' && location.protocol === 'file:') ? 'local' : 'hosted');
    if (src === 'local') {
      var loc = (this.appUrls.local || {})[appKey];
      return loc ? (new Array((opts.up || 0) + 1).join('../')) + loc + relPath : null;
    }
    var m = String((this.appUrls.hosted || {})[appKey] || '').match(/(?:sonorltd(?:\.github\.io)?|apps\.sonor\.co\.uk)\/([a-z0-9-]+)/);
    return m ? 'https://apps.sonor.co.uk/' + m[1] + '/output/' + relPath : null;
  },
  // Any path containing 'PRINT - X/output/…' (relative, %20-encoded or not) → its Pages URL, or null.
  printHosted: function(path) {
    var p = decodeURIComponent(String(path || ''));
    var m = p.match(/(PRINT - [^/]+)\/output\/(.*)$/);
    if (!m) return null;
    var loc = this.appUrls.local || {};
    for (var k in loc) {
      if (String(loc[k]).indexOf('../' + m[1] + '/output/') === 0) return this.printAsset(k, m[2], { source: 'hosted' });
    }
    return null;
  },

  // Get service by nn, hex, or index
  getService: function(key) {
    if (typeof key === 'number') return this.services[key];
    return this.services.find(s => s.nn === key || s.hex === key);
  },
  // Get hex by nn
  hex: function(nn) {
    const s = this.services.find(s => s.nn === nn);
    return s ? s.hex : '#8B7D6B';
  },
  // Get name by nn + tier
  name: function(nn, tier) {
    tier = tier || 'brand';
    const s = this.services.find(s => s.nn === nn);
    return s ? s[tier] : 'Unknown';
  },

  // ── Fleet helpers ──────────────────────────────────────
  // vehicle('SV1') → full vehicle record, or null if unknown
  vehicle: function(vanCode) {
    if (!vanCode || !this.vehicles) return null;
    const code = String(vanCode).toUpperCase();
    return this.vehicles.find(v => v.van_code === code) || null;
  },
  // activeVehicles() → only vans flagged active
  activeVehicles: function() {
    return (this.vehicles || []).filter(v => v.active !== false);
  },
  // vanLabel('SV1') → 'SV1 · CX67XEK · Bryn Bradley' for UI display
  vanLabel: function(vanCode) {
    const v = this.vehicle(vanCode);
    if (!v) return vanCode || '';
    return v.van_code + ' · ' + v.reg + ' · ' + v.driver_name;
  }
};

// Auto-run: set CSS variables from brand data
(function() {
  if (!window.__SONOR_BRAND__ || typeof window.__SONOR_BRAND__ !== 'object') {
    return; // Guard: brand data not loaded
  }

  const B = window.__SONOR_BRAND__;
  const root = document.documentElement;

  // Set theme variables (if theme object exists)
  // SPINE v1.2 (S-4.1 / S-4.6): if the app declares <html data-theme="…">,
  // the authoritative theme cascade comes from brand.css's [data-theme='…']
  // block. JS write-back would clobber the cascade, so we skip it and let
  // CSS win. Pre-Spine apps (no data-theme attribute) keep the legacy
  // behaviour — JS writes earthy defaults so they render correctly without
  // brand.css being present.
  if (B.theme && typeof B.theme === 'object' && !root.hasAttribute('data-theme')) {
    root.style.setProperty('--body', B.theme.body);
    root.style.setProperty('--section-1', B.theme.section1);
    root.style.setProperty('--section-2', B.theme.section2);
    root.style.setProperty('--clay', B.theme.clay);
    root.style.setProperty('--text-primary', B.theme.textPrimary);
    root.style.setProperty('--text-secondary', B.theme.textSecondary);
    root.style.setProperty('--text-muted', B.theme.textMuted);
    root.style.setProperty('--footer-bg', B.theme.footerBg);
    root.style.setProperty('--cta-bg', B.theme.ctaBg);
    root.style.setProperty('--accent', B.theme.accent);
    root.style.setProperty('--accent-light', B.theme.accentLight);
    root.style.setProperty('--border', B.theme.border);
    root.style.setProperty('--border-strong', B.theme.borderStrong);
  }

  // Set service colour variables (--s01 through --s10)
  if (B.services && Array.isArray(B.services)) {
    B.services.forEach(function(service) {
      if (service.nn && service.hex) {
        root.style.setProperty('--s' + service.nn, service.hex);
      }
    });
  }
})();
