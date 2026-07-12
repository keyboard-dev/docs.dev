import { NextResponse } from 'next/server';
import { openBox, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S, type Session } from '@/lib/admin';
import { exchangeCode, fetchIdentity, hasPushAccess } from '@/lib/github-auth';
import { ssoActive } from '@/lib/docsdev-sso';

type OAuthState = { n: string; returnTo: string; exp: number };

/**
 * Completes the GitHub sign-in: verifies state, exchanges the code for a user
 * access token, resolves the identity, and — the authorization step — checks
 * the user has push access to the docs repo through their own token. Only
 * then is the session sealed into the cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (reason: string) => NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(reason)}`, url.origin));

  // Same rule as the login route: docs.dev SSO configured → SSO only.
  if (await ssoActive()) {
    return NextResponse.redirect(new URL('/admin', url.origin));
  }

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (!code || !stateRaw) return fail('missing-code');
  const state = openBox<OAuthState>(stateRaw);
  if (!state || state.exp < Date.now()) return fail('bad-state');

  const token = await exchangeCode(code);
  if (!token.access_token) return fail(token.error_description ?? 'token-exchange-failed');

  const identity = await fetchIdentity(token.access_token);
  if (!identity) return fail('identity-failed');

  if (!(await hasPushAccess(token.access_token))) {
    return fail('no-repo-access');
  }

  const session: Session = {
    method: 'github',
    login: identity.login,
    name: identity.name,
    avatar: identity.avatar,
    ghToken: token.access_token,
    ghTokenExp: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    ghRefresh: token.refresh_token,
    exp: Date.now() + SESSION_MAX_AGE_S * 1000,
  };

  const returnTo = state.returnTo.startsWith('/') && !state.returnTo.startsWith('//') ? state.returnTo : '/docs';
  const res = NextResponse.redirect(new URL(returnTo, url.origin));
  res.cookies.set(SESSION_COOKIE, sealSession(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
