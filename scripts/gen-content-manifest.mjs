// Generates a build-time snapshot of the docs content so the admin editor can
// read baseline page source without touching the filesystem at runtime — which
// is required on edge runtimes like Cloudflare Workers (no fs).
//
// Runs from next.config.mjs on every build, and is also invokable directly:
//   node scripts/gen-content-manifest.mjs
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'docs');
const OUT = path.join(ROOT, 'src', 'lib', 'content-manifest.generated.json');

export function generateContentManifest() {
  const map = {};
  function walk(dir, prefix) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}${name}/`);
      } else if (name.endsWith('.mdx')) {
        const base = name.replace(/\.mdx$/, '');
        const slug = base === 'index' ? prefix.replace(/\/$/, '') : `${prefix}${base}`;
        map[slug] = readFileSync(full, 'utf8');
      }
    }
  }
  walk(CONTENT_DIR, '');
  writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n');
  return map;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateContentManifest();
}
