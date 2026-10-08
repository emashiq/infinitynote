import type { ErrorCode } from '../../shared/contracts/envelope';

/** An expected failure that reaches the renderer as `{ok:false, error:{code, message, details}}`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/** The message of any thrown value, for logs and reports. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The stack (or message) of any thrown value, for logs. */
export function errorDetail(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
