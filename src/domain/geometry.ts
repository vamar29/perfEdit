import { ModuleDefinition, PlacedModule, Rotation, Hole } from './types';

export const holeKey = (col: number, row: number) => `${col},${row}`;

/** L-shaped orthogonal path between two holes (horizontal segment first). */
export function orthoElbow(a: Hole, b: Hole): Hole[] {
  if (a.col === b.col || a.row === b.row) return [{ ...a }, { ...b }];
  return [{ ...a }, { col: b.col, row: a.row }, { ...b }];
}

/**
 * Force a hole polyline onto horizontal/vertical segments only, inserting a
 * 90° corner between any two points that share neither a col nor a row.
 * Consecutive duplicates are dropped. Idempotent on already-orthogonal input.
 */
export function orthogonalize(points: Hole[]): Hole[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out: Hole[] = [{ col: points[0].col, row: points[0].row }];
  const push = (h: Hole) => {
    const l = out[out.length - 1];
    if (l.col !== h.col || l.row !== h.row) out.push({ col: h.col, row: h.row });
  };
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1], cur = points[i];
    if (prev.col !== cur.col && prev.row !== cur.row) push({ col: cur.col, row: prev.row });
    push(cur);
  }
  return out;
}

/** Orientation of the segment between two orthogonal points. */
export type SegOrient = 'h' | 'v';
export interface Segment { i: number; orient: SegOrient; a: Hole; b: Hole }

/** The H/V segments of a polyline (orthogonalized first). */
export function segmentsOf(points: Hole[]): Segment[] {
  const op = orthogonalize(points);
  const segs: Segment[] = [];
  for (let i = 0; i < op.length - 1; i++) {
    const a = op[i], b = op[i + 1];
    if (a.row === b.row && a.col !== b.col) segs.push({ i, orient: 'h', a, b });
    else if (a.col === b.col && a.row !== b.row) segs.push({ i, orient: 'v', a, b });
  }
  return segs;
}

/** Index (into the ORTHOGONALIZED points) of the segment nearest a hole. -1 if none. */
export function nearestSegmentIndex(points: Hole[], h: Hole): number {
  const segs = segmentsOf(points);
  let best = -1, bestD = Infinity;
  for (const s of segs) {
    const lo = s.orient === 'h' ? Math.min(s.a.col, s.b.col) : Math.min(s.a.row, s.b.row);
    const hi = s.orient === 'h' ? Math.max(s.a.col, s.b.col) : Math.max(s.a.row, s.b.row);
    const along = s.orient === 'h' ? h.col : h.row;
    const perp = s.orient === 'h' ? Math.abs(h.row - s.a.row) : Math.abs(h.col - s.a.col);
    const outside = along < lo ? lo - along : along > hi ? along - hi : 0;
    const d = perp + outside;
    if (d < bestD) { bestD = d; best = s.i; }
  }
  return best;
}

/**
 * Drag the segment (points[i], points[i+1]) by a perpendicular delta `d`,
 * KiCad-style: interior joints move; a fixed terminal endpoint (the wire's
 * first/last point, assumed pinned) stays put and a NEW joint is inserted so
 * the wire remains connected. Returns an orthogonalized path.
 */
export function dragSegment(points: Hole[], i: number, d: Hole): Hole[] {
  const P = orthogonalize(points);
  const n = P.length;
  if (i < 0 || i + 1 >= n) return P;
  const moved = (p: Hole): Hole => ({ col: p.col + d.col, row: p.row + d.row });
  const out: Hole[] = [];
  for (let k = 0; k < n; k++) {
    if (k === i) {
      if (i === 0) { out.push({ ...P[0] }); out.push(moved(P[0])); }   // terminal: keep + new joint
      else out.push(moved(P[k]));                                       // interior joint moves
    } else if (k === i + 1) {
      if (i + 1 === n - 1) { out.push(moved(P[k])); out.push({ ...P[k] }); } // terminal: new joint + keep
      else out.push(moved(P[k]));
    } else {
      out.push({ ...P[k] });
    }
  }
  return orthogonalize(out);
}

