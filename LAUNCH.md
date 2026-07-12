# Launch a docs.dev site with an agent — no accounts required

This playbook lets a coding agent (Claude Code, Cursor, Codex, …) take a user
from *nothing* to a live, team-connected docs site: no Cloudflare account, no
docs.dev account, no dashboard visits. It combines two mechanisms:

- **[auth.md agent registration](https://workos.com/auth-md)** — the agent
  signs the user up for docs.dev and gets an API token; the user approves by
  typing a 6-digit code.
- **[Cloudflare temporary accounts](https://developers.cloudflare.com/workers/platform/claim-deployments/)**
  (`wrangler deploy --temporary`, Wrangler ≥ 4.102.0) — the agent deploys this
  template to a throwaway account; the user clicks a claim URL to keep it.

The user performs exactly two actions, both human-friendly: confirm a 6-digit
code, and click a claim link within 60 minutes.

> **Requires a Cloudflare Workers Paid account (2026-07):** this template's
> server Worker is ~5.3 MiB gzipped — over the free plan's **1 MiB** script
> limit (deploys are rejected with API error 10027) and comfortably within
> the paid plan's **10 MiB** ($5/month). Temporary accounts sit on the free
> plan, so the no-account `--temporary` path above cannot complete today;
> deploy to the user's paid account instead (see step 2). The docs.dev
> registration half (steps 1 and 3) works either way.

## The prompt (copy-paste for users)

> Set up a docs site for me using the docs.dev template. Follow
> https://github.com/keyboard-dev/docs.dev/blob/HEAD/LAUNCH.md with
> `DOCSDEV_ISSUER=https://app.docs.dev` and my email `<you@example.com>`.
> Show me the confirmation code right away, and when you're done give me the
> live URL and the Cloudflare claim link.

Agents: everything below is for you. `$ISSUER` is the docs.dev service origin
from the user's prompt (default `https://app.docs.dev`); `$EMAIL` is the
user's email.

## Agent playbook

### 0. Prerequisites

- Node 20+, pnpm, and network access to `$ISSUER`, GitHub, and Cloudflare.
- Wrangler **≥ 4.102.0** for `--temporary`. The repo pins a new-enough
  version. Note that `npx wrangler@latest` does NOT bypass an old pin:
  wrangler detects the OpenNext project and delegates to
  `opennextjs-cloudflare deploy`, which runs the **repo-local** wrangler.
- Read `$ISSUER/auth.md` first — it is the authoritative description of the
  registration flow and may be newer than this file.

### 1. Register with docs.dev (start this first)

```
POST $ISSUER/agent/identity
Content-Type: application/json

{"type": "service_auth", "login_hint": "$EMAIL"}
```

The response contains `claim_token`, and a `claim` block with `user_code`,
`verification_uri`, and `interval`.

**Immediately show the user** the 6-digit `user_code` and the
`verification_uri` link — they sign in with GitHub there and type the code.
It expires in 10 minutes, so surface it before you start building. docs.dev
never emails codes; only the code you display counts.

While the user confirms, continue with step 2. Poll for your token in the
background (respect `interval`, default 5s):

```
POST $ISSUER/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:workos:agent-auth:grant-type:claim&claim_token=<clm_…>
```

`authorization_pending` → keep polling. On success you receive an
`access_token` (`dat_…`, ~1h) and an `identity_assertion` (JWT, ~30 days).
Keep both: re-exchange the assertion at `/oauth2/token` with
`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` whenever the access
token expires.

### 2. Build and deploy to a temporary Cloudflare account

First remove the `"ai"` block from `wrangler.jsonc` — this is required, not
optional: the remote `ai` binding makes the deploy open an authenticated
remote-bindings session ("Could not start remote dev session"), which
defeats the unauthenticated `--temporary` flow before the upload even
starts. (Workers AI also isn't on the temporary-account supported list.)
The editor's "Generate with AI" features simply stay hidden until the
account is claimed and the binding restored.

```bash
git clone https://github.com/keyboard-dev/docs.dev site && cd site
pnpm install
pnpm cf:build
npx wrangler deploy --temporary
```

Capture from the output:

- the live URL, e.g. `https://docsdotdev-<something>.workers.dev`
- the **claim URL** — the user needs this to keep the deployment.

Notes:

- The temporary account lives 60 minutes from the last deploy (each redeploy
  resets the clock). Don't dawdle between steps — and if the user hasn't
  clicked the claim link as the window runs low, proactively redeploy
  (`--temporary` again) to reset it rather than letting the site vanish.
- **The `--temporary` deploy currently fails with API error 10027** (script
  size over the free-plan 1 MiB limit — see the note at the top). Until
  temporary accounts support larger Workers, deploy to the user's existing
  **Workers Paid** account instead: authenticate (`npx wrangler login`, or
  have the user provide a `CLOUDFLARE_API_TOKEN` env var), drop the
  `--temporary` flag from the deploy commands in steps 2 and 3, and skip the
  claim-link parts of step 4 — the deployment already belongs to the user.

### 3. Register the site and inject the Site ID

With your `dat_…` token and the deployed hostname `$HOST`:

```
POST $ISSUER/api/v1/sites
Authorization: Bearer dat_…
Content-Type: application/json

{"name": "<user's site name>", "redirect_uri": "https://$HOST/api/admin/sso/callback"}
```

Registration takes effect on its own: the deployed site resolves its Site ID
at runtime via `GET $ISSUER/api/v1/sites/lookup?host=$HOST` (cached ~15s
while unregistered), so within seconds the `/admin` editor signs in through
the user's docs.dev team — no redeploy, no env vars. (If you deployed with a
non-default `$ISSUER`, pass `--var DOCSDEV_ISSUER:$ISSUER` at deploy time in
step 2.)

### 4. Hand over

Give the user, in one message:

1. **Live site:** `https://$HOST` (editor at `https://$HOST/admin`).
2. **Cloudflare claim link** (from step 2): *"Click within 60 minutes to make
   the infrastructure permanently yours — sign up or sign in to Cloudflare
   when prompted."*
3. If they haven't confirmed the 6-digit code yet, remind them — without it
   you have no API token and step 3 can't complete.

### After claiming

Once the user claims the Cloudflare account, this becomes a normal deployment
they own. Sensible next steps to offer:

- Move the code into their GitHub and connect Workers Builds for
  push-to-deploy (the Deploy to Cloudflare button in the README does this for
  fresh setups). The publish target self-detects from the new repo's git
  remote on the next build — nothing to edit.
- Restore the `"ai"` binding in `wrangler.jsonc` if it was removed in step 2.
- Set editor secrets (`GITHUB_PAT`, or the GitHub App credentials) per the
  README if they want the publish-to-repo flow.
- Invite teammates from the docs.dev dashboard — members can sign in to
  `/admin` and publish.

## Failure modes

| Symptom | Cause / fix |
| --- | --- |
| `user_code` expired before confirmation | Re-register (step 1). Registrations are cheap; codes last 10 min. |
| `slow_down` from token polling | You're polling faster than `interval`. Back off. |
| `invalid_redirect_uri` registering the site | The redirect URI must be exactly `https://$HOST/api/admin/sso/callback` — https, no trailing slash, no fragment. |
| "Could not start remote dev session" / login prompt during deploy | The `ai` remote binding forces an authenticated proxy session. Remove the `"ai"` block from `wrangler.jsonc` before deploying (see step 2). |
| `Unknown argument: temporary` | The repo-local wrangler is < 4.102.0 (`npx wrangler@latest` doesn't help — the OpenNext delegation runs the local install). Update the `wrangler` devDependency. |
| Rejected with error 10027 (size limit) | The account is on the Workers free plan: 1 MiB compressed script limit vs this template's ~5.3 MiB. Deploy to a Workers Paid account (10 MiB) — temporary accounts are always free-plan, so this ends the `--temporary` path. See the note at the top. |
| Temp deployment vanished | The 60-minute window lapsed. Redeploy (`--temporary` again) and re-register the new hostname if it changed. |
| 401 from `/api/v1/sites` | Access token expired — jwt-bearer exchange the `identity_assertion` for a fresh one. |
