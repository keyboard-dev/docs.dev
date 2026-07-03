import { NextResponse } from 'next/server';
import { readSession } from '@/lib/admin';
import { githubOAuthConfigured } from '@/lib/github-auth';

// Lightweight check the client uses to decide whether to show in-app editing.
// Keeping this client-driven means docs pages stay static (no cookie read at
// render time). Also carries the editor's identity (for draft attribution)
// and whether GitHub sign-in is available (for the /admin sign-in UI).
export async function GET() {
  const session = await readSession();
  return NextResponse.json({
    admin: session != null,
    user: session ? { method: session.method, login: session.login, name: session.name, avatar: session.avatar ?? '' } : null,
    githubOAuth: githubOAuthConfigured(),
  });
}
