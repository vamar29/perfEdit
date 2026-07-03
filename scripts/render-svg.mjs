// Renders each pip board in a design JSON to a standalone SVG (openable in any
// browser / image viewer — no app needed). Mirrors the app's render: bodies as
// filled rounded rects, pins colored by type, tracks by net color, labels,
// annotations. Useful as a shareable snapshot and as agent-side verification.
//   node scripts/render-svg.mjs [path-to-design.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = 2.54, S = 16; // px per hole
const src = process.argv[2] || join(HERE, '..', 'public', 'designs', 'pip-power.json');
const ws = JSON.parse(readFileSync(src, 'utf8'));
const defMap = new Map(ws.library.map((d) => [d.id, d]));

const PIN = { input:'#22c55e', output:'#f59e0b', power:'#ef4444', ground:'#111827', passive:'#9ca3af', bidirectional:'#8b5cf6', 'no-connect':'#d1d5db' };
const rotOff = (c,r,rot,W,H) => rot===90?{col:H-1-r,row:c}:rot===180?{col:W-1-c,row:H-1-r}:rot===270?{col:r,row:W-1-c}:{col:c,row:r};
const rotPt = (x,y,rot,W1,H1) => rot===90?{x:H1-y,y:x}:rot===180?{x:W1-x,y:H1-y}:rot===270?{x:y,y:W1-x}:{x,y};
function bodyRect(m,def){ const b=def.bodyMm; if(!b){return{x:m.col-0.45,y:m.row-0.45,w:def.cols-0.1,h:def.rows-0.1};} const W1=def.cols-1,H1=def.rows-1; const p=rotPt(b.dx/P,b.dy/P,m.rotation,W1,H1),q=rotPt((b.dx+b.w)/P,(b.dy+b.h)/P,m.rotation,W1,H1); return{x:m.col+Math.min(p.x,q.x),y:m.row+Math.min(p.y,q.y),w:Math.abs(q.x-p.x),h:Math.abs(q.y-p.y)}; }
const esc = (s) => String(s).replace(/[<&>]/g, (c) => ({ '<':'&lt;','&':'&amp;','>':'&gt;' }[c]));
// keep in sync with src/domain/geometry.ts orthogonalize()
function orthogonalize(points) {
  if (points.length < 2) return points;
  const out = [{ col: points[0].col, row: points[0].row }];
  const push = (h) => { const l = out[out.length-1]; if (l.col!==h.col||l.row!==h.row) out.push({ col:h.col, row:h.row }); };
  for (let i=1;i<points.length;i++){ const p=out[out.length-1], c=points[i]; if (p.col!==c.col&&p.row!==c.row) push({col:c.col,row:p.row}); push(c); }
  return out;
}
for (const b of ws.boards) {
  if (!b.id.startsWith('pip')) continue;
  // Content bounds — include OFF-BOARD components/wires (negative coords etc.),
  // so panel-mounted parts wired in from outside the board still render.
  let minC = -0.5, maxC = b.cols - 0.5, minR = -2, maxR = b.rows - 0.5;
  const ext = (c, r) => { if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r; };
  for (const m of b.modules) { const def = defMap.get(m.defId); const r = bodyRect(m, def); ext(r.x, r.y); ext(r.x + r.w, r.y + r.h); for (const pn of def.pins) { const o = rotOff(pn.col, pn.row, m.rotation, def.cols, def.rows); ext(m.col + o.col, m.row + o.row); } }
  for (const t of b.tracks) for (const p of t.points) ext(p.col, p.row);
  for (const io of b.io) ext(io.col, io.row);
  for (const a of b.annotations) ext(a.col, a.row);
  const X = (h) => (h - minC + 2) * S, Y = (h) => (h - minR + 2) * S;
  const W = (maxC - minC + 4) * S + 300, H = (maxR - minR + 4) * S; // +300px slack for right-running text
  const el = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif">`];
  el.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f8fafc"/>`);
  el.push(`<rect x="${X(-0.5)}" y="${Y(-0.5)}" width="${b.cols*S}" height="${b.rows*S}" fill="#0e7a5f" stroke="#0b3d2e"/>`);
  for (let c=0;c<b.cols;c++) for (let r=0;r<b.rows;r++) el.push(`<circle cx="${X(c)}" cy="${Y(r)}" r="2" fill="#0b3d2e"/>`);
  // tracks
  for (const t of b.tracks) { const pts = orthogonalize(t.points).map(p=>`${X(p.col)},${Y(p.row)}`).join(' '); el.push(`<polyline points="${pts}" fill="none" stroke="${t.color||'#cbd5e1'}" stroke-width="${(t.rail?5:3)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`); }
  // modules
  b.modules.forEach((m) => {
    const def = defMap.get(m.defId); const r = bodyRect(m, def);
    el.push(`<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w*S}" height="${r.h*S}" rx="3" fill="${def.color}" opacity="0.9" stroke="#1e293b"/>`);
    el.push(`<text x="${X(r.x+r.w/2)}" y="${Y(r.y+r.h/2)-2}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${esc(m.designator)}</text>`);
    if (r.w >= 1.8) el.push(`<text x="${X(r.x+r.w/2)}" y="${Y(r.y+r.h/2)+10}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.9)">${esc(m.labelOverride||def.name)}</text>`);
    for (const pn of def.pins) { const o=rotOff(pn.col,pn.row,m.rotation,def.cols,def.rows); const c=m.col+o.col, rr=m.row+o.row; el.push(`<circle cx="${X(c)}" cy="${Y(rr)}" r="4.5" fill="${PIN[pn.type]||'#94a3b8'}" stroke="#0b3d2e"/>`); el.push(`<text x="${X(c)}" y="${Y(rr)+9}" text-anchor="middle" font-size="5.5" fill="#f8fafc">${esc(pn.name)}</text>`); }
  });
  // ports + annotations
  for (const io of b.io) { el.push(`<rect x="${X(io.col)-7}" y="${Y(io.row)-7}" width="14" height="14" rx="7" fill="${io.kind==='input'?'#0ea5e9':'#f97316'}" stroke="#0f172a"/>`); el.push(`<text x="${X(io.col)}" y="${Y(io.row)-10}" text-anchor="middle" font-size="7" fill="#0f172a">${esc(io.name)}</text>`); }
  for (const a of b.annotations) el.push(`<text x="${X(a.col)}" y="${Y(a.row)}" font-size="8.5" font-weight="600" fill="${a.color||'#0f172a'}">${esc(a.text)}</text>`);
  el.push(`<text x="${X(-0.5)}" y="16" font-size="13" font-weight="700" fill="#0f172a">${esc(b.name)} — ${b.cols}×${b.rows} holes ≈ ${(b.cols*P).toFixed(0)}×${(b.rows*P).toFixed(0)}mm</text>`);
  el.push('</svg>');
  const out = join(HERE, '..', 'public', 'designs', `${b.id}.svg`);
  writeFileSync(out, el.join('\n'));
  console.log('wrote', out);
}
