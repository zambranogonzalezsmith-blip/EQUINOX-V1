import React, { useEffect, useState } from 'react';
import {
  licenciaOculta,
  licenciaVisible,
  md5,
  PROJECT_METADATA,
  sha256,
  SORTED_META_JSON,
} from '../utils/licenseCrypto';

import type { LegalDocTab } from './LegalComplianceModal';

interface LicenciasModuleProps {
  onOpenPresentation?: () => void;
  onOpenLegalDoc?: (tab: LegalDocTab) => void;
}

export const LicenciasModule: React.FC<LicenciasModuleProps> = ({
  onOpenPresentation,
  onOpenLegalDoc,
}) => {
  const [licOcultaStr, setLicOcultaStr] = useState('Calculando firma criptográfica...');
  const [showSplashModal, setShowSplashModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const sha = await sha256(SORTED_META_JSON);
      const md = md5(unescape(encodeURIComponent(SORTED_META_JSON)));
      const lic = licenciaOculta(sha, md);
      if (mounted) {
        setLicOcultaStr(lic);
        const metaTag = document.querySelector('meta[name="x-equinox-patent-hash"]');
        if (metaTag) metaTag.setAttribute('content', lic);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Módulo de Licencias y Patente de Software
        </h2>
        <button
          type="button"
          onClick={() => (onOpenPresentation ? onOpenPresentation() : setShowSplashModal(true))}
          className="cursor-pointer rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-[#e5c178]"
        >
          Ver Apertura Legal Oficial
        </button>
      </div>

      {/* Certificado Institucional idéntico al archivo original */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] px-5 py-9 text-center">
        <div className="eqx-seal mx-auto mb-4 h-[74px] w-[74px] text-xl">&#9878;</div>
        <div className="mx-auto mb-4 inline-block border-b border-[#2a3b5c] px-8 pb-2.5 font-serif text-sm tracking-[8px] text-[#e5c178] uppercase">
          {PROJECT_METADATA.propietario}
        </div>
        <h3 className="eqx-splash-title text-4xl font-bold tracking-[10px] uppercase">
          Equinox Books
        </h3>
        <p className="mt-2 text-xs tracking-[5px] text-[#94a3b8] uppercase">
          Balance Financiero Corporativo Perfecto
        </p>
        <p className="mt-4 text-xs leading-relaxed tracking-wider text-[#94a3b8]">
          SOFTWARE DE PROPIEDAD OFICIAL DE SMITH BUSINESS SOLUTION 2026 &middot; CREADOR: CARLOS
          SMITH ZAMBRANO GONZÁLEZ
          <br />
          FIRMA DE PATENTE: SBS-2026-EQX-BOOKS-PATENT-REGISTERED &middot; ESTÁNDAR: NORMAS
          INTERNACIONALES DE CONTABILIDAD (NIC)
        </p>
      </div>

      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
        <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
          Licencia Visible de Software
        </h3>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[#2a3b5c] bg-[#050811] p-5 font-mono text-xs whitespace-pre-wrap break-all text-[#38edf8]">
          {licenciaVisible()}
        </pre>
      </div>

      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
        <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
          Licencia Invisible / Firma Criptográfica de Patente
        </h3>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[#2a3b5c] bg-[#050811] p-5 font-mono text-xs whitespace-pre-wrap break-all text-[#38edf8]">
          {licOcultaStr}
        </pre>
      </div>

      {/* Centro de Documentación Legal para Despliegue Web */}
      <div className="rounded-lg border border-[#c5a059]/40 bg-[#0d1527] p-5">
        <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
          Cumplimiento Legal para Despliegue Público Web &amp; Google OAuth
        </h3>
        <p className="mt-3 text-xs leading-relaxed text-[#94a3b8]">
          Todos los documentos legales están disponibles tanto dentro de la plataforma como en rutas
          públicas directas para auditoría de buscadores, usuarios corporativos y verificación de
          Google Workspace:
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {onOpenLegalDoc && (
            <>
              <button
                type="button"
                onClick={() => onOpenLegalDoc('privacidad')}
                className="cursor-pointer rounded-md border border-[#c5a059] bg-[#c5a059]/15 px-3.5 py-2 text-xs font-bold text-[#e5c178] hover:bg-[#c5a059] hover:text-black"
              >
                Política de Privacidad
              </button>
              <button
                type="button"
                onClick={() => onOpenLegalDoc('terminos')}
                className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#141e33] px-3.5 py-2 text-xs font-semibold text-[#f1f5f9] hover:border-[#c5a059]"
              >
                Términos y Condiciones
              </button>
              <button
                type="button"
                onClick={() => onOpenLegalDoc('aviso')}
                className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#141e33] px-3.5 py-2 text-xs font-semibold text-[#f1f5f9] hover:border-[#c5a059]"
              >
                Aviso Legal y Cookies
              </button>
              <button
                type="button"
                onClick={() => onOpenLegalDoc('seguridad')}
                className="cursor-pointer rounded-md border border-emerald-500/40 bg-emerald-950/25 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/50"
              >
                Verificación Web 100%
              </button>
            </>
          )}
          <a
            href="/privacidad.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-[11px] text-[#38edf8] hover:border-[#38edf8]"
          >
            /privacidad.html
          </a>
          <a
            href="/terminos.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-[11px] text-[#38edf8] hover:border-[#38edf8]"
          >
            /terminos.html
          </a>
          <a
            href="/aviso-legal.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-[11px] text-[#38edf8] hover:border-[#38edf8]"
          >
            /aviso-legal.html
          </a>
        </div>
      </div>

      {/* Presentación Institucional (Apertura Legal Oficial) */}
      {showSplashModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          style={{
            background:
              'radial-gradient(circle at 50% 30%, #16223d 0%, #0a0f1d 60%, #050811 100%)',
          }}
        >
          <div className="w-full max-w-[840px] rounded-[14px] border border-[#c5a059] bg-[#0a0f1d]/85 px-8 py-12 text-center shadow-[0_0_90px_rgba(197,160,89,0.16)]">
            <div className="eqx-seal mx-auto mb-5 h-[92px] w-[92px] text-3xl">&#9878;</div>
            <div className="mx-auto mb-7 inline-block border-b border-[#2a3b5c] px-8 pb-3 font-serif text-base tracking-[10px] text-[#e5c178] uppercase">
              Smith Business Solution 2026
            </div>
            <h2 className="eqx-splash-title text-4xl font-bold tracking-[12px] uppercase sm:text-5xl">
              Equinox Books
            </h2>
            <p className="mt-3 text-xs tracking-[6px] text-[#94a3b8] uppercase">
              Sistema Contable y Auditoría Fiscal de Alta Gama
            </p>
            <div className="mx-auto my-6 h-px w-32 bg-gradient-to-r from-transparent via-[#c5a059] to-transparent" />
            <p className="mx-auto max-w-[640px] font-serif text-sm leading-relaxed text-[#f1f5f9] italic">
              <strong className="not-italic text-[#e5c178]">Smith Business Solution 2026</strong>, en
              ejercicio de sus facultades de desarrollo de software corporativo, presenta
              oficialmente <strong className="not-italic text-[#e5c178]">Equinox Books</strong>:
              solución contable de alta gama con validación de partida doble, auditoría fiscal en
              tiempo real y firma de patente{' '}
              <strong className="not-italic text-[#e5c178]">
                SBS-2026-EQX-BOOKS-PATENT-REGISTERED
              </strong>
              , en cumplimiento de los estándares contables internacionales{' '}
              <strong className="not-italic text-[#e5c178]">NIC</strong>.
            </p>
            <p className="mt-6 text-[11px] leading-loose tracking-[1.5px] text-[#94a3b8] uppercase">
              Propiedad Oficial &middot; Smith Business Solution 2026
              <br />
              Creador Principal &middot; Carlos Smith Zambrano González
              <br />
              Fecha de Registro &middot; 2026-09-08 11:00:00 UTC &middot; Desarrollo Impulsado por
              IA
              <br />
              Contacto &middot; {PROJECT_METADATA.contacto}
            </p>
            <button
              type="button"
              onClick={() => setShowSplashModal(false)}
              className="mt-7 rounded-md bg-[#c5a059] px-10 py-3 font-serif text-sm font-bold tracking-[3px] text-black uppercase transition-colors hover:bg-[#e5c178]"
            >
              Volver al Sistema
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
