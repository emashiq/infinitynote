import { useEffect, useState, type KeyboardEvent } from 'react';
import { AI_ACTION_INFO, AI_PRESETS, type AiAction } from '../../shared/ai/actions';
import { AI_ENGINE_INFO, aiNotice } from '../../shared/ai/engines';
import { AI_MESSAGES, MAX_AI_FILES, MAX_AI_PROMPT_CHARS } from '../../shared/ai/limits';
import { formatBytes } from '../../shared/attachments/names';
import type { AiFileOptionType, AiStatusType } from '../../shared/contracts/ai';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { CommentTargetType } from '../../shared/contracts/comments';
import type { Outcome } from '../state/store';
import { Dialog } from '../ui/Dialog';
import type { AiChoices } from './ai-request';

const refKey = (ref: AiFileOptionType['ref']): string => `${ref.type}:${ref.id}`;

export const ASK_AI_TITLE = 'Ask AI';

/**
 * The Ask AI panel (D-190): the selected part, the presets and a question, and what to attach besides the part (the
 * whole note or document, the note's files, files from this computer). The first action on an engine shows what is
 * sent where; running it confirms that once. Nothing is sent until an action is chosen.
 */
export function AskAiDialog({
  bridge,
  target,
  quote,
  place,
  onSubmit,
  onCancel,
  onOpenSettings,
}: {
  bridge: Pick<InfinityBridge, 'ai'>;
  target: CommentTargetType;
  /** The selected text as the thread shows it, or '' for a place. */
  quote: string;
  /** Where the part is ("Page 3"), or ''. */
  place: string;
  onSubmit: (choices: AiChoices) => Promise<Outcome>;
  onCancel: () => void;
  /** Opens Settings → AI (main window). */
  onOpenSettings?: () => void;
}) {
  const [status, setStatus] = useState<AiStatusType | null>(null);
  const [options, setOptions] = useState<AiFileOptionType[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [wholeItem, setWholeItem] = useState(false);
  const [picked, setPicked] = useState<{ pickId: string; files: Array<{ name: string; sizeBytes: number; index: number }> } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([bridge.ai.status(), target.kind === 'note' ? bridge.ai.context({ target }) : null]).then(([s, c]) => {
      if (!live) return;
      if (s.ok) setStatus(s.data);
      else setError(s.error.message);
      if (c?.ok) setOptions(c.data.files);
    });
    return () => {
      live = false;
    };
  }, [bridge, target]);

  const fileCount = chosen.size + (picked?.files.length ?? 0);
  const toggle = (key: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const pickFiles = async () => {
    const res = await bridge.ai.pickFiles();
    if (!res.ok) return setError(res.error.message);
    if (res.data.rejected.length > 0) setError(res.data.rejected[0]!.message);
    if (res.data.pickId === null || res.data.files.length === 0) return;
    setPicked({ pickId: res.data.pickId, files: res.data.files.map((f, index) => ({ ...f, index })) });
  };
  const removePicked = (index: number) =>
    setPicked((p) => {
      const files = p?.files.filter((f) => f.index !== index) ?? [];
      return p && files.length > 0 ? { ...p, files } : null;
    });

  const run = async (action: AiAction) => {
    if (busy || !status) return;
    if (action === 'custom' && prompt.trim() === '') return setError(AI_MESSAGES.promptNeeded);
    if (fileCount > MAX_AI_FILES) return setError(AI_MESSAGES.tooManyFiles);
    setBusy(true);
    setError(null);
    if (!status.acknowledged) {
      const ack = await bridge.ai.acknowledge({ engine: status.engine });
      if (!ack.ok) {
        setBusy(false);
        return setError(ack.error.message);
      }
      setStatus(ack.data);
    }
    const result = await onSubmit({
      action,
      prompt: prompt.trim(),
      wholeItem,
      files: options.filter((o) => chosen.has(refKey(o.ref))).map((o) => o.ref),
      picked: picked ? { pickId: picked.pickId, indexes: picked.files.map((f) => f.index) } : null,
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run('custom');
    }
  };

  const blocked = status !== null && (!status.enabled || status.problem !== null);
  return (
    <Dialog title={ASK_AI_TITLE} className="ask-ai-dialog" onClose={onCancel}>
      <div className="ask-ai-part">
        {place ? <span className="comment-place">{place}</span> : null}
        {quote ? <q className="comment-quote">{quote}</q> : null}
      </div>
      {status === null && error === null ? <p className="muted">Loading…</p> : null}
      {status && !status.enabled ? <p className="ai-notice">{AI_MESSAGES.off}</p> : null}
      {status?.enabled ? (
        <>
          <p className="muted">Runs on {AI_ENGINE_INFO[status.engine].label}.</p>
          {!status.acknowledged ? (
            <p role="note" className="ai-notice">
              {aiNotice(status.engine)}
            </p>
          ) : null}
          {status.problem ? (
            <p role="alert" className="field-error">
              {status.problem}
            </p>
          ) : null}
        </>
      ) : null}
      {status?.enabled && !blocked ? (
        <>
          <div className="ai-presets" role="group" aria-label="Actions">
            {AI_PRESETS.map((action) => (
              <button key={action} type="button" className="btn btn-small" disabled={busy} onClick={() => void run(action)}>
                {AI_ACTION_INFO[action].label}
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="ask-ai-prompt">
            Question, or words to add to an action
          </label>
          <textarea
            id="ask-ai-prompt"
            data-autofocus
            className="text-input comment-field"
            rows={3}
            maxLength={MAX_AI_PROMPT_CHARS}
            placeholder="Ask about the selected part…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <fieldset className="ai-attach">
            <legend>Attach</legend>
            <label className="checkbox">
              <input type="checkbox" checked={wholeItem} onChange={(e) => setWholeItem(e.target.checked)} />
              {target.kind === 'note' ? 'The whole note' : 'The whole document'}
            </label>
            {options.map((o) => (
              <label key={refKey(o.ref)} className="checkbox" title={o.problem ?? undefined}>
                <input type="checkbox" disabled={o.problem !== null} checked={chosen.has(refKey(o.ref))} onChange={() => toggle(refKey(o.ref))} />
                {o.name} <span className="muted">({o.problem ?? formatBytes(o.sizeBytes)})</span>
              </label>
            ))}
            {picked?.files.map((f) => (
              <div key={f.index} className="checkbox">
                <span>
                  {f.name} <span className="muted">({formatBytes(f.sizeBytes)})</span>
                </span>
                <button type="button" className="link-btn" aria-label={`Remove ${f.name}`} onClick={() => removePicked(f.index)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void pickFiles()}>
              Add files from this computer…
            </button>
          </fieldset>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className="button-row dialog-actions">
        {blocked && onOpenSettings ? (
          <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        ) : null}
        {status?.enabled && !blocked ? (
          <button type="button" className="btn btn-primary" disabled={busy || prompt.trim() === ''} onClick={() => void run('custom')}>
            {busy ? 'Sending…' : 'Ask'}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
