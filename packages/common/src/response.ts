import type { Response } from 'express';
import { type AppError, HttpStatus } from './errors.js';

/**
 * Every BUKU HTTP response uses one of these two envelopes, so clients can
 * handle success and failure uniformly:
 *
 *   { "success": true,  "data": ..., "meta": { ... } }
 *   { "success": false, "error": { "code", "message", "details?", "requestId?" } }
 */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CursorMeta {
  limit: number;
  nextCursor: string | null;
}

export type ResponseMeta = Partial<PageMeta> & Partial<CursorMeta> & Record<string, unknown>;

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
}

export function successResponse<T>(data: T, meta?: ResponseMeta): SuccessEnvelope<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function errorResponse(err: AppError, requestId?: string): ErrorEnvelope {
  const body: ErrorBody = { code: err.code, message: err.message };
  if (err.details !== undefined) body.details = err.details;
  if (requestId) body.requestId = requestId;
  return { success: false, error: body };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status: number = HttpStatus.OK,
  meta?: ResponseMeta,
): void {
  res.status(status).json(successResponse(data, meta));
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, HttpStatus.CREATED);
}

export function sendNoContent(res: Response): void {
  res.status(HttpStatus.NO_CONTENT).end();
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
