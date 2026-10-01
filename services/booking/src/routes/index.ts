import {
  authenticate,
  rateLimit,
  requireAuth,
  sendCreated,
  sendNoContent,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express, type Response } from 'express';
import type { Redis } from 'ioredis';
import type { AppointmentService } from '../appointments/appointment-service.js';
import type { AvailabilityService } from '../availability/availability-service.js';
import type { CatalogService } from '../catalog/catalog-service.js';
import { requestContext } from '../http/context.js';
import type { ScheduleService } from '../schedules/schedule-service.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { StaffService } from '../staff/staff-service.js';
import {
  AppointmentParams,
  AvailabilityQuery,
  BookBody,
  BookingSettingsBody,
  BusinessAppointmentParams,
  BusinessAppointmentsQuery,
  BusinessCancelBody,
  CancelBody,
  DeclineBody,
  MyAppointmentsQuery,
  RescheduleBody,
  CategoryBody,
  CategoryParams,
  ClosureBody,
  ClosureParams,
  HoursBody,
  IdOrSlugParams,
  IdParams,
  ServiceBody,
  ServiceParams,
  StaffBody,
  StaffParams,
  TimeOffBody,
  TimeOffParams,
  UpdateCategoryBody,
  UpdateServiceBody,
  UpdateStaffBody,
} from './schemas.js';

export interface RouteDeps {
  availability: AvailabilityService;
  appointments: AppointmentService;
  catalog: CatalogService;
  staff: StaffService;
  schedules: ScheduleService;
  settings: SettingsService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
}

