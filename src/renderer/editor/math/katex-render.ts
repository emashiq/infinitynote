import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * KaTeX settings for every formula (D-161): no trusted commands (`\href`, `\url`, `\includegraphics`, `\html*` stay
 * errors), non-standard input accepted without console noise, and bounded sizes and macro expansion.
 */
export const KATEX_OPTIONS = { trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500, throwOnError: true } as const;

/** Draws TeX into an element with DOM calls (no HTML parsing); throws KaTeX's parse error. */
export function renderMath(latex: string, element: HTMLElement, displayMode: boolean): void {
  katex.render(latex, element, { ...KATEX_OPTIONS, displayMode });
}

/** The formula as HTML and MathML, for exports (D-163). */
export function mathToHtml(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
}
