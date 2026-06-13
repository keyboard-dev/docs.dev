/**
 * Admin session + content helpers (PROOF OF CONCEPT).
 *
 * Auth model: a 4-digit PIN (default 1234, override with ADMIN_PIN) unlocks an
 * httpOnly session cookie. The cookie stores an HMAC of a constant keyed by
 * ADMIN_SECRET — never the PIN — so it can't be forged just by guessing the
 * cookie name, and we can validate it statelessly (no session store needed).
 *
 * Edge-runtime safe: baseline content comes from a build-time manifest (no fs)
 * and edits are persisted via the GitHub API, so this runs unchanged on
 * Cloudflare Workers. `node:crypto` and Buffer work under `nodejs_compat`.
 *
 * Intentionally minimal — a production build would use real auth (e.g. a
 * GitHub App) rather than a PIN.
 */

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDocSource, listDocSlugs } from './content';

const COOKIE = 'docsdev_admin';
const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'docs-dev-poc-secret';

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

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return false;
  return safeEqual(value, sessionToken());
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
