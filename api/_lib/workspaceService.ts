import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
  WorkspaceState,
} from '../../src/types/accounting.js';
import { createEmptyCompanyDataset } from '../../src/utils/venezuelaCatalog.js';
import type { VerifiedFirebaseCaller } from './firebaseAuth.js';
import type { FirestoreWorkspaceAdapter } from './firestoreRest.js';
import {
  isValidEntityId,
  type RejectedMutationInfo,
  validateAndAuthorizeMutation,
} from './mutationValidator.js';

export interface WorkspaceGetResult {
  status: 200 | 403;
  body: WorkspaceState | { ok: false; error: string };
}

export interface SyncPostResult {
  status: 200 | 400 | 403;
  body: {
    ok: boolean;
    error?: string;
    syncedCount: number;
    rejectedMutations: RejectedMutationInfo[];
    serverTime: string;
    workspace?: WorkspaceState;
  };
}

export async function handleAuthorizedWorkspaceGet(
  caller: VerifiedFirebaseCaller,
  adapter: FirestoreWorkspaceAdapter,
  requestedScope?: string | string[]
): Promise<WorkspaceGetResult> {
  const scopeVal = Array.isArray(requestedScope) ? requestedScope[0] : requestedScope;
  if (scopeVal === 'all' && !caller.isSuperAdmin) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'Acceso denegado: el alcance global requiere rol Super Admin.',
      },
    };
  }

  const scope: 'own' | 'all' = scopeVal === 'all' && caller.isSuperAdmin ? 'all' : 'own';
  const [companies, preferredActiveId] = await Promise.all([
    adapter.listCompaniesForCaller(caller, scope),
    adapter.getUserActiveCompanyId(caller.uid),
  ]);

  const companyData: Record<string, CompanyDataset> = {};
  await Promise.all(
    companies.map(async (comp) => {
      const ledger = await adapter.getLedger(comp.id);
      companyData[comp.id] = ledger || createEmptyCompanyDataset();
    })
  );

  const activeCompanyId =
    preferredActiveId && companies.some((c) => c.id === preferredActiveId)
      ? preferredActiveId
      : companies[0]?.id || '';

  return {
    status: 200,
    body: {
      companies,
      activeCompanyId,
      companyData,
      lastServerSync: new Date().toISOString(),
    },
  };
}

