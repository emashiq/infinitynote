import { maxBytes } from './limits';

/** "When adding files" (D-108): ask each time, or always copy into Infinity Notes, or always link to the original. */
export const ADD_FILES_MODES = ['ask', 'copy', 'link'] as const;
export type AddFilesMode = (typeof ADD_FILES_MODES)[number];
export type AddAction = 'copy' | 'link';

/** What decides how a document can be added: its size and whether main can see its path. */
export interface ChoiceFile {
  sizeBytes: number;
  /** A file from disk (dropped, pasted from a file manager or picked); clipboard data without a path is not. */
  linkable: boolean;
}

/** Only files up to the copy limit are copied; larger ones are linked (D-108). */
export function canCopy(file: ChoiceFile, copyLimitMb: number): boolean {
  return file.sizeBytes <= maxBytes(copyLimitMb);
}

/**
 * How one document is added once the preferred action is known: the preferred one when the file allows it, else the
 * other one, or null when the file can be neither copied (too large) nor linked (no path).
 */
export function actionFor(file: ChoiceFile, preferred: AddAction, copyLimitMb: number): AddAction | null {
  const copy = canCopy(file, copyLimitMb);
  if (preferred === 'copy' ? copy : file.linkable) return preferred;
  if (preferred === 'copy') return file.linkable ? 'link' : null;
  return copy ? 'copy' : null;
}

/** "Ask" shows the dialog whenever a file could be linked; clipboard data without a path is simply copied. */
export function needsChoice(mode: AddFilesMode, files: readonly ChoiceFile[]): boolean {
  return mode === 'ask' && files.some((f) => f.linkable);
}
