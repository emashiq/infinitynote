import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCUMENT_TEXT_EXTRACTORS, DocumentText, documentTextExtractors } from '../../src/main/documents/text/document-text';
import type { Logger } from '../../src/main/services/logger';
import { decodeHtmlEntities, decodeXmlEntities } from '../../src/main/documents/text/entities';
import { htmlToText } from '../../src/main/documents/text/html-text';
import { presentationReadingOrder } from '../../src/main/documents/text/presentation-text';
import { DRAWING_TEXT, SHARED_STRING_TEXT, attributeValues, officeXmlText, wordXmlText } from '../../src/main/documents/text/office-xml-text';
import { bomEncoding, decodeText, isUtf8, looksLikeText } from '../../src/main/documents/text-encoding';
import { memoryLogger } from '../../src/main/services/logger';
import { MAX_DOCUMENT_TEXT_CHARS } from '../../src/shared/documents/limits';

const FIXTURES = path.resolve('tests/fixtures/documents');
const fixture = (name: string) => path.join(FIXTURES, name);
const tmp: string[] = [];
const tmpFile = (name: string, bytes: Buffer | string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-doc-text-'));
  tmp.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
};
/** The in-process extractors; PDF has its own tests (pdf-text.test). */
const extractDocumentText = (kind: Parameters<DocumentText['of']>[0], file: string, logger: Logger) => new DocumentText(DOCUMENT_TEXT_EXTRACTORS, logger).of(kind, file);
afterEach(() => {
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('document text for search (D-118)', () => {
  it('Word: paragraphs, runs, table rows and headers in reading order, entities decoded', async () => {
    const text = await extractDocumentText('docx', fixture('sample.docx'), memoryLogger());
    expect(text.split('\n')).toEqual(['Quarterly report', 'Revenue grew by twelve percent & costs fell.', 'Region\tSales', 'North\t42', 'Closing paragraph.', '', 'Sample header']);
  });

  it('Word: lists, tables, headers, footers, footnotes and comments (D-145)', async () => {
    const lines = (await extractDocumentText('docx', fixture('sample-rich.docx'), memoryLogger())).split('\n').filter((line) => line !== '');
    expect(lines).toEqual([
      'Project handbook',
      'The handbook explains how the team works.',
      'Steps',
      'Plan the week',
      'Review the board',
      'Tools',
      'Calendar',
      'Notebook',
      'Owner\tTask\tDue',
      'Ada\tDraft agenda\tMonday',
      'Appendix',
      'Last paragraph of the handbook.',
      'Handbook header',
      'Handbook footer',
      ' Written for new members.',
      'Check this sentence',
    ]);
  });

  it("PowerPoint: slides in the presentation's order, each followed by its speaker notes (D-152)", async () => {
    expect(await extractDocumentText('pptx', fixture('sample.pptx'), memoryLogger())).toBe('Welcome slide\nRoadmap for the launch\n\nSecond slide\nQuestions & answers');
    const lines = (await extractDocumentText('pptx', fixture('sample-rich.pptx'), memoryLogger())).split('\n').filter((line) => line !== '');
    expect(lines).toEqual(['Quarterly review', 'Revenue grew strongly this quarter', 'Thank the team first', 'Agenda overview', 'Mention the timeline', 'Closing words']);
    // A slide moved to the front is read first, though its part keeps its number.
    const parts = unzipSync(fs.readFileSync(fixture('sample-rich.pptx')));
    const presentation = strFromU8(parts['ppt/presentation.xml']!).replace(
      '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/>',
      '<p:sldId id="258" r:id="rId4"/><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>',
    );
    const moved = tmpFile('moved.pptx', Buffer.from(zipSync({ ...parts, 'ppt/presentation.xml': strToU8(presentation) })));
    expect((await extractDocumentText('pptx', moved, memoryLogger())).split('\n').find((line) => line !== '')).toBe('Closing words');
  });

  it('PowerPoint: the reading order follows the slide list and its relationships, absolute or relative', async () => {
    const parts: Record<string, string> = {
      'ppt/presentation.xml': `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rId9"/><p:sldId id="256" r:id='rId1'/><p:sldId id="300" r:id="rIdMissing"/></p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId1" Type="http://x/relationships/slide" Target="slides/a.xml"/><Relationship Id="rId9" Type="http://x/relationships/slide" Target="/ppt/slides/b.xml"/><Relationship Id="rId7" Type="http://x/relationships/slide" Target="https://example.com/c.xml" TargetMode="External"/></Relationships>',
      'ppt/slides/_rels/a.xml.rels': '<Relationships><Relationship Id="rId2" Type="http://x/relationships/notesSlide" Target="../notesSlides/n1.xml"/></Relationships>',
    };
    expect(await presentationReadingOrder(async (part) => parts[part] ?? null)).toEqual(['ppt/slides/b.xml', 'ppt/slides/a.xml', 'ppt/notesSlides/n1.xml']);
    expect(await presentationReadingOrder(async () => null)).toBeNull();
  });

  it('Excel: sheet names, shared strings and the values in sheets (D-138)', async () => {
    const text = await extractDocumentText('xlsx', fixture('sample.xlsx'), memoryLogger());
    expect(text.split('\n').filter((line) => line !== '')).toEqual([
      'Budget',
      'Notes & ideas',
      'Item',
      'Cost',
      'Coffee beans',
      'Paper',
      'Total',
      'Remember the receipts',
      '12.5',
      '4',
      '16.5',
    ]);
  });

  it('CSV as text, HTML as its visible text without scripts or styles', async () => {
    expect(await extractDocumentText('csv', fixture('sample.csv'), memoryLogger())).toContain('"Tea, green",4');
    const html = await extractDocumentText('html', fixture('sample.html'), memoryLogger());
    expect(html).toContain('Sample page title');
    expect(html).toContain('A paragraph with an external link and a local anchor.');
    expect(html).toContain('Café & crème — entities decode.');
    expect(html).not.toMatch(/script ran|font-family|fetch/);
  });

  it('PDF comes only from the worker extractor given to documentTextExtractors (D-129)', async () => {
    expect(DOCUMENT_TEXT_EXTRACTORS.pdf).toBeUndefined();
    expect(await extractDocumentText('pdf', fixture('sample.pdf'), memoryLogger())).toBe('');
    const read: string[] = [];
    const text = new DocumentText(documentTextExtractors(async (file) => (read.push(file), 'pdf words')), memoryLogger());
    expect(await text.of('pdf', fixture('sample.pdf'))).toBe('pdf words');
    expect(read).toEqual([fixture('sample.pdf')]);
    expect(await text.of('csv', fixture('sample.csv'))).toContain('"Tea, green",4');
  });

  it('an unreadable file gives no text without throwing, and the log names no path', async () => {
    const logger = memoryLogger();
    const failing = new DocumentText(documentTextExtractors(() => Promise.reject(Object.assign(new Error(fixture('x.pdf')), { code: 'PasswordException' }))), logger);
    expect(await failing.of('pdf', fixture('sample.pdf'))).toBe('');
    expect(await extractDocumentText('docx', tmpFile('broken.docx', 'not a zip'), logger)).toBe('');
    expect(await extractDocumentText('csv', path.join(FIXTURES, 'missing.csv'), logger)).toBe('');
    expect(logger.lines.join('\n')).toContain('kind=pdf error=PasswordException');
    expect(logger.lines.join('\n')).not.toContain(FIXTURES);
  });

  it('caps the text at MAX_DOCUMENT_TEXT_CHARS without splitting a surrogate pair', async () => {
    const body = 'a'.repeat(MAX_DOCUMENT_TEXT_CHARS - 1) + '😀tail';
    const text = await extractDocumentText('csv', tmpFile('big.csv', body), memoryLogger());
    expect(text).toHaveLength(MAX_DOCUMENT_TEXT_CHARS - 1);
    expect(text.endsWith('a')).toBe(true);
  });
});

describe('text helpers', () => {
  it('Word XML: text elements, paragraph ends, run tabs but not tab stops, breaks, no deleted text or field codes', () => {
    const xml =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A</w:t><w:tab/><w:t xml:space="preserve">B &lt;C&gt;</w:t><w:br/><w:t>D</w:t></w:r></w:p><w:p><w:r><w:t/></w:r></w:p>';
    expect(wordXmlText(xml)).toBe('A\tB <C>\nD\n\n');
    expect(wordXmlText('<w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>kept</w:t></w:r></w:p>')).toBe('kept\n');
  });

  it('Word XML: a table row is one line with tab-separated cells, paragraphs in a cell joined, nested tables inline', () => {
    const cell = (...paragraphs: string[]) => `<w:tc><w:tcPr><w:tcW w:w="1"/></w:tcPr>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:tc>`;
    const nested = `<w:tc><w:tbl><w:tr>${cell('in1')}${cell('in2')}</w:tr></w:tbl><w:p/></w:tc>`;
    const xml = `<w:p><w:r><w:t>Before</w:t></w:r></w:p><w:tbl><w:tr>${cell('a', 'b')}${cell('c')}</w:tr><w:tr>${nested}${cell('d')}</w:tr></w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>`;
    expect(wordXmlText(xml)).toBe('Before\na b\tc\nin1 in2\td\nAfter\n');
  });

  it('Office XML: text elements, block ends and breaks', () => {
    expect(officeXmlText('<a:p><a:r><a:t>x</a:t></a:r><a:br/><a:r><a:t>y</a:t></a:r></a:p>', DRAWING_TEXT)).toBe('x\ny\n');
    expect(officeXmlText('<si><r><t>rich</t></r><r><t> text</t></r></si><si><t>plain</t></si>', SHARED_STRING_TEXT)).toBe('rich text\nplain\n');
    expect(attributeValues('<sheet name="A &amp; B" sheetId="1"/><sheet sheetId="2" name="C"/>', 'sheet', 'name')).toEqual(['A & B', 'C']);
  });

  it('entities: numeric and named, unknown or out-of-range ones kept', () => {
    expect(decodeXmlEntities('&#65;&#x42;&amp;&nbsp;&#0;&#xD800;&#1114112;')).toBe('AB&&nbsp;&#0;&#xD800;&#1114112;');
    expect(decodeHtmlEntities('&nbsp;&copy;&unknown;&eacute;')).toBe(' ©&unknown;é');
  });

  it('HTML: comments, unclosed scripts and block elements', () => {
    expect(htmlToText('<p>one<!-- hidden --></p><div>two<br>three</div><script>never')).toBe('one\ntwo\nthree');
    expect(htmlToText('<b>in</b>line <i>words</i>')).toBe('inline words');
    expect(htmlToText('<style>p{}</style><SCRIPT type="x">a</SCRIPT>visible')).toBe('visible');
  });

  it('encodings: byte-order marks, UTF-8 check and the Windows-1252 fallback', () => {
    expect(bomEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('utf-8');
    expect(bomEncoding(Buffer.from([0xff, 0xfe, 0x41, 0]))).toBe('utf-16le');
    expect(bomEncoding(Buffer.from('plain'))).toBeNull();
    expect(looksLikeText(Buffer.from([0xff, 0xfe, 0x41, 0]))).toBe(true);
    expect(looksLikeText(Buffer.from([0x41, 0, 0x42]))).toBe(false);
    expect(isUtf8(Buffer.from('café', 'utf8').subarray(0, 4), true)).toBe(true);
    expect(isUtf8(Buffer.from('café', 'utf8').subarray(0, 4))).toBe(false);
    expect(isUtf8(Buffer.from([0x63, 0xe9, 0x41]), true)).toBe(false);
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('é')]))).toBe('é');
  });
});
