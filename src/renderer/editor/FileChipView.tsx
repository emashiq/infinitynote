import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { FileText } from 'lucide-react';
import type { MouseEvent } from 'react';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import { formatBytes } from '../../shared/attachments/names';
import { documentKindOf } from '../../shared/documents/kinds';
import type { FileAttachmentOptions } from './file-attachment';

/** Keeps a press on a chip button from selecting the node first. */
const keepSelection = (e: MouseEvent) => e.preventDefault();

/**
 * File chip: icon, name and size; "Adding file…" while the file is being imported; Open and Show in folder after, and
 * Open in Infinity Notes for a document kind (D-118).
 */
export function FileChipView({ node, selected, extension }: ReactNodeViewProps) {
  const { attachmentId, name, sizeBytes, uploadToken } = node.attrs as { attachmentId: string | null; name: string; sizeBytes: number; uploadToken: string | null };
  const files = (extension.options as FileAttachmentOptions).files;
  const ready = files !== null && attachmentId !== null && !uploadToken;
  return (
    <NodeViewWrapper className={`file-chip${selected ? ' is-selected' : ''}`} data-drag-handle>
      <FileText size={16} strokeWidth={1.75} aria-hidden />
      <span className="file-chip-name">{name}</span>
      <span className="muted">{uploadToken ? ATTACHMENT_MESSAGES.addingFile : formatBytes(sizeBytes)}</span>
      {ready ? (
        <span className="file-chip-actions">
          {files.openInApp && documentKindOf(name) ? (
            <button type="button" className="btn btn-small" aria-label={`Open ${name} in Infinity Notes`} onMouseDown={keepSelection} onClick={() => files.openInApp?.(attachmentId)}>
              Open in Infinity Notes
            </button>
          ) : null}
          <button type="button" className="btn btn-small" aria-label={`Open ${name}`} onMouseDown={keepSelection} onClick={() => files.open(attachmentId)}>
            Open
          </button>
          <button type="button" className="btn btn-small" aria-label={`Show ${name} in folder`} onMouseDown={keepSelection} onClick={() => files.showInFolder(attachmentId)}>
            Show in folder
          </button>
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}
