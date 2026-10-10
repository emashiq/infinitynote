import type { RichNode } from '../../shared/editor/doc-schema';
import { refText } from '../../shared/editor/inline-text';
import { extractPlainText } from '../../shared/text/plain-text';

/**
 * Markdown for one rich note (INF-PORT-05). Lossy by design and documented in Settings and the progress report: block
 * IDs, reminders, tags, sticky state and colors, fonts, font sizes, text and highlight colors, image size presets and
 * underline are dropped; note and document links become the text they show; math becomes `$…$` and `$$…$$` and a
 * Mermaid diagram stays its ```mermaid fence (D-158, D-161); tables become GFM tables; images and files become
 * links to copies saved next to the Markdown file; linked files become file:// links to their original location.
 */
export interface MarkdownAssets {
  /** The relative link of an attachment copy, or null when the file is unavailable. */
  linkOf(attachmentId: string): string | null;
  /** The file:// URL of a linked file's stored path (D-108), or null when the link is unknown. */
  linkedFileUrl(linkId: string): string | null;
}

/** A link target without the characters that end a Markdown link (encodeURIComponent leaves parentheses as they are). */
const linkTarget = (href: string): string => href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const escapeText = (text: string): string => text.replace(/([\\`*_[\]<>])/g, '\\$1');

function inline(nodes: readonly RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n';
      if (node.type === 'noteRef' || node.type === 'docRef') return escapeText(refText(node.attrs));
      if (node.type === 'mathInline') return `$${String(node.attrs?.latex ?? '')}$`;
      if (node.type !== 'text' || typeof node.text !== 'string') return '';
      const marks = new Set((node.marks ?? []).map((m) => m.type));
      if (marks.has('code')) return `\`${node.text.replace(/`/g, 'ˋ')}\``;
      let out = escapeText(node.text);
      if (marks.has('bold')) out = `**${out}**`;
      if (marks.has('italic')) out = `*${out}*`;
      if (marks.has('strike')) out = `~~${out}~~`;
      const link = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
      if (typeof link === 'string') out = `[${out}](${linkTarget(link)})`;
      return out;
    })
    .join('');
}

/** A cell on one line: its paragraphs and headings with their marks, other blocks as text; pipes escaped. */
function cellMarkdown(cell: RichNode): string {
  return (cell.content ?? [])
    .map((b) => (b.type === 'paragraph' || b.type === 'heading' ? inline(b.content) : escapeText(extractPlainText('rich', { type: 'doc', content: [b] }))))
    .join('\n')
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/ *\n+/g, '<br>');
}

const ALIGN_RULE: Record<string, string> = { left: ':---', center: ':---:', right: '---:' };

/**
 * A GFM table. Its first row is the header row (Markdown requires one); a cell spanning columns is followed by empty
 * cells, while row spans and column widths are dropped.
 */
function table(node: RichNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).flatMap((cell) => {
      const span = typeof cell.attrs?.colspan === 'number' ? cell.attrs.colspan : 1;
      return [{ text: cellMarkdown(cell), align: cell.attrs?.align }, ...Array.from({ length: span - 1 }, () => ({ text: '', align: null }))];
    }),
  );
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (texts: string[]) => `| ${texts.join(' | ')} |`;
  const [head = [], ...body] = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? { text: '', align: null }));
  return [
    line(head.map((c) => c.text)),
    line(head.map((c) => (typeof c.align === 'string' ? (ALIGN_RULE[c.align] ?? '---') : '---'))),
    ...body.map((r) => line(r.map((c) => c.text))),
  ].join('\n');
}

/** Indents every line after the first, so a block continues inside its list item. */
const continueLines = (text: string, indent: string): string => text.replace(/\n(?=.)/g, `\n${indent}`);

function listItems(items: readonly RichNode[], marker: (index: number, item: RichNode) => string, assets: MarkdownAssets): string {
  return items
    .map((item, i) => {
      const prefix = marker(i, item);
      return `${prefix}${continueLines(blocks(item.content ?? [], assets), ' '.repeat(prefix.length))}`;
    })
    .join('\n');
}

function block(node: RichNode, assets: MarkdownAssets): string {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return inline(node.content);
    case 'heading':
      return `${'#'.repeat(typeof attrs.level === 'number' ? attrs.level : 1)} ${inline(node.content)}`;
    case 'codeBlock': {
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      const language = typeof attrs.language === 'string' ? attrs.language : '';
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case 'blockquote':
      return blocks(node.content ?? [], assets)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bulletList':
      return listItems(node.content ?? [], () => '- ', assets);
    case 'orderedList': {
      const start = typeof attrs.start === 'number' ? attrs.start : 1;
      return listItems(node.content ?? [], (i) => `${start + i}. `, assets);
    }
    case 'taskList':
      return listItems(node.content ?? [], (_i, item) => (item.attrs?.checked === true ? '- [x] ' : '- [ ] '), assets);
    case 'horizontalRule':
      return '---';
    case 'mathBlock':
      return `$$\n${String(attrs.latex ?? '')}\n$$`;
    case 'table':
      return table(node);
    case 'image': {
      const link = typeof attrs.attachmentId === 'string' ? assets.linkOf(attrs.attachmentId) : null;
      const alt = escapeText(typeof attrs.alt === 'string' ? attrs.alt : 'image');
      return link ? `![${alt}](${link})` : `*[${alt}: image unavailable]*`;
    }
    case 'fileAttachment': {
      const link = typeof attrs.attachmentId === 'string' ? assets.linkOf(attrs.attachmentId) : null;
      const name = escapeText(typeof attrs.name === 'string' ? attrs.name : 'file');
      return link ? `[${name}](${link})` : `*[${name}: file unavailable]*`;
    }
    case 'fileLink': {
      const url = typeof attrs.linkId === 'string' ? assets.linkedFileUrl(attrs.linkId) : null;
      const name = escapeText(typeof attrs.name === 'string' ? attrs.name : 'file');
      return url ? `[${name}](${linkTarget(url)})` : `*[${name}: linked file unavailable]*`;
    }
    default:
      return '';
  }
}

function blocks(nodes: readonly RichNode[], assets: MarkdownAssets): string {
  return nodes.map((n) => block(n, assets)).join('\n\n');
}

export function richToMarkdown(title: string, doc: { content?: unknown[] }, assets: MarkdownAssets): string {
  const body = blocks((doc.content ?? []) as RichNode[], assets);
  return `${title ? `# ${escapeText(title)}\n\n` : ''}${body}\n`;
}
