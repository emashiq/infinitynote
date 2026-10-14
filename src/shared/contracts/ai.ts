import { z } from 'zod';
import { AiActionSchema } from '../ai/actions';
import { AiCliSchema, AiEngineSchema, AiProviderSchema } from '../ai/engines';
import { AI_MESSAGES, MAX_AI_FILE_OPTIONS, MAX_AI_FILES, MAX_AI_PROMPT_CHARS, MAX_AI_SELECTION_CHARS } from '../ai/limits';
import { CommentAnchor } from '../comments/anchors';
import { CommentTarget, CommentThreadDto, MAX_COMMENT_QUOTE } from './comments';
import { Uuid } from './ids';

/** A file of the item an action can attach (D-190): one the note attached or linked, or a document it links to. */
export const AiFileRef = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('attachment'), id: Uuid }),
  z.strictObject({ type: z.literal('link'), id: Uuid }),
  z.strictObject({ type: z.literal('document'), id: Uuid }),
]);
export type AiFileRefType = z.infer<typeof AiFileRef>;

/** What an attached file is to the engines: an image, a PDF, or text (a text file, or the words of a document). */
export const AI_FILE_KINDS = ['image', 'pdf', 'text'] as const;
export const AiFileKind = z.enum(AI_FILE_KINDS);
export type AiFileKindType = z.infer<typeof AiFileKind>;

export const AiFileOption = z.strictObject({
  ref: AiFileRef,
  name: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  kind: AiFileKind,
  /** Why the file cannot be attached (too large, gone), or null. */
  problem: z.string().max(200).nullable(),
});
export type AiFileOptionType = z.infer<typeof AiFileOption>;

export const AiTargetRequest = z.strictObject({ target: CommentTarget });
export const AiContextResponse = z.strictObject({ files: z.array(AiFileOption).max(MAX_AI_FILE_OPTIONS) });

const Prompt = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(MAX_AI_PROMPT_CHARS, AI_MESSAGES.promptTooLong));

/** Files picked from disk for this action (by the index of the pick, D-108); main keeps their paths. */
export const AiPickedFiles = z.strictObject({ pickId: Uuid, indexes: z.array(z.number().int().min(0).max(MAX_AI_FILES * 2)).max(MAX_AI_FILES) });

export const AiAskRequest = z
  .strictObject({
    target: CommentTarget,
    anchor: CommentAnchor,
    /** The text the thread shows for its anchor, like a comment's. */
    quote: z.string().max(MAX_COMMENT_QUOTE),
    /** The selected text sent with the action; '' when the anchor is a place (a PDF page). */
    selection: z.string().max(MAX_AI_SELECTION_CHARS),
    action: AiActionSchema,
    /** The question (custom), or words added to a preset. */
    prompt: Prompt,
    /** Sends the whole note or document as well. */
    wholeItem: z.boolean(),
    files: z.array(AiFileRef).max(MAX_AI_FILES),
    picked: AiPickedFiles.nullable(),
  })
  .refine((r) => r.action !== 'custom' || r.prompt !== '', { message: AI_MESSAGES.promptNeeded, path: ['prompt'] });

export const AiFollowUpRequest = z.strictObject({
  threadId: Uuid,
  prompt: Prompt.pipe(z.string().min(1, AI_MESSAGES.promptNeeded)),
});
export const AiThreadIdRequest = z.strictObject({ threadId: Uuid });
export const AiThreadResponse = z.strictObject({ thread: CommentThreadDto });
export const AiStopResponse = z.strictObject({ stopped: z.boolean() });
export const AiDeletedResponse = z.strictObject({ deleted: z.literal(true) });

/** Whether an action can run now, for the Ask AI panel of any window. */
export const AiStatus = z.strictObject({
  enabled: z.boolean(),
  engine: AiEngineSchema,
  /** The first-use notice of this engine was confirmed. */
  acknowledged: z.boolean(),
  /** What must be set up first (a key), or null. */
  problem: z.string().max(300).nullable(),
});
export type AiStatusType = z.infer<typeof AiStatus>;
export const AiAcknowledgeRequest = z.strictObject({ engine: AiEngineSchema });

/** Settings → AI: which keys are stored (never the keys) and the programs chosen for the command-line tools. */
export const AiConfig = z.strictObject({
  keys: z.strictObject({ anthropic: z.boolean(), openai: z.boolean() }),
  /** The OS can keep keys encrypted (Electron safeStorage). */
  keyStorage: z.boolean(),
  cliPaths: z.strictObject({ claude: z.string().max(4096).nullable(), codex: z.string().max(4096).nullable() }),
});
export type AiConfigType = z.infer<typeof AiConfig>;

/** An API key: one token of printable characters. Null removes the stored key. */
const ApiKey = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(10, 'This does not look like an API key').max(500).regex(/^[\x21-\x7e]+$/, 'An API key has no spaces'));
export const AiSetKeyRequest = z.strictObject({ provider: AiProviderSchema, key: ApiKey.nullable() });
/** "Choose…" opens main's file dialog; "Use PATH" forgets the chosen program. */
export const AiCliPathRequest = z.strictObject({ cli: AiCliSchema, action: z.enum(['pick', 'clear']) });
export const AiTestRequest = z.strictObject({ engine: AiEngineSchema });
export const AiTestResponse = z.strictObject({ ok: z.boolean(), message: z.string().max(500) });
export type AiTestResponseType = z.infer<typeof AiTestResponse>;
