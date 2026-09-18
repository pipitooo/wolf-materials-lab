import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import {
  randomUUID,
  scryptSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Local, cookie-session authentication for the workshop demo. Passwords are
// scrypt-hashed, sessions are opaque tokens stored in SQLite. No external IdP.
export type AuthUser = { id: string; name: string; email: string };

export const SESSION_COOKIE = "wolf_session";
const SESSION_DAYS = 7;
const SEED_EMAIL = "buyer@demo.local";
const SEED_PASSWORD = "wolf-demo";

function authDbPath(): string {
  return (
    process.env.WOLF_AUTH_DB_PATH ??
    (process.env.VERCEL
      ? resolve("/tmp/wolf-auth.sqlite")
      : resolve(process.cwd(), ".wolf/auth.sqlite"))
  );
}

function openDb(): DatabaseSync {
  const path = authDbPath();
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA busy_timeout=5000; " +
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created TEXT NOT NULL, expires INTEGER NOT NULL);",
  );
  return db;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function seed(db: DatabaseSync): void {
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(SEED_EMAIL);
  if (existing) return;
  const salt = randomBytes(16).toString("hex");
  db.prepare(
    "INSERT INTO users (id, name, email, salt, hash, created) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    "Demo Buyer",
    SEED_EMAIL,
    salt,
    hashPassword(SEED_PASSWORD, salt),
    new Date().toISOString(),
  );
}

export function signIn(email: string, password: string): AuthUser | null {
  const db = openDb();
  try {
    seed(db);
    const row = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase()) as
      | { id: string; name: string; email: string; salt: string; hash: string }
      | undefined;
    if (!row) return null;
    const candidate = Buffer.from(hashPassword(password, row.salt), "hex");
    const stored = Buffer.from(row.hash, "hex");
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored))
      return null;
    return { id: row.id, name: row.name, email: row.email };
  } finally {
    db.close();
  }
}

export function signUp(
  name: string,
  email: string,
  password: string,
): AuthUser {
  const db = openDb();
  try {
    seed(db);
    const normalized = email.toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(normalized))
      throw new Error("An account with this email already exists");
    const id = randomUUID();
    const salt = randomBytes(16).toString("hex");
    db.prepare(
      "INSERT INTO users (id, name, email, salt, hash, created) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      name,
      normalized,
      salt,
      hashPassword(password, salt),
      new Date().toISOString(),
    );
    return { id, name, email: normalized };
  } finally {
    db.close();
  }
}

export function createSession(
  userId: string,
): { token: string; maxAge: number } {
  const db = openDb();
  try {
    const token = randomBytes(32).toString("hex");
    const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)",
    ).run(token, userId, new Date().toISOString(), expires);
    return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 };
  } finally {
    db.close();
  }
}

export function getUserByToken(token: string): AuthUser | null {
  const db = openDb();
  try {
    const session = db
      .prepare("SELECT * FROM sessions WHERE token = ?")
      .get(token) as { user_id: string; expires: number } | undefined;
    if (!session || session.expires < Date.now()) return null;
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(session.user_id) as
      | { id: string; name: string; email: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name, email: row.email };
  } finally {
    db.close();
  }
}

export function deleteSession(token: string): void {
  const db = openDb();
  try {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  } finally {
    db.close();
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = part.slice(idx + 1).trim();
  }
  return out;
}

export function currentUser(req: Request): AuthUser | null {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  return getUserByToken(token);
}

export function sessionCookieHeader(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
