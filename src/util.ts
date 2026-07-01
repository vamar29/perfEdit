export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Spreadsheet-style column names: 0->A, 25->Z, 26->AA. */
export function colName(i: number) {
  i = Math.floor(i);
  let s = '';
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

/** Lowest unused number for a designator prefix (U1, U2, ...). */
export function nextDesignator(existing: string[], prefix: string) {
  const used = new Set<number>();
  for (const d of existing)
    if (d && d.startsWith(prefix)) { const n = parseInt(d.slice(prefix.length), 10); if (!isNaN(n)) used.add(n); }
  let i = 1; while (used.has(i)) i++;
  return prefix + i;
}

/** Integer holes along a straight horizontal/vertical line, inclusive. Diagonal -> endpoints only. */
export function expandLine(a: { col: number; row: number }, b: { col: number; row: number }) {
  const pts: { col: number; row: number }[] = [];
  if (a.col === b.col) {
    const [lo, hi] = [Math.min(a.row, b.row), Math.max(a.row, b.row)];
    for (let r = lo; r <= hi; r++) pts.push({ col: a.col, row: r });
  } else if (a.row === b.row) {
    const [lo, hi] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
    for (let c = lo; c <= hi; c++) pts.push({ col: c, row: a.row });
  } else {
    pts.push({ col: a.col, row: a.row }, { col: b.col, row: b.row });
  }
  return pts;
}

export const PIN_TYPE_COLORS: Record<string, string> = {
  input: '#22c55e',
  output: '#f59e0b',
  power: '#ef4444',
  ground: '#111827',
  passive: '#9ca3af',
  bidirectional: '#8b5cf6',
  'no-connect': '#d1d5db',
};

export const PIN_TYPES = ['input', 'output', 'power', 'ground', 'passive', 'bidirectional', 'no-connect'] as const;

export const NET_PALETTE = ['#ef4444', '#111827', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

export const MODULE_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b'];
