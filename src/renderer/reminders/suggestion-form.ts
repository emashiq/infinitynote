import type { ReminderCreateRequestType, ReminderUpdateRequestType, ZonesListResponseType } from '../../shared/contracts/reminders';
import type { SettingValue } from '../../shared/contracts/settings';
import type { ReminderApplySourceRequestType, ReminderCreateFromSuggestionRequestType } from '../../shared/contracts/suggestions';
import { displayTitle } from '../../shared/names';
import { candidateZone, missingChoices, resolveCandidate } from '../../shared/nlp/resolve-candidate';
import type { CandidateResolution, Choices, Disclosure, MissingChoice } from '../../shared/nlp/types';
import { formatDayMonth } from '../../shared/time/format';
import { isValidLocalDate, isValidLocalTime, isoWeekday, localTimeOf, resolveLocal } from '../../shared/time/resolve';
import type { CardCandidate, CardRequest } from './card-request';
import { CHOOSE_ZONE, formProblem, initialForm, toInput, type ReminderForm } from './reminder-form';

/**
 * The confirmation card's state and rules (plan section 9.6, D-093), free of React: the form starts from the phrase,
 * a zone or choice change reads the phrase again until the user types a date or time, Add waits for every missing
 * choice, and the requests carry date, time and zone (main resolves the instant).
 */

export const NO_PHRASE = 'No date or time found in this text. Enter the date and time below.';
export const EXISTS = 'This reminder already exists.';
export const PROBLEMS: Record<MissingChoice, string> = {
  zone: CHOOSE_ZONE,
  order: 'Choose the date order',
  meridiem: 'Choose AM or PM',
  time: 'Enter a time',
};

export interface CardContext {
  request: CardRequest;
  zones: ZonesListResponseType;
  followupDefault: SettingValue<'reminders.followupDefault'>;
  endOfDayTime: string;
  dateOnlyTime: string;
}

export interface CardState {
  selected: number;
  choices: Choices;
  form: ReminderForm;
  /** Fields the user typed into: they no longer follow the phrase. */
  touched: { title: boolean; date: boolean; time: boolean };
}

export type CardAction =
  | { type: 'select'; index: number }
  | { type: 'zone'; zoneId: string }
  | { type: 'choice'; choices: Pick<Choices, 'order' | 'meridiem' | 'useNextYear'> }
  | { type: 'date'; value: string }
  | { type: 'time'; value: string }
  | { type: 'fields'; patch: Partial<ReminderForm> };

/** The phrase the card is about, or null in manual mode. */
export function selectedCandidate(ctx: CardContext, state: CardState): CardCandidate | null {
  return ctx.request.candidates[state.selected] ?? null;
}

function resolveOptions(ctx: CardContext, state: CardState) {
  return {
    zoneId: state.form.zoneId,
    choices: { ...state.choices, zoneId: state.form.zoneId || undefined, fold: state.form.foldPreference },
    endOfDayTime: ctx.endOfDayTime,
    dateOnlyTime: ctx.dateOnlyTime,
  };
}

/** The phrase read with the current zone and choices; null in manual mode. */
export function resolveCard(ctx: CardContext, state: CardState): CandidateResolution | null {
  const c = selectedCandidate(ctx, state);
  return c ? resolveCandidate(c, resolveOptions(ctx, state)) : null;
}

/** Date and time follow the phrase unless typed; a series starts on the weekday of its date. */
function followPhrase(ctx: CardContext, state: CardState): CardState {
  const res = resolveCard(ctx, state);
  if (!res || res.status !== 'ready') return state;
  const date = state.touched.date ? state.form.date : res.date;
  const time = state.touched.time ? state.form.time : res.time;
  const weekdays = state.form.repeat === 'none' && isValidLocalDate(date) ? [isoWeekday(date)] : state.form.weekdays;
  return { ...state, form: { ...state.form, date, time, weekdays, foldPreference: res.foldPreference } };
}

/** The zone a phrase starts in: none for an abbreviation (the user chooses), the fixed zone of a UTC or GMT phrase, else the card's zone. */
function zoneFor(c: CardCandidate, ctx: CardContext): string {
  if (c.zone.kind === 'abbreviation') return '';
  if (c.zone.kind === 'fixed') return c.zone.zoneId;
  // Update mode reads the new phrase in the reminder's zone.
  return ctx.request.reminder?.zoneId ?? ctx.zones.defaultZone ?? '';
}

