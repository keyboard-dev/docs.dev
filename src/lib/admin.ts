/**
 * Admin sessions + content helpers.
 *
 * Two ways in, one session model:
 *   - GitHub sign-in (a GitHub App's OAuth user flow): real identity, and
 *     authorization = push access on the docs repo. Commits made while
 *     signed in this way are attributed to the actual editor.
 *   - PIN (default 1234, override with ADMIN_PIN): the original lightweight
 *     path, kept for solo use, local dev, and automated tests.
 *
 * The session is an AES-256-GCM-sealed JSON payload in an httpOnly cookie
 * (GCM gives both secrecy for the embedded GitHub token and integrity, so no
 * separate signature is needed). The key derives from ADMIN_SECRET. Legacy
 * HMAC-constant cookies from older sessions are still accepted as PIN
 * sessions.
 *
 * Edge-runtime safe: baseline content comes from a build-time manifest (no
 * fs) and edits persist via the GitHub API, so this runs unchanged on
 * Cloudflare Workers (`node:crypto` and Buffer under `nodejs_compat`).
 */

import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDocSource, listDocSlugs } from './content';

const COOKIE = 'docsdev_admin';
const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'docs-dev-poc-secret';

export type Session = {
  method: 'pin' | 'github';
  /** Stable identifier: GitHub login, or 'admin' for PIN sessions. */
  login: string;
  /** Display name shown to teammates. */
  name: string;
  avatar?: string;
  /** GitHub App user access token (only for method: 'github'). */
  ghToken?: string;
  /** Epoch ms when ghToken expires. */
  ghTokenExp?: number;
  ghRefresh?: string;
  /** Epoch ms when the session itself expires. */
  exp: number;
};

function key(): Buffer {
  return createHash('sha256').update(ADMIN_SECRET).digest();
}

/** Seal any JSON value into an opaque, tamper-proof string (AES-256-GCM). */
export function sealBox(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, enc, tag].map((b) => b.toString('base64url')).join('.');
}

export function openBox<T>(value: string): T | null {
  try {
    const [iv, enc, tag] = value.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !enc || !tag) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export function sealSession(session: Session): string {
  return sealBox(session);
}

export function openSession(value: string): Session | null {
  // Legacy cookie: the bare HMAC constant → a PIN session.
  if (safeEqual(value, sessionToken())) {
    return { method: 'pin', login: 'admin', name: 'Admin', exp: Date.now() + 60_000 };
  }
  const session = openBox<Session>(value);
  if (!session || typeof session.exp !== 'number' || session.exp < Date.now()) return null;
  return session;
}

export function sessionToken(): string {
  return createHmac('sha256', ADMIN_SECRET).update('admin-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPin(pin: string): boolean {
  return safeEqual(pin, ADMIN_PIN);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE_S = 60 * 60 * 8;

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return null;
  return openSession(value);
}

export async function isAdmin(): Promise<boolean> {
  return (await readSession()) != null;
}

/** Repo-relative path for a slug, e.g. "reading-experience" → "content/docs/reading-experience.mdx". */
export function docRepoPath(slug: string): string | null {
  const clean = slug.replace(/\.mdx$/, '').replace(/^\/+|\/+$/g, '');
  if (clean.length > 0 && !/^[a-z0-9][a-z0-9/-]*$/i.test(clean)) return null;
  return `content/docs/${clean === '' ? 'index' : clean}.mdx`;
}

/** Baseline (published) source for a page, from the build-time manifest. */
export async function readDoc(slug: string): Promise<string | null> {
  return getDocSource(slug);
}

export async function listDocs(): Promise<string[]> {
  return listDocSlugs();
}
