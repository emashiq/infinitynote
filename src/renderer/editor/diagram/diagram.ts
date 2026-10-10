import DOMPurify from 'dompurify';
import { DIAGRAM_MESSAGES, DIAGRAM_TIMEOUT_MS, MAX_DIAGRAM_SOURCE } from './diagram-limits';

export type DiagramResult = { ok: true; svg: string } | { ok: false; error: string };

export type DiagramRenderer = (source: string, theme: 'light' | 'dark', fontFamily: string) => Promise<string>;

/** Mermaid loads only when the first diagram is drawn (its own chunk). */
const loadMermaid: () => Promise<DiagramRenderer> = () => import('./mermaid-render').then((m) => m.renderMermaid);

/** The first lines of Mermaid's message, which say where the source is wrong. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lines = message.split('\n').filter((l) => l.trim() !== '').slice(0, 4).join('\n');
  return lines === '' ? DIAGRAM_MESSAGES.failed : lines.slice(0, 400);
}

/** The drawing as SVG only: scripts, event handlers, foreign content and links are removed again after Mermaid. */
export function cleanSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style'], FORBID_TAGS: ['foreignObject', 'a', 'image'], FORBID_ATTR: ['href', 'xlink:href'] });
}

/**
 * Draws a diagram within its bounds (D-158): a source over the limit is not drawn, a drawing that takes over the time
 * limit is reported (Mermaid cannot be interrupted, so its result is then ignored), and invalid source gives Mermaid's
 * message.
 */
export async function drawDiagram(source: string, theme: 'light' | 'dark', fontFamily: string, render: () => Promise<DiagramRenderer> = loadMermaid): Promise<DiagramResult> {
  if (source.trim() === '') return { ok: false, error: DIAGRAM_MESSAGES.empty };
  if (source.length > MAX_DIAGRAM_SOURCE) return { ok: false, error: DIAGRAM_MESSAGES.tooLong };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DiagramResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: DIAGRAM_MESSAGES.timedOut }), DIAGRAM_TIMEOUT_MS);
  });
  const drawing = render()
    .then((draw) => draw(source, theme, fontFamily))
    .then((svg): DiagramResult => ({ ok: true, svg: cleanSvg(svg) }))
    .catch((err: unknown): DiagramResult => ({ ok: false, error: errorText(err) }));
  try {
    return await Promise.race([drawing, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
