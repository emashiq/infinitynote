import { describe, expect, it } from 'vitest';
import { collectAttachmentRefs, DocSchemaError, MAX_DOC_DEPTH, normalizeRichDoc } from '../../src/shared/editor/doc-schema';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ATT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const text = (t: string, marks?: unknown[]) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content: unknown[]) => ({ type: 'paragraph', attrs: { id: ID1 }, content });

function rejects(doc: unknown, message: RegExp): void {
  expect(() => normalizeRichDoc(doc)).toThrow(DocSchemaError);
  expect(() => normalizeRichDoc(doc)).toThrow(message);
}

describe('normalizeRichDoc (D-053)', () => {
  it('keeps every supported node, mark and attribute', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: ID1, level: 2 }, content: [text('Plan')] },
        para(text('b', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }, { type: 'underline' }]), text('c', [{ type: 'code' }])),
        { type: 'paragraph', attrs: { id: ID2 }, content: [text('link', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]), { type: 'hardBreak' }] },
        { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: ID1 }, content: [para(text('one'))] }] },
        { type: 'orderedList', attrs: { start: 3, type: null }, content: [{ type: 'listItem', attrs: { id: ID2 }, content: [para(text('two'))] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: ID1, checked: true }, content: [para(text('done'))] }] },
        { type: 'codeBlock', attrs: { id: ID2, language: 'ts' }, content: [text('let a = 1;')] },
        { type: 'blockquote', attrs: { id: ID1 }, content: [para(text('quote'))] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { id: ID2, attachmentId: ATT, alt: 'chart', size: 'full', width: 800, height: 200 } },
        { type: 'fileAttachment', attrs: { id: ID1, attachmentId: ATT, name: 'report.pdf', sizeBytes: 1234, mime: 'application/pdf' } },
      ],
    };
    expect(normalizeRichDoc(doc)).toEqual(doc);
  });

  it('drops unknown attributes, editor-only attributes and invalid ids', () => {
    const out = normalizeRichDoc({
      type: 'doc',
      attrs: { foo: 1 },
      content: [
        { type: 'paragraph', attrs: { id: 'not-a-uuid', textAlign: 'left' }, content: [text('x', [{ type: 'link', attrs: { href: 'https://a.example/', target: '_blank', rel: 'noopener', class: 'c', title: 't' } }])] },
        { type: 'image', attrs: { id: null, attachmentId: ATT, src: 'http://evil.example/x.png', uploadToken: 'tok', title: 'x', size: 'huge', width: 0, height: 'big', alt: 'a'.repeat(501) } },
        { type: 'codeBlock', attrs: { id: ID1, language: 'x'.repeat(33) } },
        { type: 'orderedList', attrs: { start: -1, type: 'toolongtype' }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
    expect(out).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'https://a.example/' } }])] },
        { type: 'image', attrs: { attachmentId: ATT, alt: null, size: 'medium', width: null, height: null } },
        { type: 'codeBlock', attrs: { id: ID1, language: null } },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
  });

  it('drops links with a disallowed address and keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///etc/passwd', '/relative', 42]) {
      const out = normalizeRichDoc({ type: 'doc', content: [para(text('click', [{ type: 'link', attrs: { href } }, { type: 'bold' }]))] });
      expect(out.content).toEqual([{ type: 'paragraph', attrs: { id: ID1 }, content: [text('click', [{ type: 'bold' }])] }]);
    }
  });

  it('drops empty text nodes and duplicate marks', () => {
    const out = normalizeRichDoc({ type: 'doc', content: [para(text(''), text('a', [{ type: 'bold' }, { type: 'bold' }]))] });
    expect(out.content).toEqual([{ type: 'paragraph', attrs: { id: ID1 }, content: [text('a', [{ type: 'bold' }])] }]);
  });

  it('accepts an empty document and keeps Unicode text byte-identical', () => {
    expect(normalizeRichDoc({ type: 'doc' })).toEqual({ type: 'doc' });
    expect(normalizeRichDoc({ type: 'doc', content: [] })).toEqual({ type: 'doc' });
    const unicode = 'আমার সোনার বাংলা é 😀';
    expect(normalizeRichDoc({ type: 'doc', content: [para(text(unicode))] }).content).toEqual([para(text(unicode))]);
  });

  it('is idempotent', () => {
    const messy = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'x', extra: true }, content: [text('a', [{ type: 'link', attrs: { href: 'https://b.example', rel: 'x' } }]), text('')] }],
    };
    const once = normalizeRichDoc(messy);
    expect(normalizeRichDoc(once)).toEqual(once);
  });

  it('rejects unknown node and mark types, misplaced nodes and missing required attributes', () => {
    rejects({ type: 'doc', content: [{ type: 'iframe' }] }, /Unknown node type: iframe/);
    rejects({ type: 'doc', content: [{ type: 'script', content: [text('x')] }] }, /Unknown node type/);
    rejects({ type: 'doc', content: [para(text('x', [{ type: 'highlight' }]))] }, /Unknown mark type: highlight/);
    rejects({ type: 'doc', content: [{ content: [] }] }, /Node without a type/);
    rejects({ type: 'doc', content: [text('loose text')] }, /not allowed here/);
    rejects({ type: 'doc', content: [para({ type: 'paragraph' })] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'doc' }] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'bulletList', content: [para(text('x'))] }] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'heading', attrs: { level: 4 }, content: [text('H')] }] }, /Heading level/);
    rejects({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x.example/a.png' } }] }, /Image without an attachment/);
    rejects({ type: 'doc', content: [{ type: 'fileAttachment', attrs: { attachmentId: ATT, name: '', sizeBytes: 1, mime: 'x' } }] }, /File name/);
    rejects({ type: 'doc', content: [{ type: 'horizontalRule', content: [para()] }] }, /leaf node/);
    rejects({ type: 'doc', content: [para({ type: 'text', text: 5 })] }, /Text node without text/);
    rejects({ type: 'paragraph' }, /Not a document/);
    rejects(null, /Not a document/);
    rejects({ type: 'doc', content: 'x' }, /Content must be a list/);
  });

  it('rejects documents nested deeper than 64 levels or with more than 100,000 nodes', () => {
    let node: unknown = { type: 'paragraph' };
    for (let i = 0; i < MAX_DOC_DEPTH; i += 1) node = { type: 'blockquote', content: [node] };
    rejects({ type: 'doc', content: [node] }, /nested too deeply/);
    const many = Array.from({ length: 50_001 }, () => ({ type: 'paragraph', content: [text('x')] }));
    rejects({ type: 'doc', content: many }, /too many parts/);
  });
});

describe('collectAttachmentRefs', () => {
  it('lists image and file references with their block ids in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { id: ID1, attachmentId: ATT } },
        { type: 'blockquote', content: [{ type: 'fileAttachment', attrs: { id: 'bad', attachmentId: ID2, name: 'a' } }] },
        { type: 'image', attrs: { attachmentId: 'not-a-uuid' } },
      ],
    };
    expect(collectAttachmentRefs(doc)).toEqual([
      { attachmentId: ATT, blockId: ID1 },
      { attachmentId: ID2, blockId: null },
    ]);
    expect(collectAttachmentRefs(null)).toEqual([]);
  });
});
