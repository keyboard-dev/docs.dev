import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
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

export default defineConfig({
  mdxOptions: {
    // `package-install` code blocks become npm/pnpm/yarn/bun tabs, with the
    // chosen manager persisted across the site.
    remarkPlugins: [[remarkInstall, { persist: { id: 'package-manager' } }]],
  },
});
