import { NextResponse } from 'next/server';
import { getDocPageMarkdown, listDocPages, searchDocPages } from '@/lib/docs-index';
import { appName } from '@/lib/shared';

/**
 * MCP server for the docs — lets Claude Code, Cursor, and other MCP clients
 * search and read this documentation directly:
 *
 *   { "mcpServers": { "docs": { "url": "https://<site>/mcp" } } }
 *
 * Implements the stateless Streamable HTTP transport by hand: plain JSON-RPC
 * over POST with `application/json` responses (the spec allows JSON in place
 * of an SSE stream), no sessions, no server-initiated messages. That keeps it
 * dependency-free and trivially compatible with Cloudflare Workers.
 *
 * Tools: search_docs, read_page, list_pages.
 */

const PROTOCOL_VERSION = '2025-06-18';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: 'search_docs',
    description: `Search the ${appName} documentation. Returns matching pages with URLs and snippets; follow up with read_page for full content.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        limit: { type: 'number', description: 'Max results (default 5, max 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_page',
    description: 'Read a documentation page as markdown. Pass the page path or URL, e.g. "/docs/getting-started".',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path or URL from search_docs or list_pages.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_pages',
    description: 'List every documentation page (title, description, URL).',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

function ok(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ReturnType<typeof textResult>> {
  switch (name) {
    case 'search_docs': {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) return textResult('The "query" argument is required.', true);
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
      const results = await searchDocPages(query, limit);
      if (results.length === 0) return textResult(`No pages matched "${query}".`);
      return textResult(
        results
          .map((r) => `## ${r.title}\nURL: ${r.url}\n${r.description ? `${r.description}\n` : ''}> ${r.snippet}`)
          .join('\n\n'),
      );
    }
    case 'read_page': {
      const path = typeof args.path === 'string' ? args.path : '';
      const page = await getDocPageMarkdown(path);
      if (!page) return textResult(`No page found at "${path}". Use list_pages or search_docs to find valid paths.`, true);
      return textResult(page.markdown);
    }
    case 'list_pages':
      return textResult(
        listDocPages()
          .map((p) => `- ${p.title} — ${p.url}${p.description ? ` — ${p.description}` : ''}`)
          .join('\n'),
      );
    default:
      return textResult(`Unknown tool "${name}".`, true);
  }
}

async function handle(req: JsonRpcRequest): Promise<object | null> {
  const { id, method, params } = req;
  if (req.jsonrpc !== '2.0' || typeof method !== 'string') {
    return fail(id, -32600, 'Invalid JSON-RPC request.');
  }
  // Notifications get no response body.
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return ok(id, {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: `${appName} docs`, version: '1.0.0' },
        instructions: `Search and read the ${appName} documentation. Start with search_docs, then read_page for full pages.`,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      return ok(id, await callTool(name, args));
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
  if (body === null) {
    return NextResponse.json(fail(null, -32700, 'Parse error: body must be JSON.'), { status: 400 });
  }

  const responses = (await Promise.all((Array.isArray(body) ? body : [body]).map(handle))).filter(
    (r): r is object => r !== null,
  );

  // All-notifications input → acknowledge with no body, per Streamable HTTP.
  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

// Stateless server: no SSE stream to offer and no sessions to delete.
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}

export const DELETE = GET;
