/**
 * Read docs content from non-default branches, so agent-authored branches
 * (Claude Code writing pages on a feature branch) can be pulled into the
 * editor as drafts: preview the rendered page, touch it up, publish to the
 * default branch from the editor.
 *
 * Read-only — loading a branch page never writes to git; it only seeds the
 * shared-draft store. All calls go through the GitHub API with whatever
 * credential the session has (the signed-in editor's token, else the server
 * PAT), same as the publish path.
 *
 * GITHUB_CONTENT_MOCK=1 (dev/tests only) serves a deterministic branch with
 * one changed page, so the whole loop is testable without GitHub.
 */

import { gitConfig } from './shared';

export type BranchInfo = { name: string };
export type BranchPage = { slug: string; path: string; status: 'added' | 'modified' };

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'docs.dev-admin',
};

function repoTarget() {
  return {
    owner: process.env.GITHUB_OWNER ?? gitConfig.user,
    repo: process.env.GITHUB_REPO ?? gitConfig.repo,
    base: process.env.GITHUB_BRANCH ?? gitConfig.branch,
  };
}

function api(path: string): string {
  const { owner, repo } = repoTarget();
  return `https://api.github.com/repos/${owner}/${repo}${path}`;
}

export function branchContentMocked(): boolean {
  return process.env.GITHUB_CONTENT_MOCK === '1';
}

const MOCK_BRANCH = 'claude/webhooks-page';
const MOCK_PAGE_MDX = `---
title: Webhooks
description: MOCK branch content — receive events from the platform.
---

## Receiving events

MOCK-BRANCH-CONTENT: this page was written on a branch and loaded into the
editor for review.
`;

/** Branch names that make sense to review — everything except the deploy
 *  branch and the drafts store itself. */
export async function listReviewableBranches(token: string): Promise<BranchInfo[]> {
  if (branchContentMocked()) return [{ name: MOCK_BRANCH }];
  const { base } = repoTarget();
  const res = await fetch(api('/branches?per_page=100'), { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Cannot list branches (${res.status})`);
  const branches = (await res.json()) as Array<{ name: string }>;
  const drafts = process.env.DRAFTS_BRANCH ?? 'docsdev-drafts';
  return branches.filter((b) => b.name !== base && b.name !== drafts).map((b) => ({ name: b.name }));
}

/** Docs pages added or modified on `branch` relative to the default branch. */
export async function changedDocPages(token: string, branch: string): Promise<BranchPage[]> {
  if (branchContentMocked()) {
    return branch === MOCK_BRANCH ? [{ slug: 'webhooks', path: 'content/docs/webhooks.mdx', status: 'added' }] : [];
  }
  const { base } = repoTarget();
  const res = await fetch(
    api(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`),
    { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Cannot compare branches (${res.status})`);
  const data = (await res.json()) as { files?: Array<{ filename: string; status: string }> };
  const pages: BranchPage[] = [];
  for (const f of data.files ?? []) {
    const m = f.filename.match(/^content\/docs\/(.+)\.mdx$/);
    if (!m || (f.status !== 'added' && f.status !== 'modified')) continue;
    pages.push({ slug: m[1] === 'index' ? 'index' : m[1]!, path: f.filename, status: f.status });
  }
  return pages;
}

/** Raw MDX of one docs page as it exists on `branch`. */
export async function branchDocContent(token: string, branch: string, slug: string): Promise<string | null> {
  if (branchContentMocked()) {
    return branch === MOCK_BRANCH && slug === 'webhooks' ? MOCK_PAGE_MDX : null;
  }
  const clean = slug.replace(/^\/+|\/+$/g, '');
  if (clean.length > 0 && !/^[a-z0-9][a-z0-9/-]*$/i.test(clean)) return null;
  const path = `content/docs/${clean === '' || clean === 'index' ? 'index' : clean}.mdx`;
  const res = await fetch(api(`/contents/${path}?ref=${encodeURIComponent(branch)}`), {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cannot read ${path} on ${branch} (${res.status})`);
  const data = (await res.json()) as { content?: string };
  if (!data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}
