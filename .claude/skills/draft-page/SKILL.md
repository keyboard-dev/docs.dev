---
name: draft-page
description: Write a documentation page as a shared draft for human review instead of publishing it — the draft appears in the site's editor where a teammate can preview the rendered page, touch it up, and click Publish. Use when asked to "draft a page", "write X but let me review it", or any request where the user wants approval before the page goes live.
---

# Draft a docs page for human review

Arguments: a page title/topic, like `/new-page`. Example:
`/draft-page Webhooks retry behavior`.

Unlike `/new-page`, this does NOT commit to `content/docs/` and nothing
deploys. The page is written to the shared-drafts store that the in-site
editor uses: every admin who opens the page on the live site sees the draft
overlaid, can preview exactly how it will render, edit it in place, and
publish (or discard) it from the editor.

## How drafts are stored

Drafts live on a dedicated `docsdev-drafts` branch of this repo (override
with `DRAFTS_BRANCH` if the site sets it), one JSON file per page, matching
`ServerDraft` in `src/lib/draft-store.ts`:

- Path: `drafts/<slug>.json` (`drafts/index.json` for the docs index page)
- Shape: `{ "slug": "<slug>", "content": "<full MDX file, frontmatter included>", "updatedAt": <ms epoch>, "author": "Claude Code" }`

`content` is the complete page source — the same text that would go in
`content/docs/<slug>.mdx`, `---` frontmatter and all.

## Steps

1. Derive the slug exactly as `/new-page` does: lowercase kebab-case,
   `[a-z0-9-]` plus `/` for nesting.
2. Write the full page MDX (frontmatter with `title` and `description`,
   body headings starting at `##`) to `content/docs/<slug>.mdx`
   **temporarily**, run `pnpm types:check` to validate it, then delete the
   file again — the working tree must be clean; the content ships only as a
   draft.
3. Save the validated MDX to a scratch file, then write the draft to the
   drafts branch. Two paths — prefer the API, fall back to git:

   **Fast path — GitHub API** (use when `gh auth status` succeeds, or a
   GitHub MCP file-write tool is available). One call writes the file; no
   clone, no worktree:

   ```bash
   # Build the draft JSON locally first:
   node -e '
     const fs = require("fs");
     const [, src, slug] = process.argv;  // with -e, args start at argv[1]
     fs.writeFileSync("/tmp/draft.json", JSON.stringify({
       slug, content: fs.readFileSync(src, "utf8"),
       updatedAt: Date.now(), author: "Claude Code",
     }));
   ' /tmp/<scratch>.mdx "<slug>"

   # The drafts branch may not exist yet — create it from the default
   # branch HEAD if needed (mirrors what the server does lazily):
   gh api repos/{owner}/{repo}/git/ref/heads/docsdev-drafts >/dev/null 2>&1 \
     || gh api repos/{owner}/{repo}/git/refs -f ref=refs/heads/docsdev-drafts \
          -f sha="$(gh api repos/{owner}/{repo}/git/ref/heads/main -q .object.sha)"

   # Upsert the file (sha is required only when the draft already exists):
   SHA=$(gh api "repos/{owner}/{repo}/contents/drafts/<slug>.json?ref=docsdev-drafts" -q .sha 2>/dev/null || true)
   gh api -X PUT "repos/{owner}/{repo}/contents/drafts/<slug>.json" \
     -f message="draft: <slug> by Claude Code" -f branch=docsdev-drafts \
     -f content="$(base64 -w0 /tmp/draft.json)" ${SHA:+-f sha=$SHA}
   ```

   With a GitHub MCP server instead of `gh`, use its create-or-update-file
   tool with the same path, branch, and JSON content.

   **Fallback — plain git** (works with nothing but the repo's own
   credentials; never switches the main checkout):

   ```bash
   git fetch origin docsdev-drafts 2>/dev/null \
     && git worktree add /tmp/docsdev-drafts docsdev-drafts \
     || git worktree add -b docsdev-drafts /tmp/docsdev-drafts \
          "$(git rev-parse --verify --quiet origin/main >/dev/null 2>&1 && echo origin/main || echo HEAD)"
   cd /tmp/docsdev-drafts
   mkdir -p "$(dirname "drafts/<slug>.json")" && cp /tmp/draft.json "drafts/<slug>.json"
   git add drafts && git commit -m "draft: <slug> by Claude Code"
   git push -u origin docsdev-drafts
   cd - && git worktree remove /tmp/docsdev-drafts
   ```

4. Tell the user: the draft is waiting at `/docs/<slug>` — anyone signed in
   to the editor sees it there (labelled "Claude Code"), can preview the
   rendered page, edit it, and hit **Publish** to promote it, or discard it.

## Notes

- **Never overwrite a human's work.** If `drafts/<slug>.json` already
  exists with an author other than "Claude Code", stop and ask the user
  before replacing it.
- Publishing from the editor commits only the page file. For a **new** page,
  remind the user that it still needs a `content/docs/meta.json` entry to
  appear in the sidebar — offer to add that once they've published.
- Drafts for nested slugs (`a/b`) work when visiting the page, but the
  editor's drafts list only shows top-level drafts; prefer flat slugs.
- Updating an earlier Claude draft is fine: write the same file again with a
  fresh `updatedAt`.
