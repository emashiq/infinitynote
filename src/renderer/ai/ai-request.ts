import type { AiAction } from '../../shared/ai/actions';
import { AI_MESSAGES } from '../../shared/ai/limits';
import type { AiFileRefType } from '../../shared/contracts/ai';
import { COMMENT_MESSAGES } from '../../shared/contracts/comments';

/** What the Ask AI panel chose (D-190): the action and what is attached besides the selected part. */
export interface AiChoices {
  action: AiAction;
  prompt: string;
  wholeItem: boolean;
  files: AiFileRefType[];
  picked: { pickId: string; indexes: number[] } | null;
}

/** Where an answer goes in the note: after the block of the thread's text, or in place of that text. */
export type AnswerPlacement = 'below' | 'replace';

/** Why Ask AI cannot start, in its own words: the comment wording of an empty selection is about comments. */
export function askAiProblem(error: string): string {
  return error === COMMENT_MESSAGES.quoteNeeded ? AI_MESSAGES.selectText : error;
}
