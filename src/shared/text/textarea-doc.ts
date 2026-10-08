import type { RichDocLike } from '../editor/doc-schema';

/**
 * Plain-text mapping between a string and a document of paragraphs, one paragraph per line. Used by the
 * plain-text editor and by plain-to-rich conversion. `id` gives each paragraph a block ID.
 */
export function textToDoc(text: string, opts: { id?: () => string } = {}): RichDocLike {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => {
      const attrs = opts.id ? { attrs: { id: opts.id() } } : {};
      return line === '' ? { type: 'paragraph', ...attrs } : { type: 'paragraph', ...attrs, content: [{ type: 'text', text: line }] };
    }),
  };
}

interface NodeLike {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function asNodes(v: unknown): NodeLike[] {
  return Array.isArray(v) ? (v as NodeLike[]) : [];
}

export function docToText(doc: unknown): string {
  const top = asNodes((doc as NodeLike | null)?.content);
  return top
    .map((p) =>
      asNodes(p.content)
        .map((c) => (c.type === 'hardBreak' ? '\n' : typeof c.text === 'string' ? c.text : ''))
        .join(''),
    )
    .join('\n');
}
