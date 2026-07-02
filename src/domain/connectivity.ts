import { Board, ModuleDefinition } from './types';
import { worldPins, bodyHoles, bodyRect, holeKey, orthogonalize, segmentsOf, DEFAULT_PITCH_MM } from './geometry';

export interface WireOverlap {
  aId: string; aSeg: number; bId: string; bSeg: number;
  side: string; orient: 'h' | 'v'; fixed: number; lo: number; hi: number;
}

/**
 * Solder-order LAYERS for the wires on one board side. A wire "crosses over"
 * another when it PASSES THROUGH (interior to a segment) a hole occupied by the
 * other wire's copper or endpoint/pin — so the crossed wire must be soldered
 * first (it sits underneath). Layer 1 = wires that cross over nothing; each
 * later layer = wires whose deepest "must be under" chain is that many long.
 * Returns an array of layers (index 0 = Layer 1), each a list of track ids.
 * A pure wire↔wire crossing (both pass through the same hole) has no forced
 * order, so it's oriented deterministically (higher id on top) to avoid cycles.
 */
export function wireLayers(board: Board, side?: string): string[][] {
  const tracks = board.tracks.filter((t) => (side ? t.side === side : true));
  const occ = new Map<string, Set<string>>();      // all holes a track's copper covers
  const through = new Map<string, Set<string>>();   // holes it passes THROUGH (not vertices)
  for (const t of tracks) {
    const op = orthogonalize(t.points);
    const all = new Set<string>(), verts = new Set<string>();
    for (const p of op) verts.add(holeKey(p.col, p.row));
    for (let i = 0; i < op.length - 1; i++) {
      const a = op[i], b = op[i + 1];
      if (a.row === b.row) { const lo = Math.min(a.col, b.col), hi = Math.max(a.col, b.col); for (let c = lo; c <= hi; c++) all.add(holeKey(c, a.row)); }
      else if (a.col === b.col) { const lo = Math.min(a.row, b.row), hi = Math.max(a.row, b.row); for (let r = lo; r <= hi; r++) all.add(holeKey(a.col, r)); }
    }
    const thru = new Set<string>(); for (const h of all) if (!verts.has(h)) thru.add(h);
    occ.set(t.id, all); through.set(t.id, thru);
  }
  const ids = tracks.map((t) => t.id);
  const crossAll = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));    // every wire it crosses
  const forcedUnder = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()])); // wires that must be soldered before id
  const overOf = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));      // dependents (soldered after id)
  const overlaps = (s1: Set<string>, s2: Set<string>) => { const [a, b] = s1.size < s2.size ? [s1, s2] : [s2, s1]; for (const x of a) if (b.has(x)) return true; return false; };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const X = ids[i], Y = ids[j];
    const xOverY = overlaps(through.get(X)!, occ.get(Y)!);
    const yOverX = overlaps(through.get(Y)!, occ.get(X)!);
    if (!xOverY && !yOverX) continue;
    crossAll.get(X)!.add(Y); crossAll.get(Y)!.add(X);
    // A forced order exists only when exactly one passes over the other; a mutual
    // (clean perpendicular) crossing has no forced order — coloring handles it.
    if (xOverY && !yOverX) { forcedUnder.get(X)!.add(Y); overOf.get(Y)!.add(X); }
    else if (yOverX && !xOverY) { forcedUnder.get(Y)!.add(X); overOf.get(X)!.add(Y); }
  }
  // Process order: topological by the forced-under DAG (so a wire is coloured
  // after everything it must sit on top of); any forced cycle's leftovers are
  // appended and still coloured safely below.
  const indeg = new Map<string, number>(ids.map((id) => [id, forcedUnder.get(id)!.size]));
  const order: string[] = [];
  const queued = new Set<string>();
  const queue = ids.filter((id) => indeg.get(id) === 0).sort();
  queue.forEach((id) => queued.add(id));
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]; order.push(u);
    for (const x of overOf.get(u)!) {
      indeg.set(x, indeg.get(x)! - 1);
      if (indeg.get(x) === 0 && !queued.has(x)) { queued.add(x); queue.push(x); }
    }
  }
  for (const id of ids) if (!queued.has(id)) order.push(id); // cycle remnants
  // Greedy colouring: each wire takes the lowest layer strictly above its
  // already-placed forced-under wires AND not shared with ANY already-placed
  // crossing wire — so a layer can never contain two wires that cross.
  const layer = new Map<string, number>();
  for (const a of order) {
    let lower = 1;
    for (const b of forcedUnder.get(a)!) { const lb = layer.get(b); if (lb != null) lower = Math.max(lower, lb + 1); }
    const used = new Set<number>();
    for (const n of crossAll.get(a)!) { const ln = layer.get(n); if (ln != null) used.add(ln); }
    let L = lower; while (used.has(L)) L++;
    layer.set(a, L);
  }
  const N = ids.length ? Math.max(...ids.map((id) => layer.get(id)!)) : 0;
  const out: string[][] = Array.from({ length: N }, () => []);
  for (const id of ids) out[layer.get(id)! - 1].push(id);
  return out;
}

