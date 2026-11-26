import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, Download, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { DriveBackupPayload } from '../services/googleDriveBackup';
import {
  CompanyDataset,
  CompanyProfile,
  CrmEmpresaTemplate,
  PendingSyncMutation,
  SyncLogEntry,
} from '../types/accounting';
import { auditJournalIntegrity } from '../utils/accountingEngine';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';

interface ArquitecturaYSyncModuleProps {
  isOnline: boolean;
  simulatedOffline: boolean;
  onToggleSimulatedOffline: () => void;
  outbox: PendingSyncMutation[];
  syncLogs: SyncLogEntry[];
  lastServerSync: string | null;
  isSyncing: boolean;
  onSyncNow: () => void;
  googleUser: User | null;
  crmProfile: CrmEmpresaTemplate | null;
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
  activeCompanyId: string;
  driveConnected: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSwitchGoogleAccount: (loginHint?: string) => Promise<void>;
  onConnectGoogleDrive: () => Promise<string | null>;
  onDriveTokenExpired: () => void;
  onRestoreBackup: (payload: DriveBackupPayload) => Promise<void>;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const ArquitecturaYSyncModule: React.FC<ArquitecturaYSyncModuleProps> = ({
  isOnline,
  simulatedOffline,
  onToggleSimulatedOffline,
  outbox,
  syncLogs,
  lastServerSync,
  isSyncing,
  onSyncNow,
  googleUser,
  crmProfile,
  companies,
  companyData,
  activeCompanyId,
  driveConnected,
  onGoogleSignIn,
  onSwitchGoogleAccount,
  onConnectGoogleDrive,
  onDriveTokenExpired,
  onRestoreBackup,
  onNotify,
}) => {
  const effectiveOnline = isOnline && !simulatedOffline;
  const [healthProbe, setHealthProbe] = useState<Record<string, unknown> | null>(null);
  const [probingHealth, setProbingHealth] = useState(false);

  const handleCheckServerHealth = async () => {
    setProbingHealth(true);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = (await res.json()) as Record<string, unknown>;
      setHealthProbe(data);
      onNotify('Diagnóstico de salud /api/health verificado.', 'success');
    } catch {
      onNotify('No se pudo conectar con /api/health en este momento.', 'error');
    } finally {
      setProbingHealth(false);
    }
  };

