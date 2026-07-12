import { NextResponse } from 'next/server';
import {
  randomToken,
  resolveSiteId,
  s256,
  ssoIssuer,
  SSO_STATE_COOKIE,
  SSO_VERIFIER_COOKIE,
} from '@/lib/docsdev-sso';

// Kicks off the docs.dev sign-in: stash state + PKCE verifier in short-lived
// cookies, then redirect to the central /authorize endpoint.
export async function GET(request: Request) {
  const siteId = await resolveSiteId();
  if (!siteId) {
    return NextResponse.json({ ok: false, error: 'docs.dev sign-in is not configured.' }, { status: 404 });
  }

  const state = randomToken();
  const verifier = randomToken();
  const callback = new URL('/api/admin/sso/callback', request.url).toString();

  const authorize = new URL('/authorize', ssoIssuer());
  authorize.searchParams.set('site_id', siteId);
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await s256(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(authorize.toString(), 302);
  const cookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/api/admin/sso',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
  };
  res.cookies.set(SSO_STATE_COOKIE, state, cookie);
  res.cookies.set(SSO_VERIFIER_COOKIE, verifier, cookie);
  return res;
}
