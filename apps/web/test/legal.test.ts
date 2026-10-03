import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { footerNav } from '../src/components/layout/nav';
import { LEGAL_DOCUMENTS, LEGAL_SLUGS } from '../src/content/legal';
import { BUSINESS_TERMS_VERSION, TERMS_VERSION } from '../src/lib/legal-versions';
const configDefault = (path: string, key: string) =>
  new RegExp(`${key}: z\\.string\\(\\)[^\\n]*\\.default\\('([^']+)'\\)`).exec(
    readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
  )?.[1];

const facts = {
  legalName: null,
  legalAddress: null,
  jurisdiction: null,
  email: { support: null, privacy: null, security: null },
  legalReviewed: false,
};

describe('legal documents', () => {
  it('the versions people agree to on the website are the ones the API expects', () => {
    expect(TERMS_VERSION).toBe(configDefault('services/auth/src/config.ts', 'TERMS_VERSION'));
    expect(BUSINESS_TERMS_VERSION).toBe(
      configDefault('services/business/src/config.ts', 'BUSINESS_TERMS_VERSION'),
    );
  });

  it('every document has a summary and sections with unique anchors', () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = LEGAL_DOCUMENTS[slug]!(facts);
      expect(doc.inShort.length, slug).toBeGreaterThan(0);
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size, slug).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('the footer links to every legal document', () => {
    const linked = footerNav.flatMap((g) => g.links.map((l) => String(l.href)));
    for (const slug of LEGAL_SLUGS) expect(linked).toContain(`/legal/${slug}`);
  });
});
