// Read plain-text vars out of wrangler.jsonc at BUILD time.
//
// Wrangler `vars` are runtime bindings: the deployed Worker sees them in
// process.env on every request, but the build (Workers Builds, `next build`)
// does not. Anything that must influence the build itself — like a baked-in
// redirect in next.config.mjs — has to read the committed config directly.
// A real build-time env var of the same name wins, so non-Cloudflare hosts
// (Netlify, local dev) can flip the same switch from their environment.

import fs from 'node:fs';

export function readWranglerVar(name) {
  if (process.env[name] !== undefined) return process.env[name];
  try {
    const raw = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const value = parseJsonc(raw)?.vars?.[name];
    return value === undefined ? undefined : String(value);
  } catch {
    return undefined;
  }
}

// Minimal JSONC: strip // and /* */ comments (string-aware) and drop
// trailing commas, then hand off to JSON.parse.
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      i--;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '');
      out += c;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}
