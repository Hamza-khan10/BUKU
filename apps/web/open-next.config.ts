import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * How OpenNext builds the website for Cloudflare Workers (D-135). No incremental cache yet: pages
 * that revalidate (the pricing page, the sitemap) are rendered again when asked, which is fine at
 * today's traffic. An R2 bucket can hold that cache later.
 */
export default defineCloudflareConfig({});
