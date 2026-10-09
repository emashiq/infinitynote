import { useEffect, useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { ErrorEnvelope, Result } from '../../shared/contracts/envelope';
import { REMINDER_MESSAGES as M, type ReminderDtoType } from '../../shared/contracts/reminders';
import { SETTINGS } from '../../shared/contracts/settings';
import { dueLines, formatInZone, formatLongDate } from '../../shared/time/format';
import { isValidLocalDate } from '../../shared/time/resolve';
import { Dialog } from '../ui/Dialog';
import type { CardRequest } from './card-request';
import { reminderInstant } from './note-reminders';
import { needsPendingChoice, PAST_TEXT, previewOf } from './reminder-form';
import { Field, FollowupFields, PendingPolicyField, PreviewBlock, RepeatFields, ZoneField } from './ReminderFields';
import {
  abbreviationOf,
  cardMissing,
  cardProblem,
  cardReducer,
  disclosureText,
  EXISTS,
  initialCard,
  isPast,
  meridiemOptions,
  NO_PHRASE,
  offersNextYear,
  orderOptions,
  readOnZone,
  resolveCard,
  selectedCandidate,
  toCreateRequest,
  toManualCreate,
  toManualUpdate,
  toUpdateRequest,
  type CardAction,
  type CardContext,
  type CardState,
} from './suggestion-form';

export interface SuggestionCardProps {
  request: CardRequest;
  bridge: Pick<InfinityBridge, 'zones' | 'settings' | 'reminder'>;
  /** Saves pending edits first (the note controller's flush); false when the note could not be saved. */
  persist: () => Promise<boolean>;
  /** Saves the editor as it is so block IDs it assigned are stored (D-080); false when this view cannot save. */
  persistBlocks: () => Promise<boolean>;
  notify: (message: string) => void;
  onClose: () => void;
}

type Loaded = Omit<CardContext, 'request'>;

const detailsOf = (error: ErrorEnvelope) => (error.details ?? {}) as { past?: boolean; blockMissing?: boolean; sourceMismatch?: boolean };
/** A phrase or block main has not seen yet: save once and try again (plan section 9.6, submit step 3). */
const retryable = (error: ErrorEnvelope) => detailsOf(error).blockMissing === true || detailsOf(error).sourceMismatch === true;

/**
 * The confirmation card (plan section 9.6, D-093): the phrase, the full date and time with their defaults disclosed,
 * the zone and its local conversion, the choices a phrase leaves open, repeat and follow-up. Nothing is written
 * before Add (or Update); Cancel and Escape write nothing.
 */
export function SuggestionCard(props: SuggestionCardProps) {
  const { bridge } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reminder, setReminder] = useState<ReminderDtoType | null>(props.request.reminder);
  const [state, setState] = useState<CardState | null>(null);
  const [pendingPolicy, setPendingPolicy] = useState<'keep' | 'complete'>('keep');
  const [allowPast, setAllowPast] = useState(false);
  const [offerNoteLevel, setOfferNoteLevel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const keys = ['reminders.followupDefault', 'reminders.endOfDayTime', 'reminders.dateOnlyTime'] as const;
    void Promise.all([bridge.zones.list(), bridge.settings.get({ keys: [...keys] })]).then(([zones, settings]) => {
      if (cancelled || !zones.ok) return;
      const values = settings.ok ? settings.data.values : {};
      const next: Loaded = {
        zones: zones.data,
        followupDefault: values['reminders.followupDefault'] ?? SETTINGS['reminders.followupDefault'].default,
        endOfDayTime: values['reminders.endOfDayTime'] ?? SETTINGS['reminders.endOfDayTime'].default,
        dateOnlyTime: values['reminders.dateOnlyTime'] ?? SETTINGS['reminders.dateOnlyTime'].default,
      };
      setLoaded(next);
      setState(initialCard({ ...next, request: props.request }));
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, props.request]);

  if (!loaded || !state) return null;
  const ctx: CardContext = { ...loaded, request: { ...props.request, reminder } };
  const dispatch = (action: CardAction) => {
    setState(cardReducer(ctx, state, action));
    setAllowPast(false);
    setError(null);
  };
  const candidate = selectedCandidate(ctx, state);
  const { form } = state;
  const update = reminder !== null;
  const resolution = resolveCard(ctx, state);
  const missing = cardMissing(ctx, state);
  const problem = cardProblem(ctx, state);
  const preview = previewOf(form, loaded.zones.systemZone);
  const disclosure = disclosureText(ctx, state);
  const askPending = needsPendingChoice(form, reminder);
  // Choice groups stay once answered, so a choice can be changed.
  const abbreviation = abbreviationOf(candidate);
  const orders = candidate ? orderOptions(candidate) : [];
  const meridiems = candidate ? meridiemOptions(candidate) : [];

  const send = async (opts: { allowPast: boolean; blockId?: null }): Promise<Result<{ reminder: ReminderDtoType; existing: boolean }>> => {
    const wrap = (res: Result<ReminderDtoType>) => (res.ok ? { ok: true as const, data: { reminder: res.data, existing: false } } : res);
    if (candidate && opts.blockId !== null) {
      if (!reminder) return bridge.reminder.createFromSuggestion(toCreateRequest(ctx, state, opts.allowPast));
      return wrap(await bridge.reminder.updateFromSource(toUpdateRequest(ctx, state, { pendingPolicy: askPending ? pendingPolicy : 'keep', allowPast: opts.allowPast })));
    }
    if (!reminder) return wrap(await bridge.reminder.create(toManualCreate(ctx, state, opts)));
    const edited = await bridge.reminder.update(toManualUpdate(ctx, state, { pendingPolicy: askPending ? pendingPolicy : 'keep', allowPast: opts.allowPast }));
    // A schedule entered by hand replaces the phrase: it no longer follows the note text.
    if (edited.ok && edited.data.source) return wrap(await bridge.reminder.updateFromSource({ action: 'keep', reminderId: edited.data.id }));
    return wrap(edited);
  };

  const reloadReminder = async (current: ReminderDtoType) => {
    const fresh = await bridge.reminder.listForNote({ noteId: current.noteId });
    const latest = fresh.ok ? fresh.data.reminders.find((r) => r.id === current.id) : undefined;
    if (latest) setReminder(latest);
  };

  const submit = async (opts: { blockId?: null } = {}) => {
    setBusy(true);
    setError(null);
    if (!(await props.persist())) {
      setBusy(false);
      setError(M.sourceNotSaved);
      return;
    }
    const sendOpts = { ...opts, allowPast };
    let res = await send(sendOpts);
    if (!res.ok && retryable(res.error) && (await props.persistBlocks())) res = await send(sendOpts);
    setBusy(false);
    if (res.ok) {
      if (res.data.existing) props.notify(EXISTS);
      props.onClose();
      return;
    }
    const details = detailsOf(res.error);
    if (details.past) {
      setAllowPast(true);
      return;
    }
    if (details.blockMissing) setOfferNoteLevel(true);
    if (res.error.code === 'CONFLICT' && reminder) await reloadReminder(reminder);
    setError(res.error.message);
  };

  const submitLabel = allowPast ? 'Add anyway' : update ? 'Update' : 'Add';
  return (
    <Dialog title={update ? 'Update reminder' : 'Create reminder'} onClose={props.onClose} className="reminder-dialog suggestion-card">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && !busy) void submit();
        }}
      >
        {ctx.request.candidates.length > 1 ? (
          <fieldset className="choice-group">
            <legend>Dates found</legend>
            {ctx.request.candidates.map((c, i) => (
              <label key={`${c.start}:${c.end}`} className="radio">
                <input type="radio" name="dates-found" checked={state.selected === i} onChange={() => dispatch({ type: 'select', index: i })} />
                “{c.text}”
              </label>
            ))}
          </fieldset>
        ) : null}
        {candidate ? null : <p className="muted">{NO_PHRASE}</p>}
        <Field label="Title">
          {(id) => <input id={id} className="text-input" value={form.title} maxLength={200} data-autofocus="" onChange={(e) => dispatch({ type: 'fields', patch: { title: e.target.value } })} />}
        </Field>
        {candidate ? (
          <p className="source-phrase">
            <span className="field-label">From your note</span> <span className="phrase">“{ctx.request.blockText.slice(candidate.start, candidate.end)}”</span>
          </p>
        ) : null}
        {candidate && resolution?.status === 'ready' && resolution.relative ? (
          <p className="muted">
            Read on {formatInZone(candidate.referenceInstantUtc, readOnZone(ctx, state, candidate))} · {readOnZone(ctx, state, candidate)}
          </p>
        ) : null}
        {reminder ? <p className="muted">Now: {dueLines(reminder.current?.dueAtUtc ?? reminderInstant(reminder), reminder.zoneId, null).primary}</p> : null}
        {orders.length > 0 ? (
          <fieldset className="choice-group">
            <legend>Date order</legend>
            {orders.map((o) => (
              <label key={o.value} className="radio">
                <input type="radio" name="date-order" checked={state.choices.order === o.value} onChange={() => dispatch({ type: 'choice', choices: { order: o.value } })} />
                {o.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {meridiems.length > 0 ? (
          <fieldset className="choice-group">
            <legend>Time of day</legend>
            {meridiems.map((o) => (
              <label key={o.value} className="radio">
                <input type="radio" name="time-of-day" checked={state.choices.meridiem === o.value} onChange={() => dispatch({ type: 'choice', choices: { meridiem: o.value } })} />
                {o.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {abbreviation ? (
          <div className="abbreviation-choice" role="group" aria-label="Time zone suggestions">
            <p>“{abbreviation.abbr}” can mean more than one time zone. Choose one.</p>
            {abbreviation.suggestions.map((zoneId) => (
              <button key={zoneId} type="button" className="btn btn-small" onClick={() => dispatch({ type: 'zone', zoneId })}>
                {zoneId}
              </button>
            ))}
          </div>
        ) : null}
        {candidate && missing.includes('time') ? <p className="muted">Enter a time</p> : null}
        <div className="form-row">
          <Field label="Date">
            {(id) => <input id={id} type="date" className="text-input" value={form.date} onChange={(e) => dispatch({ type: 'date', value: e.target.value })} />}
          </Field>
          <Field label="Time">
            {(id) => <input id={id} type="time" className="text-input" value={form.time} onChange={(e) => dispatch({ type: 'time', value: e.target.value })} />}
          </Field>
        </div>
        {isValidLocalDate(form.date) ? <p className="date-line">{formatLongDate(form.date)}</p> : null}
        {disclosure ? <p className="muted disclosure">{disclosure}</p> : null}
        <ZoneField zoneId={form.zoneId} zones={loaded.zones.zones} onChange={(zoneId) => dispatch({ type: 'zone', zoneId })} />
        <PreviewBlock preview={preview} form={form} onChange={(patch) => dispatch({ type: 'fields', patch })} />
        <RepeatFields form={form} onChange={(patch) => dispatch({ type: 'fields', patch })} />
        <FollowupFields form={form} onChange={(patch) => dispatch({ type: 'fields', patch })} />
        {askPending ? <PendingPolicyField value={pendingPolicy} onChange={setPendingPolicy} /> : null}
        {isPast(ctx, state) ? (
          <div className="dialog-warning" role="alert">
            <span>{PAST_TEXT}</span>
            {offersNextYear(ctx, state) ? (
              <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'choice', choices: { useNextYear: true } })}>
                Use next year
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        {offerNoteLevel ? (
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void submit({ blockId: null })}>
            Attach to the note instead
          </button>
        ) : null}
        <div className="dialog-actions">
          {problem ? <span className="muted dialog-hint">{problem}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={problem !== null || busy}>
            {submitLabel}
          </button>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
