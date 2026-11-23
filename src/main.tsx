import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    registerSW({
      immediate: true,
      onRegisteredSW() {
        // Service Worker registrado para operación Offline en producción
      },
      onOfflineReady() {
        // Plataforma lista para uso Offline
      },
    });
  } else {
    // Limpiar cualquier Service Worker previo en modo desarrollo para evitar cachés obsoletos
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
