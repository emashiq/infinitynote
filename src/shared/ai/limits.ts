import { BYTES_PER_MB } from '../attachments/limits';

/** Limits of one AI action (D-190). */
export const MAX_AI_PROMPT_CHARS = 4_000;
/** The selected text sent with an action. */
export const MAX_AI_SELECTION_CHARS = 100_000;
/** The text of a whole note or document, and the extracted text of one attached file. */
export const MAX_AI_ITEM_CHARS = 200_000;
/** A stored answer; a longer one is cut and says so. */
export const MAX_AI_MESSAGE_CHARS = 100_000;
export const MAX_AI_FILES = 10;
export const MAX_AI_FILE_MB = 20;
export const MAX_AI_FILE_BYTES = MAX_AI_FILE_MB * BYTES_PER_MB;
export const MAX_AI_TOTAL_MB = 50;
export const MAX_AI_TOTAL_BYTES = MAX_AI_TOTAL_MB * BYTES_PER_MB;
/** An image the API engines take as a content block. */
export const MAX_AI_API_IMAGE_MB = 5;
export const MAX_AI_API_IMAGE_BYTES = MAX_AI_API_IMAGE_MB * BYTES_PER_MB;
/** The note's files offered in the Ask AI panel. */
export const MAX_AI_FILE_OPTIONS = 200;

export const AI_MESSAGES = {
  off: 'AI actions are turned off. Turn them on in Settings → AI.',
  notice: 'Confirm what is sent before the first AI action.',
  locked: 'AI actions are not available for locked notes and documents.',
  plainNote: 'AI actions need a rich-text note.',
  documentKind: 'AI actions work on notes, PDF documents and web pages.',
  promptNeeded: 'Write a question first',
  promptTooLong: `A question can have at most ${MAX_AI_PROMPT_CHARS.toLocaleString('en')} characters`,
  tooManyFiles: `An action can attach at most ${MAX_AI_FILES} files`,
  fileTooLarge: `Files larger than ${MAX_AI_FILE_MB} MB cannot be attached`,
  tooMuch: `The attached files can be ${MAX_AI_TOTAL_MB} MB together at most`,
  fileMissing: 'An attached file is no longer there',
  selectText: 'Select the part to ask about',
  notAiThread: 'This is not an AI thread',
  aiThread: 'AI threads take follow-up questions instead of replies',
  running: 'Wait for the answer, or stop it first',
  stopped: 'Stopped',
  noKey: (provider: string): string => `Add your ${provider} API key in Settings → AI first.`,
  noCli: (tool: string): string => `${tool} was not found on this computer. Install it, or choose its program in Settings → AI.`,
  timedOut: (minutes: number): string => `No answer within ${minutes} minute${minutes === 1 ? '' : 's'}; the action was stopped.`,
  cut: 'The answer was cut because it is very long.',
  maxTokens: 'The answer reached the length limit and may be incomplete.',
  keyStorage: 'This computer cannot keep the key encrypted, so it is not stored.',
} as const;
