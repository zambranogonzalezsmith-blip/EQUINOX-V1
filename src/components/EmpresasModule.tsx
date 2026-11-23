import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  FolderLock,
  Lock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { DriveBackupPayload } from '../services/googleDriveBackup';
import {
  CompanyDataset,
  CompanyProfile,
  CrmEmpresaTemplate,
  MonedaFuncional,
  TipoContribuyenteVE,
} from '../types/accounting';
import { centsToStr, isValidVenezuelanRIF, todayISO } from '../utils/monetary';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';

interface EmpresasModuleProps {
  companies: CompanyProfile[];
  activeCompanyId: string;
  companyData: Record<string, CompanyDataset>;
  googleUser: User | null;
  isOnline: boolean;
  onSelectCompany: (id: string) => void;
  onCreateCompany: (company: CompanyProfile) => void;
  onUpdateCompany: (company: CompanyProfile) => void;
  onDeleteCompany: (id: string) => void;
  onAuthenticateCompanyWithGoogle: (companyId: string) => Promise<void>;
  onAuthenticateAllLocalCompanies: () => Promise<void>;
  onNotify: (msg: string, type: 'success' | 'error') => void;
  crmProfile?: CrmEmpresaTemplate | null;
  onOpenCrmModal?: () => void;
  driveConnected: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSwitchGoogleAccount: (loginHint?: string) => Promise<void>;
  onConnectGoogleDrive: () => Promise<string | null>;
  onDriveTokenExpired: () => void;
  onRestoreBackup: (payload: DriveBackupPayload) => Promise<void>;
  onBackupCompanyBooksInDrive: (companyId: string) => void;
}

