import 'server-only';
import { env } from './env';

/**
 * Who runs BUKU and how to reach them — for the legal, contact and security
 * pages. Missing details are `null`: pages then say they are published before
 * launch. Nothing is ever filled with a placeholder that looks real.
 */
export function siteFacts() {
  const e = env();
  return {
    legalName: e.LEGAL_NAME ?? null,
    legalAddress: e.LEGAL_ADDRESS ?? null,
    jurisdiction: e.LEGAL_JURISDICTION ?? null,
    email: {
      support: e.SUPPORT_EMAIL ?? null,
      privacy: e.PRIVACY_EMAIL ?? null,
      security: e.SECURITY_EMAIL ?? null,
    },
    /** A lawyer has reviewed the legal pages (until then they are drafts). */
    legalReviewed: e.LEGAL_REVIEWED,
  };
}

export type SiteFacts = ReturnType<typeof siteFacts>;
