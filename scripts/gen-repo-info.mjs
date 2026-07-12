// Detects which GitHub repo this checkout belongs to and bakes it into the
// build (src/lib/repo-info.generated.json), so a Deploy-to-Cloudflare copy or
// a moved clone publishes to ITS OWN repo without anyone editing
// GITHUB_OWNER/GITHUB_REPO. Runs from next.config.mjs on every build; on a
// non-git checkout (tarball) the committed defaults survive untouched.
// Env vars GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH still override at
// runtime where they're read.
//
// Usage (standalone): node scripts/gen-repo-info.mjs

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function git(command, cwd) {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

export function generateRepoInfo(rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))) {
  const outFile = path.join(rootDir, 'src', 'lib', 'repo-info.generated.json');
  let info;
  try {
    const remote = git('git remote get-url origin', rootDir);
    // https://github.com/owner/repo(.git) | git@github.com:owner/repo.git | ssh://git@github.com/owner/repo
    const match = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
    if (!match) return;

    let branch = '';
    try {
      branch = git('git rev-parse --abbrev-ref HEAD', rootDir);
    } catch {
      /* fall through */
    }
    if (!branch || branch === 'HEAD') {
      // Detached HEAD (CI checkouts). Workers Builds exposes the branch name.
      branch = process.env.WORKERS_CI_BRANCH || 'main';
    }

    info = { owner: match[1], repo: match[2], branch };
  } catch {
    return; // not a git checkout — keep the committed defaults
  }

  const json = `${JSON.stringify(info, null, 2)}\n`;
  try {
    const existing = JSON.parse(readFileSync(outFile, 'utf8'));
    // Same repo, different branch = working on a feature branch of the repo
    // the file already records. Keep the committed value: rewriting would
    // dirty the tree on every local build, and the branch recorded here is
    // the publish default, not the checkout branch.
    if (existing.owner === info.owner && existing.repo === info.repo) return;
  } catch {
    /* missing or invalid file — write it */
  }
  writeFileSync(outFile, json);
  console.log(`repo-info: publishing to ${info.owner}/${info.repo}@${info.branch}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateRepoInfo();
}
