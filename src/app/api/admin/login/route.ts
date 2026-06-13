import { NextResponse } from 'next/server';
import { checkPin, sessionToken, SESSION_COOKIE } from '@/lib/admin';

export async function POST(request: Request) {
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
