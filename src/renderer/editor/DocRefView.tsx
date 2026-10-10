import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { File } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { describeTarget, type DocumentTargetType } from '../../shared/documents/targets';
import { displayTitle } from '../../shared/names';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import type { NoteRefOptions } from './note-ref';

const noSubscribe = () => () => undefined;

/**
 * A document link chip: the document's live title (or the link's alias) and the place it opens at. A document that is
 * not live keeps the label it had and is marked unavailable; clicking it shows the document's Trash or missing state.
 */
export function DocRefView({ node, extension, selected }: ReactNodeViewProps) {
  const { documentId, target, label, alias } = node.attrs as { documentId: string; target: DocumentTargetType | null; label: string; alias: string | null };
  const host = (extension.options as NoteRefOptions).host;
  const live = useSyncExternalStore(host ? host.subscribe : noSubscribe, () => (host ? host.documentOf(documentId) : undefined));
  const title = alias ?? displayTitle(live?.label ?? label);
  const text = target ? `${title} › ${describeTarget(target)}` : title;
  const unavailable = host !== null && live === null;
  const describe = unavailable ? `${text} (linked document unavailable)` : text;
  return (
    <NodeViewWrapper
      as="span"
      className={`note-ref doc-ref${unavailable ? ' is-unavailable' : ''}${selected ? ' is-selected' : ''}`}
      data-doc-ref={documentId}
      role={host ? 'link' : undefined}
      aria-label={describe}
      title={host ? `Open ${describe}` : describe}
      onClick={host ? () => host.openDocument(documentId, target) : undefined}
    >
      {live?.documentKind ? <DocumentKindIcon kind={live.documentKind} size={12} /> : <File size={12} strokeWidth={1.75} aria-hidden />}
      {text}
    </NodeViewWrapper>
  );
}
