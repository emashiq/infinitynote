import { useEffect, useLayoutEffect, useState, type HTMLAttributes, type RefObject } from 'react';
import { placeFloating, type Box } from './placement';

/**
 * A box floated next to part of the text. It lives in the editor surface (inside the scrolling area), so it scrolls
 * with the text; it is placed after every render and when the window is resized.
 */
export function Floating({
  anchor,
  side,
  align,
  elementRef,
  className,
  children,
  ...attrs
}: {
  /** The screen box to float next to, read at placement time. */
  anchor: () => Box;
  side: 'above' | 'below';
  align: 'center' | 'start';
  elementRef: RefObject<HTMLDivElement | null>;
} & HTMLAttributes<HTMLDivElement>) {
  const [, setResized] = useState(0);
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const el = elementRef.current;
    const surface = el?.offsetParent;
    if (!el || !(surface instanceof HTMLElement)) return;
    const { left, top } = placeFloating({
      target: anchor(),
      size: { width: el.offsetWidth, height: el.offsetHeight },
      surface: surface.getBoundingClientRect(),
      viewport: (surface.parentElement ?? surface).getBoundingClientRect(),
      side,
      align,
    });
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  return (
    <div ref={elementRef} className={`floating ${className ?? ''}`.trim()} {...attrs}>
      {children}
    </div>
  );
}
