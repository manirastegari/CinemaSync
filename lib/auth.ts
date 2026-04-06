import jwt from 'jsonwebtoken';
import { serialize, parse } from 'cookie';
import type { IncomingMessage, ServerResponse } from 'http';

const JWT_SECRET = process.env.JWT_SECRET || 'cinemasync-super-secret-key-change-in-prod';
const COOKIE_NAME = 'cs_token';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface JwtPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
  displayName: string | null;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: MAX_AGE });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: ServerResponse, payload: JwtPayload): void {
  const token = signToken(payload);
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: MAX_AGE,
      path: '/',
    })
  );
}

export function clearAuthCookie(res: ServerResponse): void {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
  );
}

export function getTokenFromRequest(req: IncomingMessage): JwtPayload | null {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}
