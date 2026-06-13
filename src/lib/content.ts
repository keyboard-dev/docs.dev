// Runtime-safe access to docs content, backed by a build-time manifest
// (see scripts/gen-content-manifest.mjs). No filesystem reads, so this works
// on edge runtimes like Cloudflare Workers.
import manifest from './content-manifest.generated.json';

const CONTENT = manifest as Record<string, string>;

function normalize(slug: string): string {
  return slug.replace(/\.mdx$/, '').replace(/^\/+|\/+$/g, '');
}

export function getDocSource(slug: string): string | null {
  const key = normalize(slug);
  return Object.prototype.hasOwnProperty.call(CONTENT, key) ? CONTENT[key]! : null;
}

export function listDocSlugs(): string[] {
  return Object.keys(CONTENT).sort();
}
