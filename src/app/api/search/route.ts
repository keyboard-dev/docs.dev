import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';
import { isProtectedSlug } from '@/lib/protect';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';

type LazyData = {
  structuredData?: StructuredData;
  load?: () => Promise<{ structuredData: StructuredData }>;
};

export const { GET } = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
  // Reading-PIN-protected pages stay findable by title, but their content
  // never enters the public search index (see src/lib/protect.ts).
  async buildIndex(page) {
    const data = page.data as unknown as LazyData;
    const structuredData: StructuredData =
      isProtectedSlug(page.slugs)
        ? { headings: [], contents: [] }
        : (data.structuredData ?? (data.load ? (await data.load()).structuredData : { headings: [], contents: [] }));
    return {
      title: page.data.title ?? '',
      description: page.data.description,
      url: page.url,
      id: page.url,
      structuredData,
    };
  },
});
