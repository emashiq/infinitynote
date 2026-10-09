import { DAY_MS } from '../../shared/versions/retention';

/** Fixed retention rules besides the user's settings (D-034, D-099, F-03-4). */
export const MAX_OPEN_LEASE_LOST_DRAFTS = 20;
export const RESOLVED_DRAFT_KEEP_MS = 30 * DAY_MS;
/** An unreferenced attachment file is deleted only after this grace period (INF-PORT-08). */
export const ATTACHMENT_GC_GRACE_MS = 7 * DAY_MS;
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