export function initialCard(ctx: CardContext): CardState {
  const { request, zones, followupDefault } = ctx;
  const c = request.candidates[request.selected] ?? null;
  const base = initialForm({
    reminder: request.reminder,
    title: c ? c.title || displayTitle(request.noteTitle) : request.manualTitle || displayTitle(request.noteTitle),
    blockId: c ? request.blockId : request.manualBlockId,
    defaultZone: zones.defaultZone,
    asOf: zones.asOf,
    followupDefault,
  });
  const state: CardState = { selected: request.selected, choices: {}, form: base, touched: { title: false, date: false, time: false } };
  if (!c) return state;
  // A phrase starts with no date or time until it resolves; the reminder's own schedule shows under "Now".
  const form = { ...base, zoneId: zoneFor(c, ctx), date: '', time: '', foldPreference: 'earlier' as const };
  return followPhrase(ctx, { ...state, form });
}

export function cardReducer(ctx: CardContext, state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'select': {
      const c = ctx.request.candidates[action.index];
      if (!c) return state;
      const title = state.touched.title ? state.form.title : c.title || displayTitle(ctx.request.noteTitle);
      const form = { ...state.form, title, zoneId: c.zone.kind === 'selected' ? state.form.zoneId : zoneFor(c, ctx), date: '', time: '' };
      return followPhrase(ctx, { selected: action.index, choices: {}, form, touched: { ...state.touched, date: false, time: false } });
    }
    case 'zone':
      return followPhrase(ctx, { ...state, form: { ...state.form, zoneId: action.zoneId } });
    case 'choice':
      return followPhrase(ctx, { ...state, choices: { ...state.choices, ...action.choices } });
    case 'date':
      return { ...state, form: { ...state.form, date: action.value }, touched: { ...state.touched, date: true } };
    case 'time': {
      const c = selectedCandidate(ctx, state);
      // "midnight" asks for a time: the entered time is the choice the phrase needs.
      if (c?.intent.kind === 'calendar' && c.intent.time.kind === 'needsTime' && !state.touched.time) {
        return followPhrase(ctx, { ...state, choices: { ...state.choices, time: action.value || undefined }, form: { ...state.form, time: action.value } });
      }
      return { ...state, form: { ...state.form, time: action.value }, touched: { ...state.touched, time: true } };
    }
    case 'fields': {
      const next = { ...state, form: { ...state.form, ...action.patch }, touched: { ...state.touched, title: state.touched.title || 'title' in action.patch } };
      return 'foldPreference' in action.patch ? followPhrase(ctx, next) : next;
    }
  }
}

/** The choices the phrase still needs, in the order the card asks for them. */
export function cardMissing(ctx: CardContext, state: CardState): MissingChoice[] {
  const c = selectedCandidate(ctx, state);
  if (!c) return state.form.zoneId ? [] : ['zone'];
  return missingChoices(c, resolveOptions(ctx, state));
}

/** Why Add is disabled, or null (plan section 9.6, gating order). */
export function cardProblem(ctx: CardContext, state: CardState): string | null {
  const [missing] = cardMissing(ctx, state);
  return missing ? PROBLEMS[missing] : formProblem(state.form);
}

/** The instant the form describes, when it is complete. */
function formInstant(form: ReminderForm): number | null {
  if (!form.zoneId || !isValidLocalDate(form.date) || !isValidLocalTime(form.time)) return null;
  return resolveLocal({ date: form.date, time: form.time }, form.zoneId, form.foldPreference).instantUtc;
}

/** True when the form's time has already passed (when the card was opened): it will be added as overdue. */
export function isPast(ctx: CardContext, state: CardState): boolean {
  const instant = formInstant(state.form);
  return instant !== null && instant <= ctx.zones.asOf;
}

/** "Use next year" is offered for a past date written without a year, until it is used. */
export function offersNextYear(ctx: CardContext, state: CardState): boolean {
  const res = resolveCard(ctx, state);
  return res?.status === 'ready' && res.yearOmitted && !state.choices.useNextYear && !state.touched.date && isPast(ctx, state);
}

/** The disclosure under Time while it shows the default it describes ("17:00 (default end of day)"). */
export function disclosureText(ctx: CardContext, state: CardState): string | null {
  const res = resolveCard(ctx, state);
  if (res?.status !== 'ready' || !res.disclosure || state.form.time !== res.time) return null;
  return disclosureOf(res.disclosure, res.time);
}

