import { describe, expect, it } from 'vitest';
import {
  documentProblem,
  fileSize,
  IDENTIFIER,
  removable,
  shownDocuments,
  type BusinessDocument,
} from '../src/features/manage/verification';

const doc = (over: Partial<BusinessDocument>): BusinessDocument => ({
  id: '1',
  type: 'business_license',
  status: 'pending',
  contentType: 'application/pdf',
  sizeBytes: 183_201,
  reviewNote: null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  reviewedAt: null,
  ...over,
});

describe('Verification', () => {
  it('sends only a PDF, JPEG or PNG that has something in it, up to 25 MB', () => {
    expect(documentProblem({ type: 'application/pdf', size: 183_201 })).toBeNull();
    expect(documentProblem({ type: 'image/png', size: 25 * 1024 * 1024 })).toBeNull();
    expect(documentProblem({ type: 'image/webp', size: 10 })).toBe('Send a PDF, JPEG or PNG.');
    expect(documentProblem({ type: '', size: 10 })).toBe('Send a PDF, JPEG or PNG.');
    expect(documentProblem({ type: 'text/html', size: 10 })).toBe('Send a PDF, JPEG or PNG.');
    expect(documentProblem({ type: 'image/jpeg', size: 0 })).toBe('That file is empty.');
    expect(documentProblem({ type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 })).toContain('over 25 MB');
  });

  it('lists what arrived, newest first; approved documents stay', () => {
    const docs = [
      doc({ id: 'a', uploadedAt: '2026-11-01T10:00:00.000Z', status: 'approved' }),
      doc({ id: 'b', uploadedAt: '2026-11-12T10:00:00.000Z', status: 'awaiting_upload' }),
      doc({ id: 'c', uploadedAt: '2026-11-11T10:00:00.000Z', status: 'rejected' }),
    ];
    expect(shownDocuments(docs).map((d) => d.id)).toEqual(['c', 'a']);
    expect(removable(docs[0]!)).toBe(false);
    expect(removable(docs[2]!)).toBe(true);
    expect(removable(doc({ status: 'pending' }))).toBe(true);
  });

  it('says sizes the way people read them, and takes registration numbers as the API does', () => {
    expect([fileSize(500), fileSize(183_201), fileSize(2_516_582)]).toEqual(['1 KB', '179 KB', '2.4 MB']);
    for (const ok of ['0123456-78', 'SC 123/45', 'AB.12']) expect(IDENTIFIER.test(ok)).toBe(true);
    for (const bad of ['12', '••••5678', 'ABC<script>', '12_34', 'x'.repeat(65)])
      expect(IDENTIFIER.test(bad)).toBe(false);
  });
});
