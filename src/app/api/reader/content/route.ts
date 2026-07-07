import { NextResponse } from 'next/server';
import { hasReaderAccess, isProtectedSlug } from '@/lib/protect';
import { getDocSource } from '@/lib/content';

/**
 * The single server-side gate for protected page content.
 *
 *   GET ?slug=<page> → { content } when the request carries a valid reader
 *   cookie or a signed-in team session; 401 otherwise.
 *
 * Only serves pages marked `protected: true` — everything else already has a
 * public markdown mirror and doesn't need (or get) this door.
 */

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!isProtectedSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'Not a protected page.' }, { status: 404 });
  }
  if (!(await hasReaderAccess())) {
    return NextResponse.json({ ok: false, error: 'Locked.' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, content: getDocSource(slug) });
}
