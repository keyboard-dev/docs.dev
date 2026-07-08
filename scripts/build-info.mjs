// Resolves the commit/branch this build is made from, at build time.
//
// Workers Builds exposes the trigger commit as WORKERS_CI_COMMIT_SHA (and the
// branch as WORKERS_CI_BRANCH); other CIs have their own names; local builds
// fall back to git. The values are inlined into the bundle via `env` in
// next.config.mjs so the deployed Worker can report which commit it serves
// (see src/lib/deploy-info.ts and /api/version) without any runtime fs or git.
import { execSync } from 'node:child_process';

function git(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

export function getBuildInfo() {
  const commit =
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    git('git rev-parse HEAD');
  const branch =
    process.env.WORKERS_CI_BRANCH ||
    process.env.CF_PAGES_BRANCH ||
    process.env.GITHUB_REF_NAME ||
    git('git rev-parse --abbrev-ref HEAD');
  return {
    commit: commit ?? '',
    branch: branch ?? '',
    builtAt: new Date().toISOString(),
  };
}
