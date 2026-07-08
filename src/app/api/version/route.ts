import { NextResponse } from 'next/server';
import { buildInfo, workerVersion } from '@/lib/deploy-info';

/**
 * Which deployment is serving this site? Public and tokenless: the build
 * commit is inlined at build time and the Worker version comes from the
 * version_metadata binding. The docs repo is public, so none of this is
 * sensitive — and it's what lets the editor tell "your publish is live".
 */
export async function GET() {
  const build = buildInfo();
  const version = await workerVersion();
  return NextResponse.json(
    {
      commit: build.commit || null,
      branch: build.branch || null,
      builtAt: build.builtAt || null,
      worker: version
        ? { versionId: version.id, versionTag: version.tag, deployedAt: version.timestamp }
        : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
