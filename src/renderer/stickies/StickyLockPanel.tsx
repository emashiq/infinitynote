import { Lock } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { MAX_PIN_DIGITS, type StickyLockStateType } from '../../shared/contracts/locks';
import { ErrorLine } from '../notes/LockDialogs';
import type { StickyLockActions } from './sticky-services';

export const STICKY_LOCK_TEXT = {
  blurred: 'This sticky is locked.',
  pin: 'Enter the PIN to show the text.',
  password: 'Enter the password to show the text.',
  keyGone: 'The note was locked again, so its password (or Windows Hello) is needed. The PIN works again after that.',
  pinBlocked: 'Too many wrong PINs. Enter the password (or use Windows Hello).',
} as const;

/** Lines of different lengths under a frosted panel: the shape of text, none of its content. */
const PLACEHOLDER_LINES = [92, 78, 85, 60, 88, 70, 45];

/**
 * The body of a blurred locked sticky (D-172): a frosted placeholder (the note's text is not in the window at all) and
 * the field that asks main to show it. The PIN is offered only while the note's key is in memory and fewer than five
 * wrong PINs were typed in a row; otherwise the password or Windows Hello, and the panel says why.
 */
export function StickyLockPanel({ state, actions }: { state: StickyLockStateType; actions: StickyLockActions }) {
  const id = useId();
  const pinUsable = state.pinSet && state.keyInMemory && !state.pinBlocked;
  const [usePassword, setUsePassword] = useState(false);
  const mode = pinUsable && !usePassword ? 'pin' : 'password';
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (how: Parameters<StickyLockActions['reveal']>[0]) => {
    setBusy(true);
    setError(null);
    const failed = await actions.reveal(how);
    setBusy(false);
    setSecret('');
    setError(failed);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (secret === '') return;
    void run(mode === 'pin' ? { kind: 'pin', pin: secret } : { kind: 'password', password: secret });
  };
  const why = state.pinSet && !state.keyInMemory ? STICKY_LOCK_TEXT.keyGone : state.pinBlocked ? STICKY_LOCK_TEXT.pinBlocked : null;

  return (
    <div className="sticky-locked" data-testid="sticky-locked">
      <div className="sticky-blur" aria-hidden="true">
        {PLACEHOLDER_LINES.map((width, i) => (
          <span key={i} className="sticky-blur-line" style={{ width: `${width}%` }} />
        ))}
      </div>
      <form className="sticky-unlock" onSubmit={submit}>
        <Lock size={18} strokeWidth={1.75} aria-hidden className="sticky-unlock-icon" />
        <p className="sticky-unlock-title">{STICKY_LOCK_TEXT.blurred}</p>
        <p className="muted sticky-unlock-hint">{why ?? (mode === 'pin' ? STICKY_LOCK_TEXT.pin : STICKY_LOCK_TEXT.password)}</p>
        <label htmlFor={id} className="sr-only">
          {mode === 'pin' ? 'PIN' : 'Password'}
        </label>
        <span className="sticky-unlock-row">
          <input
            id={id}
            key={mode}
            type="password"
            className="text-input"
            placeholder={mode === 'pin' ? 'PIN' : 'Password'}
            autoComplete={mode === 'pin' ? 'off' : 'current-password'}
            spellCheck={false}
            autoFocus
            {...(mode === 'pin' ? { inputMode: 'numeric' as const, maxLength: MAX_PIN_DIGITS } : {})}
            value={secret}
            onChange={(e) => setSecret(mode === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || secret === ''}>
            Show
          </button>
        </span>
        <span className="sticky-unlock-row">
          {pinUsable ? (
            <button type="button" className="btn btn-small" onClick={() => setUsePassword(!usePassword)}>
              {usePassword ? 'Use the PIN' : 'Use the password'}
            </button>
          ) : null}
          {state.hello ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void run({ kind: 'hello' })}>
              Use Windows Hello
            </button>
          ) : null}
        </span>
        <ErrorLine error={error} />
      </form>
    </div>
  );
}
