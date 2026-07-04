import { NextResponse } from 'next/server';
import { pinAuthConfigured, readSession } from '@/lib/admin';
import { githubOAuthConfigured } from '@/lib/github-auth';
import { ssoEnabled } from '@/lib/docsdev-sso';

// Lightweight check the client uses to decide whether to show in-app editing,
// which sign-in methods are available (for the /admin sign-in UI), and the
// editor's identity (for draft attribution). Keeping this client-driven means
// docs pages stay static (no cookie read at render time).
export async function GET() {
  const sso = ssoEnabled();
  const session = await readSession();
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
  });
}
