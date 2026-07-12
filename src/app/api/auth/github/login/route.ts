import { NextResponse } from 'next/server';
import { sealBox, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S, type Session } from '@/lib/admin';
import { authorizeUrl, githubOAuthConfigured, githubOAuthMocked } from '@/lib/github-auth';
import { ssoActive } from '@/lib/docsdev-sso';

/**
 * Starts the GitHub sign-in. `?return=/docs/...` is where to land afterwards
 * (same-origin paths only). State is a sealed box so the callback can verify
 * it wasn't forged.
 *
 * Mock mode (GITHUB_OAUTH_MOCK=1, dev/tests only): skips GitHub entirely and
 * signs in as `?as=<login>` so the full session/attribution flow is testable
 * without app credentials.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = url.searchParams.get('return') ?? '/docs';
  const returnTo = back.startsWith('/') && !back.startsWith('//') ? back : '/docs';

  // With docs.dev sign-in configured it is the only method — GitHub App
  // OAuth must not bypass team membership.
  if (await ssoActive()) {
    return NextResponse.redirect(new URL('/admin', url.origin));
  }

  if (!githubOAuthConfigured()) {
    return NextResponse.redirect(new URL('/admin?error=github-not-configured', url.origin));
  }

  if (githubOAuthMocked()) {
    const login = (url.searchParams.get('as') ?? 'octocat').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 39) || 'octocat';
    const session: Session = {
      method: 'github',
      login,
      name: url.searchParams.get('name') ?? login,
      avatar: `https://github.com/${login}.png`,
      ghToken: `mock-token-${login}`,
      exp: Date.now() + SESSION_MAX_AGE_S * 1000,
    };
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

  const state = sealBox({ n: crypto.randomUUID(), returnTo, exp: Date.now() + 10 * 60_000 });
  return NextResponse.redirect(authorizeUrl(state));
}
