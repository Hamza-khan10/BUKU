import { AppError } from '@buku/common';
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

/** 800 (or 800.5) as entered → minor units; refuses more decimals than the currency has. */
export function toMinor(amount: number, exponent: number): bigint {
  const scaled = amount * 10 ** exponent;
  const minor = Math.round(scaled);
  if (Math.abs(scaled - minor) > 1e-6) {
    throw AppError.badRequest(`Prices in this currency have at most ${exponent} decimals`, [
      { path: 'price', message: `at most ${exponent} decimals` },
    ]);
  }
  return BigInt(minor);
}

/** Minor units → "800.00" (as many decimals as the currency has). */
export function formatMinor(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = exponent ? digits.slice(0, -exponent) : digits;
  const fraction = exponent ? `.${digits.slice(-exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}
