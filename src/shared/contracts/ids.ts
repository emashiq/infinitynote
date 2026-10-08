import { z } from 'zod';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Canonical lower-case UUID. */
export const Uuid = z.string().regex(UUID_RE, 'Expected a lower-case UUID');
export type UuidString = z.infer<typeof Uuid>;
