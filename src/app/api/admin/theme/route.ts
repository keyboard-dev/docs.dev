import { NextResponse } from 'next/server';
import { readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { commitRepoFile } from '@/lib/github-commit';
import { isHeadingStyle, themeCss, type HeadingStyle } from '@/lib/theme-presets';

/**
 * Publish the site theme picked in the admin sidebar.
 *
 *   PUT { accent: "#rrggbb", headingStyle?: "classic" | "tinted" | … }
 *     → { ok, commitUrl }
 *
 * Commits src/app/theme.css to the docs repo (same credential rules as
 * publishing a page: GitHub sessions commit as the user, PIN/docs.dev
 * sessions use the server PAT). Push-to-deploy CI rebuilds the site with the
 * new theme; until then admins see their local live preview.
 */

const THEME_PATH = 'src/app/theme.css';

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const { accent, headingStyle } = (await request.json().catch(() => ({}))) as {
    accent?: string;
    headingStyle?: string;
  };
  if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return NextResponse.json({ ok: false, error: 'accent must be a #rrggbb color' }, { status: 400 });
  }
  const style: HeadingStyle = headingStyle === undefined ? 'classic' : isHeadingStyle(headingStyle) ? headingStyle : 'classic';
  if (headingStyle !== undefined && !isHeadingStyle(headingStyle)) {
    return NextResponse.json({ ok: false, error: 'unknown heading style' }, { status: 400 });
  }

  const result = await commitRepoFile(session, {
    path: THEME_PATH,
    content: themeCss(accent.toLowerCase(), style),
    message: `docs: set site theme via theme picker (accent ${accent.toLowerCase()}, headings ${style})`,
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
