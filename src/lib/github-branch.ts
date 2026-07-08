/**
 * Which branch do publishes target?
 *
 * GITHUB_BRANCH, when set, wins. When it's unset or empty, the repo's actual
 * default branch is used — resolved once per isolate via the GitHub API. This
 * matches how deployment works (Workers Builds redeploys on pushes to the
 * default branch) and survives the default branch being renamed, instead of
 * 404ing against a hardcoded name that doesn't exist in the repo.
 */

import { gitConfig } from './shared';

const cache = new Map<string, string>();

export async function resolveBranch(owner: string, repo: string, token: string): Promise<string> {
  const configured = process.env.GITHUB_BRANCH;
  if (configured) return configured;
  const key = `${owner}/${repo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'docs.dev-admin',
    },
  }).catch(() => null);
  const branch = res?.ok
    ? ((await res.json().catch(() => ({}))) as { default_branch?: string }).default_branch
    : undefined;
  const resolved = branch ?? gitConfig.branch;
  if (branch) cache.set(key, resolved);
  return resolved;
}
