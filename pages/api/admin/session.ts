import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { getSessionUrl, setSessionUrl } from '@/lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    return res.status(200).json({ url: getSessionUrl() });
  }

  if (req.method === 'POST') {
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { url } = req.body as { url: string };
    if (typeof url !== 'string') return res.status(400).json({ error: 'url required.' });
    setSessionUrl(url.trim());
    return res.status(200).json({ ok: true, url: url.trim() });
  }

  return res.status(405).end();
}
