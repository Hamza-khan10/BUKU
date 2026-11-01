import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DataPlane, isExclusionViolation } from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import { PersonSync } from '../src/appointments/person-sync.js';

/**
 * Simulated time and tidying up on the DEVELOPMENT stack, for the acceptance run
 * (scripts/acceptance) and the website's browser tests (apps/web/e2e), on database v2 (D3i).
 *
 * A test can't wait a day for a visit to happen, so a step moves it: on the business's own shard,
 * as buku_app (the tools' role, never an administrator; row-level security still applies), with
 * the customer's side then brought up to date by booking's own PersonSync, exactly as booking
 * does after a change of its own. Everything else a test does goes through the public API.
 *
 * Refuses to run anywhere but the local stack. As a library: `const dev = await DevWorld.open()`;
 * from the command line, `tsx services/booking/scripts/dev-world.ts <command> <arguments…>` prints
 * its answer as JSON (see COMMANDS).
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const DAY = 86_400_000;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class DevWorld {
  private constructor(
    private readonly plane: DataPlane,
    private readonly persons: PersonSync,
  ) {}

  static async open(): Promise<DevWorld> {
    if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
    if (process.env.NODE_ENV === 'production') throw new Error('dev-world: development only');
    const password = process.env.BUKU_APP_PASSWORD;
    if (!password)
      throw new Error('dev-world: BUKU_APP_PASSWORD is not set (run from the repo with its .env)');
    const cluster = process.env.BUKU_DB_CLUSTER_LOCAL_1 ?? 'postgresql://localhost:5432';
    const server = new URL(cluster);
    if (!LOCAL.has(server.hostname))
      throw new Error('dev-world: refusing a database that is not on this machine');
    const at = (database: string) => {
      const u = new URL(cluster);
      u.username = 'buku_app';
      u.password = encodeURIComponent(password);
      u.pathname = `/${database}`;
      return u.toString();
    };
    const plane = await DataPlane.start({
      service: 'booking',
      databaseUrl: at('buku'),
      directoryUrl: at('buku_directory'),
      env: { ...process.env, BUKU_DB_CLUSTER_LOCAL_1: cluster },
      instance: `dev-world:${hostname()}:${process.pid}`,
      poolSize: 2,
    });
    return new DevWorld(plane, new PersonSync(plane));
  }

  close(): Promise<void> {
    return this.plane.close();
  }

  /**
   * Move a visit: it starts at `startAt` (keeping its length and buffer unless `endAt` is given),
   * optionally booked at `bookedAt` and with a new status. Then the customer's side follows.
   * False if the business or the visit can't be found.
   */
  async moveVisit(
    businessPublicId: string,
    appointmentPublicId: string,
    to: { startAt: Date; endAt?: Date; bookedAt?: Date; status?: 'completed' | 'confirmed' },
  ): Promise<boolean> {
    const businessId = await this.plane.idOfPublic('business', businessPublicId);
    if (!businessId) return false;
    const moved = await this.plane.inBusiness(businessId, async (tx) => {
      const index = await tx.appointmentIndex.findUnique({ where: { publicId: appointmentPublicId } });
      if (!index) return null;
      const a = await tx.appointment.findFirstOrThrow({ where: { id: index.appointmentId } });
      const endAt = to.endAt ?? new Date(to.startAt.getTime() + (a.endAt.getTime() - a.startAt.getTime()));
      // An appointment's time never changes (the shard refuses: it is the partition key). The same
      // appointment — its ID, public ID and code, so everything that names it still does — is
      // written again at the new time, in one transaction.
      await tx.appointment.deleteMany({ where: { id: a.id } });
      await tx.appointment.create({
        data: {
          ...a,
          startAt: to.startAt,
          endAt,
          blockedUntil: new Date(endAt.getTime() + (a.blockedUntil.getTime() - a.endAt.getTime())),
          ...(to.bookedAt && { createdAt: to.bookedAt }),
          ...(to.status && { status: to.status }),
          // The customer's list takes only a newer version (PersonSync).
          version: a.version + 1,
        },
      });
      return a.id;
    });
    if (!moved) return false;
    await this.persons.sync(businessId, moved);
    return true;
  }

  /**
   * The visit happened `days` ago and the business marked it done (what the front desk does).
   * Tries later days in turn should the person or the employee have been busy then.
   */
  async visitHappened(businessPublicId: string, appointmentPublicId: string, days = 5): Promise<boolean> {
    const visit = await this.visit(businessPublicId, appointmentPublicId);
    if (!visit) return false;
    for (let d = days; d < days + 10; d++) {
      try {
        return await this.moveVisit(businessPublicId, appointmentPublicId, {
          startAt: new Date(visit.startAt.getTime() - d * DAY),
          status: 'completed',
        });
      } catch (err) {
        if (!isExclusionViolation(err)) throw err;
      }
    }
    return false;
  }

  /**
   * The business reported a review (what its owner does from the review's page), for tests of the
   * admin's moderation: same fields as a real report, no notification.
   */
  async reviewReported(businessPublicId: string, reviewId: string, reason: string): Promise<boolean> {
    const businessId = await this.plane.idOfPublic('business', businessPublicId);
    if (!businessId || !/^[1-9][0-9]{0,18}$/.test(reviewId)) return false;
    return this.plane.inBusiness(businessId, async (tx) => {
      const { count } = await tx.review.updateMany({
        where: { id: BigInt(reviewId), businessId, isFlagged: false },
        data: { isFlagged: true, flagReason: reason.slice(0, 200), flaggedAt: new Date() },
      });
      return count === 1;
    });
  }

  /** A visit as the business's shard has it, or null. */
  async visit(businessPublicId: string, appointmentPublicId: string) {
    const businessId = await this.plane.idOfPublic('business', businessPublicId);
    if (!businessId) return null;
    return this.plane.inBusiness(businessId, async (tx) => {
      const index = await tx.appointmentIndex.findUnique({ where: { publicId: appointmentPublicId } });
      if (!index) return null;
      const a = await tx.appointment.findFirstOrThrow({ where: { id: index.appointmentId } });
      return { status: a.status, checkedIn: a.checkedInAt !== null, startAt: a.startAt };
    });
  }

  /** Change a business's booking rules (as its owner could, without the limits). */
  async bookingSettings(
    businessPublicId: string,
    data: { cancellationWindowHours?: number },
  ): Promise<boolean> {
    const businessId = await this.plane.idOfPublic('business', businessPublicId);
    if (!businessId) return false;
    await this.plane.inBusiness(businessId, (tx) =>
      tx.bookingSettings.upsert({ where: { businessId }, create: { businessId, ...data }, update: data }),
    );
    return true;
  }

  /** A business a test made is closed, and search told (as business-service would). */
  async closeBusiness(businessPublicId: string): Promise<boolean> {
    const businessId = await this.plane.idOfPublic('business', businessPublicId);
    if (!businessId) return false;
    return this.plane.inBusiness(businessId, async (tx) => {
      const open = await tx.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { status: true },
      });
      if (!open) return false;
      await tx.business.update({ where: { id: businessId }, data: { deletedAt: new Date() } });
      // Announced as business-service announces any change, so search drops it within seconds.
      await enqueueShardEvent(
        tx,
        this.plane.id(),
        createEvent({
          type: TOPICS.BUSINESSES_UPDATED,
          source: 'business-service',
          subject: businessId.toString(),
          data: {
            businessId: businessId.toString(),
            changedFields: ['deleted'],
            reverificationRequired: false,
            status: open.status,
          },
        }),
        'business',
      );
      return true;
    });
  }

  /** Give an account a picture link, as a sign-in provider would. */
  async providerPicture(userPublicId: string, url: string): Promise<boolean> {
    if (!/^https?:\/\/[\w.:-]+\/[\w./-]*$/.test(url)) throw new Error('not a plain picture link');
    return this.onUser(userPublicId, async (db, id) => {
      const { count } = await db.user.updateMany({ where: { id }, data: { avatarUrl: url } });
      return count > 0;
    });
  }

  /** Every session of this account started `minutes` ago (as if signed in long before). */
  async signedInAgo(userPublicId: string, minutes: number): Promise<boolean> {
    if (!Number.isInteger(minutes) || minutes < 1) throw new Error('not a number of minutes');
    return this.onUser(
      userPublicId,
      async (db, id) =>
        (await db.$executeRaw`UPDATE refresh_tokens SET created_at = created_at - make_interval(mins => ${minutes})
          WHERE user_id = ${id}`) > 0,
    );
  }

  /** Has this account asked to be deleted? */
  async deletionRequested(userPublicId: string): Promise<boolean> {
    return this.onUser(userPublicId, async (db, id) => {
      const u = await db.user.findUnique({ where: { id }, select: { deletedAt: true } });
      return u?.deletedAt != null;
    });
  }

  private async onUser(
    userPublicId: string,
    work: (db: Awaited<ReturnType<DataPlane['user']>>, id: bigint) => Promise<boolean>,
  ): Promise<boolean> {
    const id = await this.plane.idOfPublic('user', userPublicId);
    return id ? work(await this.plane.user(id), id) : false;
  }
}

