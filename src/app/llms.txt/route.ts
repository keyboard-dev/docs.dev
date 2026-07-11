import { listDocPages } from '@/lib/docs-index';
import { appName } from '@/lib/shared';

export const revalidate = false;

/**
 * llms.txt index. Links point at the `.md` aliases (append `.md` to any docs
 * URL) so agents that follow them get raw markdown, not HTML. The full corpus
 * is at /llms-full.txt; an MCP server is at /mcp.
 */
export function GET() {
  const pages = listDocPages()
    .map((p) => `- [${p.title}](${p.url}.md)${p.description ? `: ${p.description}` : ''}`)
    .join('\n');

  return new Response(
    `# ${appName}

> Documentation for ${appName}. Every page is available as raw markdown by appending \`.md\` to its URL. The full corpus is at /llms-full.txt. MCP clients can connect to the /mcp endpoint to search and read these docs.

## Docs

${pages}
`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
