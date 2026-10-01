import {
  createHttpApp,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { Database } from '@buku/database';
import type { MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { AppointmentService } from './appointments/appointment-service.js';
import { AvailabilityService } from './availability/availability-service.js';
import { CatalogService } from './catalog/catalog-service.js';
import { registerRoutes } from './routes/index.js';
import { ScheduleService } from './schedules/schedule-service.js';
import { SettingsService } from './settings/settings-service.js';
import { AttendanceService } from './staff/attendance-service.js';
import { StaffService } from './staff/staff-service.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BookingAppDeps {
  db: Database;
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
}

export function buildBookingApp(deps: BookingAppDeps): BookingApp {
  const settings = new SettingsService(deps.db);
  const catalog = new CatalogService(deps.db, settings);
  const staff = new StaffService(deps.db, deps.mediaLinks);
  const schedules = new ScheduleService(deps.db);
  const availability = new AvailabilityService(deps.db, settings);
  const appointments = new AppointmentService(deps.db, availability, settings);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        availability,
        appointments,
        catalog,
        attendance: new AttendanceService(deps.db),
        staff,
        schedules,
        settings,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, staff };
}
