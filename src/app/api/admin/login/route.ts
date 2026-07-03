import { NextResponse } from 'next/server';
import { checkPin, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';

export async function POST(request: Request) {
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
