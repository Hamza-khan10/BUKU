import 'server-only';
import { z } from 'zod';

/**
 * Who runs BUKU and how to reach them — for the legal, contact and security
 * pages. Read on their own (not through env()), so these pages work even where
 * the API isn't configured, e.g. a first deployment. Missing or malformed
 * details are `null`: pages then say they are published before launch.
 * Nothing is ever filled with a placeholder that looks real.
 */

const text = (max: number) => (v: string | undefined) => {
  const t = v?.trim();
  return t && t.length <= max ? t : null;
};
const email = (v: string | undefined) => (z.email().safeParse(v?.trim()).success ? v!.trim() : null);

export function siteFacts() {
  const e = process.env;
  return {
    legalName: text(200)(e.LEGAL_NAME),
    legalAddress: text(500)(e.LEGAL_ADDRESS),
    jurisdiction: text(100)(e.LEGAL_JURISDICTION),
    email: {
      support: email(e.SUPPORT_EMAIL),
      privacy: email(e.PRIVACY_EMAIL),
      security: email(e.SECURITY_EMAIL),
    },
    /** A lawyer has reviewed the legal pages (until then they are drafts). */
    legalReviewed: e.LEGAL_REVIEWED === 'true',
  };
}

export type SiteFacts = ReturnType<typeof siteFacts>;
