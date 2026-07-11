import { createMDX } from 'fumadocs-mdx/next';
import { generateContentManifest } from './scripts/gen-content-manifest.mjs';
import { getBuildInfo } from './scripts/build-info.mjs';

// Snapshot docs content into a manifest so the admin editor can read baseline
// page source without runtime fs (required on Cloudflare Workers).
generateContentManifest();

// Which commit this build serves — inlined so the deployed Worker can report
// it back (deploy-status polling compares it against a just-published commit).
const buildInfo = getBuildInfo();

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildInfo.commit,
    NEXT_PUBLIC_BUILD_BRANCH: buildInfo.branch,
    NEXT_PUBLIC_BUILD_TIME: buildInfo.builtAt,
  },
  // Agent-friendly markdown aliases: append `.md` to any docs URL to get the
  // page as raw markdown (the convention agents and LLM tooling expect).
  // Serves the same content as /llms.mdx/docs/<slug>/content.md.
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/llms.mdx/docs/content.md' },
      { source: '/docs/:path*.md', destination: '/llms.mdx/docs/:path*/content.md' },
    ];
  },
};

export default withMDX(config);
