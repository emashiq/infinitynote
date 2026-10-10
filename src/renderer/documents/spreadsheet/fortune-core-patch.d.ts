import '@fortune-sheet/core';

declare module '@fortune-sheet/core' {
  /** How FortuneSheet reads typed text: what the cell shows, its format and type, and its value. */
  export type TextValue = [shown: string, cellType: { fa: string; t: string }, value: number | string | boolean];

  /**
   * Added by the build patch (fortune-sheet-patch.config.ts, D-184): reads typed text before FortuneSheet does; the
   * parser returns null to leave the text to FortuneSheet, and null as the parser removes it.
   */
  export function setTextValueParser(parse: ((text: string) => TextValue | null) | null): void;
}
