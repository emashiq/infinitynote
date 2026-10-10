import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';
import type { LocationType, NoteDtoType } from '../../shared/contracts/hierarchy';
import { LOCK_MESSAGES, MAX_PIN_DIGITS, type LockStatusType, type OsKeyAvailabilityType } from '../../shared/contracts/locks';
import { displayTitle } from '../../shared/names';
import { Dialog } from '../ui/Dialog';
import { CREATE_LOCKED_POINTS, LOCK_DIALOG_POINTS, newPasswordProblem, newPinProblem, NO_RECOVERY, PIN_EXPLANATION } from './lock-form';

type LockBridge = Pick<InfinityBridge, 'lock'>;

interface LockDialogProps {
  noteId: string;
  title: string;
  bridge: LockBridge;
  /** Saves the open note first, so nothing typed is left out of the lock. */
  flush: () => Promise<unknown>;
  notify: (message: string) => void;
  onClose: () => void;
}

export function PasswordField({ label, value, onChange, autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const id = useId();
  return (
    <span className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="password"
        className="text-input"
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        {...(autoFocus ? { 'data-autofocus': '' } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="field-error">
      {error}
    </p>
  ) : null;
}

/** Runs a lock call and turns its failure into the message to show; the password fields are cleared by the caller. */
async function attempt(call: () => Promise<Result<LockStatusType>>): Promise<string | null> {
  const res = await call();
  return res.ok ? null : res.error.message;
}

/** Windows Hello where the platform can verify it; otherwise why only a password is offered. */
function useOsKey(bridge: LockBridge): OsKeyAvailabilityType | null {
  const [availability, setAvailability] = useState<OsKeyAvailabilityType | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.lock.availability().then((res) => {
      if (live) setAvailability(res.ok ? res.data : { status: 'unavailable', reason: res.error.message });
    });
    return () => {
      live = false;
    };
  }, [bridge]);
  return availability;
}

/** A PIN typed twice (digits only, at most 8). */
function PinFields({ pin, confirm, onPin, onConfirm }: { pin: string; confirm: string; onPin: (v: string) => void; onConfirm: (v: string) => void }) {
  return (
    <>
      <PinInput label="PIN (4 to 8 digits)" value={pin} onChange={onPin} />
      <PinInput label="Repeat PIN" value={confirm} onChange={onConfirm} />
    </>
  );
}

function PinInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <span className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        maxLength={MAX_PIN_DIGITS}
        className="text-input"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </span>
  );
}

/** What a new lock is made of, as the form collected it. */
export interface NewLockChoice {
  password: string;
  hello: boolean;
  pin: string | null;
}

/**
 * The fields of a new lock (D-111, D-113, D-173): the password twice, Windows Hello where it can be verified, an optional
 * sticky PIN, and the no-recovery acknowledgement. `submit` resolves with the message to show when it failed.
 */
function NewLockForm({
  points,
  offerPin,
  submitLabel,
  busyLabel,
  bridge,
  submit,
  onClose,
}: {
  points: readonly string[];
  offerPin: boolean;
  submitLabel: string;
  busyLabel: string;
  bridge: LockBridge;
  submit: (choice: NewLockChoice) => Promise<string | null>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [hello, setHello] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const osKey = useOsKey(bridge);
  const wantsPin = offerPin && (pin !== '' || pinConfirm !== '');
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirm) ?? (wantsPin ? newPinProblem(pin, pinConfirm) : null) ?? (acknowledged ? null : LOCK_MESSAGES.acknowledge);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const failed = await submit({ password, hello: hello && osKey?.status === 'available', pin: wantsPin ? pin : null });
    setBusy(false);
    setError(failed);
  };
  return (
    <form className="lock-form" onSubmit={(e) => void onSubmit(e)}>
      <ul className="lock-points">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
      <PasswordField label="Repeat password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {osKey?.status === 'available' ? (
        <label className="checkbox">
          <input type="checkbox" checked={hello} onChange={(e) => setHello(e.target.checked)} />
          Also unlock with Windows Hello (the password stays required as a fallback)
        </label>
      ) : osKey ? (
        <p className="muted lock-oskey-reason">{osKey.reason}</p>
      ) : null}
      {offerPin ? (
        <fieldset className="lock-pin">
          <legend className="field-label">Sticky PIN (optional)</legend>
          <p className="muted">{PIN_EXPLANATION}</p>
          <PinFields pin={pin} confirm={pinConfirm} onPin={setPin} onConfirm={setPinConfirm} />
        </fieldset>
      ) : null}
      <label className="checkbox">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        {NO_RECOVERY}
      </label>
      <ErrorLine error={error} />
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * "Lock note…" (D-111): what locking keeps and destroys, then the new lock. A floating sticky stays floating and blurs
 * (D-172); a sticky may get a PIN.
 */
