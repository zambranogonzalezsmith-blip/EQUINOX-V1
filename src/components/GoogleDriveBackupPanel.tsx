import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FolderLock,
  HardDriveDownload,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { getDriveAccessTokenForUser } from '../firebase';
import {
  computeBooksSummary,
  deleteAccountBackupFromDrive,
  downloadAccountBackupFromDrive,
  DriveAuthExpiredError,
  DriveBackupFileItem,
  DriveBackupPayload,
  filterOwnedAccountData,
  getCompanyBackupSubfolderName,
  getUserBackupFolderName,
  listAccountBackupsFromDrive,
  uploadAccountBackupToDrive,
  uploadCompanyBooksBackupToDrive,
} from '../services/googleDriveBackup';
import { CompanyDataset, CompanyProfile, CrmEmpresaTemplate } from '../types/accounting';

interface GoogleDriveBackupPanelProps {
  googleUser: User | null;
  crmProfile: CrmEmpresaTemplate | null;
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
  activeCompanyId: string;
  isOnline: boolean;
  driveConnected: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSwitchGoogleAccount?: (loginHint?: string) => Promise<void>;
  onConnectGoogleDrive: () => Promise<string | null>;
  onDriveTokenExpired: () => void;
  onRestoreBackup: (payload: DriveBackupPayload) => Promise<void>;
  onNotify: (msg: string, type: 'success' | 'error') => void;
  compact?: boolean;
}

type PendingConfirmation =
  | {
      type: 'RESTORE';
      file: DriveBackupFileItem;
      payload: DriveBackupPayload;
      checksumValid: boolean;
    }
  | {
      type: 'DELETE';
      file: DriveBackupFileItem;
    };

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

