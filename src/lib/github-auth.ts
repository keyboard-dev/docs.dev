/**
 * GitHub App OAuth (user flow) — identity, authorization, and attribution.
 *
 * The customer registers a GitHub App (Settings → Developer settings → GitHub
 * Apps) with the callback URL `<site>/api/auth/github/callback`, enables
 * "Request user authorization (OAuth) during installation", installs it on
 * the docs repo, and sets two secrets:
 *
 *   wrangler secret put GITHUB_APP_CLIENT_ID
 *   wrangler secret put GITHUB_APP_CLIENT_SECRET
 *
 * Sign-in yields a *user access token* scoped to the app's installed repos ∩
 * the user's own permissions. Authorization = push access on the docs repo
 * (read straight off the repo metadata the user token can see). Commits made
 * with that token are attributed to the actual editor in git history.
 *
 * GITHUB_OAUTH_MOCK=1 short-circuits the GitHub round-trip for local dev and
 * automated tests (never set it in production).
 */

import { gitConfig } from './shared';
import type { Session } from './admin';

export function githubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET) || githubOAuthMocked();
}

export function githubOAuthMocked(): boolean {
  return process.env.GITHUB_OAUTH_MOCK === '1';
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_APP_CLIENT_ID ?? '',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      ...body,
    }),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ code });
}

export async function refreshToken(refresh: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
}

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'docs.dev-admin',
};

export type GitHubIdentity = { login: string; name: string; avatar: string };

export async function fetchIdentity(token: string): Promise<GitHubIdentity | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = (await res.json()) as { login: string; name?: string; avatar_url?: string };
  return { login: u.login, name: u.name || u.login, avatar: u.avatar_url ?? '' };
}

/** Authorization: the signed-in user must have push access to the docs repo.
 *  The repo metadata visible through the user token carries their effective
 *  permissions — one call answers "can you see it" and "can you write it". */
export async function hasPushAccess(token: string): Promise<boolean> {
  const owner = process.env.GITHUB_OWNER ?? gitConfig.user;
  const repo = process.env.GITHUB_REPO ?? gitConfig.repo;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { permissions?: { push?: boolean; maintain?: boolean; admin?: boolean } };
  return Boolean(data.permissions?.push || data.permissions?.maintain || data.permissions?.admin);
}

/** A usable token for repo writes on behalf of the session, refreshing the
 *  GitHub user token when it's about to expire. Returns the token and, when a
 *  refresh happened, the updated session to re-seal into the cookie. */
/** The credential to use for repo writes: the signed-in user's token when
 *  available (commits attributed to the editor), else the server PAT. */
export async function repoCredential(session: Session | null): Promise<{ token: string; updated?: Session } | null> {
  if (session && !githubOAuthMocked()) {
    const user = await userTokenFor(session);
    if (user) return user;
  }
  const pat = process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN;
  return pat ? { token: pat } : null;
}

export async function userTokenFor(session: Session): Promise<{ token: string; updated?: Session } | null> {
  if (session.method !== 'github' || !session.ghToken) return null;
  const expiresSoon = session.ghTokenExp != null && session.ghTokenExp - Date.now() < 60_000;
  if (!expiresSoon) return { token: session.ghToken };
  if (!session.ghRefresh) return { token: session.ghToken };
  const next = await refreshToken(session.ghRefresh);
  if (!next.access_token) return { token: session.ghToken };
  const updated: Session = {
    ...session,
    ghToken: next.access_token,
    ghTokenExp: next.expires_in ? Date.now() + next.expires_in * 1000 : undefined,
    ghRefresh: next.refresh_token ?? session.ghRefresh,
  };
  return { token: next.access_token, updated };
}
