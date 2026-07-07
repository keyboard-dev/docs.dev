import { getLLMText, getPageMarkdownUrl, source } from '@/lib/source';
import { isProtectedSlug } from '@/lib/protect';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/llms.mdx/docs/[[...slug]]'>) {
  const { slug } = await params;
  const page = source.getPage(slug?.slice(0, -1));
  if (!page) notFound();
  // Reading-PIN-protected pages have no public markdown mirror at all — the
  // decision is build-time data, so this stays a static 404 with nothing to
  // coax the content out of.
  if (isProtectedSlug(page.slugs)) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return source
    .getPages()
    .filter((page) => !isProtectedSlug(page.slugs))
    .map((page) => ({
      lang: page.locale,
      slug: getPageMarkdownUrl(page).segments,
    }));
}