export function disclosureOf(disclosure: Disclosure, time: string): string {
  if (disclosure.kind === 'endOfDay') return `${time} (default end of day)`;
  if (disclosure.kind === 'dateOnly') return `${time} (default time for date-only phrases)`;
  return `${time} (default for “${disclosure.part}”)`;
}

/** The two readings of an ambiguous numeric date ("4 March" / "3 April"), as written first. */
export function orderOptions(c: CardCandidate): Array<{ value: 'asWritten' | 'swapped'; label: string }> {
  if (c.intent.kind !== 'calendar' || c.intent.date.kind !== 'absolute' || !c.intent.date.order) return [];
  const { month, day, order } = c.intent.date;
  return [
    { value: 'asWritten', label: formatDayMonth(month, day) },
    { value: 'swapped', label: formatDayMonth(order.month, order.day) },
  ];
}

/** The two times a bare hour can mean ("05:00" / "17:00"). */
export function meridiemOptions(c: CardCandidate): Array<{ value: 'am' | 'pm'; label: string }> {
  if (c.intent.kind !== 'calendar' || c.intent.time.kind !== 'ambiguousHour') return [];
  const { hour12, minute } = c.intent.time;
  return [
    { value: 'am', label: localTimeOf(hour12 % 12, minute) },
    { value: 'pm', label: localTimeOf((hour12 % 12) + 12, minute) },
  ];
}

/** The zones an abbreviation may mean, for the "“CST” can mean …" notice. */
export function abbreviationOf(c: CardCandidate | null): { abbr: string; suggestions: string[] } | null {
  return c?.zone.kind === 'abbreviation' ? { abbr: c.zone.abbr, suggestions: c.zone.suggestions } : null;
}

/** The zone the "Read on" line uses: the selected zone, else the zone the phrase was read in. */
export function readOnZone(ctx: CardContext, state: CardState, c: CardCandidate): string {
  return candidateZone(c, { zoneId: state.form.zoneId, choices: {} }) || c.parseZone;
}

/** The phrase as stored with the reminder (plan section 9.6, submit step 2). */
function sourceOf(ctx: CardContext, state: CardState, c: CardCandidate) {
  const { request } = ctx;
  const rich = request.format === 'rich';
  return {
    blockId: rich ? request.blockId : null,
    text: request.blockText.slice(c.start, c.end),
    spanStart: rich ? c.start : null,
    spanEnd: rich ? c.end : null,
    spanOrdinal: c.spanOrdinal,
    referenceInstantUtc: c.referenceInstantUtc,
    referenceZone: state.form.zoneId,
    origin: request.origin,
  };
}

function scheduleOf(state: CardState, allowPast: boolean) {
  const { blockId: _blockId, ...input } = toInput(state.form);
  return { ...input, allowPast };
}

export function toCreateRequest(ctx: CardContext, state: CardState, allowPast: boolean): ReminderCreateFromSuggestionRequestType {
  return { ...scheduleOf(state, allowPast), noteId: ctx.request.noteId, source: sourceOf(ctx, state, selectedCandidate(ctx, state)!) };
}

export function toUpdateRequest(ctx: CardContext, state: CardState, opts: { pendingPolicy: 'keep' | 'complete'; allowPast: boolean }): ReminderApplySourceRequestType {
  const reminder = ctx.request.reminder!;
  return {
    action: 'apply',
    ...scheduleOf(state, opts.allowPast),
    reminderId: reminder.id,
    expectedRevision: reminder.revision,
    pendingPolicy: opts.pendingPolicy,
    source: sourceOf(ctx, state, selectedCandidate(ctx, state)!),
  };
}

/** Manual entry: an ordinary reminder (no source row), anchored to the paragraph unless `blockId` says otherwise. */
export function toManualCreate(ctx: CardContext, state: CardState, opts: { allowPast: boolean; blockId?: null }): ReminderCreateRequestType {
  return { ...toInput(state.form), ...(opts.blockId === null ? { blockId: null } : {}), noteId: ctx.request.noteId, allowPast: opts.allowPast };
}

/** Manual update: the Phase 05 edit (then the stale phrase is detached so it no longer warns). */
export function toManualUpdate(ctx: CardContext, state: CardState, opts: { pendingPolicy: 'keep' | 'complete'; allowPast: boolean }): ReminderUpdateRequestType {
  const reminder = ctx.request.reminder!;
  return { ...toInput(state.form), blockId: reminder.blockId, reminderId: reminder.id, expectedRevision: reminder.revision, pendingPolicy: opts.pendingPolicy, allowPast: opts.allowPast };
}
