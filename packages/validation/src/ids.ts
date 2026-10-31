/**
 * The API's identifiers (docs/DATABASE.md DB-042), shared by the services and the apps so both
 * judge an address the same way:
 *  • what people share and link to (a person, a business, an appointment) goes by a 12-character
 *    public ID (Base62);
 *  • anything reached inside its business (a service, an employee, a queue ticket, a review) and
 *    a kind of business goes by its 64-bit ID written in decimal. It stays a string: past 2^53 a
 *    JavaScript number would change it.
 */

export const PUBLIC_ID_PATTERN = /^[0-9A-Za-z]{12}$/;
export const DECIMAL_ID_PATTERN = /^[1-9][0-9]{0,18}$/;
/** A business's address on the site: its public ID, or its slug (lowercase words and hyphens). */
export const ID_OR_SLUG_PATTERN = /^(?:[0-9A-Za-z]{12}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const INT64_MAX = '9223372036854775807';

export const isPublicId = (value: unknown): value is string =>
  typeof value === 'string' && PUBLIC_ID_PATTERN.test(value);

/** A positive 64-bit decimal ID (compared as text: same length, same order). */
export const isDecimalId = (value: unknown): value is string =>
  typeof value === 'string' &&
  DECIMAL_ID_PATTERN.test(value) &&
  (value.length < INT64_MAX.length || value <= INT64_MAX);

export const isIdOrSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 200 && ID_OR_SLUG_PATTERN.test(value);
