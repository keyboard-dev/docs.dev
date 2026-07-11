import { createOpenAPI } from 'fumadocs-openapi/server';
import specs from './openapi-specs.generated.json';

/**
 * OpenAPI schemas powering the generated API reference pages.
 *
 * The registry is generated at build time by scripts/generate-api-docs.mjs
 * from the specs in openapi/, and imported as a module (not read from disk)
 * so it is bundled into the Cloudflare Worker — there is no filesystem at
 * runtime. Its keys are the schema ids referenced by the generated MDX
 * (`document="…"`).
 */
export const openapi = createOpenAPI({
  input: specs as never,
});
