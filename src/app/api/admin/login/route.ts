import { NextResponse } from 'next/server';
import { checkPin, pinAuthConfigured, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { ssoActive } from '@/lib/docsdev-sso';

export async function POST(request: Request) {
  // With docs.dev sign-in configured, the PIN path is disabled — a leftover
  // PIN must not bypass team membership checks.
  if (await ssoActive()) {
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
  res.cookies.set(
    SESSION_COOKIE,
    sealSession({ method: 'pin', login: 'admin', name: 'Admin', exp: Date.now() + SESSION_MAX_AGE_S * 1000 }),
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_S,
    },
  );
  return res;
}
