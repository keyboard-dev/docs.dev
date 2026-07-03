import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin';
import { ssoEnabled } from '@/lib/docsdev-sso';

// Lightweight check the client uses to decide whether to show in-app editing,
// and whether sign-in goes through docs.dev or the standalone PIN.
// Keeping this client-driven means docs pages stay static (no cookie read at
// render time).
export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({
    admin: session !== null,
    sso: ssoEnabled(),
    email: session?.email ?? null,
    role: session?.role ?? null,
  });
}
