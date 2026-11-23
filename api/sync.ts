import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { PendingSyncMutation } from '../src/types/accounting.js';
import { authenticateFirebaseRequest } from './_lib/firebaseAuth.js';
import { createFirestoreRestAdapter, FirestoreRestError } from './_lib/firestoreRest.js';
import { parseRequestBody } from './_lib/serverlessStore.js';
import { handleAuthorizedSyncPost } from './_lib/workspaceService.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  let caller;
  try {
    caller = await authenticateFirebaseRequest(req.headers.authorization);
  } catch (err) {
    res.status(401).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Autenticación requerida.',
    });
    return;
  }

  try {
    const body = parseRequestBody<{
      mutations?: PendingSyncMutation[];
      activeCompanyId?: string;
    }>(req.body);

    const adapter = createFirestoreRestAdapter(caller.idToken);
    const result = await handleAuthorizedSyncPost(caller, adapter, body);
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof FirestoreRestError) {
      res.status(err.status).json({
        ok: false,
        error: err.message,
        code: err.code,
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno de sincronización',
    });
  }
}
