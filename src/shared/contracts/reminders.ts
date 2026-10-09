import { z } from 'zod';
import { isValidLocalDate } from '../time/resolve';
import { SNOOZE_PRESETS } from '../time/snooze';
import { HomeScope } from './home';
import { Uuid } from './ids';

/** Reminder limits (plan section 6.1). */
export const MAX_REMINDERS_PER_NOTE = 200;
export const UNDO_DELETE_MS = 10_000;
export const VIEW_LIMIT = 200;
export const COMPLETED_VIEW_DAYS = 30;
export const HOME_REMINDER_LIMIT = 5;
export const ALERT_ITEMS_LIMIT = 3;
export const MAX_ZONES = 700;

export const FOLLOWUP_INTERVALS = [5, 10, 15, 30, 60] as const;
export const FOLLOWUP_MAX_COUNTS = [1, 2, 3, 5] as const;

/** User-facing reminder messages (plan section 10). */
export const REMINDER_MESSAGES = {
  chooseZone: 'Choose a time zone from the list',
  past: 'This time has already passed',
  blockMissing: 'This part of the note is not saved yet',
  plainBlock: 'Plain-text notes can only have note-level reminders',
  notDue: 'This reminder is not due yet',
  cannotSnooze: 'This reminder can no longer be snoozed',
  replaced: 'This reminder was replaced by an edit',
  undoExpired: 'Undo is no longer available',
  conflict: 'This reminder changed elsewhere. Reopen it to edit.',
  limit: `A note can have at most ${MAX_REMINDERS_PER_NOTE} reminders.`,
  missing: 'This reminder no longer exists',
  noteMissing: 'This note no longer exists',
  startupSetting: 'Could not change the startup setting',
  blockGone: 'The linked paragraph is no longer in this note.',
  unsupported: 'Not supported by this desktop',
  sourceMismatch: 'The note text changed. Try again.',
  sourceNotSaved: 'The note could not be saved. Try again.',
  sourceFormat: 'This phrase does not belong to this note.',
  referenceRange: 'The phrase was read too long ago. Read it again.',
  noSource: 'This reminder was not created from note text.',
} as const;

/** "1 reminder is overdue" / "N reminders are overdue" (summary notification and banners). */
export function overdueText(count: number): string {
  return count === 1 ? '1 reminder is overdue' : `${count} reminders are overdue`;
}

// Fields -----------------------------------------------------------------------------------
/** IANA zone name; membership in the app's zone list is checked in main (D-079). */
export const ZoneId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/);
export const LocalDate = z.string().refine(isValidLocalDate, 'Expected a date YYYY-MM-DD between 2000 and 2100');
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const Weekdays = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique')
  .transform((days) => [...days].sort((a, b) => a - b));
export const Recurrence = z
  .discriminatedUnion('freq', [z.strictObject({ freq: z.literal('daily') }), z.strictObject({ freq: z.literal('weekly'), byWeekday: Weekdays })])
  .nullable();
export type RecurrenceType = z.infer<typeof Recurrence>;

export const FollowupInterval = z.literal(FOLLOWUP_INTERVALS);
export const FollowupMax = z.literal(FOLLOWUP_MAX_COUNTS);
export const Followup = z.strictObject({ intervalMinutes: FollowupInterval, maxFollowups: FollowupMax }).nullable();
export type FollowupType = z.infer<typeof Followup>;

export const FoldPreference = z.enum(['earlier', 'later']);

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export const ReminderTitle = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((t) => !CONTROL_RE.test(t), 'Title must not contain control characters');

export const ReminderInput = z.strictObject({
  blockId: Uuid.nullable(),
  title: ReminderTitle,
  zoneId: ZoneId,
  date: LocalDate,
  time: LocalTime,
  recurrence: Recurrence,
  foldPreference: FoldPreference.default('earlier'),
  followup: Followup,
  allowPast: z.boolean().default(false),
});
export type ReminderInputType = z.infer<typeof ReminderInput>;

