import { renderAsync, type Options } from 'docx-preview';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { DOCX_MESSAGES } from './docx-messages';

/**
 * How a file the editor refused is drawn (D-144): pictures as `data:` URLs (no object URLs left behind), no fonts
 * embedded in the file (the app's CSP allows fonts from the app only), and never alternative HTML parts ("altChunk"),
 * which docx-preview would put into a frame of the app's own origin.
 */
const PREVIEW_OPTIONS: Partial<Options> = {
  inWrapper: true,
  breakPages: true,
  ignoreFonts: true,
  useBase64URL: true,
  renderAltChunks: false,
  renderComments: false,
  renderChanges: false,
  experimental: false,
};

/** A link in the preview opens nothing, like links in the HTML viewer (D-120). */
function blockLinks(event: MouseEvent): void {
  if (event.nativeEvent.composedPath().some((target) => target instanceof HTMLAnchorElement)) event.preventDefault();
}

/**
 * A read-only rendering of a Word document the editor cannot open for editing (D-144), with docx-preview (Apache-2.0).
 * It draws into a shadow root, so the styles it builds from the file apply to the preview alone and cannot restyle the
 * app around it.
 */
export default function DocxPreview({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const styles = document.createElement('div');
    const body = document.createElement('div');
    root.replaceChildren(styles, body);
    let live = true;
    renderAsync(bytes, body, styles, PREVIEW_OPTIONS).catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
      root.replaceChildren();
    };
  }, [bytes]);

  if (failed) return <p className="docx-message">{DOCX_MESSAGES.previewFailed}</p>;
  return <div ref={host} className="docx-preview" role="document" aria-label="Preview" onClickCapture={blockLinks} onAuxClickCapture={blockLinks} />;
}
