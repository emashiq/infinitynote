/** Smooth scrolling unless the user asked the OS for reduced motion (INF-A11Y-05). */
export function scrollBehavior(matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis)): ScrollBehavior {
  return matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