/** Rotate a local offset (col,row) within a w×h footprint by a quarter turn. */
export function rotateOffset(col: number, row: number, rot: Rotation, w: number, h: number) {
  switch (rot) {
    case 90:  return { col: h - 1 - row, row: col };
    case 180: return { col: w - 1 - col, row: h - 1 - row };
    case 270: return { col: row, row: w - 1 - col };
    default:  return { col, row };
  }
}

export function rotatedSize(def: { cols: number; rows: number }, rot: Rotation) {
  return rot === 90 || rot === 270
    ? { cols: def.rows, rows: def.cols }
    : { cols: def.cols, rows: def.rows };
}

/** Absolute board-hole positions of a placed module's pins. */
export function worldPins(m: PlacedModule, def: ModuleDefinition) {
  return def.pins.map((p) => {
    const o = rotateOffset(p.col, p.row, m.rotation, def.cols, def.rows);
    return { pin: p, col: m.col + o.col, row: m.row + o.row };
  });
}

export const DEFAULT_PITCH_MM = 2.54;

/**
 * Rotate a CONTINUOUS local point (hole units; hole centers at integers) with
 * the same mapping rotateOffset applies to pins, so a physical body tracks its
 * pin grid under rotation. W1/H1 are (cols-1)/(rows-1) of the unrotated def.
 */
function rotatePoint(x: number, y: number, rot: Rotation, W1: number, H1: number) {
  switch (rot) {
    case 90:  return { x: H1 - y, y: x };
    case 180: return { x: W1 - x, y: H1 - y };
    case 270: return { x: y, y: W1 - x };
    default:  return { x, y };
  }
}

/**
 * Body rectangle in board-hole units. When the definition carries a physical
 * `bodyMm` outline it is used (converted by `pitchMm` and rotated with the
 * module); otherwise the legacy behavior pads slightly around the pin grid.
 */
export function bodyRect(m: PlacedModule, def: ModuleDefinition, pitchMm = DEFAULT_PITCH_MM) {
  if (def.bodyMm) {
    const b = def.bodyMm;
    const x0 = b.dx / pitchMm, y0 = b.dy / pitchMm;
    const x1 = (b.dx + b.w) / pitchMm, y1 = (b.dy + b.h) / pitchMm;
    const W1 = def.cols - 1, H1 = def.rows - 1;
    const p = rotatePoint(x0, y0, m.rotation, W1, H1);
    const q = rotatePoint(x1, y1, m.rotation, W1, H1);
    return {
      x: m.col + Math.min(p.x, q.x),
      y: m.row + Math.min(p.y, q.y),
      w: Math.abs(q.x - p.x),
      h: Math.abs(q.y - p.y),
    };
  }
  const s = rotatedSize(def, m.rotation);
  return { x: m.col - 0.45, y: m.row - 0.45, w: s.cols - 1 + 0.9, h: s.rows - 1 + 0.9 };
}

/** Integer holes whose centers fall inside the physical body (occupancy for overlap checks). */
export function bodyHoles(m: PlacedModule, def: ModuleDefinition, pitchMm = DEFAULT_PITCH_MM) {
  const r = bodyRect(m, def, pitchMm);
  const holes: { col: number; row: number }[] = [];
  for (let c = Math.ceil(r.x); c <= Math.floor(r.x + r.w); c++)
    for (let rr = Math.ceil(r.y); rr <= Math.floor(r.y + r.h); rr++)
      holes.push({ col: c, row: rr });
  return holes;
}

/** Data col -> render col. When viewing the back, the board mirrors horizontally. */
export function toRenderX(x: number, boardCols: number, flipped: boolean) {
  return flipped ? boardCols - 1 - x : x;
}
