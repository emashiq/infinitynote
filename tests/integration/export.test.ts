import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { richToMarkdown } from '../../src/main/portability/markdown';
import { PORTABILITY_MESSAGES } from '../../src/shared/contracts/portability';
import { suggestedFileName } from '../../src/shared/names';
import { setupServices, type Services } from './hierarchy-helpers';
import { saveDoc, seedNotebook, tmpFile } from './portability-helpers';

const CTX = { webContentsId: 1 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const id = () => randomUUID();
const text = (t: string, marks: string[] = []) => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });

async function exportNote(s: Services, noteId: string, format: 'markdown' | 'text', file: string) {
  s.pathQueue.push(file);
  return s.portability.exportNote({ noteId, format }, CTX);
}

describe('Markdown and plain-text export (INF-PORT-05)', () => {
  it('Markdown keeps structure and emphasis; images are copied next to the file; documented losses apply', async () => {
    const s = await setupServices();
    const seeded = await seedNotebook(s);
    const note = s.note(null, null, 'Release notes: v1/2');
    saveDoc(s, note.id, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: id(), level: 2 }, content: [text('Summary')] },
        { type: 'paragraph', attrs: { id: id() }, content: [text('Bold', ['bold']), text(' and '), text('italic', ['italic']), text(' and '), text('code()', ['code']), text(' and '), text('under', ['underline'])] },
        { type: 'paragraph', attrs: { id: id() }, content: [{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com/a b' } }] }, { type: 'hardBreak' }, text('next line *literal*')] },
        { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: id() }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('one')] }, { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: id() }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('nested')] }] }] }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', attrs: { id: id() }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('third')] }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: id(), checked: true }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('done')] }] }, { type: 'taskItem', attrs: { id: id(), checked: false }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('todo')] }] }] },
        { type: 'blockquote', attrs: { id: id() }, content: [{ type: 'paragraph', attrs: { id: id() }, content: [text('quoted')] }] },
        { type: 'codeBlock', attrs: { id: id(), language: 'ts' }, content: [text('const a = 1;')] },
        { type: 'horizontalRule' },
        { type: 'paragraph', attrs: { id: id() }, content: [text('See '), { type: 'noteRef', attrs: { noteId: seeded.design.id, blockId: null, label: 'Design', excerpt: null } }] },
        { type: 'image', attrs: { id: id(), attachmentId: seeded.attachment.id, alt: 'chart', size: 'full' } },
      ],
    });
    const file = tmpFile('Release notes.md');
    const res = await exportNote(s, note.id, 'markdown', file);
    expect(res).toEqual({ canceled: false, file, attachments: 1 });
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'save', title: 'Export note as Markdown', defaultName: 'Release notes v1 2.md' });
    const md = fs.readFileSync(file, 'utf8');
    const imageName = `${seeded.attachment.id}.png`;
    expect(md).toBe(
      [
        '# Release notes: v1/2',
        '',
        '## Summary',
        '',
        '**Bold** and *italic* and `code()` and under',
        '',
        '[site](https://example.com/a%20b)  ',
        'next line \\*literal\\*',
        '',
        '- one',
        '',
        '  - nested',
        '',
        '3. third',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        '> quoted',
        '',
        '```ts',
        'const a = 1;',
        '```',
        '',
        '---',
        '',
        'See Design',
        '',
        `![chart](Release%20notes%20files/${imageName})`,
        '',
      ].join('\n'),
    );
    const copied = path.join(path.dirname(file), 'Release notes files', imageName);
    expect(sha(fs.readFileSync(copied))).toBe(sha(seeded.png));
  });

  it('plain text is the title and the text; a plain-text note exports as its text in both formats', async () => {
    const s = await setupServices();
    const seeded = await seedNotebook(s);
    const txt = tmpFile('design.txt');
    expect(await exportNote(s, seeded.design.id, 'text', txt)).toEqual({ canceled: false, file: txt, attachments: 0 });
    expect(fs.readFileSync(txt, 'utf8')).toBe('Design\n\nShip the backup on Friday');
    const md = tmpFile('plain');
    expect(await exportNote(s, seeded.plain.id, 'markdown', md)).toMatchObject({ file: `${md}.md` });
    expect(fs.readFileSync(`${md}.md`, 'utf8')).toBe('Plain\n\nplain body');
  });

  it('a missing or trashed note is refused; a canceled dialog writes nothing', async () => {
    const s = await setupServices();
    const seeded = await seedNotebook(s);
    expect(await s.portability.exportNote({ noteId: seeded.design.id, format: 'markdown' }, CTX)).toEqual({ canceled: true });
    s.trash.trashNote(seeded.plain.id);
    await expect(s.portability.exportNote({ noteId: seeded.plain.id, format: 'text' }, CTX)).rejects.toMatchObject({ code: 'NOT_FOUND', message: PORTABILITY_MESSAGES.noteMissing });
    await expect(s.portability.exportNote({ noteId: randomUUID(), format: 'text' }, CTX)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('file names drop characters the file system refuses; an unavailable image is named, not linked', () => {
    expect(suggestedFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(suggestedFileName('  ...  ')).toBe('Untitled');
    expect(suggestedFileName('')).toBe('Untitled');
    const missing = richToMarkdown('', { content: [{ type: 'image', attrs: { attachmentId: id(), alt: 'gone' } }] }, { linkOf: () => null, linkedFileUrl: () => null });
    expect(missing).toBe('*[gone: image unavailable]*\n');
  });
});
