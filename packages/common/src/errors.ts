/**
 * Canonical error codes shared by every BUKU service and client.
 * Clients branch on `code`, never on `message` (messages are for humans and may change).
 */
export const ErrorCodes = {
  // Generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // AuthN / AuthZ
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  /** A session was ended server-side; `details.reason` says why (password_changed, logged_out_everywhere, ...). */
  SESSION_REVOKED: 'SESSION_REVOKED',
  OAUTH_TOKEN_INVALID: 'OAUTH_TOKEN_INVALID',
  TERMS_NOT_ACCEPTED: 'TERMS_NOT_ACCEPTED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',

  // Identity
  USER_EXISTS: 'USER_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',

  // Booking
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  SLOT_IN_PAST: 'SLOT_IN_PAST',
  SLOT_TOO_SOON: 'SLOT_TOO_SOON',
  SLOT_TOO_FAR_AHEAD: 'SLOT_TOO_FAR_AHEAD',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  APPOINTMENT_NOT_FOUND: 'APPOINTMENT_NOT_FOUND',
  CANCELLATION_WINDOW_PASSED: 'CANCELLATION_WINDOW_PASSED',
  STALE_VERSION: 'STALE_VERSION',

  // Queue
  QUEUE_CLOSED: 'QUEUE_CLOSED',
  QUEUE_PAUSED: 'QUEUE_PAUSED',
  QUEUE_FULL: 'QUEUE_FULL',
  QUEUE_ALREADY_JOINED: 'QUEUE_ALREADY_JOINED',
  QUEUE_ENTRY_NOT_FOUND: 'QUEUE_ENTRY_NOT_FOUND',

  // Business
  BUSINESS_NOT_FOUND: 'BUSINESS_NOT_FOUND',
  BUSINESS_NOT_VERIFIED: 'BUSINESS_NOT_VERIFIED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',

  // Integrations
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

export interface AppErrorOptions {
  /** Machine-readable, safe-to-expose context (e.g. field-level validation issues). */
  details?: unknown;
  /** Underlying error. Logged server-side, NEVER sent to the client. */
  cause?: unknown;
}

/**
 * The only error type services should throw deliberately.
 *
 * - `message` and `details` are sent to the client, so they must never
 *   contain secrets, SQL, stack traces, or other users' data.
 * - Anything that is not an AppError is treated as an unexpected 500 and its
 *   message is hidden from the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(
    message: string,
    code: ErrorCode,
    httpStatus: number = HttpStatus.BAD_REQUEST,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options.details;
  }

  /** 4xx errors are the caller's fault and expected; 5xx are ours and must be investigated. */
  get isOperational(): boolean {
    return this.httpStatus < 500;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, ErrorCodes.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, { details });
  }
  static unauthorized(
    message = 'Authentication required',
    code: ErrorCode = ErrorCodes.UNAUTHORIZED,
  ): AppError {
    return new AppError(message, code, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(message, ErrorCodes.FORBIDDEN, HttpStatus.FORBIDDEN);
  }
  static notFound(resource = 'Resource', code: ErrorCode = ErrorCodes.NOT_FOUND): AppError {
    return new AppError(`${resource} not found`, code, HttpStatus.NOT_FOUND);
  }
  static conflict(message: string, code: ErrorCode = ErrorCodes.CONFLICT, details?: unknown): AppError {
    return new AppError(message, code, HttpStatus.CONFLICT, { details });
  }
  static rateLimited(retryAfterSeconds: number): AppError {
    return new AppError(
      'Too many requests, please slow down',
      ErrorCodes.RATE_LIMITED,
      HttpStatus.TOO_MANY_REQUESTS,
      {
        details: { retryAfterSeconds },
      },
    );
  }
  static internal(message = 'Internal server error', cause?: unknown): AppError {
    return new AppError(message, ErrorCodes.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, { cause });
  }
  static unavailable(message = 'Service temporarily unavailable', cause?: unknown): AppError {
    return new AppError(message, ErrorCodes.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, { cause });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
