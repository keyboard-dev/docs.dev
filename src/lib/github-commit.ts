/**
 * Commit a single file to the docs repo via the GitHub contents API, on
 * behalf of an admin session. Shared by the site-configuration publish
 * routes (theme, landing layout) — the same credential rules as publishing
 * a page: GitHub sessions commit as the user, PIN/docs.dev sessions use the
 * server PAT.
 */

import type { Session } from './admin';
import { repoCredential } from './github-auth';
import { gitConfig } from './shared';

export type CommitFileResult =
  | { ok: true; commitUrl: string; updated?: Session }
  | { ok: false; status: number; error: string };

export async function commitRepoFile(
  session: Session,
  opts: { path: string; content: string; message: string },
): Promise<CommitFileResult> {
  const cred = await repoCredential(session);
  if (!cred) {
    return {
      ok: false,
      status: 500,
      error: 'No GitHub credential available (sign in with GitHub or configure GITHUB_PAT).',
    };
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
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${opts.path}`;

  try {
    let sha: string | undefined;
    const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
    if (head.ok) {
      sha = ((await head.json()) as { sha?: string }).sha;
    } else if (head.status !== 404) {
      const detail = await head.text().catch(() => '');
      return { ok: false, status: 502, error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}` };
    }
    const put = await fetch(base, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: opts.message,
        content: Buffer.from(opts.content, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      return { ok: false, status: 502, error: `GitHub commit failed (${put.status}). ${detail.slice(0, 200)}` };
    }
    const data = (await put.json()) as { commit?: { html_url?: string } };
    return { ok: true, commitUrl: data.commit?.html_url ?? '', updated: cred.updated };
  } catch (err) {
    return { ok: false, status: 500, error: `Commit failed: ${(err as Error).message}` };
  }
}