export function LockNoteDialog({ noteId, title, sticky, bridge, flush, notify, onClose }: LockDialogProps & { sticky: boolean }) {
  const submit = async ({ password, hello, pin }: NewLockChoice) => {
    await flush();
    const failed = await attempt(() => bridge.lock.set({ noteId, password, hello, acknowledged: true, pin }));
    if (failed) return failed;
    notify('Note locked');
    onClose();
    return null;
  };
  return (
    <Dialog title={`Lock “${displayTitle(title)}”`} onClose={onClose}>
      <NewLockForm
        points={sticky ? [...LOCK_DIALOG_POINTS, 'The sticky keeps floating. Its text is blurred until you show it with the PIN, the password or Windows Hello.'] : LOCK_DIALOG_POINTS}
        offerPin={sticky}
        submitLabel="Lock note"
        busyLabel="Locking…"
        bridge={bridge}
        submit={submit}
        onClose={onClose}
      />
    </Dialog>
  );
}

/**
 * "New locked note" and "New locked sticky" (D-171): the password first; main then creates the note already locked.
 * A note opens in a tab, a sticky floats (shown, since the password was just typed).
 */
export function CreateLockedDialog({
  location,
  sticky,
  bridge,
  onCreated,
  onClose,
}: {
  location: LocationType;
  sticky: boolean;
  bridge: LockBridge;
  onCreated: (note: NoteDtoType) => void;
  onClose: () => void;
}) {
  const submit = async ({ password, hello, pin }: NewLockChoice) => {
    const res = await bridge.lock.create({ location, sticky, password, hello, acknowledged: true, pin });
    if (!res.ok) return res.error.message;
    onClose();
    onCreated(res.data.note);
    return null;
  };
  return (
    <Dialog title={sticky ? 'New locked sticky' : 'New locked note'} onClose={onClose}>
      <NewLockForm points={CREATE_LOCKED_POINTS} offerPin={sticky} submitLabel={sticky ? 'Create locked sticky' : 'Create locked note'} busyLabel="Creating…" bridge={bridge} submit={submit} onClose={onClose} />
    </Dialog>
  );
}

/**
 * Sets, changes or removes a sticky PIN (D-173); the password confirms it. Used in a sticky's menu and in the lock
 * settings of a locked note. `save` resolves with the message to show when main refused.
 */
export function PinSection({ pinSet, save }: { pinSet: boolean; save: (password: string, pin: string | null) => Promise<string | null> }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (next: string | null) => {
    if (next !== null) {
      const problem = newPinProblem(pin, confirm);
      if (problem) return setError(problem);
    }
    const failed = await save(password, next);
    setPassword('');
    setError(failed);
    if (!failed) {
      setPin('');
      setConfirm('');
    }
  };
  return (
    <Section title="Sticky PIN">
      <p className="muted">{PIN_EXPLANATION}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(pin);
        }}
      >
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
        <ErrorLine error={error} />
        <span className="lock-pin-actions">
          <button type="submit" className="btn">
            {pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
          {pinSet ? (
            <button type="button" className="btn" disabled={password === ''} onClick={() => void run(null)}>
              Remove PIN
            </button>
          ) : null}
        </span>
      </form>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lock-section">
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  );
}

