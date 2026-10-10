import { Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { htmlDocumentUrl } from '../../../shared/app-identity';
import { COMMENT_MESSAGES, MAX_COMMENT_QUOTE } from '../../../shared/contracts/comments';
import { LINK_COPIED, LINK_COPY_FAILED } from '../../ui/copy-text';
import { Menu } from '../../ui/Menu';
import { SegmentedControl } from '../../ui/SegmentedControl';
import type { DocumentViewerProps } from '../viewer-registry';
import { externalLinks, tokenizeHtml } from './html-source';
import { occurrenceAt, occurrenceStart, rangeOf, textOffset } from './source-anchors';

export const QUOTE_GONE = 'The commented text is no longer in this page';
export const LINKS_STAY_CLOSED = 'Links in a saved page do not open. Copy them from Links.';

/** The Source view shows at most this much of a page; the rest is cut with a note. */
export const MAX_SOURCE_CHARS = 1024 * 1024;

type Mode = 'page' | 'source';

/**
 * The read-only HTML viewer (F6, D-118). The page renders in a frame with an empty `sandbox` (no scripts, no same
 * origin, no forms, no popups, no top navigation) from the infinity-html scheme, whose policy blocks every script and
 * network request; main stops any navigation within the scheme the page starts, and the app's frame policy refuses the
 * rest (see PageFrame). Links therefore open nothing; their addresses are listed under Links with "Copy link". Source shows the page's markup, colored, as text nodes only. Comments are
 * made on text selected in Source (the app cannot read the sandboxed page) and revealed there (D-165).
 */
export default function HtmlViewer({ document, sourceUrl, host }: DocumentViewerProps) {
  const [mode, setMode] = useState<Mode>('page');
  // The source of the URL it was read from: a new revision reads again.
  const [loaded, setLoaded] = useState<{ url: string; text: string | null } | null>(null);
  const current = loaded?.url === sourceUrl ? loaded : null;
  const source = current?.text ?? null;
  const failed = current !== null && current.text === null;
  const [linksAnchor, setLinksAnchor] = useState<{ x: number; y: number } | null>(null);
  const linksButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let stale = false;
    fetch(sourceUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then(
        (text) => !stale && setLoaded({ url: sourceUrl, text }),
        () => !stale && setLoaded({ url: sourceUrl, text: null }),
      );
    return () => {
      stale = true;
    };
  }, [sourceUrl]);

  const links = useMemo(() => (source === null ? [] : externalLinks(source)), [source]);

  // Comments (D-165): the quoted source text and which occurrence of it was selected.
  const sourceRef = useRef<HTMLPreElement>(null);
  const modeNow = useRef(mode);
  useEffect(() => {
    modeNow.current = mode;
  }, [mode]);
  const [revealing, setRevealing] = useState<{ quote: string; occurrence: number } | null>(null);
  const loadedSource = source !== null;
  useEffect(() => {
    if (!loadedSource) return undefined;
    return host.comments({
      current: () => {
        const pre = sourceRef.current;
        const selection = pre?.ownerDocument.getSelection();
        if (modeNow.current !== 'source' || !pre || !selection || selection.isCollapsed || !pre.contains(selection.anchorNode) || !pre.contains(selection.focusNode)) {
          return { error: COMMENT_MESSAGES.htmlSource };
        }
        const range = selection.getRangeAt(0);
        const raw = range.toString();
        const quote = raw.trim().slice(0, MAX_COMMENT_QUOTE);
        if (quote === '') return { error: COMMENT_MESSAGES.htmlSource };
        const start = textOffset(pre, range.startContainer, range.startOffset) + (raw.length - raw.trimStart().length);
        return { anchor: { type: 'quote', occurrence: occurrenceAt(pre.textContent ?? '', quote, start) }, quote };
      },
      reveal: (thread) => {
        if (thread.anchor.type !== 'quote') return false;
        setMode('source');
        setRevealing({ quote: thread.quote, occurrence: thread.anchor.occurrence });
        return true;
      },
    });
  }, [loadedSource, host]);
  useEffect(() => {
    const pre = sourceRef.current;
    if (!revealing || mode !== 'source' || !pre) return;
    setRevealing(null);
    const at = occurrenceStart(pre.textContent ?? '', revealing.quote, revealing.occurrence);
    const range = at >= 0 ? rangeOf(pre, at, at + revealing.quote.length) : null;
    if (!range) return void host.notify(QUOTE_GONE, 'error');
    const selection = pre.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [revealing, mode, host]);
  const copy = async (url: string) => {
    if (await host.copyText(url)) host.notify(LINK_COPIED, 'info');
    else host.notify(LINK_COPY_FAILED, 'error');
  };

  return (
    <div className="html-viewer">
      <div className="document-toolbar" role="toolbar" aria-label="Web page view">
        <SegmentedControl
          label="Show"
          name={`html-mode-${document.id}`}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'page', label: 'Page' },
            { value: 'source', label: 'Source' },
          ]}
        />
        <button
          ref={linksButton}
          type="button"
          className="btn btn-small"
          aria-haspopup="menu"
          aria-expanded={linksAnchor !== null}
          disabled={links.length === 0}
          title={links.length === 0 ? 'This page has no web links' : undefined}
          onClick={() => {
            const r = linksButton.current?.getBoundingClientRect();
            setLinksAnchor(linksAnchor ? null : { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 2 });
          }}
        >
          <Link2 size={14} strokeWidth={1.75} aria-hidden />
          {`Links (${links.length})`}
        </button>
        {linksAnchor ? (
          <Menu
            label="Copy a link"
            anchor={linksAnchor}
            onClose={() => setLinksAnchor(null)}
            items={links.map((url, i) => ({ id: `link-${i}`, label: `Copy ${url}`, onSelect: () => void copy(url) }))}
          />
        ) : null}
      </div>
      {mode === 'page' ? (
        <PageFrame
          key={document.revision}
          title={`${document.title} (web page)`}
          src={htmlDocumentUrl(document.id, document.revision)}
          onLeft={() => host.notify(LINKS_STAY_CLOSED, 'info')}
        />
      ) : (
        <HtmlSource source={source} failed={failed} preRef={sourceRef} />
      )}
    </div>
  );
}

