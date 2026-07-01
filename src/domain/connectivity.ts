import { Board, ModuleDefinition } from './types';
import { worldPins, rotatedSize, holeKey } from './geometry';

export interface Issue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  col?: number;
  row?: number;
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
export function analyze(board: Board, library: ModuleDefinition[]) {
  const defMap = new Map(library.map((d) => [d.id, d]));
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
    const s = rotatedSize(def, m.rotation);
    for (let c = 0; c < s.cols; c++)
      for (let r = 0; r < s.rows; r++)
        push(bodyAt, holeKey(m.col + c, m.row + r), m.id);
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

  const rolesByRoot = new Map<string, Set<Role>>();
  for (const [k, roles] of roleByHole) {
    const root = dsu.find(k);
    const s = rolesByRoot.get(root) ?? new Set<Role>();
    for (const r of roles) s.add(r);
    rolesByRoot.set(root, s);
  }

  const issues: Issue[] = [];
  const at = (root: string) => { const [c, r] = root.split(',').map(Number); return { col: c, row: r }; };

  for (const [root, roles] of rolesByRoot) {
    if (roles.has('power') && roles.has('ground'))
      issues.push({ id: 'short-' + root, severity: 'error', message: 'Power and ground are connected (short circuit)', ...at(root) });
  }

  const outByRoot = new Map<string, number>();
  for (const [k, roles] of roleByHole)
    if (roles.has('output')) { const root = dsu.find(k); outByRoot.set(root, (outByRoot.get(root) ?? 0) + 1); }
  for (const [root, n] of outByRoot)
    if (n > 1) issues.push({ id: 'outs-' + root, severity: 'warning', message: `${n} outputs share a net`, ...at(root) });

  for (const [k, ids] of pinAt) {
    const uniq = [...new Set(ids)];
    if (uniq.length > 1) { const { col, row } = { col: +k.split(',')[0], row: +k.split(',')[1] }; issues.push({ id: 'pinover-' + k, severity: 'error', message: 'Two modules place a pin on the same hole', col, row }); }
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
            issues.push({ id: 'bodyover-' + pair, severity: 'warning', message: 'Two module bodies overlap', col: +k.split(',')[0], row: +k.split(',')[1] });
          }
        }
  }

  return { rootByHole, issues };
}
