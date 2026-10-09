import type { RichNode } from '../../shared/editor/doc-schema';

/**
 * Markdown for one rich note (INF-PORT-05). Lossy by design and documented in Settings and the progress report: block
 * IDs, reminders, tags, sticky state and colors, image size presets and underline are dropped; note references become
 * their label text; images and files become links to copies saved next to the Markdown file.
 */
export interface MarkdownAssets {
  /** The relative link of an attachment copy, or null when the file is unavailable. */
  linkOf(attachmentId: string): string | null;
}

const escapeText = (text: string): string => text.replace(/([\\`*_[\]<>])/g, '\\$1');

function inline(nodes: readonly RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n';
      if (node.type === 'noteRef') return escapeText(typeof node.attrs?.label === 'string' ? node.attrs.label : '');
      if (node.type !== 'text' || typeof node.text !== 'string') return '';
      const marks = new Set((node.marks ?? []).map((m) => m.type));
      if (marks.has('code')) return `\`${node.text.replace(/`/g, 'ˋ')}\``;
      let out = escapeText(node.text);
      if (marks.has('bold')) out = `**${out}**`;
      if (marks.has('italic')) out = `*${out}*`;
      if (marks.has('strike')) out = `~~${out}~~`;
      const link = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
      if (typeof link === 'string') out = `[${out}](${link.replace(/[()\s]/g, encodeURIComponent)})`;
      return out;
    })
    .join('');
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
