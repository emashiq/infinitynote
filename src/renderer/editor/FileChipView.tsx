import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { FileText } from 'lucide-react';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import { formatBytes } from '../../shared/attachments/names';

/** File chip: icon, name and size; "Adding file…" while the file is being imported. */
export function FileChipView({ node, selected }: ReactNodeViewProps) {
  const { name, sizeBytes, uploadToken } = node.attrs as { name: string; sizeBytes: number; uploadToken: string | null };
  return (
    <NodeViewWrapper className={`file-chip${selected ? ' is-selected' : ''}`} data-drag-handle>
      <FileText size={16} strokeWidth={1.75} aria-hidden />
      <span className="file-chip-name">{name}</span>
      <span className="muted">{uploadToken ? ATTACHMENT_MESSAGES.addingFile : formatBytes(sizeBytes)}</span>
    </NodeViewWrapper>
  );
}
