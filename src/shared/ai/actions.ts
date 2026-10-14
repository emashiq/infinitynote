import { z } from 'zod';

/** What an AI action asks about the selected part (D-190): a preset, or the user's own question. */
export const AI_ACTIONS = ['analyze', 'summarize', 'explain', 'actionItems', 'findProblems', 'custom'] as const;
export const AiActionSchema = z.enum(AI_ACTIONS);
export type AiAction = z.infer<typeof AiActionSchema>;

export const AI_ACTION_INFO: Readonly<Record<AiAction, { label: string; instruction: string }>> = {
  analyze: { label: 'Analyze', instruction: 'Analyze the selected part: what it says, what matters in it, and anything notable or questionable.' },
  summarize: { label: 'Summarize', instruction: 'Summarize the selected part briefly, keeping the key facts, numbers and dates.' },
  explain: { label: 'Explain', instruction: 'Explain the selected part in plain language, as to someone new to the subject.' },
  actionItems: { label: 'Action items', instruction: 'List the action items in the selected part as a checklist, with owners and dates where the text gives them.' },
  findProblems: { label: 'Find problems', instruction: 'Find problems in the selected part: mistakes, contradictions, unclear wording, risks and missing points.' },
  custom: { label: 'Ask', instruction: '' },
};

/** The presets offered as buttons, in order (the free question is the text field). */
export const AI_PRESETS = AI_ACTIONS.filter((a): a is Exclude<AiAction, 'custom'> => a !== 'custom');

/** What the thread shows as the question: the preset's name with any added words, or the user's own question. */
export function questionText(action: AiAction, prompt: string): string {
  if (action === 'custom') return prompt;
  const label = AI_ACTION_INFO[action].label;
  return prompt === '' ? label : `${label}: ${prompt}`;
}
