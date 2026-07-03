// Generates public/designs/pip-power.json — Pip robot base power system,
// from evedesign/PERFBOARD_POWER_DESIGN.md. Two 50×70mm-class perfboards
// (Board A rails, Board B battery) plus a buck size-comparison board.
//
//   node scripts/build-pip-power.mjs
//
// Wiring is expressed by PIN NAME (resolved to board holes here), and every
// connection is a 2-point track so it unions exactly its two endpoint holes —
// no accidental cross-net shorts from lines that merely cross on screen.
// The script self-checks (pin collisions, physical body overlaps, board
// bounds, power/ground shorts) and refuses to write a broken design.
// Ids are deterministic so re-importing replaces cleanly (merge-by-id).

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'designs');
const P = 2.54; // hole pitch, mm

// ---------- geometry (mirrors src/domain/geometry.ts) ----------
const rotateOffset = (col, row, rot, W, H) => {
  switch (rot) {
    case 90:  return { col: H - 1 - row, row: col };
    case 180: return { col: W - 1 - col, row: H - 1 - row };
    case 270: return { col: row, row: W - 1 - col };
    default:  return { col, row };
  }
};
const rotatePointMm = (x, y, rot, W1, H1) => {
  switch (rot) {
    case 90:  return { x: H1 - y, y: x };
    case 180: return { x: W1 - x, y: H1 - y };
    case 270: return { x: y, y: W1 - x };
    default:  return { x, y };
  }
};
function bodyRect(m, def) {
  if (def.bodyMm) {
    const b = def.bodyMm;
    const W1 = def.cols - 1, H1 = def.rows - 1;
    const p = rotatePointMm(b.dx / P, b.dy / P, m.rotation, W1, H1);
    const q = rotatePointMm((b.dx + b.w) / P, (b.dy + b.h) / P, m.rotation, W1, H1);
    return { x: m.col + Math.min(p.x, q.x), y: m.row + Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
  }
  const s = (m.rotation === 90 || m.rotation === 270) ? { cols: def.rows, rows: def.cols } : { cols: def.cols, rows: def.rows };
  return { x: m.col - 0.45, y: m.row - 0.45, w: s.cols - 1 + 0.9, h: s.rows - 1 + 0.9 };
}
function bodyHoles(m, def) {
  const r = bodyRect(m, def), out = [];
  for (let c = Math.ceil(r.x); c <= Math.floor(r.x + r.w); c++)
    for (let rr = Math.ceil(r.y); rr <= Math.floor(r.y + r.h); rr++) out.push([c, rr]);
  return out;
}
const worldPin = (m, def, pin) => {
  const o = rotateOffset(pin.col, pin.row, m.rotation, def.cols, def.rows);
  return [m.col + o.col, m.row + o.row];
};

// ---------- module library (specs from PERFBOARD_POWER_DESIGN.md §4) ----------
const pin = (col, row, type, name, label) => ({ id: `p_${name}_${col}_${row}`, col, row, type, name, ...(label ? { label } : {}) });
// body centered on the pin grid unless dx/dy overridden
const cbody = (w, h, cols, rows, dx, dy) => ({ w, h, dx: dx ?? -((w - (cols - 1) * P) / 2), dy: dy ?? -((h - (rows - 1) * P) / 2) });

const DEFS = {
  d24v90f5: {
    id: 'def_d24v90f5', name: 'Pololu D24V90F5 5V/9A buck', designatorPrefix: 'U', color: '#3b82f6',
    cols: 16, rows: 8, bodyMm: cbody(40.6, 20.3, 16, 8),
    notes: 'Pololu #2866, ~$37 (OOS/rationed 2026 — see doc §0). In 5–38V → 5V ±4% @ ~9A, synchronous. Reverse-V, OCP, thermal, soft-start, UVLO. FITS the board and the 26mm bay. Pad positions approximate.',
    pins: [pin(0,0,'power','VIN','20V'), pin(0,7,'ground','GND'), pin(15,0,'output','VOUT','5.0V'), pin(15,7,'ground','GND2'), pin(6,7,'input','EN'), pin(9,7,'output','PG')],
  },
  d36v50f6: {
    id: 'def_d36v50f6', name: 'Pololu D36V50F6 6V/5.5A buck', designatorPrefix: 'U', color: '#8b5cf6',
    cols: 6, rows: 1, bodyMm: cbody(25.4, 25.4, 6, 1, -6.35, -22.9),
    notes: 'Pololu #4092, ~$25 (OOS at Pololu 2026). In 6.5–50V → 6V @ 5.5A. Terminal row along one edge; body extends up from it. FITS the board and the bay.',
    pins: [pin(0,0,'output','PG'), pin(1,0,'input','EN'), pin(2,0,'power','VIN','20V'), pin(3,0,'passive','VRP'), pin(4,0,'output','VOUT','6.0V'), pin(5,0,'ground','GND')],
  },
  xl4016: {
    id: 'def_xl4016', name: 'XL4016E1 8A buck (cost-down)', designatorPrefix: 'U', color: '#ef4444',
    cols: 12, rows: 2, bodyMm: cbody(61, 41, 12, 2),
    notes: 'Doc §0 cost-down pick (~$3.6–7.6, one 2-pack does both bucks; saves ~$50). BUT 61×41×27mm — DOES NOT FIT the 50×70 board OR the 26mm bay (27mm tall), and uses screw terminals, not 0.1in pins. Shown for size comparison. For the perfboard build use the Pololu (placed) or the DROK 6A sync.',
    pins: [pin(0,0,'power','IN+','4-40V'), pin(0,1,'ground','IN-'), pin(11,0,'output','OUT+'), pin(11,1,'ground','OUT-')],
  },
  tps61088: {
    id: 'def_tps61088', name: 'TPS61088 boost (ADJ→4.85V)', designatorPrefix: 'U', color: '#f59e0b',
    cols: 3, rows: 16, bodyMm: cbody(21, 40, 3, 16),
    notes: '21×40mm generic board, ~$4–8. In 2.7–12V; ~3.7A cont @5V from a 3.0V cell (18.9W). Leave 5/9/12V pads OPEN, set ADJ to measured-buck −0.15V (≈4.85V). Stick-on heatsink, 5mm clearance. EN is GATED (pull-down + Pi GPIO) so the boost only runs when the Pi has already booted on wall power — the battery is a WARNING backup, NOT a way to power on unplugged.',
    pins: [pin(0,0,'power','VIN+','from P+'), pin(2,0,'ground','VIN-'), pin(0,8,'input','EN','wall-armed'), pin(0,15,'output','VOUT+','4.85V'), pin(2,15,'ground','VOUT-')],
  },
  ada4410: {
    id: 'def_ada4410', name: 'Adafruit 4410 charger (MCP73831)', designatorPrefix: 'U', color: '#06b6d4',
    cols: 3, rows: 2, bodyMm: cbody(22.9, 17.8, 3, 2),
    notes: 'adafruit.com/product/4410, $7. Feed 5V via the 5V pad (NOT the USB-C jack; abs-max ~6V). CLOSE the jumper = 500mA. STAT = solder a fine wire to the CHG-LED node.',
    pins: [pin(0,0,'power','5V','from buck'), pin(1,0,'ground','GND'), pin(2,0,'output','BAT','to P+'), pin(0,1,'output','STAT','LED tap')],
  },
  xl74610: {
    id: 'def_xl74610', name: 'XL74610 ideal diode (LM74610)', designatorPrefix: 'D', color: '#64748b',
    cols: 8, rows: 4, bodyMm: cbody(22, 12, 8, 4),
    notes: 'Amazon 5-pack ~$11. 1.5–36V, 15A, ~3mΩ. Two-terminal ideal diode: IN+→OUT+ blocks reverse; IN-/OUT- common. Body diode conducts instantly on handover.',
    pins: [pin(0,0,'passive','IN+'), pin(0,3,'ground','IN-'), pin(7,0,'passive','OUT+'), pin(7,3,'ground','OUT-')],
  },
  pcm1s: {
    id: 'def_pcm1s', name: '1S PCM 8A (DW01 + dual 8205)', designatorPrefix: 'U', color: '#10b981',
    cols: 15, rows: 2, bodyMm: cbody(40, 7, 15, 2),
    notes: '"1S 3.7V 8A BMS", ~$2. OV 4.28V / UV ~2.5V (fire backstop) / OC ~8A. MUST be the dual-FET 8A variant. B±=cell, P±=system. Bench-verify trip once.',
    pins: [pin(0,0,'passive','B+','cell+'), pin(0,1,'ground','B-','cell-'), pin(14,0,'passive','P+','sys+'), pin(14,1,'ground','P-','sys-')],
  },
  xt30: {
    id: 'def_xt30', name: 'XT30PW right-angle', designatorPrefix: 'J', color: '#dc2626',
    cols: 1, rows: 3, bodyMm: { w: 10.5, h: 16, dx: -5.25, dy: -3 }, mayOverhang: true,
    notes: '15A keyed connector, PCB right-angle. + / − on 5.08mm (2-hole) pitch; shroud overhangs the board edge by design. ~$8 / 6 pairs.',
    pins: [pin(0,0,'passive','+'), pin(0,2,'passive','-')],
  },
  jstxh4: {
    id: 'def_jstxh4', name: 'JST-XH 4-pin', designatorPrefix: 'J', color: '#d97706',
    cols: 4, rows: 1, bodyMm: cbody(12.9, 5.8, 4, 1), mayOverhang: true,
    notes: 'SENSE bundle up the pass-through, 26AWG.',
    pins: [pin(0,0,'passive','1'), pin(1,0,'passive','2'), pin(2,0,'passive','3'), pin(3,0,'passive','4')],
  },
  jstxh2: {
    id: 'def_jstxh2', name: 'JST-XH 2-pin', designatorPrefix: 'J', color: '#d97706',
    cols: 2, rows: 1, bodyMm: cbody(7.9, 5.8, 2, 1), mayOverhang: true,
    notes: '0.5A-class interconnect.',
    pins: [pin(0,0,'passive','1'), pin(1,0,'passive','2')],
  },
  dpst: {
    id: 'def_dpst', name: 'DPST rocker power switch (KCD2)', designatorPrefix: 'SW', color: '#e11d48',
    cols: 3, rows: 2, bodyMm: cbody(21, 15, 3, 2), mayOverhang: true,
    notes: 'Panel-mounted rocker (KCD2/KCD4 class, >=10A), ~$4. MOUNTS OFF THE BOARD in the base back face; joins the board by flying wires (shown outside the board at left). Pole 1 = 20V bus on/off; Pole 2 = LiPo->boost cutoff on Board B; GND is not switched. "Off" kills both the bus and the battery path.',
    pins: [pin(0,0,'passive','P1a'), pin(0,1,'passive','P1b'), pin(2,0,'passive','P2a'), pin(2,1,'passive','P2b')],
  },
  usbc: {
    id: 'def_usbc', name: 'USB-C receptacle (panel, breakout)', designatorPrefix: 'J', color: '#0891b2',
    cols: 4, rows: 1, bodyMm: cbody(9, 10, 4, 1), mayOverhang: true,
    notes: 'Panel-mount USB-C receptacle in the base back face = the wall port. SEPARATE from the PD trigger; joined by a short cable carrying VBUS + GND + CC1 + CC2. ~$3.',
    pins: [pin(0,0,'power','VBUS'), pin(1,0,'passive','CC1'), pin(2,0,'passive','CC2'), pin(3,0,'ground','GND')],
  },
  zy12pdn: {
    id: 'def_zy12pdn', name: 'ZY12PDN PD trigger (set 20V)', designatorPrefix: 'U', color: '#7c3aed',
    cols: 4, rows: 4, bodyMm: cbody(30, 15, 4, 4),
    notes: 'USB-C PD trigger, button-select to 20V (100W: 20V/5A), ~$6. Mounts ON the board (internal); a cable from the panel USB-C receptacle (J8) feeds its VBUS/GND/CC. Output = the 20V bus -> 5A fuse -> DPST switch (SW1) -> J1.',
    pins: [pin(0,0,'power','VBUS','from USB-C'), pin(0,1,'passive','CC1'), pin(0,2,'passive','CC2'), pin(0,3,'ground','GNDin'), pin(3,0,'output','V20','20V out'), pin(3,3,'ground','GNDo')],
  },
  capD13: {
    id: 'def_capD13', name: 'Electrolytic Ø13 (5mm LS)', designatorPrefix: 'C', color: '#334155',
    cols: 1, rows: 3, bodyMm: cbody(13, 13, 1, 3),
    notes: '1000µF/35V bus cap. + pin marked.',
    pins: [pin(0,0,'passive','+'), pin(0,2,'passive','-')],
  },
  capD10: {
    id: 'def_capD10', name: 'Electrolytic Ø10 low-ESR (5mm LS)', designatorPrefix: 'C', color: '#475569',
    cols: 1, rows: 3, bodyMm: cbody(10, 10, 1, 3),
    notes: 'Panasonic FR 2200µF/10V (ORing node) or 1000µF/10V (boost input).',
    pins: [pin(0,0,'passive','+'), pin(0,2,'passive','-')],
  },
  res: {
    id: 'def_res', name: 'Resistor 1/4W axial', designatorPrefix: 'R', color: '#b45309',
    cols: 4, rows: 1, bodyMm: cbody(9, 3, 4, 1),
    pins: [pin(0,0,'passive','1'), pin(3,0,'passive','2')],
  },
  cap100n: {
    id: 'def_cap100n', name: 'Ceramic 100nF', designatorPrefix: 'C', color: '#0ea5e9',
    cols: 2, rows: 1, bodyMm: cbody(5, 3.2, 2, 1),
    pins: [pin(0,0,'passive','1'), pin(1,0,'passive','2')],
  },
  led3: {
    id: 'def_led3', name: 'LED 3mm', designatorPrefix: 'D', color: '#22c55e',
    cols: 2, rows: 1, bodyMm: cbody(3.8, 4.2, 2, 1),
    pins: [pin(0,0,'passive','A'), pin(1,0,'passive','K')],
  },
  trim: {
    id: 'def_trim', name: 'Trimpot 3296W 200k', designatorPrefix: 'RV', color: '#a855f7',
    cols: 3, rows: 1, bodyMm: cbody(9.5, 4.8, 3, 1),
    notes: 'Sets boost ADJ ≈ measured buck −0.15V. Wire wiper+end as a rheostat.',
    pins: [pin(0,0,'passive','1'), pin(1,0,'passive','W'), pin(2,0,'passive','3')],
  },
};

// ---------- builder ----------
let seq = 0;
const nid = (p) => `${p}_${String(++seq).padStart(3, '0')}`;

function makeBoard(id, name, cols, rows) {
  const board = { id, name, type: 'perfboard', cols, rows, activeSide: 'top', modules: [], tracks: [], io: [], annotations: [], nets: [] };
  const byRef = new Map(); // "desig.PIN" -> [col,row]
  const modByRef = new Map();
  const place = (defKey, col, row, designator, rot = 0, label) => {
    const def = DEFS[defKey];
    const m = { id: `mod_${id}_${designator}`, defId: def.id, col, row, rotation: rot, side: 'top', designator, ...(label ? { labelOverride: label } : {}) };
    board.modules.push(m);
    modByRef.set(designator, { m, def });
    for (const pn of def.pins) byRef.set(`${designator}.${pn.name}`, worldPin(m, def, pn));
    return designator;
  };
  const net = (netId, name, color, kind) => { board.nets.push({ id: netId, name, color, kind }); return netId; };
  const wire = (netId, color, rail, refs) => {
    // chain the referenced pins/holes in given order with 2-point tracks (kept
    // 2-point so no corner hole is unioned into the net — avoids false shorts;
    // the app renders/checks them orthogonally). Side is assigned later by
    // assignSides() so overlapping nets land on opposite faces of the board.
    const pts = refs.map((r) => Array.isArray(r) ? r : byRef.get(r));
    for (const [i, p] of pts.entries()) if (!p) throw new Error(`${id}: unknown pin ref "${refs[i]}"`);
    for (let i = 0; i < pts.length - 1; i++)
      board.tracks.push({ id: nid('trk'), side: 'bottom', points: [{ col: pts[i][0], row: pts[i][1] }, { col: pts[i + 1][0], row: pts[i + 1][1] }], netId, color, ...(rail ? { rail: true } : {}) });
  };
  const io = (kind, col, row, name) => board.io.push({ id: nid('io'), kind, name, col, row });
  const note = (text, col, row, color) => board.annotations.push({ id: nid('ann'), text, col, row, side: 'both', ...(color ? { color } : {}) });
  return { board, place, net, wire, io, note, ref: (r) => byRef.get(r), modByRef };
}

// ============================================================
// BOARD A — rails (20 × 26 holes ≈ 51 × 66 mm, "50×70" class)
// ============================================================
const A = makeBoard('pip_boardA', 'Pip Power — Board A (rails)', 36, 30);
// ROW 1 (rows 0-9): input + 5V buck + wall-sense divider
A.place('xt30', 1, 2, 'J1', 0, '20V_IN');
A.place('d24v90f5', 5, 1, 'U1');                     // body cols ~4.5-20.5, rows ~0.5-8.5
A.place('capD13', 23, 2, 'C1', 0, '1000u/35V');
A.place('res', 27, 1, 'R1', 0, '56k');               // divider: 20V–R1–DIV–R2–GND
A.place('res', 27, 3, 'R2', 0, '10k');
A.place('res', 27, 5, 'R3', 0, '10k');               // DIV → R3 → WALL_SENSE
A.place('cap100n', 27, 7, 'C5', 0, '100n');
A.place('jstxh2', 33, 1, 'J6', 0, '5V_CHG');
// ROW 2 (rows 11-16): 5V ORing node — two ideal diodes + bulk caps
A.place('xl74610', 2, 12, 'D1', 0, 'IDEAL-A');       // buck → 5V rail
A.place('xl74610', 12, 12, 'D2', 0, 'IDEAL-B');      // boost → 5V rail
A.place('capD10', 23, 11, 'C2', 0, '2200u');
A.place('capD10', 28, 11, 'C3', 0, '2200u');
A.place('cap100n', 32, 12, 'C4', 0, '100n');
// ROW 3 (rows 19-29): 6V buck (body extends UP from its terminal row) + LEDs + outputs
A.place('d36v50f6', 4, 28, 'U2');                    // pin row 28; body up to ~row 19
A.place('led3', 14, 20, 'D3', 0, '5V');
A.place('res', 14, 22, 'R4', 0, '1k');
A.place('led3', 19, 20, 'D4', 0, '6V');
A.place('res', 19, 22, 'R5', 0, '1k');
// output connectors along the bottom edge, 5-hole pitch so the 10.5mm shrouds clear
A.place('jstxh4', 13, 27, 'J7', 0, 'SENSE');
A.place('xt30', 20, 27, 'J2', 0, '6V_OUT');
A.place('xt30', 25, 27, 'J3', 0, 'VMOT_20V');
A.place('xt30', 30, 27, 'J4', 0, '5V_OUT');
A.place('xt30', 35, 27, 'J5', 0, 'BOOST_IN');
// FRONT-END: only the USB-C port (J8) and the POWER switch (SW1) are OFF the board
// (panel-mounted on the base back face). The PD trigger (U3) is ON the board; a cable
// from the panel USB-C feeds it, and its switched 20V returns to J1.
//   panel USB-C (J8, off) --cable(VBUS/GND/CC)--> U3 PD trigger (ON board)
//   U3 --20V(+5A fuse)--> DPST switch (SW1, off) --> J1 (board 20V entry)
A.place('zy12pdn', 28, 19, 'U3', 0, 'PD TRIG'); // PD trigger — ON the board (internal)
A.place('usbc',    -31, 4, 'J8', 0, 'USB-C');   // panel wall port (off-board), cabled to U3
A.place('dpst',     -8, 4, 'SW1', 0, 'POWER');  // DPST power switch (off-board panel)

// nets
A.net('netA_20v', '20V_BUS', '#f97316', 'power');
A.net('netA_gnd', 'GND', '#111827', 'ground');
A.net('netA_5vb', '5V_BUCK', '#fb7185', 'power');
A.net('netA_5vr', '5V_RAIL', '#ef4444', 'power');
A.net('netA_boost', 'BOOST_5V', '#ec4899', 'power');
A.net('netA_6v', '6V_RAIL', '#8b5cf6', 'power');
A.net('netA_div', 'DIV', '#84cc16', 'signal');
A.net('netA_sense', 'WALL_SENSE', '#22c55e', 'signal');
A.net('netA_led5', 'LED5', '#94a3b8', 'signal');
A.net('netA_led6', 'LED6', '#94a3b8', 'signal');
A.net('netA_20vsrc', '20V_SRC', '#fb923c', 'power');   // trigger V20 -> switch (before the switch)
A.net('netA_usbvbus', 'USB_VBUS', '#06b6d4', 'power'); // USB-C cable VBUS -> trigger
A.net('netA_cc1', 'CC1', '#a3e635', 'signal');         // USB-C CC lines (PD negotiation) -> trigger
A.net('netA_cc2', 'CC2', '#a3e635', 'signal');

A.wire('netA_20v', '#f97316', true, ['J1.+', 'C1.+', 'U1.VIN']);
A.wire('netA_20v', '#f97316', true, ['U1.VIN', 'U2.VIN']);
A.wire('netA_20v', '#f97316', true, ['C1.+', 'J3.+']);   // VMOT stepper feed
A.wire('netA_20v', '#f97316', false, ['J1.+', 'R1.1']);  // divider top
A.wire('netA_gnd', '#111827', true, ['J1.-', 'C1.-', 'U1.GND', 'D1.IN-', 'D2.IN-', 'J4.-']);
A.wire('netA_gnd', '#111827', true, ['U1.GND2', 'U2.GND']);
A.wire('netA_gnd', '#111827', false, ['D1.OUT-', 'C2.-', 'C3.-', 'C4.2', 'D2.OUT-']);
A.wire('netA_gnd', '#111827', false, ['R2.2', 'C5.2']);
A.wire('netA_gnd', '#111827', false, ['J2.-', 'J3.-']);
A.wire('netA_gnd', '#111827', false, ['R4.2', 'D3.K']);  // 5V LED cathode via R4
A.wire('netA_gnd', '#111827', false, ['R5.2', 'D4.K']);
A.wire('netA_gnd', '#111827', false, ['J4.-', 'J7.4']);  // sense GND
A.wire('netA_5vb', '#fb7185', false, ['U1.VOUT', 'D1.IN+', 'J6.1']); // buck out → diode A + charger feed
A.wire('netA_5vr', '#ef4444', true, ['D1.OUT+', 'C2.+', 'C3.+', 'D2.OUT+', 'J4.+']);
A.wire('netA_5vr', '#ef4444', false, ['C3.+', 'D3.A']); // 5V LED anode
A.wire('netA_boost', '#ec4899', false, ['J5.+', 'D2.IN+']);
A.wire('netA_6v', '#8b5cf6', true, ['U2.VOUT', 'J2.+']);
A.wire('netA_6v', '#8b5cf6', false, ['U2.VOUT', 'D4.A']); // 6V LED anode
A.wire('netA_div', '#84cc16', false, ['R1.2', 'R2.1', 'R3.1', 'C5.1']);
A.wire('netA_sense', '#22c55e', false, ['R3.2', 'J7.1']);
A.wire('netA_led5', '#94a3b8', false, ['D3.K', 'R4.1']);
A.wire('netA_led6', '#94a3b8', false, ['D4.K', 'R5.1']);
// --- front-end (off-board) flying-wire hookup ---
// USB-C receptacle --cable--> PD trigger
A.wire('netA_usbvbus', '#06b6d4', false, ['J8.VBUS', 'U3.VBUS']); // VBUS
A.wire('netA_cc1',     '#a3e635', false, ['J8.CC1',  'U3.CC1']);  // CC1 (PD negotiation)
A.wire('netA_cc2',     '#a3e635', false, ['J8.CC2',  'U3.CC2']);  // CC2
A.wire('netA_gnd',     '#111827', false, ['J8.GND',  'U3.GNDin']);// cable GND
// PD trigger --20V (5A fuse) --> switch pole 1 --> board
A.wire('netA_20vsrc', '#fb923c', false, ['U3.V20', 'SW1.P1a']);  // 20V (via 5A fuse) -> pole 1 in
A.wire('netA_20v',    '#f97316', true,  ['SW1.P1b', 'J1.+']);     // pole 1 out -> board 20V entry (J1)
A.wire('netA_gnd',    '#111827', false, ['U3.GNDo', 'J1.-']);     // trigger GND -> board GND (NOT switched)
A.io('output', 33, 0, '5V_CHG -> Board B');
A.note('BOARD A - wall & rails. Only the USB-C port (J8) and POWER switch (SW1) are OFF the board (panel-mounted); the PD trigger U3 is ON the board. Chain: USB-C (J8) -> cable -> U3 PD trigger -> 5A fuse -> DPST POWER switch (SW1) -> J1.', 0, -1.6, '#0f172a');
A.note('USB-C port (J8, off-board panel) is cabled (VBUS+GND+CC1+CC2) to U3 on the board. 5A fuse sits inline on U3.V20 -> SW1.', -31, 1.5, '#0891b2');
A.note('SW1 = POWER button (off-board panel). Pole 1 switches the 20V bus on/off. "Off" kills the 20V bus -> Pi loses power -> boost EN drops (see Board B) -> battery isolated too. Spare 2nd pole = optional hard LiPo cutoff.', -13, 8.5, '#e11d48');
A.note('Real footprints need ~36x30 holes (~91x76mm) - larger than the doc 50x70mm. Options: bigger boards, a 3-board split, or smaller bucks (DROK 6A sync). Re-check vs the O130 bay annulus.', 0, 30.4, '#b91c1c');
A.note('J6 5V_CHG -> Board B charger; J5 BOOST_IN <- Board B. GND common across both boards.', 0, 31.6, '#334155');

// ============================================================
// BOARD B — battery (20 × 26 holes)
// ============================================================
const B = makeBoard('pip_boardB', 'Pip Power — Board B (battery)', 26, 30);
B.place('xt30', 1, 1, 'J1', 0, 'BATT_IN');
B.place('pcm1s', 5, 4, 'U1', 0, 'PCM-8A');           // 40x7mm strip across the top, body cols ~4-21 rows 3-6
B.place('ada4410', 5, 13, 'U2', 0, 'CHGR');          // lower-left, body cols ~1.5-10.5 rows 12-19
B.place('tps61088', 15, 11, 'U3', 0, 'BOOST');       // 21x40mm, body cols ~12-20 rows 10.6-26.4
B.place('capD10', 23, 11, 'C1', 0, '1000u LE');
B.place('trim', 21, 25, 'RV1', 0, '200k ADJ');
B.place('xt30', 24, 19, 'J2', 90, 'BOOST_5V');
B.place('jstxh2', 1, 21, 'J3', 0, '5V_CHG_IN');
B.place('jstxh2', 1, 24, 'J4', 0, 'STAT/GND');
B.place('res', 6, 28, 'R1', 0, '100k PD');           // boost-EN pull-down: keeps the boost OFF at cold start

B.net('netB_cell', 'VBAT_CELL', '#eab308', 'power');
B.net('netB_prot', 'VBAT_PROT', '#f59e0b', 'power');
B.net('netB_gnd', 'GND', '#111827', 'ground');
B.net('netB_chg', '5V_CHG', '#14b8a6', 'power');
B.net('netB_boost', 'BOOST_5V', '#ec4899', 'power');
B.net('netB_stat', 'CHG_STAT', '#22c55e', 'signal');
B.net('netB_boosten', 'BOOST_EN', '#f472b6', 'signal'); // gated boost enable (Pi GPIO, wall-armed)

B.wire('netB_cell', '#eab308', true, ['J1.+', 'U1.B+']);
B.wire('netB_gnd', '#111827', true, ['J1.-', 'U1.B-']);
// protected system node: PCM P+ feeds charger BAT and boost input
B.wire('netB_prot', '#f59e0b', true, ['U1.P+', 'U2.BAT', 'C1.+', 'U3.VIN+']);
B.wire('netB_gnd', '#111827', true, ['U1.P-', 'U2.GND', 'C1.-', 'U3.VIN-', 'U3.VOUT-', 'J2.-']);
B.wire('netB_chg', '#14b8a6', false, ['J3.1', 'U2.5V']);
B.wire('netB_gnd', '#111827', false, ['J3.2', 'J4.2']);
B.wire('netB_stat', '#22c55e', false, ['U2.STAT', 'J4.1']);
B.wire('netB_boost', '#ec4899', true, ['U3.VOUT+', 'J2.+']);
B.wire('netB_boost', '#ec4899', false, ['U3.VOUT+', 'RV1.3']); // ADJ sample (illustrative)
// boost ENABLE gating: pull-down holds it OFF; Pi GPIO drives it high (only after booting on wall)
B.wire('netB_boosten', '#f472b6', false, ['U3.EN', 'R1.1']);   // EN + pull-down node
B.wire('netB_gnd',     '#111827', false, ['R1.2', 'J4.2']);    // pull-down R1 to GND
B.wire('netB_boosten', '#f472b6', false, ['U3.EN', [1, 27]]);  // Pi GPIO (BOOST_EN) controls the enable
B.io('input', 0, 19, '5V_CHG <- Board A');
B.io('input', 1, 27, 'BOOST_EN <- Pi GPIO (wall-armed)');
B.io('output', 25, 20, 'BOOST_5V -> Board A');
B.note('BOARD B - battery. LiPo pouch 67x34x6 lies BESIDE the board (Velcro + foam), 7.5A fuse inline in the + lead. Keep the cell >=25mm from any converter.', 0, -1.6, '#b91c1c');
B.note('U3 boost EN is GATED: R1 pulls it LOW so the boost stays OFF until the Pi (booted on WALL) drives BOOST_EN high. Robot CANNOT power on from the battery when unplugged; the LiPo only rides a wall-loss so the Pi can WARN (~min) then shut down.', 0, 30.6, '#be185d');

// ============================================================
// Buck fit comparison — why the placed design uses the Pololu
// ============================================================
// Comparison board sized to a REAL 50x70mm protoboard (20x26 holes): the
// Pololu drops in, the XL4016E1 visibly overflows it (overhang flag fires).
const C = makeBoard('pip_buckcmp', 'Buck fit comparison (50x70mm board)', 20, 26);
C.place('d24v90f5', 1, 1, 'U1', 0, 'FITS 40x20');
C.place('xl4016', 1, 18, 'U2', 0, 'XL4016 61x41');
C.note('Both on a real 50x70mm (20x26-hole) protoboard. Pololu D24V90F5 (40.6x20.3mm) drops in. The XL4016E1 cost-down buck (61x41x27mm) overflows the board AND its 27mm height exceeds the 26mm bay - see the overhang flag in Issues.', 0, 0, '#b91c1c');

// ---------- consolidate each net into one non-redundant path ----------
// The per-connection chains above can lay several same-net wires over each
// other. Re-route each net as a single nearest-neighbour path through all its
// holes: same connectivity (every hole still chained into the net), far fewer
// overlapping segments. Non-net tracks (none here) are left untouched.
function consolidateWires(board) {
  const byNet = new Map();
  for (const t of board.tracks) {
    if (t.netId == null) continue;
    const e = byNet.get(t.netId) || { color: t.color, rail: t.rail, holes: new Map() };
    for (const p of t.points) e.holes.set(`${p.col},${p.row}`, { col: p.col, row: p.row });
    byNet.set(t.netId, e);
  }
  board.tracks = board.tracks.filter((t) => t.netId == null);
  for (const [netId, e] of byNet) {
    const holes = [...e.holes.values()];
    if (holes.length < 2) continue;
    holes.sort((a, b) => a.row - b.row || a.col - b.col);
    const order = [holes.shift()];
    while (holes.length) {
      const last = order[order.length - 1];
      let bi = 0, bd = Infinity;
      for (let i = 0; i < holes.length; i++) { const d = Math.abs(holes[i].col - last.col) + Math.abs(holes[i].row - last.row); if (d < bd) { bd = d; bi = i; } }
      order.push(holes.splice(bi, 1)[0]);
    }
    for (let i = 0; i < order.length - 1; i++)
      board.tracks.push({ id: nid('trk'), side: 'bottom', points: [order[i], order[i + 1]], netId, color: e.color, ...(e.rail ? { rail: true } : {}) });
  }
}
for (const b of [A.board, B.board]) consolidateWires(b);

// ---------- assign board sides to minimize same-side wire overlaps ----------
// Real perfboards are 2-sided; the app's overlap DRC only flags parallel runs
// on the SAME face. Treat side assignment as a 2-coloring of the nets: put nets
// whose orthogonal routes would run on top of each other on opposite faces.
// Brute-force is fine (<=~12 nets/board). Prints the residual (same-net runs
// that no side split can fix — those need a routing tweak, not a side).
function assignSides(board) {
  const orth = (pts) => {
    if (pts.length < 2) return pts.map((p) => ({ ...p }));
    const out = [{ col: pts[0].col, row: pts[0].row }];
    const push = (h) => { const l = out[out.length - 1]; if (l.col !== h.col || l.row !== h.row) out.push({ col: h.col, row: h.row }); };
    for (let i = 1; i < pts.length; i++) { const p = out[out.length - 1], c = pts[i]; if (p.col !== c.col && p.row !== c.row) push({ col: c.col, row: p.row }); push(c); }
    return out;
  };
  const segsOf = (t) => {
    const op = orth(t.points), s = [];
    for (let i = 1; i < op.length; i++) { const a = op[i - 1], b = op[i];
      if (a.row === b.row && a.col !== b.col) s.push(['h', a.row, Math.min(a.col, b.col), Math.max(a.col, b.col)]);
      else if (a.col === b.col && a.row !== b.row) s.push(['v', a.col, Math.min(a.row, b.row), Math.max(a.row, b.row)]); }
    return s;
  };
  const overlap = (A2, B2) => { for (const p of A2) for (const q of B2) { if (p[0] !== q[0] || p[1] !== q[1]) continue; if (Math.min(p[3], q[3]) - Math.max(p[2], q[2]) > 0) return true; } return false; };
  const nets = [...new Set(board.tracks.map((t) => t.netId).filter(Boolean))];
  const segByNet = new Map(nets.map((n) => [n, board.tracks.filter((t) => t.netId === n).flatMap(segsOf)]));
  const conflicts = [];
  for (let i = 0; i < nets.length; i++) for (let j = i + 1; j < nets.length; j++)
    if (overlap(segByNet.get(nets[i]), segByNet.get(nets[j]))) conflicts.push([i, j]);
  let best = 0, bestC = Infinity;
  for (let m = 0; m < (1 << nets.length); m++) { let c = 0; for (const [i, j] of conflicts) if (((m >> i) & 1) === ((m >> j) & 1)) c++; if (c < bestC) { bestC = c; best = m; if (c === 0) break; } }
  const color = new Map(nets.map((n, i) => [n, (best >> i) & 1]));
  for (const t of board.tracks) if (t.netId != null) t.side = color.get(t.netId) ? 'top' : 'bottom';
  // residual = cross-net conflicts unavoidable by 2-coloring + same-net self-overlaps
  let selfOverlap = 0;
  for (const n of nets) { const s = segByNet.get(n); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (overlap([s[i]], [s[j]])) selfOverlap++; }
  return { crossResidual: bestC, selfOverlap };
}
for (const b of [A.board, B.board]) { const r = assignSides(b); console.log(`sides ${b.name}: ${r.crossResidual} cross-net + ${r.selfOverlap} same-net overlap(s) remaining`); }

// ---------- auto-fix residual wire overlaps (same as the app's "Fix overlaps") ----------
// Shift one of each overlapping pair of segments perpendicular until the overlap
// clears, guarding against introducing a power/ground short. Ships the demo
// pre-cleaned; the app exposes the same via the toolbar button.
{
  const kk = (c, r) => `${c},${r}`;
  const afDefMap = new Map(Object.values(DEFS).map((d) => [d.id, d]));
  const orthoG = (pts) => { if (pts.length < 2) return pts.map((p) => ({ ...p })); const out = [{ col: pts[0].col, row: pts[0].row }]; const push = (h) => { const l = out[out.length - 1]; if (l.col !== h.col || l.row !== h.row) out.push({ col: h.col, row: h.row }); }; for (let i = 1; i < pts.length; i++) { const p = out[out.length - 1], c = pts[i]; if (p.col !== c.col && p.row !== c.row) push({ col: c.col, row: p.row }); push(c); } return out; };
  const dragSegG = (pts, i, d) => { const P = orthoG(pts), n = P.length; if (i < 0 || i + 1 >= n) return P; const mv = (p) => ({ col: p.col + d.col, row: p.row + d.row }); const out = []; for (let k = 0; k < n; k++) { if (k === i) { if (i === 0) { out.push({ ...P[0] }); out.push(mv(P[0])); } else out.push(mv(P[k])); } else if (k === i + 1) { if (i + 1 === n - 1) { out.push(mv(P[k])); out.push({ ...P[k] }); } else out.push(mv(P[k])); } else out.push({ ...P[k] }); } return orthoG(out); };
  const overlapsG = (board) => { const segs = []; for (const t of board.tracks) { const op = orthoG(t.points); for (let i = 0; i < op.length - 1; i++) { const a = op[i], b = op[i + 1]; if (a.row === b.row && a.col !== b.col) segs.push([t.id, t.side, i, 'h', a.row, Math.min(a.col, b.col), Math.max(a.col, b.col)]); else if (a.col === b.col && a.row !== b.row) segs.push([t.id, t.side, i, 'v', a.col, Math.min(a.row, b.row), Math.max(a.row, b.row)]); } } const out = []; for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const p = segs[i], q = segs[j]; if (p[0] === q[0] || p[1] !== q[1] || p[3] !== q[3] || p[4] !== q[4]) continue; if (Math.min(p[6], q[6]) - Math.max(p[5], q[5]) > 0) out.push({ aId: p[0], bId: q[0], bSeg: q[2], orient: p[3] }); } return out; };
  const shortCountG = (board) => { const par = new Map(); const find = (x) => { let p = par.get(x); if (p === undefined) { par.set(x, x); return x; } if (p !== x) { p = find(p); par.set(x, p); } return p; }; const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); }; for (const t of board.tracks) { const op = orthoG(t.points); for (let i = 1; i < op.length; i++) uni(kk(op[i - 1].col, op[i - 1].row), kk(op[i].col, op[i].row)); } const role = new Map(); for (const m of board.modules) { const def = afDefMap.get(m.defId); for (const pn of def.pins) { const [c, r] = worldPin(m, def, pn); const rt = find(kk(c, r)); if (pn.type === 'power' || pn.type === 'ground') { const s = role.get(rt) || new Set(); s.add(pn.type); role.set(rt, s); } } } let n = 0; for (const [, s] of role) if (s.has('power') && s.has('ground')) n++; return n; };
  const autoFixG = (board) => { const pk = (o) => [o.aId, o.bId].sort().join('|'); const base = shortCountG(board); const stuck = new Set(); const start = overlapsG(board).length; for (let it = 0; it < 400; it++) { const ovs = overlapsG(board).filter((o) => !stuck.has(pk(o))); if (!ovs.length) break; const o = ovs[0]; const t = board.tracks.find((x) => x.id === o.bId); const before = overlapsG(board).length; let ok = false; for (const mag of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) { const d = o.orient === 'h' ? { col: 0, row: mag } : { col: mag, row: 0 }; const cand = dragSegG(t.points, o.bSeg, d); if (cand.length < 2) continue; const s = t.points; t.points = cand; if (overlapsG(board).length < before && shortCountG(board) <= base) { ok = true; break; } t.points = s; } if (!ok) stuck.add(pk(o)); } return { start, end: overlapsG(board).length }; };
  for (const b of [A.board, B.board]) { const r = autoFixG(b); console.log(`autofix ${b.name}: ${r.start} -> ${r.end} wire overlap(s)`); }
}

