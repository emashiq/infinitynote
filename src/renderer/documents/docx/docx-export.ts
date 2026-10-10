import { DocxExportError, type DocxEditorHandle } from '@portone/docx-editor';
import { DOCX_MESSAGES, exportProblemMessage } from './docx-messages';

export type DocxExport = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

/**
 * The bytes to save, written by the editor from the document on screen into the package it opened, so every part the
 * edits did not touch goes back byte for byte (D-142). The editor's own checks run first: a document it would refuse
 * to write is not saved, and the user is told why in words, never with a partial file.
 */
export function exportForSave(handle: Pick<DocxEditorHandle, 'exportBytes' | 'exportProblems'>): DocxExport {
  const [problem] = handle.exportProblems();
  if (problem) return { ok: false, message: exportProblemMessage(problem) };
  try {
    return { ok: true, bytes: handle.exportBytes() };
  } catch (err) {
    if (!(err instanceof DocxExportError)) throw err;
    return { ok: false, message: err.problem ? exportProblemMessage(err.problem) : DOCX_MESSAGES.unwritable };
  }
}
