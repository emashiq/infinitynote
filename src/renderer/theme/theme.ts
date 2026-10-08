export type ThemeSettingValue = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(setting: ThemeSettingValue, prefersDark: boolean): ResolvedTheme {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme;
}