/**
 * Pairs of track segments on the SAME side that run on top of each other
 * (colinear, overlapping by more than a single hole). Perpendicular crossings
 * and single-hole junctions are not returned. Used by the DRC and the auto-fix.
 */
export function wireOverlaps(board: Board): WireOverlap[] {
  type S = { id: string; side: string; seg: number; orient: 'h' | 'v'; fixed: number; lo: number; hi: number };
  const segs: S[] = [];
  for (const t of board.tracks)
    for (const s of segmentsOf(t.points)) {
      const lo = s.orient === 'h' ? Math.min(s.a.col, s.b.col) : Math.min(s.a.row, s.b.row);
      const hi = s.orient === 'h' ? Math.max(s.a.col, s.b.col) : Math.max(s.a.row, s.b.row);
      segs.push({ id: t.id, side: t.side, seg: s.i, orient: s.orient, fixed: s.orient === 'h' ? s.a.row : s.a.col, lo, hi });
    }
  const out: WireOverlap[] = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      if (p.id === q.id || p.side !== q.side || p.orient !== q.orient || p.fixed !== q.fixed) continue;
      const lo = Math.max(p.lo, q.lo), hi = Math.min(p.hi, q.hi);
      if (hi - lo > 0) out.push({ aId: p.id, aSeg: p.seg, bId: q.id, bSeg: q.seg, side: p.side, orient: p.orient, fixed: p.fixed, lo, hi });
    }
  return out;
}

export interface Issue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  col?: number;
  row?: number;
  refs?: string[];   // ids of the modules/tracks this issue involves (for select-on-click)
}

class DSU {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p !== x) { p = this.find(p); this.parent.set(x, p); }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

type Role = 'power' | 'ground' | 'output';

/**
 * Derive electrical connectivity (union-find over holes) plus design issues.
 * Two elements sharing a hole are the same node; a track unions all its points.
 */
