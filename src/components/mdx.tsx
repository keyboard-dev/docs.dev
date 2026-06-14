import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Spread } from '@/components/pretext/spread';
import { DraftImage } from '@/components/draft-image';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Resolve locally-uploaded draft assets; falls back to the real URL.
    img: DraftImage,
    // Tabs for tabbed content + package-install (npm/pnpm/yarn/bun) blocks.
    Tab,
    Tabs,
    // docs.dev's magazine-flow component, available in every MDX file.
    Spread,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