const GoogleLogoSvg: React.FC = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export const GoogleDriveBackupPanel: React.FC<GoogleDriveBackupPanelProps> = ({
  googleUser,
  crmProfile,
  companies,
  companyData,
  activeCompanyId,
  isOnline,
  driveConnected,
  onGoogleSignIn,
  onSwitchGoogleAccount,
  onConnectGoogleDrive,
  onDriveTokenExpired,
  onRestoreBackup,
  onNotify,
  compact = false,
}) => {
  const [backupNote, setBackupNote] = useState('');
  const [backups, setBackups] = useState<DriveBackupFileItem[]>([]);
  const [folderName, setFolderName] = useState<string>('');
  const [loadingList, setLoadingList] = useState(false);
  const [creatingMode, setCreatingMode] = useState<'COMPANY' | 'ACCOUNT' | null>(null);
  const [preparingFileId, setPreparingFileId] = useState<string | null>(null);
  const [executingConfirm, setExecutingConfirm] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [filterScope, setFilterScope] = useState<'ALL' | 'ACTIVE_COMPANY'>('ALL');

  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) || companies[0],
    [activeCompanyId, companies]
  );

  const activeDataset = useMemo(
    () => (activeCompany ? companyData[activeCompany.id] : undefined),
    [activeCompany, companyData]
  );

  const activeBooksSummary = useMemo(
    () => computeBooksSummary(activeDataset),
    [activeDataset]
  );

  const ownedSummary = useMemo(() => {
    if (!googleUser) {
      return {
        companiesCount: 0,
        asientosCount: 0,
        docsCount: 0,
        productosCount: 0,
      };
    }
    const filtered = filterOwnedAccountData(googleUser, companies, companyData, activeCompanyId);
    return {
      companiesCount: filtered.ownedCompanies.length,
      asientosCount: filtered.totalAsientos,
      docsCount: filtered.totalDocsFiscales,
      productosCount: filtered.totalProductos,
    };
  }, [activeCompanyId, companies, companyData, googleUser]);

  const activeEmailLower = (googleUser?.email || '').trim().toLowerCase();
  const clientEmailLower = (activeCompany?.googleAuthEmail || '').trim().toLowerCase();
  const isClientEmailMismatch =
    Boolean(googleUser) && Boolean(clientEmailLower) && activeEmailLower !== clientEmailLower;

  const targetFolderLabel = googleUser?.email
    ? `${getUserBackupFolderName(googleUser.email)}${activeCompany ? ` / ${getCompanyBackupSubfolderName(activeCompany)}` : ''}`
    : 'Equinox-Books Backups';

  const visibleBackups = useMemo(() => {
    if (filterScope === 'ALL' || !activeCompany) return backups;
    return backups.filter(
      (b) => b.companyId === activeCompany.id || b.companyRif === activeCompany.rif
    );
  }, [activeCompany, backups, filterScope]);

  const loadBackupsList = useCallback(
    async (silent = false) => {
      if (!googleUser?.email || !isOnline) return;
      const token = getDriveAccessTokenForUser(googleUser.uid, googleUser.email);
      if (!token) return;

      setLoadingList(true);
      try {
        const res = await listAccountBackupsFromDrive(token, googleUser.email);
        setFolderName(res.folderName);
        setBackups(res.files);
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          onDriveTokenExpired();
        }
        if (!silent) {
          onNotify(
            err instanceof Error ? err.message : 'No se pudieron consultar las copias en Drive.',
            'error'
          );
        }
      } finally {
        setLoadingList(false);
      }
    },
    [googleUser, isOnline, onDriveTokenExpired, onNotify]
  );

  useEffect(() => {
    if (!googleUser?.email || !driveConnected || !isOnline) {
      if (!googleUser || !driveConnected) {
        setBackups([]);
      }
      return;
    }
    void loadBackupsList(true);
  }, [driveConnected, googleUser, isOnline, loadBackupsList]);

  const ensureActiveDriveToken = async (): Promise<string | null> => {
    if (!googleUser) {
      await onGoogleSignIn();
      return null;
    }
    const existing = getDriveAccessTokenForUser(googleUser.uid, googleUser.email);
    if (existing) return existing;
    setConnectingDrive(true);
    try {
      const token = await onConnectGoogleDrive();
      return token;
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleConnectDriveClick = async () => {
    setConnectingDrive(true);
    try {
      const token = await onConnectGoogleDrive();
      if (token && googleUser?.email) {
        const res = await listAccountBackupsFromDrive(token, googleUser.email);
        setFolderName(res.folderName);
        setBackups(res.files);
        onNotify(
          `Google Drive conectado exclusivamente para ${googleUser.email}.`,
          'success'
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'No se pudo conectar Google Drive.',
        'error'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleCreateCompanyBooksBackup = async () => {
    if (!googleUser?.email || !activeCompany) {
      onNotify('Inicia sesión con el correo del cliente para guardar los libros en su Drive.', 'error');
      return;
    }
    if (!isOnline) {
      onNotify('Se requiere conexión a internet para guardar los libros en Google Drive.', 'error');
      return;
    }
    if (isClientEmailMismatch) {
      onNotify(
        `Los libros de ${activeCompany.razonSocial} pertenecen al correo ${activeCompany.googleAuthEmail}. Cambia a esa cuenta Google para respaldar en su correo.`,
        'error'
      );
      return;
    }

    setCreatingMode('COMPANY');
    try {
      const token = await ensureActiveDriveToken();
      if (!token) return;

      const uploaded = await uploadCompanyBooksBackupToDrive(token, googleUser, {
        company: activeCompany,
        dataset:
          activeDataset || {
            catalogo: [],
            diario: [],
            nextId: 1,
            exchangeRates: {},
            cierres: [],
            inventario: { productos: [], movimientos: [], movSeq: 0 },
            documentosFiscales: [],
            retencionesIslr: [],
            excedenteIvaAnteriorCentavos: 0,
            updatedAt: new Date().toISOString(),
          },
        note: backupNote,
      });

      setBackupNote('');
      setBackups((prev) => [uploaded, ...prev.filter((item) => item.id !== uploaded.id)]);
      onNotify(
        `Libros de ${activeCompany.razonSocial} guardados en el Drive personal de ${googleUser.email}: ${uploaded.name}`,
        'success'
      );
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onDriveTokenExpired();
      }
      onNotify(
        err instanceof Error ? err.message : 'Error al respaldar los libros en Google Drive.',
        'error'
      );
    } finally {
      setCreatingMode(null);
    }
  };

  const handleCreateFullAccountBackup = async () => {
    if (!googleUser?.email) {
      onNotify('Inicia sesión con Google para respaldar tu cuenta en Drive.', 'error');
      return;
    }
    if (!isOnline) {
      onNotify('Se requiere conexión a internet para guardar la copia en Google Drive.', 'error');
      return;
    }

    setCreatingMode('ACCOUNT');
    try {
      const token = await ensureActiveDriveToken();
      if (!token) return;

      const uploaded = await uploadAccountBackupToDrive(token, googleUser, {
        crmProfile,
        companies,
        companyData,
        activeCompanyId,
        note: backupNote,
      });

      setBackupNote('');
      setBackups((prev) => [uploaded, ...prev.filter((item) => item.id !== uploaded.id)]);
      onNotify(
        `Copia completa guardada en el Google Drive personal de ${googleUser.email}: ${uploaded.name}`,
        'success'
      );
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onDriveTokenExpired();
      }
      onNotify(
        err instanceof Error ? err.message : 'Error al subir la copia completa a Google Drive.',
        'error'
      );
    } finally {
      setCreatingMode(null);
    }
  };

  const handlePrepareRestore = async (file: DriveBackupFileItem) => {
    if (!googleUser?.email || !isOnline) return;
    setPreparingFileId(file.id);
    try {
      const token = await ensureActiveDriveToken();
      if (!token) return;
      const { payload, checksumValid } = await downloadAccountBackupFromDrive(
        token,
        file.id,
        googleUser
      );
      setPendingConfirm({
        type: 'RESTORE',
        file,
        payload,
        checksumValid,
      });
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onDriveTokenExpired();
      }
      onNotify(
        err instanceof Error ? err.message : 'No se pudo descargar la copia desde Google Drive.',
        'error'
      );
    } finally {
      setPreparingFileId(null);
    }
  };

  const handleExecuteConfirmation = async () => {
    if (!pendingConfirm || !googleUser?.email) return;
    setExecutingConfirm(true);
    try {
      if (pendingConfirm.type === 'RESTORE') {
        await onRestoreBackup(pendingConfirm.payload);
        setPendingConfirm(null);
      } else {
        const token = await ensureActiveDriveToken();
        if (!token) return;
        await deleteAccountBackupFromDrive(token, pendingConfirm.file.id);
        setBackups((prev) => prev.filter((b) => b.id !== pendingConfirm.file.id));
        onNotify(
          `Archivo de respaldo eliminado de tu Google Drive (${pendingConfirm.file.name}).`,
          'success'
        );
        setPendingConfirm(null);
      }
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        onDriveTokenExpired();
      }
      onNotify(
        err instanceof Error ? err.message : 'Error al ejecutar la operación en Google Drive.',
        'error'
      );
    } finally {
      setExecutingConfirm(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#c5a059]/50 bg-[#0d1527] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#2a3b5c] pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <FolderLock className="h-5 w-5 text-[#e5c178]" />
            <h3 className="text-base font-bold text-[#e5c178]">
              Copias de Seguridad de Libros en el Correo de Cada Cliente (Google Drive)
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-[#94a3b8]">
            Resguarda los datos cargados en todos los libros (Diario, Mayor, Catálogo NIC,
            Inventario NIC 2, Libros Fiscales SENIAT, Retenciones ISLR y Cierres) directamente en el{' '}
            <strong className="text-[#f1f5f9]">Google Drive personal del correo del cliente</strong>{' '}
            dentro de{' '}
            <span className="font-mono-tabular text-[#38edf8]">{targetFolderLabel}</span>.
          </p>
        </div>

        {googleUser ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <Lock className="h-3.5 w-3.5" />
              Correo del Cliente Activo: {googleUser.email}
            </span>
          </div>
        ) : null}
      </div>

      {/* Cliente / Empresa Activa cuyo libros se están respaldando */}
      {activeCompany && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] px-4 py-3 text-xs">
          <div className="flex items-start gap-2.5">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#c5a059]" />
            <div>
              <div className="font-semibold text-[#f1f5f9]">
                Cliente / Empresa Seleccionada: {activeCompany.razonSocial}{' '}
                <span className="font-mono-tabular text-[#38edf8]">({activeCompany.rif})</span>
              </div>
              <div className="mt-0.5 text-[#94a3b8]">
                Correo destino en Google Drive:{' '}
                <strong className="text-[#e5c178]">
                  {activeCompany.googleAuthEmail || googleUser?.email || 'Sin autenticar'}
                </strong>
              </div>
            </div>
          </div>

          {isClientEmailMismatch && onSwitchGoogleAccount && (
            <button
              type="button"
              onClick={() => void onSwitchGoogleAccount(activeCompany.googleAuthEmail)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-900/50"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Cambiar a correo {activeCompany.googleAuthEmail}
            </button>
          )}
        </div>
      )}

      {/* Desglose de Datos Cargados en los Libros del Cliente Activo */}
      {activeCompany && (
        <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-3.5 sm:grid-cols-5">
          <div>
            <span className="text-[11px] text-[#94a3b8]">Libro Diario</span>
            <p className="mt-0.5 font-mono-tabular text-sm font-bold text-[#e5c178]">
              {activeBooksSummary.asientosActivos} asient. ({activeBooksSummary.lineasDiario} lín.)
            </p>
          </div>
          <div>
            <span className="text-[11px] text-[#94a3b8]">Catálogo NIC</span>
            <p className="mt-0.5 font-mono-tabular text-sm font-bold text-[#f1f5f9]">
              {activeBooksSummary.cuentasCatalogo} cuentas
            </p>
          </div>
          <div>
            <span className="text-[11px] text-[#94a3b8]">Inventario NIC 2</span>
            <p className="mt-0.5 font-mono-tabular text-sm font-bold text-[#34d399]">
              {activeBooksSummary.productosInventario} ítems / {activeBooksSummary.movimientosInventario} mov.
            </p>
          </div>
          <div>
            <span className="text-[11px] text-[#94a3b8]">Fiscales IVA / ISLR</span>
            <p className="mt-0.5 font-mono-tabular text-sm font-bold text-[#38edf8]">
              {activeBooksSummary.documentosFiscales} IVA / {activeBooksSummary.retencionesIslr} ISLR
            </p>
          </div>
          <div>
            <span className="text-[11px] text-[#94a3b8]">Cierres &amp; BCV</span>
            <p className="mt-0.5 font-mono-tabular text-sm font-bold text-[#f1f5f9]">
              {activeBooksSummary.cierresContables} cierres / {activeBooksSummary.tasasBcvCount} BCV
            </p>
          </div>
        </div>
      )}

      {/* Estado de Autenticación y Conexión a Drive */}
      {!googleUser ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4">
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-[#f1f5f9]">
              Inicia sesión con el correo Google del cliente para guardar los libros en su Drive
            </p>
            <p className="text-[#94a3b8]">
              Cada cliente resguarda sus libros contables exclusivamente bajo su propio correo.
            </p>
          </div>
          <button
            type="button"
            disabled={!isOnline}
            onClick={() => void onGoogleSignIn()}
            className="inline-flex cursor-pointer items-center gap-2.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleLogoSvg />
            <span>Sign in with Google</span>
          </button>
        </div>
      ) : !driveConnected ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-4">
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-[#e5c178]">
              Conecta Google Drive para guardar los libros en {googleUser.email}
            </p>
            <p className="text-[#94a3b8]">
              El acceso a Google Drive se autoriza de forma temporal solo en memoria para proteger
              los datos contables de cada cliente.
            </p>
          </div>
          <button
            type="button"
            disabled={!isOnline || connectingDrive}
            onClick={() => void handleConnectDriveClick()}
            className="inline-flex cursor-pointer items-center gap-2.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleLogoSvg />
            <span>
              {connectingDrive ? 'Conectando con Google Drive...' : 'Conectar Google Drive'}
            </span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Barra de Creación de Respaldo */}
          <div className="space-y-3 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#94a3b8]">
                Nota o Período de la Copia de Seguridad (opcional)
              </label>
              <input
                type="text"
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
                maxLength={120}
                placeholder="Ej: Libros Octubre 2026 · Declaración SENIAT IVA/ISLR"
                className="w-full rounded-md border border-[#2a3b5c] bg-[#141e33] px-3 py-2 text-xs text-[#f1f5f9] focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {activeCompany && (
                <button
                  type="button"
                  disabled={!isOnline || creatingMode !== null || isClientEmailMismatch}
                  onClick={() => void handleCreateCompanyBooksBackup()}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingMode === 'COMPANY' ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookOpen className="h-3.5 w-3.5" />
                  )}
                  {creatingMode === 'COMPANY'
                    ? 'Guardando Libros en Drive...'
                    : `Guardar Libros de ${activeCompany.razonSocial} en ${googleUser.email}`}
                </button>
              )}

              <button
                type="button"
                disabled={!isOnline || creatingMode !== null}
                onClick={() => void handleCreateFullAccountBackup()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#c5a059]/60 bg-[#141e33] px-4 py-2 text-xs font-bold text-[#e5c178] transition-colors hover:bg-[#1e2c4a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingMode === 'ACCOUNT' ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                {creatingMode === 'ACCOUNT'
                  ? 'Creando Copia Completa...'
                  : `Respaldar Toda la Cuenta (${ownedSummary.companiesCount} emp. + CRM)`}
              </button>

              <button
                type="button"
                disabled={!isOnline || loadingList}
                onClick={() => void loadBackupsList(false)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#141e33] px-3.5 py-2 text-xs font-semibold text-[#f1f5f9] transition-colors hover:border-[#c5a059]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          </div>

          {/* Lista de Copias en Google Drive Personal */}
          <div className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#e5c178]">
                <HardDriveDownload className="h-3.5 w-3.5" />
                Copias Guardadas en {folderName || getUserBackupFolderName(googleUser.email || '')}{' '}
                ({visibleBackups.length})
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {activeCompany && (
                  <div className="inline-flex rounded-md border border-[#2a3b5c] bg-[#141e33] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setFilterScope('ACTIVE_COMPANY')}
                      className={`cursor-pointer rounded px-2.5 py-1 font-semibold transition-colors ${
                        filterScope === 'ACTIVE_COMPANY'
                          ? 'bg-[#c5a059] text-[#0a0f1d]'
                          : 'text-[#94a3b8] hover:text-[#f1f5f9]'
                      }`}
                    >
                      Solo {activeCompany.rif}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterScope('ALL')}
                      className={`cursor-pointer rounded px-2.5 py-1 font-semibold transition-colors ${
                        filterScope === 'ALL'
                          ? 'bg-[#c5a059] text-[#0a0f1d]'
                          : 'text-[#94a3b8] hover:text-[#f1f5f9]'
                      }`}
                    >
                      Todas ({backups.length})
                    </button>
                  </div>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {googleUser.email}
                </span>
              </div>
            </div>

            {loadingList ? (
              <p className="py-6 text-center text-xs text-[#94a3b8]">
                Consultando copias de seguridad en tu Google Drive...
              </p>
            ) : visibleBackups.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#94a3b8]">
                No hay copias de seguridad registradas para esta selección en el correo{' '}
                <strong className="text-[#f1f5f9]">{googleUser.email}</strong>. Crea la primera
                copia de los libros arriba.
              </p>
            ) : (
              <div className={`overflow-x-auto ${compact ? 'max-h-60 overflow-y-auto' : ''}`}>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#2a3b5c] text-[#c5a059]">
                      <th className="px-2.5 py-2">Copia / Cliente</th>
                      <th className="px-2.5 py-2">Fecha</th>
                      <th className="px-2.5 py-2 text-right">Libros / Contenido</th>
                      <th className="px-2.5 py-2 text-right">Tamaño</th>
                      <th className="px-2.5 py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBackups.map((file) => (
                      <tr
                        key={file.id}
                        className="border-b border-[#2a3b5c]/60 transition-colors hover:bg-[#141e33]/60"
                      >
                        <td className="px-2.5 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                file.backupScope === 'COMPANY_BOOKS'
                                  ? 'bg-[#c5a059]/20 text-[#e5c178]'
                                  : 'bg-sky-950/60 text-sky-300'
                              }`}
                            >
                              {file.backupScope === 'COMPANY_BOOKS'
                                ? 'Libros Cliente'
                                : 'Cuenta Completa'}
                            </span>
                            <span className="font-mono-tabular font-semibold text-[#f1f5f9]">
                              {file.name}
                            </span>
                          </div>
                          {file.companyName && (
                            <div className="mt-0.5 text-[11px] text-[#38edf8]">
                              {file.companyName} ({file.companyRif})
                            </div>
                          )}
                          {file.note && (
                            <div className="mt-0.5 text-[11px] text-[#e5c178]">
                              Nota: {file.note}
                            </div>
                          )}
                          {file.checksumSha256 && (
                            <div className="mt-0.5 font-mono-tabular text-[10px] text-[#94a3b8]">
                              SHA-256: {file.checksumSha256.slice(0, 16)}...
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap font-mono-tabular text-[#94a3b8]">
                          {new Date(file.createdTime).toLocaleString('es-VE')}
                        </td>
                        <td className="px-2.5 py-2.5 text-right whitespace-nowrap font-mono-tabular text-[#f1f5f9]">
                          {file.companiesCount} emp. &middot; {file.asientosCount} asient.
                        </td>
                        <td className="px-2.5 py-2.5 text-right whitespace-nowrap font-mono-tabular text-[#94a3b8]">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded border border-[#2a3b5c] bg-[#141e33] px-2 py-1 text-[11px] font-medium text-[#94a3b8] hover:border-[#c5a059] hover:text-[#f1f5f9]"
                                title="Ver archivo en Google Drive"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Drive
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={!isOnline || preparingFileId === file.id}
                              onClick={() => void handlePrepareRestore(file)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {preparingFileId === file.id ? 'Leyendo...' : 'Restaurar'}
                            </button>
                            <button
                              type="button"
                              disabled={!isOnline}
                              onClick={() => setPendingConfirm({ type: 'DELETE', file })}
                              className="inline-flex cursor-pointer items-center rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-rose-300 hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Eliminar copia de Google Drive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Confirmación Explícita (Obligatorio antes de Restaurar o Eliminar) */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-[#c5a059] bg-[#0d1527] p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div
                className={`rounded-lg border p-2.5 ${
                  pendingConfirm.type === 'DELETE'
                    ? 'border-rose-500/50 bg-rose-950/40 text-rose-400'
                    : 'border-amber-500/50 bg-amber-950/40 text-amber-300'
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-display text-lg font-bold text-[#e5c178]">
                  {pendingConfirm.type === 'RESTORE'
                    ? 'Confirmar Restauración desde Google Drive'
                    : 'Confirmar Eliminación en Google Drive'}
                </h4>
                <p className="mt-1 text-xs text-[#94a3b8]">
                  {pendingConfirm.type === 'RESTORE'
                    ? pendingConfirm.payload.kind === 'company-books-backup'
                      ? `Esta acción restaurará los libros contables y fiscales de ${pendingConfirm.payload.company.razonSocial} (${pendingConfirm.payload.company.rif}) para la cuenta ${googleUser?.email}, actualizando almacenamiento local y Cloud Firestore.`
                      : `Esta acción sobrescribirá los datos locales y sincronizará en Cloud Firestore las empresas, libros y perfil CRM de ${googleUser?.email}.`
                    : `Esta acción eliminará permanentemente este archivo de respaldo de tu cuenta de Google Drive (${googleUser?.email}).`}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-[#94a3b8]">Archivo:</span>
                <span className="font-mono-tabular font-semibold text-[#f1f5f9]">
                  {pendingConfirm.file.name}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#94a3b8]">Fecha de Respaldo:</span>
                <span className="font-mono-tabular text-[#f1f5f9]">
                  {new Date(pendingConfirm.file.createdTime).toLocaleString('es-VE')}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#94a3b8]">Correo del Cliente:</span>
                <span className="font-mono-tabular text-[#38edf8]">
                  {pendingConfirm.file.ownerEmail}
                </span>
              </div>
              {pendingConfirm.type === 'RESTORE' && (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#94a3b8]">Alcance de Restauración:</span>
                    <span className="font-mono-tabular font-semibold text-[#e5c178]">
                      {pendingConfirm.payload.kind === 'company-books-backup'
                        ? `${pendingConfirm.payload.company.razonSocial}: ${pendingConfirm.payload.booksSummary.asientosActivos} asient., ${pendingConfirm.payload.booksSummary.documentosFiscales} docs.`
                        : `${pendingConfirm.payload.stats.companiesCount} empresa(s) · ${pendingConfirm.payload.stats.asientosCount} asiento(s) · ${pendingConfirm.payload.stats.documentosFiscalesCount} doc(s)`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[#94a3b8]">Integridad SHA-256:</span>
                    {pendingConfirm.checksumValid ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Verificada sin alteraciones
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Hash modificado externamente
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={executingConfirm}
                onClick={() => setPendingConfirm(null)}
                className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#141e33] px-4 py-2 text-xs font-semibold text-[#f1f5f9] hover:border-[#c5a059]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={executingConfirm}
                onClick={() => void handleExecuteConfirmation()}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                  pendingConfirm.type === 'DELETE'
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-[#c5a059] text-[#0a0f1d] hover:bg-[#e5c178]'
                }`}
              >
                {executingConfirm && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {pendingConfirm.type === 'RESTORE'
                  ? 'Confirmar Restauración'
                  : 'Confirmar Eliminación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
