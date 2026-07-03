import { getPageImage, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { gitConfig } from '@/lib/shared';
import { DraftShellNotice } from '@/components/admin/draft-shell-notice';
import { openapi } from '@/lib/openapi';
import { OpenAPIPage } from '@/components/openapi-page';
import type { OpenAPIPageProps_Preloaded } from 'fumadocs-openapi/ui';
import type { TableOfContents } from 'fumadocs-core/toc';

type OpenAPIMeta = { preload?: string[]; toc?: TableOfContents };

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    // Unknown slug: for admins this is a *draft page* — a page that exists as
    // a shared draft but hasn't been published/built yet. This branch renders
    // statically (no server cookies here), so the admin gate is client-side:
    // the in-place editor takes over for admins; everyone else sees a
    // noindexed not-found notice.
    return (
      <DocsPage toc={[]}>
        <DocsTitle>Untitled page</DocsTitle>
        <DocsDescription className="mb-0">
          This page hasn&apos;t been published yet.
        </DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b pb-6" />
        <DocsBody>
          <DraftShellNotice />
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  // Generated API reference pages carry their schema id + TOC in frontmatter;
  // preload the bundled schema server-side so the page renders statically.
  const apiMeta = page.data._openapi as OpenAPIMeta | undefined;
  const apiProps = apiMeta?.preload ? await openapi.preloadOpenAPIPage(page) : undefined;

  return (
    <DocsPage toc={apiMeta?.toc ?? page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody data-api-page={apiProps ? '' : undefined}>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
            ...(apiProps
              ? {
                  OpenAPIPage: (props: Omit<OpenAPIPageProps_Preloaded, 'preloaded'>) => (
                    <OpenAPIPage {...props} {...apiProps} />
                  ),
                }
              : {}),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  // Unknown slugs render the admin draft shell (or 404 in the page itself).
  if (!page) return { title: 'Draft page', robots: { index: false } };

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
