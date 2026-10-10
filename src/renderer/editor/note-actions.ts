import type { Editor } from '@tiptap/core';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import type { MenuItem } from '../ui/Menu';
import { MERMAID } from './code/languages';

/** The note actions the editor's menus offer (D-102); an absent one is not offered where it cannot run. */
export interface NoteActions {
  insertAttachment(kind: AttachmentKindType): void;
  /** "Insert table…" (editable rich notes). */
  insertTable?: () => void;
  /** "Link to note or document…" (editable rich notes in the main window; D-098, D-157). */
  insertReference?: () => void;
  /** "Add reminder…" (main window). */
  addReminder?: () => void;
  /** "Create reminder from text" (tabs and stickies; D-091). */
  createFromText?: () => void;
  openFind(): void;
  convert(target: 'rich' | 'plain'): void;
  openVersions(): void;
  /** "Float as sticky" (tabs). */
  float?: () => void;
  /** "Lock note…", or "Lock now" and "Lock settings…" for a locked note (main window; D-111). */
  lock?: { locked: boolean; open(): void; lockNow(): void };
}

/** Flattens menu groups, drawing a separator before every group but the first. */
function grouped(...groups: MenuItem[][]): MenuItem[] {
  return groups
    .filter((g) => g.length > 0)
    .flatMap((g, i) => g.map((item, j) => (i > 0 && j === 0 ? { ...item, separatorBefore: true } : item)));
}

/**
 * The editor's context menu (right-click, Shift+F10): the table actions when the cursor is in a table, insert,
 * reminders, then the note's own actions.
 */
export function noteMenuItems(actions: NoteActions, opts: { format: 'rich' | 'plain'; editable: boolean; table?: MenuItem[] }): MenuItem[] {
  const off = !opts.editable;
  const insert: MenuItem[] =
    opts.format === 'rich'
      ? [
          { id: 'image', label: 'Insert image', disabled: off, onSelect: () => actions.insertAttachment('image') },
          { id: 'file', label: 'Attach file', disabled: off, onSelect: () => actions.insertAttachment('document') },
          ...(actions.insertTable ? [{ id: 'table', label: 'Insert table…', onSelect: actions.insertTable }] : []),
          ...(actions.insertReference ? [{ id: 'reference', label: 'Link to note or document…', onSelect: actions.insertReference }] : []),
        ]
      : [];
  const reminders: MenuItem[] = [
    ...(actions.addReminder ? [{ id: 'reminder', label: 'Add reminder…', onSelect: actions.addReminder }] : []),
    ...(actions.createFromText ? [{ id: 'fromText', label: 'Create reminder from text', onSelect: actions.createFromText }] : []),
  ];
  const note: MenuItem[] = [
    { id: 'find', label: 'Find in note', onSelect: actions.openFind },
    opts.format === 'rich'
      ? { id: 'convert', label: 'Convert to plain text…', disabled: off, onSelect: () => actions.convert('plain') }
      : { id: 'convert', label: 'Convert to rich text', disabled: off, onSelect: () => actions.convert('rich') },
    { id: 'versions', label: 'Version history…', onSelect: actions.openVersions },
    ...(actions.float ? [{ id: 'float', label: 'Float as sticky', onSelect: actions.float }] : []),
    ...lockItems(actions.lock),
  ];
  return grouped(opts.table ?? [], insert, reminders, note);
}

function lockItems(lock: NoteActions['lock']): MenuItem[] {
  if (!lock) return [];
  if (!lock.locked) return [{ id: 'lock', label: 'Lock note…', onSelect: lock.open }];
  return [
    { id: 'lockNow', label: 'Lock now', onSelect: lock.lockNow },
    { id: 'lockSettings', label: 'Lock settings…', onSelect: lock.open },
  ];
}

/** A new Mermaid block with a small flowchart to start from (D-158). */
export const DIAGRAM_STARTER = 'flowchart TD\n  A[Start] --> B{Decide}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]';

const diagramBlock = () => ({ type: 'codeBlock', attrs: { language: MERMAID }, content: [{ type: 'text', text: DIAGRAM_STARTER }] });

/** One entry of the insert menu that "/" opens in a rich note. */
export interface InsertItem {
  id: string;
  label: string;
  keywords?: string;
  run(): void;
}

/** The insert menu's entries: block types and tables, then images, files, note links and reminders. */
export function insertItems(editor: Editor, actions: NoteActions): InsertItem[] {
  const chain = () => editor.chain().focus();
  return [
    ...([1, 2, 3] as const).map((level) => ({ id: `h${level}`, label: `Heading ${level}`, keywords: `h${level} title`, run: () => void chain().setHeading({ level }).run() })),
    { id: 'bullets', label: 'Bulleted list', keywords: 'ul', run: () => void chain().toggleBulletList().run() },
    { id: 'numbers', label: 'Numbered list', keywords: 'ol', run: () => void chain().toggleOrderedList().run() },
    { id: 'checklist', label: 'Checklist', keywords: 'todo task', run: () => void chain().toggleTaskList().run() },
    { id: 'codeBlock', label: 'Code block', keywords: 'code snippet', run: () => void chain().toggleCodeBlock().run() },
    { id: 'diagram', label: 'Diagram', keywords: 'mermaid chart flowchart', run: () => void chain().insertContent(diagramBlock()).run() },
    { id: 'mathBlock', label: 'Math block', keywords: 'formula equation latex tex katex', run: () => void chain().insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run() },
    { id: 'mathInline', label: 'Inline math', keywords: 'formula equation latex tex katex', run: () => void chain().insertContent({ type: 'mathInline', attrs: { latex: '' } }).run() },
    ...(actions.insertTable ? [{ id: 'table', label: 'Table', keywords: 'grid rows columns', run: actions.insertTable }] : []),
    { id: 'image', label: 'Insert image', keywords: 'picture photo', run: () => actions.insertAttachment('image') },
    { id: 'file', label: 'Attach file', keywords: 'document', run: () => actions.insertAttachment('document') },
    ...(actions.insertReference ? [{ id: 'reference', label: 'Link to note or document…', keywords: 'reference document [[', run: actions.insertReference }] : []),
    ...(actions.addReminder ? [{ id: 'reminder', label: 'Add reminder…', run: actions.addReminder }] : []),
    ...(actions.createFromText ? [{ id: 'fromText', label: 'Create reminder from text', run: actions.createFromText }] : []),
  ];
}
