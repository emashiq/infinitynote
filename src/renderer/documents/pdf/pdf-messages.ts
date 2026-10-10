/** What the PDF viewer says (F2). */
export const PDF_MESSAGES = {
  damaged: 'This file is not a readable PDF. It may be damaged, or not a PDF at all.',
  unreadable: 'The PDF could not be read. Its file may have been moved or deleted.',
  failed: 'The PDF could not be opened.',
  locked: 'This PDF is protected with a password.',
  passwordPrompt: 'Enter the password to open this PDF. Infinity Notes does not keep it.',
  wrongPassword: 'That password is not right. Try again.',
  extracted: (what: string, title: string): string => `Extracted ${what} to "${title}"`,
  inserted: (count: number, name: string): string => `Inserted ${count === 1 ? '1 page' : `${count} pages`} from ${name}`,
} as const;

/** The viewer's message for a document pdf.js could not open; password requests are handled before this. */
export function pdfLoadError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'InvalidPDFException') return PDF_MESSAGES.damaged;
  if (name === 'ResponseException' || name === 'MissingPDFException' || name === 'UnexpectedResponseException') return PDF_MESSAGES.unreadable;
  return PDF_MESSAGES.failed;
}
