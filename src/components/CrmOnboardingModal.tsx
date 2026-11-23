import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Building2,
  CheckCircle2,
  Crown,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CompanyProfile,
  CrmEmpresaTemplate,
  MonedaFuncional,
  NivelPrivacidadCRM,
  TamanoEmpresaCRM,
  TipoContribuyenteVE,
} from '../types/accounting';
import { isValidVenezuelanRIF } from '../utils/monetary';
import { resolveUserRole } from '../utils/rbac';

interface CrmOnboardingModalProps {
  open: boolean;
  googleUser: User | null;
  existingCrm: CrmEmpresaTemplate | null;
  activeCompany: CompanyProfile;
  isSaving: boolean;
  isFirstTimeOnboarding: boolean;
  onSaveCrm: (crm: CrmEmpresaTemplate, syncToCompany: boolean) => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const CrmOnboardingModal: React.FC<CrmOnboardingModalProps> = ({
  open,
  googleUser,
  existingCrm,
  activeCompany,
  isSaving,
  isFirstTimeOnboarding,
  onSaveCrm,
  onSwitchGoogleAccount,
  onClose,
  onNotify,
}) => {
  const [razonSocial, setRazonSocial] = useState('');
  const [nombreComercial, setNombreComercial] = useState('');
  const [rif, setRif] = useState('');
  const [sectorIndustria, setSectorIndustria] = useState('');
  const [tamanoEmpresa, setTamanoEmpresa] = useState<TamanoEmpresaCRM>('Mediana');

  const [representanteNombre, setRepresentanteNombre] = useState('');
  const [representanteCargo, setRepresentanteCargo] = useState('Director General');
  const [telefonoCorporativo, setTelefonoCorporativo] = useState('');
  const [whatsappCorporativo, setWhatsappCorporativo] = useState('');
  const [ciudadEstado, setCiudadEstado] = useState('Caracas, Distrito Capital');
  const [domicilioFiscal, setDomicilioFiscal] = useState('');
  const [sitioWeb, setSitioWeb] = useState('');

  const [tipoContribuyente, setTipoContribuyente] = useState<TipoContribuyenteVE>('Ordinario');
  const [monedaFuncional, setMonedaFuncional] = useState<MonedaFuncional>('VES');
  const [contadorResponsable, setContadorResponsable] = useState('');
  const [cpcNumero, setCpcNumero] = useState('');

  const [nivelPrivacidad, setNivelPrivacidad] = useState<NivelPrivacidadCRM>('ESTRICTO_AISLADO');
  const [bloquearExportacionExterna, setBloquearExportacionExterna] = useState(false);
  const [notasCrm, setNotasCrm] = useState('');

  useEffect(() => {
    if (!open || !googleUser) return;
    if (existingCrm) {
      setRazonSocial(existingCrm.razonSocial);
      setNombreComercial(existingCrm.nombreComercial || '');
      setRif(existingCrm.rif);
      setSectorIndustria(existingCrm.sectorIndustria || '');
      setTamanoEmpresa(existingCrm.tamanoEmpresa);
      setRepresentanteNombre(existingCrm.representanteNombre);
      setRepresentanteCargo(existingCrm.representanteCargo || 'Director General');
      setTelefonoCorporativo(existingCrm.telefonoCorporativo || '');
      setWhatsappCorporativo(existingCrm.whatsappCorporativo || '');
      setCiudadEstado(existingCrm.ciudadEstado || 'Caracas, Distrito Capital');
      setDomicilioFiscal(existingCrm.domicilioFiscal || '');
      setSitioWeb(existingCrm.sitioWeb || '');
      setTipoContribuyente(existingCrm.tipoContribuyente);
      setMonedaFuncional(existingCrm.monedaFuncional);
      setContadorResponsable(existingCrm.contadorResponsable || '');
      setCpcNumero(existingCrm.cpcNumero || '');
      setNivelPrivacidad(existingCrm.nivelPrivacidad);
      setBloquearExportacionExterna(Boolean(existingCrm.bloquearExportacionExterna));
      setNotasCrm(existingCrm.notasCrm || '');
    } else {
      // Nuevo usuario registrado con Google: precargar solo lo conocido de la cuenta Google para que configure su propia empresa
      setRazonSocial('');
      setNombreComercial('');
      setRif('');
      setSectorIndustria(activeCompany.actividadEconomica || '');
      setTamanoEmpresa('Mediana');
      setRepresentanteNombre(googleUser.displayName || googleUser.email?.split('@')[0] || '');
      setRepresentanteCargo('Director / Administrador');
      setTelefonoCorporativo('');
      setWhatsappCorporativo('');
      setCiudadEstado('Caracas, Distrito Capital');
      setDomicilioFiscal('');
      setSitioWeb('');
      setTipoContribuyente('Ordinario');
      setMonedaFuncional('VES');
      setContadorResponsable(googleUser.displayName || '');
      setCpcNumero('');
      setNivelPrivacidad('ESTRICTO_AISLADO');
      setBloquearExportacionExterna(false);
      setNotasCrm('');
    }
  }, [open, googleUser, existingCrm, activeCompany.actividadEconomica]);

  if (!open || !googleUser) return null;

  const isSuperAdmin =
    resolveUserRole(googleUser.email, googleUser.emailVerified) === 'superadmin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRazon = razonSocial.trim();
    const cleanRif = rif.trim().toUpperCase();
    const cleanRep = representanteNombre.trim();

    if (cleanRazon.length < 2) {
      onNotify('Ingresa la Razón Social oficial de tu empresa para configurar la cuenta.', 'error');
      return;
    }
    if (!isValidVenezuelanRIF(cleanRif)) {
      onNotify('Formato de RIF inválido. Usa el estándar SENIAT (ej: J-40123456-7).', 'error');
      return;
    }
    if (cleanRep.length < 2) {
      onNotify('Ingresa el nombre del representante o responsable de la cuenta.', 'error');
      return;
    }

    const now = new Date().toISOString();
    const uidPrefix = googleUser.uid.slice(0, 8);
    const linkedCompanyId = existingCrm?.linkedCompanyId || `crm-emp-${uidPrefix}`;

    const payload: CrmEmpresaTemplate = {
      ownerUid: googleUser.uid,
      ownerEmail: googleUser.email || '',
      linkedCompanyId,
      razonSocial: cleanRazon,
      nombreComercial: nombreComercial.trim() || cleanRazon,
      rif: cleanRif,
      sectorIndustria: sectorIndustria.trim() || 'Servicios y Comercio',
      tamanoEmpresa,
      representanteNombre: cleanRep,
      representanteCargo: representanteCargo.trim() || 'Director General',
      telefonoCorporativo: telefonoCorporativo.trim(),
      whatsappCorporativo: whatsappCorporativo.trim(),
      domicilioFiscal: domicilioFiscal.trim() || ciudadEstado.trim() || 'Venezuela',
      ciudadEstado: ciudadEstado.trim() || 'Caracas, Venezuela',
      sitioWeb: sitioWeb.trim(),
      tipoContribuyente,
      monedaFuncional,
      contadorResponsable: contadorResponsable.trim() || cleanRep,
      cpcNumero: cpcNumero.trim() || 'CPC-00000',
      nivelPrivacidad,
      autenticacionGoogleObligatoria: true,
      bloquearExportacionExterna,
      notasCrm: notasCrm.trim(),
      completed: true,
      createdAt: existingCrm?.createdAt || now,
      updatedAt: now,
    };

    await onSaveCrm(payload, true);
  };

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Plantilla CRM Empresarial Multi-Cuenta"
    >
      <div className="my-auto w-full max-w-4xl rounded-xl border border-[#c5a059] bg-[#0d1527] shadow-2xl">
        {/* Cabecera Identidad Google & Multi-Cuenta */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#2a3b5c] bg-[#141e33] px-6 py-5 rounded-t-xl">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-[#c5a059]/60 bg-[#c5a059]/15 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-[#e5c178] uppercase">
                <Building2 className="h-3.5 w-3.5" />
                Plantilla CRM Empresarial · Multi-Cuenta
              </span>
              {isSuperAdmin ? (
                <span className="inline-flex items-center gap-1 rounded border border-[#c5a059] bg-[#c5a059]/20 px-2 py-0.5 text-[10px] font-bold text-[#e5c178] uppercase">
                  <Crown className="h-3 w-3" />
                  Super Usuario Admin
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase">
                  <UserCheck className="h-3 w-3" />
                  Cuenta Privada Aislada
                </span>
              )}
            </div>
            <h2 className="mt-2 font-display text-xl font-bold text-[#f1f5f9] sm:text-2xl">
              {isFirstTimeOnboarding
                ? 'Completa tu Plantilla CRM para Vincular esta Cuenta Google a tu Empresa'
                : 'Configuración CRM Empresarial, Privacidad y Seguridad'}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Correo titular vinculado:{' '}
              <strong className="font-mono-tabular text-[#38edf8]">{googleUser.email}</strong>{' '}
              &middot; Cada correo Google mantiene su propia base de datos privada y aislada en
              Firestore.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onSwitchGoogleAccount()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-1.5 text-xs font-semibold text-[#e5c178] hover:border-[#c5a059]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Cambiar Correo Google
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex cursor-pointer items-center justify-center rounded-md border border-[#2a3b5c] bg-[#0a0f1d] p-1.5 text-slate-400 hover:text-white"
              title="Cerrar plantilla CRM"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Formulario CRM */}
        <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto p-6 space-y-6">
          {/* Bloque 1: Identidad de la Empresa */}
          <section className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d]/70 p-4">
            <h3 className="text-xs font-bold tracking-wider text-[#c5a059] uppercase">
              1. Identidad de la Empresa Titular
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">
                  Razón Social Legal <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  placeholder="Ej: Inversiones Horizonte Andino, C.A."
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  RIF SENIAT <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={rif}
                  onChange={(e) => setRif(e.target.value.toUpperCase())}
                  placeholder="J-40123456-7"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Nombre Comercial</label>
                <input
                  type="text"
                  value={nombreComercial}
                  onChange={(e) => setNombreComercial(e.target.value)}
                  placeholder="Ej: Horizonte Corp"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Sector / Industria</label>
                <input
                  type="text"
                  value={sectorIndustria}
                  onChange={(e) => setSectorIndustria(e.target.value)}
                  placeholder="Ej: Comercio, Tecnología, Manufactura..."
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Tamaño de Entidad</label>
                <select
                  value={tamanoEmpresa}
                  onChange={(e) => setTamanoEmpresa(e.target.value as TamanoEmpresaCRM)}
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                >
                  <option value="Micro">Microempresa</option>
                  <option value="Pequeña">Pequeña Empresa</option>
                  <option value="Mediana">Mediana Empresa</option>
                  <option value="Gran Empresa">Gran Empresa</option>
                  <option value="Firma Contable">Firma / Escritorio Contable</option>
                </select>
              </div>
            </div>
          </section>

          {/* Bloque 2: Contacto CRM y Domicilio */}
          <section className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d]/70 p-4">
            <h3 className="text-xs font-bold tracking-wider text-[#c5a059] uppercase">
              2. Representante Legal &amp; Datos CRM
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Representante / Titular <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={representanteNombre}
                  onChange={(e) => setRepresentanteNombre(e.target.value)}
                  placeholder="Nombre y Apellido"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Cargo</label>
                <input
                  type="text"
                  value={representanteCargo}
                  onChange={(e) => setRepresentanteCargo(e.target.value)}
                  placeholder="Director General / Socio"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Teléfono Corporativo</label>
                <input
                  type="text"
                  value={telefonoCorporativo}
                  onChange={(e) => setTelefonoCorporativo(e.target.value)}
                  placeholder="+58 212-000-0000"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">WhatsApp Empresarial</label>
                <input
                  type="text"
                  value={whatsappCorporativo}
                  onChange={(e) => setWhatsappCorporativo(e.target.value)}
                  placeholder="+58 412-000-0000"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Ciudad / Estado</label>
                <input
                  type="text"
                  value={ciudadEstado}
                  onChange={(e) => setCiudadEstado(e.target.value)}
                  placeholder="Caracas, Distrito Capital"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Sitio Web</label>
                <input
                  type="text"
                  value={sitioWeb}
                  onChange={(e) => setSitioWeb(e.target.value)}
                  placeholder="https://empresa.com"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-xs text-slate-300">Domicilio Fiscal</label>
                <input
                  type="text"
                  value={domicilioFiscal}
                  onChange={(e) => setDomicilioFiscal(e.target.value)}
                  placeholder="Dirección fiscal registrada ante SENIAT"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Bloque 3: Configuración Contable y Fiscal */}
          <section className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d]/70 p-4">
            <h3 className="text-xs font-bold tracking-wider text-[#c5a059] uppercase">
              3. Configuración Contable NIC &amp; Régimen SENIAT
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Tipo de Contribuyente</label>
                <select
                  value={tipoContribuyente}
                  onChange={(e) => setTipoContribuyente(e.target.value as TipoContribuyenteVE)}
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                >
                  <option value="Ordinario">Ordinario</option>
                  <option value="Especial">Sujeto Pasivo Especial</option>
                  <option value="Formal">Contribuyente Formal</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Moneda Funcional (NIC 21)</label>
                <select
                  value={monedaFuncional}
                  onChange={(e) => setMonedaFuncional(e.target.value as MonedaFuncional)}
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                >
                  <option value="VES">Bolívares (VES)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Contador Público</label>
                <input
                  type="text"
                  value={contadorResponsable}
                  onChange={(e) => setContadorResponsable(e.target.value)}
                  placeholder="Lic. / Lcda."
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">Número CPC</label>
                <input
                  type="text"
                  value={cpcNumero}
                  onChange={(e) => setCpcNumero(e.target.value)}
                  placeholder="CPC-00000"
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Bloque 4: Privacidad, Seguridad Multi-Cuenta y Google Auth */}
          <section className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-4">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-emerald-400 uppercase">
              <Lock className="h-3.5 w-3.5" />
              4. Privacidad, Aislamiento y Seguridad de Cuenta Google
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Política de Privacidad de Base de Datos
                </label>
                <select
                  value={nivelPrivacidad}
                  onChange={(e) => setNivelPrivacidad(e.target.value as NivelPrivacidadCRM)}
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                >
                  <option value="ESTRICTO_AISLADO">
                    Estricto Aislado (Solo {googleUser.email})
                  </option>
                  <option value="AUDITORIA_CORPORATIVA">
                    Auditoría Corporativa (Cuenta + Supervisión Global)
                  </option>
                </select>
              </div>

              <div className="flex flex-col justify-center gap-2 text-xs text-slate-200">
                <div className="inline-flex items-center gap-2 text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  Autenticación Google Verificada Activa (UID: {googleUser.uid.slice(0, 10)}...)
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={bloquearExportacionExterna}
                    onChange={(e) => setBloquearExportacionExterna(e.target.checked)}
                    className="h-4 w-4 accent-[#c5a059]"
                  />
                  Restringir exportaciones no autorizadas fuera de esta cuenta
                </label>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">Notas CRM / Observaciones</label>
                <textarea
                  rows={2}
                  value={notasCrm}
                  onChange={(e) => setNotasCrm(e.target.value)}
                  maxLength={600}
                  placeholder="Sucursales, acuerdos de auditoría, notas de configuración interna..."
                  className="w-full rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2a3b5c] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#141e33] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white"
            >
              {isFirstTimeOnboarding ? 'Explorar Libros Primero' : 'Cancelar'}
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-6 py-2.5 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isSaving
                ? 'Guardando en Base de Datos Privada...'
                : 'Guardar Plantilla CRM y Trabajar con esta Empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
