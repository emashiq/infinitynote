import DOMPurify from 'dompurify';
import { UUID_RE } from '../../shared/contracts/ids';

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
// Event handlers (on*) are removed by DOMPurify itself.
const FORBID_ATTR = ['style', 'srcset', 'formaction', 'background', 'ping'];
const ALLOWED_URI_REGEXP = /^(?:https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i;
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

export interface SanitizeOptions {
  /** Called for each pasted data image; the image becomes an upload placeholder with this token. */
  onDataImage: (token: string, mime: string, base64: string) => void;
  newToken?: () => string;
}

function hostOf(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return src;
  }
}

/**
 * Cleans pasted HTML before the editor schema parses it (INF-EDIT-07, D-054). Scripts, styles, frames, embeds,
 * forms, SVG, MathML and event handlers go; links keep only http(s) addresses. Images never load anything:
 * our own copies keep their attachment ID, data images become upload placeholders, remote images become a link
 * reading "Image: <alt or host>", and anything else is removed. All work happens in an inert document.
 */
export function sanitizePastedHtml(html: string, options: SanitizeOptions): string {
  const purify = DOMPurify(window);
  // A document without a body (for example a frameset) has nothing to keep.
  const body = purify.sanitize(html, { FORBID_TAGS, FORBID_ATTR, ALLOWED_URI_REGEXP, RETURN_DOM: true }) as HTMLElement | null;
  if (!body) return '';
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
