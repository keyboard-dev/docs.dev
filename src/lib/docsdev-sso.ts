/**
 * "Sign in with docs.dev" client.
 *
 * When DOCSDEV_SITE_ID is set, the /admin editor authenticates against the
 * docs.dev service instead of the local PIN: we redirect to the central
 * /authorize endpoint (PKCE — no secret on this worker), docs.dev checks the
 * user is a member of the org that owns this site and that our callback URL
 * exactly matches the org's registered redirect URI, and hands back a
 * short-lived ES256 JWT we verify against the docs.dev JWKS.
 *
 * Config (wrangler.jsonc vars):
 *   DOCSDEV_SITE_ID — the site id from the docs.dev dashboard ("" = disabled,
 *                     PIN auth is used instead)
 *   DOCSDEV_ISSUER  — the docs.dev service origin (default https://app.docs.dev)
 */

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

export function ssoSiteId(): string | null {
  return process.env.DOCSDEV_SITE_ID || null;
}

export function ssoEnabled(): boolean {
  return ssoSiteId() !== null;
}

// Module-scoped so the JWKS fetch is cached per worker isolate.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer: string | null = null;

export async function verifySsoToken(token: string): Promise<SsoSession | null> {
  const issuer = ssoIssuer();
  const siteId = ssoSiteId();
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
