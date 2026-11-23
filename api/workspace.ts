import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateFirebaseRequest } from './_lib/firebaseAuth.js';
import { createFirestoreRestAdapter, FirestoreRestError } from './_lib/firestoreRest.js';
import { handleAuthorizedWorkspaceGet } from './_lib/workspaceService.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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
    const adapter = createFirestoreRestAdapter(caller.idToken);
    const result = await handleAuthorizedWorkspaceGet(caller, adapter, req.query?.scope);
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof FirestoreRestError) {
      res.status(err.status).json({ ok: false, error: err.message, code: err.code });
      return;
    }
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error al consultar Firestore.',
    });
  }
}
