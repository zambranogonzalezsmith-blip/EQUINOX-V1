import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
  WorkspaceState,
} from '../types/accounting.js';
import {
  createEmptyCompanyDataset,
  DEFAULT_COMPANIES,
  normalizeCompanyDataset,
} from './venezuelaCatalog.js';

function parseIsoMs(iso?: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reconcilia el estado autoritativo recibido desde el servidor (`res.workspace`)
 * con el estado local de React preservando cualquier cambio local pendiente
 * en la cola `remainingOutbox` y resolviendo conflictos por marca temporal.
 */
export function reconcileWorkspaceState(
  localWs: WorkspaceState,
  serverWs?: WorkspaceState | null,
  remainingOutbox: PendingSyncMutation[] = [],
  serverTime?: string
): WorkspaceState {
  const effectiveSyncTime =
    serverTime || serverWs?.lastServerSync || localWs.lastServerSync || new Date().toISOString();

  if (!serverWs) {
    return {
      ...localWs,
      lastServerSync: effectiveSyncTime,
    };
  }

  const pendingMutationCompanyIds = new Set<string>();
  const pendingDeletedIds = new Set<string>();
  for (const mut of remainingOutbox) {
    if (!mut || !mut.companyId) continue;
    pendingMutationCompanyIds.add(mut.companyId);
    if (mut.actionType === 'COMPANY_DELETE' && mut.deletedCompanyId) {
      pendingDeletedIds.add(mut.deletedCompanyId);
    }
  }

  const serverCompanies = Array.isArray(serverWs.companies) ? serverWs.companies : [];
  const localCompanies = Array.isArray(localWs.companies) ? localWs.companies : [];

  const localCompanyMap = new Map(localCompanies.map((c) => [c.id, c]));
  const serverCompanyMap = new Map(serverCompanies.map((c) => [c.id, c]));

  const reconciledMap = new Map<string, CompanyProfile>();
  const reconciledData: Record<string, CompanyDataset> = {};

  // 1. Integrar todas las compañías provenientes del servidor (excepto las marcadas para eliminación local pendiente)
  for (const srvComp of serverCompanies) {
    if (pendingDeletedIds.has(srvComp.id)) continue;

    const locComp = localCompanyMap.get(srvComp.id);
    const hasPendingLocalMutation = pendingMutationCompanyIds.has(srvComp.id);

    if (locComp && (hasPendingLocalMutation || parseIsoMs(locComp.updatedAt) > parseIsoMs(srvComp.updatedAt))) {
      reconciledMap.set(srvComp.id, locComp);
    } else {
      reconciledMap.set(srvComp.id, srvComp);
    }

    const srvDs = serverWs.companyData?.[srvComp.id];
    const locDs = localWs.companyData?.[srvComp.id];

    if (locDs && (hasPendingLocalMutation || !srvDs || parseIsoMs(locDs.updatedAt) > parseIsoMs(srvDs.updatedAt))) {
      reconciledData[srvComp.id] = normalizeCompanyDataset(locDs);
    } else {
      reconciledData[srvComp.id] = normalizeCompanyDataset(
        srvDs || locDs || createEmptyCompanyDataset()
      );
    }
  }

  // 2. Preservar compañías locales aún pendientes de creación/sincronización o plantillas iniciales si el servidor está vacío
  for (const locComp of localCompanies) {
    if (pendingDeletedIds.has(locComp.id) || serverCompanyMap.has(locComp.id)) continue;
    const isPendingCreate = pendingMutationCompanyIds.has(locComp.id);
    const preserveUnauthenticatedTemplate = serverCompanies.length === 0 && !locComp.ownerUid;
    if (isPendingCreate || preserveUnauthenticatedTemplate) {
      reconciledMap.set(locComp.id, locComp);
      reconciledData[locComp.id] = normalizeCompanyDataset(
        localWs.companyData?.[locComp.id] || createEmptyCompanyDataset()
      );
    }
  }

  let reconciledCompanies = Array.from(reconciledMap.values());
  if (reconciledCompanies.length === 0) {
    reconciledCompanies = DEFAULT_COMPANIES;
    for (const def of DEFAULT_COMPANIES) {
      reconciledData[def.id] = normalizeCompanyDataset(
        localWs.companyData?.[def.id] || createEmptyCompanyDataset()
      );
    }
  }

  const activeCompanyId = reconciledCompanies.some((c) => c.id === localWs.activeCompanyId)
    ? localWs.activeCompanyId
    : serverWs.activeCompanyId && reconciledCompanies.some((c) => c.id === serverWs.activeCompanyId)
      ? serverWs.activeCompanyId
      : reconciledCompanies[0].id;

  return {
    companies: reconciledCompanies,
    activeCompanyId,
    companyData: reconciledData,
    lastServerSync: effectiveSyncTime,
  };
}
