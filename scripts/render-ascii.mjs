// Renders public/designs/pip-power.json as ASCII maps (one char per hole) so a
// layout can be eyeballed without a browser. Body cells = lowercase tag, pin
// cells = UPPERCASE, edge-overhang cells = '*'. Also prints per-board issues.
//   node scripts/render-ascii.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = 2.54;
const ws = JSON.parse(readFileSync(join(HERE, '..', 'public', 'designs', 'pip-power.json'), 'utf8'));
const defMap = new Map(ws.library.map((d) => [d.id, d]));

const rotOff = (c, r, rot, W, H) => rot === 90 ? { col: H-1-r, row: c } : rot === 180 ? { col: W-1-c, row: H-1-r } : rot === 270 ? { col: r, row: W-1-c } : { col: c, row: r };
const rotPt = (x, y, rot, W1, H1) => rot === 90 ? { x: H1-y, y: x } : rot === 180 ? { x: W1-x, y: H1-y } : rot === 270 ? { x: y, y: W1-x } : { x, y };
function bodyRect(m, def) {
  const b = def.bodyMm; if (!b) return { x: m.col-0.45, y: m.row-0.45, w: def.cols-0.1, h: def.rows-0.1 };
  const W1 = def.cols-1, H1 = def.rows-1;
  const p = rotPt(b.dx/P, b.dy/P, m.rotation, W1, H1), q = rotPt((b.dx+b.w)/P, (b.dy+b.h)/P, m.rotation, W1, H1);
  return { x: m.col+Math.min(p.x,q.x), y: m.row+Math.min(p.y,q.y), w: Math.abs(q.x-p.x), h: Math.abs(q.y-p.y) };
}

for (const b of ws.boards) {
  if (!b.id.startsWith('pip')) continue;
  const W = b.cols, H = b.rows;
  const grid = Array.from({ length: H }, () => Array(W).fill('.'));
  const tag = (i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26];
  b.modules.forEach((m, i) => {
    const def = defMap.get(m.defId), t = tag(i), r = bodyRect(m, def);
    for (let c = Math.ceil(r.x); c <= Math.floor(r.x+r.w); c++)
      for (let rr = Math.ceil(r.y); rr <= Math.floor(r.y+r.h); rr++)
        if (rr>=0&&rr<H&&c>=0&&c<W) { if (grid[rr][c]==='.') grid[rr][c]=t; } else {} // in-bounds body
    // overhang markers on the border row/col
    for (let c = Math.ceil(r.x); c <= Math.floor(r.x+r.w); c++) for (let rr = Math.ceil(r.y); rr <= Math.floor(r.y+r.h); rr++) if (rr<0||rr>=H||c<0||c>=W) { /* off-board */ }
    for (const pn of def.pins) { const o = rotOff(pn.col, pn.row, m.rotation, def.cols, def.rows); const c=m.col+o.col, rr=m.row+o.row; if (rr>=0&&rr<H&&c>=0&&c<W) grid[rr][c]=t.toUpperCase(); }
  });
  console.log(`\n=== ${b.name}  (${W}×${H} holes ≈ ${(W*P).toFixed(0)}×${(H*P).toFixed(0)}mm) ===`);
  b.modules.forEach((m, i) => { const def = defMap.get(m.defId); console.log(`  ${tag(i)}/${tag(i).toUpperCase()} ${m.designator.padEnd(4)} ${def.name}`); });
  console.log('   ' + Array.from({length:W},(_,c)=>String(c%10)).join(''));
  grid.forEach((row, r) => console.log(String(r).padStart(2)+' '+row.join('')));
}
console.log('\n(lowercase = module body extent, UPPERCASE = a pin, "." = free hole)');
