import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { useStore } from './state/store';
import { saveWorkspace } from './state/persistence';

// Flush to disk on close, and ask the browser to keep our data durable.
window.addEventListener('beforeunload', () => saveWorkspace(useStore.getState().workspace));
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

createRoot(document.getElementById('root')!).render(<App />);
