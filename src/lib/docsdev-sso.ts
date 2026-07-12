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
// disconnect); negative ones — including "exists but not claimed yet" —
// expire fast so /connect or the claim ceremony flips the site to
// configured within seconds.
const siteIdCache = new Map<
  string,
  { siteId: string | null; awaitingClaim: boolean; expires: number }
>();
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 15_000;

// docs.dev-first onboarding: when the site was created in the docs.dev
// dashboard before this Worker existed, the user pasted a site token
// (dst_…) into the Deploy button's DOCSDEV_SITE_TOKEN field. This Worker
// is the only party that knows both the token and its real hostname, so it
// redeems the token on the first lookup miss — binding this host to the
// pending site.
//
// The token is durable, not single-use: it stays in the Worker (as a
// secret) as this deployment's identity. When the user later adds a custom
// domain in Cloudflare, traffic on the new hostname misses the lookup, the
// claim retries with the same token, and docs.dev records the host as a
// PENDING join request — sign-in on the new domain starts working the
// moment an org admin clicks Approve in the dashboard. Claim outcomes are
// cached per host so we don't hammer the endpoint on every negative-lookup
// expiry while an approval sits in someone's dashboard.
//
// This must only ever run from genuinely dynamic contexts (route handlers
// like /api/admin/session) — resolveSiteId reads request headers, and a
// statically prerendered page that touches a dynamic API at runtime is a
// hard Next error ("Page changed from static to dynamic"), which took the
// whole site down when this briefly lived in the root layout.
const claimCache = new Map<
  string,
  { siteId: string | null; pending: boolean; awaitingClaim: boolean; expires: number }
>();
const CLAIM_RETRY_MS = 60_000;

async function claimHostWithSiteToken(
  host: string,
): Promise<{ siteId: string | null; pending: boolean; awaitingClaim: boolean }> {
  const none = { siteId: null, pending: false, awaitingClaim: false };
  // Anything that isn't a dst_… token counts as unset — in particular the
  // "unset" placeholder scripts/cf-deploy.mjs seeds so that deploys succeed
  // before a real token exists.
  const token = process.env.DOCSDEV_SITE_TOKEN;
  if (!token?.startsWith('dst_')) return none;

  const cached = claimCache.get(host);
  if (cached && cached.expires > Date.now()) return cached;

  let outcome: { siteId: string | null; pending: boolean; awaitingClaim: boolean } = none;
  try {
    const res = await fetch(new URL('/api/v1/sites/claim-host', ssoIssuer()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setup_token: token, host }),
    });
    if (res.ok) {
      const body = (await res.json()) as { site_id?: string; status?: string; claimed?: boolean };
      if (body.status === 'pending_approval') {
        outcome = { siteId: null, pending: true, awaitingClaim: false }; // approval flips the lookup, not this call
      } else if (body.site_id && body.claimed === false) {
        // Agent-provisioned site: bound, but its user hasn't confirmed the
        // claim code — sign-in stays off until the lookup reports claimed.
        outcome = { siteId: null, pending: false, awaitingClaim: true };
      } else {
        outcome = { siteId: body.site_id ?? null, pending: false, awaitingClaim: false };
      }
    }
    // Non-ok (rotated token, host taken, …) caches as a plain miss — the
    // lookup stays the source of truth either way.
    claimCache.set(host, { ...outcome, expires: Date.now() + CLAIM_RETRY_MS });
  } catch {
    // issuer unreachable — no cache entry, retry on the next lookup miss
  }
  return outcome;
}

export interface SiteAccess {
  siteId: string | null;
  /** This hostname was proposed to docs.dev and awaits an admin's approval. */
  pendingApproval: boolean;
  /**
   * The site exists but was set up by an agent and its user hasn't
   * confirmed the claim code yet — sign-in is disabled until they do.
   */
  awaitingClaim: boolean;
}

/**
 * The site id this deployment should authenticate as (DOCSDEV_SITE_ID if
 * set, else the runtime hostname lookup), plus whether this hostname is
 * sitting in the docs.dev dashboard as a pending join request. A null
 * siteId with pendingApproval false means SSO is not configured
 * (standalone PIN / GitHub auth applies).
 */
export async function resolveSiteAccess(): Promise<SiteAccess> {
  if (process.env.DOCSDEV_SITE_ID) {
    return { siteId: process.env.DOCSDEV_SITE_ID, pendingApproval: false, awaitingClaim: false };
  }

  const host = await requestHost();
  if (!host) return { siteId: null, pendingApproval: false, awaitingClaim: false };

  let cached = siteIdCache.get(host);
  if (cached && cached.expires <= Date.now()) cached = undefined;
  if (cached?.siteId) {
    return { siteId: cached.siteId, pendingApproval: false, awaitingClaim: false };
  }
  if (cached?.awaitingClaim) {
    return { siteId: null, pendingApproval: false, awaitingClaim: true };
  }

  let siteId: string | null = null;
  let awaitingClaim = false;
  if (!cached) {
    try {
      const res = await fetch(new URL(`/api/v1/sites/lookup?host=${host}`, ssoIssuer()));
      if (res.ok) {
        const body = (await res.json()) as { site_id?: string; claimed?: boolean };
        // claimed:false = agent-provisioned site whose user hasn't confirmed
        // the claim code yet. Sign-in must stay off (authorize refuses it),
        // so we surface the waiting state instead of a site id, and expire
        // it fast so confirming the code flips this within seconds.
        if (body.site_id && body.claimed === false) {
          awaitingClaim = true;
        } else {
          siteId = body.site_id ?? null;
        }
      }
    } catch {
      siteId = null; // issuer unreachable — treat as unconfigured, retry soon
    }
    siteIdCache.set(host, {
      siteId,
      awaitingClaim,
      expires: Date.now() + (siteId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    if (awaitingClaim) return { siteId: null, pendingApproval: false, awaitingClaim: true };
  }
  if (siteId) return { siteId, pendingApproval: false, awaitingClaim: false };

  const claimed = await claimHostWithSiteToken(host);
  if (claimed.siteId) {
    siteIdCache.set(host, {
      siteId: claimed.siteId,
      awaitingClaim: false,
      expires: Date.now() + POSITIVE_TTL_MS,
    });
  }
  return { siteId: claimed.siteId, pendingApproval: claimed.pending, awaitingClaim: claimed.awaitingClaim };
}

export async function resolveSiteId(): Promise<string | null> {
  return (await resolveSiteAccess()).siteId;
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
