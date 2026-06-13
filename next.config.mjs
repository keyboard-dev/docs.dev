import { createMDX } from 'fumadocs-mdx/next';
import { generateContentManifest } from './scripts/gen-content-manifest.mjs';

// Snapshot docs content into a manifest so the admin editor can read baseline
// page source without runtime fs (required on Cloudflare Workers).
generateContentManifest();

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
};

export default withMDX(config);
