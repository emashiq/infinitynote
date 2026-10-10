import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { describeAnchor } from '../../shared/comments/anchors';
import { MAX_COMMENT_CHARS, type CommentDtoType, type CommentThreadDtoType } from '../../shared/contracts/comments';
import type { CommentFilter, CommentsStore } from '../comments/comments-store';
import type { Outcome } from '../state/store';
import { useServices, useStore } from '../state/use-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SegmentedControl } from '../ui/SegmentedControl';
import { PanelSection } from './PanelSection';

const fmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export const COMMENT_EMPTY = { open: 'No open comments. Select text and choose Comment (Ctrl+Alt+M).', resolved: 'No resolved comments' } as const;
export const TEXT_REMOVED = 'Text removed';

/** A comment field: Ctrl+Enter saves, Escape cancels; the error of the last save is shown under it. */
function CommentForm({
  label,
  submitLabel,
  initial = '',
  autoFocusKey,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  /** A new value moves the focus into the field. */
  autoFocusKey?: number;
  onSubmit: (body: string) => Promise<Outcome>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, [autoFocusKey]);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await onSubmit(body);
    setBusy(false);
    if (result.ok) setBody('');
    else setError(result.message);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <form className="comment-form" onSubmit={(e) => void submit(e)}>
      <textarea ref={field} className="text-input comment-field" aria-label={label} rows={3} maxLength={MAX_COMMENT_CHARS} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown} />
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || body.trim() === ''}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One comment with its time and, unless it is being edited, its Edit and Delete actions. */
function CommentItem({ comment, first, comments, onDelete }: { comment: CommentDtoType; first: boolean; comments: CommentsStore; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="comment">
        <CommentForm
          label="Edit comment"
          submitLabel="Save"
          initial={comment.body}
          autoFocusKey={1}
          onSubmit={async (body) => {
            const result = await comments.edit(comment.id, body);
            if (result.ok) setEditing(false);
            return result;
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="comment">
      <p className="comment-body">{comment.body}</p>
      <div className="comment-meta">
        <span className="muted">
          {fmt.format(comment.createdAt)}
          {comment.updatedAt !== comment.createdAt ? ' · edited' : ''}
        </span>
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        {first ? null : (
          <button type="button" className="link-btn" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

type PendingDelete = { kind: 'thread'; threadId: string } | { kind: 'reply'; commentId: string };

/** A thread: its anchor (the quote, or "Text removed" when the text is gone), its comments and the thread actions. */
function ThreadCard({
  thread,
  active,
  orphaned,
  comments,
  onDelete,
}: {
  thread: CommentThreadDtoType;
  active: boolean;
  orphaned: boolean;
  comments: CommentsStore;
  onDelete: (pending: PendingDelete) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const place = describeAnchor(thread.anchor);
  const report = (result: Outcome) => setError(result.ok ? null : result.message);
  return (
    <li className={`comment-thread ${active ? 'is-active' : ''} ${thread.resolvedAt !== null ? 'is-resolved' : ''}`.trim()} aria-label={`Comment on ${thread.quote || place || 'this item'}`}>
      <button type="button" className="comment-anchor-btn" aria-current={active ? 'true' : undefined} onClick={() => comments.select(thread.id)}>
        {orphaned ? <span className="comment-orphan">{TEXT_REMOVED}</span> : null}
        {place ? <span className="comment-place">{place}</span> : null}
        {thread.quote ? <q className="comment-quote">{thread.quote}</q> : null}
      </button>
      <ul className="comment-list">
        {thread.comments.map((c, i) => (
          <CommentItem key={c.id} comment={c} first={i === 0} comments={comments} onDelete={() => onDelete({ kind: 'reply', commentId: c.id })} />
        ))}
      </ul>
      {replying ? (
        <CommentForm
          label="Reply"
          submitLabel="Reply"
          autoFocusKey={1}
          onSubmit={async (body) => {
            const result = await comments.reply(thread.id, body);
            if (result.ok) setReplying(false);
            return result;
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="comment-actions">
          <button type="button" className="btn btn-small" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button type="button" className="btn btn-small" onClick={() => void comments.resolve(thread.id, thread.resolvedAt === null).then(report)}>
            {thread.resolvedAt === null ? 'Resolve' : 'Reopen'}
          </button>
          <button type="button" className="btn btn-small" onClick={() => onDelete({ kind: 'thread', threadId: thread.id })}>
            Delete thread
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The Comments section of the Details panel (D-165): the active item's threads, open or resolved, and a new comment. */
export function CommentsSection() {
  const { comments } = useServices();
  const s = useStore(comments.store);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (s.target === null) return null;
  const open = s.threads.filter((t) => t.resolvedAt === null);
  const resolved = s.threads.filter((t) => t.resolvedAt !== null);
  const shown = s.filter === 'open' ? open : resolved;
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const result = pendingDelete.kind === 'thread' ? await comments.deleteThread(pendingDelete.threadId) : await comments.deleteReply(pendingDelete.commentId);
    if (result.ok) setPendingDelete(null);
    else setDeleteError(result.message);
  };
  return (
    <PanelSection title="Comments" className="comments-section">
      <SegmentedControl<CommentFilter>
        label="Show comments"
        name="comment-filter"
        options={[
          { value: 'open', label: `Open (${open.length})` },
          { value: 'resolved', label: `Resolved (${resolved.length})` },
        ]}
        value={s.filter}
        onChange={(filter) => comments.setFilter(filter)}
      />
      {s.draft ? (
        <div className="comment-draft">
          {s.draft.quote ? <q className="comment-quote">{s.draft.quote}</q> : <span className="comment-place">{describeAnchor(s.draft.anchor)}</span>}
          <CommentForm label="New comment" submitLabel="Comment" autoFocusKey={s.draft.seq} onSubmit={(body) => comments.submitDraft(body)} onCancel={() => comments.cancelDraft()} />
        </div>
      ) : null}
      {s.status === 'loading' ? <p className="muted">Loading comments…</p> : null}
      {s.status === 'error' ? (
        <p role="alert" className="field-error">
          {s.message}
        </p>
      ) : null}
      {s.status === 'ready' && shown.length === 0 && !s.draft ? <p className="muted">{COMMENT_EMPTY[s.filter]}</p> : null}
      <ul className="comment-threads" aria-label={s.filter === 'open' ? 'Open comments' : 'Resolved comments'}>
        {shown.map((t) => (
          <ThreadCard key={t.id} thread={t} active={t.id === s.activeThreadId} orphaned={s.orphans.has(t.id)} comments={comments} onDelete={setPendingDelete} />
        ))}
      </ul>
      {pendingDelete ? (
        <ConfirmDialog
          title={pendingDelete.kind === 'thread' ? 'Delete this thread?' : 'Delete this reply?'}
          body={pendingDelete.kind === 'thread' ? 'The thread and all its replies are deleted. This cannot be undone.' : 'The reply is deleted. This cannot be undone.'}
          confirmLabel="Delete"
          confirmFirst={false}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
        />
      ) : null}
    </PanelSection>
  );
}
