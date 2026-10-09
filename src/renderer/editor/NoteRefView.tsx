import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { FileText } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { displayTitle } from '../../shared/names';
import type { NoteRefOptions } from './note-ref';

const noSubscribe = () => () => undefined;

/**
 * A reference chip: the target's live title (and the block excerpt), opening the target on click. A target that is
 * not live keeps the label it had and is marked unavailable; clicking it opens the note's own Trash or missing state.
 */
export function NoteRefView({ node, extension, selected }: ReactNodeViewProps) {
  const { noteId, blockId, label, excerpt } = node.attrs as { noteId: string; blockId: string | null; label: string; excerpt: string | null };
  const host = (extension.options as NoteRefOptions).host;
  const live = useSyncExternalStore(host ? host.subscribe : noSubscribe, () => (host ? host.titleOf(noteId) : label));
  const title = displayTitle(live ?? label);
  const text = excerpt ? `${title} › ${excerpt}` : title;
  const unavailable = host !== null && live === null;
  const describe = unavailable ? `${text} (linked note unavailable)` : text;
  return (
    <NodeViewWrapper
      as="span"
      className={`note-ref${unavailable ? ' is-unavailable' : ''}${selected ? ' is-selected' : ''}`}
      data-note-ref={noteId}
      data-block-ref={blockId ?? undefined}
      role={host ? 'link' : undefined}
      aria-label={describe}
      title={host ? `Open ${describe}` : describe}
      onClick={host ? () => host.open(noteId, blockId) : undefined}
    >
      <FileText size={12} strokeWidth={1.75} aria-hidden />
      {text}
    </NodeViewWrapper>
  );
}
