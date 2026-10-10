import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../../src/main/services/logger';
import { createDocumentHandler, createHtmlDocumentHandler, htmlCharset, parseByteRange } from '../../src/main/windows/document-protocol';
import { documentUrl, htmlDocumentUrl } from '../../src/shared/app-identity';
import { HTML_DOCUMENT_CSP } from '../../src/shared/csp';
import { COMMON, fixtureBytes, setupDocuments } from './document-helpers';

const RENDERER = 'infinity-app://renderer';

async function setup() {
  const d = await setupDocuments();
  const files = d.s.services.documentFiles;
  const handler = createDocumentHandler({ files, allowedOrigins: [RENDERER], logger: memoryLogger() });
  const html = createHtmlDocumentHandler({ files, logger: memoryLogger() });
  const get = (url: string, init: RequestInit = {}) => handler(new Request(url, init));
  return { ...d, handler, html, get };
}

describe('byte ranges (RFC 9110)', () => {
  it('parses one range, suffixes and open ends; refuses ranges outside the file; ignores others', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=10-5000', 1000)).toEqual({ start: 10, end: 999 });
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5-4', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
    for (const header of [null, '', 'bytes=-', 'items=0-1', 'bytes=0-1,5-6', 'bytes=a-b']) expect(parseByteRange(header, 1000), String(header)).toBeNull();
  });
});

describe('infinity-document protocol (D-118)', () => {
  it('serves a live document by ID with its type, nosniff and ranges for pdf.js', async () => {
    const { get, original, importFile } = await setup();
    const pdf = await importFile(original('Paper.pdf'), 'copy');
    const bytes = fixtureBytes('sample.pdf');
    const full = await get(documentUrl(pdf.id, 0), { headers: { origin: RENDERER } });
    expect(full.status).toBe(200);
    expect(Object.fromEntries(full.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-length': String(bytes.length),
      'access-control-allow-origin': RENDERER,
    });
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);
    const part = await get(documentUrl(pdf.id, 0), { headers: { range: 'bytes=0-7' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-7/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).toString('latin1')).toBe('%PDF-1.4');
    const tail = await get(documentUrl(pdf.id, 0), { headers: { range: 'bytes=-6' } });
    expect(Buffer.from(await tail.arrayBuffer()).toString('latin1')).toBe('%%EOF\n');
    expect((await get(documentUrl(pdf.id, 0), { headers: { range: `bytes=${bytes.length}-` } })).status).toBe(416);
    const head = await get(documentUrl(pdf.id, 0), { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, String(bytes.length), '']);
  });

  it('grants CORS to the renderer origin only and answers its preflight', async () => {
    const { get, s } = await setup();
    const { document } = await s.documents.createBlank('docx', COMMON);
    expect((await get(documentUrl(document.id, 0), { headers: { origin: 'https://example.com' } })).headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await get(documentUrl(document.id, 0), { method: 'OPTIONS', headers: { origin: RENDERER } });
    expect([preflight.status, preflight.headers.get('access-control-allow-headers'), preflight.headers.get('access-control-allow-origin')]).toEqual([204, 'Range', RENDERER]);
    expect((await get(documentUrl(document.id, 0), { method: 'POST' })).status).toBe(405);
  });

  it('serves a linked original from where it is, and nothing for trashed, unknown or malformed URLs', async () => {
    const { get, s, original, importFile } = await setup();
    const file = original('Live.csv', 'a,b\n1,2\n');
    const linked = await importFile(file, 'link');
    expect(await (await get(documentUrl(linked.id, 0))).text()).toBe('a,b\n1,2\n');
    fs.writeFileSync(file, 'changed');
    expect(await (await get(documentUrl(linked.id, 0))).text()).toBe('changed');
    fs.rmSync(file);
    expect((await get(documentUrl(linked.id, 0))).status).toBe(404);
    const { document } = await s.documents.createBlank('xlsx', COMMON);
    s.trash.trashDocument(document.id);
    for (const url of [
      documentUrl(document.id, 0),
      documentUrl(randomUUID(), 0),
      'infinity-document://not-a-uuid/',
      `infinity-document://${document.id}/../../infinity-notes.sqlite3`,
      `infinity-document://${document.id.toUpperCase()}/`,
    ]) {
      const res = await get(url);
      expect(res.status, url).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  it('with no database every request is 404', async () => {
    const handler = createDocumentHandler({ files: null, allowedOrigins: [RENDERER] });
    expect((await handler(new Request(documentUrl(randomUUID(), 0)))).status).toBe(404);
  });
});

describe('infinity-html protocol (F6)', () => {
  it('serves HTML documents only, under the no-script, no-network policy, with the page charset', async () => {
    const { html, original, importFile, s } = await setup();
    const page = await importFile(original('Page.html'), 'copy');
    const res = await html(new Request(htmlDocumentUrl(page.id, 0)));
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': HTML_DOCUMENT_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    expect(Buffer.from(await res.arrayBuffer()).equals(fixtureBytes('sample.html'))).toBe(true);
    expect(HTML_DOCUMENT_CSP).toBe("default-src 'none'; img-src data: infinity-html:; style-src 'unsafe-inline' infinity-html:; base-uri 'none'; form-action 'none'; sandbox");
    expect(HTML_DOCUMENT_CSP).not.toMatch(/script-src|connect-src|https?:|unsafe-eval|allow-/);
    const { document: sheet } = await s.documents.createBlank('xlsx', COMMON);
    expect((await html(new Request(htmlDocumentUrl(sheet.id, 0)))).status).toBe(404);
    expect((await html(new Request(`infinity-html://${page.id}/image.png`))).status).toBe(404);
    expect((await html(new Request(htmlDocumentUrl(page.id, 0), { method: 'HEAD' }))).status).toBe(405);
  });

  it('declares UTF-8 only for valid UTF-8 and leaves a legacy page to its meta charset', async () => {
    const { original } = await setup();
    expect(await htmlCharset(original('a.html', Buffer.from('<p>café</p>', 'utf8')))).toBe('utf-8');
    expect(await htmlCharset(original('b.html', Buffer.from([0xff, 0xfe, 0x3c, 0])))).toBe('utf-16le');
    expect(await htmlCharset(original('c.html', Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c])))).toBeNull();
  });
});
