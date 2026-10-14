import { useCallback, useEffect } from 'react';
import type { ZoomAction } from '../../shared/zoom';
import { matchShortcut } from '../state/shortcuts';
import { useServices } from '../state/use-store';
import { useZoomKeys } from '../zoom/use-zoom-keys';

const ZOOM_COMMANDS = { in: 'view.zoomIn', out: 'view.zoomOut', reset: 'view.zoomReset' } as const;

/**
 * One capture-phase keydown listener for application shortcuts. Modal dialogs (not drawers) handle their own keys.
 * The zoom keys listen in the bubble phase, after the viewers that zoom their own page (D-186).
 */
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
  useZoomKeys(useCallback((action: ZoomAction) => void commands.run(ZOOM_COMMANDS[action]), [commands]));
  return null;
}
