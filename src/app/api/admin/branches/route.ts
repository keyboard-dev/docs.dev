import { NextResponse } from 'next/server';
import { readSession } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import {
  branchContentMocked,
  branchDocContent,
  changedDocPages,
  listReviewableBranches,
} from '@/lib/branches';

/**
 * Review docs content living on other branches (read-only).
 *
 *   GET                       → { branches: [{ name }] }
 *   GET ?branch=x             → { pages: [{ slug, path, status }] }   (vs default branch)
 *   GET ?branch=x&slug=y      → { content }                            (raw MDX on that branch)
 *
 * The client loads `content` into the shared-draft store, where the normal
 * preview/edit/publish flow takes over.
 */

const BRANCH_RE = /^[\w./-]{1,200}$/;

export async function GET(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const cred = branchContentMocked() ? { token: 'mock' } : await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential — set GITHUB_PAT or sign in with GitHub.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');
  const slug = url.searchParams.get('slug');

  try {
    if (branch == null) {
      return NextResponse.json({ ok: true, branches: await listReviewableBranches(cred.token) });
    }
    if (!BRANCH_RE.test(branch)) {
      return NextResponse.json({ ok: false, error: 'Invalid branch name.' }, { status: 400 });
    }
    if (slug == null) {
      return NextResponse.json({ ok: true, pages: await changedDocPages(cred.token, branch) });
    }
    const content = await branchDocContent(cred.token, branch, slug === 'index' ? '' : slug);
    if (content == null) {
      return NextResponse.json({ ok: false, error: 'Page not found on that branch.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, content });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
