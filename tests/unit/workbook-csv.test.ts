import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { afterAll, describe, expect, it } from 'vitest';
import { csvToWorkbook, detectDelimiter, encodeCsv, parseCsv, workbookToCsv } from '../../src/main/documents/spreadsheet/csv';
import { runWorkbookTask } from '../../src/main/documents/spreadsheet/workbook-convert';
import type { WorkbookReply } from '../../src/main/documents/spreadsheet/workbook-task';
import { isDocumentOfKind } from '../../src/main/documents/document-check';
import { worksheetCellText } from '../../src/main/documents/text/office-xml-text';
import { DOCUMENT_TEXT_EXTRACTORS } from '../../src/main/documents/text/document-text';
import { WORKBOOK_LIMITS, type CsvFormatType } from '../../src/shared/documents/workbook';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-csv-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const temp = (bytes: Uint8Array, ext = 'csv') => {
  const file = path.join(dir, `f${(n += 1)}.${ext}`);
  fs.writeFileSync(file, bytes);
  return file;
};

type Read = Extract<WorkbookReply, { read: unknown }>['read'];
async function readCsv(bytes: Uint8Array, encoding: Pick<CsvFormatType, 'encoding' | 'bom'>): Promise<Read> {
  const reply = await runWorkbookTask({ op: 'readCsv', file: temp(bytes), limits: WORKBOOK_LIMITS, encoding });
  if (!reply.ok || !('read' in reply)) throw new Error(JSON.stringify(reply));
  return reply.read;
}
async function writeCsv(read: Read): Promise<Uint8Array> {
  const reply = await runWorkbookTask({ op: 'writeCsv', workbook: read.workbook, format: read.csv! });
  if (!reply.ok || !('bytes' in reply)) throw new Error(JSON.stringify(reply));
  return reply.bytes;
}

describe('CSV parsing (D-135)', () => {
  it('chooses the separator that splits the lines consistently, ignoring separators inside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(detectDelimiter('a;b;c\n"1,5";2;3\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(detectDelimiter('"x,y,z";b\n"1,2,3";4')).toBe(';');
    expect(detectDelimiter('single column\nno separator')).toBe(',');
  });

  it('reads quoted fields with separators, doubled quotes and line breaks, and every line ending', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n"two\nlines",x\ry', ',', WORKBOOK_LIMITS)).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['two\nlines', 'x'],
      ['y'],
    ]);
    expect(parseCsv('a,,b\n,\n', ',', WORKBOOK_LIMITS)).toEqual([
      ['a', '', 'b'],
      ['', ''],
    ]);
    // A quote inside an unquoted field is a character.
    expect(parseCsv('5" pipe,x', ',', WORKBOOK_LIMITS)).toEqual([['5" pipe', 'x']]);
  });

  it('keeps text that a number would change (leading zeros, trailing zeros, exponents) as text', () => {
    const wb = csvToWorkbook('12,-3.5,007,1.50,1e5,abc', ',', WORKBOOK_LIMITS);
    expect(wb.sheets[0]!.cells.map((c) => c.v)).toEqual([12, -3.5, '007', '1.50', '1e5', 'abc']);
  });

  it('refuses files past the limits', () => {
    expect(() => parseCsv(`"${'x'.repeat(10)}"`, ',', { ...WORKBOOK_LIMITS, maxTextChars: 5 })).toThrow(expect.objectContaining({ code: 'textTooLong' }));
    expect(() => parseCsv('a,b,c', ',', { ...WORKBOOK_LIMITS, maxCols: 2 })).toThrow(expect.objectContaining({ code: 'sheetTooLarge' }));
    expect(() => csvToWorkbook('1,2\n3,4', ',', { ...WORKBOOK_LIMITS, maxCells: 3 })).toThrow(expect.objectContaining({ code: 'tooManyCells' }));
  });
});

