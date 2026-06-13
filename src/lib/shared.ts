export const appName = 'docs.dev';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

// Default GitHub target for the admin editor's "Publish" action. The branch is
// overridable in the admin UI (and persisted per-browser in IndexedDB).
export const gitConfig = {
  user: 'keyboard-dev',
  repo: 'docs.dev',
  branch: 'main',
};
