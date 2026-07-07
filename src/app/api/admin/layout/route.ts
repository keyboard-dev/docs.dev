import { NextResponse } from 'next/server';
import { readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { commitRepoFile } from '@/lib/github-commit';
import { sanitizeLandingCopy } from '@/lib/landing';

/**
 * Publish the landing ("layout") page copy edited on the page itself.
 *
 *   PUT { copy: LandingCopy } → { ok, commitUrl }
 *
 * Commits content/landing.json to the docs repo (same credential rules as
 * publishing a page). Push-to-deploy CI rebuilds the site with the new copy;
 * until then the editing admin sees their local live preview.
 */

const LANDING_PATH = 'content/landing.json';

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const { copy } = (await request.json().catch(() => ({}))) as { copy?: unknown };
  if (copy == null || typeof copy !== 'object') {
    return NextResponse.json({ ok: false, error: 'copy must be the landing page object' }, { status: 400 });
  }
  const clean = sanitizeLandingCopy(copy);

  const result = await commitRepoFile(session, {
    path: LANDING_PATH,
    content: JSON.stringify(clean, null, 2) + '\n',
    message: 'docs: update landing page copy via layout editor',
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
