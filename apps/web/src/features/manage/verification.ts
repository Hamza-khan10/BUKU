/**
 * Verification (3.5m): what BUKU needs before it can verify a business (the same checklist that
 * blocks the admin's "verify"), the legal and registration details, and the documents that prove
 * them. Legal details belong to the owner (`business.legal`); identifiers come back masked.
 */

export interface ChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

/** GET /v1/businesses/:id/verification. */
export interface Checklist {
  ready: boolean;
  items: ChecklistItem[];
}

/** GET /v1/businesses/:id/legal-profile (null until saved). Numbers come back masked (••••5678). */
export interface LegalProfile {
  legalName: string;
  registrationCountry: string;
  registrationType: string;
  registrationNumber: string;
  taxId: string | null;
  registeredAddress: string;
  responsiblePerson: { name: string; role: string; email: string | null; phone: string | null };
  updatedAt: string;
}

/** PUT /v1/businesses/:id/legal-profile. */
export interface LegalProfileInput {
  legalName: string;
  registrationCountry: string;
  registrationType: string;
  registrationNumber: string;
  taxId?: string;
  registeredAddress: string;
  responsiblePerson: { name: string; role: string; email?: string; phone?: string };
}

export const DOCUMENT_KINDS = [
  'business_license',
  'medical_license',
  'id_proof',
  'address_proof',
  'tax_certificate',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  business_license: 'Business licence or registration',
  medical_license: 'Medical licence',
  id_proof: 'Owner’s identity document',
  address_proof: 'Proof of address',
  tax_certificate: 'Tax certificate',
  other: 'Something else',
};

export type DocumentStatus = 'awaiting_upload' | 'pending' | 'approved' | 'rejected';

export interface BusinessDocument {
  id: string;
  type: DocumentKind;
  status: DocumentStatus;
  contentType: string;
  sizeBytes: number;
  reviewNote: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
}

export const DOCUMENT_STATUS: Record<Exclude<DocumentStatus, 'awaiting_upload'>, string> = {
  pending: 'Waiting for BUKU',
  approved: 'Approved',
  rejected: 'Not accepted',
};

/** The API's limits: PDF, JPEG or PNG, up to 25 MB, at most 20 per business. */
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENTS = 20;

/**
 * Can this file be sent as a document? The type the browser reports is only a first check (the
 * API reads the file's own signature after it arrives); an empty or oversized file never leaves.
 */
export function documentProblem(file: { type: string; size: number }): string | null {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(file.type)) return 'Send a PDF, JPEG or PNG.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_DOCUMENT_BYTES) return 'That file is over 25 MB. Send a smaller copy.';
  return null;
}

/** "183 KB", "2.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The documents worth showing: an upload that never arrived isn't one. Newest first. */
export const shownDocuments = (docs: BusinessDocument[]) =>
  docs.filter((d) => d.status !== 'awaiting_upload').sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

/** Approved documents are evidence BUKU keeps; the rest can be removed by the owner. */
export const removable = (d: BusinessDocument) => d.status !== 'approved';

/** Registration numbers vary by country; the API allows these characters only. */
export const IDENTIFIER = /^[A-Za-z0-9 .\-/]{3,64}$/;
