import { NextResponse } from 'next/server';
import { checkReaderPin, READER_COOKIE, READER_MAX_AGE_S, readerAuthConfigured, readerToken } from '@/lib/protect';

/**
 * Unlock reading-PIN-protected pages.
 *
 *   POST { pin } → { ok } + a long-lived reader cookie
 *
 * The PIN is the site-wide READER_PIN secret — share it with the readers you
 * trust; it grants reading only, never editing. Fails closed (503) when
 * READER_PIN / ADMIN_SECRET aren't configured.
 */

export async function POST(request: Request) {
  if (!readerAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Reading PIN is not configured — set the READER_PIN and ADMIN_SECRET secrets.' },
      { status: 503 },
    );
  }

  const { pin } = (await request.json().catch(() => ({}))) as { pin?: string };
  if (typeof pin !== 'string' || !checkReaderPin(pin)) {
    return NextResponse.json({ ok: false, error: 'Invalid PIN.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(READER_COOKIE, readerToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: READER_MAX_AGE_S,
  });
  return res;
}
