import { NextResponse } from 'next/server';
import { isAdmin, docRepoPath } from '@/lib/admin';
import { gitConfig } from '@/lib/shared';

/**
 * Commit a doc to GitHub using the server-held token. The PAT lives only in
 * the GITHUB_PAT env var — it is never sent to the browser. Owner/repo/branch
 * default to gitConfig and can be overridden with env vars.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const pat = process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN;
  if (!pat) {
    return NextResponse.json(
      { ok: false, error: 'Server has no GITHUB_PAT configured.' },
      { status: 500 },
    );
  }

  const { slug, content } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    content?: string;
  };
  if (typeof slug !== 'string' || typeof content !== 'string') {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  const path = docRepoPath(slug);
  if (!path) {
    return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });
  }

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const branch = process.env.GITHUB_BRANCH ?? gitConfig.branch;
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docs.dev-admin',
  };

  try {
    // The Contents API needs the current blob SHA to update an existing file.
    let sha: string | undefined;
    const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
    if (head.ok) {
      sha = ((await head.json()) as { sha?: string }).sha;
    } else if (head.status !== 404) {
      const detail = await head.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const res = await fetch(base, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `docs: edit ${path} via admin editor`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `GitHub commit failed (${res.status}). ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { commit?: { html_url?: string } };
    return NextResponse.json({ ok: true, commitUrl: data.commit?.html_url ?? '' });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Publish failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
