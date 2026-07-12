import { NextResponse } from 'next/server';
import { readSession } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { commitFile, ghHeaders } from '@/lib/github-commit';
import { resolveBranch } from '@/lib/github-branch';
import { gitConfig } from '@/lib/shared';

/**
 * Edit the landing hero copy (content/landing.json) from the page itself.
 * Saving is a commit to the repo's default branch — same philosophy as
 * Publish — so the change goes live with the next Workers Build (~2 min).
 */

const FIELDS = ['eyebrow', 'headline1', 'headline2', 'subhead'] as const;
type Landing = Record<(typeof FIELDS)[number], string>;
const MAX_LEN = 400;

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'No GitHub credential — connect GitHub in your docs.dev dashboard or set GITHUB_PAT.' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Partial<Landing> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });

  const landing = {} as Landing;
  for (const f of FIELDS) {
    const v = body[f];
    if (typeof v !== 'string' || !v.trim() || v.length > MAX_LEN) {
      return NextResponse.json(
        { ok: false, error: `Field "${f}" must be a non-empty string (max ${MAX_LEN} chars).` },
        { status: 400 },
      );
    }
    landing[f] = v.trim();
  }

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const branch = await resolveBranch(cred.token);

  const r = await commitFile(
    owner,
    repo,
    branch,
    'content/landing.json',
    Buffer.from(`${JSON.stringify(landing, null, 2)}\n`, 'utf8').toString('base64'),
    'docs: edit landing hero via editor',
    ghHeaders(cred.token),
  );
  if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  return NextResponse.json({ ok: true, commitUrl: r.commitUrl, branch });
}
