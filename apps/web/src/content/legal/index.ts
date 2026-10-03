import type { SiteFacts } from '@/lib/site';
import { acceptableUse } from './acceptable-use';
import { businessTerms } from './business-terms';
import { cookies } from './cookies';
import { privacy } from './privacy';
import { refunds } from './refunds';
import { subProcessors } from './sub-processors';
import { terms } from './terms';
import type { LegalDocument } from './types';

/** Every legal document, by the slug in its address (/legal/<slug>). */
export const LEGAL_DOCUMENTS: Record<string, (facts: SiteFacts) => LegalDocument> = {
  privacy,
  terms,
  'business-terms': businessTerms,
  cookies,
  'acceptable-use': acceptableUse,
  refunds,
  'sub-processors': subProcessors,
};

export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS);

export type { LegalDocument };
