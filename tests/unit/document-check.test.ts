import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { afterEach, describe, expect, it } from 'vitest';
import { blankDocument } from '../../src/main/documents/blank-documents';
import { isDocumentOfKind } from '../../src/main/documents/document-check';
import { MAIN_PART, numberedParts, openOoxml } from '../../src/main/documents/ooxml-package';
import { DOCUMENT_TEXT_EXTRACTORS, DocumentText } from '../../src/main/documents/text/document-text';
import { memoryLogger } from '../../src/main/services/logger';
import { isAllowedFrameNavigation, isAllowedPermission } from '../../src/main/windows/web-policy';
import { BLANK_DOCUMENT_KINDS, DOCUMENT_KINDS, documentKindOf, titleFromFileName } from '../../src/shared/documents/kinds';

const FIXTURES = path.resolve('tests/fixtures/documents');
const SAMPLE = { pdf: 'sample.pdf', docx: 'sample.docx', pptx: 'sample.pptx', xlsx: 'sample.xlsx', csv: 'sample.csv', html: 'sample.html' } as const;
const dirs: string[] = [];
const write = (name: string, bytes: Buffer | string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-doc-check-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, name), bytes);
  return path.join(dir, name);
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function zipOf(entries: Array<[string, Buffer]>): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const [name, data] of entries) z.addBuffer(data, name);
  z.end();
  const chunks: Buffer[] = [];
  for await (const c of z.outputStream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('document kinds (D-118)', () => {
  it('maps extensions to kinds and refuses other files', () => {
    expect(['a.PDF', 'b.docx', 'c.pptx', 'd.xlsx', 'e.csv', 'f.html', 'g.htm'].map(documentKindOf)).toEqual(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html', 'html']);
    expect(['a.doc', 'b.txt', 'c.exe', 'noext', '', null].map(documentKindOf)).toEqual([null, null, null, null, null, null]);
  });

  it('titles come from the file name without its extension, bounded and never empty', () => {
    expect(titleFromFileName('Quarterly report.docx', 'docx')).toBe('Quarterly report');
    expect(titleFromFileName('.pdf', 'pdf')).toBe('Untitled PDF');
    expect(titleFromFileName(`${'x'.repeat(250)}.csv`, 'csv')).toHaveLength(200);
    expect(titleFromFileName('tab\there.html', 'html')).toBe('tab here');
  });
});

describe('content checks, never the name (plan "Untrusted files")', () => {
  it('accepts every sample of its own kind and refuses it as any other kind', async () => {
    for (const kind of DOCUMENT_KINDS) {
      const file = path.join(FIXTURES, SAMPLE[kind]);
      expect(await isDocumentOfKind(kind, file), kind).toBe(true);
      for (const other of DOCUMENT_KINDS) {
        const textual = (k: string) => k === 'csv' || k === 'html';
        // CSV and HTML are both text, and a PDF sample is text too: only binary kinds are told apart by content.
        if (other === kind || (textual(other) && (textual(kind) || kind === 'pdf'))) continue;
        expect(await isDocumentOfKind(other, file), `${kind} as ${other}`).toBe(false);
      }
    }
  });

  it('refuses a renamed program, a PDF header past 1 KiB, a zip without the main part and a missing file', async () => {
    const exe = write('setup.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]));
    expect(await isDocumentOfKind('pdf', exe)).toBe(false);
    expect(await isDocumentOfKind('csv', exe)).toBe(false);
    expect(await isDocumentOfKind('pdf', write('late.pdf', Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from('%PDF-1.7')])))).toBe(false);
    const wordless = await zipOf([['[Content_Types].xml', Buffer.from('<Types/>')]]);
    expect(await isDocumentOfKind('docx', write('empty.docx', wordless))).toBe(false);
    expect(await isDocumentOfKind('docx', path.join(FIXTURES, 'missing.docx'))).toBe(false);
  });

  it('refuses a package whose entry inflates beyond the bound ratio (zip bomb)', async () => {
    const bomb = await zipOf([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      [MAIN_PART.docx, Buffer.alloc(8 * 1024 * 1024, 0x41)],
    ]);
    const file = write('bomb.docx', bomb);
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await isDocumentOfKind('docx', file)).toBe(false);
    expect(await openOoxml(file, 'docx')).toBeNull();
  });

  it('refuses macros declared by content type, whatever the VBA part is called (D-143)', async () => {
    const types = (extra: string) =>
      Buffer.from(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`);
    const word = Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
    const plain = await zipOf([
      ['[Content_Types].xml', types('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>')],
      [MAIN_PART.docx, word],
    ]);
    expect(await isDocumentOfKind('docx', write('plain.docx', plain))).toBe(true);
    const docm = await zipOf([
      ['[Content_Types].xml', types('<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>')],
      [MAIN_PART.docx, word],
    ]);
    expect(await isDocumentOfKind('docx', write('renamed.docx', docm))).toBe(false);
    const hiddenVba = await zipOf([
      ['[Content_Types].xml', types('<Override PartName="/word/project.bin" ContentType="application/vnd.ms-office.vbaProject"/>')],
      [MAIN_PART.docx, word],
      ['word/project.bin', Buffer.from('VBA')],
    ]);
    expect(await isDocumentOfKind('docx', write('hidden.docx', hiddenVba))).toBe(false);
    const hugeTypes = await zipOf([
      ['[Content_Types].xml', Buffer.concat([types(''), Buffer.alloc(1024 * 1024 + 1, 0x20)])],
      [MAIN_PART.docx, word],
    ]);
    expect(await isDocumentOfKind('docx', write('huge-types.docx', hugeTypes))).toBe(false);
  });

  it('orders numbered parts by number', () => {
    expect(numberedParts(new Set(['ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels']), /^ppt\/slides\/slide(\d+)\.xml$/)).toEqual([
      'ppt/slides/slide2.xml',
      'ppt/slides/slide10.xml',
    ]);
  });
});

describe('blank documents', () => {
  it('each blank kind is a valid package of its kind with its main part, the same bytes every time', async () => {
    for (const kind of BLANK_DOCUMENT_KINDS) {
      const bytes = await blankDocument(kind);
      expect(bytes.equals(await blankDocument(kind)), kind).toBe(true);
      const file = write(`blank.${kind}`, bytes);
      expect(await isDocumentOfKind(kind, file), kind).toBe(true);
      expect(await new DocumentText(DOCUMENT_TEXT_EXTRACTORS, memoryLogger()).of(kind, file)).toBe(kind === 'xlsx' ? 'Sheet1' : '');
      const archive = (await openOoxml(file, kind))!;
      const types = (await archive.read('[Content_Types].xml', 1 << 20)).toString('utf8');
      for (const part of archive.names) {
        if (part.endsWith('.rels') || part === '[Content_Types].xml') continue;
        expect(types, `${kind} ${part}`).toContain(`PartName="/${part}"`);
      }
      archive.close();
    }
  });

  it('a blank presentation has one 16:9 slide on a blank layout with a theme', async () => {
    const file = write('blank.pptx', await blankDocument('pptx'));
    const archive = (await openOoxml(file, 'pptx'))!;
    expect([...archive.names].sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'ppt/_rels/presentation.xml.rels',
        'ppt/presentation.xml',
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        'ppt/slideLayouts/slideLayout1.xml',
        'ppt/slideMasters/_rels/slideMaster1.xml.rels',
        'ppt/slideMasters/slideMaster1.xml',
        'ppt/slides/_rels/slide1.xml.rels',
        'ppt/slides/slide1.xml',
        'ppt/theme/theme1.xml',
      ].sort(),
    );
    expect((await archive.read('ppt/presentation.xml', 1 << 20)).toString('utf8')).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    archive.close();
  });
});

describe('web policy: HTML viewer frame navigation (F6) and permissions', () => {
  it('only the app may point the frame at an infinity-html document; pages navigate nowhere', () => {
    expect(isAllowedFrameNavigation('infinity-html://11111111-1111-4111-8111-111111111111/?r=1', true)).toBe(true);
    for (const url of ['https://example.com/', 'infinity-app://renderer/index.html', 'data:text/html,hi', 'file:///etc/passwd', 'not a url']) {
      expect(isAllowedFrameNavigation(url, true), url).toBe(false);
    }
    expect(isAllowedFrameNavigation('infinity-html://11111111-1111-4111-8111-111111111111/', false)).toBe(false);
  });

  it('"Copy link" may write the clipboard from the app page; no other permission and no other page is granted', () => {
    expect(isAllowedPermission('clipboard-sanitized-write', 'infinity-app://renderer/index.html', null)).toBe(true);
    expect(isAllowedPermission('clipboard-sanitized-write', 'infinity-app://renderer', null)).toBe(true);
    expect(isAllowedPermission('clipboard-sanitized-write', 'http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedPermission('clipboard-sanitized-write', 'infinity-html://11111111-1111-4111-8111-111111111111/', null)).toBe(false);
    expect(isAllowedPermission('clipboard-sanitized-write', 'http://localhost:5173/', null)).toBe(false);
    for (const permission of ['clipboard-read', 'media', 'notifications', 'geolocation', 'openExternal']) {
      expect(isAllowedPermission(permission, 'infinity-app://renderer/index.html', null), permission).toBe(false);
    }
  });
});
