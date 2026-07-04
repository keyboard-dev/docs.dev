import { NextResponse } from 'next/server';
import { isAdmin, listDocs, docRepoPath, readSession } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { getDraftStore } from '@/lib/draft-store';
import { gitConfig } from '@/lib/shared';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, pages: await listDocs() });
}

/** Delete a published page: removes the MDX file from the repo (the page
 *  disappears from the site on the next build) and clears any shared draft. */
export async function DELETE(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (slug == null) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const path = docRepoPath(slug);
  if (!path) return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });

  // Draft-only pages just need their draft removed.
  await getDraftStore()
    .delete(slug)
    .catch(() => {});
  if (!(await listDocs()).includes(slug.replace(/^\/+|\/+$/g, '') || 'index')) {
    return NextResponse.json({ ok: true, draftOnly: true });
  }

  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential available — cannot delete published pages.' },
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
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!head.ok) {
    return NextResponse.json({ ok: false, error: `GitHub read failed (${head.status})` }, { status: 502 });
  }
  const sha = ((await head.json()) as { sha: string }).sha;
  const res = await fetch(base, {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message: `docs: delete ${path} via admin editor`, branch, sha }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json({ ok: false, error: `GitHub delete failed (${res.status}). ${detail.slice(0, 200)}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
