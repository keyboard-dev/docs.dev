import { NextResponse } from 'next/server';
import { pinAuthConfigured, readSession } from '@/lib/admin';
import { githubOAuthConfigured } from '@/lib/github-auth';
import { requestHost, ssoActive, ssoIssuer } from '@/lib/docsdev-sso';

// Lightweight check the client uses to decide whether to show in-app editing,
// which sign-in methods are available (for the /admin sign-in UI), and the
// editor's identity (for draft attribution). Keeping this client-driven means
// docs pages stay static (no cookie read at render time).
export async function GET() {
  const sso = await ssoActive();
  const session = await readSession();

  // Nothing configured at all → offer the docs.dev connect ceremony: the
  // owner proves Worker ownership via Cloudflare OAuth over there, and this
  // site picks the registration up through the runtime lookup.
  let connect: string | null = null;
  if (!sso && !githubOAuthConfigured() && !pinAuthConfigured()) {
    const host = await requestHost();
    if (host) connect = `${ssoIssuer()}/connect?host=${encodeURIComponent(host)}`;
  }

  return NextResponse.json({
    admin: session != null,
    user: session
      ? {
          method: session.method,
          login: session.login,
          name: session.name,
          avatar: session.avatar ?? '',
          role: session.role ?? 'admin',
        }
      : null,
    // Sign-in method availability. With SSO configured it is the only method.
    sso,
    githubOAuth: !sso && githubOAuthConfigured(),
    pinConfigured: sso || pinAuthConfigured(),
    connect,
  });
}
