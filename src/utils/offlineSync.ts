import {
  PendingSyncMutation,
  SyncLogEntry,
  WorkspaceState,
} from '../types/accounting';
import { createEmptyCompanyDataset, DEFAULT_COMPANIES } from './venezuelaCatalog';

const IDB_NAME = 'equinox_books_offline_idb';
const IDB_VERSION = 1;
const STORE_KV = 'workspace_kv';

const LS_WORKSPACE_KEY = 'equinox_books_workspace_v2';
const LS_OUTBOX_KEY = 'equinox_books_outbox_v2';
const LS_SYNCLOG_KEY = 'equinox_books_synclog_v2';

let dbPromise: Promise<IDBDatabase> | null = null;

function openIDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });

  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const store = tx.objectStore(STORE_KV);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback handled by localStorage
  }
}

/**
 * Compacta snapshots repetidos de una misma empresa en la cola offline:
 * preserva el historial visible de mutaciones pendientes, pero conserva
 * el snapshot completo únicamente en la mutación más reciente por empresa.
 */
export function compactOutboxQueue(queue: PendingSyncMutation[]): PendingSyncMutation[] {
  const latestDatasetIdxByCompany = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    const mut = queue[i];
    if (mut.datasetSnapshot && mut.companyId) {
      latestDatasetIdxByCompany.set(mut.companyId, i);
    }
  }
  return queue.map((mut, idx) => {
    if (!mut.datasetSnapshot || !mut.companyId) return mut;
    const latestIdx = latestDatasetIdxByCompany.get(mut.companyId);
    if (latestIdx !== undefined && idx < latestIdx) {
      const { datasetSnapshot: _omitted, ...rest } = mut;
      return rest;
    }
    return mut;
  });
}

export function buildDefaultWorkspace(): WorkspaceState {
  const companyData: WorkspaceState['companyData'] = {};
  for (const c of DEFAULT_COMPANIES) {
    companyData[c.id] = createEmptyCompanyDataset();
  }
  return {
    companies: DEFAULT_COMPANIES,
    activeCompanyId: DEFAULT_COMPANIES[0].id,
    companyData,
    lastServerSync: null,
  };
}

function normalizeWorkspaceState(ws: WorkspaceState): WorkspaceState {
  const validCompanies = Array.isArray(ws.companies) && ws.companies.length > 0
    ? ws.companies
    : DEFAULT_COMPANIES;
  const activeId = validCompanies.some((c) => c.id === ws.activeCompanyId)
    ? ws.activeCompanyId
    : validCompanies[0].id;
  return {
    ...ws,
    companies: validCompanies,
    activeCompanyId: activeId,
    companyData: ws.companyData && typeof ws.companyData === 'object' ? ws.companyData : {},
  };
}

export async function loadLocalWorkspace(): Promise<WorkspaceState> {
  const fromIdb = await idbGet<WorkspaceState>('workspace');
  if (fromIdb && Array.isArray(fromIdb.companies) && fromIdb.companies.length > 0) {
    return normalizeWorkspaceState(fromIdb);
  }
  try {
    const raw = localStorage.getItem(LS_WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceState;
      if (parsed && Array.isArray(parsed.companies) && parsed.companies.length > 0) {
        return normalizeWorkspaceState(parsed);
      }
    }
  } catch {
    // ignore corrupted local storage
  }
  const initial = buildDefaultWorkspace();
  await saveLocalWorkspace(initial);
  return initial;
}

let pendingLocalLsTimer: ReturnType<typeof setTimeout> | null = null;
let latestWorkspaceForLs: WorkspaceState | null = null;

export async function saveLocalWorkspace(workspace: WorkspaceState): Promise<void> {
  await idbSet('workspace', workspace);
  latestWorkspaceForLs = workspace;
  if (pendingLocalLsTimer) clearTimeout(pendingLocalLsTimer);
  pendingLocalLsTimer = setTimeout(() => {
    pendingLocalLsTimer = null;
    if (!latestWorkspaceForLs) return;
    try {
      localStorage.setItem(LS_WORKSPACE_KEY, JSON.stringify(latestWorkspaceForLs));
    } catch {
      // ignore storage quota errors
    }
  }, 150);
}

export async function loadOutbox(): Promise<PendingSyncMutation[]> {
  const fromIdb = await idbGet<PendingSyncMutation[]>('outbox');
  if (Array.isArray(fromIdb)) return fromIdb;
  try {
    const raw = localStorage.getItem(LS_OUTBOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export async function saveOutbox(queue: PendingSyncMutation[]): Promise<void> {
  const compacted = compactOutboxQueue(queue);
  try {
    localStorage.setItem(LS_OUTBOX_KEY, JSON.stringify(compacted));
  } catch {
    // ignore
  }
  await idbSet('outbox', compacted);
}

export async function loadSyncLogs(): Promise<SyncLogEntry[]> {
  const fromIdb = await idbGet<SyncLogEntry[]>('synclogs');
  if (Array.isArray(fromIdb)) return fromIdb;
  try {
    const raw = localStorage.getItem(LS_SYNCLOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export async function saveSyncLogs(logs: SyncLogEntry[]): Promise<void> {
  const trimmed = logs.slice(0, 60);
  try {
    localStorage.setItem(LS_SYNCLOG_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
  await idbSet('synclogs', trimmed);
}

export async function checkServerConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchServerWorkspace(): Promise<WorkspaceState | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/workspace', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as WorkspaceState;
    if (data && Array.isArray(data.companies) && data.companies.length > 0) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function pushOutboxToServer(
  mutations: PendingSyncMutation[],
  activeCompanyId: string
): Promise<{ ok: boolean; syncedCount: number; serverTime?: string; workspace?: WorkspaceState }> {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations, activeCompanyId }),
    });
    if (!res.ok) return { ok: false, syncedCount: 0 };
    return await res.json();
  } catch {
    return { ok: false, syncedCount: 0 };
  }
}
