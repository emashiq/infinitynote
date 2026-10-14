import { z } from 'zod';
import { AiActionSchema } from '../../shared/ai/actions';
import { AiEngineSchema } from '../../shared/ai/engines';
import { MAX_AI_FILES, MAX_AI_PROMPT_CHARS } from '../../shared/ai/limits';
import { AiFileRef } from '../../shared/contracts/ai';
import { AiAttachmentInfo, type AiMessageInfoType } from '../../shared/contracts/comments';
import { isSessionId } from './engines/engine';

/**
 * What an AI message keeps in `comments.meta` (D-190). The engine, model, files (names and sizes) and cost are shown
 * in the thread; the session is how a command-line tool resumes the conversation; the first question also keeps what
 * it was asked with, so a follow-up can send the same context again (the files by their place in the app, never their
 * bytes, and never a path picked from disk). A session that is not a session ID (a restored or edited database) is read
 * as none, so it never reaches a command line and the conversation is sent again instead (D-195).
 */
export const StoredAiMeta = z.object({
  engine: AiEngineSchema,
  model: z.string().max(100).nullable(),
  sessionId: z.string().refine(isSessionId).nullable().catch(null),
  costUsd: z.number().min(0).nullable(),
  attachments: z.array(AiAttachmentInfo).max(MAX_AI_FILES + 2),
  context: z
    .object({
      action: AiActionSchema,
      prompt: z.string().max(MAX_AI_PROMPT_CHARS),
      wholeItem: z.boolean(),
      files: z.array(AiFileRef).max(MAX_AI_FILES),
    })
    .optional(),
});
export type StoredAiMetaType = z.infer<typeof StoredAiMeta>;

/** The stored meta of a message, or null when it has none or it no longer parses. */
export function parseAiMeta(json: string | null): StoredAiMetaType | null {
  if (json === null) return null;
  try {
    const parsed = StoredAiMeta.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What the thread shows of a message's meta. */
export function aiMessageInfo(meta: StoredAiMetaType): AiMessageInfoType {
  return { engine: meta.engine, model: meta.model, attachments: meta.attachments, costUsd: meta.costUsd };
}
