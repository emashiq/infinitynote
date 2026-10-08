/** Temporary plain-text editor mapping (D-048): one paragraph per line. */
export interface RichDocLike {
  type: 'doc';
  content?: unknown[];
  [key: string]: unknown;
}

export function textToDoc(text: string): RichDocLike {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => (line === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

interface NodeLike {
  type?: unknown;
  text?: unknown;
  marks?: unknown;
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

export function isTextareaCompatible(doc: unknown): boolean {
  if (doc === null || typeof doc !== 'object' || (doc as NodeLike).type !== 'doc') return false;
  const content = (doc as NodeLike).content;
  if (content !== undefined && !Array.isArray(content)) return false;
  return asNodes(content).every((p) => {
    if (p === null || typeof p !== 'object' || p.type !== 'paragraph') return false;
    if (p.marks !== undefined) return false;
    if (p.content !== undefined && !Array.isArray(p.content)) return false;
    return asNodes(p.content).every((c) => {
      if (c === null || typeof c !== 'object') return false;
      if (c.type === 'hardBreak') return true;
      if (c.type !== 'text' || typeof c.text !== 'string') return false;
      return c.marks === undefined || (Array.isArray(c.marks) && c.marks.length === 0);
    });
  });
}
