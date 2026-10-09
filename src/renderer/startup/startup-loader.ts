/** The loader in index.html (D-109); see styles/startup.css. */
export const STARTUP_LOADER_ID = 'startup-loader';
/** The fade-out, as in startup.css. */
const FADE_MS = 120;

/**
 * Removes the startup loader: after its short fade once the main window's shell is ready, or at once in stickies and
 * the widget, which render their own page right away. Does nothing when it is already gone.
 */
export function dismissStartupLoader({ fade }: { fade: boolean }): void {
  const loader = typeof document === 'undefined' ? null : document.getElementById(STARTUP_LOADER_ID);
  if (!loader) return;
  if (!fade || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    loader.remove();
    return;
  }
  loader.classList.add('is-done');
  setTimeout(() => loader.remove(), FADE_MS);
}