// Requests -----------------------------------------------------------------------------------
export const ReminderCreateRequest = ReminderInput.extend({ noteId: Uuid });
export type ReminderCreateRequestType = z.infer<typeof ReminderCreateRequest>;
export const PendingPolicy = z.enum(['keep', 'complete']);
export const ReminderUpdateRequest = ReminderInput.extend({
  reminderId: Uuid,
  expectedRevision: z.number().int().min(1),
  pendingPolicy: PendingPolicy.default('keep'),
});
export type ReminderUpdateRequestType = z.infer<typeof ReminderUpdateRequest>;
export const ReminderIdRequest = z.strictObject({ reminderId: Uuid });
export const ReminderListForNoteRequest = z.strictObject({ noteId: Uuid });
export const ReminderView = z.enum(['today', 'upcoming', 'overdue', 'completed']);
export type ReminderViewType = z.infer<typeof ReminderView>;
export const RemindersListViewRequest = z.strictObject({ view: ReminderView, scope: HomeScope.default({ kind: 'all' }) });
export const RemindersSummaryRequest = z.strictObject({ scope: HomeScope });
export const OccurrenceIdRequest = z.strictObject({ occurrenceId: Uuid });
export const SnoozePreset = z.literal(SNOOZE_PRESETS);
export type SnoozePresetType = z.infer<typeof SnoozePreset>;
export const OccurrenceSnoozeRequest = z.strictObject({ occurrenceId: Uuid, preset: SnoozePreset });

// Responses -----------------------------------------------------------------------------------
export const OccurrenceState = z.enum(['pending', 'snoozed', 'completed', 'missed', 'cancelled']);
export type OccurrenceStateType = z.infer<typeof OccurrenceState>;
export const DeliveryOutcome = z.enum(['dispatched', 'failed', 'unsupported', 'uncertain']);
export type DeliveryOutcomeType = z.infer<typeof DeliveryOutcome>;
export const AnchorState = z.enum(['ok', 'block_missing']);
const Ms = z.number().int();
const Count = z.number().int().min(0);

export const OccurrenceItem = z.strictObject({
  occurrenceId: Uuid,
  reminderId: Uuid,
  noteId: Uuid,
  blockId: Uuid.nullable(),
  anchorState: AnchorState,
  noteTitle: z.string().max(200),
  notePath: z.array(z.string()).max(66),
  title: z.string().min(1).max(200),
  zoneId: ZoneId,
  dueAtUtc: Ms,
  /** `YYYY-MM-DDTHH:mm` as asked for, in the reminder's zone. */
  localDateTime: z.string(),
  state: OccurrenceState,
  snoozedUntilUtc: Ms.nullable(),
  /** When it is next due: the snooze target while snoozed, else the due time. */
  effectiveAtUtc: Ms,
  overdue: z.boolean(),
  alertsSent: Count,
  followupsSent: Count,
  /** How the series repeats ("Repeats daily" / "Repeats weekly"), or null for a one-time reminder (D-086). */
  repeat: z.enum(['daily', 'weekly']).nullable(),
  lastOutcome: DeliveryOutcome.nullable(),
  completedAt: Ms.nullable(),
});
export type OccurrenceItemType = z.infer<typeof OccurrenceItem>;

// Sources (Phase 06, D-088, D-092) ---------------------------------------------------------------
/** The literal phrase as written (not trimmed): 1-500 UTF-16 units, no control characters, so within one line. */
export const SourceText = z
  .string()
  .min(1)
  .max(500)
  .refine((t) => !CONTROL_RE.test(t), 'The phrase must not contain control characters')
  .refine((t) => /\S/.test(t), 'The phrase must not be blank');
export const SourceOrigin = z.enum(['suggestion', 'selection']);
export type SourceOriginType = z.infer<typeof SourceOrigin>;
export const SourceState = z.enum(['ok', 'changed', 'missing', 'detached']);
export type SourceStateType = z.infer<typeof SourceState>;
/** How many earlier occurrences of the same phrase the block (or a plain note's text) holds. */
export const SpanOrdinal = z.number().int().min(0).max(10_000);

