import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    serverTime: new Date().toISOString(),
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-api',
  });
}
