import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { LegalDocTab } from './LegalComplianceModal';

const CONSENT_STORAGE_KEY = 'eqx_legal_consent_v1';

interface LegalConsentBannerProps {
  onOpenLegalDoc: (tab: LegalDocTab) => void;
}

export const LegalConsentBanner: React.FC<LegalConsentBannerProps> = ({ onOpenLegalDoc }) => {
  const [accepted, setAccepted] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(CONSENT_STORAGE_KEY));
    } catch {
      return false;
    }
  });

  if (accepted) return null;

  const handleAccept = () => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignorar si almacenamiento local restringido
    }
    setAccepted(true);
  };

  return (
    <aside
      aria-label="Aviso Legal y de Privacidad"
      className="fixed bottom-3 left-3 right-3 z-40 mx-auto max-w-[1260px] rounded-xl border border-[#c5a059]/70 bg-[#0d1527]/95 px-4 py-3 shadow-2xl backdrop-blur"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-1 items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#e5c178]" />
          <p className="text-slate-300">
            <strong className="text-[#e5c178]">Cumplimiento Web y Privacidad:</strong> Equinox-Books
            utiliza almacenamiento local técnico (IndexedDB y sesión segura Google) para operar
            offline y resguardar tus libros sin rastreadores publicitarios. Consulta la{' '}
            <button
              type="button"
              onClick={() => onOpenLegalDoc('privacidad')}
              className="cursor-pointer font-semibold text-[#38edf8] underline-offset-2 hover:underline"
            >
              Política de Privacidad
            </button>
            , los{' '}
            <button
              type="button"
              onClick={() => onOpenLegalDoc('terminos')}
              className="cursor-pointer font-semibold text-[#38edf8] underline-offset-2 hover:underline"
            >
              Términos de Servicio
            </button>{' '}
            y el{' '}
            <button
              type="button"
              onClick={() => onOpenLegalDoc('aviso')}
              className="cursor-pointer font-semibold text-[#38edf8] underline-offset-2 hover:underline"
            >
              Aviso Legal
            </button>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAccept}
            className="cursor-pointer rounded-md bg-[#c5a059] px-4 py-1.5 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178]"
          >
            Aceptar y Continuar
          </button>
        </div>
      </div>
    </aside>
  );
};
