/**
 * What is this deployment? — build + Worker-version metadata, no API token.
 *
 * Two tokenless sources:
 *   - Build info: the commit/branch/time the running bundle was built from,
 *     inlined at build time via `env` in next.config.mjs (Workers Builds sets
 *     WORKERS_CI_COMMIT_SHA during CI builds; local builds fall back to git).
 *   - Worker version: Cloudflare's version_metadata binding
 *     (CF_VERSION_METADATA in wrangler.jsonc) — the id/tag/timestamp of the
 *     live Worker version, authenticated ambiently by the platform.
 *
 * Anything richer (build status, logs, failure reasons) is not available via
 * bindings; the deploy-status route gets that from GitHub commit checks
 * instead, which Workers Builds reports to on every push.
 */

export type BuildInfo = {
  /** Full commit SHA the running bundle was built from ('' if unknown). */
  commit: string;
  branch: string;
  /** ISO timestamp of when the bundle was built. */
  builtAt: string;
};

export type WorkerVersion = {
  /** Version UUID, e.g. from a Workers Builds deploy. */
  id: string;
  /** Human tag — the first 8 chars of the id unless explicitly tagged. */
  tag: string;
  /** ISO timestamp of when this version was created. */
  timestamp: string;
};

export function buildInfo(): BuildInfo {
  return {
    commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '',
    branch: process.env.NEXT_PUBLIC_BUILD_BRANCH ?? '',
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? '',
  };
}

/** The live Worker version, or null off-Cloudflare (plain `next dev/start`). */
export async function workerVersion(): Promise<WorkerVersion | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    const meta = (ctx.env as Record<string, unknown>).CF_VERSION_METADATA as
      | WorkerVersion
      | undefined;
    return meta ?? null;
  } catch {
    return null;
  }
}