export const EmpresasModule: React.FC<EmpresasModuleProps> = ({
  companies,
  activeCompanyId,
  companyData,
  googleUser,
  isOnline,
  onSelectCompany,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onAuthenticateCompanyWithGoogle,
  onAuthenticateAllLocalCompanies,
  onNotify,
  crmProfile,
  onOpenCrmModal,
  driveConnected,
  onGoogleSignIn,
  onSwitchGoogleAccount,
  onConnectGoogleDrive,
  onDriveTokenExpired,
  onRestoreBackup,
  onBackupCompanyBooksInDrive,
}) => {
  const [showDriveBackup, setShowDriveBackup] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [razonSocial, setRazonSocial] = useState('');
  const [rif, setRif] = useState('');
  const [tipoContribuyente, setTipoContribuyente] = useState<TipoContribuyenteVE>('Ordinario');
  const [actividadEconomica, setActividadEconomica] = useState('');
  const [domicilioFiscal, setDomicilioFiscal] = useState('');
  const [telefono, setTelefono] = useState('');
  const [monedaFuncional, setMonedaFuncional] = useState<MonedaFuncional>('VES');
  const [agenteRetIva, setAgenteRetIva] = useState<0 | 75 | 100>(0);
  const [agenteRetIslr, setAgenteRetIslr] = useState<boolean>(true);
  const [sujetoIgtf, setSujetoIgtf] = useState<boolean>(false);
  const [unidadTributariaBs, setUnidadTributariaBs] = useState<string>('9.00');
  const [contadorNombre, setContadorNombre] = useState('');
  const [cpcNumero, setCpcNumero] = useState('');
  const [authBusyId, setAuthBusyId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setRazonSocial('');
    setRif('');
    setTipoContribuyente('Ordinario');
    setActividadEconomica('');
    setDomicilioFiscal('');
    setTelefono('');
    setMonedaFuncional('VES');
    setAgenteRetIva(0);
    setAgenteRetIslr(true);
    setSujetoIgtf(false);
    setUnidadTributariaBs('9.00');
    setContadorNombre('');
    setCpcNumero('');
  };

  const loadForEdit = (c: CompanyProfile) => {
    setEditingId(c.id);
    setRazonSocial(c.razonSocial);
    setRif(c.rif);
    setTipoContribuyente(c.tipoContribuyente);
    setActividadEconomica(c.actividadEconomica);
    setDomicilioFiscal(c.domicilioFiscal);
    setTelefono(c.telefono);
    setMonedaFuncional(c.monedaFuncional);
    setAgenteRetIva(c.agenteRetencionIva);
    setAgenteRetIslr(c.agenteRetencionIslr);
    setSujetoIgtf(c.sujetoIgtf);
    setUnidadTributariaBs(String(c.unidadTributariaBs));
    setContadorNombre(c.contadorNombre);
    setCpcNumero(c.cpcNumero);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRif = rif.trim().toUpperCase();
    if (!razonSocial.trim() || !cleanRif) {
      onNotify('Razón Social y RIF son obligatorios.', 'error');
      return;
    }
    if (!isValidVenezuelanRIF(cleanRif)) {
      onNotify('Formato RIF inválido. Use el estándar SENIAT: J-12345678-9', 'error');
      return;
    }

    const now = new Date().toISOString();
    const utVal = parseFloat(unidadTributariaBs) || 9.0;

    if (editingId) {
      const existing = companies.find((c) => c.id === editingId);
      if (!existing) return;
      onUpdateCompany({
        ...existing,
        razonSocial: razonSocial.trim(),
        rif: cleanRif,
        tipoContribuyente,
        actividadEconomica: actividadEconomica.trim() || 'Actividad Comercial',
        domicilioFiscal: domicilioFiscal.trim() || 'Venezuela',
        telefono: telefono.trim(),
        monedaFuncional,
        agenteRetencionIva: agenteRetIva,
        agenteRetencionIslr: agenteRetIslr,
        sujetoIgtf,
        unidadTributariaBs: utVal,
        contadorNombre: contadorNombre.trim() || 'Contador Público',
        cpcNumero: cpcNumero.trim() || 'CPC-00000',
        updatedAt: now,
      });
      resetForm();
      onNotify(`Entidad ${razonSocial.trim()} actualizada.`, 'success');
      return;
    }

    const newCompany: CompanyProfile = {
      id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      razonSocial: razonSocial.trim(),
      rif: cleanRif,
      tipoContribuyente,
      actividadEconomica: actividadEconomica.trim() || 'Actividad Comercial',
      domicilioFiscal: domicilioFiscal.trim() || 'Venezuela',
      telefono: telefono.trim(),
      monedaFuncional,
      alicuotaIvaGeneral: 16,
      alicuotaIvaReducida: 8,
      agenteRetencionIva: agenteRetIva,
      agenteRetencionIslr: agenteRetIslr,
      sujetoIgtf,
      unidadTributariaBs: utVal,
      contadorNombre: contadorNombre.trim() || 'Contador Público',
      cpcNumero: cpcNumero.trim() || 'CPC-00000',
      periodoFiscalInicio: `${todayISO().slice(0, 4)}-01-01`,
      ownerUid: googleUser?.uid,
      googleAuthUid: googleUser?.uid,
      googleAuthEmail: googleUser?.email || undefined,
      googleVerified: Boolean(googleUser?.emailVerified),
      googleAuthenticatedAt: googleUser ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    onCreateCompany(newCompany);
    resetForm();
    onNotify(
      googleUser
        ? `Empresa ${newCompany.razonSocial} creada y autenticada con Google (${googleUser.email}).`
        : `Empresa ${newCompany.razonSocial} registrada localmente. Autentíquela con Google para respaldo en la nube.`,
      'success'
    );
  };

  // Estadísticas consolidadas reales multi-empresa memoizadas
  const { verifiedCount, unverifiedCount, totalActiveEntries, totalFiscalDocs, statsByCompany } =
    useMemo(() => {
      let verified = 0;
      let totalEntries = 0;
      let totalDocs = 0;
      const statsMap = new Map<string, { asientosActivos: number; totalMovimientosDeb: number }>();

      for (const c of companies) {
        if (c.googleVerified && c.googleAuthEmail) verified++;
        const data = companyData[c.id];
        const asientos = new Set<number>();
        let debSum = 0;
        for (const m of data?.diario || []) {
          if (m.estado === 'ACTIVO') {
            asientos.add(m.asiento_num);
            debSum += m.debito_centavos;
          }
        }
        totalEntries += asientos.size;
        totalDocs += (data?.documentosFiscales || []).length;
        statsMap.set(c.id, { asientosActivos: asientos.size, totalMovimientosDeb: debSum });
      }

      return {
        verifiedCount: verified,
        unverifiedCount: companies.length - verified,
        totalActiveEntries: totalEntries,
        totalFiscalDocs: totalDocs,
        statsByCompany: statsMap,
      };
    }, [companies, companyData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#e5c178]">
            Gestión Multi-Empresa Autenticada con Google
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Administre múltiples entidades jurídicas con libros independientes, perfil tributario
            SENIAT vigente y verificación individual mediante Google Auth y Firestore.
          </p>
        </div>

        {unverifiedCount > 0 && (
          <button
            type="button"
            disabled={!isOnline}
            onClick={async () => {
              setAuthBusyId('__ALL__');
              try {
                await onAuthenticateAllLocalCompanies();
              } finally {
                setAuthBusyId(null);
              }
            }}
            className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {authBusyId === '__ALL__'
              ? 'Autenticando...'
              : `Autenticar Pendientes con Google (${unverifiedCount})`}
          </button>
        )}
      </div>

      {/* Cuenta Corporativa CRM & Privacidad Multi-Cuenta */}
      {googleUser && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#c5a059]/40 bg-[#0d1527] p-4">
          <div className="space-y-1 text-xs">
            <div className="inline-flex items-center gap-1.5 font-bold text-[#e5c178]">
              <Lock className="h-3.5 w-3.5 text-emerald-400" />
              Cuenta Google Titular &amp; Plantilla CRM Privada ({googleUser.email})
            </div>
            {crmProfile?.completed ? (
              <p className="text-slate-300">
                Empresa Titular: <strong className="text-white">{crmProfile.razonSocial}</strong>{' '}
                (<span className="font-mono-tabular text-[#38edf8]">{crmProfile.rif}</span>) &middot;{' '}
                Representante: <strong>{crmProfile.representanteNombre}</strong> &middot; Privacidad:{' '}
                <strong className="text-emerald-400">
                  {crmProfile.nivelPrivacidad === 'ESTRICTO_AISLADO'
                    ? 'Aislamiento Estricto'
                    : 'Auditoría Corporativa'}
                </strong>
              </p>
            ) : (
              <p className="text-amber-300">
                Aún no has completado la plantilla CRM para vincular este correo con los datos
                específicos de tu empresa.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenCrmModal && (
              <button
                type="button"
                onClick={onOpenCrmModal}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#c5a059] bg-[#c5a059]/15 px-4 py-2 text-xs font-bold text-[#e5c178] transition-colors hover:bg-[#c5a059] hover:text-[#0a0f1d]"
              >
                <Building2 className="h-3.5 w-3.5" />
                {crmProfile?.completed ? 'Editar Plantilla CRM / Privacidad' : 'Llenar Plantilla CRM'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDriveBackup((prev) => !prev)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-950/30 px-4 py-2 text-xs font-bold text-sky-300 transition-colors hover:bg-sky-900/50"
            >
              <FolderLock className="h-3.5 w-3.5" />
              {showDriveBackup ? 'Ocultar Respaldo Google Drive' : 'Respaldo Personal Google Drive'}
            </button>
          </div>
        </div>
      )}

      {showDriveBackup && (
        <GoogleDriveBackupPanel
          googleUser={googleUser}
          crmProfile={crmProfile || null}
          companies={companies}
          companyData={companyData}
          activeCompanyId={activeCompanyId}
          isOnline={isOnline}
          driveConnected={driveConnected}
          onGoogleSignIn={onGoogleSignIn}
          onSwitchGoogleAccount={onSwitchGoogleAccount}
          onConnectGoogleDrive={onConnectGoogleDrive}
          onDriveTokenExpired={onDriveTokenExpired}
          onRestoreBackup={onRestoreBackup}
          onNotify={onNotify}
          compact
        />
      )}

      {/* Consolidado Corporativo Multi-Empresa */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5 lg:grid-cols-4">
        <div>
          <span className="text-xs text-slate-400">Empresas Registradas</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-[#f1f5f9]">
            {companies.length}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Autenticadas con Google</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-emerald-400">
            {verifiedCount} / {companies.length}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Asientos Activos Totales</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-[#e5c178]">
            {totalActiveEntries}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Comprobantes Fiscales IVA</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-sky-400">
            {totalFiscalDocs}
          </p>
        </div>
      </div>

      {/* Formulario Alta / Edición Empresa */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
          {editingId ? 'Modificar Perfil de Entidad' : 'Registrar Nueva Empresa'}
        </h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Razón Social</label>
              <input
                type="text"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Ej: Corporación Industrial del Centro C.A."
                required
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">RIF (SENIAT)</label>
              <input
                type="text"
                value={rif}
                onChange={(e) => setRif(e.target.value)}
                placeholder="J-12345678-9"
                required
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Tipo de Contribuyente</label>
              <select
                value={tipoContribuyente}
                onChange={(e) => {
                  const val = e.target.value as TipoContribuyenteVE;
                  setTipoContribuyente(val);
                  if (val === 'Especial') {
                    setAgenteRetIva(75);
                    setSujetoIgtf(true);
                  } else {
                    setAgenteRetIva(0);
                    setSujetoIgtf(false);
                  }
                }}
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="Ordinario">Contribuyente Ordinario</option>
                <option value="Especial">Contribuyente Especial (SPE)</option>
                <option value="Formal">Contribuyente Formal (Exento)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Moneda Funcional (NIC 21)
              </label>
              <select
                value={monedaFuncional}
                onChange={(e) => setMonedaFuncional(e.target.value as MonedaFuncional)}
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="VES">VES - Bolívares (Bs)</option>
                <option value="USD">USD - Dólares Estadounidenses</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Agente Retención IVA</label>
              <select
                value={agenteRetIva}
                onChange={(e) => setAgenteRetIva(Number(e.target.value) as 0 | 75 | 100)}
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value={0}>No Designado (0%)</option>
                <option value={75}>75% del Impuesto Causado</option>
                <option value={100}>100% del Impuesto Causado</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Valor Unidad Tributaria (Bs)
              </label>
              <input
                type="number"
                step="0.01"
                value={unidadTributariaBs}
                onChange={(e) => setUnidadTributariaBs(e.target.value)}
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Teléfono</label>
              <input
                type="text"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="+58 212 000-0000"
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Actividad Económica</label>
              <input
                type="text"
                value={actividadEconomica}
                onChange={(e) => setActividadEconomica(e.target.value)}
                placeholder="Comercio al por mayor, servicios, manufactura..."
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Domicilio Fiscal</label>
              <input
                type="text"
                value={domicilioFiscal}
                onChange={(e) => setDomicilioFiscal(e.target.value)}
                placeholder="Dirección fiscal registrada ante el SENIAT"
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Contador Público Responsable
              </label>
              <input
                type="text"
                value={contadorNombre}
                onChange={(e) => setContadorNombre(e.target.value)}
                placeholder="Lcdo. / Lcda."
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">N° Colegiatura (CPC)</label>
              <input
                type="text"
                value={cpcNumero}
                onChange={(e) => setCpcNumero(e.target.value)}
                placeholder="CPC-00000"
                className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-300">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={agenteRetIslr}
                onChange={(e) => setAgenteRetIslr(e.target.checked)}
                className="h-4 w-4 accent-[#c5a059]"
              />
              Agente de Retención ISLR (Decreto 1.808)
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={sujetoIgtf}
                onChange={(e) => setSujetoIgtf(e.target.checked)}
                className="h-4 w-4 accent-[#c5a059]"
              />
              Sujeto Pasivo Especial / Percepción IGTF 3%
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
            >
              <Plus className="h-3.5 w-3.5" />
              {editingId ? 'Guardar Cambios' : 'Crear y Vincular Entidad'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#16223b] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
              >
                Cancelar
              </button>
            )}
            <span className="text-xs text-slate-400">
              {googleUser
                ? `Se autenticará automáticamente bajo ${googleUser.email}`
                : 'Al conectar sesión Google podrá sincronizar la entidad en Firestore.'}
            </span>
          </div>
        </form>
      </div>

      {/* Directorio de Empresas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {companies.map((c) => {
          const isActive = c.id === activeCompanyId;
          const compStats = statsByCompany.get(c.id);
          const asientosActivos = compStats?.asientosActivos ?? 0;
          const totalMovimientosDeb = compStats?.totalMovimientosDeb ?? 0;

          return (
            <div
              key={c.id}
              className={`rounded-lg border p-5 transition-colors ${
                isActive
                  ? 'border-[#c5a059] bg-[#16223b]/80'
                  : 'border-[#2a3b5c] bg-[#0d1527] hover:border-[#3c5482]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] p-2 text-[#c5a059]">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">{c.razonSocial}</h4>
                    <p className="mt-0.5 font-mono-tabular text-xs text-slate-400">
                      RIF {c.rif} &middot; Contribuyente {c.tipoContribuyente} &middot;{' '}
                      {c.monedaFuncional}
                    </p>
                  </div>
                </div>
                {isActive && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    Activa
                  </span>
                )}
              </div>

              {/* Estado de Autenticación Google de la Entidad */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#2a3b5c]/80 bg-[#0a0f1d]/70 px-3 py-2 text-xs">
                {c.googleVerified && c.googleAuthEmail ? (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-mono-tabular">
                      Google Auth: {c.googleAuthEmail}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-300">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    <span>Pendiente de autenticación Google</span>
                  </div>
                )}
                <button
                  type="button"
                  disabled={!isOnline || authBusyId === c.id}
                  onClick={async () => {
                    setAuthBusyId(c.id);
                    try {
                      await onAuthenticateCompanyWithGoogle(c.id);
                    } finally {
                      setAuthBusyId(null);
                    }
                  }}
                  className="cursor-pointer font-semibold text-[#e5c178] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {authBusyId === c.id
                    ? 'Verificando...'
                    : c.googleVerified
                      ? 'Re-autenticar Google'
                      : 'Autenticar con Google'}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 border-y border-[#2a3b5c]/70 py-3 text-xs">
                <div>
                  <span className="text-slate-400">Asientos Activos</span>
                  <p className="font-mono-tabular font-semibold text-slate-100">
                    {asientosActivos}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Volumen Operado</span>
                  <p className="font-mono-tabular font-semibold text-slate-100">
                    {c.monedaFuncional} {centsToStr(totalMovimientosDeb)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Ret. IVA / IGTF</span>
                  <p className="font-mono-tabular font-semibold text-slate-100">
                    {c.agenteRetencionIva}% / {c.sujetoIgtf ? '3%' : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {c.contadorNombre} &middot; {c.cpcNumero}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onBackupCompanyBooksInDrive(c.id)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-sky-500/40 bg-sky-950/30 px-2.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-900/50"
                    title={`Guardar copia de seguridad de los libros de ${c.razonSocial} en Google Drive`}
                  >
                    <FolderLock className="h-3.5 w-3.5" />
                    Copia Drive
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => onSelectCompany(c.id)}
                      className="cursor-pointer rounded bg-[#c5a059] px-3 py-1.5 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
                    >
                      Operar Entidad
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => loadForEdit(c)}
                    className="cursor-pointer rounded border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#c5a059]/60"
                  >
                    Configurar
                  </button>
                  {companies.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteCompany(c.id)}
                      className="cursor-pointer rounded border border-rose-500/30 bg-rose-950/30 p-1.5 text-rose-400 hover:bg-rose-900/50"
                      title="Eliminar empresa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
