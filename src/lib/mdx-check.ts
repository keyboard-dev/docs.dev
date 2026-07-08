/**
 * Pre-flight validation for a doc before it's committed.
 *
 * A bad MDX file doesn't fail here — it fails four minutes later in the
 * Workers Build, leaving the site stuck on the previous deploy. So the
 * publish route compiles the submitted source first (same compiler the
 * in-browser preview uses) and rejects with the compiler's message instead
 * of committing a build-breaker. Frontmatter is checked against the same
 * baseline the site's schema enforces: a non-empty title.
 *
 * This is a syntax gate, not a full build: fumadocs' remark plugins aren't
 * loaded, so plugin-specific transforms are not exercised — but plain MDX
 * syntax errors (unclosed JSX, bad expressions) are what actually break
 * builds from the editor.
 */

export type MdxCheck =
  | { ok: true }
  | { ok: false; error: string; line?: number; column?: number };

function splitFrontmatter(source: string): { fmRaw: string | null; fmLines: number; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fmRaw: null, fmLines: 0, body: source };
  return { fmRaw: m[1]!, fmLines: m[0].split('\n').length - 1, body: source.slice(m[0].length) };
}

export async function checkDocSource(source: string): Promise<MdxCheck> {
  const { fmRaw, fmLines, body } = splitFrontmatter(source);
  if (fmRaw == null) {
    return {
      ok: false,
      error: 'Missing frontmatter. Start the document with a "---" block containing at least "title:".',
      line: 1,
    };
  }
  if (!/^title:\s*\S/m.test(fmRaw)) {
    return { ok: false, error: 'Frontmatter must include a non-empty "title:".', line: 2 };
  }

  try {
    const { compile } = await import('@mdx-js/mdx');
    await compile(body, { format: 'mdx' });
    return { ok: true };
  } catch (err) {
    const e = err as { reason?: string; message?: string; line?: number; column?: number; place?: { line?: number; column?: number } };
    const line = e.line ?? e.place?.line;
    return {
      ok: false,
      error: e.reason ?? e.message ?? 'MDX failed to compile.',
      // Report positions against the full document, not the stripped body.
      ...(line != null ? { line: line + fmLines } : {}),
      ...((e.column ?? e.place?.column) != null ? { column: e.column ?? e.place?.column } : {}),
    };
  }
}
