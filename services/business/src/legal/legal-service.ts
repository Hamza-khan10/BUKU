import {
  AppError,
  ErrorCodes,
  normalizeEmail,
  normalizePhone,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import {
  recordAudit,
  requireBusinessPermission,
  type BusinessLegalProfile,
  type Database,
} from '@buku/database';
import { createEvent, enqueueEvent, TOPICS } from '@buku/kafka';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Know-your-business (KYB) details. Only the OWNER may read or write them
 * ('business.legal'); only platform admins see them decrypted.
 *
 * Country-flexible by design: registration schemes differ everywhere, so the
 * registration TYPE is free text ("NTN", "SECP company", "Companies House",
 * "EIN", "Trade licence", ...) and the number is validated only for sanity.
 */

const CTX = {
  registrationNumber: 'business_legal.registration_number',
  registrationIndex: 'business_legal.registration_index',
  taxId: 'business_legal.tax_id',
  email: 'business_legal.responsible_email',
  phone: 'business_legal.responsible_phone',
} as const;

export interface LegalProfileInput {
  legalName: string;
  registrationCountry: string;
  registrationType: string;
  registrationNumber: string;
  taxId?: string | undefined;
  registeredAddress: string;
  responsiblePerson: { name: string; role: string; email?: string | undefined; phone?: string | undefined };
}

/** Same number typed with/without spaces or dashes must produce the same fingerprint. */
const normalizeIdentifier = (v: string) =>
  v
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-./]/g, '');

const mask = (v: string) => (v.length <= 4 ? '••••' : `••••${v.slice(-4)}`);

export class LegalService {
  constructor(
    private readonly db: Database,
    private readonly cipher: FieldCipher,
    private readonly indexer: BlindIndexer,
  ) {}

  /** Owner view: identifiers MASKED (enough to recognise, useless if the screen is seen). */
  async getOwn(businessId: string, userId: string) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    const profile = await this.db.businessLegalProfile.findUnique({ where: { businessId } });
    return profile ? this.maskedView(profile) : null;
  }

  async upsert(businessId: string, userId: string, input: LegalProfileInput, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    const business = await this.db.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { status: true },
    });
    if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    if (business.status === 'suspended') {
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
    }

    const regNumber = normalizeIdentifier(input.registrationNumber);
    const data = {
      legalName: input.legalName,
      registrationCountry: input.registrationCountry,
      registrationType: input.registrationType,
      registrationNumberEncrypted: this.cipher.encrypt(regNumber, CTX.registrationNumber),
      registrationNumberHash: this.indexer.hash(
        CTX.registrationIndex,
        `${input.registrationCountry}|${normalizeIdentifier(input.registrationType)}|${regNumber}`,
      ),
      taxIdEncrypted: input.taxId ? this.cipher.encrypt(normalizeIdentifier(input.taxId), CTX.taxId) : null,
      registeredAddress: input.registeredAddress,
      responsibleName: input.responsiblePerson.name,
      responsibleRole: input.responsiblePerson.role,
      responsibleEmailEncrypted: input.responsiblePerson.email
        ? this.cipher.encrypt(normalizeEmail(input.responsiblePerson.email), CTX.email)
        : null,
      responsiblePhoneEncrypted: input.responsiblePerson.phone
        ? this.cipher.encrypt(normalizePhone(input.responsiblePerson.phone), CTX.phone)
        : null,
    };

    const existing = await this.db.businessLegalProfile.findUnique({ where: { businessId } });
    // Who the business legally IS changed → a verified business goes back to review (D-046).
    const identityChanged =
      !existing ||
      existing.legalName !== data.legalName ||
      existing.registrationNumberHash !== data.registrationNumberHash ||
      existing.registrationCountry !== data.registrationCountry;
    const reverify =
      existing !== null &&
      identityChanged &&
      (business.status === 'verified' || business.status === 'rejected');

    const saved = await this.db.$transaction(async (tx) => {
      const row = await tx.businessLegalProfile.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      if (reverify) {
        await tx.business.update({
          where: { id: businessId },
          data: { status: 'pending', verified: false, verifiedAt: null, rejectionReason: null },
        });
      }
      await enqueueEvent(
        tx,
        createEvent({
          type: TOPICS.BUSINESSES_UPDATED,
          source: 'business-service',
          subject: businessId,
          // No identifiers in events: only that the legal profile changed.
          data: { businessId, changedFields: ['legalProfile'], reverificationRequired: reverify },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'business',
      );
      await recordAudit(tx, {
        userId,
        action: existing ? 'business.legal_profile_updated' : 'business.legal_profile_submitted',
        resourceType: 'business',
        resourceId: businessId,
        newValues: { reverificationRequired: reverify },
        ...auditCtx(ctx),
      });
      return row;
    });
    return { ...this.maskedView(saved), reverificationRequired: reverify };
  }

  /**
   * Admin review view: fully decrypted, plus a fraud signal — other businesses
   * (owned by someone else) registered with the same number. Viewing is audited.
   */
  async getForAdmin(businessId: string, adminId: string, ctx: RequestContext) {
    const profile = await this.db.businessLegalProfile.findUnique({
      where: { businessId },
      include: { business: { select: { ownerId: true } } },
    });
    if (!profile) return null;
    const sharing = await this.db.businessLegalProfile.findMany({
      where: { registrationNumberHash: profile.registrationNumberHash, businessId: { not: businessId } },
      select: { business: { select: { id: true, name: true, ownerId: true, status: true } } },
    });
    await recordAudit(this.db, {
      userId: adminId,
      action: 'admin.legal_profile_viewed',
      resourceType: 'business',
      resourceId: businessId,
      ...auditCtx(ctx),
    });
    return {
      ...this.decrypted(profile),
      sameRegistrationElsewhere: sharing.map((s) => ({
        businessId: s.business.id,
        name: s.business.name,
        status: s.business.status,
        sameOwner: s.business.ownerId === profile.business.ownerId,
      })),
    };
  }

  decrypted(p: BusinessLegalProfile) {
    return {
      legalName: p.legalName,
      registrationCountry: p.registrationCountry,
      registrationType: p.registrationType,
      registrationNumber: this.cipher.decrypt(p.registrationNumberEncrypted, CTX.registrationNumber),
      taxId: p.taxIdEncrypted ? this.cipher.decrypt(p.taxIdEncrypted, CTX.taxId) : null,
      registeredAddress: p.registeredAddress,
      responsiblePerson: {
        name: p.responsibleName,
        role: p.responsibleRole,
        email: p.responsibleEmailEncrypted
          ? this.cipher.decrypt(p.responsibleEmailEncrypted, CTX.email)
          : null,
        phone: p.responsiblePhoneEncrypted
          ? this.cipher.decrypt(p.responsiblePhoneEncrypted, CTX.phone)
          : null,
      },
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private maskedView(p: BusinessLegalProfile) {
    const full = this.decrypted(p);
    return {
      ...full,
      registrationNumber: mask(full.registrationNumber),
      taxId: full.taxId ? mask(full.taxId) : null,
    };
  }
}
