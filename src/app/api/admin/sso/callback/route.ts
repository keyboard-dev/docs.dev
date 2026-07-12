import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  resolveSiteId,
  ssoIssuer,
  verifySsoToken,
  SSO_JWT_COOKIE,
  SSO_STATE_COOKIE,
  SSO_VERIFIER_COOKIE,
} from '@/lib/docsdev-sso';

// Completes the docs.dev sign-in: validate state, exchange the code (PKCE)
// for a session JWT, verify it against the docs.dev JWKS, and store it as the
// admin session cookie.
export async function GET(request: Request) {
  const siteId = await resolveSiteId();
  if (!siteId) {
    return NextResponse.json({ ok: false, error: 'docs.dev sign-in is not configured.' }, { status: 404 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const store = await cookies();
  const expectedState = store.get(SSO_STATE_COOKIE)?.value;
  const verifier = store.get(SSO_VERIFIER_COOKIE)?.value;

  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return NextResponse.json(
      { ok: false, error: 'Sign-in state mismatch — start again from /admin.' },
      { status: 400 },
    );
  }

  const tokenRes = await fetch(new URL('/api/v1/oauth/token', ssoIssuer()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: new URL('/api/admin/sso/callback', request.url).toString(),
      client_id: siteId,
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    return NextResponse.json(
      { ok: false, error: `Token exchange failed (${tokenRes.status}). ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const { access_token: accessToken, expires_in: expiresIn } = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Belt and braces: verify the token we were just handed before trusting it.
  const session = await verifySsoToken(accessToken);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Received an invalid session token.' }, { status: 502 });
  }

  const res = NextResponse.redirect(new URL('/admin', request.url), 302);
  res.cookies.set(SSO_JWT_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: expiresIn ?? 60 * 60 * 8,
  });
  res.cookies.set(SSO_STATE_COOKIE, '', { path: '/api/admin/sso', maxAge: 0 });
  res.cookies.set(SSO_VERIFIER_COOKIE, '', { path: '/api/admin/sso', maxAge: 0 });
  return res;
}
