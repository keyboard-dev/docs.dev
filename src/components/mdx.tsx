import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Callout } from 'fumadocs-ui/components/callout';
import { Spread } from '@/components/pretext/spread';
import { DraftImage } from '@/components/draft-image';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Resolve locally-uploaded draft assets; falls back to the real URL.
    // Cast: MDXComponents types img src as string, but fumadocs-mdx actually
    // passes a static-import object for Markdown images — DraftImage handles
    // both shapes.
    img: DraftImage as NonNullable<MDXComponents['img']>,
    // Tabs for tabbed content + package-install (npm/pnpm/yarn/bun) blocks.
    Tab,
    Tabs,
    Callout,
    // docs.dev's magazine-flow component, available in every MDX file.
    Spread,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
