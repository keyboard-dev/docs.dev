import { defineCollections, defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkInstall } from 'fumadocs-docgen';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// The landing page's content: one MDX file of landing section components,
// so the marketing page is editable (and agent-editable) like any doc —
// while rendering through the same bespoke React sections as before.
export const landing = defineCollections({
  type: 'doc',
  dir: 'content',
  files: ['landing.mdx'],
  schema: pageSchema,
});

export default defineConfig({
  mdxOptions: {
    // `package-install` code blocks become npm/pnpm/yarn/bun tabs, with the
    // chosen manager persisted across the site.
    remarkPlugins: [[remarkInstall, { persist: { id: 'package-manager' } }]],
  },
});
