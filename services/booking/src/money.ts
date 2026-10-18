import type { BusinessTx } from '@buku/database';

/**
 * Money is kept in the currency's minor unit (DB-009: 80000 = PKR 800.00) and shown as a decimal
 * string ("800.00"): never through floating point on the way out. How many decimals a currency has
 * comes from the reference data (ISO 4217, DB-015).
 */

/** Decimals of a currency (2 for PKR, 0 for JPY); 2 if the reference data doesn't know it. */
export async function exponentOf(tx: BusinessTx, currency: string): Promise<number> {
  const row = await tx.currency.findUnique({ where: { code: currency }, select: { exponent: true } });
  return row?.exponent ?? 2;
}

/** Entered amounts → minor units, and back (shared by every service, `@buku/common`). */
export { formatMinor, toMinor } from '@buku/common';
