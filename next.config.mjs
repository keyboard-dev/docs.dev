import { createMDX } from 'fumadocs-mdx/next';
import { generateApiDocs } from './scripts/generate-api-docs.mjs';
import { generateContentManifest } from './scripts/gen-content-manifest.mjs';
import { generateRepoInfo } from './scripts/gen-repo-info.mjs';
import { getBuildInfo } from './scripts/build-info.mjs';
import { readWranglerVar } from './scripts/wrangler-vars.mjs';

// Detect which GitHub repo this checkout is (Deploy-to-Cloudflare copies,
// moved clones) so the editor publishes to the right place with zero config.
generateRepoInfo();

// Regenerate the API reference from the committed OpenAPI specs, so uploading
// a spec (a one-file commit) is all it takes — the pages follow at build time.
// Must run before the content manifest snapshot below picks them up.
await generateApiDocs();

// Snapshot docs content into a manifest so the admin editor can read baseline
// page source without runtime fs (required on Cloudflare Workers).
generateContentManifest();

// Which commit this build serves — inlined so the deployed Worker can report
// it back (deploy-status polling compares it against a just-published commit).
const buildInfo = getBuildInfo();

// OPTIONAL — skip the landing page. When HOME_REDIRECT_TO_DOCS is truthy
// (wrangler.jsonc `vars`, or a build-time env var) the index route redirects
// straight to /docs. On Cloudflare, worker.js also enforces this at request
// time (covering values set on the Worker rather than in the file); this
// baked redirect is what makes the same switch work on non-Worker hosts
// (Netlify, `next start`) where worker.js never runs.
const homeRedirectsToDocs = /^(1|true|yes)$/i.test(readWranglerVar('HOME_REDIRECT_TO_DOCS') ?? '');

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Remote images the site may render: the brand wordmark on Framer's CDN
  // and fal.media output from the editor's image generation.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'framerusercontent.com' },
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '*.fal.media' },
    ],
  },
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildInfo.commit,
    NEXT_PUBLIC_BUILD_BRANCH: buildInfo.branch,
    NEXT_PUBLIC_BUILD_TIME: buildInfo.builtAt,
  },
  // Agent-friendly markdown aliases: append `.md` to any docs URL to get the
  // page as raw markdown (the convention agents and LLM tooling expect).
  // Serves the same content as /llms.mdx/docs/<slug>/content.md.
  // Temporary (307), not permanent: bringing the landing page back must not
  // fight redirects cached by browsers.
  async redirects() {
    return homeRedirectsToDocs ? [{ source: '/', destination: '/docs', permanent: false }] : [];
  },
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/llms.mdx/docs/content.md' },
      { source: '/docs/:path*.md', destination: '/llms.mdx/docs/:path*/content.md' },
    ];
  },
};

export default withMDX(config);
