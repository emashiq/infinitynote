import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTE_HTML_CSP } from '../../src/main/portability/note-html';
import { ExportNoteDocumentRequest } from '../../src/shared/contracts/portability';
import { setupServices, type Services } from './hierarchy-helpers';
import { paragraph, saveDoc, tmpFile } from './portability-helpers';
import { makePng } from '../support/png';

const CTX = { webContentsId: 1 };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>drawn</text></svg>';
const SOURCE = 'flowchart TD\n  A --> B';

async function richNote(s: Services) {
  const note = s.note(null, null, 'Design <b>review</b>');
  const { attachment } = await s.attachments.importBytes({ kind: 'image', originalName: 'chart.png', bytes: makePng(4, 3, [1, 2, 3, 255]) });
  saveDoc(s, note.id, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: randomUUID(), level: 2 }, content: [{ type: 'text', text: 'Goals' }] },
      paragraph(randomUUID(), '<script>window.x=1</script> & more'),
      { type: 'codeBlock', attrs: { id: randomUUID(), language: 'mermaid' }, content: [{ type: 'text', text: SOURCE }] },
      { type: 'codeBlock', attrs: { id: randomUUID(), language: 'mermaid' }, content: [{ type: 'text', text: 'not drawn' }] },
      { type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: 'Energy ' }, { type: 'mathInline', attrs: { latex: 'E=mc^2' } }] },
      { type: 'mathBlock', attrs: { id: randomUUID(), latex: '\\frac{1}{2}' } },
      { type: 'mathBlock', attrs: { id: randomUUID(), latex: '\\frac{1' } },
      { type: 'image', attrs: { id: randomUUID(), attachmentId: attachment.id, alt: 'chart', size: 'small' } },
      { type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com/a?b=1&c=2' } }] }] },
    ],
  });
  return note;
}

describe('note export as HTML and PDF, and printing (F11.5, D-163)', () => {
  it('HTML: one self-contained page with escaped text, the drawn diagram as an image, MathML and embedded images', async () => {
    const s = await setupServices();
    const note = await richNote(s);
    const file = tmpFile('Design.html');
    s.pathQueue.push(file);
    const res = await s.portability.exportNoteDocument({ noteId: note.id, format: 'html', diagrams: [{ source: SOURCE, svg: SVG }] }, CTX);
    expect(res).toEqual({ canceled: false, file });
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${NOTE_HTML_CSP}">`);
    expect(html).toContain('<h1 class="note-title">Design &#60;b&#62;review&#60;/b&#62;</h1>');
    expect(html).toContain('<p>&#60;script&#62;window.x=1&#60;/script&#62; &#38; more</p>');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`<img alt="Diagram" src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}">`);
    expect(html).toContain('<pre><code>not drawn</code></pre>');
    expect(html).toMatch(/Energy <span class="katex"><math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML">.*<mi>E<\/mi>/);
    expect(html).toMatch(/<div class="math-block"><span class="katex"><math[^>]*display="block"/);
    expect(html).toContain('<div class="math-block"><pre><code>\\frac{1</code></pre></div>');
    expect(html).toMatch(/<img class="img-small" alt="chart" src="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
    expect(html).toContain('<a href="https://example.com/a?b=1&#38;c=2">site</a>');
    expect(s.printed).toEqual([]);
  });

  it('PDF: the same page goes through the hidden printer and its bytes are written; canceling the dialog writes nothing', async () => {
    const s = await setupServices();
    const note = await richNote(s);
    const file = tmpFile('Design.pdf');
    s.pathQueue.push(file);
    expect(await s.portability.exportNoteDocument({ noteId: note.id, format: 'pdf', diagrams: [] }, CTX)).toEqual({ canceled: false, file });
    expect(fs.readFileSync(file, 'utf8')).toBe('%PDF-1.7 fake');
    expect(s.printed.map((p) => p.op)).toEqual(['pdf']);
    expect(s.printed[0]!.html).toContain('<pre><code>flowchart TD');
    s.pathQueue.push(null);
    expect(await s.portability.exportNoteDocument({ noteId: note.id, format: 'pdf', diagrams: [] }, CTX)).toEqual({ canceled: true });
    expect(s.printed).toHaveLength(1);
  });

  it('Print sends the page to the printer and reports a canceled print; a plain note prints its lines', async () => {
    const s = await setupServices();
    const plain = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Shopping', 'plain').note;
    s.writer.save({ noteId: plain.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), format: 'plain', content: 'milk\n<eggs>' });
    expect(await s.portability.printNote({ noteId: plain.id, diagrams: [] })).toEqual({ printed: true });
    expect(s.printed[0]!.html).toContain('<p>milk</p>\n<p>&#60;eggs&#62;</p>');
    s.printResult.printed = false;
    expect(await s.portability.printNote({ noteId: plain.id, diagrams: [] })).toEqual({ printed: false });
  });

  it('a trashed note is not exported, and the request refuses a drawing that is not SVG', async () => {
    const s = await setupServices();
    const note = await richNote(s);
    s.trash.trashNote(note.id);
    await expect(s.portability.printNote({ noteId: note.id, diagrams: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ExportNoteDocumentRequest.safeParse({ noteId: note.id, format: 'html', diagrams: [{ source: 'x', svg: '<script>x</script>' }] }).success).toBe(false);
    expect(ExportNoteDocumentRequest.safeParse({ noteId: note.id, format: 'docx', diagrams: [] }).success).toBe(false);
  });
});
