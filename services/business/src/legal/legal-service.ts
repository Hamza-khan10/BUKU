import {
  AppError,
  ErrorCodes,
  normalizeEmail,
  normalizePhone,
  type Actor,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import {
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessShard,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import { onAdminTrail } from '../admin-trail.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Know-your-business (KYB) details. Only the OWNER may read or write them
 * ('business.legal'); only platform admins see them decrypted.
 *
 * Country-flexible by design: registration schemes differ everywhere, so the
 * registration TYPE is free text ("NTN", "SECP company", "Companies House",
 * "EIN", "Trade licence", ...) and the number is validated only for sanity.
 * Identifiers are encrypted bytes; the registration number also has a 16-byte blind index
 * (DB-008), so admins see when another business registered with the same one.
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

type Profile = BusinessShard.BusinessLegalProfile;

/** Same number typed with/without spaces or dashes must produce the same fingerprint. */
const normalizeIdentifier = (v: string) =>
  v
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-./]/g, '');

const mask = (v: string) => (v.length <= 4 ? '••••' : `••••${v.slice(-4)}`);

export class LegalService {
  constructor(
    private readonly plane: DataPlane,
    private readonly cipher: FieldCipher,
    private readonly indexer: BlindIndexer,
  ) {}

  /** Owner view: identifiers MASKED (enough to recognise, useless if the screen is seen). */
  async getOwn(businessId: bigint, actor: Actor) {
    const profile = await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.legal');
      return tx.businessLegalProfile.findUnique({ where: { businessId } });
    });
    return profile ? this.maskedView(profile) : null;
  }

  async upsert(businessId: bigint, actor: Actor, input: LegalProfileInput, ctx: RequestContext) {
    const { plane, cipher, indexer } = this;
    const regNumber = normalizeIdentifier(input.registrationNumber);
    const data = {
      legalName: input.legalName,
      registrationCountry: input.registrationCountry,
      registrationType: input.registrationType,
      registrationNumberEnc: cipher.encryptBytes(regNumber, CTX.registrationNumber),
      registrationNumberHash: indexer.digest16(
        CTX.registrationIndex,
        `${input.registrationCountry}|${normalizeIdentifier(input.registrationType)}|${regNumber}`,
      ),
      taxIdEnc: input.taxId ? cipher.encryptBytes(normalizeIdentifier(input.taxId), CTX.taxId) : null,
      registeredAddress: input.registeredAddress,
      responsibleName: input.responsiblePerson.name,
      responsibleRole: input.responsiblePerson.role,
      responsibleEmailEnc: input.responsiblePerson.email
        ? cipher.encryptBytes(normalizeEmail(input.responsiblePerson.email), CTX.email)
        : null,
      responsiblePhoneEnc: input.responsiblePerson.phone
        ? cipher.encryptBytes(normalizePhone(input.responsiblePerson.phone), CTX.phone)
        : null,
    };

    const { saved, reverify } = await plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.legal');
      const business = await tx.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { status: true },
      });
      if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      if (business.status === 'suspended') {
        throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
      }

      const existing = await tx.businessLegalProfile.findUnique({ where: { businessId } });
      // Who the business legally IS changed → a verified business goes back to review (D-046).
      const identityChanged =
        !existing ||
        existing.legalName !== data.legalName ||
        !Buffer.from(existing.registrationNumberHash).equals(data.registrationNumberHash) ||
        existing.registrationCountry !== data.registrationCountry;
      const reverify =
        existing !== null &&
        identityChanged &&
        (business.status === 'verified' || business.status === 'rejected');

      const saved = await tx.businessLegalProfile.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      if (reverify) {
        await tx.business.update({
          where: { id: businessId },
          data: { status: 'pending', verifiedAt: null, rejectionReason: null },
        });
      }
      await enqueueShardEvent(
        tx,
        plane.id(),
        createEvent({
          type: TOPICS.BUSINESSES_UPDATED,
          source: 'business-service',
          subject: businessId.toString(),
          // No identifiers in events: only that the legal profile changed.
          data: {
            businessId: businessId.toString(),
            changedFields: ['legalProfile'],
            reverificationRequired: reverify,
          },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'business',
      );
      await recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: existing ? 'business.legal_profile_updated' : 'business.legal_profile_submitted',
        resourceType: 'business',
        resourceId: businessId,
        newValues: { reverificationRequired: reverify },
        ...auditCtx(ctx),
      });
      return { saved, reverify };
    });
    return { ...this.maskedView(saved), reverificationRequired: reverify };
  }

  /**
   * Admin review view: fully decrypted, plus a fraud signal — other businesses, in every shard,
   * registered with the same number (owned by the same person or not). Viewing is audited.
   */
  async getForAdmin(businessId: bigint, adminId: bigint, ctx: RequestContext) {
    const { plane } = this;
    const found = await plane.inBusiness(businessId, async (tx) => {
      const profile = await tx.businessLegalProfile.findUnique({
        where: { businessId },
        include: { business: { select: { ownerUserId: true } } },
      });
      if (profile) {
        await recordShardAudit(tx, plane.id(), {
          userId: adminId,
          action: 'admin.legal_profile_viewed',
          resourceType: 'business',
          resourceId: businessId,
          ...auditCtx(ctx),
        });
      }
      return profile;
    });
    if (!found) return null;
    await onAdminTrail(plane, adminId, {
      action: 'admin.legal_profile_viewed',
      resourceType: 'business',
      resourceId: businessId,
      ...auditCtx(ctx),
    });
    const sharing = await plane.acrossBusinesses((tx) =>
      tx.businessLegalProfile.findMany({
        where: { registrationNumberHash: found.registrationNumberHash, businessId: { not: businessId } },
        select: { business: { select: { publicId: true, name: true, ownerUserId: true, status: true } } },
      }),
    );
    return {
      ...this.decrypted(found),
      sameRegistrationElsewhere: sharing.flat().map((s) => ({
        businessId: s.business.publicId,
        name: s.business.name,
        status: s.business.status,
        sameOwner: s.business.ownerUserId === found.business.ownerUserId,
      })),
    };
  }

  decrypted(p: Profile) {
    const { cipher } = this;
    return {
      legalName: p.legalName,
      registrationCountry: p.registrationCountry,
      registrationType: p.registrationType,
      registrationNumber: cipher.decryptBytes(p.registrationNumberEnc, CTX.registrationNumber),
      taxId: p.taxIdEnc ? cipher.decryptBytes(p.taxIdEnc, CTX.taxId) : null,
      registeredAddress: p.registeredAddress,
      responsiblePerson: {
        name: p.responsibleName,
        role: p.responsibleRole,
        email: p.responsibleEmailEnc ? cipher.decryptBytes(p.responsibleEmailEnc, CTX.email) : null,
        phone: p.responsiblePhoneEnc ? cipher.decryptBytes(p.responsiblePhoneEnc, CTX.phone) : null,
      },
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private maskedView(p: Profile) {
    const full = this.decrypted(p);
    return {
      ...full,
      registrationNumber: mask(full.registrationNumber),
      taxId: full.taxId ? mask(full.taxId) : null,
    };
  }
}
