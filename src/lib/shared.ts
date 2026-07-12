export const appName = 'docs.dev';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

import repoInfo from './repo-info.generated.json';

// Default GitHub target for the admin editor's "Publish" action — detected
// from this checkout's git remote at build time (scripts/gen-repo-info.mjs),
// so Deploy-to-Cloudflare copies publish to their own repo automatically.
// GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH env vars override where read;
// the branch is also overridable in the admin UI (persisted per-browser).
export const gitConfig = {
  user: repoInfo.owner,
  repo: repoInfo.repo,
  branch: repoInfo.branch,
};
