/** Reading what people type or paste into the two-step code step. */

/** Only the digits ("123 456" pasted from a message, "123-456"), at most six. */
export const codeDigits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** A recovery code's letters and digits ("k7qx 2m9p" → "K7QX2M9P"). */
export const recoveryChars = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Does pasted text look like a recovery code rather than an app code? */
export const looksLikeRecoveryCode = (value: string) => {
  const chars = recoveryChars(value);
  return chars.length === 8 && /[A-Z]/.test(chars);
};
