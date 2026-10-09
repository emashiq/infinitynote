import { useId, type ReactNode } from 'react';
import { FOLLOWUP_INTERVALS, FOLLOWUP_MAX_COUNTS } from '../../shared/contracts/reminders';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { CHOOSE_ZONE, PENDING_TEXT, WEEKDAYS, type Preview, type ReminderForm } from './reminder-form';

/**
 * The reminder fields shared by the reminder editor (Phase 05) and the suggestion card (Phase 06): zone, repeat,
 * follow-ups and the preview with its DST notices. Each part edits the shared ReminderForm through `onChange`.
 */

export type FormPatch = (patch: Partial<ReminderForm>) => void;

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
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

/** "Time zone": the IANA list, with a disabled "Choose a time zone" entry while none is chosen. */
export function ZoneField({ zoneId, zones, onChange }: { zoneId: string; zones: readonly string[]; onChange: (zoneId: string) => void }) {
  return (
    <Field label="Time zone">
      {(id) => (
        <select id={id} className="select" value={zoneId} onChange={(e) => onChange(e.target.value)}>
          {zoneId === '' ? (
            <option value="" disabled>
              {CHOOSE_ZONE}
            </option>
          ) : null}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** "Repeat": None, Daily or Weekly with day toggles. */
export function RepeatFields({ form, onChange }: { form: ReminderForm; onChange: FormPatch }) {
  return (
    <>
      <p className="field-label">Repeat</p>
      <SegmentedControl<ReminderForm['repeat']>
        label="Repeat"
        name="reminder-repeat"
        value={form.repeat}
        onChange={(repeat) => onChange({ repeat })}
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
                onClick={() => onChange({ weekdays: on ? form.weekdays.filter((d) => d !== w.day) : [...form.weekdays, w.day] })}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** "Follow up if not done" with "Every" and "At most". */
export function FollowupFields({ form, onChange }: { form: ReminderForm; onChange: FormPatch }) {
  return (
    <>
      <Switch label="Follow up if not done" checked={form.followupOn} onChange={(followupOn) => onChange({ followupOn })} />
      {form.followupOn ? (
        <div className="form-row">
          <Field label="Every">
            {(id) => (
              <span className="inline-unit">
                <select id={id} className="select" value={form.intervalMinutes} onChange={(e) => onChange({ intervalMinutes: Number(e.target.value) as ReminderForm['intervalMinutes'] })}>
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
                <select id={id} className="select" value={form.maxFollowups} onChange={(e) => onChange({ maxFollowups: Number(e.target.value) as ReminderForm['maxFollowups'] })}>
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
    </>
  );
}

/** What happens to a series' overdue occurrence when its schedule changes (INF-REM-13). */
export function PendingPolicyField({ value, onChange }: { value: 'keep' | 'complete'; onChange: (value: 'keep' | 'complete') => void }) {
  return (
    <fieldset className="pending-policy">
      <legend>{PENDING_TEXT}</legend>
      <label className="radio">
        <input type="radio" name="pending-policy" checked={value === 'keep'} onChange={() => onChange('keep')} />
        Keep the current overdue reminder
      </label>
      <label className="radio">
        <input type="radio" name="pending-policy" checked={value === 'complete'} onChange={() => onChange('complete')} />
        Mark it done
      </label>
    </fieldset>
  );
}

/** The live preview: the due time in its zone, "Your time", the gap notice, and the fold notice with its later choice. */
export function PreviewBlock({ preview, form, onChange }: { preview: Preview | null; form: ReminderForm; onChange: FormPatch }) {
  if (!preview) return null;
  return (
    <div className="reminder-preview" aria-label="Preview">
      <p className="due-primary">{preview.primary}</p>
      {preview.local ? <p className="muted">{preview.local}</p> : null}
      {preview.gap ? <p className="dst-notice">{preview.gap}</p> : null}
      {preview.fold ? (
        <>
          <p className="dst-notice">{preview.fold.notice}</p>
          <label className="checkbox">
            <input type="checkbox" checked={form.foldPreference === 'later'} onChange={(e) => onChange({ foldPreference: e.target.checked ? 'later' : 'earlier' })} />
            {preview.fold.laterLabel}
          </label>
        </>
      ) : null}
    </div>
  );
}
