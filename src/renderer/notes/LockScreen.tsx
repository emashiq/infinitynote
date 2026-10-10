import { Lock } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Result } from '../../shared/contracts/envelope';
import { displayTitle } from '../../shared/names';
import type { LockTarget, LockTargetStatus } from './lock-target';

/**
 * The tab of a locked note (D-111) or document (D-185): the title, a password field and, when it is set up, Windows
 * Hello. A wrong password gets one generic message; repeated failures make main wait before it accepts another try.
 */
export function LockScreen({ target, title, onUnlocked }: { target: LockTarget; title: string; onUnlocked: () => void }) {
  const id = useId();
  const [status, setStatus] = useState<LockTargetStatus | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void target.status().then((res) => {
      if (!live || !res.ok) return;
      setStatus(res.data);
      // Unlocked meanwhile (another view, or Windows Hello in a dialog): open it.
      if (!res.data.locked || res.data.unlocked) onUnlocked();
    });
    return () => {
      live = false;
    };
  }, [target, onUnlocked]);

  const run = async (call: () => Promise<Result<unknown>>) => {
    setBusy(true);
    setError(null);
    const res = await call();
    setBusy(false);
    setPassword('');
    if (res.ok) onUnlocked();
    else setError(res.error.message);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== '') void run(() => target.unlock(password));
  };
  return (
    <div className="note-empty lock-screen">
      <Lock size={32} strokeWidth={1.5} aria-hidden className="lock-screen-icon" />
      <h2 className="view-title">{displayTitle(title)}</h2>
      <p className="muted">This {target.noun} is locked.</p>
      <form className="lock-screen-form" onSubmit={submit}>
        <label htmlFor={id} className="sr-only">
          Password
        </label>
        <input
          id={id}
          type="password"
          className="text-input"
          placeholder="Password"
          autoComplete="current-password"
          spellCheck={false}
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || password === ''}>
          Unlock
        </button>
      </form>
      {status?.hello ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void run(() => target.unlockHello())}>
          Use Windows Hello
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
