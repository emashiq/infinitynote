import { useEffect, useRef, type RefObject } from 'react';
import type { ZoomAction } from '../../shared/zoom';
import { createWheelStepper, zoomActionOf } from './zoom-input';

/**
 * A viewer that zooms its own content (PDF, Word, PowerPoint, web page; D-186): while the pointer (Ctrl+wheel) or the
 * focus (Ctrl+=, Ctrl+-, Ctrl+0) is inside `root`, the viewer zooms instead of the window, as browsers do in their PDF
 * viewer. Keys are taken in the capture phase, before the editors inside; the wheel listener is not passive, so the
 * page keeps the event and main does not zoom the window. `zoom` null leaves both to the window (the viewer is loading).
 */
export function useViewerZoom(root: RefObject<HTMLElement | null>, zoom: ((action: ZoomAction) => void) | null): void {
  const current = useRef(zoom);
  useEffect(() => {
    current.current = zoom;
  });
  const active = zoom !== null;
  useEffect(() => {
    const element = root.current;
    if (!element || !active) return undefined;
    const step = createWheelStepper();
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const direction = step(e);
      if (direction !== 0) current.current?.(direction > 0 ? 'in' : 'out');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const action = zoomActionOf(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      current.current?.(action);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('keydown', onKeyDown, true);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKeyDown, true);
    };
  }, [root, active]);
}