  const handleExportDiagnostics = () => {
    const activeDs = companyData[activeCompanyId];
    const audit = activeDs ? auditJournalIntegrity(activeDs) : null;
    const diagnosticReport = {
      generatedAt: new Date().toISOString(),
      platform: 'Equinox-Books',
      connectivity: {
        browserOnline: isOnline,
        simulatedOffline,
        effectiveOnline,
        lastServerSync,
      },
      account: {
        authenticated: Boolean(googleUser),
        emailVerified: Boolean(googleUser?.emailVerified),
        driveConnected,
        companiesCount: companies.length,
        activeCompanyId,
      },
      syncQueue: {
        pendingMutations: outbox.length,
        recentLogsCount: syncLogs.length,
      },
      accountingIntegrity: audit
        ? {
            isHealthy: audit.isHealthy,
            balancedAsientosCount: audit.balancedAsientosCount,
            unbalancedCount: audit.unbalancedAsientos.length,
            orphanLinesCount: audit.orphanLinesCount,
            equationDiffCentavos: audit.equationDiffCentavos,
          }
        : null,
      serverHealthProbe: healthProbe,
    };

    const blob = new Blob([JSON.stringify(diagnosticReport, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Equinox_Diagnostico_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Respaldos Google Drive, Arquitectura Interna y Sincronización Offline
        </h2>
        <p className="mt-1 text-sm text-[#94a3b8]">
          <strong className="text-[#f1f5f9]">Equinox-Books</strong> es un sistema de gestión
          contable y auditoría fiscal multi-empresa diseñado bajo estándares internacionales{' '}
          <strong className="text-[#f1f5f9]">NIC / VEN-NIF</strong> y el registro contable vigente
          en Venezuela.
        </p>
      </div>

      {/* Copias de Seguridad Individuales por Cuenta en Google Drive Personal */}
      <GoogleDriveBackupPanel
        googleUser={googleUser}
        crmProfile={crmProfile}
        companies={companies}
        companyData={companyData}
        activeCompanyId={activeCompanyId}
        isOnline={effectiveOnline}
        driveConnected={driveConnected}
        onGoogleSignIn={onGoogleSignIn}
        onSwitchGoogleAccount={onSwitchGoogleAccount}
        onConnectGoogleDrive={onConnectGoogleDrive}
        onDriveTokenExpired={onDriveTokenExpired}
        onRestoreBackup={onRestoreBackup}
        onNotify={onNotify}
      />

      {/* Stack Tecnológico (del archivo original + extensión offline/multi-empresa) */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
        <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
          Stack Tecnológico Implementado (Modo Offline + Sincronización Automática)
        </h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#f1f5f9]">
          <li>
            <strong>Frontend &amp; PWA:</strong> React, TypeScript, Tailwind CSS y Service Worker
            PWA con caché local de activos para operar sin conexión a internet.
          </li>
          <li>
            <strong>Motor de Lógica Contable:</strong> Aritmética entera de centavos (
            <span className="eqx-mono">Cero Float</span>) preservada íntegramente en Libro Diario y
            Libro Mayor, más conversión monetaria BigInt bajo NIC 21.
          </li>
          <li>
            <strong>Autenticación Google y Seguridad Multi-Empresa:</strong> Firebase Auth (Google
            OAuth) con aislamiento estricto por entidad (<span className="eqx-mono">/companies</span>
            ) y reglas de seguridad Zero-Trust en Cloud Firestore.
          </li>
          <li>
            <strong>Base de Datos Local-First:</strong> IndexedDB con caché persistente multi-tab
            de Firestore, respaldo en <span className="eqx-mono">localStorage</span> y cola
            transaccional de cambios por entidad.
          </li>
          <li>
            <strong>Sincronización Automática:</strong> Al restablecerse internet, sincroniza
            automáticamente con el servidor Express (<span className="eqx-mono">/api/sync</span>) y
            Cloud Firestore de forma idempotente.
          </li>
        </ul>
      </div>

      {/* Centro de Control Offline y Auto-Sync */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <div className="flex items-center justify-between border-b border-[#2a3b5c] pb-2">
            <h3 className="text-base font-semibold text-[#c5a059]">
              Estado de Conexión y Sincronización
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                effectiveOnline ? 'text-[#34d399]' : 'text-amber-400'
              }`}
            >
              {effectiveOnline ? (
                <>
                  <Wifi className="h-4 w-4" /> En Línea
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4" /> Modo Offline Activo
                </>
              )}
            </span>
          </div>

          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-[#94a3b8]">Cambios pendientes en cola local:</span>
              <span className="font-mono-tabular font-bold text-[#f1f5f9]">
                {outbox.length} operación(es)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#94a3b8]">Última sincronización con servidor:</span>
              <span className="font-mono-tabular text-[#f1f5f9]">
                {lastServerSync ? new Date(lastServerSync).toLocaleString('es-VE') : 'Pendiente'}
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onSyncNow}
              disabled={!effectiveOnline || isSyncing}
              className="inline-flex items-center gap-2 rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
            </button>

            <button
              type="button"
              onClick={onToggleSimulatedOffline}
              className={`rounded-md border px-4 py-2 text-xs font-semibold transition-colors ${
                simulatedOffline
                  ? 'border-amber-500/60 bg-amber-950/40 text-amber-300'
                  : 'border-[#2a3b5c] bg-[#2a3b5c] text-white hover:bg-[#364b75]'
              }`}
            >
              {simulatedOffline
                ? 'Restablecer Conexión (Auto-Sync)'
                : 'Simular Corte de Internet'}
            </button>

            <button
              type="button"
              onClick={() => void handleCheckServerHealth()}
              disabled={probingHealth}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-[#1e2e4f] disabled:opacity-50"
            >
              <Activity className="h-3.5 w-3.5" />
              {probingHealth ? 'Verificando API...' : 'Verificar Salud API (/api/health)'}
            </button>

            <button
              type="button"
              onClick={handleExportDiagnostics}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3.5 py-2 text-xs font-semibold text-[#e5c178] hover:bg-[#1e2e4f]"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar Diagnóstico JSON
            </button>
          </div>

          {healthProbe && (
            <pre className="mt-3 overflow-x-auto rounded border border-[#2a3b5c] bg-[#0a0f1d] p-3 font-mono-tabular text-[11px] text-emerald-300">
              {JSON.stringify(healthProbe, null, 2)}
            </pre>
          )}
        </div>

        {/* Cola Offline */}
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
            Cola de Datos Offline ({outbox.length})
          </h3>
          <div className="mt-3 max-h-52 overflow-y-auto">
            {outbox.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#94a3b8]">
                Todos los datos contables y fiscales están sincronizados con el servidor.
              </p>
            ) : (
              <ul className="space-y-2">
                {outbox.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between border-b border-[#2a3b5c]/60 pb-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-[#f1f5f9]">{m.summary}</p>
                      <p className="text-[#94a3b8]">
                        {m.companyName} · {new Date(m.timestamp).toLocaleTimeString('es-VE')}
                      </p>
                    </div>
                    <span className="font-mono-tabular font-semibold text-amber-400">
                      PENDIENTE
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Bitácora */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
        <h3 className="border-b border-[#2a3b5c] pb-2 text-base font-semibold text-[#c5a059]">
          Historial de Sincronización Automática
        </h3>
        <div className="mt-3 max-h-48 overflow-y-auto">
          {syncLogs.length === 0 ? (
            <p className="py-4 text-xs text-[#94a3b8]">Sin eventos registrados aún.</p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-[#c5a059]">
                  <th className="px-3 py-2">Fecha y Hora</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2 text-right">Elementos</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => (
                  <tr key={log.id} className="border-b border-[#2a3b5c]/60">
                    <td className="px-3 py-2 font-mono-tabular text-[#94a3b8]">
                      {new Date(log.timestamp).toLocaleString('es-VE')}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      <span
                        className={
                          log.status === 'SYNCED'
                            ? 'text-[#34d399]'
                            : log.status === 'QUEUED_OFFLINE'
                              ? 'text-amber-400'
                              : 'text-[#f87171]'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#f1f5f9]">{log.message}</td>
                    <td className="px-3 py-2 text-right font-mono-tabular">{log.itemsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
