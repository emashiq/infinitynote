import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';
import { LOCK_MESSAGES, type LockStatusType, type OsKeyAvailabilityType } from '../../shared/contracts/locks';
import { displayTitle } from '../../shared/names';
import { Dialog } from '../ui/Dialog';
import { LOCK_DIALOG_POINTS, newPasswordProblem, NO_RECOVERY } from './lock-form';

type LockBridge = Pick<InfinityBridge, 'lock' | 'sticky'>;

interface LockDialogProps {
  noteId: string;
  title: string;
  bridge: LockBridge;
  /** Saves the open note first, so nothing typed is left out of the lock. */
  flush: () => Promise<unknown>;
  notify: (message: string) => void;
  onClose: () => void;
}

function PasswordField({ label, value, onChange, autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
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

function ErrorLine({ error }: { error: string | null }) {
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

/**
 * "Lock note…" (D-111): the password twice, Windows Hello where available, what locking keeps and destroys, and the
 * no-recovery acknowledgement. A sticky is removed from stickies first (a locked note never floats).
 */
export function LockNoteDialog({ noteId, title, sticky, bridge, flush, notify, onClose }: LockDialogProps & { sticky: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hello, setHello] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const osKey = useOsKey(bridge);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirm) ?? (acknowledged ? null : LOCK_MESSAGES.acknowledge);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    await flush();
    if (sticky) {
      const removed = await bridge.sticky.remove({ noteId });
      if (!removed.ok) {
        setBusy(false);
        setError(removed.error.message);
        return;
      }
    }
    const failed = await attempt(() => bridge.lock.set({ noteId, password, hello: hello && osKey?.status === 'available', acknowledged: true }));
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    notify('Note locked');
    onClose();
  };
  return (
    <Dialog title={`Lock “${displayTitle(title)}”`} onClose={onClose}>
      <form className="lock-form" onSubmit={(e) => void submit(e)}>
        <ul className="lock-points">
          {LOCK_DIALOG_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
          {sticky ? <li>This sticky is removed from stickies first: locked notes do not float.</li> : null}
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
        <label className="checkbox">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          {NO_RECOVERY}
        </label>
        <ErrorLine error={error} />
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Locking…' : 'Lock note'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
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

/** "Lock settings…" of a locked note: lock now, change the password, Windows Hello on or off, remove the lock. */
export function LockSettingsDialog({ noteId, title, bridge, flush, notify, onClose }: LockDialogProps) {
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
