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
};

export default withMDX(config);
