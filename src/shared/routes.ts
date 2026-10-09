import { UUID_RE } from './contracts/ids';

export type Route = { kind: 'main' } | { kind: 'sticky'; noteId: string } | { kind: 'widget' } | { kind: 'invalid' };

const STICKY_PREFIX = '#/sticky/';
/** The reminder widget's window (D-081). */
export const WIDGET_HASH = '#/widget';

/**
 * The window route in the renderer URL hash: `#/` (or none) is the main window, `#/sticky/<uuid>` a sticky window and
 * `#/widget` the reminder widget.
 */
export function parseRoute(hash: string): Route {
  if (hash === '' || hash === '#' || hash === '#/') return { kind: 'main' };
  if (hash === WIDGET_HASH) return { kind: 'widget' };
  if (hash.startsWith(STICKY_PREFIX)) {
    const noteId = hash.slice(STICKY_PREFIX.length);
    if (UUID_RE.test(noteId)) return { kind: 'sticky', noteId };
  }
  return { kind: 'invalid' };
}

export function stickyHash(noteId: string): string {
  return `${STICKY_PREFIX}${noteId}`;
}
