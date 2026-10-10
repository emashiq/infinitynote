import { parseExternalUrl } from '../../shared/url-policy';
import type { RichNode } from '../../shared/editor/doc-schema';
import { fontStack, normalizeTextStyle } from '../../shared/editor/formatting';
import { refText } from '../../shared/editor/inline-text';
import { MERMAID_LANGUAGE } from '../../shared/editor/code-languages';

/**
 * A rich note as one self-contained HTML page (F11.5, D-163), for "Export as HTML", "Export as PDF" and "Print". Every
 * text and attribute is escaped; the only markup that comes from elsewhere is KaTeX's (made in main from the TeX) and
 * images, which are `data:` URLs (attachments read by main, diagrams drawn by the renderer), so nothing in the page can
 * run or load anything: its policy allows no script and no network.
 */
export interface NoteHtmlAssets {
  /** A `data:` URL of an attached image, or null when it is unavailable. */
  image(attachmentId: string): string | null;
  /** The drawing of a Mermaid source as SVG, or null when none was drawn. */
  diagram(source: string): string | null;
  /** A formula as HTML (KaTeX), or null when the TeX is invalid. */
  math(latex: string, display: boolean): string | null;
}

export const NOTE_HTML_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

const PAGE_CSS = `
  body { margin: 0; padding: 24px 32px; color: #1d1f24; background: #fff; font: 15px/1.6 "Segoe UI", system-ui, "Noto Sans", "DejaVu Sans", sans-serif; }
  h1.note-title { font-size: 1.8em; margin: 0 0 0.6em; }
  h1, h2, h3 { line-height: 1.3; }
  pre { padding: 10px 12px; background: #f4f5f7; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
  code { font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; font-size: 0.92em; }
  :not(pre) > code { padding: 1px 4px; background: #f4f5f7; border-radius: 4px; }
  blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 3px solid #d0d3da; color: #555b66; }
  table { border-collapse: collapse; margin: 0.5em 0; }
  th, td { border: 1px solid #c4c8d0; padding: 4px 8px; vertical-align: top; }
  th { background: #f4f5f7; }
  img { max-width: 100%; }
  img.img-small { max-width: 240px; }
  img.img-medium { max-width: 480px; }
  ul.tasks { list-style: none; padding-left: 1.2em; }
  ul.tasks li::before { content: "\\2610\\00a0"; }
  ul.tasks li.done::before { content: "\\2611\\00a0"; }
  .diagram { text-align: center; margin: 0.5em 0; }
  .math-block { text-align: center; margin: 0.5em 0; overflow-x: auto; }
  .file { color: #555b66; }
  .missing { color: #8a6d00; font-style: italic; }
  @media print { body { padding: 0; } pre, table, .diagram, .math-block, img { break-inside: avoid; } }
`;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const attrsOf = (node: RichNode): Record<string, unknown> => node.attrs ?? {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function styleOf(attrs: Record<string, unknown>): string {
  const style = normalizeTextStyle(attrs);
  if (!style) return '';
  const parts = [
    style.color ? `color:${style.color}` : '',
    style.backgroundColor ? `background-color:${style.backgroundColor}` : '',
    style.fontFamily ? `font-family:${fontStack(style.fontFamily)}` : '',
    style.fontSize ? `font-size:${style.fontSize}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? ` style="${escapeHtml(parts.join(';'))}"` : '';
}

function textNode(node: RichNode): string {
  let out = escapeHtml(node.text ?? '');
  for (const mark of node.marks ?? []) {
    const attrs = mark.attrs ?? {};
    switch (mark.type) {
      case 'bold':
        out = `<strong>${out}</strong>`;
        break;
      case 'italic':
        out = `<em>${out}</em>`;
        break;
      case 'strike':
        out = `<s>${out}</s>`;
        break;
      case 'underline':
        out = `<u>${out}</u>`;
        break;
      case 'code':
        out = `<code>${out}</code>`;
        break;
      case 'link': {
        const href = str(attrs.href);
        if (parseExternalUrl(href).ok) out = `<a href="${escapeHtml(href)}">${out}</a>`;
        break;
      }
      case 'textStyle': {
        const style = styleOf(attrs);
        if (style) out = `<span${style}>${out}</span>`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function inline(nodes: readonly RichNode[] | undefined, assets: NoteHtmlAssets): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case 'text':
          return textNode(node);
        case 'hardBreak':
          return '<br>';
        case 'noteRef':
        case 'docRef':
          return `<span class="ref">${escapeHtml(refText(node.attrs))}</span>`;
        case 'mathInline': {
          const latex = str(attrsOf(node).latex);
          return assets.math(latex, false) ?? `<code>${escapeHtml(latex)}</code>`;
        }
        default:
          return '';
      }
    })
    .join('');
}

const blocks = (nodes: readonly RichNode[] | undefined, assets: NoteHtmlAssets): string => (nodes ?? []).map((n) => block(n, assets)).join('\n');

function cell(node: RichNode, assets: NoteHtmlAssets): string {
  const a = attrsOf(node);
  const tag = node.type === 'tableHeader' ? 'th' : 'td';
  const span = (name: string, v: unknown) => (typeof v === 'number' && v > 1 ? ` ${name}="${v}"` : '');
  const align = typeof a.align === 'string' ? ` style="text-align:${escapeHtml(a.align)}"` : '';
  return `<${tag}${span('colspan', a.colspan)}${span('rowspan', a.rowspan)}${align}>${blocks(node.content, assets)}</${tag}>`;
}

function block(node: RichNode, assets: NoteHtmlAssets): string {
  const a = attrsOf(node);
  switch (node.type) {
    case 'paragraph':
      return `<p>${inline(node.content, assets)}</p>`;
    case 'heading': {
      const level = typeof a.level === 'number' ? Math.min(3, Math.max(1, a.level)) : 1;
      return `<h${level}>${inline(node.content, assets)}</h${level}>`;
    }
    case 'codeBlock': {
      const source = (node.content ?? []).map((c) => c.text ?? '').join('');
      const svg = a.language === MERMAID_LANGUAGE ? assets.diagram(source) : null;
      if (svg) return `<div class="diagram"><img alt="Diagram" src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}"></div>`;
      return `<pre><code>${escapeHtml(source)}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>${blocks(node.content, assets)}</blockquote>`;
    case 'bulletList':
      return `<ul>${(node.content ?? []).map((li) => `<li>${blocks(li.content, assets)}</li>`).join('')}</ul>`;
    case 'orderedList': {
      const start = typeof a.start === 'number' && a.start !== 1 ? ` start="${a.start}"` : '';
      return `<ol${start}>${(node.content ?? []).map((li) => `<li>${blocks(li.content, assets)}</li>`).join('')}</ol>`;
    }
    case 'taskList':
      return `<ul class="tasks">${(node.content ?? []).map((li) => `<li${li.attrs?.checked === true ? ' class="done"' : ''}>${blocks(li.content, assets)}</li>`).join('')}</ul>`;
    case 'horizontalRule':
      return '<hr>';
    case 'table':
      return `<table>${(node.content ?? []).map((row) => `<tr>${(row.content ?? []).map((c) => cell(c, assets)).join('')}</tr>`).join('')}</table>`;
    case 'image': {
      const src = typeof a.attachmentId === 'string' ? assets.image(a.attachmentId) : null;
      const alt = escapeHtml(str(a.alt) || 'image');
      return src ? `<p><img class="img-${escapeHtml(str(a.size) || 'medium')}" alt="${alt}" src="${src}"></p>` : `<p class="missing">[${alt}: image unavailable]</p>`;
    }
    case 'fileAttachment':
    case 'fileLink':
      return `<p class="file">📎 ${escapeHtml(str(a.name) || 'file')}</p>`;
    case 'mathBlock': {
      const latex = str(a.latex);
      return `<div class="math-block">${assets.math(latex, true) ?? `<pre><code>${escapeHtml(latex)}</code></pre>`}</div>`;
    }
    default:
      return '';
  }
}

/** The whole page: the note's title as its heading, then its content. */
export function richToHtml(title: string, doc: { content?: unknown[] }, assets: NoteHtmlAssets): string {
  const heading = title.trim() === '' ? 'Untitled' : title;
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${NOTE_HTML_CSP}">`,
    `<title>${escapeHtml(heading)}</title>`,
    `<style>${PAGE_CSS}</style>`,
    '</head><body>',
    `<h1 class="note-title">${escapeHtml(heading)}</h1>`,
    blocks((doc.content ?? []) as RichNode[], assets),
    '</body></html>',
    '',
  ].join('\n');
}

/** A plain-text note as a page: its lines as paragraphs. */
export function plainToHtml(title: string, text: string): string {
  const doc = { content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) };
  return richToHtml(title, doc, { image: () => null, diagram: () => null, math: () => null });
}
