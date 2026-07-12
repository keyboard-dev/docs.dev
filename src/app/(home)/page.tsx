import { Suspense } from 'react';
import type { Metadata } from 'next';
import { landing } from 'collections/server';
import { getMDXComponents } from '@/components/mdx';
import { InlineEditor } from '@/components/admin/inline-editor';
import { LANDING_SLUG } from '@/lib/admin';

/**
 * The landing page IS content: content/landing.mdx invokes the section
 * components in src/components/landing/sections.tsx, so the copy is
 * editable (by admins and agents alike) while the look and feel stays in
 * code. The editor binds to the reserved slug 'home' and publishes to
 * content/landing.mdx like any other page.
 */

const page = landing[0];

export const metadata: Metadata = {
  title: { absolute: page?.title ?? 'docs.dev' },
  description: page?.description,
};

export default function HomePage() {
  if (!page) return null;
  const MDX = page.body;
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28">
      {/* The editor takes over the nearest <article>; giving the landing one
          keeps that mechanism identical to docs pages. */}
      <article className="flex flex-col gap-4">
        <MDX components={getMDXComponents()} />
      </article>
      <Suspense>
        <InlineEditor slug={LANDING_SLUG} />
      </Suspense>
      <footer className="mt-20 text-center text-[13px] text-fd-muted-foreground">
        Built with ♥ by the{' '}
        <a href="https://keyboard.dev" className="underline hover:text-fd-foreground">
          keyboard.dev
        </a>{' '}
        team
      </footer>
    </main>
  );
}
