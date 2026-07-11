/**
 * AI generation for the editor, built for the Cloudflare deployment.
 *
 * Text: Workers AI (the `AI` binding in wrangler.jsonc) writes documentation
 * as clean markdown, optionally grounded by web search results. Search is
 * pluggable via env: TAVILY_API_KEY or BRAVE_API_KEY (skipped when neither is
 * set).
 *
 * Images: Workers AI text-to-image (FLUX.1 schnell) returns a data URL the
 * editor stores as a draft asset — the same pipeline uploaded images use, so
 * publishing commits them to the repo.
 *
 * AI_MOCK=1 (dev/tests only) swaps in deterministic providers so the whole
 * flow — prompt → generation → blocks in the draft — is testable without
 * Cloudflare bindings.
 */

export const TEXT_MODEL = process.env.AI_TEXT_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL ?? '@cf/black-forest-labs/flux-1-schnell';

export type SearchResult = { title: string; url: string; snippet: string };

export type WorkersAI = {
  run(
    model: string,
    input: Record<string, unknown>,
  ): Promise<{ response?: string; image?: string } | ReadableStream>;
};

export function aiMocked(): boolean {
  return process.env.AI_MOCK === '1';
}

export async function workersAI(): Promise<WorkersAI | null> {
  if (aiMocked()) return null;
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    const ai = (ctx.env as Record<string, unknown>).AI as WorkersAI | undefined;
    return ai ?? null;
  } catch {
    return null; // not running on Cloudflare (plain `next start`)
  }
}

export async function aiAvailable(): Promise<boolean> {
  return aiMocked() || (await workersAI()) != null;
}

/* ------------------------------------------------------------------ */
/* web search (pluggable, optional)                                    */
/* ------------------------------------------------------------------ */

export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (aiMocked()) {
    return [
      { title: `Mock result about ${query}`, url: 'https://example.com/a', snippet: `Key facts about ${query} from the web.` },
      { title: `${query} — reference`, url: 'https://example.com/b', snippet: `More background on ${query}.` },
    ];
  }
  try {
    if (process.env.TAVILY_API_KEY) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
        body: JSON.stringify({ query, max_results: 5 }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
      return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 400) }));
    }
    if (process.env.BRAVE_API_KEY) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description.slice(0, 400) }));
    }
  } catch {
    // search is best-effort grounding; generation proceeds without it
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* documentation writing                                               */
/* ------------------------------------------------------------------ */

const WRITER_SYSTEM = `You write documentation for a developer docs site. Output ONLY markdown body content — no frontmatter, no surrounding commentary, no code fences around the whole answer.
Allowed constructs: ## / ### headings, paragraphs, **bold**, *italic*, \`inline code\`, [links](https://…), bullet and numbered lists, > quotes, fenced code blocks with a language tag, and GFM tables.
Be accurate and concise. Prefer concrete examples over fluff. When sources are provided, ground claims in them and cite with inline links.`;

export async function generateDoc(opts: {
  prompt: string;
  pageTitle?: string;
  pageContext?: string;
  useSearch?: boolean;
}): Promise<{ markdown: string; sources: SearchResult[] }> {
  const sources = opts.useSearch ? await searchWeb(opts.prompt) : [];

  if (aiMocked()) {
    const heading = opts.prompt.replace(/[\n#]/g, ' ').trim().slice(0, 60);
    const cite = sources.length
      ? `\n\nGrounded in: ${sources.map((s) => `[${s.title}](${s.url})`).join(', ')}.`
      : '';
    return {
      markdown: `## ${heading}\n\nMOCK-AI generated documentation about ${heading}${opts.pageTitle ? ` for the page "${opts.pageTitle}"` : ''}.${cite}\n\n- First key point about ${heading}\n- Second key point with \`inline code\`\n\n\`\`\`ts\nconst example = 'generated';\n\`\`\`\n`,
      sources,
    };
  }

  const ai = await workersAI();
  if (!ai) throw new Error('Workers AI is not available (deploy to Cloudflare with the AI binding, or set AI_MOCK=1 in dev).');

  const contextParts: string[] = [];
  if (opts.pageTitle) contextParts.push(`Page title: ${opts.pageTitle}`);
  if (opts.pageContext) contextParts.push(`Existing page content (for tone and to avoid repetition):\n${opts.pageContext.slice(0, 4000)}`);
  if (sources.length) {
    contextParts.push(
      `Web search results to ground the writing:\n${sources.map((s, i) => `${i + 1}. ${s.title} (${s.url})\n${s.snippet}`).join('\n\n')}`,
    );
  }

  const result = await ai.run(TEXT_MODEL, {
    messages: [
      { role: 'system', content: WRITER_SYSTEM },
      { role: 'user', content: `${contextParts.join('\n\n')}\n\nWrite documentation for: ${opts.prompt}` },
    ],
    max_tokens: 2048,
  });
  const markdown = (result as { response?: string }).response?.trim();
  if (!markdown) throw new Error('The model returned no content.');
  return { markdown, sources };
}

/* ------------------------------------------------------------------ */
/* image generation                                                    */
/* ------------------------------------------------------------------ */

export async function generateImage(prompt: string): Promise<{ dataUrl: string; contentType: string }> {
  if (aiMocked()) {
    // Deterministic placeholder so the full asset pipeline is testable.
    const safe = prompt.replace(/[<>&"]/g, '').slice(0, 60);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><radialGradient id="g" cx="30%" cy="24%" r="120%"><stop offset="0%" stop-color="#f6b079"/><stop offset="60%" stop-color="#c2571f"/><stop offset="100%" stop-color="#8f3d12"/></radialGradient></defs><rect width="800" height="600" fill="url(#g)"/><text x="400" y="300" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff">MOCK-AI: ${safe}</text></svg>`;
    return {
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
      contentType: 'image/svg+xml',
    };
  }

  const ai = await workersAI();
  if (!ai) throw new Error('Workers AI is not available (deploy to Cloudflare with the AI binding, or set AI_MOCK=1 in dev).');

  const result = await ai.run(IMAGE_MODEL, { prompt, steps: 6 });
  const image = (result as { image?: string }).image;
  if (!image) throw new Error('The model returned no image.');
  return { dataUrl: `data:image/jpeg;base64,${image}`, contentType: 'image/jpeg' };
}
