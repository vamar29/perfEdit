import { useStore } from '../state/store';

export default function LibraryPanel() {
  const library = useStore((s) => s.workspace.library);
  const s = useStore();

  return (
    <div className="panel left">
      <h3>Module Library</h3>
      <div className="section hint">
        Drag a module onto the board to place it. Design new modules with “+ New Module”.
      </div>
      {library.length === 0 && <div className="section hint">No modules yet.</div>}
      {library.map((d) => (
        <div
          key={d.id}
          className="lib-card"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', d.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <div className="name">
            <span className="swatch" style={{ background: d.color }} />
            {d.name}
          </div>
          <div className="meta">{d.cols}×{d.rows} holes · {d.pins.length} pins · {d.designatorPrefix}?</div>
          <div className="actions">
            <button onClick={() => s.editModule(d.id)}>Edit</button>
            <button className="danger" onClick={() => confirm(`Delete "${d.name}"?`) && s.deleteModuleDef(d.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
