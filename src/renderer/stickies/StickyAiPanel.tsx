import { ANSWER_COPIED, ANSWER_COPY_FAILED, ANSWER_NOT_PLACED, AiThreadView } from '../ai/AiThreadView';
import { AskAiDialog } from '../ai/AskAiDialog';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { useStore } from '../state/use-store';
import { copyText } from '../ui/copy-text';
import { Dialog } from '../ui/Dialog';
import type { StickyAi } from './sticky-ai';

export const STICKY_AI_TITLE = 'AI';

/** A sticky's Ask AI panel and the AI thread it shows (D-190). */
export function StickyAiPanel({ ai, bridge, notify }: { ai: StickyAi; bridge: Pick<InfinityBridge, 'ai'>; notify: (message: string, tone: 'info' | 'error') => void }) {
  const { draft, thread } = useStore(ai.store);
  if (draft) {
    return <AskAiDialog bridge={bridge} target={{ kind: 'note', id: ai.noteId }} quote={draft.quote} place="" onSubmit={(choices) => ai.submit(choices)} onCancel={() => ai.cancel()} />;
  }
  if (!thread) return null;
  return (
    <Dialog title={STICKY_AI_TITLE} className="sticky-ai-dialog" onClose={() => ai.close()}>
      {thread.quote ? <q className="comment-quote">{thread.quote}</q> : null}
      <AiThreadView
        thread={thread}
        onFollowUp={(prompt) => ai.followUp(prompt)}
        onStop={() => void ai.stop()}
        onDelete={() =>
          void ai.remove().then((result) => {
            if (!result.ok) notify(result.message, 'error');
          })
        }
        onCopy={(text) => void copyText(text).then((copied) => notify(copied ? ANSWER_COPIED : ANSWER_COPY_FAILED, copied ? 'info' : 'error'))}
        onPlace={(text, placement) => {
          if (ai.place(text, placement)) ai.close();
          else notify(ANSWER_NOT_PLACED, 'error');
        }}
      />
      <div className="button-row dialog-actions">
        <button type="button" className="btn" onClick={() => ai.close()}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
