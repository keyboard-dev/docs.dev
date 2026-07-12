import { NextResponse } from 'next/server';
import { docRepoPath, readSession } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { commitFile, ghHeaders } from '@/lib/github-commit';
import { resolveBranch } from '@/lib/github-branch';
import { checkDocSource } from '@/lib/mdx-check';
import { gitConfig } from '@/lib/shared';
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

/**
 * Promote a draft to a real git branch — the deliberate "share this WIP"
 * step. Creates `docs/<slug>-<id>` from the default branch HEAD, commits the
 * draft content there, and hands back a compare URL so opening a PR is one
 * click. The local/shared draft stays untouched; the branch is a snapshot.
 */
export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential — connect GitHub in your docs.dev dashboard or set GITHUB_PAT.' },
      { status: 503 },
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
  if (!path) return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });

  // A branch that cannot build would fail its eventual merge — same
  // pre-flight as publish.
  const check = await checkDocSource(content);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: `This draft would fail the site build: ${check.error}` },
      { status: 422 },
    );
  }

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const headers = ghHeaders(cred.token);
  const gh = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const base = await resolveBranch(cred.token);
    const baseRef = await fetch(`${gh}/git/ref/heads/${encodeURIComponent(base)}`, { headers });
    if (!baseRef.ok) {
      return NextResponse.json({ ok: false, error: `Cannot read base branch (${baseRef.status}).` }, { status: 502 });
    }
    const sha = ((await baseRef.json()) as { object: { sha: string } }).object.sha;

    const id = Math.random().toString(36).slice(2, 8);
    const branch = `docs/${(slug === '' ? 'index' : slug).replaceAll('/', '-')}-${id}`;
    const created = await fetch(`${gh}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    if (!created.ok) {
      return NextResponse.json({ ok: false, error: `Cannot create branch (${created.status}).` }, { status: 502 });
    }

    const r = await commitFile(
      owner,
      repo,
      branch,
      path,
      Buffer.from(content, 'utf8').toString('base64'),
      `docs: draft ${path} for review`,
      headers,
    );
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

    return NextResponse.json({
      ok: true,
      branch,
      compareUrl: `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
