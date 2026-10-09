import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Result } from '../../shared/contracts/envelope';
import { FOLLOWUP_INTERVALS, FOLLOWUP_MAX_COUNTS, type ReminderDtoType, type ReminderInputType, type ZonesListResponseType } from '../../shared/contracts/reminders';
import { SETTINGS, type SettingValue } from '../../shared/contracts/settings';
import { useServices } from '../state/use-store';
import { Dialog } from '../ui/Dialog';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import {
  CHOOSE_ZONE,
  PAST_TEXT,
  PENDING_TEXT,
  WEEKDAYS,
  formProblem,
  initialForm,
  needsPendingChoice,
  previewOf,
  shortcutDates,
  toInput,
  type ReminderForm,
} from './reminder-form';

export interface ReminderDialogProps {
  noteId: string;
  /** The reminder to edit, or null to add one. */
  reminder: ReminderDtoType | null;
  /** The block to anchor a new reminder to (the paragraph at the cursor), or null for a note-level reminder. */
  blockId: string | null;
  /** The title a new reminder starts with (the block's text, else the note title). */
  title: string;
  /** Saves the open editor so its block IDs are stored; null when the note is not open in this window. */
  persistBlocks: (() => Promise<boolean>) | null;
  onClose: () => void;
}

interface Loaded {
  zones: ZonesListResponseType;
  followupDefault: SettingValue<'reminders.followupDefault'>;
}

const detailsOf = (error: { details?: unknown }) => (error.details ?? {}) as { past?: boolean; blockMissing?: boolean };

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * Add or edit a reminder (plan section 9.7): title, date with Today and Tomorrow in the chosen zone, time, IANA zone,
 * repeat, follow-ups and a live preview with DST notices. Main resolves and validates everything again on Save.
 */
