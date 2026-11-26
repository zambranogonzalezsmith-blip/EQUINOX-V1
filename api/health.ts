import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from './_lib/firebaseAuth.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const projectId = resolveFirebaseProjectId();
  const databaseId = resolveFirestoreDatabaseId();

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    serverTime: new Date().toISOString(),
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-api',
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    firebaseConfigured: Boolean(projectId),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    databaseId,
  });
}
