import { createOpenAPI } from 'fumadocs-openapi/server';
import adminApi from '../../openapi/admin-api.json';

/**
 * OpenAPI schemas powering the generated API reference pages.
 *
 * Schemas are imported as modules (not read from disk) so they are bundled
 * into the Cloudflare Worker — there is no filesystem at runtime. The keys
 * here are the schema ids referenced by the generated MDX (`document="…"`).
 */
export const openapi = createOpenAPI({
  input: { 'admin-api': adminApi as never },
});
