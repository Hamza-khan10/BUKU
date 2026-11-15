import { api } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import type {
  BusinessDocument,
  Checklist,
  DocumentKind,
  LegalProfile,
  LegalProfileInput,
} from './verification';

/** Verification (3.5m): the checklist for every team role; legal details and documents for the owner. */

export const checklistKey = (id: string) => ['business', id, 'verification'] as const;
export const legalKey = (id: string) => ['business', id, 'legal-profile'] as const;
export const documentsKey = (id: string) => ['business', id, 'documents'] as const;

export const fetchChecklist = (id: string) => api<Checklist>(`businesses/${id}/verification`);
export const fetchLegalProfile = (id: string) => api<LegalProfile | null>(`businesses/${id}/legal-profile`);
export const saveLegalProfile = (id: string, input: LegalProfileInput) =>
  api<LegalProfile & { reverificationRequired: boolean }>(`businesses/${id}/legal-profile`, {
    method: 'PUT',
    body: input,
  });

export const fetchDocuments = (id: string) => api<BusinessDocument[]>(`businesses/${id}/documents`);
export const removeDocument = (id: string, documentId: string) =>
  api<unknown>(`businesses/${id}/documents/${documentId}`, { method: 'DELETE' });

/** Ask for a link, send the file straight to storage, then have the API check what arrived. */
export const uploadDocument = (id: string, type: DocumentKind, file: File) =>
  uploadFile<BusinessDocument>(
    `businesses/${id}/documents/uploads`,
    { type },
    file,
    file.type,
    (started) => (started.documentId ? `businesses/${id}/documents/${started.documentId}/complete` : null),
    'The document couldn’t be sent. Check your connection and try again.',
  );
