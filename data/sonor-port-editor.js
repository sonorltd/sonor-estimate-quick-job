// sonor-port-editor — Shared port-editor logic module.
//
// SSOT for the cross-app port editor (Engineering + Library + future).
// Library is the canonical source of truth for "what the device IS";
// Engineering can edit project-locally and Push back / Detach. Both
// apps use IDENTICAL behaviour by importing the helpers from this file.
//
// Stack-neutral: pure functions only. No DOM, no React, no Supabase.
// Each consumer wires its own UI on top — React in Engineering,
// vanilla DOM in Library — but the rules + patches are the same.
//
// Sync: this file lives at $SONOR_ROOT/data/sonor-port-editor.js. It is
// copied by sync-everything.sh into:
//   APP - Engineering/data/sonor-port-editor.js          (ES module via Vite)
//   APP - Engineering/src/data/sonor-port-editor.js      (ES module via Vite)
//   APP - Library/data/sonor-port-editor.js              (vanilla <script>)
// Edit the master only. Run sync-everything.sh to propagate.
//
// v0.22.8 — Dual export shape so the SAME file works in both contexts:
//   • Engineering (Vite, ES modules) imports via `export default API`
//   • Library (plain HTML <script>) reads via `globalThis.SonorPortEditor`
//
// Spine §15 — shared-component contract.

// ─────────────────────────────────────────────────────────────────
// Canonical option lists. Both apps render the SAME selectables.
// ─────────────────────────────────────────────────────────────────

const POWER_VOLTAGE_OPTIONS = ['5V', '9V', '12V', '24V', '48V', '120V', '240V'];
const LOCAL_VOLTAGE_OPTIONS = [...POWER_VOLTAGE_OPTIONS, '13A', 'USB'];
const OUTLET_TYPE_OPTIONS = [
  'IEC C13', 'IEC C19', 'NEMA 5-15', 'NEMA 5-20',
  'UK 13A', 'EU Schuko', 'USB-A', 'USB-C', 'DC barrel',
];
const POWER_MODES = ['poe', 'external', 'none'];

// ─────────────────────────────────────────────────────────────────
// Port-class predicates. Pure — read port-shape only.
// ─────────────────────────────────────────────────────────────────

// v0.23.28 — Predicates are schema-agnostic. They accept BOTH:
//   Engineering shape: { side, signal, label, ... }
//   Library shape:     { dir, kind, name, ... }
// because the same shared module renders ports in both apps and the
// downstream Library port-editor relies on these helpers to count
// PWR IN / NET IN ports. Previously they only checked `signal` (the
// Engineering field) and silently missed Library-shape rows with
// `kind: 'mains_in'` / `kind: 'rj45'`. Bug history: TS-PAMP4-100
// restored ports showed "No PWR IN port found" 2026-05-15.
function _portSig(port) {
  // Prefer `signal` (Engineering) then fall back to `kind` (Library).
  return String((port && (port.signal || port.kind)) || '').toLowerCase();
}
function _portLabel(port) {
  return String((port && (port.label || port.name)) || '').toLowerCase();
}
function _portDir(port) {
  if (!port) return null;
  if (port.side === 'right' || port.dir === 'out') return 'out';
  if (port.side === 'left'  || port.dir === 'in')  return 'in';
  return null; // unknown / bidir
}

function _portId(port) {
  return String((port && port.id) || '').toLowerCase();
}

function isPowerInputPort(port) {
  if (!port) return false;
  if (_portDir(port) === 'out') return false;
  // v0.23.31 — Check id first (canonical, stable identifier). A port
  // with id 'mains_in' / 'pwr_in' / 'dc_power_in' is PWR IN regardless
  // of the user's edits to its kind/signal/label.
  const id = _portId(port);
  if (id === 'mains_in' || id === 'pwr_in' || id === 'dc_power_in') return true;
  const sig = _portSig(port);
  if (sig === 'mains_in' || sig === 'dc_power_in' || sig === 'dc_power') return true;
  // Engineering's auto-seeded PWR IN port (signal: 'iec_c13_c14' etc.)
  // — the connector encodes the physical jack, NOT the signal class.
  // Match by label regex which is reliable across both apps.
  const lbl = _portLabel(port);
  if (/\bpwr\s*in\b/.test(lbl) || /\bac\s*in\b/.test(lbl) || /\bmains\s*in\b/.test(lbl)) return true;
  return false;
}

