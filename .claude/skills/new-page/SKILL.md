---
name: new-page
description: Add a new documentation page to this docs.dev site — creates the MDX file with valid frontmatter, registers it in the sidebar, and verifies the build. Use when asked to "add a page", "create a doc", or "document X".
---

# Add a new docs page

Arguments: a page title and (optionally) a target section. Example:
`/new-page Rate limits` or `/new-page "Webhooks" under api-reference`.

## Steps

1. Derive the slug: lowercase kebab-case of the title (`Rate limits` →
   `rate-limits`). Only `[a-z0-9-]` and `/` for nesting.
2. Create `content/docs/<slug>.mdx` (or `content/docs/<section>/<slug>.mdx`):

   ```mdx
   ---
   title: <Title>
   description: <One-sentence summary>
   ---

   ## Overview

   <Draft the content requested by the user. Start headings at ##.>
   ```

3. Register the page in `content/docs/meta.json` (or the section's
   `meta.json`) in a sensible position — read the existing file first and
   match its format.
4. Run `pnpm types:check`. Fix any frontmatter or MDX errors it reports.
5. Report the new page's URL path (`/docs/<slug>`) to the user.

## Notes

- If the user gave no content, write a useful skeleton, not lorem ipsum.
- Images go in `public/uploads/`, referenced as `/uploads/<file>`.
- Do not deploy; pushing to the default branch deploys automatically.
