# docs.dev — agent guide

This repo is a docs.dev documentation site: a Fumadocs (Next.js + MDX) app with
the pretext reading experience, deployed to Cloudflare Workers. If you are an
agent asked to "update the docs", almost everything you need is in
`content/docs/` — you rarely need to touch application code.

## Where things live

- `content/docs/**/*.mdx` — the documentation pages. **This is what you edit.**
- `content/docs/meta.json` — sidebar/nav ordering (Fumadocs convention).
- `public/` — static assets; images referenced from MDX go here.
- `src/` — the site application (pretext flow engine, admin editor, routes).
  Only change this when explicitly asked to change site behavior or design.
- `wrangler.jsonc` — Cloudflare Workers config (deployed via OpenNext).

## Editing content

Every page is an `.mdx` file under `content/docs/`. The URL is the file path:
`content/docs/getting-started.mdx` → `/docs/getting-started`, and
`content/docs/index.mdx` → `/docs`.

Frontmatter (required):

```mdx
---
title: Page title
description: One-sentence summary shown in nav and search.
---
```

Body is GitHub-flavored Markdown plus MDX. Standard Fumadocs UI components
(Callout, Tabs, Steps, …) are available via the MDX component map in
`src/components/mdx.tsx` — check there before inventing a component.

Conventions:

- One H1 is generated from `title`; start body headings at `##`.
- Slugs are lowercase kebab-case (`[a-z0-9-]`, enforced by the publish path).
- Put images in `public/uploads/` and reference them as `/uploads/name.png`.
- After adding/removing/renaming a page, update `content/docs/meta.json`.

## Drafts: review-before-publish

Committing to the default branch publishes immediately. When the user wants
to review a page before it goes live ("draft this", "let me look first"),
do NOT commit to `content/docs/` — use the `/draft-page` skill instead. It
writes the page as `drafts/<slug>.json` on the `docsdev-drafts` branch (the
shared-drafts store behind the in-site editor), where a human can preview
the rendered page at `/docs/<slug>`, touch it up in place, and publish or
discard it from the editor.

## Commands

```bash
pnpm install          # once
pnpm dev              # local dev server at http://localhost:3000
pnpm types:check      # fumadocs-mdx + next typegen + tsc — run before pushing
pnpm lint             # eslint
pnpm cf:preview       # build and run the actual Worker locally
pnpm cf:deploy        # build + deploy to Cloudflare (usually unnecessary —
                      # pushing to the default branch triggers Workers Builds)
```

Deployment is push-to-deploy: commit to the default branch and Workers Builds
rebuilds and redeploys the site. Prefer that over running `cf:deploy` yourself.

## Verifying a change

1. `pnpm types:check` must pass (it also validates MDX frontmatter).
2. `pnpm dev`, then load the changed page under `/docs/...`.
3. If you changed nav structure, confirm the sidebar in the browser.

## API reference (OpenAPI)

The pages under `content/docs/api-reference/` are GENERATED from the specs
in `openapi/*.json` — at build time and by `pnpm generate:api`. To change
the API reference, edit (or add/remove) a spec in `openapi/` and regenerate;
never edit those pages directly, they are wiped on every build.

## Things not to do

- Don't edit `src/lib/content-manifest.generated.json` or
  `src/lib/openapi-specs.generated.json` — both are generated at build time.
- Don't edit `content/docs/api-reference/**` by hand — see "API reference"
  above.
- Don't rename `content/docs/` paths casually; URLs are derived from them.
- Don't commit secrets. `GITHUB_PAT` / `ADMIN_PIN` are Wrangler secrets, never
  files in the repo.
- Don't touch `src/components/pretext/` unless the task is explicitly about
  the reading-experience layout engine.