export async function handleAuthorizedSyncPost(
  caller: VerifiedFirebaseCaller,
  adapter: FirestoreWorkspaceAdapter,
  payload: {
    mutations?: PendingSyncMutation[];
    activeCompanyId?: string;
  } | null
): Promise<SyncPostResult> {
  const nowIso = new Date().toISOString();
  const rawMutations = Array.isArray(payload?.mutations) ? payload.mutations.slice(0, 200) : [];

  const processedIds = await adapter.getProcessedMutationIds(caller.uid);
  const processedSet = new Set(processedIds);
  const rejectedMutations: RejectedMutationInfo[] = [];
  let syncedCount = 0;

  for (const mut of rawMutations) {
    if (!mut || typeof mut.id !== 'string') {
      rejectedMutations.push({
        id: String((mut as { id?: string } | undefined)?.id || 'unknown'),
        companyId: String((mut as { companyId?: string } | undefined)?.companyId || ''),
        actionType: String((mut as { actionType?: string } | undefined)?.actionType || ''),
        status: 400,
        error: 'Mutación malformada.',
      });
      continue;
    }

    if (processedSet.has(mut.id)) {
      continue;
    }

    const existingCompany: CompanyProfile | null = isValidEntityId(mut.companyId)
      ? await adapter.getCompany(mut.companyId)
      : null;

    const decision = validateAndAuthorizeMutation(mut, caller, existingCompany);
    if (!decision.allowed) {
      rejectedMutations.push({
        id: mut.id,
        companyId: String(mut.companyId || ''),
        actionType: String(mut.actionType || ''),
        status: decision.status,
        error: decision.error,
      });
      continue;
    }

    if (decision.actionType === 'COMPANY_DELETE' && decision.deleteCompanyId) {
      if (existingCompany) {
        await adapter.deleteCompanyAndLedger(decision.deleteCompanyId);
      }
      processedIds.push(mut.id);
      processedSet.add(mut.id);
      syncedCount++;
      continue;
    }

    if (decision.actionType === 'COMPANY_CREATE' && decision.sanitizedCompany) {
      const target = decision.sanitizedCompany;
      const incomingCompTs = Date.parse(target.updatedAt || mut.timestamp);
      const currentCompTs = existingCompany ? Date.parse(existingCompany.updatedAt || '1970-01-01') : 0;
      if (!existingCompany || incomingCompTs >= currentCompTs) {
        await adapter.upsertCompany(target, !existingCompany);
      }

      const existingLedger = existingCompany ? await adapter.getLedger(target.id) : null;
      const dsToWrite = decision.sanitizedDataset || existingLedger || createEmptyCompanyDataset();
      const incomingDsTs = Date.parse(dsToWrite.updatedAt || mut.timestamp);
      const currentDsTs = existingLedger ? Date.parse(existingLedger.updatedAt || '1970-01-01') : 0;
      if (!existingLedger || incomingDsTs >= currentDsTs) {
        await adapter.upsertLedger(
          target.ownerUid || caller.uid,
          target.id,
          dsToWrite,
          !existingLedger
        );
      }
    } else if (
      decision.actionType === 'COMPANY_UPDATE' &&
      decision.sanitizedCompany &&
      existingCompany
    ) {
      const target = decision.sanitizedCompany;
      const currentTs = Date.parse(existingCompany.updatedAt || '1970-01-01');
      const incomingTs = Date.parse(target.updatedAt || mut.timestamp);
      if (incomingTs >= currentTs) {
        await adapter.upsertCompany(target, false);
      }
    } else if (
      decision.actionType === 'DATASET_UPDATE' &&
      decision.sanitizedDataset &&
      existingCompany
    ) {
      const existingLedger = await adapter.getLedger(existingCompany.id);
      const currentTs = existingLedger ? Date.parse(existingLedger.updatedAt || '1970-01-01') : 0;
      const incomingTs = Date.parse(decision.sanitizedDataset.updatedAt || mut.timestamp);
      if (!existingLedger || incomingTs >= currentTs) {
        await adapter.upsertLedger(
          existingCompany.ownerUid || caller.uid,
          existingCompany.id,
          decision.sanitizedDataset,
          !existingLedger
        );
      }
    }

    processedIds.push(mut.id);
    processedSet.add(mut.id);
    syncedCount++;
  }

  if (syncedCount > 0) {
    await adapter.saveProcessedMutationIds(caller.uid, processedIds);
  }

  if (rawMutations.length > 0 && syncedCount === 0 && rejectedMutations.length > 0) {
    const hasForbidden = rejectedMutations.some((r) => r.status === 403);
    return {
      status: hasForbidden ? 403 : 400,
      body: {
        ok: false,
        error: rejectedMutations[0].error,
        syncedCount: 0,
        rejectedMutations,
        serverTime: nowIso,
      },
    };
  }

  if (typeof payload?.activeCompanyId === 'string' && isValidEntityId(payload.activeCompanyId)) {
    const targetComp = await adapter.getCompany(payload.activeCompanyId);
    if (targetComp && (targetComp.ownerUid === caller.uid || caller.isSuperAdmin)) {
      await adapter.setUserActiveCompanyId(caller.uid, payload.activeCompanyId);
    }
  }

  const wsRes = await handleAuthorizedWorkspaceGet(caller, adapter, 'own');
  const workspace = wsRes.status === 200 ? (wsRes.body as WorkspaceState) : undefined;

  return {
    status: 200,
    body: {
      ok: true,
      syncedCount,
      rejectedMutations,
      serverTime: nowIso,
      workspace,
    },
  };
}
