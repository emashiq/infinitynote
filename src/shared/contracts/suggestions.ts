import { z } from 'zod';
import { Uuid } from './ids';
import { LocalDate, PendingPolicy, ReminderDto, ReminderInput, SourceOrigin, SourceText, SpanOrdinal, ZoneId } from './reminders';

/**
 * Reminder suggestions (plan section 6.1, D-089). No request carries an instant: main resolves date, time and zone
 * itself and checks the phrase against the stored note text.
 */

const MAX_OFFSET = 5_000_000;

/** The phrase a reminder is created from: block and span for rich notes, neither for plain-text notes. */
export const SuggestionSource = z
  .strictObject({
    blockId: Uuid.nullable(),
    text: SourceText,
    spanStart: z.number().int().min(0).max(MAX_OFFSET).nullable(),
    spanEnd: z.number().int().min(1).max(MAX_OFFSET).nullable(),
    spanOrdinal: SpanOrdinal,
    referenceInstantUtc: z.number().int(),
    referenceZone: ZoneId,
    origin: SourceOrigin,
  })
  .refine((s) => (s.blockId === null) === (s.spanStart === null) && (s.spanStart === null) === (s.spanEnd === null), 'Block and span go together')
  .refine((s) => s.spanStart === null || s.spanEnd! - s.spanStart === s.text.length, 'Span length must match the text');
export type SuggestionSourceType = z.infer<typeof SuggestionSource>;

/** The reminder fields of a sourced reminder; its block is the source's block. */
const FromSourceInput = ReminderInput.omit({ blockId: true });

export const ReminderCreateFromSuggestionRequest = FromSourceInput.extend({ noteId: Uuid, source: SuggestionSource });
export type ReminderCreateFromSuggestionRequestType = z.infer<typeof ReminderCreateFromSuggestionRequest>;
export const ReminderCreateFromSuggestionResponse = z.strictObject({ reminder: ReminderDto, existing: z.boolean() });
export type ReminderCreateFromSuggestionResponseType = z.infer<typeof ReminderCreateFromSuggestionResponse>;

export const ReminderUpdateFromSourceRequest = z.discriminatedUnion('action', [
  FromSourceInput.extend({
    action: z.literal('apply'),
    reminderId: Uuid,
    expectedRevision: z.number().int().min(1),
    pendingPolicy: PendingPolicy.default('keep'),
    source: SuggestionSource,
  }),
  z.strictObject({ action: z.literal('keep'), reminderId: Uuid }),
]);
export type ReminderUpdateFromSourceRequestType = z.infer<typeof ReminderUpdateFromSourceRequest>;
export type ReminderApplySourceRequestType = Extract<ReminderUpdateFromSourceRequestType, { action: 'apply' }>;

export const SuggestionDismissRequest = z.strictObject({ noteId: Uuid, blockId: Uuid.nullable(), text: SourceText, spanOrdinal: SpanOrdinal, referenceDate: LocalDate });
export type SuggestionDismissRequestType = z.infer<typeof SuggestionDismissRequest>;
export const DismissalDto = z.strictObject({
  blockId: Uuid.nullable(),
  /** The normalized phrase (normalizePhrase). */
  text: z.string().min(1).max(500),
  spanOrdinal: SpanOrdinal,
  referenceDate: LocalDate,
  createdAt: z.number().int(),
});
export type DismissalDtoType = z.infer<typeof DismissalDto>;
export const SuggestionDismissResponse = z.strictObject({ dismissal: DismissalDto });

export const SuggestionListDismissedRequest = z.strictObject({ noteId: Uuid });
export const SuggestionListDismissedResponse = z.strictObject({
  /** Main's reminder clock: the reference instant of detection (frozen under the E2E clock seam). */
  asOf: z.number().int(),
  systemZone: ZoneId.nullable(),
  /** The default zone setting, else the computer's zone. */
  defaultZone: ZoneId.nullable(),
  dismissals: z.array(DismissalDto).max(500),
});
export type SuggestionListDismissedResponseType = z.infer<typeof SuggestionListDismissedResponse>;
