import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { richToMarkdown } from '../../src/main/portability/markdown';
import { FileLinkCreateRequest, FileLinkDto, FileLinkStatusResponse } from '../../src/shared/contracts/attachments';
import { BLOCK_ID_TYPES, collectLinkIds, DocSchemaError, normalizeRichDoc } from '../../src/shared/editor/doc-schema';
import { noteSchema } from '../../src/shared/editor/schema';
import { extractPlainText } from '../../src/shared/text/plain-text';

const linkId = randomUUID();
const blockId = randomUUID();
const linkNode = (attrs: Record<string, unknown>) => ({ type: 'fileLink', attrs: { id: blockId, linkId, name: 'Plan.pdf', sizeBytes: 12, ...attrs } });
const docWith = (...content: unknown[]) => ({ type: 'doc', content });

describe('the fileLink node (D-108)', () => {
  it('is a block of the shared schema with a block ID; documents hold its link ID, name and size, never a path', () => {
    expect(BLOCK_ID_TYPES).toContain('fileLink');
    const spec = noteSchema('rich').nodes.fileLink!;
    expect(Object.keys(spec.spec.attrs ?? {}).sort()).toEqual(['id', 'linkId', 'name', 'sizeBytes']);
    expect(normalizeRichDoc(docWith(linkNode({ path: 'C:\\Windows\\notepad.exe', extra: 1 })))).toEqual(docWith(linkNode({})));
  });

  it('is refused without a valid link ID, name or size', () => {
    for (const bad of [{ linkId: 'C:\\x.pdf' }, { linkId: null }, { name: '' }, { name: 'x'.repeat(256) }, { sizeBytes: -1 }, { sizeBytes: 1.5 }]) {
      expect(() => normalizeRichDoc(docWith(linkNode(bad))), JSON.stringify(bad)).toThrow(DocSchemaError);
    }
  });

  it('search and plain text read its file name; collectLinkIds lists each link once in document order', () => {
    const other = randomUUID();
    const doc = docWith({ type: 'paragraph', content: [{ type: 'text', text: 'See' }] }, linkNode({}), linkNode({ linkId: other, name: 'b.xlsx' }), linkNode({}));
    expect(extractPlainText('rich', doc)).toBe('See\nPlan.pdf\nb.xlsx\nPlan.pdf');
    expect(collectLinkIds(doc)).toEqual([linkId, other]);
  });

  it('Markdown writes a link to the original as a file:// URL, or says the linked file is unavailable', () => {
    const doc = docWith(linkNode({ name: 'Plan (v2).pdf' }));
    const url = 'file:///C:/Users/me/My%20Files/Plan%20(v2).pdf';
    expect(richToMarkdown('', doc, { linkOf: () => null, linkedFileUrl: (id) => (id === linkId ? url : null) })).toBe('[Plan (v2).pdf](file:///C:/Users/me/My%20Files/Plan%20%28v2%29.pdf)\n');
    expect(richToMarkdown('', doc, { linkOf: () => null, linkedFileUrl: () => null })).toBe('*[Plan (v2).pdf: linked file unavailable]*\n');
  });
});

describe('linked-file contracts (D-108)', () => {
  it('paths are 1 to 4096 characters without NUL; status names one of three states', () => {
    expect(FileLinkCreateRequest.safeParse({ path: 'C:\\Users\\me\\a.pdf' }).success).toBe(true);
    for (const path of ['', 'x'.repeat(4097), '/home/a\0.pdf']) expect(FileLinkCreateRequest.safeParse({ path }).success, path.slice(0, 10)).toBe(false);
    expect(FileLinkCreateRequest.safeParse({ path: '/a.pdf', noteId: randomUUID() }).success).toBe(false);
    expect(FileLinkDto.safeParse({ id: linkId, name: 'a.pdf', sizeBytes: 1, path: '/a.pdf' }).success).toBe(true);
    expect(FileLinkStatusResponse.safeParse({ path: null, sizeBytes: null, state: 'missing' }).success).toBe(true);
    expect(FileLinkStatusResponse.safeParse({ path: '/a', sizeBytes: 1, state: 'executable' }).success).toBe(false);
  });
});
