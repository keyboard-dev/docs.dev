import { gitConfig } from './shared';

/**
 * The branch publishes land on.
 *
 * GITHUB_BRANCH wins when set. Otherwise we ask GitHub for the repo's REAL
 * default branch (cached per isolate) instead of trusting the build-time
 * guess in repo-info.generated.json — CI builds check out a detached HEAD,
 * so that file can record 'main' while the repo's default branch is
 * something else entirely, which made every publish 404 with
 * "Branch main not found". The build-time value survives only as the
 * offline fallback.
 */

let cached: { key: string; branch: string; expires: number } | null = null;
const TTL_MS = 5 * 60_000;

export async function resolveBranch(token: string): Promise<string> {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;

  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const key = `${owner}/${repo}`;
  if (cached && cached.key === key && cached.expires > Date.now()) return cached.branch;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'docs.dev-admin',
      },
    });
    if (res.ok) {
      const branch = ((await res.json()) as { default_branch?: string }).default_branch;
      if (branch) {
        cached = { key, branch, expires: Date.now() + TTL_MS };
        return branch;
      }
    }
  } catch {
    // GitHub unreachable — fall through to the build-time guess
  }
  return gitConfig.branch || 'main';
}
