import type { ReactNode } from 'react';
import type { LegalSection } from '@/components/content/legal-doc';

export interface LegalDocument {
  title: string;
  /** One sentence for search results and link previews. */
  description: string;
  version: string;
  inShort: ReactNode[];
  sections: LegalSection[];
}