/** The command line: one command, its answer as JSON on stdout. */
const COMMANDS: Record<string, (dev: DevWorld, args: string[]) => Promise<unknown>> = {
  ping: () => Promise.resolve(true),
  'visit-happened': (dev, [b, a, days]) => dev.visitHappened(b!, a!, days ? Number(days) : undefined),
  // Starts `minutes` from now (negative: started that long ago); `endsIn` minutes, if given.
  'move-visit': (dev, [b, a, minutes, endsIn]) =>
    dev.moveVisit(b!, a!, {
      startAt: new Date(Date.now() + Number(minutes) * 60_000),
      ...(endsIn !== undefined && { endAt: new Date(Date.now() + Number(endsIn) * 60_000) }),
    }),
  'visit-status': async (dev, [b, a]) => (await dev.visit(b!, a!))?.status ?? null,
  'review-reported': (dev, [b, r, reason]) => dev.reviewReported(b!, r!, reason ?? 'fake'),
  'close-business': (dev, [b]) => dev.closeBusiness(b!),
  'provider-picture': (dev, [u, url]) => dev.providerPicture(u!, url!),
  'signed-in-ago': (dev, [u, minutes]) => dev.signedInAgo(u!, Number(minutes)),
  'deletion-requested': (dev, [u]) => dev.deletionRequested(u!),
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...args] = process.argv.slice(2);
  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    console.error(`usage: dev-world.ts <${Object.keys(COMMANDS).join(' | ')}> …`);
    process.exit(2);
  }
  const dev = await DevWorld.open();
  try {
    console.log(JSON.stringify(await run(dev, args)));
  } finally {
    await dev.close();
  }
}
