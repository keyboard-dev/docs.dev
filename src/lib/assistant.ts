/**
 * Reader-facing "Ask AI" assistant.
 *
 * Retrieval-augmented chat over the published docs: the last user message is
 * matched against the docs index, the top pages are inlined as context, and
 * Workers AI (same `AI` binding the editor uses) answers with citations.
 *
 * The route streams SSE. The first event carries the retrieved sources
 * (`{"sources": [...]}`); the rest are Workers AI's own token events
 * (`{"response": "..."}`), piped through unchanged, ending with `[DONE]`.
 *
 * AI_MOCK=1 fabricates the same stream shape so the UI is testable offline.
 */

import { aiMocked, TEXT_MODEL, workersAI } from '@/lib/ai';
import { findDocPage, searchDocPages, type DocSearchResult } from '@/lib/docs-index';
import { logQuestion } from '@/lib/insights';
import { getLLMText, source } from '@/lib/source';
import { appName } from '@/lib/shared';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export const CHAT_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 4000,
};

const CONTEXT_PAGES = 4;
const CONTEXT_CHARS_PER_PAGE = 6000;

const ASSISTANT_SYSTEM = `You are the documentation assistant for ${appName}. Answer the user's question using ONLY the documentation pages provided below.

Rules:
- Be concise and concrete; prefer steps and code from the docs over generalities.
- Cite pages you used with inline markdown links to their URL (e.g. [Getting started](/docs/getting-started)).
- If the docs don't cover the question, say so plainly — never invent behavior, config, or APIs.
- Output plain markdown (paragraphs, lists, inline code, fenced code blocks). No frontmatter, no HTML.`;

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

async function buildContext(question: string): Promise<{ sources: DocSearchResult[]; context: string }> {
  let sources = await searchDocPages(question, CONTEXT_PAGES);
  // A greeting or very short question may match nothing; fall back to the
  // index page so the model can still describe what the docs cover.
  if (sources.length === 0) {
    const index = source.getPage([]);
    if (index) {
      sources = [];
      const body = await getLLMText(index);
      return { sources, context: body.slice(0, CONTEXT_CHARS_PER_PAGE) };
    }
    return { sources, context: '' };
  }

  const parts = await Promise.all(
    sources.map(async (s) => {
      const page = findDocPage(s.url);
      const body = page ? await getLLMText(page) : '';
      return `--- Page: ${s.title} (${s.url}) ---\n${body.slice(0, CONTEXT_CHARS_PER_PAGE)}`;
    }),
  );
  return { sources, context: parts.join('\n\n') };
}

function mockStream(question: string, sources: DocSearchResult[]): ReadableStream<Uint8Array> {
  const answer = `MOCK-ANSWER about "${question.slice(0, 60)}" — see ${
    sources[0] ? `[${sources[0].title}](${sources[0].url})` : 'the docs index'
  }.`;
  const chunks = answer.match(/.{1,12}/g) ?? [];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(sse({ sources }));
      for (const chunk of chunks) controller.enqueue(sse({ response: chunk }));
      controller.enqueue(sse('[DONE]'));
      controller.close();
    },
  });
}

/** Answer a chat, returning an SSE byte stream (sources event, then tokens). */
export async function streamAssistantAnswer(
  messages: ChatMessage[],
  opts: { page?: string } = {},
): Promise<ReadableStream<Uint8Array>> {
  const question = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const { sources, context } = await buildContext(question);

  // Anonymous insights (question, page, sources found — no reader identity);
  // see lib/insights.ts. Best-effort: never blocks or breaks the answer.
  void logQuestion({ page: opts.page ?? '', question, sources: sources.length }).catch(() => {});

  if (aiMocked()) return mockStream(question, sources);

  const ai = await workersAI();
  if (!ai) throw new Error('Workers AI is not available on this deployment.');

  const result = await ai.run(TEXT_MODEL, {
    messages: [
      { role: 'system', content: `${ASSISTANT_SYSTEM}\n\n# Documentation pages\n\n${context}` },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    stream: true,
    max_tokens: 1024,
  });

  if (!(result instanceof ReadableStream)) {
    // Defensive: some models ignore `stream`. Wrap the one-shot answer.
    const text = (result as { response?: string }).response ?? '';
    return new ReadableStream({
      start(controller) {
        controller.enqueue(sse({ sources }));
        controller.enqueue(sse({ response: text }));
        controller.enqueue(sse('[DONE]'));
        controller.close();
      },
    });
  }

  // Prepend our sources event, then pipe Workers AI's SSE bytes through.
  const upstream = result.getReader();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(sse({ sources }));
    },
    async pull(controller) {
      const { done, value } = await upstream.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return upstream.cancel(reason);
    },
  });
}
