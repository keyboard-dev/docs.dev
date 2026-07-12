/**
 * Admin sessions + content helpers.
 *
 * Three ways in, one session model:
 *   - docs.dev sign-in (recommended): connect the site to docs.dev (or set
 *     DOCSDEV_SITE_ID) and sessions are
 *     short-lived JWTs issued by the docs.dev service after it verifies the
 *     user is a member of your team (see lib/docsdev-sso.ts). When SSO is
 *     configured, the other paths are disabled entirely — a leftover PIN or
 *     GitHub App config must not bypass team membership.
 *   - GitHub sign-in (a GitHub App's OAuth user flow): real identity, and
 *     authorization = push access on the docs repo. Commits made while
 *     signed in this way are attributed to the actual editor.
 *   - PIN (standalone fallback): set via the ADMIN_PIN secret. There is no
 *     baked-in default — this repo is public, so any hardcoded fallback is a
 *     published constant, not a secret. Unset means the PIN path fails
 *     closed. Same for ADMIN_SECRET.
 *
 * PIN and GitHub sessions are AES-256-GCM-sealed JSON payloads in an httpOnly
 * cookie (GCM gives both secrecy for the embedded GitHub token and integrity,
 * so no separate signature is needed). The key derives from ADMIN_SECRET —
 * both of those paths therefore require ADMIN_SECRET. Legacy HMAC-constant
 * cookies from older sessions are still accepted as PIN sessions.
 *
 * Edge-runtime safe: baseline content comes from a build-time manifest (no
 * fs) and edits persist via the GitHub API, so this runs unchanged on
 * Cloudflare Workers (`node:crypto` and Buffer under `nodejs_compat`).
 */

import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDocSource, listDocSlugs } from './content';
import { ssoActive, verifySsoToken, SSO_JWT_COOKIE } from './docsdev-sso';

const COOKIE = 'docsdev_admin';
const ADMIN_PIN = process.env.ADMIN_PIN || null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

/** Whether standalone PIN login is usable at all — both secrets must be set. */
export function pinAuthConfigured(): boolean {
  return ADMIN_PIN !== null && ADMIN_SECRET !== null;
}

/** Sealed (PIN/GitHub) sessions need the sealing key. */
export function sealedSessionsConfigured(): boolean {
  return ADMIN_SECRET !== null;
}

export type Session = {
  method: 'pin' | 'github' | 'docsdev';
  /** Stable identifier: GitHub login, email for docs.dev, or 'admin' for PIN. */
  login: string;
  /** Display name shown to teammates. */
  name: string;
  avatar?: string;
  /** docs.dev team role (only for method: 'docsdev'). PIN/GitHub imply admin. */
  role?: 'admin' | 'editor';
  /** GitHub App user access token (only for method: 'github'). */
  ghToken?: string;
  /** Epoch ms when ghToken expires. */
  ghTokenExp?: number;
  ghRefresh?: string;
  /** Epoch ms when the session itself expires. */
  exp: number;
};

function key(): Buffer {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET must be set to use PIN or GitHub sign-in sessions.');
  }
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
  if (!sealedSessionsConfigured()) return null;
  // Legacy cookie: the bare HMAC constant → a PIN session.
  if (pinAuthConfigured() && safeEqual(value, sessionToken())) {
    return { method: 'pin', login: 'admin', name: 'Admin', exp: Date.now() + 60_000 };
  }
  const session = openBox<Session>(value);
  if (!session || typeof session.exp !== 'number' || session.exp < Date.now()) return null;
  return session;
}

export function sessionToken(): string {
  if (!ADMIN_PIN || !ADMIN_SECRET) {
    throw new Error('ADMIN_PIN and ADMIN_SECRET must both be set to use standalone PIN login.');
  }
  // Bind the token to the PIN, not just the secret, so leaking one alone
  // (e.g. a copy-pasted ADMIN_SECRET) doesn't yield a forgeable cookie.
  return createHmac('sha256', ADMIN_SECRET).update(`admin-v1:${ADMIN_PIN}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPin(pin: string): boolean {
  if (!ADMIN_PIN) return false; // fail closed — no default to fall back to
  return safeEqual(pin, ADMIN_PIN);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE_S = 60 * 60 * 8;

/**
 * The signed-in editor session, whatever the sign-in method. With docs.dev
 * SSO configured, this is the only path — the JWT in its own cookie is mapped
 * into the shared Session shape so drafts/publish/presence work unchanged
 * (no ghToken → publishing falls back to the server GITHUB_PAT).
 */
export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  if (await ssoActive()) {
    const token = store.get(SSO_JWT_COOKIE)?.value;
    if (!token) return null;
    const sso = await verifySsoToken(token);
    if (!sso) return null;
    return {
      method: 'docsdev',
      login: sso.email,
      name: sso.email.split('@')[0] || sso.email,
      role: sso.role,
      exp: Date.now() + SESSION_MAX_AGE_S * 1000, // real expiry enforced by the JWT itself
    };
  }
  if (!sealedSessionsConfigured()) return null; // nothing to authenticate against
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
