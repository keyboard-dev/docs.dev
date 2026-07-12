/**
 * "Sign in with docs.dev" client.
 *
 * When this site is registered with docs.dev, the /admin editor
 * authenticates against the docs.dev service instead of the local PIN: we
 * redirect to the central /authorize endpoint (PKCE — no secret on this
 * worker), docs.dev checks the user is a member of the org that owns this
 * site and that our callback URL exactly matches the org's registered
 * redirect URI, and hands back a short-lived ES256 JWT we verify against the
 * docs.dev JWKS.
 *
 * The Site ID resolves at runtime: the DOCSDEV_SITE_ID env var wins when
 * set, otherwise we ask docs.dev "is this hostname registered?"
 * (`/api/v1/sites/lookup`) and cache the answer per isolate. Connecting a
 * site at $ISSUER/connect therefore takes effect within seconds — no env
 * vars, no redeploy.
 *
 * Optional env overrides:
 *   DOCSDEV_SITE_ID — pin the site id (skips the runtime lookup)
 *   DOCSDEV_ISSUER  — the docs.dev service origin (default https://app.docs.dev)
 */

import { headers } from 'next/headers';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export const SSO_JWT_COOKIE = 'docsdev_admin_jwt';
export const SSO_STATE_COOKIE = 'docsdev_sso_state';
export const SSO_VERIFIER_COOKIE = 'docsdev_sso_verifier';

export interface SsoSession {
  email: string;
  role: 'admin' | 'editor';
}

export function ssoIssuer(): string {
  return process.env.DOCSDEV_ISSUER || 'https://app.docs.dev';
}

/** This request's public hostname (no port), or null outside a request. */
export async function requestHost(): Promise<string | null> {
  try {
    const host = (await headers()).get('host')?.split(':')[0]?.toLowerCase() ?? null;
    if (!host || host === 'localhost' || host === '127.0.0.1') return null;
    return host;
  } catch {
    return null; // no request scope (build-time render)
  }
}

// Per-isolate lookup cache. Positive answers are stable (sites rarely
// disconnect); negative ones expire fast so /connect flips the site to
// configured within seconds.
const siteIdCache = new Map<string, { siteId: string | null; expires: number }>();
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 15_000;

// docs.dev-first onboarding: when the site was created in the docs.dev
// dashboard before this Worker existed, the user pasted a one-time setup
// token into the Deploy button's DOCSDEV_SITE_TOKEN field. This Worker is
// the only party that knows both the token and its real hostname, so it
// redeems the token once — binding this host to the pending site. Single
// attempt per isolate; after success the ordinary lookup takes over (and
// the burned token is ignored forever).
//
// This must only ever run from genuinely dynamic contexts (route handlers
// like /api/admin/session) — resolveSiteId reads request headers, and a
// statically prerendered page that touches a dynamic API at runtime is a
// hard Next error ("Page changed from static to dynamic"), which took the
// whole site down when this briefly lived in the root layout.
let claimAttempted = false;

async function claimHostWithSetupToken(host: string): Promise<string | null> {
  const token = process.env.DOCSDEV_SITE_TOKEN;
  if (!token || claimAttempted) return null;
  claimAttempted = true;
  try {
    const res = await fetch(new URL('/api/v1/sites/claim-host', ssoIssuer()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setup_token: token, host }),
    });
    if (!res.ok) return null; // burned/expired token — the lookup is the truth
    return ((await res.json()) as { site_id?: string }).site_id ?? null;
  } catch {
    claimAttempted = false; // issuer unreachable — worth retrying later
    return null;
  }
}

/**
 * The site id this deployment should authenticate as: DOCSDEV_SITE_ID if
 * set, else the runtime hostname lookup. Null means SSO is not configured
 * (standalone PIN / GitHub auth applies).
 */
export async function resolveSiteId(): Promise<string | null> {
  if (process.env.DOCSDEV_SITE_ID) return process.env.DOCSDEV_SITE_ID;

  const host = await requestHost();
  if (!host) return null;

  const cached = siteIdCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.siteId;

  let siteId: string | null = null;
  try {
    const res = await fetch(new URL(`/api/v1/sites/lookup?host=${host}`, ssoIssuer()));
    if (res.ok) {
      siteId = ((await res.json()) as { site_id?: string }).site_id ?? null;
    }
  } catch {
    siteId = null; // issuer unreachable — treat as unconfigured, retry soon
  }
  if (!siteId) siteId = await claimHostWithSetupToken(host);
  siteIdCache.set(host, {
    siteId,
    expires: Date.now() + (siteId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return siteId;
}

export async function ssoActive(): Promise<boolean> {
  return (await resolveSiteId()) !== null;
}

// Module-scoped so the JWKS fetch is cached per worker isolate.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer: string | null = null;

export async function verifySsoToken(token: string): Promise<SsoSession | null> {
  const issuer = ssoIssuer();
  const siteId = await resolveSiteId();
  if (!siteId) return null;
  if (!jwks || jwksIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
    jwksIssuer = issuer;
  }
  try {
    const { payload } = await jwtVerify<JWTPayload & SsoSession>(token, jwks, {
      issuer,
      audience: siteId,
      algorithms: ['ES256'],
    });
    if (payload.role !== 'admin' && payload.role !== 'editor') return null;
    return { email: String(payload.email ?? ''), role: payload.role };
  } catch {
    return null;
  }
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function s256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
