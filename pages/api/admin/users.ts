import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { getAllUsers, createUser, deleteUser, updateUserPassword } from '@/lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'GET') {
    return res.status(200).json(getAllUsers());
  }

  if (req.method === 'POST') {
    const { username, password, role, displayName } = req.body as {
      username: string;
      password: string;
      role?: 'admin' | 'user';
      displayName?: string;
    };
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    try {
      const user = createUser(username.trim().toLowerCase(), password, role || 'user', displayName);
      return res.status(201).json(user);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already exists.' });
      }
      return res.status(500).json({ error: 'Failed to create user.' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, password } = req.body as { id: number; password: string };
    if (!id || !password) return res.status(400).json({ error: 'id and password required.' });
    updateUserPassword(id, password);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body as { id: number };
    if (!id) return res.status(400).json({ error: 'id required.' });
    if (id === payload.id) return res.status(400).json({ error: 'Cannot delete yourself.' });
    deleteUser(id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
