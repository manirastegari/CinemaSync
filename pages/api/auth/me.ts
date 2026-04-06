import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  return res.status(200).json({
    id: payload.id,
    username: payload.username,
    role: payload.role,
    displayName: payload.displayName,
  });
}
