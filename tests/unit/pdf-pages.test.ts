import fs from 'node:fs';
import path from 'node:path';
import { degrees, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../src/main/documents/text/pdf-text';
import {
  deletePages,
  describePages,
  extractPages,
  insertBlankPage,
  insertPagesFrom,
  orderAfterMove,
  PDF_PAGE_MESSAGES,
  reorderPages,
  rotatePages,
} from '../../src/renderer/documents/pdf/pdf-pages';

const LIMITS = { maxPages: 100, maxChars: 100_000 };
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.resolve('tests/fixtures/documents', name)));

/** A generated PDF with one line of text per page, the second page landscape. */
async function pdfOf(texts: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  texts.forEach((text, i) => pdf.addPage(i === 1 ? [792, 612] : [612, 792]).drawText(text, { x: 72, y: 500, size: 20, font }));
  return pdf.save();
}
// pdf.js takes over the buffer it is given, so it reads a copy.
const pagesText = async (bytes: Uint8Array) => (await extractPdfText(bytes.slice(), LIMITS)).split('\n\n');
const loaded = (bytes: Uint8Array) => PDFDocument.load(bytes);

describe('PDF page operations (D-131)', () => {
  it('rotates the chosen pages a quarter turn either way, from their own rotation', async () => {
    const source = await PDFDocument.load(await pdfOf(['A', 'B', 'C']));
    source.getPage(2).setRotation(degrees(270));
    const right = await loaded(await rotatePages(await source.save(), [0, 2], 90));
    expect(right.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0]);
    const left = await loaded(await rotatePages(await pdfOf(['A', 'B']), [1], -90));
    expect(left.getPages().map((p) => p.getRotation().angle)).toEqual([0, 270]);
  });

  it('deletes pages but never the last one', async () => {
    expect(await pagesText(await deletePages(await pdfOf(['Alpha', 'Bravo', 'Charlie']), [0, 2]))).toEqual(['Bravo']);
    await expect(deletePages(await pdfOf(['Alpha', 'Bravo']), [0, 1])).rejects.toThrow(PDF_PAGE_MESSAGES.lastPage);
    await expect(deletePages(await pdfOf(['Alpha']), [3])).rejects.toThrow(RangeError);
  });

  it('computes the order after a move and reorders the pages, keeping the outline', async () => {
    expect(orderAfterMove(3, [0], 2)).toEqual([1, 2, 0]);
    expect(orderAfterMove(4, [3], 0)).toEqual([3, 0, 1, 2]);
    expect(orderAfterMove(5, [1, 3], 1)).toEqual([0, 1, 3, 2, 4]);
    expect(orderAfterMove(3, [1], 9)).toEqual([0, 2, 1]);
    const moved = await reorderPages(fixture('sample-pages.pdf'), [2, 0, 1]);
    expect(await pagesText(moved)).toEqual(['Charlie page closes the summary', 'Alpha page introduces the plan', 'Bravo page lists the details']);
    expect((await loaded(moved)).catalog.has(PDFName.of('Outlines'))).toBe(true);
    await expect(reorderPages(moved, [0, 0, 1])).rejects.toThrow(RangeError);
  });

  it('inserts a blank page the size of its neighbor', async () => {
    const out = await loaded(await insertBlankPage(await pdfOf(['A', 'B']), 2));
    expect(out.getPageCount()).toBe(3);
    expect(out.getPage(2).getSize()).toEqual({ width: 792, height: 612 });
    expect((await loaded(await insertBlankPage(await pdfOf(['A']), 0))).getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('inserts all pages of another PDF at a position', async () => {
    const { bytes, inserted } = await insertPagesFrom(await pdfOf(['One', 'Four']), await pdfOf(['Two', 'Three']), 1);
    expect(inserted).toBe(2);
    expect(await pagesText(bytes)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('extracts copies of the chosen pages, in document order, into a new PDF', async () => {
    const source = fixture('sample-pages.pdf');
    const out = await extractPages(source, [2, 0]);
    expect(await pagesText(out)).toEqual(['Alpha page introduces the plan', 'Charlie page closes the summary']);
    expect((await loaded(source)).getPageCount()).toBe(3);
  });

  it('refuses password-protected and unreadable files with a clear message', async () => {
    await expect(rotatePages(fixture('sample-protected.pdf'), [0], 90)).rejects.toThrow(PDF_PAGE_MESSAGES.protected);
    await expect(insertPagesFrom(await pdfOf(['A']), fixture('sample-protected.pdf'), 0)).rejects.toThrow(PDF_PAGE_MESSAGES.otherProtected);
    await expect(insertPagesFrom(await pdfOf(['A']), fixture('sample-damaged.pdf'), 0)).rejects.toThrow(PDF_PAGE_MESSAGES.otherUnreadable);
  });

  it('describes page choices for titles and messages', () => {
    expect(describePages([0])).toBe('page 1');
    expect(describePages([4, 0, 1, 2])).toBe('pages 1-3, 5');
  });
});
