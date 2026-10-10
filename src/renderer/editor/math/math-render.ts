/** KaTeX loads with the first formula (its own chunk with its CSS and fonts). */
export const loadKatex = () => import('./katex-render');

/** KaTeX's message without its "KaTeX parse error:" prefix. */
export function mathError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'This formula could not be shown.';
  return message.replace(/^KaTeX parse error:\s*/, '').slice(0, 300);
}
