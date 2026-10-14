import { AI_ACTION_INFO, type AiAction } from '../../shared/ai/actions';
import { MAX_AI_API_IMAGE_BYTES, MAX_AI_API_IMAGE_MB } from '../../shared/ai/limits';
import { formatBytes } from '../../shared/attachments/names';
import type { PlacedFile, PreparedFile } from './ai-context';
import type { EngineTurn } from './engines/engine';

/** What every engine is told first (the system prompt of the APIs, the start of a command-line tool's prompt). */
export const AI_SYSTEM_PROMPT =
  'You help the user of Infinity Notes, a notes app, with a part of a note or document they selected. Work only with the material given here' +
  ' and the files in the current folder, if any; never change, create or delete files and do not run programs. Answer in the language of the' +
  ' selected text unless asked otherwise, in Markdown, as briefly as the question allows.';

/** How an attached file reaches the engine (D-190). */
export type FileDelivery =
  /** A command-line tool reads its copy in the working folder (a document's words as a .txt file). */
  | { file: PreparedFile; how: 'folder'; workName: string }
  /** An API engine gets an image or PDF as a content block. */
  | { file: PreparedFile; how: 'block' }
  /** An API engine gets the file's text inside the prompt. */
  | { file: PreparedFile; how: 'inline' }
  | { file: PreparedFile; how: 'skipped'; reason: string };

/** A name for a file in the working folder: its place (stable across a thread's turns) and its name in safe characters (it may reach a command line). */
export function workNameOf(file: PreparedFile, place: number): string {
  const dot = file.name.lastIndexOf('.');
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'file';
  const ext = file.extracted ? 'txt' : (dot > 0 ? file.name.slice(dot + 1) : '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 10);
  return `${place}-${stem}${ext ? `.${ext}` : ''}`;
}

/** Plans how each file is sent for an engine kind. */
export function deliverFiles(files: readonly PlacedFile[], engine: 'cli' | 'api'): FileDelivery[] {
  return files.map(({ file, place }): FileDelivery => {
    if (engine === 'cli') return { file, how: 'folder', workName: workNameOf(file, place) };
    if (file.kind === 'text') return { file, how: 'inline' };
    if (file.kind === 'image' && file.sizeBytes > MAX_AI_API_IMAGE_BYTES) return { file, how: 'skipped', reason: `images larger than ${MAX_AI_API_IMAGE_MB} MB are not sent` };
    return { file, how: 'block' };
  });
}

/** A block of material in the prompt; the tags keep it apart from the instructions. */
const tagged = (tag: string, text: string, attrs = ''): string => `<${tag}${attrs}>\n${text}\n</${tag}>`;
const quoteAttr = (value: string): string => value.replace(/["<>\n]/g, ' ');

export interface FirstQuestion {
  /** The item as named for the model ("the note “Plan”"). */
  item: string;
  /** Where in the item the part is ("Page 3"), or ''. */
  place: string;
  /** The selected text; '' for a place without text (then the whole document is attached). */
  selection: string;
  /** The whole note's or document's text when it was asked for. */
  whole: string | null;
  files: readonly FileDelivery[];
  action: AiAction;
  /** The question, or the words added to a preset. */
  prompt: string;
}

function fileLine(d: FileDelivery): string {
  const label = `${d.file.name} (${formatBytes(d.file.sizeBytes)})`;
  switch (d.how) {
    case 'folder':
      return `- ${label}: in the current folder as ${d.workName}${d.file.extracted ? ' (its text)' : ''}`;
    case 'block':
      return `- ${label}: attached above`;
    case 'inline':
      return `- ${label}: its text follows`;
    case 'skipped':
      return `- ${label}: not sent (${d.reason})`;
  }
}

/** The text of the first question: the part, what else was attached, and the task. */
export function firstQuestionText(q: FirstQuestion): string {
  const parts = [`The user selected a part of ${q.item}${q.place ? ` (${q.place})` : ''}.`];
  parts.push(q.selection ? tagged('selection', q.selection) : `No text is selected: the part is ${q.place || 'the item'} of the attached document.`);
  if (q.whole !== null) parts.push(tagged('whole_item', q.whole));
  if (q.files.length > 0) parts.push(['Attached files:', ...q.files.map(fileLine)].join('\n'));
  for (const d of q.files) if (d.how === 'inline' && d.file.text !== null) parts.push(tagged('file', d.file.text, ` name="${quoteAttr(d.file.name)}"`));
  const instruction = AI_ACTION_INFO[q.action].instruction;
  if (q.action === 'custom') parts.push(tagged('question', q.prompt));
  else parts.push(`Task: ${instruction}${q.prompt ? `\n${tagged('user_note', q.prompt)}` : ''}`);
  return parts.join('\n\n');
}

/**
 * A command-line tool's prompt without a session to resume (the first question, a follow-up after the engine changed
 * or an imported thread): the instructions and the whole conversation so far, ending with the new question.
 */
export function cliPrompt(turns: readonly EngineTurn[]): string {
  const [first, ...rest] = turns;
  if (!first) return AI_SYSTEM_PROMPT;
  if (rest.length === 0) return `${AI_SYSTEM_PROMPT}\n\n${first.text}`;
  const earlier = rest.slice(0, -1).map((t) => tagged(t.role === 'user' ? 'user' : 'assistant', t.text));
  const latest = rest[rest.length - 1]!;
  return [AI_SYSTEM_PROMPT, first.text, 'The conversation so far:', ...earlier, `New question:\n${tagged('question', latest.text)}`].join('\n\n');
}
