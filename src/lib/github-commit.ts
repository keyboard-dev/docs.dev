/**
 * Single-file commits via the GitHub contents API — the write primitive
 * behind the editor's publish flow and the OpenAPI spec upload. One commit
 * per call; a production batching path would use the Git Trees API.
 */

export type GhHeaders = Record<string, string>;

export function ghHeaders(token: string): GhHeaders {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'docs.dev-admin',
  };
}

export async function commitFile(
  owner: string,
  repo: string,
  branch: string,
  repoPath: string,
  base64Content: string,
  message: string,
  headers: GhHeaders,
): Promise<{ commitUrl: string; commitSha: string } | { error: string; status: number }> {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  let sha: string | undefined;
  const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (head.ok) {
    sha = ((await head.json()) as { sha?: string }).sha;
  } else if (head.status !== 404) {
    const detail = await head.text().catch(() => '');
    return { error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const res = await fetch(base, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub commit failed (${res.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const data = (await res.json()) as { commit?: { html_url?: string; sha?: string } };
  return { commitUrl: data.commit?.html_url ?? '', commitSha: data.commit?.sha ?? '' };
}

export async function deleteFile(
  owner: string,
  repo: string,
  branch: string,
  repoPath: string,
  message: string,
  headers: GhHeaders,
): Promise<{ commitUrl: string; commitSha: string } | { error: string; status: number }> {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (head.status === 404) return { error: 'File not found.', status: 404 };
  if (!head.ok) {
    const detail = await head.text().catch(() => '');
    return { error: `GitHub read failed (${head.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const sha = ((await head.json()) as { sha?: string }).sha;
  const res = await fetch(base, {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub delete failed (${res.status}). ${detail.slice(0, 200)}`, status: 502 };
  }
  const data = (await res.json()) as { commit?: { html_url?: string; sha?: string } };
  return { commitUrl: data.commit?.html_url ?? '', commitSha: data.commit?.sha ?? '' };
}
