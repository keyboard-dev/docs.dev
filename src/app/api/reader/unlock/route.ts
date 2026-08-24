import { NextResponse } from 'next/server';
import {
  checkInvite,
  checkReaderPin,
  inviteCookieMaxAge,
  inviteCookieName,
  READER_COOKIE,
  READER_MAX_AGE_S,
  readerAuthConfigured,
  readerToken,
} from '@/lib/protect';

/**
 * Unlock reading-PIN-protected pages.
 *
 *   POST { pin }           → { ok } + a long-lived site-wide reader cookie
 *   POST { invite, slug }  → { ok } + a per-page cookie holding the invite
 *
 * The PIN is the site-wide READER_PIN secret — share it with the readers you
 * trust; it grants reading only, never editing. An invite is a signed link
 * token minted by an editor for a single page; redeeming it here keeps that
 * page unlocked across refreshes and in-site navigation without the URL
 * parameter. Fails closed (503) when the PIN path is used but READER_PIN /
 * ADMIN_SECRET aren't configured.
 */

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pin?: string; invite?: string; slug?: string };

  // Invite-link redemption.
  if (typeof body.invite === 'string') {
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (!checkInvite(body.invite, slug)) {
      return NextResponse.json({ ok: false, error: 'This invite link is invalid or has expired.' }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(inviteCookieName(slug), body.invite, { ...COOKIE_OPTS, maxAge: inviteCookieMaxAge(body.invite) });
    return res;
  }

  // Site-wide reading PIN.
  if (!readerAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Reading PIN is not configured — set the READER_PIN and ADMIN_SECRET secrets.' },
      { status: 503 },
    );
  }
  if (typeof body.pin !== 'string' || !checkReaderPin(body.pin)) {
    return NextResponse.json({ ok: false, error: 'Invalid PIN.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(READER_COOKIE, readerToken(), { ...COOKIE_OPTS, maxAge: READER_MAX_AGE_S });
  return res;
}
