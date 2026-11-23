import type { WorkspaceState } from '../src/types/accounting.ts';
import {
  readServerlessStore,
  type VercelRequestLike,
  type VercelResponseLike,
} from './_lib/serverlessStore.ts';

export default function handler(req: VercelRequestLike, res: VercelResponseLike): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const store = readServerlessStore();
  const workspace: WorkspaceState = {
    companies: store.companies,
    activeCompanyId: store.activeCompanyId,
    companyData: store.companyData,
    lastServerSync: store.lastServerSync,
  };

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(workspace);
}