export function ReminderDialog(props: ReminderDialogProps) {
  const { bridge } = useServices();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reminder, setReminder] = useState(props.reminder);
  const [form, setForm] = useState<ReminderForm | null>(null);
  const [pendingPolicy, setPendingPolicy] = useState<'keep' | 'complete'>('keep');
  const [past, setPast] = useState(false);
  const [offerNoteLevel, setOfferNoteLevel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([bridge.zones.list(), bridge.settings.get({ keys: ['reminders.followupDefault'] })]).then(([zones, settings]) => {
      if (cancelled || !zones.ok) return;
      const followupDefault = (settings.ok && settings.data.values['reminders.followupDefault']) || SETTINGS['reminders.followupDefault'].default;
      setLoaded({ zones: zones.data, followupDefault });
      setForm(initialForm({ reminder: props.reminder, title: props.title, blockId: props.blockId, defaultZone: zones.data.defaultZone, asOf: zones.data.asOf, followupDefault }));
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, props.reminder, props.title, props.blockId]);

  if (!loaded || !form) return null;
  const { zones } = loaded;
  const update = (patch: Partial<ReminderForm>) => {
    setForm({ ...form, ...patch });
    setPast(false);
    setError(null);
  };
  const preview = previewOf(form, zones.systemZone);
  const problem = formProblem(form);
  const askPending = needsPendingChoice(form, reminder);
  const dates = form.zoneId ? shortcutDates(zones.asOf, form.zoneId) : null;

  const send = (input: ReminderInputType): Promise<Result<ReminderDtoType>> =>
    reminder
      ? bridge.reminder.update({ ...input, reminderId: reminder.id, expectedRevision: reminder.revision, pendingPolicy: askPending ? pendingPolicy : 'keep' })
      : bridge.reminder.create({ ...input, noteId: props.noteId });

  const submit = async (opts: { allowPast?: boolean; blockId?: null } = {}) => {
    setBusy(true);
    setError(null);
    const input: ReminderInputType = { ...toInput(form), ...(opts.blockId === null ? { blockId: null } : {}), allowPast: opts.allowPast ?? false };
    let res = await send(input);
    // A block the editor gave an ID at load is stored with the next save: save once, then try again (D-080).
    if (!res.ok && detailsOf(res.error).blockMissing && props.persistBlocks && (await props.persistBlocks())) res = await send(input);
    setBusy(false);
    if (res.ok) {
      props.onClose();
      return;
    }
    const details = detailsOf(res.error);
    if (details.past) {
      setPast(true);
      return;
    }
    if (details.blockMissing) setOfferNoteLevel(true);
    if (res.error.code === 'CONFLICT' && reminder) {
      const fresh = await bridge.reminder.listForNote({ noteId: reminder.noteId });
      const latest = fresh.ok ? fresh.data.reminders.find((r) => r.id === reminder.id) : undefined;
      if (latest) {
        setReminder(latest);
        setForm(initialForm({ reminder: latest, title: latest.title, blockId: latest.blockId, defaultZone: zones.defaultZone, asOf: zones.asOf, followupDefault: loaded.followupDefault }));
      }
    }
    setError(res.error.message);
  };

  return (
    <Dialog title={reminder ? 'Edit reminder' : 'Add reminder'} onClose={props.onClose} className="reminder-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && !busy) void submit();
        }}
      >
        <Field label="Title">
          {(id) => <input id={id} className="text-input" value={form.title} maxLength={200} data-autofocus="" onChange={(e) => update({ title: e.target.value })} />}
        </Field>
        <div className="form-row">
          <Field label="Date">{(id) => <input id={id} type="date" className="text-input" value={form.date} onChange={(e) => update({ date: e.target.value })} />}</Field>
          <div className="date-shortcuts">
            <button type="button" className="btn btn-small" disabled={!dates} onClick={() => dates && update({ date: dates.today })}>
              Today
            </button>
            <button type="button" className="btn btn-small" disabled={!dates} onClick={() => dates && update({ date: dates.tomorrow })}>
              Tomorrow
            </button>
          </div>
          <Field label="Time">{(id) => <input id={id} type="time" className="text-input" value={form.time} onChange={(e) => update({ time: e.target.value })} />}</Field>
        </div>
        <Field label="Time zone">
          {(id) => (
            <select id={id} className="select" value={form.zoneId} onChange={(e) => update({ zoneId: e.target.value })}>
              {form.zoneId === '' ? (
                <option value="" disabled>
                  {CHOOSE_ZONE}
                </option>
              ) : null}
              {zones.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="field-label">Repeat</p>
        <SegmentedControl<ReminderForm['repeat']>
          label="Repeat"
          name="reminder-repeat"
          value={form.repeat}
          onChange={(repeat) => update({ repeat })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ]}
        />
        {form.repeat === 'weekly' ? (
          <div className="weekday-toggles" role="group" aria-label="Days">
            {WEEKDAYS.map((w) => {
              const on = form.weekdays.includes(w.day);
              return (
                <button
                  key={w.day}
                  type="button"
                  className={`btn btn-small${on ? ' is-on' : ''}`}
                  aria-label={w.name}
                  aria-pressed={on}
                  onClick={() => update({ weekdays: on ? form.weekdays.filter((d) => d !== w.day) : [...form.weekdays, w.day] })}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        ) : null}
        <Switch label="Follow up if not done" checked={form.followupOn} onChange={(followupOn) => update({ followupOn })} />
        {form.followupOn ? (
          <div className="form-row">
            <Field label="Every">
              {(id) => (
                <span className="inline-unit">
                  <select id={id} className="select" value={form.intervalMinutes} onChange={(e) => update({ intervalMinutes: Number(e.target.value) as ReminderForm['intervalMinutes'] })}>
                    {FOLLOWUP_INTERVALS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  minutes
                </span>
              )}
            </Field>
            <Field label="At most">
              {(id) => (
                <span className="inline-unit">
                  <select id={id} className="select" value={form.maxFollowups} onChange={(e) => update({ maxFollowups: Number(e.target.value) as ReminderForm['maxFollowups'] })}>
                    {FOLLOWUP_MAX_COUNTS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  times
                </span>
              )}
            </Field>
          </div>
        ) : null}
        {preview ? (
          <div className="reminder-preview" aria-label="Preview">
            <p className="due-primary">{preview.primary}</p>
            {preview.local ? <p className="muted">{preview.local}</p> : null}
            {preview.gap ? <p className="dst-notice">{preview.gap}</p> : null}
            {preview.fold ? (
              <>
                <p className="dst-notice">{preview.fold.notice}</p>
                <label className="checkbox">
                  <input type="checkbox" checked={form.foldPreference === 'later'} onChange={(e) => update({ foldPreference: e.target.checked ? 'later' : 'earlier' })} />
                  {preview.fold.laterLabel}
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        {askPending ? (
          <fieldset className="pending-policy">
            <legend>{PENDING_TEXT}</legend>
            <label className="radio">
              <input type="radio" name="pending-policy" checked={pendingPolicy === 'keep'} onChange={() => setPendingPolicy('keep')} />
              Keep the current overdue reminder
            </label>
            <label className="radio">
              <input type="radio" name="pending-policy" checked={pendingPolicy === 'complete'} onChange={() => setPendingPolicy('complete')} />
              Mark it done
            </label>
          </fieldset>
        ) : null}
        {past ? (
          <div className="dialog-warning" role="alert">
            <span>{PAST_TEXT}</span>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void submit({ allowPast: true })}>
              Add anyway
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        {offerNoteLevel ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => {
              update({ blockId: null });
              void submit({ blockId: null });
            }}
          >
            Attach to the note instead
          </button>
        ) : null}
        <div className="dialog-actions">
          {problem === CHOOSE_ZONE ? <span className="muted dialog-hint">{CHOOSE_ZONE}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={problem !== null || busy}>
            Save
          </button>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