export function analyze(board: Board, library: ModuleDefinition[], pitchMm = DEFAULT_PITCH_MM) {
  const defMap = new Map(library.map((d) => [d.id, d]));
  const issues: Issue[] = [];
  const dsu = new DSU();
  const pinAt = new Map<string, string[]>();   // holeKey -> moduleIds with a pin there
  const bodyAt = new Map<string, string[]>();  // holeKey -> moduleIds whose body covers it
  const roleByHole = new Map<string, Set<Role>>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
  };
  const addRole = (k: string, role: Role) => {
    const s = roleByHole.get(k); if (s) s.add(role); else roleByHole.set(k, new Set([role]));
  };

  for (const m of board.modules) {
    const def = defMap.get(m.defId);
    if (!def) continue;
    for (const wp of worldPins(m, def)) {
      const k = holeKey(wp.col, wp.row);
      dsu.find(k);
      push(pinAt, k, m.id);
      if (wp.pin.type === 'power') addRole(k, 'power');
      else if (wp.pin.type === 'ground') addRole(k, 'ground');
      else if (wp.pin.type === 'output') addRole(k, 'output');
    }
    // Occupancy uses the PHYSICAL body extents (bodyMm when present), so
    // modules wider than their pin grid still collide correctly.
    for (const h of bodyHoles(m, def, pitchMm)) push(bodyAt, holeKey(h.col, h.row), m.id);

    const br = bodyRect(m, def, pitchMm);
    const over =
      br.x < -0.5 || br.y < -0.5 || br.x + br.w > board.cols - 0.5 || br.y + br.h > board.rows - 0.5;
    if (over && !def.mayOverhang)
      issues.push({
        id: 'overhang-' + m.id, severity: 'warning',
        message: `${m.designator} (${def.name}) body extends past the board edge`,
        col: m.col, row: m.row, refs: [m.id],
      });
  }

  const netMap = new Map(board.nets.map((n) => [n.id, n]));
  for (const t of board.tracks) {
    for (let i = 0; i < t.points.length; i++) {
      const k = holeKey(t.points[i].col, t.points[i].row);
      dsu.find(k);
      if (i > 0) dsu.union(holeKey(t.points[i - 1].col, t.points[i - 1].row), k);
    }
    if (t.netId) {
      const net = netMap.get(t.netId);
      if (net?.kind === 'power' || net?.kind === 'ground')
        for (const p of t.points) addRole(holeKey(p.col, p.row), net.kind === 'power' ? 'power' : 'ground');
    }
  }
  for (const io of board.io) dsu.find(holeKey(io.col, io.row));

  const rootByHole = new Map<string, string>();
  for (const k of dsu.parent.keys()) rootByHole.set(k, dsu.find(k));

  // Which module/track ids touch each electrical root — so a net-level issue
  // (short, shared outputs) can point at the entities to highlight.
  const entByRoot = new Map<string, Set<string>>();
  const addEnt = (root: string, id: string) => { const s = entByRoot.get(root); if (s) s.add(id); else entByRoot.set(root, new Set([id])); };
  for (const m of board.modules) {
    const def = defMap.get(m.defId); if (!def) continue;
    for (const wp of worldPins(m, def)) addEnt(dsu.find(holeKey(wp.col, wp.row)), m.id);
  }
  for (const t of board.tracks) for (const p of t.points) addEnt(dsu.find(holeKey(p.col, p.row)), t.id);
  const entitiesOnRoot = (root: string) => [...(entByRoot.get(root) ?? [])];

  const rolesByRoot = new Map<string, Set<Role>>();
  for (const [k, roles] of roleByHole) {
    const root = dsu.find(k);
    const s = rolesByRoot.get(root) ?? new Set<Role>();
    for (const r of roles) s.add(r);
    rolesByRoot.set(root, s);
  }

  const at = (root: string) => { const [c, r] = root.split(',').map(Number); return { col: c, row: r }; };

  for (const [root, roles] of rolesByRoot) {
    if (roles.has('power') && roles.has('ground'))
      issues.push({ id: 'short-' + root, severity: 'error', message: 'Power and ground are connected (short circuit)', ...at(root), refs: entitiesOnRoot(root) });
  }

  const outByRoot = new Map<string, number>();
  for (const [k, roles] of roleByHole)
    if (roles.has('output')) { const root = dsu.find(k); outByRoot.set(root, (outByRoot.get(root) ?? 0) + 1); }
  for (const [root, n] of outByRoot)
    if (n > 1) issues.push({ id: 'outs-' + root, severity: 'warning', message: `${n} outputs share a net`, ...at(root), refs: entitiesOnRoot(root) });

  for (const [k, ids] of pinAt) {
    const uniq = [...new Set(ids)];
    if (uniq.length > 1) { const { col, row } = { col: +k.split(',')[0], row: +k.split(',')[1] }; issues.push({ id: 'pinover-' + k, severity: 'error', message: 'Two modules place a pin on the same hole', col, row, refs: uniq }); }
  }

  const bodyPairs = new Set<string>();
  for (const [k, ids] of bodyAt) {
    const uniq = [...new Set(ids)];
    if (uniq.length > 1)
      for (let i = 0; i < uniq.length; i++)
        for (let j = i + 1; j < uniq.length; j++) {
          const pair = [uniq[i], uniq[j]].sort().join('|');
          if (!bodyPairs.has(pair)) {
            bodyPairs.add(pair);
            issues.push({ id: 'bodyover-' + pair, severity: 'warning', message: 'Two module bodies overlap', col: +k.split(',')[0], row: +k.split(',')[1], refs: [uniq[i], uniq[j]] });
          }
        }
  }

  // Wires may cross, but must not RUN ON TOP of each other (§ wireOverlaps).
  const overlapSeen = new Set<string>();
  for (const o of wireOverlaps(board)) {
    const pair = [o.aId, o.bId].sort().join('|');
    if (overlapSeen.has(pair)) continue;
    overlapSeen.add(pair);
    issues.push({
      id: 'wireover-' + pair, severity: 'warning',
      message: 'Wires run on top of each other (overlapping segment)',
      col: o.orient === 'h' ? o.lo : o.fixed,
      row: o.orient === 'h' ? o.fixed : o.lo,
      refs: [o.aId, o.bId],
    });
  }

  return { rootByHole, issues };
}
