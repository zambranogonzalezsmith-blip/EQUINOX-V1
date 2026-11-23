import React, { useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-md border border-[#c5a059]/60 bg-[#c5a059]/10 px-3 py-1.5 text-xs font-semibold text-[#e5c178] transition-colors hover:bg-[#c5a059]/20"
      >
        <Download className="h-3.5 w-3.5" />
        Instalar App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-md border border-[#233352] bg-[#16223b] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-[#c5a059]/50"
        >
          <Smartphone className="h-3.5 w-3.5 text-[#c5a059]" />
          Instalar en iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-lg border border-[#233352] bg-[#111a2e] p-6 shadow-xl">
              <h3 className="font-display text-lg font-semibold text-[#e5c178]">
                Instalar en iPhone / iPad
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                1. Pulsa el botón <strong>Compartir</strong> en la barra de Safari.
                <br />
                2. Desplázate y selecciona <strong>Añadir a pantalla de inicio</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-md bg-[#c5a059] py-2 text-xs font-semibold text-[#0a0f1d] transition-colors hover:bg-[#e5c178]"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
