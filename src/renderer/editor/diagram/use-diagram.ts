import { useEffect, useState } from 'react';
import { useAppliedTheme } from '../../theme/use-applied-theme';
import { DIAGRAM_DEBOUNCE_MS } from './diagram-limits';
import { drawDiagram, type DiagramResult } from './diagram';

/** The drawing of the source in the window's theme, drawn again a moment after the source or the theme changes. */
export function useDiagram(source: string): { result: DiagramResult | null; theme: 'light' | 'dark' } {
  const theme = useAppliedTheme();
  const [result, setResult] = useState<DiagramResult | null>(null);
  useEffect(() => {
    let stale = false;
    const handle = setTimeout(() => {
      const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
      void drawDiagram(source, theme, font).then((r) => {
        if (!stale) setResult(r);
      });
    }, DIAGRAM_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
  }, [source, theme]);
  return { result, theme };
}
