import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  Crown,
  HardDriveDownload,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AccountModal } from './components/AccountModal';
import { ArquitecturaYSyncModule } from './components/ArquitecturaYSyncModule';
import { CatalogoNICModule } from './components/CatalogoNICModule';
import { CierresYTipoCambioModule } from './components/CierresYTipoCambioModule';
import { CrmOnboardingModal } from './components/CrmOnboardingModal';
import { DriveBackupModal } from './components/DriveBackupModal';
import { EmpresasModule } from './components/EmpresasModule';
import { EstadosFinancierosModule } from './components/EstadosFinancierosModule';
import { ImpuestosVenezuelaModule } from './components/ImpuestosVenezuelaModule';
import { InventarioNIC2Module } from './components/InventarioNIC2Module';
import { LegalComplianceModal, type LegalDocTab } from './components/LegalComplianceModal';
import { LegalConsentBanner } from './components/LegalConsentBanner';
import { LibroDiarioModule } from './components/LibroDiarioModule';
import { LibroMayorModule } from './components/LibroMayorModule';
import { LicenciasModule } from './components/LicenciasModule';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SplashPresentation } from './components/SplashPresentation';
import { SuperAdminModule } from './components/SuperAdminModule';
import {
  auth,
  clearCachedDriveAccessToken,
  connectGoogleDriveForUser,
  getDriveAccessTokenForUser,
  signInWithGoogle,
  signOutGoogle,
  syncDriveTokenWithAuthUser,
} from './firebase';
import {
  deleteCompanyFromFirestore,
  fetchCrmProfile,
  fetchUserCompaniesAndLedgers,
  saveCompanyToFirestore,
  saveCrmProfileToFirestore,
  saveLedgerToFirestore,
  upsertUserProfile,
} from './services/firestoreSync';
import type { DriveBackupPayload } from './services/googleDriveBackup';
import {
  ActiveTab,
  CompanyDataset,
  CompanyProfile,
  CrmEmpresaTemplate,
  PendingSyncMutation,
  SyncLogEntry,
  WorkspaceState,
} from './types/accounting';
import { PROJECT_METADATA } from './utils/licenseCrypto';
import { centsToStr, nicConvertAmountToBs, todayISO } from './utils/monetary';
import {
  buildDefaultWorkspace,
  checkServerConnectivity,
  compactOutboxQueue,
  fetchServerWorkspace,
  loadLocalWorkspace,
  loadOutbox,
  loadSyncLogs,
  pushOutboxToServer,
  saveLocalWorkspace,
  saveOutbox,
  saveSyncLogs,
} from './utils/offlineSync';
import { isSuperAdminEmail, resolveUserRole, SUPER_ADMIN_EMAIL } from './utils/rbac';
import { createEmptyCompanyDataset, DEFAULT_COMPANIES } from './utils/venezuelaCatalog';

