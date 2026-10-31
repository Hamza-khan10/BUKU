import {
  createHttpApp,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { AppointmentService } from './appointments/appointment-service.js';
import { ClaimSweeper } from './appointments/claim-sweeper.js';
import { PersonSync } from './appointments/person-sync.js';
import { AvailabilityService } from './availability/availability-service.js';
import { CatalogService } from './catalog/catalog-service.js';
import { registerRoutes } from './routes/index.js';
import { CancellationReport } from './reputation/cancellation-report.js';
import { ReviewService } from './reviews/review-service.js';
import { ScheduleService } from './schedules/schedule-service.js';
import { SettingsService } from './settings/settings-service.js';
import { AttendanceService } from './staff/attendance-service.js';
import { StaffService } from './staff/staff-service.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BookingAppDeps {
  /** Database v2 (D3): the directory, the shards, IDs — signed in as booking-service's own role. */
  plane: DataPlane;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  /** Links to staff photos (stored by business-service). */
  mediaLinks: MediaLinks;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export interface BookingApp {
  app: Express;
  /** Exposed for the event consumer (index.ts) and tests. */
  staff: StaffService;
  appointments: AppointmentService;
  /** The customer's side of each appointment (D3d), for the event consumer. */
  persons: PersonSync;
  /** Settles lapsed claims on people's shards; index.ts starts it. */
  sweeper: ClaimSweeper;
}

export function buildBookingApp(deps: BookingAppDeps): BookingApp {
  const { plane } = deps;
  const settings = new SettingsService(plane);
  const catalog = new CatalogService(plane);
  const staff = new StaffService(plane, deps.mediaLinks);
  const schedules = new ScheduleService(plane);
  const availability = new AvailabilityService(plane);
  const persons = new PersonSync(plane);
  const appointments = new AppointmentService(plane, persons);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        availability,
        appointments,
        catalog,
        attendance: new AttendanceService(plane),
        staff,
        schedules,
        settings,
        reviews: new ReviewService(plane),
        report: new CancellationReport(plane),
        plane,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, staff, appointments, persons, sweeper: new ClaimSweeper(plane, persons) };
}
