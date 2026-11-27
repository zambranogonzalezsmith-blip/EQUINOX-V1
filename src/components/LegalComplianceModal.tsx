import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Lock,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import { PROJECT_METADATA } from '../utils/licenseCrypto';

export type LegalDocTab = 'privacidad' | 'terminos' | 'aviso' | 'seguridad';

interface LegalComplianceModalProps {
  open: boolean;
  initialTab?: LegalDocTab;
  onClose: () => void;
}

export const LegalComplianceModal: React.FC<LegalComplianceModalProps> = ({
  open,
  initialTab = 'privacidad',
  onClose,
}) => {
  const [activeDoc, setActiveDoc] = useState<LegalDocTab>(initialTab);

  useEffect(() => {
    setActiveDoc(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1060] flex items-center justify-center overflow-y-auto bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Centro Legal y Cumplimiento Web de Equinox-Books"
    >
      <div className="relative my-auto w-full max-w-4xl rounded-xl border border-[#c5a059] bg-[#0d1527] p-5 shadow-2xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#2a3b5c] pb-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-[#c5a059]/50 bg-[#c5a059]/10 p-2.5 text-[#e5c178]">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-[#e5c178]">
                Centro Legal, Privacidad y Cumplimiento Web
              </h2>
              <p className="mt-0.5 text-xs text-[#94a3b8]">
                {PROJECT_METADATA.propietario} &middot; Patente{' '}
                <span className="font-mono-tabular text-[#38edf8]">
                  SBS-2026-EQX-BOOKS-PATENT-REGISTERED
                </span>{' '}
                &middot; Contacto: {PROJECT_METADATA.contacto}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#2a3b5c] bg-[#141e33] px-3 py-1.5 text-xs font-semibold text-[#94a3b8] hover:border-[#c5a059] hover:text-[#f1f5f9]"
          >
            <X className="h-4 w-4" />
            Cerrar
          </button>
        </div>

        {/* Selector de Documentos Legales */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { id: 'privacidad' as const, label: 'Política de Privacidad', icon: Lock },
            { id: 'terminos' as const, label: 'Términos y Condiciones', icon: FileText },
            { id: 'aviso' as const, label: 'Aviso Legal y Cookies', icon: Scale },
            { id: 'seguridad' as const, label: 'Google API & Cumplimiento', icon: ShieldCheck },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeDoc === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveDoc(item.id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#c5a059] bg-[#c5a059] text-[#0a0f1d]'
                    : 'border-[#2a3b5c] bg-[#141e33] text-[#94a3b8] hover:border-[#c5a059]/60 hover:text-[#f1f5f9]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Contenido */}
        <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-5 text-xs leading-relaxed text-slate-200">
          {activeDoc === 'privacidad' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-2">
                <h3 className="text-sm font-bold text-[#e5c178]">
                  Política de Privacidad y Protección de Datos
                </h3>
                <a
                  href={`${import.meta.env.BASE_URL}privacidad.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#38edf8] hover:underline"
                >
                  Abrir URL Pública ({import.meta.env.BASE_URL}privacidad.html)
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p>
                <strong>1. Titular y Responsable:</strong> <strong>{PROJECT_METADATA.nombre_proyecto}</strong>{' '}
                es operado por <strong>{PROJECT_METADATA.propietario}</strong> ({PROJECT_METADATA.creador}).
                Para ejercer derechos de acceso, rectificación, portabilidad o supresión contáctenos en{' '}
                <span className="text-[#38edf8]">{PROJECT_METADATA.contacto}</span>.
              </p>
              <p>
                <strong>2. Datos Tratados:</strong> Únicamente almacenamos la identidad Google
                verificada (nombre, correo, UID), los datos de la plantilla CRM empresarial ingresados
                por el titular y los registros contables/fiscales cargados por cada empresa en su
                espacio privado aislado.
              </p>
              <p>
                <strong>3. Cumplimiento Google API Services (Uso Limitado):</strong> El acceso a
                Google Drive (<span className="font-mono-tabular">drive.file</span>) se solicita
                únicamente con autorización expresa del usuario para guardar, listar, restaurar o
                eliminar sus propios archivos de copia de seguridad en su carpeta privada. No vendemos
                ni compartimos datos con terceros ni los usamos para fines publicitarios o entrenamiento
                de modelos externos.
              </p>
              <p>
                <strong>4. Aislamiento Multi-Cuenta:</strong> Cada cuenta Google tiene reglas Zero-Trust
                en Cloud Firestore que impiden que un usuario lea o modifique libros de otra cuenta.
              </p>
            </>
          )}

          {activeDoc === 'terminos' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-2">
                <h3 className="text-sm font-bold text-[#e5c178]">
                  Términos y Condiciones de Servicio
                </h3>
                <a
                  href={`${import.meta.env.BASE_URL}terminos.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#38edf8] hover:underline"
                >
                  Abrir URL Pública ({import.meta.env.BASE_URL}terminos.html)
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p>
                <strong>1. Licencia de Uso Corporativo:</strong> Al autenticarse o utilizar Equinox-Books,
                el usuario recibe una licencia de uso no exclusiva para gestionar contabilidad
                multi-empresa bajo estándares NIC/VEN-NIF y normativa tributaria venezolana vigente.
              </p>
              <p>
                <strong>2. Responsabilidad Profesional y Declaraciones SENIAT:</strong> La plataforma
                asiste el registro por partida doble Cero-Float, libros legales, inventario NIC 2 y
                calendario referencial. La validación legal final de libros sellados (Código de Comercio
                Art. 32–44) y la presentación oportuna ante el SENIAT corresponden exclusivamente a la
                entidad contribuyente y a su Contador Público Colegiado (CPC).
              </p>
              <p>
                <strong>3. Propiedad Intelectual:</strong> Prohibida la reproducción no autorizada o
                alteración de la patente{' '}
                <span className="font-mono-tabular text-[#38edf8]">
                  SBS-2026-EQX-BOOKS-PATENT-REGISTERED
                </span>
                .
              </p>
            </>
          )}

          {activeDoc === 'aviso' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-2">
                <h3 className="text-sm font-bold text-[#e5c178]">
                  Aviso Legal, Patente y Política de Almacenamiento Local
                </h3>
                <a
                  href={`${import.meta.env.BASE_URL}aviso-legal.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#38edf8] hover:underline"
                >
                  Abrir URL Pública ({import.meta.env.BASE_URL}aviso-legal.html)
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p>
                <strong>Titularidad Oficial:</strong> {PROJECT_METADATA.propietario} &middot; Creador:{' '}
                {PROJECT_METADATA.creador} &middot; Registro: {PROJECT_METADATA.fecha_creacion}.
              </p>
              <p>
                <strong>Uso de Cookies y Almacenamiento Local:</strong> Esta plataforma no utiliza
                cookies de rastreo publicitario ni analítica comercial. Únicamente emplea:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[#94a3b8]">
                <li>
                  <strong className="text-slate-200">IndexedDB / Caché PWA:</strong> Operación offline
                  continua y sincronización automática al reconectar.
                </li>
                <li>
                  <strong className="text-slate-200">Sesión Google / Firebase Auth:</strong> Validación
                  segura de identidad corporativa.
                </li>
                <li>
                  <strong className="text-slate-200">Preferencia de Aviso Legal:</strong> Registro
                  local de aceptación del aviso informativo.
                </li>
              </ul>
            </>
          )}

          {activeDoc === 'seguridad' && (
            <>
              <h3 className="border-b border-[#2a3b5c] pb-2 text-sm font-bold text-[#e5c178]">
                Verificación Técnica y Legal para Despliegue Web 100%
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    title: 'URLs Legales Públicas Sin Login',
                    desc: '/privacidad.html, /terminos.html, /aviso-legal.html, /robots.txt y /sitemap.xml listos para verificación Google OAuth y buscadores.',
                  },
                  {
                    title: 'Google API Limited Use',
                    desc: 'Alcance mínimo drive.file, tokens OAuth exclusivamente en RAM JS, nunca en localStorage ni sessionStorage.',
                  },
                  {
                    title: 'Seguridad HTTP en Producción',
                    desc: 'Cabeceras HSTS, nosniff, Referrer-Policy, Permissions-Policy y COOP configuradas en Vercel y Express.',
                  },
                  {
                    title: 'Integridad Contable & Fiscal',
                    desc: 'Aritmética Cero-Float, copias SHA-256 por correo de cliente, aislamiento Zero-Trust en Firestore y marco NIC/SENIAT.',
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {item.title}
                    </div>
                    <p className="mt-1 text-[11px] text-[#94a3b8]">{item.desc}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-[#94a3b8]">
            Contacto Legal Directo:{' '}
            <strong className="text-[#f1f5f9]">{PROJECT_METADATA.contacto}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
