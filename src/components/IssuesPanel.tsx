import { useMemo } from 'react';
import { useStore } from '../state/store';
import { analyze, Issue } from '../domain/connectivity';
import { toRenderX } from '../domain/geometry';

export default function IssuesPanel() {
  const s = useStore();
  const board = s.workspace.boards.find((b) => b.id === s.currentBoardId);
  const library = s.workspace.library;
  const pitch = s.workspace.settings.pitchMm || 2.54;
  const issues = useMemo(() => (board ? analyze(board, library, pitch).issues : []), [board, library, pitch]);

  if (!board) return null;

  // Click an issue -> reveal & highlight the offending wires/modules:
  // flip to their side if needed, center on them, and select them (blue).
  const reveal = (issue: Issue) => {
    const refTracks = (issue.refs ?? []).map((id) => board.tracks.find((t) => t.id === id)).filter(Boolean) as { side: string }[];
    const sides = new Set(refTracks.map((t) => t.side));
    let flipped = board.activeSide === 'bottom';
    if (sides.size === 1) {
      const target = [...sides][0];
      if (target !== board.activeSide) { s.flipBoard(); flipped = target === 'bottom'; }
    }
    if (issue.col != null && issue.row != null) {
      const rx = toRenderX(issue.col, board.cols, flipped);
      s.setCamera({ panX: window.innerWidth * 0.4 - rx * s.scale, panY: window.innerHeight * 0.45 - issue.row * s.scale });
      s.setHoverHole({ col: issue.col, row: issue.row });
    }
    s.setTool('select');
    s.setSelection(issue.refs && issue.refs.length ? issue.refs : []);
  };

  return (
    <div className="panel" style={{ flex: 1 }}>
      <h3>Issues {issues.length ? `(${issues.length})` : ''}</h3>
      {issues.length === 0 && <div className="ok">✓ No problems detected</div>}
      {issues.map((i) => (
        <div key={i.id} className={`issue ${i.severity}`} title="Click to select the wires/modules involved" onClick={() => reveal(i)}>
          <span className="dot" />
          <span>{i.message}{i.col != null ? ` @ col ${i.col}, row ${i.row}` : ''}</span>
        </div>
      ))}
      {issues.length > 0 && <div className="hint" style={{ marginTop: 6 }}>Click an issue to highlight the parts involved.</div>}
    </div>
  );
}
