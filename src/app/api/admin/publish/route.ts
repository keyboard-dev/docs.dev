import { NextResponse } from 'next/server';
import { docRepoPath, readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { commitFile, ghHeaders, type GhHeaders } from '@/lib/github-commit';
import { checkDocSource } from '@/lib/mdx-check';
import { gitConfig } from '@/lib/shared';

/**
 * Commit a doc (and any uploaded assets) to GitHub using the server-held token.
 * The PAT lives only in the GITHUB_PAT env var — never sent to the browser.
 * Owner/repo/branch default to gitConfig and can be overridden with env vars.
 *
 * Assets are committed to `public/<path>` so the published site serves them at
 * `<path>` (e.g. /uploads/foo.png).
 */

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Signed-in GitHub users publish with their own token — the commit is
  // attributed to them in git history. PIN sessions use the server PAT.
  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential available (sign in with GitHub or configure GITHUB_PAT).' },
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

  // Pre-flight: reject content that would break the Workers Build before it
  // ever reaches the repo — a failed build strands the site on the old deploy.
  const check = await checkDocSource(content);
  if (!check.ok) {
    const where = check.line != null ? ` (line ${check.line}${check.column != null ? `:${check.column}` : ''})` : '';
    return NextResponse.json(
      { ok: false, error: `Won't publish — this would fail the site build${where}: ${check.error}` },
      { status: 422 },
    );
  }

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const branch = process.env.GITHUB_BRANCH ?? gitConfig.branch;
  const headers: GhHeaders = ghHeaders(cred.token);

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
      `docs: edit ${path} via docs.dev editor`,
      headers,
    );
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

    // The doc commit is made last, so its SHA is the branch head containing
    // everything this publish wrote — the anchor for deploy-status polling.
    const res = NextResponse.json({
      ok: true,
      commitUrl: r.commitUrl,
      commitSha: r.commitSha,
      repo: `${owner}/${repo}`,
      branch,
    });
    // A token refresh may have produced an updated session — persist it.
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
    return NextResponse.json(
      { ok: false, error: `Publish failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
