// Only Zod's settings, from its core (the same settings the full library reads): importing all
// of 'zod' here put its 32 KiB on every page, forms or not (3.7h).
import { config } from 'zod/v4/core';

/**
 * Runs in the browser before any of the site's own code (Next's instrumentation-client).
 *
 * The site's Content-Security-Policy forbids eval (no 'unsafe-eval' in production). Zod 4, on the
 * first object it checks, tries `new Function("")` to see whether it may compile faster checks.
 * The browser refuses, and Zod carries on the ordinary way, but the refusal is still reported as a
 * CSP violation on every page with a form. Told it may not compile (`jitless`), Zod never tries.
 * Set here, before any schema is created, because each schema decides when it's made.
 */
config({ jitless: true });
