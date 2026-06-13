import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Spread } from '@/components/pretext/spread';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // docs.dev's magazine-flow component, available in every MDX file.
    Spread,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
