export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'LEASE_REQUIRED',
  'CYCLE',
  'LIMIT_EXCEEDED',
  'UNSUPPORTED',
  'FORBIDDEN',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ErrorEnvelope };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string, details?: unknown): Result<never> {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}
