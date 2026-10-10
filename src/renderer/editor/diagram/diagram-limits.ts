/** Bounds of a Mermaid diagram (D-158): longer sources are not drawn, and a drawing that takes longer is reported. */
export const MAX_DIAGRAM_SOURCE = 20_000;
export const MAX_DIAGRAM_EDGES = 1_000;
export const DIAGRAM_TIMEOUT_MS = 5_000;
/** How long typing in a diagram pauses before it is drawn again. */
export const DIAGRAM_DEBOUNCE_MS = 300;

export const DIAGRAM_MESSAGES = {
  tooLong: `This diagram is too long to draw (over ${MAX_DIAGRAM_SOURCE.toLocaleString('en')} characters).`,
  timedOut: 'This diagram took too long to draw.',
  empty: 'Write a Mermaid diagram to see it here.',
  failed: 'This diagram could not be drawn.',
  copied: 'Diagram copied',
  copyFailed: 'The diagram could not be copied.',
} as const;
