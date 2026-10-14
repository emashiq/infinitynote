import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AiEngine } from '../../shared/ai/engines';
import { MAX_AI_PROMPT_CHARS } from '../../shared/ai/limits';
import { formatBytes } from '../../shared/attachments/names';
import type { CommentDtoType, CommentThreadDtoType } from '../../shared/contracts/comments';
import type { Outcome } from '../state/store';
import type { AnswerPlacement } from './ai-request';

const fmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export const ANSWER_COPIED = 'Answer copied';
export const ANSWER_COPY_FAILED = 'The answer could not be copied.';
export const ANSWER_NOT_PLACED = 'The answer could not be put into the note: its text is gone or the note cannot be changed now.';

/** Who answered, as the thread names it. */
export const ENGINE_SPEAKER: Readonly<Record<AiEngine, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'anthropic-api': 'Claude',
  'openai-api': 'OpenAI',
};

function speaker(message: CommentDtoType): string {
  if (message.role === 'user') return 'You';
  if (message.role === 'error') return 'Not answered';
  return message.ai ? ENGINE_SPEAKER[message.ai.engine] : 'AI';
}

/** The details under a message: the model, the cost reported and the files sent. */
function details(message: CommentDtoType): string {
  const ai = message.ai;
  const parts = [fmt.format(message.createdAt)];
  if (ai && message.role === 'assistant' && ai.model) parts.push(ai.model);
  if (ai?.costUsd != null) parts.push(`$${ai.costUsd.toFixed(4)}`);
  if (ai && ai.attachments.length > 0) parts.push(`Sent: ${ai.attachments.map((a) => `${a.name} (${formatBytes(a.sizeBytes)})`).join(', ')}`);
  return parts.join(' · ');
}

/** The newest answer, which Insert below, Replace selection and Copy use. */
export function latestAnswer(thread: CommentThreadDtoType): string | null {
  return [...thread.comments].reverse().find((c) => c.role === 'assistant')?.body ?? null;
}

/**
 * An AI thread (D-190): the question, the answers and follow-ups with who wrote them, the engine at work with Stop,
 * and the thread's actions. Answers are shown as their text (never as HTML).
 */
export function AiThreadView({
  thread,
  onFollowUp,
  onStop,
  onDelete,
  onCopy,
  onPlace,
}: {
  thread: CommentThreadDtoType;
  onFollowUp: (prompt: string) => Promise<Outcome>;
  onStop: () => void;
  onDelete: () => void;
  onCopy: (text: string) => void;
  /** Puts the latest answer into the note; absent where the item cannot take it (documents, a read-only note). */
  onPlace?: (text: string, placement: AnswerPlacement) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = latestAnswer(thread);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || prompt.trim() === '' || thread.running) return;
    setBusy(true);
    const result = await onFollowUp(prompt);
    setBusy(false);
    if (result.ok) {
      setPrompt('');
      setError(null);
    } else setError(result.message);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
  };
  return (
    <div className="ai-thread-view">
      <ol className="ai-messages" aria-label="AI conversation">
        {thread.comments.map((m) => (
          <li key={m.id} className={`ai-message is-${m.role}`}>
            <span className="ai-speaker">{speaker(m)}</span>
            <p className="ai-body">{m.body}</p>
            <span className="ai-details muted">{details(m)}</span>
          </li>
        ))}
      </ol>
      {thread.running ? (
        <p role="status" className="ai-running">
          <span className="ai-spinner" aria-hidden />
          Working on it…
          <button type="button" className="btn btn-small" onClick={onStop}>
            Stop
          </button>
        </p>
      ) : null}
      <div className="comment-actions">
        {answer !== null && onPlace ? (
          <>
            <button type="button" className="btn btn-small" disabled={thread.running} onClick={() => onPlace(answer, 'below')}>
              Insert below
            </button>
            <button type="button" className="btn btn-small" disabled={thread.running} onClick={() => onPlace(answer, 'replace')}>
              Replace selection
            </button>
          </>
        ) : null}
        {answer !== null ? (
          <button type="button" className="btn btn-small" onClick={() => onCopy(answer)}>
            Copy
          </button>
        ) : null}
        <button type="button" className="btn btn-small" onClick={onDelete}>
          Delete thread
        </button>
      </div>
      <form className="comment-form" onSubmit={(e) => void submit(e)}>
        <textarea
          className="text-input comment-field"
          aria-label="Follow-up question"
          placeholder="Ask a follow-up question…"
          rows={2}
          maxLength={MAX_AI_PROMPT_CHARS}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || thread.running || prompt.trim() === ''}>
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}
