/**
 * Admin session + content helpers.
 *
 * Two auth modes:
 *  - docs.dev sign-in (recommended): set DOCSDEV_SITE_ID and sessions are
 *    short-lived JWTs issued by the docs.dev service after it verifies the
 *    user is a member of your team (see lib/docsdev-sso.ts). The PIN path is
 *    disabled entirely in this mode.
 *  - Legacy PIN (standalone fallback): a 4-digit PIN (default 1234, override
 *    with ADMIN_PIN) unlocks an httpOnly cookie storing an HMAC of a constant
 *    keyed by ADMIN_SECRET — never the PIN — validated statelessly.
 *
 * Edge-runtime safe: baseline content comes from a build-time manifest (no fs)
 * and edits are persisted via the GitHub API, so this runs unchanged on
 * Cloudflare Workers. `node:crypto` and Buffer work under `nodejs_compat`.
 */

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDocSource, listDocSlugs } from './content';
import { ssoEnabled, verifySsoToken, SSO_JWT_COOKIE, type SsoSession } from './docsdev-sso';

const COOKIE = 'docsdev_admin';
const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'docs-dev-poc-secret';

export function sessionToken(): string {
  // Bind the token to the PIN, not just the secret. If an operator only
  // changes the PIN (and forgets ADMIN_SECRET), a public reader of this repo
  // still can't compute a valid cookie without also knowing the PIN — so
  // there's one risk surface (the documented default PIN), not two.
  return createHmac('sha256', ADMIN_SECRET).update(`admin-v1:${ADMIN_PIN}`).digest('hex');
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

/** Whether the deployment is still running the (publicly known) default PIN. */
export function usingDefaultPin(): boolean {
  return ADMIN_PIN === '1234';
}

export const SESSION_COOKIE = COOKIE;

/**
 * The signed-in editor session. Both roles ('admin' and 'editor') may edit;
 * 'admin' additionally manages members. PIN sessions count as admin.
 */
export async function getAdminSession(): Promise<SsoSession | null> {
  const store = await cookies();
  if (ssoEnabled()) {
    const token = store.get(SSO_JWT_COOKIE)?.value;
    if (!token) return null;
    return verifySsoToken(token);
  }
  const value = store.get(COOKIE)?.value;
  if (!value || !safeEqual(value, sessionToken())) return null;
  return { email: 'admin@local', role: 'admin' };
}

export async function isAdmin(): Promise<boolean> {
  return (await getAdminSession()) !== null;
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
