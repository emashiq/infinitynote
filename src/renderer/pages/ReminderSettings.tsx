import { useEffect, useState } from 'react';
import { FOLLOWUP_INTERVALS, FOLLOWUP_MAX_COUNTS, type ZonesListResponseType } from '../../shared/contracts/reminders';
import { SETTINGS, type SettingValue, type SettingsChangedPayload } from '../../shared/contracts/settings';
import { useServices } from '../state/use-store';
import { SelectField as Select, SettingsSection, TimeField } from '../settings/fields';
import { Switch } from '../ui/Switch';

export const FULLY_QUIT_TEXT =
  'Reminders only fire while Infinity Notes is running: with a window open, in the background or in the tray. After you quit, nothing is sent until you start the app again, and then overdue reminders are shown.';
export const NO_NOTIFICATIONS_TEXT = 'This desktop has no notification service. Reminders appear inside Infinity Notes and in the reminder widget instead.';
export const ENGLISH_ONLY_TEXT = 'Suggestions understand English dates and times only. Your text is read on this computer and is not sent anywhere.';

type Values = {
  defaultZone: SettingValue<'reminders.defaultZone'>;
  followup: SettingValue<'reminders.followupDefault'>;
  quiet: SettingValue<'reminders.quietHours'>;
  suggest: SettingValue<'reminders.suggestFromText'>;
  endOfDay: SettingValue<'reminders.endOfDayTime'>;
  dateOnly: SettingValue<'reminders.dateOnlyTime'>;
};
const KEYS = {
  defaultZone: 'reminders.defaultZone',
  followup: 'reminders.followupDefault',
  quiet: 'reminders.quietHours',
  suggest: 'reminders.suggestFromText',
  endOfDay: 'reminders.endOfDayTime',
  dateOnly: 'reminders.dateOnlyTime',
} as const;

/**
 * Settings > Reminders (D-083, D-094): default zone, follow-up defaults, quiet hours, what happens when the app is quit,
 * and the reminder suggestions from note text with their default times.
 */
