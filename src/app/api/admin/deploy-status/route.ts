import { NextResponse } from 'next/server';
import { readSession, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/admin';
import { buildInfo, workerVersion } from '@/lib/deploy-info';
import { repoCredential } from '@/lib/github-auth';
import { gitConfig } from '@/lib/shared';

/**
 * Everything we can learn about a just-published commit, tokenlessly on the
 * Cloudflare side:
 *
 *   - Build: Workers Builds reports every build back to GitHub as a commit
 *     check, so the commit's check runs (plus legacy statuses) give us
 *     queued/running/success/failure — read with the same GitHub credential
 *     publishing already uses. No Cloudflare API token anywhere.
 *   - Deployment: which commit this Worker was built from (inlined at build
 *     time) and the live Worker version (version_metadata binding).
 *   - Liveness: the published commit is live once the serving build includes
 *     it. Equality isn't enough — someone else may publish right after, so
 *     the deploy lands on a descendant commit. GitHub's compare API answers
 *     ancestry: served "ahead of" or "identical to" the commit → live.
 *
 * The editor polls this after Publish to drive its deploy-status panel.
 */

type CheckItem = {
  name: string;
  /** queued | in_progress | completed (statuses map pending → in_progress) */
  status: string;
  /** success | failure | neutral | cancelled | skipped | timed_out | action_required | null */
  conclusion: string | null;
  url: string | null;
};

const FAILURE = new Set(['failure', 'error', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
const OK = new Set(['success', 'neutral', 'skipped']);

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docs.dev-admin',
  };
}

async function ghJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const res = await fetch(url, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export async function GET(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const sha = new URL(request.url).searchParams.get('sha') ?? '';
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return NextResponse.json({ ok: false, error: 'Bad or missing ?sha' }, { status: 400 });
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
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = ghHeaders(cred.token);

  const served = buildInfo();
  const servedIsPublished = served.commit !== '' && served.commit.startsWith(sha);

  const [checkRuns, combined, comparison, version] = await Promise.all([
    ghJson<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null; html_url?: string; details_url?: string }> }>(
      `${base}/commits/${sha}/check-runs?per_page=50`,
      headers,
    ),
    ghJson<{ statuses?: Array<{ context: string; state: string; target_url?: string }> }>(
      `${base}/commits/${sha}/status`,
      headers,
    ),
    // Ancestry: is the published commit contained in the serving build?
    served.commit && !servedIsPublished
      ? ghJson<{ status?: string }>(`${base}/compare/${sha}...${served.commit}`, headers)
      : Promise.resolve(null),
    workerVersion(),
  ]);

  const checks: CheckItem[] = [
    ...(checkRuns?.check_runs ?? []).map((r) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url ?? r.details_url ?? null,
    })),
    ...(combined?.statuses ?? []).map((s) => ({
      name: s.context,
      status: s.state === 'pending' ? 'in_progress' : 'completed',
      conclusion: s.state === 'pending' ? null : s.state,
      url: s.target_url ?? null,
    })),
  ];

  const buildState =
    checks.some((c) => c.conclusion != null && FAILURE.has(c.conclusion)) ? 'failure'
    : checks.some((c) => c.status !== 'completed') ? 'running'
    : checks.length > 0 && checks.every((c) => c.conclusion != null && OK.has(c.conclusion)) ? 'success'
    : 'none'; // nothing reported (yet) — Workers Builds usually appears within seconds

  const live: 'yes' | 'no' | 'unknown' =
    served.commit === ''
      ? 'unknown' // local/next-start build with no commit stamped
      : servedIsPublished || comparison?.status === 'identical' || comparison?.status === 'ahead'
        ? 'yes'
        : comparison?.status === 'behind'
          ? 'no'
          : comparison == null
            ? 'no' // compare call failed — be conservative, keep polling
            : 'unknown'; // diverged (force-push?) — can't tell from ancestry

  const res = NextResponse.json(
    {
      ok: true,
      commit: sha,
      repo: `${owner}/${repo}`,
      buildState,
      checks,
      live,
      served: {
        commit: served.commit || null,
        branch: served.branch || null,
        builtAt: served.builtAt || null,
        worker: version
          ? { versionId: version.id, versionTag: version.tag, deployedAt: version.timestamp }
          : null,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
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
}
