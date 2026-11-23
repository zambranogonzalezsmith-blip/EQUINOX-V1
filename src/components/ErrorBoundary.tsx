import React from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  clearingCache: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', clearingCache: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      message: error?.message || 'Error inesperado en la plataforma contable.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Equinox ErrorBoundary:', error, info);
  }

  private handleClearPwaCacheAndReload = async () => {
    this.setState({ clearingCache: true });
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      try {
        sessionStorage.removeItem('eqx_preload_reload_ts');
      } catch {
        // ignore
      }
    } catch {
      // ignore cleanup failures
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      let readable = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed && parsed.error && parsed.operationType) {
          const catLabel = parsed.category ? `[${parsed.category}] ` : '';
          readable = `${catLabel}Error en Firestore (${parsed.operationType} sobre ${parsed.path || 'colección'}): ${parsed.error}`;
        }
      } catch {
        // plain string message
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a0f1d] p-6 text-[#f1f5f9]">
          <div className="w-full max-w-lg rounded-xl border border-[#c5a059] bg-[#141e33] p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-rose-500/40 bg-rose-950/30 text-rose-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="font-display text-2xl font-bold text-[#e5c178]">
              Recuperación Segura de Sesión
            </h2>
            <p className="mt-3 text-xs leading-relaxed text-[#94a3b8]">{readable}</p>
            <p className="mt-2 text-xs text-emerald-400">
              Tus asientos y libros locales en IndexedDB permanecen intactos.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-5 py-2.5 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reiniciar Plataforma
              </button>
              <button
                type="button"
                disabled={this.state.clearingCache}
                onClick={() => void this.handleClearPwaCacheAndReload()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-4 py-2.5 text-xs font-semibold text-[#e5c178] hover:border-[#c5a059] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {this.state.clearingCache ? 'Limpiando caché...' : 'Limpiar Caché PWA y Reintentar'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
