import { useSyncExternalStore } from 'react';
import { appliedTheme, type ResolvedTheme } from './theme';

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The theme applied to the window right now; components re-render when it changes (diagrams follow it, D-158). */
export function useAppliedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, () => appliedTheme(document.documentElement));
}
