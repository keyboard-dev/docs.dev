import { NextResponse } from 'next/server';
import { readSession } from '@/lib/admin';
import { INVITE_PARAM, inviteAuthConfigured, mintInvite } from '@/lib/protect';

/**
 * Mint invitation links for protected pages (signed-in editors only).
 *
 *   POST { slug, days? } → { token, url, expiresAt }
 *
 * The token is a signed hash bound to the page — appended to the page URL as
 * ?invite=…, the shared link lets its holder read that one page without the
 * reading PIN. `days` bounds the invite's lifetime; omit it (or send null)
 * for a link that lasts until ADMIN_SECRET rotates. Stateless: nothing is
 * stored, so links can't be listed or revoked one by one — rotating
 * ADMIN_SECRET revokes them all.
 */

export async function POST(request: Request) {
  if (!(await readSession())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!inviteAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Invite links need the ADMIN_SECRET secret to be set.' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: unknown; days?: unknown };
  const slug = typeof body.slug === 'string' ? body.slug.replace(/^\/+|\/+$/g, '') : null;
  if (slug == null || !/^[a-z0-9/-]*$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'Bad slug.' }, { status: 400 });
  }
  const days = body.days == null ? null : Number(body.days);
  if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650)) {
    return NextResponse.json({ ok: false, error: 'Bad expiry.' }, { status: 400 });
  }

  const expiresAt = days === null ? 0 : Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const token = mintInvite(slug, expiresAt);
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    ok: true,
    token,
    url: `${origin}/docs${slug ? `/${slug}` : ''}?${INVITE_PARAM}=${token}`,
    expiresAt: expiresAt || null,
  });
}
