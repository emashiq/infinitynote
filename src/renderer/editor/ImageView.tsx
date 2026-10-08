import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import { attachmentUrl } from '../../shared/app-identity';

/** Image node view: an "Adding image…" box while uploading, the image once stored, or "Image unavailable". */
export function ImageView({ node, selected }: ReactNodeViewProps) {
  const { attachmentId, alt, size, width, height, uploadToken } = node.attrs as {
    attachmentId: string | null;
    alt: string | null;
    size: string;
    width: number | null;
    height: number | null;
    uploadToken: string | null;
  };
  const [failedId, setFailedId] = useState<string | null>(null);
  const className = `image-node img-${size}${selected ? ' is-selected' : ''}`;
  const ratio = width && height ? { aspectRatio: `${width} / ${height}` } : undefined;

  if (uploadToken || !attachmentId) {
    return (
      <NodeViewWrapper className={className} data-drag-handle>
        <div className="image-placeholder" style={ratio} role="status">
          {ATTACHMENT_MESSAGES.addingImage}
        </div>
      </NodeViewWrapper>
    );
  }
  if (failedId === attachmentId) {
    return (
      <NodeViewWrapper className={className} data-drag-handle>
        <div className="image-placeholder is-error" style={ratio}>
          <span>{ATTACHMENT_MESSAGES.imageUnavailable}</span>
          {alt ? <span className="muted">{alt}</span> : null}
        </div>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={className} data-drag-handle>
      <img
        src={attachmentUrl(attachmentId)}
        alt={alt ?? ''}
        width={width ?? undefined}
        height={height ?? undefined}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedId(attachmentId)}
      />
    </NodeViewWrapper>
  );
}
