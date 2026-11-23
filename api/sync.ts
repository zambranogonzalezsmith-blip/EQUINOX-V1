import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
  WorkspaceState,
} from '../src/types/accounting.ts';
import {
  parseRequestBody,
  readServerlessStore,
  writeServerlessStore,
  type VercelRequestLike,
  type VercelResponseLike,
} from './_lib/serverlessStore.ts';

export default function handler(req: VercelRequestLike, res: VercelResponseLike): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = parseRequestBody<{
      mutations?: PendingSyncMutation[];
      activeCompanyId?: string;
    }>(req.body);

    const mutations = Array.isArray(body?.mutations) ? body.mutations.slice(0, 500) : [];
    const store = readServerlessStore();
    let syncedCount = 0;

    for (const mut of mutations) {
      if (!mut || typeof mut.id !== 'string' || !mut.id) continue;
      if (store.processedMutationIds.includes(mut.id)) {
        continue;
      }

      if (typeof mut.deletedCompanyId === 'string' && mut.deletedCompanyId) {
        store.companies = store.companies.filter((c) => c.id !== mut.deletedCompanyId);
        delete store.companyData[mut.deletedCompanyId];
        if (store.activeCompanyId === mut.deletedCompanyId && store.companies.length > 0) {
          store.activeCompanyId = store.companies[0].id;
        }
      }

      if (mut.companySnapshot && typeof mut.companySnapshot === 'object') {
        const incomingCompany = mut.companySnapshot as CompanyProfile;
        if (typeof incomingCompany.id === 'string' && incomingCompany.id) {
          const idx = store.companies.findIndex((c) => c.id === incomingCompany.id);
          if (idx >= 0) {
            const currentTs = Date.parse(store.companies[idx].updatedAt || '1970-01-01');
            const incomingTs = Date.parse(incomingCompany.updatedAt || mut.timestamp);
            if (incomingTs >= currentTs) {
              store.companies[idx] = incomingCompany;
            }
          } else {
            store.companies.push(incomingCompany);
          }
        }
      }

      if (mut.datasetSnapshot && typeof mut.companyId === 'string' && mut.companyId) {
        const incomingData = mut.datasetSnapshot as CompanyDataset;
        const existing = store.companyData[mut.companyId];
        if (!existing) {
          store.companyData[mut.companyId] = incomingData;
        } else {
          const currentTs = Date.parse(existing.updatedAt || '1970-01-01');
          const incomingTs = Date.parse(incomingData.updatedAt || mut.timestamp);
          if (incomingTs >= currentTs) {
            store.companyData[mut.companyId] = incomingData;
          }
        }
      }

      store.processedMutationIds.push(mut.id);
      if (store.processedMutationIds.length > 500) {
        store.processedMutationIds = store.processedMutationIds.slice(-500);
      }
      syncedCount++;
    }

    if (
      typeof body?.activeCompanyId === 'string' &&
      store.companies.some((c) => c.id === body.activeCompanyId)
    ) {
      store.activeCompanyId = body.activeCompanyId;
    }

    store.lastServerSync = new Date().toISOString();
    writeServerlessStore(store);

    const workspace: WorkspaceState = {
      companies: store.companies,
      activeCompanyId: store.activeCompanyId,
      companyData: store.companyData,
      lastServerSync: store.lastServerSync,
    };

    res.status(200).json({
      ok: true,
      syncedCount,
      serverTime: store.lastServerSync,
      workspace,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno de sincronización',
    });
  }
}
