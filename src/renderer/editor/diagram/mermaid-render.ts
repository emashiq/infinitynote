import mermaid from 'mermaid';
import { MAX_DIAGRAM_EDGES, MAX_DIAGRAM_SOURCE } from './diagram-limits';

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Draws Mermaid source as SVG (D-158), one drawing at a time (Mermaid keeps global state while it draws). Strict
 * security: Mermaid sanitizes labels, runs no click handlers or scripts and loads nothing; labels are SVG text, not
 * HTML, so the drawing can also become a PNG. Throws Mermaid's parse error for invalid source.
 */
export function renderMermaid(source: string, theme: 'light' | 'dark', fontFamily: string): Promise<string> {
  const draw = async (): Promise<string> => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily,
      maxTextSize: MAX_DIAGRAM_SOURCE,
      maxEdges: MAX_DIAGRAM_EDGES,
      suppressErrorRendering: true,
    });
    seq += 1;
    const { svg } = await mermaid.render(`infinity-diagram-${seq}`, source);
    return svg;
  };
  const result = queue.then(draw, draw);
  queue = result.catch(() => undefined);
  return result;
}
