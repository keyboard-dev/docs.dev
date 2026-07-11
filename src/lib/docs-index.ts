/**
 * Read-side index over the published docs, shared by the AI assistant
 * (retrieval) and the MCP server (search/read tools). Everything works from
 * the fumadocs source, so it runs on Cloudflare Workers with no filesystem.
 */

import { getLLMText, getPageMarkdownUrl, source } from '@/lib/source';

export type DocPageInfo = {
  title: string;
  description: string;
  /** Site-relative HTML URL, e.g. `/docs/getting-started`. */
  url: string;
  /** Site-relative raw-markdown URL, e.g. `/llms.mdx/docs/getting-started/content.md`. */
  markdownUrl: string;
};

export type DocSearchResult = DocPageInfo & {
  score: number;
  /** Body excerpt around the best-matching term. */
  snippet: string;
};

type Page = (typeof source)['$inferPage'];

function pageInfo(page: Page): DocPageInfo {
  return {
    title: page.data.title,
    description: page.data.description ?? '',
    url: page.url,
    markdownUrl: getPageMarkdownUrl(page).url,
  };
}

export function listDocPages(): DocPageInfo[] {
  return source.getPages().map(pageInfo);
}

/** Look a page up by its HTML url, markdown url, or bare slug path. */
export function findDocPage(path: string): Page | undefined {
  const clean = path.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.md$/, '');
  const segments = clean.split('/').filter(Boolean);
  // Accept `/docs/a/b`, `/llms.mdx/docs/a/b/content`, `docs/a/b`, or `a/b`.
  if (segments[0] === 'llms.mdx') segments.shift();
  if (segments[0] === 'docs') segments.shift();
  if (segments.at(-1) === 'content') segments.pop();
  return source.getPage(segments);
}

export async function getDocPageMarkdown(path: string): Promise<{ info: DocPageInfo; markdown: string } | undefined> {
  const page = findDocPage(path);
  if (!page) return undefined;
  return { info: pageInfo(page), markdown: await getLLMText(page) };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/**
 * Keyword search over title/description/body. Deliberately simple term
 * scoring — the corpus is a docs site (tens of pages), not a web index —
 * but good enough to ground the assistant and serve MCP `search_docs`.
 */
export async function searchDocPages(query: string, limit = 5): Promise<DocSearchResult[]> {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  const scored = await Promise.all(
    source.getPages().map(async (page) => {
      const info = pageInfo(page);
      const body = await getLLMText(page);
      const bodyLower = body.toLowerCase();
      const titleTokens = tokenize(info.title);
      const descTokens = tokenize(info.description);

      let score = 0;
      let firstHit = -1;
      for (const term of terms) {
        if (titleTokens.includes(term)) score += 8;
        if (descTokens.includes(term)) score += 4;
        let idx = bodyLower.indexOf(term);
        let count = 0;
        while (idx !== -1 && count < 20) {
          if (firstHit === -1) firstHit = idx;
          count++;
          idx = bodyLower.indexOf(term, idx + term.length);
        }
        score += Math.min(count, 10);
      }

      const start = Math.max(0, (firstHit === -1 ? 0 : firstHit) - 80);
      const snippet = body
        .slice(start, start + 240)
        .replace(/\s+/g, ' ')
        .trim();
      return { ...info, score, snippet };
    }),
  );

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
