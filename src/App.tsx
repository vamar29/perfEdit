import { useEffect } from 'react';
import { useStore } from './state/store';
import Toolbar from './components/Toolbar';
import LibraryPanel from './components/LibraryPanel';
import PropertiesPanel from './components/PropertiesPanel';
import IssuesPanel from './components/IssuesPanel';
import BoardStage from './canvas/BoardStage';
import ModuleDesigner from './canvas/ModuleDesigner';

export default function App() {
  const view = useStore((s) => s.view);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
      if (typing) return;
      const s = useStore.getState();
      if (s.view === 'designer') return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo(); else s.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (meta) return;

      switch (e.key) {
        case 'v': case 'V': s.setTool('select'); break;
        case 'w': case 'W': s.setTool('wire'); break;
        case 't': case 'T': s.setTool('text'); break;
        case 'r': case 'R':
          s.selection.forEach((id) => s.rotateModule(id, e.shiftKey ? -1 : 1));
          break;
        case 'f': case 'F': s.flipBoard(); break;
        case 'Delete': case 'Backspace': e.preventDefault(); s.deleteSelected(); break;
        case 'Escape': s.cancelWire(); s.setSelection([]); s.setTool('select'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="body">
        {view === 'designer' ? (
          <ModuleDesigner />
        ) : (
          <>
            <LibraryPanel />
            <div className="canvas-wrap">
              <BoardStage />
              <div className="overlay-hint">
                Wheel = pan · ⌘/pinch = zoom · R rotate · F flip · Del delete · ⌘Z undo
              </div>
            </div>
            <div className="panel right">
              <PropertiesPanel />
              <IssuesPanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