/** Public pages may be cached briefly by browsers and the CDN. */
const publicCache = (res: Response) => res.setHeader('Cache-Control', 'public, max-age=60');

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:booking:write',
    points: 60,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const r = Router();

  // ── Public: the menu and the team ────────────────────────────────────────
  r.get(
    '/:idOrSlug/services',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      publicCache(res);
      sendSuccess(res, await deps.catalog.publicMenu(params.idOrSlug));
    }),
  );
  r.get(
    '/:idOrSlug/staff',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      publicCache(res);
      sendSuccess(res, await deps.staff.publicList(params.idOrSlug));
    }),
  );

  // Free times are computed per request: limit how often one client can ask.
  const availabilityLimit = rateLimit({
    keyPrefix: 'rl:booking:availability',
    points: 60,
    durationSeconds: 60,
    redis: deps.redis,
  });
  r.get(
    '/:idOrSlug/availability',
    availabilityLimit,
    validated({ params: IdOrSlugParams, query: AvailabilityQuery }, async ({ params, query }, _req, res) => {
      res.setHeader('Cache-Control', 'no-store'); // times change with every booking
      sendSuccess(res, await deps.availability.publicAvailability(params.idOrSlug, query));
    }),
  );

  // ── Team views (archived and inactive included) ──────────────────────────
  r.get(
    '/:id/services/manage',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.catalog.manageMenu(params.id, requireAuth(req).userId));
    }),
  );
  r.get(
    '/:id/staff/manage',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.staff.manageList(params.id, requireAuth(req).userId));
    }),
  );

  // ── Menu: categories and services ────────────────────────────────────────
  r.post(
    '/:id/service-categories',
    auth,
    writeLimit,
    validated({ params: IdParams, body: CategoryBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.catalog.createCategory(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.patch(
    '/:id/service-categories/:categoryId',
    auth,
    writeLimit,
    validated({ params: CategoryParams, body: UpdateCategoryBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.catalog.updateCategory(
          params.id,
          params.categoryId,
          requireAuth(req).userId,
          body,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/service-categories/:categoryId',
    auth,
    writeLimit,
    validated({ params: CategoryParams }, async ({ params }, req, res) => {
      await deps.catalog.deleteCategory(
        params.id,
        params.categoryId,
        requireAuth(req).userId,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );
  r.post(
    '/:id/services',
    auth,
    writeLimit,
    validated({ params: IdParams, body: ServiceBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.catalog.createService(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.patch(
    '/:id/services/:serviceId',
    auth,
    writeLimit,
    validated({ params: ServiceParams, body: UpdateServiceBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.catalog.updateService(
          params.id,
          params.serviceId,
          requireAuth(req).userId,
          body,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/services/:serviceId',
    auth,
    writeLimit,
    validated({ params: ServiceParams }, async ({ params }, req, res) => {
      await deps.catalog.archiveService(
        params.id,
        params.serviceId,
        requireAuth(req).userId,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  // ── Staff profiles ───────────────────────────────────────────────────────
  r.post(
    '/:id/staff',
    auth,
    writeLimit,
    validated({ params: IdParams, body: StaffBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.staff.create(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.patch(
    '/:id/staff/:staffId',
    auth,
    writeLimit,
    validated({ params: StaffParams, body: UpdateStaffBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.staff.update(
          params.id,
          params.staffId,
          requireAuth(req).userId,
          body,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/staff/:staffId',
    auth,
    writeLimit,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      await deps.staff.deactivate(params.id, params.staffId, requireAuth(req).userId, requestContext(req));
      sendNoContent(res);
    }),
  );

  // ── Working hours and time off (employees: their own) ────────────────────
  r.get(
    '/:id/staff/:staffId/hours',
    auth,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.schedules.getHours(params.id, params.staffId, requireAuth(req).userId));
    }),
  );
  r.put(
    '/:id/staff/:staffId/hours',
    auth,
    writeLimit,
    validated({ params: StaffParams, body: HoursBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.schedules.setHours(
          params.id,
          params.staffId,
          requireAuth(req).userId,
          body.days,
          requestContext(req),
        ),
      );
    }),
  );
  r.get(
    '/:id/staff/:staffId/time-off',
    auth,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.schedules.listTimeOff(params.id, params.staffId, requireAuth(req).userId));
    }),
  );
  r.post(
    '/:id/staff/:staffId/time-off',
    auth,
    writeLimit,
    validated({ params: StaffParams, body: TimeOffBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.schedules.addTimeOff(
          params.id,
          params.staffId,
          requireAuth(req).userId,
          body,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/staff/:staffId/time-off/:entryId',
    auth,
    writeLimit,
    validated({ params: TimeOffParams }, async ({ params }, req, res) => {
      await deps.schedules.removeTimeOff(
        params.id,
        params.staffId,
        params.entryId,
        requireAuth(req).userId,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  // ── Business closures ────────────────────────────────────────────────────
  r.get(
    '/:id/closures',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.schedules.listClosures(params.id, requireAuth(req).userId));
    }),
  );
  r.post(
    '/:id/closures',
    auth,
    writeLimit,
    validated({ params: IdParams, body: ClosureBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.schedules.addClosure(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.delete(
    '/:id/closures/:closureId',
    auth,
    writeLimit,
    validated({ params: ClosureParams }, async ({ params }, req, res) => {
      await deps.schedules.removeClosure(
        params.id,
        params.closureId,
        requireAuth(req).userId,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  // ── Booking settings ─────────────────────────────────────────────────────
  r.get(
    '/:id/booking-settings',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.settings.get(params.id, requireAuth(req).userId));
    }),
  );
  r.put(
    '/:id/booking-settings',
    auth,
    writeLimit,
    validated({ params: IdParams, body: BookingSettingsBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.settings.update(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );

  // ── The business's appointments ──────────────────────────────────────────
  r.get(
    '/:id/appointments',
    auth,
    validated({ params: IdParams, query: BusinessAppointmentsQuery }, async ({ params, query }, req, res) => {
      sendSuccess(res, await deps.appointments.businessList(params.id, requireAuth(req).userId, query));
    }),
  );
  r.get(
    '/:id/appointments/:appointmentId',
    auth,
    validated({ params: BusinessAppointmentParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.businessAppointment(params.id, params.appointmentId, requireAuth(req).userId),
      );
    }),
  );
  r.post(
    '/:id/appointments/:appointmentId/confirm',
    auth,
    writeLimit,
    validated({ params: BusinessAppointmentParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.confirm(
          params.id,
          params.appointmentId,
          requireAuth(req).userId,
          requestContext(req),
        ),
      );
    }),
  );
  r.post(
    '/:id/appointments/:appointmentId/decline',
    auth,
    writeLimit,
    validated(
      { params: BusinessAppointmentParams, body: DeclineBody },
      async ({ params, body }, req, res) => {
        sendSuccess(
          res,
          await deps.appointments.decline(
            params.id,
            params.appointmentId,
            requireAuth(req).userId,
            body.reason,
            requestContext(req),
          ),
        );
      },
    ),
  );
  r.post(
    '/:id/appointments/:appointmentId/cancel',
    auth,
    writeLimit,
    validated(
      { params: BusinessAppointmentParams, body: BusinessCancelBody },
      async ({ params, body }, req, res) => {
        sendSuccess(
          res,
          await deps.appointments.cancelByBusiness(
            params.id,
            params.appointmentId,
            requireAuth(req).userId,
            body.reason,
            requestContext(req),
          ),
        );
      },
    ),
  );

  app.use('/v1/businesses', r);

  // ── The customer's appointments and receipts ─────────────────────────────
  const mine = Router();
  mine.use(auth);
  const bookLimit = rateLimit({
    keyPrefix: 'rl:booking:book',
    points: 20,
    durationSeconds: 3600,
    redis: deps.redis,
  });

  mine.post(
    '/',
    bookLimit,
    validated({ body: BookBody }, async ({ body }, req, res) => {
      const { userId, role } = requireAuth(req);
      sendCreated(res, await deps.appointments.book(userId, role, body, requestContext(req)));
    }),
  );
  mine.get(
    '/',
    validated({ query: MyAppointmentsQuery }, async ({ query }, req, res) => {
      const { items, meta } = await deps.appointments.myAppointments(
        requireAuth(req).userId,
        query.scope,
        query.page,
        query.limit,
      );
      sendSuccess(res, items, 200, meta);
    }),
  );
  mine.get(
    '/:id',
    validated({ params: AppointmentParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.appointments.myAppointment(requireAuth(req).userId, params.id));
    }),
  );
  mine.post(
    '/:id/cancel',
    writeLimit,
    validated({ params: AppointmentParams, body: CancelBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.cancelMine(requireAuth(req).userId, params.id, body, requestContext(req)),
      );
    }),
  );
  mine.post(
    '/:id/reschedule',
    bookLimit,
    validated({ params: AppointmentParams, body: RescheduleBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.rescheduleMine(requireAuth(req).userId, params.id, body, requestContext(req)),
      );
    }),
  );
  app.use('/v1/appointments', mine);
}
