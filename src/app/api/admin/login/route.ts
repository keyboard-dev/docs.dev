import { NextResponse } from 'next/server';
import { checkPin, pinAuthConfigured, sessionToken, SESSION_COOKIE } from '@/lib/admin';
import { ssoEnabled } from '@/lib/docsdev-sso';

export async function POST(request: Request) {
  // With docs.dev sign-in configured, the PIN path is disabled — a leftover
  // PIN must not bypass team membership checks.
  if (ssoEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'This site uses docs.dev sign-in. Go to /api/admin/sso/start.' },
      { status: 403 },
    );
  }
  // No baked-in default — an unconfigured deployment can't be logged into.
  if (!pinAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Standalone login is not configured. Set ADMIN_PIN and ADMIN_SECRET, or use docs.dev sign-in.',
      },
      { status: 503 },
    );
  }

  const { pin } = (await request.json().catch(() => ({}))) as { pin?: string };
  if (typeof pin !== 'string' || !checkPin(pin)) {
    return NextResponse.json({ ok: false, error: 'Invalid PIN' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  });
  return res;
}