function isNetworkInputPort(port) {
  if (!port) return false;
  if (_portDir(port) === 'out') return false;
  // v0.23.31 — Same id-first canonical check. Library's seeded NET
  // ports use ids like 'rj45_lan' / 'net_in' / 'ethernet_in'.
  const id = _portId(port);
  if (id === 'net_in' || id === 'rj45_lan' || id === 'lan' || id === 'ethernet_in' || id === 'ethernet') return true;
  if (id.startsWith('rj45')) return true;
  const sig = _portSig(port);
  if (sig === 'data' || sig === 'ethernet' || sig === 'data_in' || sig === 'poe' || sig === 'rj45') return true;
  const lbl = _portLabel(port);
  if (/\bnet\s*in\b/.test(lbl) || /\bnet\b/.test(lbl) || /\beth\b/.test(lbl) || /\blan\b/.test(lbl)) return true;
  return false;
}

function isPowerOutputPort(port) {
  if (!port) return false;
  if (_portDir(port) !== 'out') return false;
  const sig = _portSig(port);
  if (sig === 'mains_out' || sig === 'dc_power_out' || sig === 'outlet') return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Tri-state power mode resolver + setter.
// ─────────────────────────────────────────────────────────────────

function powerModeFor(deviceData) {
  if (!deviceData) return 'external';
  if (deviceData.hasPower === false) return 'none';
  if (deviceData.poePowered === true) return 'poe';
  return 'external';
}

function patchForPowerMode(mode) {
  switch (mode) {
    case 'none':
      return { hasPower: false, poePowered: false, localPower: false };
    case 'poe':
      return { hasPower: true, poePowered: true };
    case 'external':
    default:
      return { hasPower: true, poePowered: false };
  }
}

// ─────────────────────────────────────────────────────────────────
// Connector label resolver. Picks a clean human-readable label from
// Library's kinds / cableGroups / rackPackages for a given signal
// value. Returns null if no clean label found — caller leaves the
// existing port.connector alone (no raw IDs leak).
// ─────────────────────────────────────────────────────────────────

function resolveConnectorLabel(signalValue, libData) {
  if (!signalValue || !libData) return null;
  const next = String(signalValue);
  // v0.23.20 — Two-pass lookup. First pass prefers a "friendly" label
  // (where label ≠ kind_id); if none of the three sources has one,
  // a second pass falls back to label OR kind_id verbatim so the chip
  // is never left stale. Previously when label === kind_id we returned
  // null and the caller kept the OLD connector value — that's how a
  // port changed from HDMI to RCA could still display "HDMI" on the
  // canvas chip (HDMI's old connector survived the kind switch).
  const kinds = libData.kinds || [];
  const cableGroups = libData.cableGroups || [];
  const rackPackages = libData.rackPackages || [];

  // Pass 1 — strictly friendly label.
  for (const k of kinds) {
    if ((k.kind_id || k.label) === next) {
      if (k.label && k.label !== k.kind_id) return k.label;
      break;
    }
  }
  for (const g of cableGroups) {
    for (const c of (g.options || [])) {
      if ((c.kind_id || c.id) === next) {
        if (c.label && c.label !== c.kind_id) return c.label;
        break;
      }
    }
  }
  for (const rp of rackPackages) {
    if ((rp.kind_id || rp.id) === next) {
      // v0.23.34 — Packages have a `metadata.draw_tool_name` that's the
      // engineer-friendly short label ("16/4", "RCA-ST", "Cat6"). Prefer
      // that over the long name ("Speaker Link (16/4)") so device-card
      // port chips stay compact. This is what Bryn calls the "takeoffs
      // short name" — set in the Library package editor.
      const drawTool = rp.metadata && rp.metadata.draw_tool_name;
      if (drawTool && String(drawTool).trim()) return String(drawTool).trim();
      if (rp.short_name && rp.short_name !== rp.kind_id) return rp.short_name;
      if (rp.label && rp.label !== rp.kind_id) return rp.label;
      if (rp.name && rp.name !== rp.id) return rp.name;
      break;
    }
  }

  // Pass 2 — any non-empty label, then a tidied kind_id as last resort.
  for (const k of kinds) {
    if ((k.kind_id || k.label) === next) {
      return k.label || k.kind_id || tidyKindId(next);
    }
  }
  for (const g of cableGroups) {
    for (const c of (g.options || [])) {
      if ((c.kind_id || c.id) === next) {
        return c.label || c.kind_id || c.id || tidyKindId(next);
      }
    }
  }
  for (const rp of rackPackages) {
    if ((rp.kind_id || rp.id) === next) {
      const drawTool = rp.metadata && rp.metadata.draw_tool_name;
      if (drawTool && String(drawTool).trim()) return String(drawTool).trim();
      return rp.short_name || rp.label || rp.name || rp.kind_id || rp.id || tidyKindId(next);
    }
  }
  // Last resort — derive a readable form from the raw kind_id so the
  // chip never shows the previous-kind's stale connector.
  return tidyKindId(next);
}

// Convert "rca_in" / "speaker_link_16_4" / "hdmi" → "RCA In" /
// "Speaker Link 16/4" / "HDMI" for chip display. Pure string fn.
function tidyKindId(s) {
  if (!s) return '';
  return String(s)
    .replace(/_(\d+)_(\d+)\b/g, ' $1/$2') // 16_4 → 16/4
    .replace(/_/g, ' ')
    .replace(/\b(in|out|hdmi|usb|hdbt|rca|xlr|trs|spdif|sdi|dp|dvi|vga|lan|poe|cat\d|rj45)\b/gi,
      (m) => m.toUpperCase())
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // Preserve already-correct fully-uppercase tokens
    .replace(/\b(HDMI|USB|RCA|XLR|TRS|SDI|DP|DVI|VGA|LAN|POE|HDBT|RJ45|CAT\d)\b/gi,
      (m) => m.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────
// Port-kind dropdown options builder.
// ─────────────────────────────────────────────────────────────────

function buildPortKindOptions(libData) {
  const out = [];
  const seen = new Set();
  const add = (group, options) => {
    const opts = options.filter((o) => o && o.value && !seen.has(o.value));
    opts.forEach((o) => seen.add(o.value));
    if (opts.length) out.push({ kind: group ? 'group' : 'plain', label: group, options: opts });
  };
  add(null, (libData?.kinds || []).map((k) => ({
    value: k.kind_id || k.label,
    label: k.label || k.kind_id || '—',
  })));
  for (const g of (libData?.cableGroups || [])) {
    add(g.label || g.topCategory, (g.options || []).map((c) => ({
      value: c.kind_id || c.id,
      label: c.label || c.kind_id || c.id,
    })));
  }
  if ((libData?.rackPackages || []).length) {
    add('Rack Packages', (libData.rackPackages || []).map((rp) => ({
      value: rp.kind_id || rp.id,
      label: rp.label || rp.kind_id || rp.id,
    })));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Network mode setter.
// ─────────────────────────────────────────────────────────────────

function patchForNetwork({ hardwire, wifi }) {
  return {
    hasNetwork: !!hardwire,
    hasWifi: !!wifi,
  };
}

// ─────────────────────────────────────────────────────────────────
// Seeding helpers. Deterministic ids — no random suffixes — so edges
// referencing these handles never go stale (v0.21.2 fix).
// ─────────────────────────────────────────────────────────────────

function seedPwrInPort(deviceId) {
  return {
    id: `port-pwr-${deviceId}`,
    label: 'PWR IN',
    side: 'left',
    signal: 'mains_in',
    voltage: '240V',
    role: 'power-in',
  };
}

function seedNetInPort(deviceId) {
  return {
    id: `port-net-${deviceId}`,
    label: 'NET IN',
    side: 'left',
    signal: 'data',
    cableLabel: 'Cat6',
    role: 'network-in',
  };
}

function seedLocalSocketNode(deviceId, parentDeviceId, voltage) {
  return {
    id: `localsock-${deviceId}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'sonorLocalSocket',
    data: {
      kind: 'localSocket',
      parentDeviceId,
      voltage: voltage || '240V',
    },
    draggable: true,
    selectable: true,
    zIndex: 5,
  };
}

function seedOutletPort(deviceId, index, voltage, outletType) {
  return {
    id: `port-out-${deviceId}-${index}`,
    label: `Outlet ${index + 1}`,
    side: 'right',
    signal: 'mains_out',
    voltage: voltage || '240V',
    connector: outletType || 'IEC C13',
    role: 'power-out',
  };
}

// ─────────────────────────────────────────────────────────────────
// Validation. Returns [{ level: 'error'|'warn', code, message }].
// ─────────────────────────────────────────────────────────────────

function validateDevice(deviceData) {
  const issues = [];
  if (!deviceData) return issues;
  const ports = deviceData.ports || [];
  const mode = powerModeFor(deviceData);
  const hasPwrIn = ports.some((p) => isPowerInputPort(p));
  if (mode === 'external' && !hasPwrIn) {
    issues.push({ level: 'warn', code: 'pwrin-missing', message: 'External-mains device has no PWR IN port' });
  }
  if (mode === 'poe') {
    const hasNetIn = ports.some((p) => isNetworkInputPort(p));
    if (!hasNetIn) {
      issues.push({ level: 'warn', code: 'poe-no-netin', message: 'PoE device has no NET IN port' });
    }
  }
  if (deviceData.hasPowerOutputs) {
    const outlets = ports.filter((p) => isPowerOutputPort(p));
    if (outlets.length === 0) {
      issues.push({ level: 'warn', code: 'pdu-no-outlets', message: 'Marked as PDU but no outlets configured' });
    }
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────
// Library / Engineering boundary helpers.
// ─────────────────────────────────────────────────────────────────

// v0.23.29 — Single canonical port shape.
//
// Per Bryn (2026-05-15): "both apps should be referring to the same
// thing in exactly the same way." The previous translator approach
// was a tax — every push paid the cost, every reader had to know
// which side it was on. Replaced with one canonical object that
// carries BOTH alias sets:
//
//   side ↔ dir     ('left' ↔ 'in', 'right' ↔ 'out')
//   signal ↔ kind  (pass-through string, same value either name)
//   label ↔ name   (pass-through string, same value either name)
//
// Engineering reads `port.side / port.signal / port.label` like it
// always has. Library reads `port.dir / port.kind / port.name`.
// They're the same object, the same values, just visible under
// either field name. `normalisePort(p)` fills in whichever alias is
// missing so both apps see consistent data.
//
// Apply normalisePort:
//   - On every port arriving from Supabase (palette load / Library row)
//   - On every port created (Inspector + auto-seed effects)
//   - On every port saved upstream (Library push)
//
// Trade-off: ports carry redundant fields. The extra bytes are
// trivial (~30 chars/port) and they're never out of sync because
// normalisePort enforces parity. Worth it to kill the translator
// and the entire schema-mismatch bug class.

function normalisePort(p) {
  if (!p || typeof p !== 'object') return p;
  const out = { ...p };
  // dir / side aliases
  if (!out.dir && out.side) {
    out.dir = (out.side === 'right') ? 'out' : 'in';
  }
  if (!out.side && out.dir) {
    out.side = (out.dir === 'out') ? 'right' : 'left'; // 'bidir' lands on left
  }
  // kind / signal aliases
  if (!out.kind && out.signal) out.kind = out.signal;
  if (!out.signal && out.kind) out.signal = out.kind;
  // label / name aliases
  if (!out.name && out.label) out.name = out.label;
  if (!out.label && out.name) out.label = out.name;
  // id sanitisation — leaked random-suffix PWR IN ids
  // (`port-pwr-dev-XXX-htwn`) from before the v0.21.2 deterministic-id
  // refactor get normalised to `mains_in` so the Library port editor
  // renders a clean canonical row.
  if (out.id && /^port-pwr-/i.test(String(out.id))) {
    out.id = 'mains_in';
  }
  return out;
}

function normalisePorts(ports) {
  if (!Array.isArray(ports)) return [];
  // Dedupe by id while normalising — Engineering occasionally has
  // duplicate auto-seeded PWR IN ports that didn't get collapsed;
  // one canonical entry per id is what Library expects.
  const seen = new Set();
  const out = [];
  for (const p of ports) {
    const np = normalisePort(p);
    if (!np) continue;
    const key = String(np.id || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(np);
  }
  return out;
}

// v0.23.28 → v0.23.29 — translator retired. Engineering writes ports
// straight to Library after normalisePort fills the canonical aliases.
//
// The two apps grew different port schemas: Engineering uses
// {id, side, label, signal, connector, voltage, role, ...} for canvas
// flow rendering; Library uses {id, dir, kind, name} for the
// canonical catalog editor. Cross-writing without translation
// (pre-v0.23.27) corrupted Library port lists by leaving `dir`
// undefined → every port rendered as "BIDIRECTIONAL".
//
// Translator rules:
//   - `side: 'left'`  → `dir: 'in'`
//   - `side: 'right'` → `dir: 'out'`
//   - Never emit `dir: 'bidir'` (Bryn directive — Engineering doesn't
//     model bidirectional ports; even RJ45 is treated as 'in' since
//     it's the network input from the engineer's perspective).
//   - `signal` → `kind` (pass-through; Engineering's signal ids are
//     library-canonical when the kind picker was used; raw values
//     like "pkg-mp1v39o3" or "port-pwr-dev-..." get sanitized).
//   - `label` → `name`.
//   - `id` normalised: leaked `port-pwr-dev-XXX-htwn` ids become
//     'mains_in' (the canonical Library kind). Other ids are passed
//     through with `[^a-zA-Z0-9_]` stripped to underscores.
// v0.23.29 — translator functions retired. Kept as back-compat
// aliases inside the SonorPortEditor surface (see export block) so
// any caller still using the old names gets normalisePort/normalisePorts
// behaviour. The schema is unified now: every port carries both
// {dir, kind, name} AND {side, signal, label} simultaneously; both
// apps read the names they expect off the same single object.

function buildLibraryPatch(deviceData) {
  if (!deviceData) return null;
  return {
    block_code: deviceData.libBlockCode,
    label: deviceData.label,
    metadata: {
      // v0.23.29 — Ports are the SAME canonical objects both apps
      // already work with. normalisePorts just guarantees both alias
      // sets are populated so the Library port editor sees what it
      // expects (dir/kind/name) and Engineering sees what it expects
      // (side/signal/label) on the same row.
      ports: normalisePorts(deviceData.ports),
      schematic: {
        hasPower:         deviceData.hasPower,
        poePowered:       deviceData.poePowered,
        hasNetwork:       deviceData.hasNetwork,
        hasWifi:          deviceData.hasWifi,
        hasPowerOutputs:  deviceData.hasPowerOutputs,
        localPower:       deviceData.localPower,
        localPowerVoltage:deviceData.localPowerVoltage,
        poeBudgetW:       Number(deviceData.poeBudgetW) || undefined,
        upsCapacityW:     Number(deviceData.upsCapacityW) || undefined,
        outletCount:      Number(deviceData.outletCount) || undefined,
      },
    },
  };
}

function applyLibraryRowToDeviceData(targetDeviceData, libRow) {
  const metaSchem = (libRow && libRow.metadata && libRow.metadata.schematic) || {};
  // v0.23.29 — Library rows that pre-date the canonical-port unification
  // may have ports with only `dir/kind/name` (no `side/signal/label`).
  // normalisePorts fills the missing aliases so Engineering's canvas
  // renderer + router see the side/signal/label fields they expect
  // without any per-call-site translation logic downstream.
  const rawPorts = Array.isArray(libRow?.metadata?.ports)
    ? libRow.metadata.ports
    : Array.isArray(metaSchem.ports) ? metaSchem.ports : (targetDeviceData?.ports || []);
  return Object.assign({}, targetDeviceData || {}, {
    ports: normalisePorts(rawPorts),
    hasPower:         metaSchem.hasPower,
    poePowered:       metaSchem.poePowered,
    hasNetwork:       metaSchem.hasNetwork,
    hasWifi:          metaSchem.hasWifi,
    hasPowerOutputs:  metaSchem.hasPowerOutputs,
    localPower:       metaSchem.localPower,
    localPowerVoltage:metaSchem.localPowerVoltage,
    poeBudgetW:       metaSchem.poeBudgetW || null,
    upsCapacityW:     metaSchem.upsCapacityW || null,
    outletCount:      metaSchem.outletCount || null,
  });
}

// ─────────────────────────────────────────────────────────────────
// Public API object — used by BOTH the ES-module default export
// (Engineering / Vite) AND the globalThis attachment (Library / plain
// HTML). Identical surface either way.
// ─────────────────────────────────────────────────────────────────

const SonorPortEditor = {
  POWER_VOLTAGE_OPTIONS,
  LOCAL_VOLTAGE_OPTIONS,
  OUTLET_TYPE_OPTIONS,
  POWER_MODES,
  isPowerInputPort,
  isNetworkInputPort,
  isPowerOutputPort,
  powerModeFor,
  patchForPowerMode,
  patchForNetwork,
  resolveConnectorLabel,
  buildPortKindOptions,
  seedPwrInPort,
  seedNetInPort,
  seedLocalSocketNode,
  seedOutletPort,
  validateDevice,
  buildLibraryPatch,
  applyLibraryRowToDeviceData,
  // v0.23.29 — canonical-shape normaliser. Replaces the v0.23.28
  // translator-based approach. Both apps work on the same object;
  // normalisePort fills missing alias fields so each side sees the
  // names it expects.
  normalisePort,
  normalisePorts,
  // Translator kept as a back-compat alias — calls normalisePorts so
  // any caller still using the old name gets the new behaviour.
  translatePortToLibrary: normalisePort,
  translatePortsForLibrary: normalisePorts,
  VERSION: '1.0.7',
};

// Attach to global for plain-<script> consumers (Library).
if (typeof globalThis !== 'undefined') {
  globalThis.SonorPortEditor = SonorPortEditor;
}

// ES module default export for Engineering (Vite). Named exports too
// so consumers can `import { powerModeFor } from '../data/sonor-port-editor'`.
export {
  POWER_VOLTAGE_OPTIONS,
  LOCAL_VOLTAGE_OPTIONS,
  OUTLET_TYPE_OPTIONS,
  POWER_MODES,
  isPowerInputPort,
  isNetworkInputPort,
  isPowerOutputPort,
  powerModeFor,
  patchForPowerMode,
  patchForNetwork,
  resolveConnectorLabel,
  buildPortKindOptions,
  seedPwrInPort,
  seedNetInPort,
  seedLocalSocketNode,
  seedOutletPort,
  validateDevice,
  buildLibraryPatch,
  applyLibraryRowToDeviceData,
};
export default SonorPortEditor;