/** Where a reminder came from: the phrase, its block (null for plain-text notes) and how it was read. */
export const ReminderSourceDto = z.strictObject({
  blockId: Uuid.nullable(),
  text: z.string().min(1).max(500),
  spanOrdinal: SpanOrdinal,
  origin: SourceOrigin,
  state: SourceState,
  referenceInstantUtc: z.number().int(),
  referenceZone: ZoneId,
});
export type ReminderSourceDtoType = z.infer<typeof ReminderSourceDto>;

export const ResolutionStatus = z.enum(['ok', 'gap', 'fold']);
export const ReminderDto = z.strictObject({
  id: Uuid,
  noteId: Uuid,
  blockId: Uuid.nullable(),
  anchorState: AnchorState,
  title: z.string().min(1).max(200),
  zoneId: ZoneId,
  date: LocalDate,
  time: LocalTime,
  recurrence: Recurrence,
  foldPreference: FoldPreference,
  followup: Followup,
  revision: z.number().int().min(1),
  createdAt: Ms,
  updatedAt: Ms,
  resolution: z.strictObject({ status: ResolutionStatus }),
  /** The open occurrence that is due first, else the latest completed one. */
  current: OccurrenceItem.nullable(),
  /** The phrase the reminder was created from (Phase 06), or null for a reminder entered by hand. */
  source: ReminderSourceDto.nullable(),
});
export type ReminderDtoType = z.infer<typeof ReminderDto>;

export const ReminderListResponse = z.strictObject({
  reminders: z.array(ReminderDto).max(MAX_REMINDERS_PER_NOTE),
  asOf: Ms,
  displayZone: ZoneId.nullable(),
});
export type ReminderListResponseType = z.infer<typeof ReminderListResponse>;

export const ReminderCounts = z.strictObject({ today: Count, upcoming: Count, overdue: Count });
export type ReminderCountsType = z.infer<typeof ReminderCounts>;
export const ReminderViewResponse = z.strictObject({
  view: ReminderView,
  asOf: Ms,
  /** The zone days are counted in; null when the computer's zone is unknown (days then use UTC, disclosed). */
  displayZone: ZoneId.nullable(),
  items: z.array(OccurrenceItem).max(VIEW_LIMIT),
  counts: ReminderCounts,
});
export type ReminderViewResponseType = z.infer<typeof ReminderViewResponse>;

export const RemindersSummaryResponse = z.strictObject({
  asOf: Ms,
  displayZone: ZoneId.nullable(),
  overdue: z.array(OccurrenceItem).max(HOME_REMINDER_LIMIT),
  overdueTotal: Count,
  today: z.array(OccurrenceItem).max(HOME_REMINDER_LIMIT),
  todayTotal: Count,
});
export type RemindersSummaryResponseType = z.infer<typeof RemindersSummaryResponse>;

export const ZonesListResponse = z.strictObject({
  zones: z.array(ZoneId).max(MAX_ZONES),
  systemZone: ZoneId.nullable(),
  defaultZone: ZoneId.nullable(),
  asOf: Ms,
});
export type ZonesListResponseType = z.infer<typeof ZonesListResponse>;

export const ReminderDeleteResponse = z.strictObject({ reminderId: Uuid, undoUntil: Ms });

// Events -----------------------------------------------------------------------------------
export const ReminderChangedReasons = ['created', 'updated', 'deleted', 'restored', 'completed', 'snoozed', 'alerted', 'anchor', 'suspended', 'zone', 'settings'] as const;
export const ReminderChangedEvent = z.strictObject({ reason: z.enum(ReminderChangedReasons), noteIds: z.array(Uuid).max(1000) });
export type ReminderChangedEventType = z.infer<typeof ReminderChangedEvent>;

export const ReminderAlertEvent = z.strictObject({
  batchId: Uuid,
  outcome: DeliveryOutcome,
  presentation: z.enum(['single', 'summary']),
  total: z.number().int().min(1),
  items: z.array(OccurrenceItem).max(ALERT_ITEMS_LIMIT),
});
export type ReminderAlertEventType = z.infer<typeof ReminderAlertEvent>;

export const AppOpenRemindersEvent = z.strictObject({ view: ReminderView });
export type AppOpenRemindersEventType = z.infer<typeof AppOpenRemindersEvent>;
