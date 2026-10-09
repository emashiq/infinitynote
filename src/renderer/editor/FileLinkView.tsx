import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Link2 } from 'lucide-react';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { formatBytes } from '../../shared/attachments/names';
import { LINK_MESSAGES, type FileLinkStatusType } from '../../shared/contracts/attachments';
import type { FileLinkOptions } from './file-link';

/** Keeps a press on a chip button from selecting the node first. */
const keepSelection = (e: MouseEvent) => e.preventDefault();

/**
 * Linked-file chip (D-108): link icon, name, "Linked" and the path as tooltip. Main checks the file when the chip
 * appears and after a failed action: a missing file reads "File not found at <path>" with Show in folder disabled; a
 * program, script or shortcut offers Show in folder only. Copy into Infinity Notes replaces the link with a copy.
 */
export function FileLinkView({ node, selected, extension, editor, getPos }: ReactNodeViewProps) {
  const { linkId, name, sizeBytes } = node.attrs as { linkId: string; name: string; sizeBytes: number };
  const links = (extension.options as FileLinkOptions).links;
  const [status, setStatus] = useState<FileLinkStatusType | null>(null);

  const refresh = useCallback(() => {
    if (!links) return;
    void links.status(linkId).then((s) => setStatus(s));
  }, [links, linkId]);
  useEffect(() => refresh(), [refresh]);

  const missing = status?.state === 'missing';
  const copyable = links !== null && editor.isEditable && status !== null && !missing && (status.sizeBytes ?? Infinity) <= links.copyLimitBytes();

  const run = (action: (id: string) => Promise<boolean>) => {
    void action(linkId).then((done) => {
      if (!done) refresh();
    });
  };

  const copyIn = async () => {
    const attachment = await links?.copyIn(linkId);
    if (!attachment) {
      refresh();
      return;
    }
    const pos = getPos();
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    if (!current || current.attrs.linkId !== linkId) return;
    const copy = editor.schema.nodes.fileAttachment!.create({ id: current.attrs.id, attachmentId: attachment.id, name: current.attrs.name, sizeBytes: attachment.sizeBytes, mime: attachment.mime });
    editor.view.dispatch(editor.state.tr.replaceWith(pos!, pos! + current.nodeSize, copy));
  };

  const detail = missing ? (status.path ? LINK_MESSAGES.notFound(status.path) : LINK_MESSAGES.unavailable) : formatBytes(status?.sizeBytes ?? sizeBytes);
  return (
    <NodeViewWrapper
      className={`file-chip file-chip-linked${missing ? ' is-missing' : ''}${selected ? ' is-selected' : ''}`}
      data-drag-handle
      title={status?.path ? `Linked: ${status.path}` : 'Linked file'}
    >
      <Link2 size={16} strokeWidth={1.75} aria-hidden />
      <span className="file-chip-name">{name}</span>
      <span className="file-chip-badge">Linked</span>
      <span className="muted file-chip-detail">{detail}</span>
      {links && status ? (
        <span className="file-chip-actions">
          {status.state === 'available' ? (
            <button type="button" className="btn btn-small" aria-label={`Open ${name}`} onMouseDown={keepSelection} onClick={() => run(links.open)}>
              Open
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-small"
            aria-label={`Show ${name} in folder`}
            disabled={missing}
            onMouseDown={keepSelection}
            onClick={() => run(links.showInFolder)}
          >
            Show in folder
          </button>
          {copyable ? (
            <button type="button" className="btn btn-small" aria-label={`Copy ${name} into Infinity Notes`} onMouseDown={keepSelection} onClick={() => void copyIn()}>
              Copy into Infinity Notes
            </button>
          ) : null}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}
