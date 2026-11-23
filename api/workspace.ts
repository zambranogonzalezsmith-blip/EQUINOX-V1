import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { WorkspaceState } from '../src/types/accounting.js';
import { readServerlessStore } from './_lib/serverlessStore.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
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
