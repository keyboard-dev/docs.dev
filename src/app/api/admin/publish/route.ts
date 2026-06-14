import { NextResponse } from 'next/server';
import { isAdmin, docRepoPath } from '@/lib/admin';
import { gitConfig } from '@/lib/shared';

/**
 * Commit a doc (and any uploaded assets) to GitHub using the server-held token.
 * The PAT lives only in the GITHUB_PAT env var — never sent to the browser.
 * Owner/repo/branch default to gitConfig and can be overridden with env vars.
 *
 * Assets are committed to `public/<path>` so the published site serves them at
 * `<path>` (e.g. /uploads/foo.png). PoC note: this makes one commit per file;
 * a production build would batch them via the Git Trees API.
 */

type GhHeaders = Record<string, string>;

async function commitFile(
  owner: string,
  repo: string,
  branch: string,
  repoPath: string,
  base64Content: string,
  message: string,
  headers: GhHeaders,
): Promise<{ commitUrl: string } | { error: string; status: number }> {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  let sha: string | undefined;
  const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (head.ok) {
    sha = ((await head.json()) as { sha?: string }).sha;
  } else if (head.status !== 404) {
    const detail = await head.text().catch(() => '');
    return { error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const res = await fetch(base, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub commit failed (${res.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const data = (await res.json()) as { commit?: { html_url?: string } };
  return { commitUrl: data.commit?.html_url ?? '' };
}

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

  const { slug, content, assets } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    content?: string;
    assets?: Array<{ path: string; base64: string }>;
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
  const headers: GhHeaders = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docs.dev-admin',
  };

  try {
    // Commit assets first (served from public/), so the published doc resolves
    // them. Only allow /uploads/* paths.
    for (const asset of assets ?? []) {
      if (!/^\/uploads\/[a-zA-Z0-9._/-]+$/.test(asset.path)) {
        return NextResponse.json({ ok: false, error: `Invalid asset path: ${asset.path}` }, { status: 400 });
      }
      const r = await commitFile(
        owner,
        repo,
        branch,
        `public${asset.path}`,
        asset.base64,
        `docs: upload ${asset.path} via admin editor`,
        headers,
      );
      if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    }

    const r = await commitFile(
      owner,
      repo,
      branch,
      path,
      Buffer.from(content, 'utf8').toString('base64'),
      `docs: edit ${path} via admin editor`,
      headers,
    );
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

    return NextResponse.json({ ok: true, commitUrl: r.commitUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Publish failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
