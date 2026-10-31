import {
  AppError,
  authenticate,
  ErrorCodes,
  rateLimit,
  requireActor,
  requireRole,
  sendCreated,
  sendNoContent,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express, type Response } from 'express';
import type { DataPlane } from '@buku/database';
import type { Redis } from 'ioredis';
import type { AppointmentService } from '../appointments/appointment-service.js';
import type { AvailabilityService } from '../availability/availability-service.js';
import type { CatalogService } from '../catalog/catalog-service.js';
import { requestContext } from '../http/context.js';
import type { CancellationReport } from '../reputation/cancellation-report.js';
import { myReliability } from '../reputation/reliability.js';
import type { ReviewService } from '../reviews/review-service.js';
import type { ScheduleService } from '../schedules/schedule-service.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { AttendanceService } from '../staff/attendance-service.js';
import type { StaffService } from '../staff/staff-service.js';
import {
  AdminReviewParams,
  AppointmentParams,
  AttendanceQuery,
  BusinessReviewsQuery,
  ReportQuery,
  ModerateReviewBody,
  ReportReviewBody,
  ReviewBody,
  ReviewParams,
  ReviewResponseBody,
  CheckInByCodeBody,
  ClockInBody,
  CorrectShiftBody,
  ShiftParams,
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
  attendance: AttendanceService;
  staff: StaffService;
  schedules: ScheduleService;
  settings: SettingsService;
  reviews: ReviewService;
  report: CancellationReport;
  plane: DataPlane;
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
  /** The business in the URL, by its public ID (DB-042): unknown is "not found". */
  const businessOf = async (publicId: string) => {
    const id = await deps.plane.idOfPublic('business', publicId);
    if (id === null) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return id;
  };

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

  // ── Reviews: public list (with the rating summary), the team's reply and reports ──
  r.get(
    '/:idOrSlug/reviews',
    validated(
      { params: IdOrSlugParams, query: BusinessReviewsQuery },
      async ({ params, query }, _req, res) => {
        publicCache(res);
        const { items, meta } = await deps.reviews.forBusiness(params.idOrSlug, query);
        sendSuccess(res, items, 200, meta);
      },
    ),
  );
  r.put(
    '/:id/reviews/:reviewId/response',
    auth,
    writeLimit,
    deps.plane.switches.guard('reviews'),
    validated({ params: ReviewParams, body: ReviewResponseBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.reviews.respond(
          await businessOf(params.id),
          params.reviewId,
          requireActor(req),
          body.text,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/reviews/:reviewId/response',
    auth,
    writeLimit,
    validated({ params: ReviewParams }, async ({ params }, req, res) => {
      await deps.reviews.removeResponse(
        await businessOf(params.id),
        params.reviewId,
        requireActor(req),
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );
  r.post(
    '/:id/reviews/:reviewId/report',
    auth,
    writeLimit,
    validated({ params: ReviewParams, body: ReportReviewBody }, async ({ params, body }, req, res) => {
      await deps.reviews.report(
        await businessOf(params.id),
        params.reviewId,
        requireActor(req),
        body,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  // ── Insights: cancellations and no-shows (owner, managers) ────────────────
  r.get(
    '/:id/insights/cancellations',
    auth,
    validated({ params: IdParams, query: ReportQuery }, async ({ params, query }, req, res) => {
      sendSuccess(res, await deps.report.build(await businessOf(params.id), requireActor(req), query));
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
      sendSuccess(res, await deps.catalog.manageMenu(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.get(
    '/:id/staff/manage',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.staff.manageList(await businessOf(params.id), requireActor(req)));
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
        await deps.catalog.createCategory(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
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
          await businessOf(params.id),
          params.categoryId,
          requireActor(req),
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
        await businessOf(params.id),
        params.categoryId,
        requireActor(req),
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
        await deps.catalog.createService(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
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
          await businessOf(params.id),
          params.serviceId,
          requireActor(req),
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
        await businessOf(params.id),
        params.serviceId,
        requireActor(req),
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
        await deps.staff.create(await businessOf(params.id), requireActor(req), body, requestContext(req)),
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
          await businessOf(params.id),
          params.staffId,
          requireActor(req),
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
      await deps.staff.deactivate(
        await businessOf(params.id),
        params.staffId,
        requireActor(req),
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  // ── Working hours and time off (employees: their own) ────────────────────
  r.get(
    '/:id/staff/:staffId/hours',
    auth,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.schedules.getHours(await businessOf(params.id), params.staffId, requireActor(req)),
      );
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
          await businessOf(params.id),
          params.staffId,
          requireActor(req),
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
      sendSuccess(
        res,
        await deps.schedules.listTimeOff(await businessOf(params.id), params.staffId, requireActor(req)),
      );
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
          await businessOf(params.id),
          params.staffId,
          requireActor(req),
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
        await businessOf(params.id),
        params.staffId,
        params.entryId,
        requireActor(req),
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
      sendSuccess(res, await deps.schedules.listClosures(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.post(
    '/:id/closures',
    auth,
    writeLimit,
    validated({ params: IdParams, body: ClosureBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.schedules.addClosure(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/closures/:closureId',
    auth,
    writeLimit,
    validated({ params: ClosureParams }, async ({ params }, req, res) => {
      await deps.schedules.removeClosure(
        await businessOf(params.id),
        params.closureId,
        requireActor(req),
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
      sendSuccess(res, await deps.settings.get(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.put(
    '/:id/booking-settings',
    auth,
    writeLimit,
    validated({ params: IdParams, body: BookingSettingsBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.settings.update(await businessOf(params.id), requireActor(req), body, requestContext(req)),
      );
    }),
  );

  // ── The business's appointments ──────────────────────────────────────────
  r.get(
    '/:id/appointments',
    auth,
    validated({ params: IdParams, query: BusinessAppointmentsQuery }, async ({ params, query }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.businessList(await businessOf(params.id), requireActor(req), query),
      );
    }),
  );
  r.get(
    '/:id/appointments/:appointmentId',
    auth,
    validated({ params: BusinessAppointmentParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.businessAppointment(
          await businessOf(params.id),
          params.appointmentId,
          requireActor(req),
        ),
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
          await businessOf(params.id),
          params.appointmentId,
          requireActor(req),
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
            await businessOf(params.id),
            params.appointmentId,
            requireActor(req),
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
            await businessOf(params.id),
            params.appointmentId,
            requireActor(req),
            body.reason,
            requestContext(req),
          ),
        );
      },
    ),
  );

  // ── At the venue: customers arriving, visits done, no-shows ──────────────
  r.post(
    '/:id/check-in',
    auth,
    writeLimit,
    validated({ params: IdParams, body: CheckInByCodeBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.checkIn(
          await businessOf(params.id),
          { code: body.code },
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  for (const [action, method] of [
    ['check-in', 'checkIn'],
    ['complete', 'complete'],
    ['no-show', 'noShow'],
  ] as const) {
    r.post(
      `/:id/appointments/:appointmentId/${action}`,
      auth,
      writeLimit,
      validated({ params: BusinessAppointmentParams }, async ({ params }, req, res) => {
        const ctx = requestContext(req);
        const actor = requireActor(req);
        sendSuccess(
          res,
          method === 'checkIn'
            ? await deps.appointments.checkIn(
                await businessOf(params.id),
                { publicId: params.appointmentId },
                actor,
                ctx,
              )
            : await deps.appointments[method](await businessOf(params.id), params.appointmentId, actor, ctx),
        );
      }),
    );
  }

  // ── Employee shifts ──────────────────────────────────────────────────────
  r.post(
    '/:id/staff/:staffId/attendance/check-in',
    auth,
    writeLimit,
    validated({ params: StaffParams, body: ClockInBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.attendance.clockIn(
          await businessOf(params.id),
          params.staffId,
          requireActor(req),
          body.note,
        ),
      );
    }),
  );
  r.post(
    '/:id/staff/:staffId/attendance/check-out',
    auth,
    writeLimit,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.attendance.clockOut(await businessOf(params.id), params.staffId, requireActor(req)),
      );
    }),
  );
  r.get(
    '/:id/attendance',
    auth,
    validated({ params: IdParams, query: AttendanceQuery }, async ({ params, query }, req, res) => {
      sendSuccess(res, await deps.attendance.list(await businessOf(params.id), requireActor(req), query));
    }),
  );
  r.get(
    '/:id/attendance/present',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.attendance.present(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.patch(
    '/:id/attendance/:shiftId',
    auth,
    writeLimit,
    validated({ params: ShiftParams, body: CorrectShiftBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.attendance.correct(
          await businessOf(params.id),
          params.shiftId,
          requireActor(req),
          body,
          requestContext(req),
        ),
      );
    }),
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
    deps.plane.switches.guard('bookings'),
    validated({ body: BookBody }, async ({ body }, req, res) => {
      sendCreated(res, await deps.appointments.book(requireActor(req), body, requestContext(req)));
    }),
  );
  mine.get(
    '/',
    validated({ query: MyAppointmentsQuery }, async ({ query }, req, res) => {
      const { items, meta } = await deps.appointments.myAppointments(
        requireActor(req).id,
        query.scope,
        query.page,
        query.limit,
      );
      sendSuccess(res, items, 200, meta);
    }),
  );
  // How reliable I am, as businesses see it — and what it's made of (D-078).
  mine.get('/reliability', async (req, res) => {
    sendSuccess(res, await myReliability(deps.plane, requireActor(req).id));
  });
  // My reviews (before /:id so "reviews" isn't read as an id).
  mine.get(
    '/reviews',
    validated(
      { query: MyAppointmentsQuery.pick({ page: true, limit: true }) },
      async ({ query }, req, res) => {
        const { items, meta } = await deps.reviews.mine(requireActor(req).id, query.page, query.limit);
        sendSuccess(res, items, 200, meta);
      },
    ),
  );
  const reviewLimit = rateLimit({
    keyPrefix: 'rl:booking:review',
    points: 20,
    durationSeconds: 3600,
    redis: deps.redis,
  });
  mine.post(
    '/:id/review',
    reviewLimit,
    deps.plane.switches.guard('reviews'),
    validated({ params: AppointmentParams, body: ReviewBody }, async ({ params, body }, req, res) => {
      sendCreated(res, await deps.reviews.create(requireActor(req).id, params.id, body, requestContext(req)));
    }),
  );
  mine.patch(
    '/:id/review',
    reviewLimit,
    deps.plane.switches.guard('reviews'),
    validated({ params: AppointmentParams, body: ReviewBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.reviews.update(requireActor(req).id, params.id, body, requestContext(req)));
    }),
  );
  mine.delete(
    '/:id/review',
    writeLimit,
    validated({ params: AppointmentParams }, async ({ params }, req, res) => {
      await deps.reviews.remove(requireActor(req).id, params.id, requestContext(req));
      sendNoContent(res);
    }),
  );
  mine.get(
    '/:id',
    validated({ params: AppointmentParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.appointments.myAppointment(requireActor(req).id, params.id));
    }),
  );
  mine.post(
    '/:id/cancel',
    writeLimit,
    validated({ params: AppointmentParams, body: CancelBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.cancelMine(requireActor(req).id, params.id, body, requestContext(req)),
      );
    }),
  );
  mine.post(
    '/:id/reschedule',
    bookLimit,
    deps.plane.switches.guard('bookings'),
    validated({ params: AppointmentParams, body: RescheduleBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.appointments.rescheduleMine(requireActor(req).id, params.id, body, requestContext(req)),
      );
    }),
  );
  app.use('/v1/appointments', mine);

  // ── Platform admins: reported reviews ────────────────────────────────────
  const admin = Router();
  admin.use(auth, requireRole('super_admin'), writeLimit);
  admin.get(
    '/',
    validated(
      { query: MyAppointmentsQuery.pick({ page: true, limit: true }) },
      async ({ query }, _req, res) => {
        const { items, meta } = await deps.reviews.reported(query.page, query.limit);
        sendSuccess(res, items, 200, meta);
      },
    ),
  );
  admin.post(
    '/:reviewId/decision',
    validated({ params: AdminReviewParams, body: ModerateReviewBody }, async ({ params, body }, req, res) => {
      await deps.reviews.moderate(params.reviewId, requireActor(req).id, body, requestContext(req));
      sendNoContent(res);
    }),
  );
  app.use('/v1/admin/reviews', admin);
}
