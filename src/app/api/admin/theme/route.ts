import { NextResponse } from 'next/server';
import { readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { gitConfig } from '@/lib/shared';

/**
 * Publish the site theme picked in the admin sidebar.
 *
 *   PUT { accent: "#rrggbb" } → { ok, commitUrl }
 *
 * Commits src/app/theme.css to the docs repo (same credential rules as
 * publishing a page: GitHub sessions commit as the user, PIN/docs.dev
 * sessions use the server PAT). Push-to-deploy CI rebuilds the site with the
 * new accent; until then admins see their local live preview.
 */

const THEME_PATH = 'src/app/theme.css';

function themeCss(accent: string): string {
  return `/*
 * Site theme — the single place your brand color lives.
 *
 * Edit by hand, or use the admin sidebar's "Theme…" picker: it previews the
 * change live and commits this file via /api/admin/theme when you publish.
 */
:root {
  --docsdev-accent: ${accent};
}
`;
}

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const { accent } = (await request.json().catch(() => ({}))) as { accent?: string };
  if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return NextResponse.json({ ok: false, error: 'accent must be a #rrggbb color' }, { status: 400 });
  }

  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential available (sign in with GitHub or configure GITHUB_PAT).' },
      { status: 500 },
    );
  }

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const branch = process.env.GITHUB_BRANCH ?? gitConfig.branch;
  const headers = {
    Authorization: `Bearer ${cred.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docs.dev-admin',
  };
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${THEME_PATH}`;

  try {
    let sha: string | undefined;
    const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
    if (head.ok) {
      sha = ((await head.json()) as { sha?: string }).sha;
    } else if (head.status !== 404) {
      const detail = await head.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }
    const put = await fetch(base, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `docs: set site accent to ${accent.toLowerCase()} via theme picker`,
        content: Buffer.from(themeCss(accent.toLowerCase()), 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `GitHub commit failed (${put.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }
    const data = (await put.json()) as { commit?: { html_url?: string } };
    const res = NextResponse.json({ ok: true, commitUrl: data.commit?.html_url ?? '' });
    if (cred.updated) {
      res.cookies.set(SESSION_COOKIE, sealSession(cred.updated), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_MAX_AGE_S,
      });
    }
    return res;
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Theme publish failed: ${(err as Error).message}` }, { status: 500 });
  }
}
