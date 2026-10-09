import type { Editor } from '@tiptap/core';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import type { MenuItem } from '../ui/Menu';

/** The note actions the editor's menus offer (D-102); an absent one is not offered where it cannot run. */
export interface NoteActions {
  insertAttachment(kind: AttachmentKindType): void;
  /** "Link to note…" (editable rich notes in the main window; D-098). */
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
}

/** Flattens menu groups, drawing a separator before every group but the first. */
function grouped(...groups: MenuItem[][]): MenuItem[] {
  return groups
    .filter((g) => g.length > 0)
    .flatMap((g, i) => g.map((item, j) => (i > 0 && j === 0 ? { ...item, separatorBefore: true } : item)));
}

/** The editor's context menu (right-click, Shift+F10): insert, reminders, then the note's own actions. */
export function noteMenuItems(actions: NoteActions, opts: { format: 'rich' | 'plain'; editable: boolean }): MenuItem[] {
  const off = !opts.editable;
  const insert: MenuItem[] =
    opts.format === 'rich'
      ? [
          { id: 'image', label: 'Insert image', disabled: off, onSelect: () => actions.insertAttachment('image') },
          { id: 'file', label: 'Attach file', disabled: off, onSelect: () => actions.insertAttachment('document') },
          ...(actions.insertReference ? [{ id: 'reference', label: 'Link to note…', onSelect: actions.insertReference }] : []),
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
  ];
  return grouped(insert, reminders, note);
}

/** One entry of the insert menu that "/" opens in a rich note. */
export interface InsertItem {
  id: string;
  label: string;
  keywords?: string;
  run(): void;
}

/** The insert menu's entries: block types, then images, files, note links and reminders. */
export function insertItems(editor: Editor, actions: NoteActions): InsertItem[] {
  const chain = () => editor.chain().focus();
  return [
    ...([1, 2, 3] as const).map((level) => ({ id: `h${level}`, label: `Heading ${level}`, keywords: `h${level} title`, run: () => void chain().setHeading({ level }).run() })),
    { id: 'bullets', label: 'Bulleted list', keywords: 'ul', run: () => void chain().toggleBulletList().run() },
    { id: 'numbers', label: 'Numbered list', keywords: 'ol', run: () => void chain().toggleOrderedList().run() },
    { id: 'checklist', label: 'Checklist', keywords: 'todo task', run: () => void chain().toggleTaskList().run() },
    { id: 'codeBlock', label: 'Code block', run: () => void chain().toggleCodeBlock().run() },
    { id: 'image', label: 'Insert image', keywords: 'picture photo', run: () => actions.insertAttachment('image') },
    { id: 'file', label: 'Attach file', keywords: 'document', run: () => actions.insertAttachment('document') },
    ...(actions.insertReference ? [{ id: 'reference', label: 'Link to note…', keywords: 'reference', run: actions.insertReference }] : []),
    ...(actions.addReminder ? [{ id: 'reminder', label: 'Add reminder…', run: actions.addReminder }] : []),
    ...(actions.createFromText ? [{ id: 'fromText', label: 'Create reminder from text', run: actions.createFromText }] : []),
  ];
}
