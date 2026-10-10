import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../src/main/documents/text/pdf-text';
import { createPdfTextExtractor } from '../../src/main/documents/text/pdf-text-runner';

const FIXTURES = path.resolve('tests/fixtures/documents');
const bytes = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const WIDE = { maxPages: 1000, maxChars: 500_000 };
const CMAPS = path.resolve('node_modules/pdfjs-dist/cmaps');

describe('PDF text (D-129)', () => {
  it('reads every page in order, a blank line between pages', async () => {
    expect(await extractPdfText(bytes('sample-pages.pdf'), WIDE)).toBe('Alpha page introduces the plan\n\nBravo page lists the details\n\nCharlie page closes the summary');
    expect(await extractPdfText(bytes('sample.pdf'), WIDE, CMAPS)).toBe('Infinity Notes sample PDF\n\nSecond page of the sample');
  });

  it('stops at the page limit and once the character limit is reached', async () => {
    expect(await extractPdfText(bytes('sample-pages.pdf'), { maxPages: 2, maxChars: 500_000 })).toBe('Alpha page introduces the plan\n\nBravo page lists the details');
    expect(await extractPdfText(bytes('sample-pages.pdf'), { maxPages: 1000, maxChars: 10 })).toBe('Alpha page introduces the plan');
  });

  it('refuses a password-protected PDF (its text is never indexed) and a damaged one', async () => {
    await expect(extractPdfText(bytes('sample-protected.pdf'), WIDE)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(extractPdfText(bytes('sample-damaged.pdf'), WIDE)).rejects.toMatchObject({ name: 'InvalidPDFException' });
  });
});

describe('PDF text worker runner (D-129)', () => {
  const extract = createPdfTextExtractor({ workerFile: path.resolve('src/main/documents/text/pdf-text.ts'), cMapDir: CMAPS });

  it('reads the text in a worker thread', async () => {
    expect(await extract(path.join(FIXTURES, 'sample-pages.pdf'))).toContain('Bravo page lists the details');
  });

  it('reports only an error code for a protected, damaged or missing file', async () => {
    await expect(extract(path.join(FIXTURES, 'sample-protected.pdf'))).rejects.toMatchObject({ code: 'PasswordException' });
    await expect(extract(path.join(FIXTURES, 'sample-damaged.pdf'))).rejects.toMatchObject({ code: 'InvalidPDFException' });
    const missing = extract(path.join(FIXTURES, 'missing.pdf'));
    await expect(missing).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(missing).rejects.not.toMatchObject({ message: expect.stringContaining(FIXTURES) });
  });

  it('stops a worker that does not answer in time, and one that exits without answering', async () => {
    const silent = createPdfTextExtractor({ workerFile: path.resolve('tests/fixtures/workers/silent-worker.mjs'), cMapDir: CMAPS, timeoutMs: 300 });
    await expect(silent(path.join(FIXTURES, 'sample.pdf'))).rejects.toMatchObject({ code: 'TIMEOUT' });
    const exiting = createPdfTextExtractor({ workerFile: path.resolve('tests/fixtures/workers/exiting-worker.mjs'), cMapDir: CMAPS });
    await expect(exiting(path.join(FIXTURES, 'sample.pdf'))).rejects.toMatchObject({ code: 'EXITED' });
  });
});
