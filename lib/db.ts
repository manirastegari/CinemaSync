import bcrypt from 'bcryptjs';

// ── Pure in-memory store (no native modules, works on any platform) ───────────

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  last_login: string | null;
}

interface UserRecord extends User {
  password_hash: string;
}

let nextId = 1;
const users = new Map<number, UserRecord>();
let sessionUrl = '';

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function seed() {
  if (users.size > 0) return;

  const adminHash = bcrypt.hashSync('admin123', 10);
  users.set(nextId, {
    id: nextId++,
    username: 'admin',
    password_hash: adminHash,
    role: 'admin',
    display_name: 'Admin',
    created_at: now(),
    last_login: null,
  });

  const userHash = bcrypt.hashSync('watch123', 10);
  users.set(nextId, {
    id: nextId++,
    username: 'partner',
    password_hash: userHash,
    role: 'user',
    display_name: 'Partner',
    created_at: now(),
    last_login: null,
  });

  console.log('  ✦ Default admin created → username: admin    password: admin123');
  console.log('  ✦ Default user created  → username: partner  password: watch123');
}

seed();

// ── User helpers ──────────────────────────────────────────────────────────────

export function getUserByUsername(username: string): UserRecord | undefined {
  for (const u of users.values()) {
    if (u.username === username) return u;
  }
  return undefined;
}

export function getAllUsers(): User[] {
  return Array.from(users.values())
    .map(({ password_hash: _ph, ...u }) => u)
    .sort((a, b) => (a.role === 'admin' ? -1 : 1) || a.username.localeCompare(b.username));
}

export function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user' = 'user',
  displayName?: string
): User {
  const hash = bcrypt.hashSync(password, 10);
  const id = nextId++;
  const record: UserRecord = {
    id,
    username,
    password_hash: hash,
    role,
    display_name: displayName || username,
    created_at: now(),
    last_login: null,
  };
  users.set(id, record);
  const { password_hash: _ph, ...user } = record;
  return user;
}

export function updateUserPassword(id: number, newPassword: string): void {
  const u = users.get(id);
  if (u) u.password_hash = bcrypt.hashSync(newPassword, 10);
}

export function deleteUser(id: number): void {
  users.delete(id);
}

export function touchLastLogin(id: number): void {
  const u = users.get(id);
  if (u) u.last_login = now();
}

// ── Session helpers ───────────────────────────────────────────────────────────

export function getSessionUrl(): string {
  return sessionUrl;
}

export function setSessionUrl(url: string): void {
  sessionUrl = url;
}