const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'diario', label: 'Libro Diario' },
  { id: 'catalogo', label: 'Catálogo de Cuentas (NIC)' },
  { id: 'mayor', label: 'Libro Mayor' },
  { id: 'estados', label: 'Estados Financieros' },
  { id: 'fiscal', label: 'Libros Fiscales e Impuestos' },
  { id: 'inventario', label: 'Libro de Inventario' },
  { id: 'cierres', label: 'Cierres' },
  { id: 'empresas', label: 'Múltiples Empresas' },
  { id: 'arquitectura', label: 'Sync Offline & Arquitectura' },
  { id: 'licencias', label: 'Módulo Licencias' },
];

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => buildDefaultWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('diario');
  const [editingAsientoNum, setEditingAsientoNum] = useState<number | null>(null);
  const [modalAccountCode, setModalAccountCode] = useState<string | null>(null);
  const [showBcvPanel, setShowBcvPanel] = useState(false);

  // Autenticación Google (Firebase Auth) & Plantilla CRM Multi-Cuenta
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [showDriveBackupModal, setShowDriveBackupModal] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalDocTab | null>(null);
  const [crmProfile, setCrmProfile] = useState<CrmEmpresaTemplate | null>(null);
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmSaving, setCrmSaving] = useState(false);

  // Gestor de Tipo de Cambio (BCV) - Manual fuera de los libros (del archivo original)
  const [manualTCFecha, setManualTCFecha] = useState<string>(todayISO());
  const [manualTCRate, setManualTCRate] = useState<string>('');
  const [manualTcSummary, setManualTcSummary] = useState<string>('');

  // Estado Offline y Sincronización Automática
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [outbox, setOutbox] = useState<PendingSyncMutation[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [alert, setAlert] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const syncInFlightRef = useRef(false);
  const outboxRef = useRef<PendingSyncMutation[]>([]);
  const workspaceRef = useRef<WorkspaceState>(workspace);
  const googleUserRef = useRef<User | null>(googleUser);
  const claimCompanyIdRef = useRef<string | null>(null);
  const isOnlineRef = useRef<boolean>(isOnline);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    googleUserRef.current = googleUser;
  }, [googleUser]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const notify = useCallback((msg: string, type: 'success' | 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAlert({ msg, type });
    toastTimerRef.current = setTimeout(() => {
      setAlert((prev) => (prev?.msg === msg ? null : prev));
    }, 6000);
  }, []);

  const appendSyncLog = useCallback(
    async (status: SyncLogEntry['status'], message: string, itemsCount: number) => {
      const entry: SyncLogEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        status,
        message,
        itemsCount,
      };
      setSyncLogs((prev) => {
        const next = [entry, ...prev].slice(0, 60);
        void saveSyncLogs(next);
        return next;
      });
    },
    []
  );

  const syncOutboxNow = useCallback(
    async (silent = false) => {
      if (syncInFlightRef.current || simulatedOffline) return;
      const reachable = await checkServerConnectivity();
      setIsOnline(reachable);
      if (!reachable) return;

      const currentQueue = outboxRef.current;
      if (currentQueue.length === 0) return;

      syncInFlightRef.current = true;
      setIsSyncing(true);
      try {
        // 1. Sincronizar mutaciones con Express /api/sync
        const res = await pushOutboxToServer(currentQueue, workspaceRef.current.activeCompanyId);

        // 2. Sincronizar con Cloud Firestore si hay sesión Google verificada
        const activeAuthUser = googleUserRef.current;
        if (activeAuthUser && activeAuthUser.emailVerified) {
          const latestWs = workspaceRef.current;
          const touchedCompanies = new Set(currentQueue.map((m) => m.companyId));
          for (const mut of currentQueue) {
            if (mut.actionType === 'COMPANY_DELETE' && mut.deletedCompanyId) {
              await deleteCompanyFromFirestore(mut.deletedCompanyId);
            }
          }
          for (const cid of touchedCompanies) {
            const prof = latestWs.companies.find((c) => c.id === cid);
            const canSync =
              prof &&
              (!prof.ownerUid ||
                prof.ownerUid === activeAuthUser.uid ||
                isSuperAdminEmail(activeAuthUser.email));
            if (canSync && prof) {
              const linkedProf: CompanyProfile = prof.ownerUid
                ? prof
                : {
                    ...prof,
                    ownerUid: activeAuthUser.uid,
                    googleAuthUid: activeAuthUser.uid,
                    googleAuthEmail: activeAuthUser.email || prof.googleAuthEmail || '',
                    googleVerified: true,
                    googleAuthenticatedAt:
                      prof.googleAuthenticatedAt || new Date().toISOString(),
                  };
              await saveCompanyToFirestore(
                activeAuthUser,
                linkedProf,
                latestWs.companyData[cid]
              );
            }
          }
        }

        if (res.ok) {
          const syncedIds = new Set(currentQueue.map((m) => m.id));
          setOutbox((prev) => {
            const remaining = prev.filter((m) => !syncedIds.has(m.id));
            void saveOutbox(remaining);
            return remaining;
          });
          setWorkspace((prev) => {
            const updated: WorkspaceState = res.workspace
              ? {
                  ...prev,
                  lastServerSync: res.serverTime || new Date().toISOString(),
                }
              : { ...prev, lastServerSync: res.serverTime || new Date().toISOString() };
            void saveLocalWorkspace(updated);
            return updated;
          });
          await appendSyncLog(
            'SYNCED',
            `Sincronización automática completada (${currentQueue.length} cambio(s))`,
            currentQueue.length
          );
          if (!silent) {
            notify(
              `Conexión restablecida: ${currentQueue.length} operación(es) sincronizada(s) automáticamente.`,
              'success'
            );
          }
        }
      } catch {
        await appendSyncLog('ERROR', 'Error temporal al sincronizar con el servidor/nube', 0);
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
      }
    },
    [appendSyncLog, notify, simulatedOffline]
  );

  // Hidratación local-first (IndexedDB) + reconciliación inicial
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [localWs, localOutbox, localLogs] = await Promise.all([
        loadLocalWorkspace(),
        loadOutbox(),
        loadSyncLogs(),
      ]);
      if (!mounted) return;
      workspaceRef.current = localWs;
      setWorkspace(localWs);
      outboxRef.current = localOutbox;
      setOutbox(localOutbox);
      setSyncLogs(localLogs);
      setHydrated(true);

      const reachable = await checkServerConnectivity();
      if (!mounted) return;
      setIsOnline(reachable);

      if (reachable && localOutbox.length === 0) {
        const serverWs = await fetchServerWorkspace();
        if (serverWs && mounted && !googleUserRef.current) {
          workspaceRef.current = serverWs;
          setWorkspace(serverWs);
          await saveLocalWorkspace(serverWs);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Listener de Firebase Auth (Google) + carga segura Multi-Empresa desde Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      syncDriveTokenWithAuthUser(user);
      setGoogleUser(user);
      googleUserRef.current = user;
      setDriveConnected(Boolean(getDriveAccessTokenForUser(user?.uid, user?.email)));
      setAuthLoading(false);

      if (!user) {
        setCrmProfile(null);
        setShowCrmModal(false);
        return;
      }

      if (!user.emailVerified) {
        setAuthError('La cuenta de Google debe tener correo verificado.');
        return;
      }
      setAuthError(null);

      try {
        await upsertUserProfile(user, workspaceRef.current.activeCompanyId);
        const [cloud, fetchedCrm] = await Promise.all([
          fetchUserCompaniesAndLedgers(user.uid),
          fetchCrmProfile(user.uid),
        ]);
        setCrmProfile(fetchedCrm);
        if (!fetchedCrm || !fetchedCrm.completed) {
          setShowCrmModal(true);
        }
        const now = new Date().toISOString();

        if (cloud.companies.length > 0) {
          // Verificar si hay alguna empresa local específica recién autenticada por este usuario
          const targetClaimId = claimCompanyIdRef.current;
          claimCompanyIdRef.current = null;
          let mergedCompanies = cloud.companies;
          let mergedData = cloud.companyData;

          if (targetClaimId) {
            const localTarget = workspaceRef.current.companies.find(
              (c) => c.id === targetClaimId && (!c.ownerUid || c.ownerUid === user.uid)
            );
            if (localTarget && !mergedCompanies.some((c) => c.id === localTarget.id)) {
              const authenticatedCompany: CompanyProfile = {
                ...localTarget,
                ownerUid: user.uid,
                googleAuthUid: user.uid,
                googleAuthEmail: user.email || '',
                googleVerified: true,
                googleAuthenticatedAt: now,
                updatedAt: now,
              };
              const targetDataset =
                workspaceRef.current.companyData[localTarget.id] || createEmptyCompanyDataset();
              await saveCompanyToFirestore(user, authenticatedCompany, targetDataset);
              mergedCompanies = [...mergedCompanies, authenticatedCompany];
              mergedData = { ...mergedData, [authenticatedCompany.id]: targetDataset };
            }
          }

          const preferredId =
            targetClaimId && mergedCompanies.some((c) => c.id === targetClaimId)
              ? targetClaimId
              : mergedCompanies.some((c) => c.id === workspaceRef.current.activeCompanyId)
                ? workspaceRef.current.activeCompanyId
                : mergedCompanies[0].id;

          const nextWs: WorkspaceState = {
            companies: mergedCompanies,
            activeCompanyId: preferredId,
            companyData: mergedData,
            lastServerSync: now,
          };
          workspaceRef.current = nextWs;
          setWorkspace(nextWs);
          await saveLocalWorkspace(nextWs);
        } else {
          // Primera vez de este usuario Google: vincular empresas locales sin propietario u originar entidades base con ID único por usuario
          const uidSuffix = user.uid.slice(0, 8);
          const unownedLocal = workspaceRef.current.companies.filter((c) => !c.ownerUid);
          const baseList = unownedLocal.length > 0 ? unownedLocal : DEFAULT_COMPANIES;

          const authenticatedList: CompanyProfile[] = [];
          const authenticatedData: Record<string, CompanyDataset> = {};

          for (const c of baseList) {
            const scopedId = c.id.endsWith(`-${uidSuffix}`) ? c.id : `${c.id}-${uidSuffix}`;
            const authComp: CompanyProfile = {
              ...c,
              id: scopedId,
              ownerUid: user.uid,
              googleAuthUid: user.uid,
              googleAuthEmail: user.email || '',
              googleVerified: true,
              googleAuthenticatedAt: now,
              updatedAt: now,
            };
            const ds =
              workspaceRef.current.companyData[scopedId] ||
              workspaceRef.current.companyData[c.id] ||
              createEmptyCompanyDataset();
            await saveCompanyToFirestore(user, authComp, ds);
            authenticatedList.push(authComp);
            authenticatedData[authComp.id] = ds;
          }

          const nextWs: WorkspaceState = {
            companies: authenticatedList,
            activeCompanyId: authenticatedList[0].id,
            companyData: authenticatedData,
            lastServerSync: now,
          };
          workspaceRef.current = nextWs;
          setWorkspace(nextWs);
          await saveLocalWorkspace(nextWs);
          claimCompanyIdRef.current = null;
        }

        if (outboxRef.current.length > 0) {
          void syncOutboxNow(true);
        }
      } catch (err) {
        console.error('Error sincronizando sesión Google:', err);
      }
    });

    return () => unsubscribe();
  }, [syncOutboxNow]);

  // Listeners online/offline + sondeo automático de reconexión
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (!simulatedOffline) {
        void syncOutboxNow(false);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      notify(
        'Se perdió la conexión a internet. Modo Offline activo: los cambios se sincronizarán automáticamente al reconectar.',
        'error'
      );
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(async () => {
      if (simulatedOffline) return;
      const wasOnline = isOnlineRef.current;
      const reachable = await checkServerConnectivity();
      isOnlineRef.current = reachable;
      setIsOnline(reachable);

      if (reachable && outboxRef.current.length > 0) {
        void syncOutboxNow(wasOnline);
      }
    }, 8000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [notify, simulatedOffline, syncOutboxNow]);

  const enqueueMutation = useCallback(
    async (mutation: PendingSyncMutation) => {
      const nextQueue = compactOutboxQueue([...outboxRef.current, mutation]);
      outboxRef.current = nextQueue;
      setOutbox(nextQueue);
      await saveOutbox(nextQueue);

      if (simulatedOffline || !isOnlineRef.current) {
        await appendSyncLog('QUEUED_OFFLINE', `Guardado offline: ${mutation.summary}`, 1);
        return;
      }

      void syncOutboxNow(true);
    },
    [appendSyncLog, simulatedOffline, syncOutboxNow]
  );

  const activeCompany =
    workspace.companies.find((c) => c.id === workspace.activeCompanyId) || workspace.companies[0];
  const activeDataset =
    workspace.companyData[activeCompany.id] || createEmptyCompanyDataset();

  // Cálculo ejecutivo real para el resumen del Dashboard activo (Balance + Resultado + IVA)
  const executiveSummary = useMemo(() => {
    let activosCents = 0;
    let pasivoPatCents = 0;
    let ingresosCents = 0;
    let egresosCents = 0;
    const catMap = new Map(activeDataset.catalogo.map((c) => [c.codigo, c]));

    const balanceByCod: Record<string, { deb: number; cred: number }> = {};
    for (const m of activeDataset.diario) {
      if (m.estado !== 'ACTIVO') continue;
      balanceByCod[m.codigo_cuenta] = balanceByCod[m.codigo_cuenta] || { deb: 0, cred: 0 };
      balanceByCod[m.codigo_cuenta].deb += m.debito_centavos;
      balanceByCod[m.codigo_cuenta].cred += m.credito_centavos;
    }

    for (const [cod, sums] of Object.entries(balanceByCod)) {
      const acc = catMap.get(cod);
      if (!acc) continue;
      const saldo = acc.naturaleza === 'Débito' ? sums.deb - sums.cred : sums.cred - sums.deb;
      if (acc.tipo_cuenta === 'Activo') {
        activosCents += acc.naturaleza === 'Crédito' ? -saldo : saldo;
      } else if (acc.tipo_cuenta === 'Pasivo' || acc.tipo_cuenta === 'Patrimonio') {
        pasivoPatCents += acc.naturaleza === 'Débito' ? -saldo : saldo;
      } else if (acc.tipo_cuenta === 'Ingreso') {
        ingresosCents += saldo;
      } else if (
        acc.tipo_cuenta === 'Costo' ||
        acc.tipo_cuenta === 'Gasto' ||
        acc.tipo_cuenta === 'Egreso'
      ) {
        egresosCents += saldo;
      }
    }

    const utilidadCents = ingresosCents - egresosCents;
    let debitoFiscal = 0;
    let creditoFiscal = 0;
    for (const d of activeDataset.documentosFiscales || []) {
      const sign = d.tipoTransaccion === '02-Nota Crédito' ? -1 : 1;
      const ivaTotal = (d.iva16Centavos + d.iva8Centavos + d.iva31Centavos) * sign;
      if (d.tipoLibro === 'VENTAS') debitoFiscal += ivaTotal;
      else creditoFiscal += ivaTotal;
    }
    const ivaNetoCents = debitoFiscal - creditoFiscal;
    const currencyPrefix = activeCompany.monedaFuncional === 'USD' ? 'USD ' : 'Bs ';

    return {
      currencyPrefix,
      activosCents,
      pasivoPatCents: pasivoPatCents + utilidadCents,
      utilidadCents,
      ivaNetoCents,
    };
  }, [activeCompany.monedaFuncional, activeDataset]);

  // Sincronizar input de Tipo de Cambio Manual al cambiar fecha o empresa
  useEffect(() => {
    const r = activeDataset.exchangeRates?.[manualTCFecha];
    if (r) {
      setManualTCRate(Number(r).toFixed(4));
      setManualTcSummary(`TC registrado: Bs ${Number(r).toFixed(4)} para ${manualTCFecha}`);
    } else {
      setManualTCRate('');
      setManualTcSummary(
        `No hay TC registrado para ${manualTCFecha}. Puedes ingresar uno en el Gestor de Tipo de Cambio.`
      );
    }
  }, [manualTCFecha, activeCompany.id, activeDataset.exchangeRates]);

  const handleGoogleSignIn = async (enterAfter = false, loginHint?: string) => {
    setAuthPending(true);
    setAuthError(null);
    try {
      const user = await signInWithGoogle(true, loginHint);
      setDriveConnected(Boolean(getDriveAccessTokenForUser(user.uid, user.email)));
      notify(`Sesión Google verificada: ${user.email}`, 'success');
      if (enterAfter) {
        setShowSplash(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo autenticar con Google.';
      setAuthError(msg);
      notify(`Error de autenticación Google: ${msg}`, 'error');
    } finally {
      setAuthPending(false);
    }
  };

  const handleConnectGoogleDrive = useCallback(async (): Promise<string | null> => {
    try {
      const { user, accessToken } = await connectGoogleDriveForUser(googleUserRef.current);
      setGoogleUser(user);
      googleUserRef.current = user;
      setDriveConnected(true);
      return accessToken;
    } catch (err) {
      setDriveConnected(
        Boolean(
          getDriveAccessTokenForUser(
            googleUserRef.current?.uid,
            googleUserRef.current?.email
          )
        )
      );
      const msg = err instanceof Error ? err.message : 'No se pudo conectar Google Drive.';
      notify(msg, 'error');
      return null;
    }
  }, [notify]);

  const handleDriveTokenExpired = useCallback(() => {
    clearCachedDriveAccessToken();
    setDriveConnected(false);
  }, []);

  const handleAuthenticateCompanyWithGoogle = async (companyId: string) => {
    const target = workspaceRef.current.companies.find((c) => c.id === companyId);
    if (!target) return;
    claimCompanyIdRef.current = companyId;
    try {
      const user = await signInWithGoogle(true, target.googleAuthEmail);
      setDriveConnected(Boolean(getDriveAccessTokenForUser(user.uid, user.email)));
      const now = new Date().toISOString();

      // Si siguió con el mismo dueño o la empresa no tenía dueño, estampa verificación fresca
      if (!target.ownerUid || target.ownerUid === user.uid) {
        const updatedComp: CompanyProfile = {
          ...target,
          ownerUid: user.uid,
          googleAuthUid: user.uid,
          googleAuthEmail: user.email || '',
          googleVerified: true,
          googleAuthenticatedAt: now,
          updatedAt: now,
        };
        const ds = workspaceRef.current.companyData[target.id] || createEmptyCompanyDataset();
        await saveCompanyToFirestore(user, updatedComp, ds);

        setWorkspace((prev) => {
          const next: WorkspaceState = {
            ...prev,
            companies: prev.companies.map((c) => (c.id === companyId ? updatedComp : c)),
            activeCompanyId: companyId,
          };
          workspaceRef.current = next;
          void saveLocalWorkspace(next);
          return next;
        });
      }
      notify(`Empresa ${target.razonSocial} autenticada con Google (${user.email}).`, 'success');
    } catch (err) {
      claimCompanyIdRef.current = null;
      const msg = err instanceof Error ? err.message : 'Error al autenticar empresa con Google.';
      notify(msg, 'error');
    }
  };

  const handleAuthenticateAllLocalCompanies = async () => {
    try {
      const user = googleUserRef.current || (await signInWithGoogle(true));
      setDriveConnected(Boolean(getDriveAccessTokenForUser(user.uid, user.email)));
      const now = new Date().toISOString();
      const updatedList: CompanyProfile[] = [];
      for (const c of workspaceRef.current.companies) {
        if (!c.ownerUid || c.ownerUid === user.uid) {
          const linked: CompanyProfile = {
            ...c,
            ownerUid: user.uid,
            googleAuthUid: user.uid,
            googleAuthEmail: user.email || '',
            googleVerified: true,
            googleAuthenticatedAt: now,
            updatedAt: now,
          };
          const ds = workspaceRef.current.companyData[c.id] || createEmptyCompanyDataset();
          await saveCompanyToFirestore(user, linked, ds);
          updatedList.push(linked);
        } else {
          updatedList.push(c);
        }
      }
      setWorkspace((prev) => {
        const next = { ...prev, companies: updatedList };
        workspaceRef.current = next;
        void saveLocalWorkspace(next);
        return next;
      });
      notify(`Entidades autenticadas y sincronizadas con Google (${user.email}).`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al vincular entidades con Google.';
      notify(msg, 'error');
    }
  };

  const handleUpdateDataset = useCallback(
    (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => {
      const targetCompany =
        workspaceRef.current.companies.find(
          (c) => c.id === workspaceRef.current.activeCompanyId
        ) || workspaceRef.current.companies[0];
      const prevDataset =
        workspaceRef.current.companyData[targetCompany.id] || createEmptyCompanyDataset();
      const nextDataset: CompanyDataset = {
        ...updater(prevDataset),
        updatedAt: new Date().toISOString(),
      };

      const nextWs: WorkspaceState = {
        ...workspaceRef.current,
        companyData: {
          ...workspaceRef.current.companyData,
          [targetCompany.id]: nextDataset,
        },
      };

      workspaceRef.current = nextWs;
      setWorkspace(nextWs);
      void saveLocalWorkspace(nextWs);

      if (googleUserRef.current && !simulatedOffline && isOnline) {
        const ledgerOwnerUid = targetCompany.ownerUid || googleUserRef.current.uid;
        void saveLedgerToFirestore(ledgerOwnerUid, targetCompany.id, nextDataset).catch(() => {
          // Queda respaldado en IndexedDB y en la cola Outbox
        });
      }

      void enqueueMutation({
        id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        companyId: targetCompany.id,
        companyName: targetCompany.razonSocial,
        actionType: 'DATASET_UPDATE',
        summary,
        datasetSnapshot: nextDataset,
      });
    },
    [enqueueMutation, isOnline, simulatedOffline]
  );

  const handleSelectCompany = useCallback((id: string) => {
    setEditingAsientoNum(null);
    setModalAccountCode(null);
    setWorkspace((prev) => {
      const next = { ...prev, activeCompanyId: id };
      workspaceRef.current = next;
      void saveLocalWorkspace(next);
      return next;
    });
    if (googleUserRef.current) {
      void upsertUserProfile(googleUserRef.current, id).catch(() => {});
    }
  }, []);

  const handleCreateCompany = (company: CompanyProfile) => {
    const newDataset = createEmptyCompanyDataset();
    setWorkspace((prev) => {
      const next: WorkspaceState = {
        ...prev,
        companies: [...prev.companies, company],
        activeCompanyId: company.id,
        companyData: { ...prev.companyData, [company.id]: newDataset },
      };
      workspaceRef.current = next;
      void saveLocalWorkspace(next);
      return next;
    });

    if (googleUserRef.current && !simulatedOffline && isOnline) {
      void saveCompanyToFirestore(googleUserRef.current, company, newDataset).catch(() => {});
    }

    void enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      companyId: company.id,
      companyName: company.razonSocial,
      actionType: 'COMPANY_CREATE',
      summary: `Creación de entidad ${company.razonSocial} (${company.rif})`,
      companySnapshot: company,
      datasetSnapshot: newDataset,
    });
  };

  const handleUpdateCompany = (company: CompanyProfile) => {
    setWorkspace((prev) => {
      const next: WorkspaceState = {
        ...prev,
        companies: prev.companies.map((c) => (c.id === company.id ? company : c)),
      };
      workspaceRef.current = next;
      void saveLocalWorkspace(next);
      return next;
    });

    if (googleUserRef.current && !simulatedOffline && isOnline) {
      void saveCompanyToFirestore(
        googleUserRef.current,
        company,
        workspaceRef.current.companyData[company.id]
      ).catch(() => {});
    }

    void enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      companyId: company.id,
      companyName: company.razonSocial,
      actionType: 'COMPANY_UPDATE',
      summary: `Actualización perfil fiscal ${company.razonSocial}`,
      companySnapshot: company,
    });
  };

  const handleDeleteCompany = (id: string) => {
    const target = workspace.companies.find((c) => c.id === id);
    if (!target || workspace.companies.length <= 1) return;

    setWorkspace((prev) => {
      const remaining = prev.companies.filter((c) => c.id !== id);
      const nextData = { ...prev.companyData };
      delete nextData[id];
      const next: WorkspaceState = {
        ...prev,
        companies: remaining,
        activeCompanyId: prev.activeCompanyId === id ? remaining[0].id : prev.activeCompanyId,
        companyData: nextData,
      };
      workspaceRef.current = next;
      void saveLocalWorkspace(next);
      return next;
    });

    if (googleUserRef.current && !simulatedOffline && isOnline) {
      void deleteCompanyFromFirestore(id).catch(() => {});
    }

    void enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      companyId: id,
      companyName: target.razonSocial,
      actionType: 'COMPANY_DELETE',
      summary: `Eliminación de entidad ${target.razonSocial}`,
      deletedCompanyId: id,
    });
    notify(`Entidad ${target.razonSocial} eliminada.`, 'success');
  };

  const handleGuardarTCManual = () => {
    if (!manualTCFecha) {
      notify('Seleccione la fecha antes de guardar el tipo de cambio.', 'error');
      return;
    }
    const rate = parseFloat(manualTCRate.trim().replace(',', '.'));
    if (isNaN(rate) || rate <= 0) {
      notify('Tipo de cambio inválido.', 'error');
      return;
    }
    handleUpdateDataset(
      (prev) => ({
        ...prev,
        exchangeRates: { ...(prev.exchangeRates || {}), [manualTCFecha]: rate },
      }),
      `Tipo de Cambio BCV ${manualTCFecha}: Bs ${rate.toFixed(4)}`
    );
    notify(`Tipo de cambio Bs ${rate.toFixed(4)} guardado para ${manualTCFecha}.`, 'success');
  };

  const handleAplicarTCNIC = () => {
    const asientos: Record<number, { fecha: string; deb: number; cred: number }> = {};
    for (const m of activeDataset.diario) {
      if (m.estado !== 'ACTIVO') continue;
      const key = m.asiento_num;
      asientos[key] = asientos[key] || { fecha: m.fecha, deb: 0, cred: 0 };
      asientos[key].deb += m.debito_centavos;
      asientos[key].cred += m.credito_centavos;
    }
    const keys = Object.keys(asientos).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) {
      setManualTcSummary('Sin asientos activos para conversión NIC.');
      return;
    }
    const lines = keys.map((k) => {
      const a = asientos[Number(k)];
      const tc = activeDataset.exchangeRates?.[a.fecha];
      if (tc) {
        const debBs = nicConvertAmountToBs(a.deb, tc);
        return `#${k} · Déb USD:${centsToStr(a.deb)} → Bs:${centsToStr(debBs)}`;
      }
      return `#${k} · Sin TC para ${a.fecha}`;
    });
    setManualTcSummary(lines.join(' | '));
  };

  const handleJumpToEditAsiento = useCallback((asientoNum: number) => {
    setEditingAsientoNum(asientoNum);
    setActiveTab('diario');
  }, []);

  const handleCloseAccountModal = useCallback(() => {
    setModalAccountCode(null);
  }, []);

  const handleLoadDemoEntries = () => {
    const today = todayISO();
    handleUpdateDataset((prev) => {
      let nextId = prev.nextId;
      let maxNum = 0;
      for (const m of prev.diario) if (m.asiento_num > maxNum) maxNum = m.asiento_num;
      const a1 = maxNum + 1;
      const a2 = maxNum + 2;
      const a3 = maxNum + 3;
      const tc = 46.85;

      const demoDiario = [
        {
          id: nextId++,
          asiento_num: a1,
          fecha: today,
          concepto: 'Aporte inicial de capital en banco nacional',
          tercero: activeCompany.rif,
          codigo_cuenta: '1102',
          debito_centavos: 5000000,
          credito_centavos: 0,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: activeCompany.rif,
          mov_concepto: 'Depósito aporte capital social',
        },
        {
          id: nextId++,
          asiento_num: a1,
          fecha: today,
          concepto: 'Aporte inicial de capital en banco nacional',
          tercero: activeCompany.rif,
          codigo_cuenta: '3101',
          debito_centavos: 0,
          credito_centavos: 5000000,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: activeCompany.rif,
          mov_concepto: 'Capital social suscrito y pagado',
        },
        {
          id: nextId++,
          asiento_num: a2,
          fecha: today,
          concepto: 'Compra de mercancía gravada IVA 16%',
          tercero: 'J-30112233-4',
          codigo_cuenta: '1108',
          debito_centavos: 1000000,
          credito_centavos: 0,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-30112233-4',
          mov_concepto: 'Ingreso de mercancía al inventario (NIC 2)',
        },
        {
          id: nextId++,
          asiento_num: a2,
          fecha: today,
          concepto: 'Compra de mercancía gravada IVA 16%',
          tercero: 'J-30112233-4',
          codigo_cuenta: '1105',
          debito_centavos: 160000,
          credito_centavos: 0,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-30112233-4',
          mov_concepto: 'IVA Crédito Fiscal 16% Fact. 00412',
        },
        {
          id: nextId++,
          asiento_num: a2,
          fecha: today,
          concepto: 'Compra de mercancía gravada IVA 16%',
          tercero: 'J-30112233-4',
          codigo_cuenta: '2101',
          debito_centavos: 0,
          credito_centavos: 1160000,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-30112233-4',
          mov_concepto: 'Factura por pagar a proveedor',
        },
        {
          id: nextId++,
          asiento_num: a3,
          fecha: today,
          concepto: 'Venta de mercancía gravada IVA 16%',
          tercero: 'J-40998877-1',
          codigo_cuenta: '1102',
          debito_centavos: 2088000,
          credito_centavos: 0,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-40998877-1',
          mov_concepto: 'Cobro venta Fact. 000101',
        },
        {
          id: nextId++,
          asiento_num: a3,
          fecha: today,
          concepto: 'Venta de mercancía gravada IVA 16%',
          tercero: 'J-40998877-1',
          codigo_cuenta: '4101',
          debito_centavos: 0,
          credito_centavos: 1800000,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-40998877-1',
          mov_concepto: 'Venta de mercancía gravada 16%',
        },
        {
          id: nextId++,
          asiento_num: a3,
          fecha: today,
          concepto: 'Venta de mercancía gravada IVA 16%',
          tercero: 'J-40998877-1',
          codigo_cuenta: '2102',
          debito_centavos: 0,
          credito_centavos: 288000,
          estado: 'ACTIVO' as const,
          exchange_rate_bs: tc,
          mov_fecha: today,
          mov_tercero: 'J-40998877-1',
          mov_concepto: 'IVA Débito Fiscal 16%',
        },
      ];

      return {
        ...prev,
        diario: [...prev.diario, ...demoDiario],
        nextId,
        exchangeRates: { ...(prev.exchangeRates || {}), [today]: tc },
      };
    }, 'Carga de asientos modelo NIC y SENIAT Venezuela');
    notify('Asientos modelo NIC/SENIAT cargados en el Libro Diario.', 'success');
  };

  const effectiveOnline = isOnline && !simulatedOffline;
  const userRole = googleUser
    ? resolveUserRole(googleUser.email, googleUser.emailVerified)
    : 'user';
  const isSuperAdmin = userRole === 'superadmin';

  const visibleTabs = useMemo(
    () =>
      isSuperAdmin
        ? [...TABS, { id: 'superadmin' as ActiveTab, label: 'Super Admin Global' }]
        : TABS,
    [isSuperAdmin]
  );

  useEffect(() => {
    if (activeTab === 'superadmin' && !isSuperAdmin) {
      setActiveTab('diario');
    }
  }, [activeTab, isSuperAdmin]);

  const handleAuditCompanyInWorkspace = useCallback(
    (company: CompanyProfile, dataset: CompanyDataset) => {
      setWorkspace((prev) => {
        const exists = prev.companies.some((c) => c.id === company.id);
        const nextCompanies = exists
          ? prev.companies.map((c) => (c.id === company.id ? company : c))
          : [...prev.companies, company];
        const nextWs: WorkspaceState = {
          ...prev,
          companies: nextCompanies,
          activeCompanyId: company.id,
          companyData: {
            ...prev.companyData,
            [company.id]: dataset,
          },
        };
        workspaceRef.current = nextWs;
        void saveLocalWorkspace(nextWs);
        return nextWs;
      });
      setActiveTab('diario');
      notify(`Auditando libros de ${company.razonSocial} (${company.rif}).`, 'success');
    },
    [notify]
  );

  const handleSaveCrmProfile = useCallback(
    async (crm: CrmEmpresaTemplate, syncToCompany: boolean) => {
      const currentUser = googleUserRef.current;
      if (!currentUser || !currentUser.emailVerified) {
        notify('Debes iniciar sesión con una cuenta Google verificada.', 'error');
        return;
      }

      setCrmSaving(true);
      try {
        await saveCrmProfileToFirestore(currentUser, crm);
        setCrmProfile(crm);

        if (syncToCompany) {
          const now = new Date().toISOString();
          const existingComp = workspaceRef.current.companies.find(
            (c) => c.id === crm.linkedCompanyId
          );
          const companyPayload: CompanyProfile = existingComp
            ? {
                ...existingComp,
                razonSocial: crm.razonSocial,
                rif: crm.rif,
                tipoContribuyente: crm.tipoContribuyente,
                actividadEconomica: crm.sectorIndustria || existingComp.actividadEconomica,
                domicilioFiscal: crm.domicilioFiscal || existingComp.domicilioFiscal,
                telefono: crm.telefonoCorporativo || crm.whatsappCorporativo || existingComp.telefono,
                monedaFuncional: crm.monedaFuncional,
                contadorNombre: crm.contadorResponsable || existingComp.contadorNombre,
                cpcNumero: crm.cpcNumero || existingComp.cpcNumero,
                updatedAt: now,
              }
            : {
                id: crm.linkedCompanyId,
                ownerUid: currentUser.uid,
                googleAuthUid: currentUser.uid,
                googleAuthEmail: currentUser.email || '',
                googleVerified: true,
                googleAuthenticatedAt: now,
                razonSocial: crm.razonSocial,
                rif: crm.rif,
                tipoContribuyente: crm.tipoContribuyente,
                actividadEconomica: crm.sectorIndustria || 'Actividad Comercial',
                domicilioFiscal: crm.domicilioFiscal || crm.ciudadEstado || 'Venezuela',
                telefono: crm.telefonoCorporativo || crm.whatsappCorporativo || '',
                monedaFuncional: crm.monedaFuncional,
                alicuotaIvaGeneral: 16,
                alicuotaIvaReducida: 8,
                agenteRetencionIva: 0,
                agenteRetencionIslr: true,
                sujetoIgtf: false,
                unidadTributariaBs: 9.0,
                contadorNombre: crm.contadorResponsable || crm.representanteNombre,
                cpcNumero: crm.cpcNumero || 'CPC-00000',
                periodoFiscalInicio: `${todayISO().slice(0, 4)}-01-01`,
                createdAt: now,
                updatedAt: now,
              };

          const targetDataset =
            workspaceRef.current.companyData[companyPayload.id] || createEmptyCompanyDataset();

          await saveCompanyToFirestore(currentUser, companyPayload, targetDataset);
          await upsertUserProfile(currentUser, companyPayload.id, {
            primaryCompanyId: companyPayload.id,
            crmCompleted: true,
          });

          setWorkspace((prev) => {
            const exists = prev.companies.some((c) => c.id === companyPayload.id);
            const nextCompanies = exists
              ? prev.companies.map((c) => (c.id === companyPayload.id ? companyPayload : c))
              : [companyPayload, ...prev.companies];
            const nextWs: WorkspaceState = {
              ...prev,
              companies: nextCompanies,
              activeCompanyId: companyPayload.id,
              companyData: {
                ...prev.companyData,
                [companyPayload.id]: targetDataset,
              },
              lastServerSync: now,
            };
            workspaceRef.current = nextWs;
            void saveLocalWorkspace(nextWs);
            return nextWs;
          });
        }

        setShowCrmModal(false);
        setShowSplash(false);
        setActiveTab('diario');
        notify(
          `Plantilla CRM guardada. Cuenta ${currentUser.email} vinculada a ${crm.razonSocial} (${crm.rif}).`,
          'success'
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'No se pudo guardar la plantilla CRM empresarial.';
        notify(msg, 'error');
      } finally {
        setCrmSaving(false);
      }
    },
    [notify]
  );

  const handleRestoreFromDriveBackup = useCallback(
    async (payload: DriveBackupPayload) => {
      const currentUser = googleUserRef.current;
      if (!currentUser || !currentUser.emailVerified) {
        notify('Debes iniciar sesión con una cuenta Google verificada para restaurar.', 'error');
        return;
      }

      const currentEmail = (currentUser.email || '').trim().toLowerCase();
      if (
        payload.ownerEmail &&
        currentEmail &&
        payload.ownerEmail.trim().toLowerCase() !== currentEmail
      ) {
        notify(
          `Esta copia pertenece a ${payload.ownerEmail}. Cambia a esa cuenta Google para restaurarla.`,
          'error'
        );
        return;
      }

      const now = new Date().toISOString();

      if (payload.kind === 'company-books-backup') {
        const restoredCompany: CompanyProfile = {
          ...payload.company,
          ownerUid: currentUser.uid,
          googleAuthUid: currentUser.uid,
          googleAuthEmail: currentUser.email || payload.ownerEmail,
          googleVerified: true,
          updatedAt: now,
        };
        const restoredDataset: CompanyDataset = {
          ...payload.dataset,
          updatedAt: now,
        };

        if (!simulatedOffline && isOnlineRef.current) {
          await saveCompanyToFirestore(currentUser, restoredCompany, restoredDataset);
          await upsertUserProfile(currentUser, restoredCompany.id);
        }

        const prevWs = workspaceRef.current;
        const exists = prevWs.companies.some((c) => c.id === restoredCompany.id);
        const nextCompanies = exists
          ? prevWs.companies.map((c) => (c.id === restoredCompany.id ? restoredCompany : c))
          : [restoredCompany, ...prevWs.companies];
        const nextWs: WorkspaceState = {
          companies: nextCompanies,
          activeCompanyId: restoredCompany.id,
          companyData: {
            ...prevWs.companyData,
            [restoredCompany.id]: restoredDataset,
          },
          lastServerSync: now,
        };
        workspaceRef.current = nextWs;
        setWorkspace(nextWs);
        await saveLocalWorkspace(nextWs);

        await appendSyncLog(
          'SYNCED',
          `Libros de ${restoredCompany.razonSocial} restaurados desde Google Drive (${currentUser.email})`,
          payload.booksSummary.asientosActivos
        );
        notify(
          `Libros de ${restoredCompany.razonSocial} (${restoredCompany.rif}) restaurados desde Google Drive de ${currentUser.email}.`,
          'success'
        );
        return;
      }

      const restoredCompanies: CompanyProfile[] = payload.companies.map((c) => ({
        ...c,
        ownerUid: currentUser.uid,
        googleAuthUid: currentUser.uid,
        googleAuthEmail: currentUser.email || payload.ownerEmail,
        googleVerified: true,
        updatedAt: now,
      }));

      const restoredCompanyData: Record<string, CompanyDataset> = {};
      for (const comp of restoredCompanies) {
        const ds = payload.companyData[comp.id] || createEmptyCompanyDataset();
        restoredCompanyData[comp.id] = ds;
        if (!simulatedOffline && isOnlineRef.current) {
          await saveCompanyToFirestore(currentUser, comp, ds);
        }
      }

      if (payload.crmProfile) {
        const normalizedCrm: CrmEmpresaTemplate = {
          ...payload.crmProfile,
          ownerUid: currentUser.uid,
          ownerEmail: currentUser.email || payload.ownerEmail,
          updatedAt: now,
        };
        if (!simulatedOffline && isOnlineRef.current) {
          await saveCrmProfileToFirestore(currentUser, normalizedCrm);
        }
        setCrmProfile(normalizedCrm);
      }

      if (restoredCompanies.length > 0) {
        const targetActiveId = restoredCompanies.some((c) => c.id === payload.activeCompanyId)
          ? payload.activeCompanyId
          : restoredCompanies[0].id;

        const nextWs: WorkspaceState = {
          companies: restoredCompanies,
          activeCompanyId: targetActiveId,
          companyData: restoredCompanyData,
          lastServerSync: now,
        };
        workspaceRef.current = nextWs;
        setWorkspace(nextWs);
        await saveLocalWorkspace(nextWs);

        if (!simulatedOffline && isOnlineRef.current) {
          await upsertUserProfile(currentUser, targetActiveId, {
            primaryCompanyId: targetActiveId,
            crmCompleted: Boolean(payload.crmProfile?.completed),
          });
        }
      }

      await appendSyncLog(
        'SYNCED',
        `Restauración desde Google Drive (${currentUser.email}): ${restoredCompanies.length} empresa(s)`,
        restoredCompanies.length
      );
      notify(
        `Copia de seguridad restaurada para ${currentUser.email}: ${restoredCompanies.length} empresa(s) y libros sincronizados.`,
        'success'
      );
    },
    [appendSyncLog, notify, simulatedOffline]
  );

  const activeAsientosCount = useMemo(
    () =>
      new Set(activeDataset.diario.filter((m) => m.estado === 'ACTIVO').map((m) => m.asiento_num))
        .size,
    [activeDataset.diario]
  );

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f1d] text-sm text-[#94a3b8]">
        Cargando Equinox-Books...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1d] text-[#f1f5f9]">
      {/* PRESENTACIÓN INSTITUCIONAL CON CARGA DE PALABRA "EQUINOX BOOKS" Y GOOGLE AUTH */}
      <SplashPresentation
        visible={showSplash}
        googleUser={googleUser}
        authLoading={authLoading}
        authPending={authPending}
        authError={authError}
        isOnline={effectiveOnline}
        onGoogleSignIn={() => handleGoogleSignIn(true)}
        onSwitchGoogleAccount={() => handleGoogleSignIn(false)}
        onSignOut={async () => {
          await signOutGoogle();
          notify('Sesión Google cerrada.', 'success');
        }}
        onEnterSystem={() => setShowSplash(false)}
      />

      {/* HEADER CORPORATIVO FIEL AL ARCHIVO ORIGINAL */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#c5a059] bg-[#141e33] px-5 py-5 lg:px-10">
        <div>
          <button
            type="button"
            onClick={() => setShowSplash(true)}
            className="m-0 cursor-pointer text-left text-2xl font-bold tracking-[2px] text-[#c5a059] transition-colors hover:text-[#e5c178] sm:text-3xl"
            title="Ver Presentación Institucional Equinox Books"
          >
            EQUINOX-BOOKS
          </button>
          <p className="mt-1 text-xs text-[#94a3b8]">
            Solución Contable y de Auditoría Fiscal de Alta Gama &middot; Multi-Empresa NIC &amp;
            SENIAT
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Empresa Activa */}
          <div className="flex items-center gap-2 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-1.5">
            <span className="text-[11px] font-semibold text-[#94a3b8]">Empresa:</span>
            <select
              value={activeCompany.id}
              onChange={(e) => handleSelectCompany(e.target.value)}
              className="max-w-[230px] bg-transparent text-xs font-semibold text-[#e5c178] focus:outline-none"
            >
              {workspace.companies.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0d1527] text-[#f1f5f9]">
                  {c.razonSocial} ({c.rif})
                </option>
              ))}
            </select>
          </div>

          {/* Botón de Autenticación Google de la Empresa Activa */}
          <button
            type="button"
            disabled={!effectiveOnline}
            onClick={() => void handleAuthenticateCompanyWithGoogle(activeCompany.id)}
            className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeCompany.googleVerified && activeCompany.googleAuthEmail
                ? 'border-[#c5a059]/60 bg-[#0d1527] text-[#e5c178] hover:border-[#c5a059]'
                : 'border-amber-500/50 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50'
            }`}
            title={
              activeCompany.googleVerified
                ? `Autenticada con ${activeCompany.googleAuthEmail} (clic para verificar o cambiar cuenta Google)`
                : 'Autenticar esta empresa con Google'
            }
          >
            {activeCompany.googleVerified ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span className="max-w-[170px] truncate">
              {activeCompany.googleVerified && activeCompany.googleAuthEmail
                ? activeCompany.googleAuthEmail
                : 'Autenticar Empresa Google'}
            </span>
          </button>

          {/* Estado Offline / Auto-Sync */}
          <button
            type="button"
            onClick={() => {
              if (outbox.length > 0 && effectiveOnline) {
                void syncOutboxNow(false);
              } else {
                setActiveTab('arquitectura');
              }
            }}
            className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              effectiveOnline
                ? 'border-emerald-500/40 bg-emerald-950/30 text-[#34d399]'
                : 'border-amber-500/50 bg-amber-950/30 text-amber-300'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : effectiveOnline ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {isSyncing
              ? 'Sincronizando...'
              : effectiveOnline
                ? outbox.length > 0
                  ? `Sincronizar (${outbox.length})`
                  : 'En Línea · Sincronizado'
                : `Modo Offline (${outbox.length} pend.)`}
          </button>

          <PWAInstallButton />

          {googleUser && (
            <button
              type="button"
              onClick={() => setShowCrmModal(true)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                crmProfile?.completed
                  ? 'border-emerald-500/40 bg-emerald-950/25 text-emerald-300 hover:border-emerald-400'
                  : 'border-amber-500/60 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50'
              }`}
              title="Configurar Plantilla CRM Empresarial y Privacidad de la Cuenta Google"
            >
              {crmProfile?.completed ? (
                <Lock className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Building2 className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span>{crmProfile?.completed ? 'CRM · Privado' : 'Completar CRM'}</span>
            </button>
          )}

          {googleUser && (
            <button
              type="button"
              onClick={() => setShowDriveBackupModal(true)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                driveConnected
                  ? 'border-sky-500/40 bg-sky-950/25 text-sky-300 hover:border-sky-400'
                  : 'border-[#2a3b5c] bg-[#0d1527] text-[#e5c178] hover:border-[#c5a059]'
              }`}
              title={`Copias de seguridad de libros en Google Drive para ${googleUser.email}`}
            >
              <HardDriveDownload className="h-3.5 w-3.5" />
              <span>{driveConnected ? 'Drive · Listo' : 'Copia Drive'}</span>
            </button>
          )}

          {googleUser && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold uppercase ${
                isSuperAdmin
                  ? 'border-[#c5a059] bg-[#c5a059]/20 text-[#e5c178]'
                  : 'border-[#2a3b5c] bg-[#0d1527] text-slate-300'
              }`}
              title={
                isSuperAdmin
                  ? `Super Usuario Administrador (${SUPER_ADMIN_EMAIL})`
                  : `Usuario Estándar (${googleUser.email})`
              }
            >
              {isSuperAdmin ? (
                <Crown className="h-3.5 w-3.5 text-[#e5c178]" />
              ) : (
                <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
              )}
              <span>{isSuperAdmin ? 'Super Admin' : 'Usuario'}</span>
            </div>
          )}

          <div className="rounded-md border border-[#c5a059] bg-[#c5a059]/10 px-4 py-2 text-right text-xs">
            <strong className="block text-[#e5c178]">{PROJECT_METADATA.propietario}</strong>
            <span className="text-[#f1f5f9]">Creador: {PROJECT_METADATA.creador}</span>
          </div>
        </div>
      </header>

      {/* SLOGAN BAR */}
      <div
        className="border-b border-[#2a3b5c] px-4 py-2.5 text-center text-sm italic text-[#e5c178]"
        style={{
          background: 'linear-gradient(90deg, #141e33 0%, #1e2c4a 50%, #141e33 100%)',
        }}
      >
        &ldquo;{PROJECT_METADATA.eslogan}&rdquo;
      </div>

      {/* ALERT ZONE FLOTANTE */}
      {alert && (
        <div
          className={`fixed right-4 top-4 z-50 max-w-md rounded-md border bg-[#141e33] px-5 py-3 text-sm shadow-2xl ${
            alert.type === 'error'
              ? 'border-rose-500/70 text-[#f87171]'
              : 'border-emerald-500/70 text-[#34d399]'
          }`}
          role="status"
          aria-live="polite"
        >
          {alert.msg}
        </div>
      )}

      <div className="mx-auto my-5 max-w-[1300px] px-4 sm:px-5">
        {/* PANEL EJECUTIVO COMPACTO POR ENTIDAD */}
        <div
          className="mb-5 rounded-xl border border-[#c5a059] px-5 py-5"
          style={{
            background: 'radial-gradient(circle at 30% 20%, #1e2c4a, #0d1527)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a3b5c] pb-4">
            <div>
              <h2 className="m-0 font-display text-2xl font-bold tracking-[2px] text-[#c5a059] sm:text-3xl">
                ⚖ EQUINOX-BOOKS
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#94a3b8]">
                <strong className="text-[#f1f5f9]">Balance Financiero Corporativo</strong> &middot;{' '}
                Entidad Activa: <strong className="text-[#e5c178]">{activeCompany.razonSocial}</strong>{' '}
                &middot; RIF <span className="eqx-mono">{activeCompany.rif}</span> &middot;{' '}
                <strong className="text-[#f1f5f9]">{activeCompany.tipoContribuyente}</strong> ({activeCompany.monedaFuncional})
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeAsientosCount === 0 && (
                <button
                  type="button"
                  onClick={handleLoadDemoEntries}
                  className="cursor-pointer rounded-md bg-[#c5a059] px-3.5 py-2 text-xs font-bold text-black transition-colors hover:bg-[#e5c178]"
                >
                  Cargar Asientos Modelo NIC
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowBcvPanel((prev) => !prev)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3.5 py-2 text-xs font-semibold text-[#e5c178] transition-colors hover:border-[#c5a059]"
              >
                Tipo de Cambio BCV
                {showBcvPanel ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Resumen Ejecutivo Real por Entidad Activa */}
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <span className="text-xs text-[#94a3b8]">Activos Totales</span>
              <p className="mt-0.5 font-mono-tabular text-base font-bold text-[#34d399]">
                {executiveSummary.currencyPrefix}
                {centsToStr(executiveSummary.activosCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#94a3b8]">Pasivo + Patrimonio</span>
              <p className="mt-0.5 font-mono-tabular text-base font-bold text-[#f1f5f9]">
                {executiveSummary.currencyPrefix}
                {centsToStr(executiveSummary.pasivoPatCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#94a3b8]">Resultado del Ejercicio</span>
              <p
                className={`mt-0.5 font-mono-tabular text-base font-bold ${
                  executiveSummary.utilidadCents >= 0 ? 'text-[#e5c178]' : 'text-[#f87171]'
                }`}
              >
                {executiveSummary.currencyPrefix}
                {centsToStr(executiveSummary.utilidadCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-[#94a3b8]">Posición IVA (Déb - Créd)</span>
              <p className="mt-0.5 font-mono-tabular text-base font-bold text-[#38edf8]">
                {executiveSummary.currencyPrefix}
                {centsToStr(executiveSummary.ivaNetoCents)}
              </p>
            </div>
          </div>

          {/* Gestor de Tipo de Cambio (BCV) - Desplegable fuera de los libros */}
          {showBcvPanel && (
            <div className="mt-5 rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-4 text-left">
              <h3 className="mt-0 border-b border-[#2a3b5c] pb-2 text-sm font-semibold text-[#c5a059]">
                Gestor de Tipo de Cambio (BCV) - Manual
              </h3>
              <p className="mt-2 text-xs text-[#94a3b8]">
                Carga manual de tipo de cambio Bs/USD según BCV para{' '}
                <strong className="text-[#f1f5f9]">{activeCompany.razonSocial}</strong> (NIC 21).
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#94a3b8]">Fecha</label>
                  <input
                    type="date"
                    value={manualTCFecha}
                    onChange={(e) => setManualTCFecha(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-sm text-[#f1f5f9] focus:border-[#c5a059] focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#94a3b8]">
                    Tipo de Cambio (Bs por USD)
                  </label>
                  <input
                    type="text"
                    value={manualTCRate}
                    onChange={(e) => setManualTCRate(e.target.value)}
                    placeholder="Ej: 46.8500"
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-sm text-[#f1f5f9] focus:border-[#c5a059] focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleGuardarTCManual}
                  className="cursor-pointer rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-black transition-colors hover:bg-[#e5c178]"
                >
                  Guardar TC Manual
                </button>
                <button
                  type="button"
                  onClick={handleAplicarTCNIC}
                  className="cursor-pointer rounded-md bg-[#2a3b5c] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#384e78]"
                >
                  Aplicar algoritmo NIC (resumen)
                </button>
                <span className="text-xs text-[#94a3b8]">{manualTcSummary}</span>
              </div>
            </div>
          )}
        </div>

        {/* BARRA DE NAVEGACIÓN DE LIBROS Y MÓDULOS (VISIBLE INMEDIATAMENTE) */}
        <nav
          aria-label="Libros Contables y Módulos"
          className="sticky top-0 z-30 mb-5 rounded-xl border border-[#2a3b5c] bg-[#0a0f1d]/95 p-3 shadow-lg backdrop-blur"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#e5c178]">
              <BookOpen className="h-3.5 w-3.5 text-[#c5a059]" />
              Navegación Directa de Libros Contables y Módulos
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDriveBackupModal(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-950/30 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-900/50"
                title="Resguardar todos los libros contables y fiscales cargados en el Google Drive personal del correo de este cliente"
              >
                <HardDriveDownload className="h-3.5 w-3.5" />
                <span>
                  Respaldar Libros en Correo (
                  {activeCompany.googleAuthEmail || googleUser?.email || 'Google Drive'})
                </span>
              </button>
              <span className="text-[11px] text-[#94a3b8]">
                Libro Activo:{' '}
                <strong className="text-[#f1f5f9]">
                  {visibleTabs.find((t) => t.id === activeTab)?.label}
                </strong>
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const isAdminTab = tab.id === 'superadmin';
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm ${
                    isActive
                      ? 'border-[#c5a059] bg-[#c5a059] text-black shadow-md'
                      : isAdminTab
                        ? 'border-[#c5a059]/60 bg-[#c5a059]/10 text-[#e5c178] hover:bg-[#c5a059]/25'
                        : 'border-[#2a3b5c] bg-[#141e33] text-[#94a3b8] hover:border-[#c5a059]/50 hover:bg-[#1e2c4a] hover:text-[#f1f5f9]'
                  }`}
                >
                  {isAdminTab && <Crown className="h-3.5 w-3.5" />}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* CONTENEDOR DE LIBRO / MÓDULO ACTIVO */}
        <div className="rounded-[10px] border border-[#2a3b5c] bg-[#141e33] p-5 sm:p-7">
          {activeTab === 'diario' && (
            <LibroDiarioModule
              key={`diario-${activeCompany.id}`}
              dataset={activeDataset}
              editingAsientoNum={editingAsientoNum}
              onSetEditingAsientoNum={setEditingAsientoNum}
              onUpdateDataset={handleUpdateDataset}
              onNotify={notify}
            />
          )}

          {activeTab === 'mayor' && (
            <LibroMayorModule
              key={`mayor-${activeCompany.id}`}
              dataset={activeDataset}
              onJumpToEditAsiento={handleJumpToEditAsiento}
            />
          )}

          {activeTab === 'catalogo' && (
            <CatalogoNICModule
              key={`catalogo-${activeCompany.id}`}
              dataset={activeDataset}
              onUpdateDataset={handleUpdateDataset}
              onNotify={notify}
            />
          )}

          {activeTab === 'estados' && (
            <EstadosFinancierosModule
              key={`estados-${activeCompany.id}`}
              company={activeCompany}
              dataset={activeDataset}
              onShowAccountDetails={(cod) => setModalAccountCode(cod)}
            />
          )}

          {activeTab === 'fiscal' && (
            <ImpuestosVenezuelaModule
              key={`fiscal-${activeCompany.id}`}
              company={activeCompany}
              dataset={activeDataset}
              onUpdateDataset={handleUpdateDataset}
              onJumpToEditAsiento={handleJumpToEditAsiento}
              onNotify={notify}
            />
          )}

          {activeTab === 'inventario' && (
            <InventarioNIC2Module
              key={`inventario-${activeCompany.id}`}
              dataset={activeDataset}
              onUpdateDataset={handleUpdateDataset}
              onNotify={notify}
            />
          )}

          {activeTab === 'cierres' && (
            <CierresYTipoCambioModule
              key={`cierres-${activeCompany.id}`}
              dataset={activeDataset}
              onUpdateDataset={handleUpdateDataset}
              onNotify={notify}
            />
          )}

          {activeTab === 'empresas' && (
            <EmpresasModule
              companies={workspace.companies}
              activeCompanyId={activeCompany.id}
              companyData={workspace.companyData}
              googleUser={googleUser}
              isOnline={effectiveOnline}
              onSelectCompany={(id) => {
                handleSelectCompany(id);
                setActiveTab('diario');
              }}
              onCreateCompany={handleCreateCompany}
              onUpdateCompany={handleUpdateCompany}
              onDeleteCompany={handleDeleteCompany}
              onAuthenticateCompanyWithGoogle={handleAuthenticateCompanyWithGoogle}
              onAuthenticateAllLocalCompanies={handleAuthenticateAllLocalCompanies}
              onNotify={notify}
              crmProfile={crmProfile}
              onOpenCrmModal={() => setShowCrmModal(true)}
              driveConnected={driveConnected}
              onGoogleSignIn={() => handleGoogleSignIn(false)}
              onSwitchGoogleAccount={(hint) => handleGoogleSignIn(false, hint)}
              onConnectGoogleDrive={handleConnectGoogleDrive}
              onDriveTokenExpired={handleDriveTokenExpired}
              onRestoreBackup={handleRestoreFromDriveBackup}
              onBackupCompanyBooksInDrive={(companyId) => {
                handleSelectCompany(companyId);
                setShowDriveBackupModal(true);
              }}
            />
          )}

          {activeTab === 'arquitectura' && (
            <ArquitecturaYSyncModule
              isOnline={isOnline}
              simulatedOffline={simulatedOffline}
              onToggleSimulatedOffline={() => {
                setSimulatedOffline((prev) => {
                  const next = !prev;
                  if (!next) {
                    setTimeout(() => void syncOutboxNow(false), 150);
                  } else {
                    notify(
                      'Simulación de corte de internet activada. Los cambios se encolarán offline.',
                      'error'
                    );
                  }
                  return next;
                });
              }}
              outbox={outbox}
              syncLogs={syncLogs}
              lastServerSync={workspace.lastServerSync}
              isSyncing={isSyncing}
              onSyncNow={() => void syncOutboxNow(false)}
              googleUser={googleUser}
              crmProfile={crmProfile}
              companies={workspace.companies}
              companyData={workspace.companyData}
              activeCompanyId={activeCompany.id}
              driveConnected={driveConnected}
              onGoogleSignIn={() => handleGoogleSignIn(false)}
              onSwitchGoogleAccount={(hint) => handleGoogleSignIn(false, hint)}
              onConnectGoogleDrive={handleConnectGoogleDrive}
              onDriveTokenExpired={handleDriveTokenExpired}
              onRestoreBackup={handleRestoreFromDriveBackup}
              onNotify={notify}
            />
          )}

          {activeTab === 'licencias' && (
            <LicenciasModule
              onOpenPresentation={() => setShowSplash(true)}
              onOpenLegalDoc={(tab) => setLegalModalTab(tab)}
            />
          )}

          {activeTab === 'superadmin' && isSuperAdmin && (
            <SuperAdminModule
              googleUser={googleUser}
              isOnline={effectiveOnline}
              onAuditCompanyInWorkspace={handleAuditCompanyInWorkspace}
              onNotify={notify}
            />
          )}
        </div>

        <footer className="my-7 space-y-2 border-t border-[#2a3b5c]/70 pt-5 text-center text-xs text-[#94a3b8]">
          <p>
            Equinox-Books © 2026 &middot; {PROJECT_METADATA.propietario} &middot;{' '}
            {PROJECT_METADATA.creador} &middot; {PROJECT_METADATA.contacto}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px]">
            <button
              type="button"
              onClick={() => setLegalModalTab('privacidad')}
              className="cursor-pointer text-[#e5c178] hover:underline"
            >
              Política de Privacidad
            </button>
            <span>&middot;</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('terminos')}
              className="cursor-pointer text-[#e5c178] hover:underline"
            >
              Términos y Condiciones
            </button>
            <span>&middot;</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('aviso')}
              className="cursor-pointer text-[#e5c178] hover:underline"
            >
              Aviso Legal y Cookies
            </button>
            <span>&middot;</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('seguridad')}
              className="cursor-pointer text-[#38edf8] hover:underline"
            >
              Cumplimiento Google API &amp; Web
            </button>
          </div>
        </footer>
      </div>

      {modalAccountCode && (
        <AccountModal
          codigo={modalAccountCode}
          catalogo={activeDataset.catalogo}
          diario={activeDataset.diario}
          onClose={handleCloseAccountModal}
          onEditAsiento={handleJumpToEditAsiento}
        />
      )}

      <DriveBackupModal
        open={showDriveBackupModal}
        onClose={() => setShowDriveBackupModal(false)}
        googleUser={googleUser}
        crmProfile={crmProfile}
        companies={workspace.companies}
        companyData={workspace.companyData}
        activeCompanyId={activeCompany.id}
        isOnline={effectiveOnline}
        driveConnected={driveConnected}
        onGoogleSignIn={() => handleGoogleSignIn(false)}
        onSwitchGoogleAccount={(hint) => handleGoogleSignIn(false, hint)}
        onConnectGoogleDrive={handleConnectGoogleDrive}
        onDriveTokenExpired={handleDriveTokenExpired}
        onRestoreBackup={handleRestoreFromDriveBackup}
        onNotify={notify}
      />

      <CrmOnboardingModal
        open={showCrmModal && Boolean(googleUser) && !showSplash}
        googleUser={googleUser}
        existingCrm={crmProfile}
        activeCompany={activeCompany}
        isSaving={crmSaving}
        isFirstTimeOnboarding={!crmProfile?.completed}
        onSaveCrm={handleSaveCrmProfile}
        onSwitchGoogleAccount={() => handleGoogleSignIn(false)}
        onClose={() => setShowCrmModal(false)}
        onNotify={notify}
      />

      <LegalComplianceModal
        open={legalModalTab !== null}
        initialTab={legalModalTab || 'privacidad'}
        onClose={() => setLegalModalTab(null)}
      />

      <LegalConsentBanner onOpenLegalDoc={(tab) => setLegalModalTab(tab)} />
    </div>
  );
}
