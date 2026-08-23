import { NextResponse } from 'next/server';
import { checkInvite, hasReaderAccess, INVITE_PARAM, isProtectedSlug } from '@/lib/protect';
import { getDocSource } from '@/lib/content';

/**
 * The single server-side gate for protected page content.
 *
 *   GET ?slug=<page> → { content } when the request carries a valid reader
 *   cookie, a valid ?invite= token for this page, or a signed-in team
 *   session; 401 otherwise.
 *
 * The invite token is accepted directly (not just via its cookie) so the
 * very first load straight from a shared link works before any cookie is
 * set — and keeps working for readers whose browsers block cookies.
 *
 * Only serves pages marked `protected: true` — everything else already has a
 * public markdown mirror and doesn't need (or get) this door.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isProtectedSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'Not a protected page.' }, { status: 404 });
  }
  const invite = url.searchParams.get(INVITE_PARAM);
  if (!checkInvite(invite, slug) && !(await hasReaderAccess(slug))) {
    return NextResponse.json({ ok: false, error: 'Locked.' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, content: getDocSource(slug) });
}
