import { ModuleDefinition, PlacedModule, Rotation } from './types';

export const holeKey = (col: number, row: number) => `${col},${row}`;

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

/** Body rectangle in board-hole units (padded slightly around the outer holes). */
export function bodyRect(m: PlacedModule, def: ModuleDefinition) {
  const s = rotatedSize(def, m.rotation);
  return { x: m.col - 0.45, y: m.row - 0.45, w: s.cols - 1 + 0.9, h: s.rows - 1 + 0.9 };
}

/** Data col -> render col. When viewing the back, the board mirrors horizontally. */
export function toRenderX(x: number, boardCols: number, flipped: boolean) {
  return flipped ? boardCols - 1 - x : x;
}
