import { useStore } from '../state/store';
import { NET_PALETTE } from '../util';

export default function PropertiesPanel() {
  const s = useStore();
  const board = s.workspace.boards.find((b) => b.id === s.currentBoardId);
  if (!board) return <div className="panel"><h3>Properties</h3></div>;

  const id = s.selection.length === 1 ? s.selection[0] : null;
  const mod = id ? board.modules.find((m) => m.id === id) : null;
  const track = id ? board.tracks.find((t) => t.id === id) : null;
  const io = id ? board.io.find((x) => x.id === id) : null;
  const ann = id ? board.annotations.find((a) => a.id === id) : null;
  const def = mod ? s.workspace.library.find((d) => d.id === mod.defId) : null;

  return (
    <div className="panel">
      <h3>Properties</h3>

      {mod && def && (
        <div className="section">
          <div className="row"><label>Module</label><span>{def.name}</span></div>
          {def.bodyMm && (
            <div className="row"><label>Body</label><span>{def.bodyMm.w} × {def.bodyMm.h} mm</span></div>
          )}
          {def.notes && <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>{def.notes}</div>}
          <div className="row">
            <label>Designator</label>
            <input type="text" value={mod.designator}
              onChange={(e) => s.patchModule(mod.id, { designator: e.target.value })} />
          </div>
          <div className="row">
            <label>Label</label>
            <input type="text" value={mod.labelOverride ?? ''} placeholder={def.name}
              onChange={(e) => s.patchModule(mod.id, { labelOverride: e.target.value || undefined })} />
          </div>
          <div className="row">
            <label>Rotation</label>
            <button onClick={() => s.rotateModule(mod.id, -1)}>⟲</button>
            <span>{mod.rotation}°</span>
            <button onClick={() => s.rotateModule(mod.id, 1)}>⟳</button>
          </div>
          <div className="row">
            <label>Position</label>
            <span>col {mod.col}, row {mod.row}</span>
          </div>
          <button className="danger" onClick={() => s.deleteEntity(mod.id)}>Delete module</button>
        </div>
      )}

      {track && (
        <div className="section">
          <div className="row"><label>Track</label><span>{track.rail ? 'Bus rail' : 'Wire'} · {track.side} side</span></div>
          <div className="row">
            <label>Net</label>
            <select value={track.netId ?? ''} onChange={(e) => {
              const v = e.target.value;
              if (v === '__new') {
                const name = prompt('New net name (e.g. SIG, 5V):');
                if (name) {
                  const color = NET_PALETTE[board.nets.length % NET_PALETTE.length];
                  const nid = s.addNet(name, color, 'signal');
                  s.updateTrack(track.id, { netId: nid, color });
                }
              } else {
                const net = board.nets.find((n) => n.id === v);
                s.updateTrack(track.id, { netId: v || undefined, color: net?.color });
              }
            }}>
              <option value="">— none —</option>
              {board.nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              <option value="__new">+ New net…</option>
            </select>
          </div>
          <div className="row">
            <label>Color</label>
            <input type="text" value={track.color ?? ''} placeholder="#94a3b8"
              onChange={(e) => s.updateTrack(track.id, { color: e.target.value || undefined })} />
          </div>
          <div className="row">
            <label>Label</label>
            <input type="text" value={track.label ?? ''}
              onChange={(e) => s.updateTrack(track.id, { label: e.target.value || undefined })} />
          </div>
          <button className="danger" onClick={() => s.deleteEntity(track.id)}>Delete track</button>
        </div>
      )}

      {io && (
        <div className="section">
          <div className="row"><label>Port</label><span>{io.kind}</span></div>
          <div className="row">
            <label>Name</label>
            <input type="text" value={io.name}
              onChange={(e) => {
                const b = s.workspace.boards.find((b) => b.id === s.currentBoardId)!;
                const x = b.io.find((p) => p.id === io.id);
                if (x) { s.updateBoardMeta({ io: b.io.map((p) => p.id === io.id ? { ...p, name: e.target.value } : p) }); }
              }} />
          </div>
          <button className="danger" onClick={() => s.deleteEntity(io.id)}>Delete port</button>
        </div>
      )}

      {ann && (
        <div className="section">
          <div className="row"><label>Text</label>
            <input type="text" value={ann.text}
              onChange={(e) => s.updateBoardMeta({ annotations: board.annotations.map((a) => a.id === ann.id ? { ...a, text: e.target.value } : a) })} />
          </div>
          <button className="danger" onClick={() => s.deleteEntity(ann.id)}>Delete text</button>
        </div>
      )}

      {!id && (
        <div className="section">
          <div className="row">
            <label>Board name</label>
            <input type="text" value={board.name} onChange={(e) => s.updateBoardMeta({ name: e.target.value })} />
          </div>
          <div className="row">
            <label>Columns</label>
            <input type="number" min={2} max={120} value={board.cols}
              onChange={(e) => s.updateBoardMeta({ cols: Math.max(2, Math.min(120, +e.target.value || 2)) })} />
          </div>
          <div className="row">
            <label>Rows</label>
            <input type="number" min={2} max={120} value={board.rows}
              onChange={(e) => s.updateBoardMeta({ rows: Math.max(2, Math.min(120, +e.target.value || 2)) })} />
          </div>
          <div className="row">
            <label>Style</label>
            <select value={board.type} onChange={(e) => s.updateBoardMeta({ type: e.target.value as any })}>
              <option value="perfboard">Plain perfboard</option>
              <option value="pad-per-hole">Pad-per-hole</option>
            </select>
          </div>
          <div className="hint">Select a module or track to edit it. Hover a hole to highlight everything connected to it.</div>
        </div>
      )}
    </div>
  );
}
