import { useEffect } from 'react';
import type { ZoomAction } from '../../shared/zoom';
import { zoomActionOf } from './zoom-input';

/**
 * The window's zoom keys (D-186). The listener runs in the bubble phase, after a viewer that zooms its own content
 * (useViewerZoom) has taken the keys pressed inside it. Ctrl+wheel needs no listener: main zooms on the wheel events the
 * page leaves unhandled.
 */
export function useZoomKeys(zoom: (action: ZoomAction) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = zoomActionOf(e);
      if (!action) return;
      e.preventDefault();
      zoom(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoom]);
}
