import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const CHUNK_RELOAD_GUARD_KEY = 'eqx_preload_reload_ts';

// Recuperación automática si un despliegue nuevo en Vercel/CDN invalida un chunk diferido
window.addEventListener('vite:preloadError', (event) => {
  try {
    const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || '0');
    if (Date.now() - lastReload > 15000) {
      sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()));
      event.preventDefault();
      window.location.reload();
    }
  } catch {
    // Ignorar si sessionStorage está restringido
  }
});

// Registro seguro del Service Worker PWA (solo en producción)
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    try {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          void updateSW(true);
        },
        onRegisterError(error) {
          console.warn('Registro PWA omitido en este entorno:', error);
        },
      });
    } catch {
      // No bloquear render inicial si el navegador restringe Service Workers
    }
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) {
          void reg.unregister();
        }
      })
      .catch(() => {});
  }
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
