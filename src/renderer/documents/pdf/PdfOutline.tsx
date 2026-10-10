import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/** One bookmark of a PDF: where it goes inside the document, or a web address it names. */
export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  url: string | null;
  items: PdfOutlineItem[];
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

/** The outline as the panel shows it; titles are never empty. */
export function toOutlineItems(nodes: readonly OutlineNode[] | null): PdfOutlineItem[] {
  return (nodes ?? []).map((node) => ({
    title: node.title.trim() || 'Untitled',
    dest: node.dest,
    url: typeof node.url === 'string' && node.url !== '' ? node.url : null,
    items: toOutlineItems(node.items),
  }));
}

export interface PdfOutlineProps {
  pdf: PDFDocumentProxy;
  generation: number;
  onGo(dest: unknown): void;
  onCopyLink(url: string): void;
}

/**
 * The outline (bookmarks) panel (F2): a nested list of buttons that show their place; a bookmark to a web address
 * offers "Copy link" only, like links in the page (D-130).
 */
export function PdfOutline({ pdf, generation, onGo, onCopyLink }: PdfOutlineProps) {
  const [items, setItems] = useState<{ generation: number; items: PdfOutlineItem[] } | null>(null);

  useEffect(() => {
    let stale = false;
    void pdf.getOutline().then(
      (nodes) => !stale && setItems({ generation, items: toOutlineItems(nodes) }),
      () => !stale && setItems({ generation, items: [] }),
    );
    return () => {
      stale = true;
    };
  }, [pdf, generation]);

  if (items?.generation !== generation) return <div className="document-loading" aria-busy="true" />;
  if (items.items.length === 0) return <p className="muted pdf-panel-empty">This PDF has no outline.</p>;
  return <OutlineList items={items.items} onGo={onGo} onCopyLink={onCopyLink} label="Outline" />;
}

function OutlineList({ items, onGo, onCopyLink, label }: { items: PdfOutlineItem[]; onGo(dest: unknown): void; onCopyLink(url: string): void; label?: string }) {
  return (
    <ul className="pdf-outline" aria-label={label}>
      {items.map((item, i) => (
        <li key={i}>
          {item.url ? (
            <button type="button" className="pdf-outline-item" title={item.url} onClick={() => onCopyLink(item.url!)}>
              <Link2 size={14} strokeWidth={1.75} aria-hidden />
              <span>{item.title}</span>
              <span className="sr-only"> (copy link)</span>
            </button>
          ) : (
            <button type="button" className="pdf-outline-item" disabled={item.dest === null || item.dest === undefined} onClick={() => onGo(item.dest)}>
              <span>{item.title}</span>
            </button>
          )}
          {item.items.length > 0 ? <OutlineList items={item.items} onGo={onGo} onCopyLink={onCopyLink} /> : null}
        </li>
      ))}
    </ul>
  );
}
