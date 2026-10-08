import { AppError } from '../../services/app-error';

/** Resolves a service getter or throws the storage-unavailable error used when the database failed to open. */
export function need<T>(get: () => T | null): T {
  const value = get();
  if (!value) throw new AppError('INTERNAL', 'Storage is unavailable');
  return value;
}
