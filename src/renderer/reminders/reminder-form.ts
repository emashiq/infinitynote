import type { FollowupType, RecurrenceType, ReminderDtoType, ReminderInputType } from '../../shared/contracts/reminders';
import type { SettingValue } from '../../shared/contracts/settings';
import { dueLines, foldNotice, gapNotice, laterChoiceLabel } from '../../shared/time/format';
import { addDays, isValidLocalDate, isValidLocalTime, isoWeekday, localParts, resolveLocal, type FoldPreference } from '../../shared/time/resolve';
import { FALLBACK_DAY_ZONE } from '../../shared/time/zones';

export const DEFAULT_TIME = '09:00';
export const WEEKDAYS = [
  { day: 1, label: 'Mon', name: 'Monday' },
  { day: 2, label: 'Tue', name: 'Tuesday' },
  { day: 3, label: 'Wed', name: 'Wednesday' },
  { day: 4, label: 'Thu', name: 'Thursday' },
  { day: 5, label: 'Fri', name: 'Friday' },
  { day: 6, label: 'Sat', name: 'Saturday' },
  { day: 7, label: 'Sun', name: 'Sunday' },
] as const;
export const CHOOSE_ZONE = 'Choose a time zone';
export const PAST_TEXT = 'This time has already passed. It will be added as overdue, without a notification.';
export const PENDING_TEXT = 'This reminder has an overdue occurrence.';

type FollowupValue = NonNullable<FollowupType>;

/** What the reminder dialog edits (plan section 9.7). An empty `zoneId` means no zone is chosen yet. */
export interface ReminderForm {
  title: string;
  date: string;
  time: string;
  zoneId: string;
  repeat: 'none' | 'daily' | 'weekly';
  weekdays: number[];
  followupOn: boolean;
  intervalMinutes: FollowupValue['intervalMinutes'];
  maxFollowups: FollowupValue['maxFollowups'];
  foldPreference: FoldPreference;
  blockId: string | null;
}

/** "Today" and "Tomorrow" are calendar dates in the selected zone, not on the computer's clock. */
export function shortcutDates(asOf: number, zoneId: string): { today: string; tomorrow: string } {
  const today = localParts(asOf, zoneId).date;
  return { today, tomorrow: addDays(today, 1) };
}

export function initialForm(opts: {
  reminder: ReminderDtoType | null;
  title: string;
  blockId: string | null;
  defaultZone: string | null;
  asOf: number;
  followupDefault: SettingValue<'reminders.followupDefault'>;
}): ReminderForm {
  const r = opts.reminder;
  if (r) {
    return {
      title: r.title,
      date: r.date,
      time: r.time,
      zoneId: r.zoneId,
      repeat: r.recurrence?.freq ?? 'none',
      weekdays: r.recurrence?.freq === 'weekly' ? [...r.recurrence.byWeekday] : [isoWeekday(r.date)],
      followupOn: r.followup !== null,
      intervalMinutes: r.followup?.intervalMinutes ?? opts.followupDefault.intervalMinutes,
      maxFollowups: r.followup?.maxFollowups ?? opts.followupDefault.maxFollowups,
      foldPreference: r.foldPreference,
      blockId: r.blockId,
    };
  }
  // Today at 09:00 in the default zone, or tomorrow once that has passed.
  let date = shortcutDates(opts.asOf, opts.defaultZone ?? FALLBACK_DAY_ZONE).today;
  if (opts.defaultZone && resolveLocal({ date, time: DEFAULT_TIME }, opts.defaultZone).instantUtc <= opts.asOf) date = addDays(date, 1);
  return {
    title: opts.title,
    date,
    time: DEFAULT_TIME,
    zoneId: opts.defaultZone ?? '',
    repeat: 'none',
    weekdays: [isoWeekday(date)],
    followupOn: opts.followupDefault.enabled,
    intervalMinutes: opts.followupDefault.intervalMinutes,
    maxFollowups: opts.followupDefault.maxFollowups,
    foldPreference: 'earlier',
    blockId: opts.blockId,
  };
}

export interface Preview {
  primary: string;
  local: string | null;
  gap: string | null;
  fold: { notice: string; laterLabel: string } | null;
}

/** The live preview: the instant in the chosen zone, "Your time" when the computer's wall clock differs, DST notices. */
export function previewOf(form: ReminderForm, displayZone: string | null): Preview | null {
  if (!form.zoneId || !isValidLocalDate(form.date) || !isValidLocalTime(form.time)) return null;
  const r = resolveLocal({ date: form.date, time: form.time }, form.zoneId, form.foldPreference);
  const lines = dueLines(r.instantUtc, form.zoneId, displayZone);
  return {
    primary: lines.primary,
    local: lines.local,
    gap: r.status === 'gap' ? gapNotice(form.time, form.zoneId, r.instantUtc) : null,
    fold: r.status === 'fold' ? { notice: foldNotice(form.time, form.foldPreference), laterLabel: laterChoiceLabel(r.alternatives[1], form.zoneId) } : null,
  };
}

function recurrenceOf(form: ReminderForm): RecurrenceType {
  if (form.repeat === 'daily') return { freq: 'daily' };
  if (form.repeat === 'weekly') return { freq: 'weekly', byWeekday: [...form.weekdays].sort((a, b) => a - b) };
  return null;
}

/** The request fields; main re-resolves the instant itself. */
export function toInput(form: ReminderForm): Omit<ReminderInputType, 'allowPast'> {
  return {
    blockId: form.blockId,
    title: form.title.trim(),
    zoneId: form.zoneId,
    date: form.date,
    time: form.time,
    recurrence: recurrenceOf(form),
    foldPreference: form.foldPreference,
    followup: form.followupOn ? { intervalMinutes: form.intervalMinutes, maxFollowups: form.maxFollowups } : null,
  };
}

/** Why Save is disabled, or null. */
export function formProblem(form: ReminderForm): string | null {
  if (!form.zoneId) return CHOOSE_ZONE;
  if (form.title.trim() === '') return 'Enter a title';
  if (!isValidLocalDate(form.date) || !isValidLocalTime(form.time)) return 'Enter a date and time';
  if (form.repeat === 'weekly' && form.weekdays.length === 0) return 'Choose at least one day';
  return null;
}

/** True when the zone, date, time, repeat or fold choice differs from the stored reminder (a schedule edit). */
export function scheduleChanged(form: ReminderForm, r: ReminderDtoType): boolean {
  const input = toInput(form);
  return (
    input.zoneId !== r.zoneId ||
    input.date !== r.date ||
    input.time !== r.time ||
    input.foldPreference !== r.foldPreference ||
    JSON.stringify(input.recurrence) !== JSON.stringify(r.recurrence)
  );
}

/** Editing the schedule of a series whose current occurrence is overdue asks what happens to that occurrence. */
export function needsPendingChoice(form: ReminderForm, r: ReminderDtoType | null): boolean {
  return r !== null && r.recurrence !== null && r.current?.overdue === true && scheduleChanged(form, r);
}