/** "Lock settings…" of a locked note: lock now, change the password, Windows Hello on or off, the sticky PIN, remove the lock. */
export function LockSettingsDialog({ noteId, title, sticky, bridge, flush, notify, onClose }: LockDialogProps & { sticky: boolean }) {
  const [status, setStatus] = useState<LockStatusType | null>(null);
  const osKey = useOsKey(bridge);
  useEffect(() => {
    let live = true;
    void bridge.lock.status({ noteId }).then((res) => {
      if (live && res.ok) setStatus(res.data);
    });
    return () => {
      live = false;
    };
  }, [bridge, noteId]);
  const done = (message: string) => {
    notify(message);
    onClose();
  };
  return (
    <Dialog title={`Lock settings for “${displayTitle(title)}”`} onClose={onClose}>
      <div className="lock-form">
        {status?.unlocked ? (
          <Section title="Lock now">
            <p className="muted">The note is unlocked until you lock it, after the idle time in Settings, or when the computer locks or sleeps.</p>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void flush()
                  .then(() => bridge.lock.lockNow({ noteId }))
                  .then((res) => (res.ok ? done('Note locked') : notify(res.error.message)))
              }
            >
              Lock now
            </button>
          </Section>
        ) : null}
        <ChangePassword noteId={noteId} bridge={bridge} onDone={() => done('Password changed')} />
        <HelloSetting noteId={noteId} bridge={bridge} enabled={status?.hello ?? false} osKey={osKey} onDone={(on) => done(on ? 'Windows Hello can unlock this note' : 'Windows Hello no longer unlocks this note')} />
        {sticky ? (
          <PinSection
            pinSet={status?.pin ?? false}
            save={async (password, pin) => {
              const res = await bridge.lock.setPin({ noteId, password, pin });
              if (!res.ok) return res.error.message;
              setStatus(res.data);
              notify(pin === null ? 'PIN removed' : 'PIN set');
              return null;
            }}
          />
        ) : null}
        <RemoveLock noteId={noteId} bridge={bridge} flush={flush} onDone={() => done('Lock removed')} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ChangePassword({ noteId, bridge, onDone }: { noteId: string; bridge: LockBridge; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(next, confirm);
    if (problem) return setError(problem);
    const failed = await attempt(() => bridge.lock.changePassword({ noteId, currentPassword: current, newPassword: next }));
    if (failed) {
      setCurrent('');
      return setError(failed);
    }
    onDone();
  };
  return (
    <Section title="Change password">
      <form onSubmit={(e) => void submit(e)}>
        <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField label="Repeat new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <ErrorLine error={error} />
        <button type="submit" className="btn">
          Change password
        </button>
      </form>
    </Section>
  );
}

function HelloSetting({
  noteId,
  bridge,
  enabled,
  osKey,
  onDone,
}: {
  noteId: string;
  bridge: LockBridge;
  enabled: boolean;
  osKey: OsKeyAvailabilityType | null;
  onDone: (enabled: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!enabled && osKey?.status !== 'available') {
    return (
      <Section title="Windows Hello">
        <p className="muted lock-oskey-reason">{osKey?.reason ?? ''}</p>
      </Section>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const failed = await attempt(() => bridge.lock.setHello({ noteId, password, enabled: !enabled }));
    if (failed) {
      setPassword('');
      return setError(failed);
    }
    onDone(!enabled);
  };
  return (
    <Section title="Windows Hello">
      <p className="muted">{enabled ? 'Windows Hello can unlock this note.' : 'Unlock this note with Windows Hello as well as the password.'}</p>
      <form onSubmit={(e) => void submit(e)}>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorLine error={error} />
        <button type="submit" className="btn">
          {enabled ? 'Turn off Windows Hello' : 'Use Windows Hello'}
        </button>
      </form>
    </Section>
  );
}

function RemoveLock({ noteId, bridge, flush, onDone }: { noteId: string; bridge: LockBridge; flush: () => Promise<unknown>; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await flush();
    const failed = await attempt(() => bridge.lock.remove({ noteId, password }));
    if (failed) {
      setPassword('');
      return setError(failed);
    }
    onDone();
  };
  return (
    <Section title="Remove lock">
      <p className="muted">The text is stored unencrypted again from now on. Version history deleted when the note was locked stays deleted.</p>
      <form onSubmit={(e) => void submit(e)}>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorLine error={error} />
        <button type="submit" className="btn">
          Remove lock
        </button>
      </form>
    </Section>
  );
}