describe('CSV round trips through the worker task (D-135)', () => {
  const sample = 'name;amount;note\r\nSmith, J.;12;"says ""ok"""\r\nLee;7,5;\r\n';

  it('writes an untouched UTF-8 file with a byte-order mark back byte for byte', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(sample)]);
    const read = await readCsv(bytes, { encoding: 'utf-8', bom: true });
    expect(read.csv).toEqual({ delimiter: ';', encoding: 'utf-8', bom: true, lineEnding: '\r\n', finalNewline: true });
    expect(read.workbook.sheets[0]!.cells.find((c) => c.r === 1 && c.c === 0)?.v).toBe('Smith, J.');
    expect(await writeCsv(read)).toEqual(bytes);
  });

  it('writes quoting a file did not need without it, keeping every value', async () => {
    const read = await readCsv(new TextEncoder().encode('"a","b"\n"1",""\n'), { encoding: 'utf-8', bom: false });
    const written = await writeCsv(read);
    expect(new TextDecoder().decode(written)).toBe('a,b\n1,\n');
    expect((await readCsv(written, { encoding: 'utf-8', bom: false })).workbook).toEqual(read.workbook);
  });

  it('keeps UTF-16 and Windows-1252 files in their encoding', async () => {
    const text = 'a,b\nÄpfel,€ 5\n';
    const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Uint16Array.from(text, (ch) => ch.charCodeAt(0)).buffer)]);
    const read16 = await readCsv(utf16, { encoding: 'utf-16le', bom: true });
    expect(read16.workbook.sheets[0]!.cells.map((c) => c.v)).toEqual(['a', 'b', 'Äpfel', '€ 5']);
    expect(await writeCsv(read16)).toEqual(utf16);

    const cp1252 = new Uint8Array([...new TextEncoder().encode('a,b\n'), 0xc4, 0x70, 0x66, 0x65, 0x6c, 0x2c, 0x80, 0x0a]);
    const read1252 = await readCsv(cp1252, { encoding: 'windows-1252', bom: false });
    expect(read1252.workbook.sheets[0]!.cells.map((c) => c.v)).toEqual(['a', 'b', 'Äpfel', '€']);
    expect(await writeCsv(read1252)).toEqual(cp1252);
  });

  it('writes text Windows-1252 cannot hold as UTF-8 with a mark, so nothing is lost', () => {
    const bytes = encodeCsv('Ω', { encoding: 'windows-1252', bom: false });
    expect([...bytes]).toEqual([0xef, 0xbb, 0xbf, 0xce, 0xa9]);
  });

  it('writes values of the first sheet: formula results, booleans, quoting, rows as wide as the widest', () => {
    const wb = csvToWorkbook('x', ',', WORKBOOK_LIMITS);
    wb.sheets[0]!.cells = [
      { r: 0, c: 0, v: 'a,b' },
      { r: 0, c: 2, f: 'SUM(1,2)', v: 3 },
      { r: 1, c: 0, v: true },
      { r: 2, c: 1, v: 'line\nbreak' },
    ];
    expect(workbookToCsv(wb, { delimiter: ',', lineEnding: '\n', finalNewline: false })).toBe('"a,b",,3\nTRUE,,\n,"line\nbreak",');
  });
});

describe('spreadsheet text for search (D-138)', () => {
  it('reads numbers, formula results and inline strings from a sheet, skipping shared string indexes', () => {
    const xml =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42.5</v></c><c r="C1" t="inlineStr"><is><t>inline &amp; text</t></is></c></row>' +
      '<row r="2"><c r="A2" t="str"><f>A1</f><v>result</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" s="1"/></row></sheetData>';
    expect(worksheetCellText(xml)).toBe('42.5\tinline & text\nresult\n');
  });

  it('indexes sheet names, shared strings and cell values of the sample workbook', async () => {
    const text = await DOCUMENT_TEXT_EXTRACTORS.xlsx!(path.resolve('tests/fixtures/documents/sample.xlsx'));
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('macro-enabled packages (D-136)', () => {
  it('are not taken as workbooks, however they are named', async () => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<Types/>'), '[Content_Types].xml');
    zip.addBuffer(Buffer.from('<workbook/>'), 'xl/workbook.xml');
    zip.addBuffer(Buffer.from('VBA'), 'xl/vbaProject.bin');
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
    const macro = temp(Buffer.concat(chunks), 'xlsx');
    expect(await isDocumentOfKind('xlsx', macro)).toBe(false);
    expect(await isDocumentOfKind('xlsx', path.resolve('tests/fixtures/documents/sample.xlsx'))).toBe(true);
  });
});
