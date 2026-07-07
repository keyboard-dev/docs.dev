import { NextResponse } from 'next/server';
import { readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { commitRepoFile } from '@/lib/github-commit';
import { sanitizeLandingCopy } from '@/lib/landing';

/**
 * Publish the landing ("layout") page edited on the page itself.
 *
 *   PUT { copy: LandingCopy, assets?: [{ path, base64 }] } → { ok, commitUrl }
 *
 * Commits content/landing.json — plus any figure images uploaded in the
 * editor, which land in public/uploads/ exactly like docs-page uploads — to
 * the docs repo (same credential rules as publishing a page). Push-to-deploy
 * CI rebuilds the site with the new copy; until then the editing admin sees
 * their local live preview.
 */

const LANDING_PATH = 'content/landing.json';

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const { copy, assets } = (await request.json().catch(() => ({}))) as {
    copy?: unknown;
    assets?: Array<{ path?: string; base64?: string }>;
  };
  if (copy == null || typeof copy !== 'object') {
    return NextResponse.json({ ok: false, error: 'copy must be the landing page object' }, { status: 400 });
  }
  const clean = sanitizeLandingCopy(copy);

  // Figure images first (served from public/), so the rebuilt page resolves
  // them. Same path rules as the docs publish route.
  for (const asset of assets ?? []) {
    if (typeof asset.path !== 'string' || !/^\/uploads\/[a-zA-Z0-9._/-]+$/.test(asset.path) || typeof asset.base64 !== 'string') {
      return NextResponse.json({ ok: false, error: `Invalid asset: ${String(asset.path)}` }, { status: 400 });
    }
    const r = await commitRepoFile(session, {
      path: `public${asset.path}`,
      contentBase64: asset.base64,
      message: `docs: upload ${asset.path} via layout editor`,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  }

  const result = await commitRepoFile(session, {
    path: LANDING_PATH,
    content: JSON.stringify(clean, null, 2) + '\n',
    message: 'docs: update landing page via layout editor',
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true, commitUrl: result.commitUrl });
  if (result.updated) {
    res.cookies.set(SESSION_COOKIE, sealSession(result.updated), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_S,
    });
  }
  return res;
}
