import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import './index.css';

// After a new version is deployed, a tab still running the old one can fail to load a lazily loaded
// screen (its file name changed). Reload once to pick up the new version instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('pocketrehab:reloaded-at') ?? 0);
  if (Date.now() - last > 10_000) {
    event.preventDefault();
    sessionStorage.setItem('pocketrehab:reloaded-at', String(Date.now()));
    window.location.reload();
  }
});

// Last-resort logging for errors outside React's tree (render errors are handled by ErrorBoundary).
// The browser's benign "ResizeObserver loop" notice is ignored.
window.addEventListener('error', (e) => {
  if (/ResizeObserver loop/.test(e.message)) e.stopImmediatePropagation();
  else console.error('PocketRehab error:', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => console.error('PocketRehab unhandled promise rejection:', e.reason));

// Service worker: caches the app shell for offline use and updates automatically.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