/**
 * The page in its sandboxed frame. A link that leaves the scheme is refused by the app's frame policy before main sees
 * the navigation, which leaves Chromium's error page in the frame. A load after the page's own one, or one while the
 * frame has the focus (a click inside it; the click can come before the page finished loading), is that, and the
 * frame then shows the page again. The page cannot navigate by itself (no scripts, and a sandboxed page's refresh is
 * refused), so only a click does.
 */
function PageFrame({ title, src, onLeft }: { title: string; src: string; onLeft: () => void }) {
  const [generation, setGeneration] = useState(0);
  const loads = useRef(0);
  const onLoad = (frame: HTMLIFrameElement) => {
    loads.current += 1;
    if (loads.current < 2 && frame.ownerDocument.activeElement !== frame) return;
    loads.current = 0;
    setGeneration((g) => g + 1);
    onLeft();
  };
  return <iframe key={generation} className="html-frame" title={title} sandbox="" referrerPolicy="no-referrer" src={src} onLoad={(e) => onLoad(e.currentTarget)} />;
}

function HtmlSource({ source, failed, preRef }: { source: string | null; failed: boolean; preRef: RefObject<HTMLPreElement | null> }) {
  const shown = source === null ? null : source.slice(0, MAX_SOURCE_CHARS);
  const tokens = useMemo(() => (shown === null ? [] : tokenizeHtml(shown)), [shown]);
  if (failed) return <p className="muted document-message">The source of this page could not be read.</p>;
  if (shown === null) return <div className="document-loading" aria-busy="true" />;
  return (
    <div className="html-source-wrap">
      {source !== null && source.length > MAX_SOURCE_CHARS ? <p className="muted document-message">Showing the first 1 MB of the source.</p> : null}
      <pre ref={preRef} className="html-source" tabIndex={0} aria-label="Page source">
        <code>
          {tokens.map((t, i) =>
            t.kind === 'text' ? (
              t.text
            ) : (
              <span key={i} className={`src-${t.kind}`}>
                {t.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
