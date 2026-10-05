/** Small pieces of setting up two-step sign-in. Pure, tested. */

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to type into an app by hand. */
export const groupedKey = (secret: string) =>
  secret
    .replace(/\s+/g, '')
    .match(/.{1,4}/g)
    ?.join(' ') ?? '';

/** The recovery codes as a text file to keep. */
export function recoveryCodesFile(
  codes: string[],
  account: string,
  now: Date,
): { name: string; text: string } {
  const day = now.toISOString().slice(0, 10);
  const text = [
    'BUKU recovery codes',
    `Account: ${account}`,
    `Made: ${day}`,
    '',
    'Each code signs you in once if you lose the phone with your authenticator app.',
    'With one you can also turn two-step sign-in off, or get new codes.',
    'Keep this file somewhere safe. Making new codes stops these from working.',
    '',
    ...codes,
    '',
  ].join('\n');
  return { name: `buku-recovery-codes-${day}.txt`, text };
}
