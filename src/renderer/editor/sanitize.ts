import DOMPurify from 'dompurify';
import { normalizeHexColor } from '../../shared/color';
import { UUID_RE } from '../../shared/contracts/ids';
import { CELL_ALIGNS } from '../../shared/editor/doc-schema';
import { DOCUMENT_DEFAULT_BACKGROUND, DOCUMENT_DEFAULT_TEXT, fontFamilyFromCss, fontStack, normalizeFontSize } from '../../shared/editor/formatting';

const FORBID_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'template',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'noscript',
];
// Event handlers (on*) are removed by DOMPurify itself; inline styles are rewritten afterwards (safeStyle).
const FORBID_ATTR = ['srcset', 'formaction', 'background', 'ping'];
// Table structure and column widths (the app's own `colwidth`, spreadsheets' `col width`). DOMPurify drops every
// attribute value that does not match ALLOWED_URI_REGEXP unless it is listed as URI-safe; the schema validates them.
const ADD_ATTR = ['colwidth'];
const ADD_URI_SAFE_ATTR = ['colspan', 'rowspan', 'colwidth', 'width', 'align'];
const ALLOWED_URI_REGEXP = /^(?:https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i;
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

export interface SanitizeOptions {
  /** Called for each pasted data image; the image becomes an upload placeholder with this token. */
  onDataImage: (token: string, mime: string, base64: string) => void;
  newToken?: () => string;
}

/**
 * The part of an element's inline style a note can store, rebuilt from validated values: on spans the text color,
 * highlight, listed font and listed size (document-default black or white text and white highlights dropped), on
 * table cells the alignment; nothing anywhere else. Every other declaration is dropped.
 */
function safeStyle(el: Element, style: CSSStyleDeclaration): string {
  const out: string[] = [];
  if (el.tagName === 'SPAN') {
    const color = normalizeHexColor(style.getPropertyValue('color'));
    if (color && !DOCUMENT_DEFAULT_TEXT.includes(color)) out.push(`color: ${color}`);
    const background = normalizeHexColor(style.getPropertyValue('background-color'));
    if (background && !DOCUMENT_DEFAULT_BACKGROUND.includes(background)) out.push(`background-color: ${background}`);
    const family = fontFamilyFromCss(style.getPropertyValue('font-family'));
    if (family) out.push(`font-family: ${fontStack(family)}`);
    const size = normalizeFontSize(style.getPropertyValue('font-size'));
    if (size) out.push(`font-size: ${size}`);
  } else if (el.tagName === 'TD' || el.tagName === 'TH') {
    const align = style.getPropertyValue('text-align').trim().toLowerCase();
    if ((CELL_ALIGNS as readonly string[]).includes(align)) out.push(`text-align: ${align}`);
  }
  return out.join('; ');
}

function hostOf(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return src;
  }
}

/**
 * Cleans pasted HTML before the editor schema parses it (INF-EDIT-07, D-054). Scripts, style sheets, frames, embeds,
 * forms, SVG, MathML and event handlers go; inline styles keep only the formatting a note stores (safeStyle); links
 * keep only http(s) addresses; tables stay. Images never load anything:
 * our own copies keep their attachment ID, data images become upload placeholders, remote images become a link
 * reading "Image: <alt or host>", and anything else is removed. All work happens in an inert document.
 */
export function sanitizePastedHtml(html: string, options: SanitizeOptions): string {
  const purify = DOMPurify(window);
  // A document without a body (for example a frameset) has nothing to keep.
  const body = purify.sanitize(html, { FORBID_TAGS, FORBID_ATTR, ADD_ATTR, ADD_URI_SAFE_ATTR, ALLOWED_URI_REGEXP, RETURN_DOM: true }) as HTMLElement | null;
  if (!body) return '';
  for (const el of [...body.querySelectorAll<HTMLElement>('[style]')]) {
    const style = safeStyle(el, el.style);
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
  }
  const newToken = options.newToken ?? (() => crypto.randomUUID());

  for (const img of [...body.querySelectorAll('img')]) {
    const own = img.getAttribute('data-attachment-id');
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt') ?? '';
    if (own && UUID_RE.test(own)) {
      img.removeAttribute('src');
      continue;
    }
    const data = DATA_IMAGE.exec(src);
    if (data) {
      const token = newToken();
      options.onDataImage(token, data[1]!.toLowerCase(), data[2]!.replace(/\s+/g, ''));
      const placeholder = img.ownerDocument.createElement('img');
      placeholder.setAttribute('data-upload-token', token);
      if (alt) placeholder.setAttribute('alt', alt);
      img.replaceWith(placeholder);
    } else if (/^https?:/i.test(src)) {
      const link = img.ownerDocument.createElement('a');
      link.setAttribute('href', src);
      link.textContent = `Image: ${alt || hostOf(src)}`;
      img.replaceWith(link);
    } else {
      img.remove();
    }
  }
  return body.innerHTML;
}
