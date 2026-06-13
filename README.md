# docs.dev

**Documentation that reads like a designed page, not a stack of blocks.**

docs.dev is a documentation framework built on [Fumadocs](https://fumadocs.dev)
(Next.js + MDX) with one thing no other docs tool has: a reading experience
powered by [pretext](https://github.com/chenglou/pretext), chenglou's
text-measurement engine. You write ordinary Markdown; we render it as a page
where prose flows around images, code samples, callouts, and shapes — like a
magazine spread instead of the same vertical stack of blocks every other docs
site ships.

## Why this exists

The docs-hosting market (Mintlify, GitBook, ReadMe) competes on features and
all looks the same. We're not trying to win on feature parity. We're betting on
two things competitors can't copy:

1. **A genuinely different reading experience** — see `/showcase`.
2. **The domain.** Sites are hosted at `your-name.docs.dev`.

## The pretext architecture (and why it's honest about SEO)

pretext does **not** render or paint text — it only *measures and positions*.
It computes line breaks with pure canvas arithmetic, never touching
`getBoundingClientRect` or triggering a reflow. We use that to lay prose out
around obstacles. The text you see is always real, selectable, indexable DOM.

The flow engine (`src/components/pretext/flow.tsx`) is **progressive
enhancement**, not cloaking:

- The **server renders the real prose** as a normal `<p>` (`data-flow-source`).
  Crawlers, screen readers, and no-JS visitors get clean, readable text in
  correct reading order. (Confirmed present in the prerendered static HTML.)
- After hydration, the **client re-lays-out the same text** into positioned
  line spans flowing around obstacles, then hides the source node.

Same text, just repositioned. No hidden duplicate copy.

```
Markdown / MDX  →  Fumadocs core (content, search, nav, raw .md routes)
                →  pretext layout engine (measures + positions each line)
                →  DOM render (real <span> text + image/code/shape obstacles)
```

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

- `/showcase` — the pretext reading experience (prose flowing around an orb
  and a code block).
- `/docs` — the standard Fumadocs docs site (search, nav, MDX).

## Deploy

### Cloudflare Workers (primary)

Runs on Workers via [OpenNext](https://opennext.js.org/cloudflare). No
filesystem is used at runtime — baseline content comes from a build-time
manifest (`scripts/gen-content-manifest.mjs`) and edits persist via the GitHub
API — and `node:crypto`/`Buffer` work under the `nodejs_compat` flag set in
`wrangler.jsonc`.

```bash
pnpm cf:preview     # build + run the worker locally (workerd)
pnpm cf:deploy      # build + wrangler deploy
```

Set runtime secrets (not committed):

```bash
wrangler secret put GITHUB_PAT      # token with contents:write — required to publish
wrangler secret put ADMIN_PIN       # optional, defaults to 1234
```

`GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` are non-secret `vars` in
`wrangler.jsonc`. The public docs need no env vars; the variables only power
the `/admin` editor's publish flow.

> **Note:** Fumadocs' `proxy.ts` (Next 16 middleware for `.md` content
> negotiation) is parked as `_proxy.ts.disabled` because OpenNext doesn't yet
> bundle Next 16's `proxy` convention. The `/llms.*` routes still serve
> markdown; restore `proxy.ts` once the adapter supports it.

### Netlify (alternative)

`netlify.toml` is included (Node 22 + Next plugin). Set the same env vars in
**Site settings → Environment variables**. The content manifest means the
`included_files` workaround is no longer required.

## Status

Early. The Fumadocs content/search/nav layer is the proven 90%; the pretext
flow engine is the differentiating 10% and is currently a working
proof-of-concept (single-sided obstacle wrap). Next steps: feed the flow engine
directly from MDX (preserving inline marks via pretext's `rich-inline` API),
two-sided obstacle flow, and the `*.docs.dev` multi-tenant hosting layer.
