import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { documentLockTarget, type LockTarget } from '../notes/lock-target';
import { createActivityReporter } from '../state/activity-reporter';
import { realTimers } from '../state/store';

/** A document tab's lock (D-185): not locked, being checked, locked (the lock screen), or unlocked for this session. */
export type DocumentLockState = 'none' | 'checking' | 'locked' | 'unlocked';

/** Interaction that counts as working in an unlocked document, so its idle time starts again. */
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel', 'pointermove'] as const;

/**
 * The lock state of a document tab: asked from main whenever the document becomes locked, set to locked when main says
 * it locked again (idle time, Lock now, Lock all, the computer locking or sleeping), and unlocked by the lock screen.
 * While it is unlocked, interaction in the tab is reported to main (throttled), so the idle time counts from the
 * last use, not from the unlock.
 */
export function useDocumentLock(
  bridge: Pick<InfinityBridge, 'lock' | 'subscribe'>,
  documentId: string,
  locked: boolean,
  view: RefObject<HTMLElement | null>,
  now: () => number,
): { state: DocumentLockState; target: LockTarget; onUnlocked: () => void } {
  const target = useMemo(() => documentLockTarget(bridge, documentId), [bridge, documentId]);
  // What main last said of this document's key; null until it answered since the document became locked.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  useEffect(() => {
    if (!locked) return undefined;
    let live = true;
    void target.status().then((res) => {
      if (live && res.ok) setUnlocked(res.data.unlocked);
    });
    return () => {
      live = false;
      setUnlocked(null);
    };
  }, [locked, target]);
  useEffect(
    () =>
      bridge.subscribe('lock:documentLocked', (event) => {
        if (event.documentId === documentId) setUnlocked(false);
      }),
    [bridge, documentId],
  );
  const state: DocumentLockState = !locked ? 'none' : unlocked === null ? 'checking' : unlocked ? 'unlocked' : 'locked';

  useEffect(() => {
    const root = view.current;
    if (state !== 'unlocked' || !root) return undefined;
    const reporter = createActivityReporter(() => void bridge.lock.documentActivity({ documentId }), { timers: realTimers, now });
    const report = () => reporter.report();
    for (const type of ACTIVITY_EVENTS) root.addEventListener(type, report, { passive: true, capture: true });
    return () => {
      for (const type of ACTIVITY_EVENTS) root.removeEventListener(type, report, { capture: true });
      reporter.dispose();
    };
  }, [state, view, bridge, documentId, now]);

  const onUnlocked = useCallback(() => setUnlocked(true), []);
  return { state, target, onUnlocked };
}
