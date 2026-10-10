import path from 'node:path';

/** Adds the extension a save dialog was asked for; some Linux dialogs return the typed name without it. */
export function withExtension(file: string, extension: string): string {
  return path.extname(file).toLowerCase() === `.${extension}` ? file : `${file}.${extension}`;
}
