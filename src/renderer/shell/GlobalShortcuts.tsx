import { useEffect } from 'react';
import { matchShortcut } from '../state/shortcuts';
import { useServices } from '../state/use-store';

/** One capture-phase keydown listener for application shortcuts. Modal dialogs (not drawers) handle their own keys. */
export function GlobalShortcuts() {
  const { commands } = useServices();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      const modal = target?.closest?.('dialog[open]:not(.drawer)');
      if (modal) return;
      const id = matchShortcut(e);
      if (!id) return;
      e.preventDefault();
      void commands.run(id);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [commands]);
  return null;
}
