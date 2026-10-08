import type { Db } from '../db/driver';
import { AppError, errorDetail } from './app-error';
import type { Logger } from './logger';

/** Runs fn in an immediate transaction; non-AppError failures are logged and become INTERNAL with nothing changed. */
export function runTx<T>(db: Db, logger: Logger | undefined, fn: () => T): T {
  try {
    return db.transaction(fn, 'immediate');
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger?.error(`transaction failed ${errorDetail(err)}`);
    throw new AppError('INTERNAL', 'Something went wrong');
  }
}
