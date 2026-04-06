import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getUserByUsername, touchLastLogin } from '@/lib/db';
import { setAuthCookie } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body as { username: string; password: string };

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = getUserByUsername(username.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  touchLastLogin(user.id);

  setAuthCookie(res, {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
  });

  return res.status(200).json({
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
  });
}
