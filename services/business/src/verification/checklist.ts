import type { Database, DocumentType, Transaction } from '@buku/database';

/**
 * What a business must provide before an admin can verify it. The same
 * function drives the owner's checklist screen AND blocks the admin "verify"
 * action, so the two can never disagree.
 *
 * Regulated categories need a specific licence on top of the basics. Keyed by
 * the category's slug or its parent's slug (the tree is shallow).
 */
const REGULATED: Record<string, { document: DocumentType; label: string }> = {
  'health-medical': { document: 'medical_license', label: 'An approved medical licence' },
};

export interface ChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

export async function verificationChecklist(
  db: Database | Transaction,
  businessId: string,
): Promise<{ ready: boolean; items: ChecklistItem[] }> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      legalProfile: { select: { businessId: true } },
      documents: { where: { status: 'approved' }, select: { type: true } },
      category: { select: { slug: true, parent: { select: { slug: true } } } },
    },
  });
  const approved = new Set(business.documents.map((d) => d.type));
  const items: ChecklistItem[] = [
    {
      key: 'legal_profile',
      label: 'Legal and registration details submitted',
      met: business.legalProfile !== null,
    },
    {
      key: 'approved_document',
      label: 'At least one approved registration or identity document',
      met: approved.size > 0,
    },
  ];
  const rule =
    REGULATED[business.category.slug] ??
    (business.category.parent ? REGULATED[business.category.parent.slug] : undefined);
  if (rule) items.push({ key: rule.document, label: rule.label, met: approved.has(rule.document) });
  return { ready: items.every((i) => i.met), items };
}
