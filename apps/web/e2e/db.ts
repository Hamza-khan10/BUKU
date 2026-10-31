import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Simulated time on the development stack, the way the acceptance run does it: a test can't wait
 * for a visit to happen, so a step moves it — on the business's own shard, as the tools' role
 * (never an admin), with the customer's side kept in step by booking's own sync
 * (services/booking/scripts/dev-world.ts, database v2). Unavailable (no stack, no .env) → null,
 * and the test skips.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PUBLIC_ID = /^[0-9A-Za-z]{12}$/;

function devWorld(command: string, ...args: string[]): unknown {
  try {
    const out = execFileSync(
      `${ROOT}node_modules/.bin/tsx`,
      [`${ROOT}services/booking/scripts/dev-world.ts`, command, ...args],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'warn' } },
    );
    return JSON.parse(out.trim().split('\n').at(-1)!) as unknown;
  } catch {
    return null;
  }
}

const publicId = (value: string, what: string) => {
  if (!PUBLIC_ID.test(value)) throw new Error(`not ${what} (a public ID)`);
  return value;
};

export const canSimulateTime = () => devWorld('ping') === true;

/**
 * The visit happened `days` ago and the business marked it completed (what the front desk does
 * after a visit). Tries a few days in case the person was busy then.
 */
export const visitHappened = (businessId: string, appointmentId: string, days = 5) =>
  devWorld(
    'visit-happened',
    publicId(businessId, 'a business'),
    publicId(appointmentId, 'an appointment'),
    String(days),
  ) === true;

/** The visit starts `minutes` from now (negative: started that long ago), ending `endsIn` from now. */
export const moveVisit = (businessId: string, appointmentId: string, minutes: number, endsIn: number) =>
  devWorld(
    'move-visit',
    publicId(businessId, 'a business'),
    publicId(appointmentId, 'an appointment'),
    String(minutes),
    String(endsIn),
  ) === true;

/** An appointment's status, straight from the business's shard. */
export const appointmentStatus = (businessId: string, appointmentId: string) =>
  devWorld('visit-status', publicId(businessId, 'a business'), publicId(appointmentId, 'an appointment')) as
    string | null;

/** A business a test made is closed when the test is done. */
export const closeBusiness = (businessId: string) =>
  devWorld('close-business', publicId(businessId, 'a business')) === true;

/** Give an account a picture link, as a sign-in provider would. */
export const pictureFromProvider = (userId: string, url: string) =>
  devWorld('provider-picture', publicId(userId, 'an account'), url) === true;

/** Every session of this account started `minutes` ago (as if signed in long before). */
export const signedInAgo = (userId: string, minutes: number) =>
  devWorld('signed-in-ago', publicId(userId, 'an account'), String(minutes)) === true;

/** Has this account asked to be deleted? */
export const deletionRequested = (userId: string) =>
  devWorld('deletion-requested', publicId(userId, 'an account')) === true;
