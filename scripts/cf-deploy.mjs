// Deploy wrapper that keeps `secrets.required: ["DOCSDEV_SITE_TOKEN"]`
// (wrangler.jsonc) from bricking token-less deploys.
//
// wrangler hard-fails any deploy while a required secret is unset — including
// the very first deploy of a user who skipped the token to connect their site
// later from /admin. So before deploying we check whether the Worker already
// has the secret; when it doesn't, we supply one through wrangler's
// `--secrets-file` mechanism (the only way to set a secret on a Worker that
// doesn't exist yet):
//
//   - a real token when the environment provides one (the Deploy to
//     Cloudflare button / Workers Builds can expose DOCSDEV_SITE_TOKEN as a
//     build variable), or
//   - the placeholder "unset" otherwise — the app ignores any value that
//     doesn't look like a dst_… token, so this is equivalent to no token.
//
// When the secret already exists we deploy WITHOUT a secrets file, so a real
// token is never overwritten by the placeholder. Set or rotate the real
// value any time with: npx wrangler secret put DOCSDEV_SITE_TOKEN
//
// Usage: node scripts/cf-deploy.mjs  (expects `opennextjs-cloudflare build`
// to have run first; extra args are forwarded to the deploy)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SECRET_NAME = 'DOCSDEV_SITE_TOKEN';
const PLACEHOLDER = 'unset';

function run(args, opts = {}) {
  return spawnSync('pnpm', ['exec', ...args], {
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function secretAlreadySet() {
  // Errors (worker doesn't exist yet, offline `wrangler login` state, …)
  // count as "not set" — worst case we harmlessly (re)supply a value on a
  // Worker that has none.
  const res = run(['wrangler', 'secret', 'list', '--format', 'json'], { capture: true });
  if (res.status !== 0) return false;
  try {
    return JSON.parse(res.stdout).some((s) => s.name === SECRET_NAME);
  } catch {
    return false;
  }
}

const deployArgs = ['opennextjs-cloudflare', 'deploy', ...process.argv.slice(2)];

if (!secretAlreadySet()) {
  const value = process.env[SECRET_NAME] || PLACEHOLDER;
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'docsdev-')), 'secrets.env');
  writeFileSync(file, `${SECRET_NAME}=${value}\n`, { mode: 0o600 });
  deployArgs.push('--secrets-file', file);
  console.log(
    value === PLACEHOLDER
      ? `[cf-deploy] ${SECRET_NAME} not set on this Worker — deploying with a placeholder so the deploy can proceed. Paste your site token later with: npx wrangler secret put ${SECRET_NAME}`
      : `[cf-deploy] Supplying ${SECRET_NAME} from the build environment.`,
  );
}

process.exit(run(deployArgs).status ?? 1);