// ---------- self-check ----------
const boards = [A.board, B.board, C.board];
const defList = Object.values(DEFS);
const defMap = new Map(defList.map((d) => [d.id, d]));
let errors = 0, warnings = 0;
const key = (c, r) => `${c},${r}`;

for (const b of boards) {
  // pin collisions + body overlaps + bounds
  const pinAt = new Map(), bodyAt = new Map();
  for (const m of b.modules) {
    const def = defMap.get(m.defId);
    for (const pn of def.pins) {
      const [c, r] = worldPin(m, def, pn);
      const k = key(c, r);
      const prev = pinAt.get(k);
      if (prev) { console.error(`ERROR ${b.name}: ${m.designator}.${pn.name} shares hole ${k} with ${prev}`); errors++; }
      else pinAt.set(k, `${m.designator}.${pn.name}`);
    }
    for (const [c, r] of bodyHoles(m, def)) {
      const k = key(c, r), prev = bodyAt.get(k);
      if (prev && prev !== m.designator) { console.error(`ERROR ${b.name}: body overlap ${m.designator} vs ${prev} @ ${k}`); errors++; bodyAt.set(k, m.designator); }
      else bodyAt.set(k, m.designator);
    }
    const br = bodyRect(m, def);
    const over = br.x < -0.5 || br.y < -0.5 || br.x + br.w > b.cols - 0.5 || br.y + br.h > b.rows - 0.5;
    if (over && !def.mayOverhang) { console.warn(`WARN  ${b.name}: ${m.designator} (${def.name}) body past board edge`); warnings++; }
  }
  // power/ground short via union-find over tracks + pins sharing holes
  const parent = new Map();
  const find = (x) => { let p = parent.get(x); if (p === undefined) { parent.set(x, x); return x; } if (p !== x) { p = find(p); parent.set(x, p); } return p; };
  const union = (a, c) => { const ra = find(a), rc = find(c); if (ra !== rc) parent.set(ra, rc); };
  for (const t of b.tracks) for (let i = 1; i < t.points.length; i++) union(key(t.points[i-1].col, t.points[i-1].row), key(t.points[i].col, t.points[i].row));
  const role = new Map();
  for (const m of b.modules) { const def = defMap.get(m.defId); for (const pn of def.pins) { const [c, r] = worldPin(m, def, pn); const rt = find(key(c, r)); if (pn.type === 'power' || pn.type === 'ground') { const s = role.get(rt) ?? new Set(); s.add(pn.type); role.set(rt, s); } } }
  for (const [, s] of role) if (s.has('power') && s.has('ground')) { console.error(`ERROR ${b.name}: power/ground short on one net`); errors++; }
}

if (errors) { console.error(`\n✗ ${errors} error(s), ${warnings} warning(s) — NOT writing.`); process.exit(1); }

// ---------- emit ----------
mkdirSync(OUT_DIR, { recursive: true });
const payload = { schemaVersion: 1, library: defList, boards };
writeFileSync(join(OUT_DIR, 'pip-power.json'), JSON.stringify(payload, null, 2));
const index = [{ file: 'pip-power.json', name: 'Pip Power (perfboard)', description: 'Two-board module power system for the Pip robot base (PERFBOARD_POWER_DESIGN.md).' }];
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
console.log(`✓ ${boards.length} boards, ${defList.length} modules, ${warnings} warning(s) (expected on the comparison board). Wrote ${join(OUT_DIR, 'pip-power.json')}`);
