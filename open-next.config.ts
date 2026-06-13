import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default OpenNext config for Cloudflare Workers. Caching can later be backed
// by a KV/R2/D1 binding; the static docs don't require it.
export default defineCloudflareConfig();
