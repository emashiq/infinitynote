import type { CommentAnchorType } from '../../shared/comments/anchors';
import type { CommentThreadDtoType } from '../../shared/contracts/comments';
import type { DocumentTargetType } from '../../shared/documents/targets';
import type { CommentAnchorHost } from './comments-store';

/**
 * What a document viewer contributes to comments (D-165): the anchor of a new comment at its current selection or
 * place, and optionally markers for the threads and its own way to reveal an anchor (else the document opens at the
 * anchor's place, like a link).
 */
export interface ViewerCommentAnchors {
  current(): { anchor: CommentAnchorType; quote: string } | { error: string };
  /** Draws the threads (PDF markers); `select` is what a click on a marker does. */
  show?(threads: readonly CommentThreadDtoType[], activeId: string | null, select: (threadId: string) => void): void;
  reveal?(thread: CommentThreadDtoType): boolean;
}

/** The place a document opens at for an anchor (D-132), or null for anchors without one. */
export function anchorTarget(anchor: CommentAnchorType): DocumentTargetType | null {
  switch (anchor.type) {
    case 'pdf':
      return { page: anchor.page };
    case 'cell':
      return { sheet: anchor.sheet, row: anchor.row, col: anchor.col };
    case 'slide':
      return { slide: anchor.slide };
    case 'paragraph':
      return { paragraph: anchor.paragraph };
    case 'text':
    case 'quote':
      return null;
  }
}

/**
 * The comment host of a document tab: anchors are app-side, so saving a thread changes nothing in the file and a
 * deleted thread leaves nothing behind. Revealing opens the document at the anchor's place unless the viewer shows it
 * itself.
 */
export function createDocumentCommentHost(deps: {
  documentId: string;
  anchors: ViewerCommentAnchors;
  openAt: (target: DocumentTargetType) => void;
  select: (threadId: string) => void;
}): CommentAnchorHost {
  const { anchors } = deps;
  return {
    target: { kind: 'document', id: deps.documentId },
    begin: () => anchors.current(),
    attach: () => undefined,
    cancel: () => undefined,
    detach: () => undefined,
    reveal(thread) {
      if (anchors.reveal) return anchors.reveal(thread);
      const target = anchorTarget(thread.anchor);
      if (target) deps.openAt(target);
      return target !== null;
    },
    show: (threads, activeId) => anchors.show?.(threads, activeId, deps.select),
    orphans: () => null,
    subscribe: () => () => undefined,
  };
}