export function ReminderSettings({ notificationsSupported }: { notificationsSupported: boolean }) {
  const { bridge, notices } = useServices();
  const [zones, setZones] = useState<ZonesListResponseType | null>(null);
  const [values, setValues] = useState<Values | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A change from another window (or a refused write) is followed live.
    const apply = (key: string, value: unknown) => {
      const field = (Object.keys(KEYS) as Array<keyof Values>).find((f) => KEYS[f] === key);
      const parsed = field ? SETTINGS[KEYS[field]].schema.safeParse(value) : null;
      if (field && parsed?.success) setValues((v) => (v ? { ...v, [field]: parsed.data } : v));
    };
    void Promise.all([bridge.zones.list(), bridge.settings.get({ keys: Object.values(KEYS) })]).then(([z, s]) => {
      if (cancelled || !z.ok || !s.ok) return;
      const v = s.data.values;
      setZones(z.data);
      setValues({
        defaultZone: (v[KEYS.defaultZone] as Values['defaultZone'] | undefined) ?? null,
        followup: (v[KEYS.followup] as Values['followup'] | undefined) ?? SETTINGS[KEYS.followup].default,
        quiet: (v[KEYS.quiet] as Values['quiet'] | undefined) ?? SETTINGS[KEYS.quiet].default,
        suggest: (v[KEYS.suggest] as Values['suggest'] | undefined) ?? SETTINGS[KEYS.suggest].default,
        endOfDay: (v[KEYS.endOfDay] as Values['endOfDay'] | undefined) ?? SETTINGS[KEYS.endOfDay].default,
        dateOnly: (v[KEYS.dateOnly] as Values['dateOnly'] | undefined) ?? SETTINGS[KEYS.dateOnly].default,
      });
    });
    const off = bridge.subscribe('settings:changed', ({ key, value }: SettingsChangedPayload) => apply(key, value));
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  if (!zones || !values) return null;
  const save = (result: Promise<{ ok: boolean; error?: { message: string } }>) =>
    void result.then((res) => {
      if (!res.ok) notices.push(res.error?.message ?? 'Could not save the setting', 'error');
    });
  const setFollowup = (patch: Partial<Values['followup']>) => {
    const value = { ...values.followup, ...patch };
    setValues({ ...values, followup: value });
    save(bridge.settings.set({ key: KEYS.followup, value }));
  };
  const setQuiet = (patch: Partial<Values['quiet']>) => {
    const value = { ...values.quiet, ...patch };
    // Quiet hours always name their zone; switching them on stores the computer's zone unless one was chosen.
    if (value.enabled && value.zoneId === null) value.zoneId = zones.systemZone ?? zones.defaultZone;
    setValues({ ...values, quiet: value });
    save(bridge.settings.set({ key: KEYS.quiet, value }));
  };
  const zoneOptions = zones.zones.map((z) => ({ value: z, label: z }));
  return (
    <SettingsSection title="Reminders">
      <Select
        label="Default time zone for new reminders"
        value={values.defaultZone ?? ''}
        options={[{ value: '', label: `Computer time zone (${zones.systemZone ?? 'unknown'})` }, ...zoneOptions]}
        onChange={(v) => {
          const defaultZone = v === '' ? null : v;
          setValues({ ...values, defaultZone });
          save(bridge.settings.set({ key: KEYS.defaultZone, value: defaultZone }));
        }}
      />
      <Switch label="Follow up on new reminders" checked={values.followup.enabled} onChange={(enabled) => setFollowup({ enabled })} />
      {values.followup.enabled ? (
        <div className="form-row">
          <Select
            label="Every"
            value={String(values.followup.intervalMinutes)}
            options={FOLLOWUP_INTERVALS.map((n) => ({ value: String(n), label: `${n} minutes` }))}
            onChange={(v) => setFollowup({ intervalMinutes: Number(v) as Values['followup']['intervalMinutes'] })}
          />
          <Select
            label="At most"
            value={String(values.followup.maxFollowups)}
            options={FOLLOWUP_MAX_COUNTS.map((n) => ({ value: String(n), label: `${n} times` }))}
            onChange={(v) => setFollowup({ maxFollowups: Number(v) as Values['followup']['maxFollowups'] })}
          />
        </div>
      ) : null}
      <Switch label="Quiet hours" checked={values.quiet.enabled} onChange={(enabled) => setQuiet({ enabled })} />
      {values.quiet.enabled ? (
        <div className="form-row">
          <TimeField label="From" value={values.quiet.start} onChange={(start) => setQuiet({ start })} />
          <TimeField label="To" value={values.quiet.end} onChange={(end) => setQuiet({ end })} />
          <Select label="Time zone" value={values.quiet.zoneId ?? ''} options={zoneOptions} onChange={(zoneId) => setQuiet({ zoneId })} />
        </div>
      ) : null}
      <p className="muted">{FULLY_QUIT_TEXT}</p>
      {notificationsSupported ? null : <p className="muted">{NO_NOTIFICATIONS_TEXT}</p>}
      <Switch
        label="Suggest reminders from dates in notes"
        checked={values.suggest}
        onChange={(suggest) => {
          setValues({ ...values, suggest });
          save(bridge.settings.set({ key: KEYS.suggest, value: suggest }));
        }}
      />
      <div className="form-row">
        <TimeField
          label="End of day"
          value={values.endOfDay}
          onChange={(endOfDay) => {
            setValues({ ...values, endOfDay });
            save(bridge.settings.set({ key: KEYS.endOfDay, value: endOfDay }));
          }}
        />
        <TimeField
          label="Time for date-only phrases"
          value={values.dateOnly}
          onChange={(dateOnly) => {
            setValues({ ...values, dateOnly });
            save(bridge.settings.set({ key: KEYS.dateOnly, value: dateOnly }));
          }}
        />
      </div>
      <p className="muted">{ENGLISH_ONLY_TEXT}</p>
    </SettingsSection>
  );
}

