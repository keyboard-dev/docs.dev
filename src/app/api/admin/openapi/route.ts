import { NextResponse } from 'next/server';
import { readSession } from '@/lib/admin';
import { repoCredential } from '@/lib/github-auth';
import { commitFile, deleteFile, ghHeaders } from '@/lib/github-commit';
import { gitConfig } from '@/lib/shared';

/**
 * Manage the OpenAPI specs behind the generated API reference.
 *
 *   GET                      → { specs: [{ name, size }] }        (openapi/*.json)
 *   PUT { name, content }    → { ok, commitSha, commitUrl, … }    (validate + commit)
 *   DELETE ?name=x           → { ok, commitSha, … }
 *
 * Specs are committed to `openapi/<name>.json` on the deploy branch; the
 * build regenerates content/docs/api-reference from them, so a spec upload
 * is live after the next deploy — same push-to-deploy loop as publishing a
 * page. Validation is deliberately shallow (parses, looks like OpenAPI):
 * the generator at build time is the real arbiter.
 *
 * GITHUB_CONTENT_MOCK=1 (dev/tests) swaps in an in-memory store.
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SPEC_BYTES = 2 * 1024 * 1024;

function mocked(): boolean {
  return process.env.GITHUB_CONTENT_MOCK === '1';
}
const mockSpecs = new Map<string, number>([['admin-api', 12345]]);

function repoTarget() {
  return {
    owner: process.env.GITHUB_OWNER ?? gitConfig.user,
    repo: process.env.GITHUB_REPO ?? gitConfig.repo,
    branch: process.env.GITHUB_BRANCH ?? gitConfig.branch,
  };
}

function validateSpec(content: string): string | null {
  if (new TextEncoder().encode(content).length > MAX_SPEC_BYTES) return 'Spec is too large (max 2 MB).';
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return 'Not valid JSON. (YAML specs aren’t supported — convert to JSON first.)';
  }
  const d = doc as { openapi?: unknown; swagger?: unknown; paths?: unknown; info?: { title?: unknown } };
  if (typeof d.openapi !== 'string' && typeof d.swagger !== 'string') {
    return 'Missing the "openapi" version field — is this an OpenAPI document?';
  }
  if (d.paths == null || typeof d.paths !== 'object') return 'Missing "paths" — is this an OpenAPI document?';
  if (typeof d.info?.title !== 'string') return 'Missing "info.title".';
  return null;
}

async function credOr503(session: Awaited<ReturnType<typeof readSession>>) {
  if (mocked()) return { token: 'mock' };
  return repoCredential(session);
}

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (mocked()) {
    return NextResponse.json({ ok: true, specs: [...mockSpecs].map(([name, size]) => ({ name, size })) });
  }
  const cred = await repoCredential(session);
  if (!cred) {
    return NextResponse.json({ ok: false, error: 'No GitHub credential — set GITHUB_PAT or sign in with GitHub.' }, { status: 503 });
  }
  const { owner, repo, branch } = repoTarget();
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/openapi?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(cred.token) },
  );
  if (res.status === 404) return NextResponse.json({ ok: true, specs: [] });
  if (!res.ok) return NextResponse.json({ ok: false, error: `GitHub read failed (${res.status}).` }, { status: 502 });
  const entries = (await res.json()) as Array<{ name: string; type: string; size: number }>;
  return NextResponse.json({
    ok: true,
    specs: entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
      .map((e) => ({ name: e.name.replace(/\.json$/, ''), size: e.size })),
  });
}

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const { name, content } = (await request.json().catch(() => ({}))) as { name?: string; content?: string };
  if (typeof name !== 'string' || !NAME_RE.test(name) || typeof content !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Bad request — name must be lowercase kebab-case and content a JSON string.' },
      { status: 400 },
    );
  }
  const invalid = validateSpec(content);
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 422 });

  if (mocked()) {
    mockSpecs.set(name, content.length);
    return NextResponse.json({ ok: true, commitSha: 'mock', commitUrl: '', repo: 'mock/mock', branch: 'main' });
  }
  const cred = await credOr503(session);
  if (!cred) {
    return NextResponse.json({ ok: false, error: 'No GitHub credential — set GITHUB_PAT or sign in with GitHub.' }, { status: 503 });
  }
  const { owner, repo, branch } = repoTarget();
  const r = await commitFile(
    owner,
    repo,
    branch,
    `openapi/${name}.json`,
    Buffer.from(content, 'utf8').toString('base64'),
    `docs: update OpenAPI spec ${name} via editor`,
    ghHeaders(cred.token),
  );
  if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r, repo: `${owner}/${repo}`, branch });
}

export async function DELETE(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!NAME_RE.test(name)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });

  if (mocked()) {
    if (!mockSpecs.delete(name)) return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, commitSha: 'mock', commitUrl: '' });
  }
  const cred = await credOr503(session);
  if (!cred) {
    return NextResponse.json({ ok: false, error: 'No GitHub credential — set GITHUB_PAT or sign in with GitHub.' }, { status: 503 });
  }
  const { owner, repo, branch } = repoTarget();
  const r = await deleteFile(
    owner,
    repo,
    branch,
    `openapi/${name}.json`,
    `docs: remove OpenAPI spec ${name} via editor`,
    ghHeaders(cred.token),
  );
  if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r });
}
