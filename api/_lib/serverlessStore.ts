import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  CompanyDataset,
  WorkspaceState,
} from '../../src/types/accounting.ts';
import {
  createEmptyCompanyDataset,
  DEFAULT_COMPANIES,
} from '../../src/utils/venezuelaCatalog.ts';

export interface VercelRequestLike {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

export interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
}

export interface ServerStore extends WorkspaceState {
  processedMutationIds: string[];
}

const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'equinox-books-data')
  : path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'equinox-workspace.json');

export function buildInitialStore(): ServerStore {
  const companyData: Record<string, CompanyDataset> = {};
  for (const company of DEFAULT_COMPANIES) {
    companyData[company.id] = createEmptyCompanyDataset();
  }
  return {
    companies: DEFAULT_COMPANIES,
    activeCompanyId: DEFAULT_COMPANIES[0].id,
    companyData,
    lastServerSync: new Date().toISOString(),
    processedMutationIds: [],
  };
}

export function readServerlessStore(): ServerStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_FILE)) {
      const initial = buildInitialStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ServerStore;
    if (!parsed || !Array.isArray(parsed.companies) || parsed.companies.length === 0) {
      const initial = buildInitialStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    parsed.processedMutationIds = Array.isArray(parsed.processedMutationIds)
      ? parsed.processedMutationIds
      : [];
    return parsed;
  } catch {
    return buildInitialStore();
  }
}

export function writeServerlessStore(store: ServerStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Serverless environments may restrict disk persistence outside active memory/Firestore
  }
}

export function parseRequestBody<T>(rawBody: unknown): T | null {
  if (rawBody === null || rawBody === undefined) return null;
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as T;
    } catch {
      return null;
    }
  }
  if (typeof rawBody === 'object') {
    return rawBody as T;
  }
  return null;
}
