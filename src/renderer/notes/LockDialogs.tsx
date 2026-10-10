import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';
import type { LocationType, NoteDtoType } from '../../shared/contracts/hierarchy';
import { DOCUMENT_LOCK_MESSAGES, LOCK_MESSAGES, MAX_PIN_DIGITS, type OsKeyAvailabilityType } from '../../shared/contracts/locks';
import { displayTitle } from '../../shared/names';
import { Dialog } from '../ui/Dialog';
import { CREATE_LOCKED_POINTS, DOCUMENT_LOCK_POINTS, LINKED_COPY_POINT, LOCK_DIALOG_POINTS, newPasswordProblem, newPinProblem, NO_RECOVERY, PIN_EXPLANATION } from './lock-form';
import type { LockTarget, LockTargetStatus } from './lock-target';

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
async function attempt(call: () => Promise<Result<unknown>>): Promise<string | null> {
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

/**
 * "Lock…" of a document (D-185): what locking keeps and destroys, then the new lock. A linked file is copied into
 * Infinity Notes to be locked; one over the copy limit cannot be, and the dialog says why instead of offering it.
 */
export function LockDocumentDialog({
  documentId,
  title,
  linked,
  copyLimitMb,
  sizeBytes,
  bridge,
  flush,
  notify,
  onClose,
}: {
  documentId: string;
  title: string;
  linked: boolean;
  /** The "copy into Infinity Notes" limit (Settings), which a linked file must fit to be locked. */
  copyLimitMb: number;
  sizeBytes: number;
  bridge: LockBridge;
  /** Saves the open document's edits first, so nothing is left out of the lock. */
  flush: () => Promise<unknown>;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const tooLarge = linked && sizeBytes > copyLimitMb * 1024 * 1024;
  const submit = async ({ password, hello }: NewLockChoice) => {
    await flush();
    const failed = await attempt(() => bridge.lock.documentSet({ documentId, password, hello, acknowledged: true, copyIn: linked }));
    if (failed) return failed;
    notify('Document locked');
    onClose();
    return null;
  };
  return (
    <Dialog title={`Lock “${displayTitle(title)}”`} onClose={onClose}>
      {tooLarge ? (
        <div className="lock-form">
          <p role="alert">{DOCUMENT_LOCK_MESSAGES.linkedTooLarge(copyLimitMb)}</p>
          <div className="dialog-actions">
            <button type="button" className="btn" data-autofocus="" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <NewLockForm
          points={linked ? [LINKED_COPY_POINT, ...DOCUMENT_LOCK_POINTS] : DOCUMENT_LOCK_POINTS}
          offerPin={false}
          submitLabel={linked ? 'Copy in and lock' : 'Lock document'}
          busyLabel="Locking…"
          bridge={bridge}
          submit={submit}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

/**
 * "Lock settings…" of a locked note or document: lock now, change the password, Windows Hello on or off, the sticky PIN
 * (when `pin` is given: a sticky), remove the lock.
 */
export function LockSettingsDialog({
  target,
  title,
  bridge,
  flush,
  notify,
  onClose,
  pin,
}: {
  target: LockTarget;
  title: string;
  bridge: LockBridge;
  /** Saves the open item first, so nothing typed is lost when it locks or its lock is removed. */
  flush: () => Promise<unknown>;
  notify: (message: string) => void;
  onClose: () => void;
  /** Sets or clears a sticky's PIN (D-173); resolves with the message to show when main refused. */
  pin?: (password: string, pin: string | null) => Promise<string | null>;
}) {
  const [status, setStatus] = useState<LockTargetStatus | null>(null);
  const osKey = useOsKey(bridge);
  const noun = target.noun;
  const Noun = noun === 'note' ? 'Note' : 'Document';
  // Read again after a PIN change (a new count).
  const [statusReads, setStatusReads] = useState(0);
  useEffect(() => {
    let live = true;
    void target.status().then((res) => {
      if (live && res.ok) setStatus(res.data);
    });
    return () => {
      live = false;
    };
  }, [target, statusReads]);
  const done = (message: string) => {
    notify(message);
    onClose();
  };
  return (
    <Dialog title={`Lock settings for “${displayTitle(title)}”`} onClose={onClose}>
      <div className="lock-form">
        {status?.unlocked ? (
          <Section title="Lock now">
            <p className="muted">The {noun} is unlocked until you lock it, after the idle time in Settings, or when the computer locks or sleeps.</p>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void flush()
                  .then(() => target.lockNow())
                  .then((res) => (res.ok ? done(`${Noun} locked`) : notify(res.error.message)))
              }
            >
              Lock now
            </button>
          </Section>
        ) : null}
        <ChangePassword target={target} onDone={() => done('Password changed')} />
        <HelloSetting
          target={target}
          enabled={status?.hello ?? false}
          osKey={osKey}
          onDone={(on) => done(on ? `Windows Hello can unlock this ${noun}` : `Windows Hello no longer unlocks this ${noun}`)}
        />
        {pin ? (
          <PinSection
            pinSet={status?.pin ?? false}
            save={async (password, next) => {
              const failed = await pin(password, next);
              if (failed) return failed;
              setStatusReads((n) => n + 1);
              notify(next === null ? 'PIN removed' : 'PIN set');
              return null;
            }}
          />
        ) : null}
        <RemoveLock target={target} flush={flush} onDone={() => done('Lock removed')} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ChangePassword({ target, onDone }: { target: LockTarget; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(next, confirm);
    if (problem) return setError(problem);
    const failed = await attempt(() => target.changePassword(current, next));
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

function HelloSetting({ target, enabled, osKey, onDone }: { target: LockTarget; enabled: boolean; osKey: OsKeyAvailabilityType | null; onDone: (enabled: boolean) => void }) {
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
    const failed = await attempt(() => target.setHello(password, !enabled));
    if (failed) {
      setPassword('');
      return setError(failed);
    }
    onDone(!enabled);
  };
  return (
    <Section title="Windows Hello">
      <p className="muted">{enabled ? `Windows Hello can unlock this ${target.noun}.` : `Unlock this ${target.noun} with Windows Hello as well as the password.`}</p>
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

/** What stays gone when a lock is removed, by kind. */
const REMOVED_LOCK_TEXT = {
  note: 'The text is stored unencrypted again from now on. Version history deleted when the note was locked stays deleted.',
  document: 'The file is stored unencrypted again from now on and its text is searchable again. Versions deleted when the document was locked stay deleted.',
} as const;

function RemoveLock({ target, flush, onDone }: { target: LockTarget; flush: () => Promise<unknown>; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await flush();
    const failed = await attempt(() => target.remove(password));
    if (failed) {
      setPassword('');
      return setError(failed);
    }
    onDone();
  };
  return (
    <Section title="Remove lock">
      <p className="muted">{REMOVED_LOCK_TEXT[target.noun]}</p>
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
