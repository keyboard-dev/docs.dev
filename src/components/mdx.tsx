import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Spread } from '@/components/pretext/spread';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
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
