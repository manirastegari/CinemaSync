import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(process.cwd(), 'cinemasync.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL,
      password_hash TEXT  NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      display_name TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login  DATETIME
    );

    CREATE TABLE IF NOT EXISTS active_session (
      id          INTEGER PRIMARY KEY CHECK(id = 1),
      video_url   TEXT    NOT NULL DEFAULT '',
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO active_session (id, video_url) VALUES (1, '');
  `);

  // Seed default admin account if none exists
  const adminExists = db
    .prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
    .get();

  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 12);
    db.prepare(
      `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', 'Admin')`
    ).run('admin', hash);
    console.log('  ✦ Default admin created → username: admin  password: admin123');
  }

  // Seed default regular user if none exists
  const userExists = db
    .prepare(`SELECT id FROM users WHERE role = 'user' LIMIT 1`)
    .get();

  if (!userExists) {
    const hash = bcrypt.hashSync('watch123', 12);
    db.prepare(
      `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'user', 'Partner')`
    ).run('partner', hash);
    console.log('  ✦ Default user created   → username: partner  password: watch123');
  }
}

// ── User helpers ──────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  last_login: string | null;
}

export function getUserByUsername(username: string): (User & { password_hash: string }) | undefined {
  return getDb()
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as (User & { password_hash: string }) | undefined;
}

export function getAllUsers(): User[] {
  return getDb()
    .prepare(`SELECT id, username, role, display_name, created_at, last_login FROM users ORDER BY role DESC, username ASC`)
    .all() as User[];
}

export function createUser(username: string, password: string, role: 'admin' | 'user' = 'user', displayName?: string): User {
  const hash = bcrypt.hashSync(password, 12);
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)`)
    .run(username, hash, role, displayName || username);
  return db
    .prepare(`SELECT id, username, role, display_name, created_at, last_login FROM users WHERE id = ?`)
    .get(result.lastInsertRowid) as User;
}

export function updateUserPassword(id: number, newPassword: string): void {
  const hash = bcrypt.hashSync(newPassword, 12);
  getDb().prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
}

export function deleteUser(id: number): void {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

export function touchLastLogin(id: number): void {
  getDb()
    .prepare(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(id);
}

// ── Session helpers ───────────────────────────────────────────────────────────

export function getSessionUrl(): string {
  const row = getDb()
    .prepare(`SELECT video_url FROM active_session WHERE id = 1`)
    .get() as { video_url: string } | undefined;
  return row?.video_url ?? '';
}

export function setSessionUrl(url: string): void {
  getDb()
    .prepare(`UPDATE active_session SET video_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(url);
}
