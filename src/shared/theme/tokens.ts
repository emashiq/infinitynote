export type ThemeName = 'light' | 'dark';

/**
 * The custom properties `tokens.css` gives a theme, as the cascade resolves them on the root element: blocks for the
 * bare `:root` first, then blocks for `:root[data-theme='<theme>']` (more specific, so they win). Lets main read the
 * same design tokens the renderer uses (D-097), with no second copy of a colour.
 */
export function themeTokens(css: string, theme: ThemeName): Map<string, string> {
  const base = new Map<string, string>();
  const themed = new Map<string, string>();
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = block[1]!.split(',').map((s) => s.trim());
    const target = selectors.includes(`:root[data-theme='${theme}']`) ? themed : selectors.includes(':root') ? base : null;
    if (!target) continue;
    for (const decl of block[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) target.set(decl[1]!, decl[2]!.trim());
  }
  return new Map([...base, ...themed]);
}

/** A token that must exist. */
export function tokenValue(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing design token ${name}`);
  return value;
}

/** A px-length token as its number. */
export function tokenPx(tokens: Map<string, string>, name: string): number {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(tokenValue(tokens, name));
  if (!m) throw new Error(`Design token ${name} is not a px length`);
  return Number(m[1]);
}
