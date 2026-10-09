import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { Bold, ChevronDown, Ellipsis, Heading, History, ImagePlus, Italic, Link, List, ListOrdered, ListTodo, Search, SquareCode, Type } from 'lucide-react';
import { useRef, useState, type ComponentProps } from 'react';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import type { ImageSize } from '../../shared/editor/doc-schema';
import { IconButton } from '../ui/IconButton';
import { Menu, type MenuItem } from '../ui/Menu';
import { SegmentedControl } from '../ui/SegmentedControl';
import { LinkBar } from './LinkBar';
import { selectedLinkHref } from './link';

export interface ToolbarActions {
  editLink(): void;
  removeLink(): void;
  openLink(href: string): void;
  insertAttachment(kind: AttachmentKindType): void;
  openFind(): void;
  convert(target: 'rich' | 'plain'): void;
  openVersions(): void;
  /** More "Add reminder…" (absent where reminders cannot be added from the note, a sticky). */
  addReminder?: () => void;
  /** More "Create reminder from text" (rich and plain notes, tabs and stickies; D-091). */
  createFromText?: () => void;
  /** More "Link to note…" (rich notes in the main window; D-098). */
  insertReference?: () => void;
}

/** The reminder items of the More menu. */
function reminderItems(actions: ToolbarActions): MenuItem[] {
  const items: MenuItem[] = [];
  if (actions.addReminder) items.push({ id: 'reminder', label: 'Add reminder…', onSelect: actions.addReminder });
  if (actions.createFromText) items.push({ id: 'fromText', label: 'Create reminder from text', onSelect: actions.createFromText });
  return items.map((item, i) => (i === 0 ? { ...item, separatorBefore: true } : item));
}

const IMAGE_SIZE_OPTIONS: Array<{ value: ImageSize; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];

/** Pointer presses on toolbar buttons keep the focus (and the selection) in the editor. */
function keepEditorSelection(e: { target: EventTarget; preventDefault(): void }): void {
  if ((e.target as Element).closest?.('button')) e.preventDefault();
}

function ToggleButton({ pressed, ...rest }: ComponentProps<typeof IconButton> & { pressed: boolean }) {
  return <IconButton aria-pressed={pressed} className={pressed ? 'is-on' : undefined} {...rest} />;
}

/** A toolbar button that opens a menu below itself. */
function MenuButton({ label, title, icon, items, menuLabel, itemRole, disabled }: {
  label: string;
  title: string;
  icon: ComponentProps<typeof IconButton>['icon'];
  items: MenuItem[];
  menuLabel: string;
  itemRole?: 'menuitem' | 'menuitemradio';
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn toolbar-menu-btn"
        aria-label={label}
        title={title}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={disabled}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom + 4 });
        }}
      >
        {(() => {
          const Icon = icon;
          return <Icon size={16} strokeWidth={1.75} aria-hidden />;
        })()}
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      {anchor ? <Menu items={items} anchor={anchor} label={menuLabel} itemRole={itemRole} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}

/**
 * The formatting toolbar (plan section 9.9). Rich notes get the full set; plain-text notes only Find, Convert to
 * rich text and Version history. Read-only notes keep Find and Version history enabled.
 */
export function Toolbar({ editor, format, editable, actions }: { editor: Editor; format: 'rich' | 'plain'; editable: boolean; actions: ToolbarActions }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const sel = e.state.selection;
      return {
        heading: ([1, 2, 3] as const).find((level) => e.isActive('heading', { level })) ?? 0,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        codeBlock: e.isActive('codeBlock'),
        code: e.isActive('code'),
        link: format === 'rich' ? selectedLinkHref(e.state) : null,
        imageSize: sel instanceof NodeSelection && sel.node.type.name === 'image' ? (sel.node.attrs.size as ImageSize) : null,
      };
    },
  });
  const off = !editable;
  const run = (fn: () => boolean) => () => void fn();

  if (format === 'plain') {
    return (
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        <IconButton label="Find in note" title="Find in note (Ctrl+F)" icon={Search} onClick={actions.openFind} />
        <IconButton label="Convert to rich text" title="Convert to rich text" icon={Type} disabled={off} onClick={() => actions.convert('rich')} />
        <IconButton label="Version history" title="Version history" icon={History} onClick={actions.openVersions} />
        {actions.createFromText ? (
          <MenuButton label="More" title="More" icon={Ellipsis} items={[{ id: 'fromText', label: 'Create reminder from text', onSelect: actions.createFromText }]} menuLabel="More" />
        ) : null}
      </div>
    );
  }

  const headingItems: MenuItem[] = [
    { id: 'p', label: 'Paragraph', checked: s.heading === 0, onSelect: run(() => editor.chain().focus().setParagraph().run()) },
    ...([1, 2, 3] as const).map((level) => ({
      id: `h${level}`,
      label: `Heading ${level}`,
      checked: s.heading === level,
      onSelect: run(() => editor.chain().focus().setHeading({ level }).run()),
    })),
  ];
  const moreItems: MenuItem[] = [
    { id: 'code', label: 'Inline code', checked: s.code, disabled: off, onSelect: run(() => editor.chain().focus().toggleCode().run()) },
    { id: 'attach', label: 'Attach file', disabled: off, onSelect: () => actions.insertAttachment('document') },
    ...(actions.insertReference ? [{ id: 'reference', label: 'Link to note…', disabled: off, onSelect: actions.insertReference }] : []),
    { id: 'find', label: 'Find in note', onSelect: actions.openFind },
    { id: 'convert', label: 'Convert to plain text…', disabled: off, onSelect: () => actions.convert('plain') },
    { id: 'versions', label: 'Version history…', onSelect: actions.openVersions },
    ...reminderItems(actions),
  ];

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting" onMouseDown={keepEditorSelection}>
      <MenuButton label="Heading" title="Heading (Ctrl+Alt+1, 2, 3)" icon={Heading} items={headingItems} menuLabel="Heading" itemRole="menuitemradio" disabled={off} />
      <ToggleButton label="Bold" title="Bold (Ctrl+B)" icon={Bold} pressed={s.bold} disabled={off} onClick={run(() => editor.chain().focus().toggleBold().run())} />
      <ToggleButton label="Italic" title="Italic (Ctrl+I)" icon={Italic} pressed={s.italic} disabled={off} onClick={run(() => editor.chain().focus().toggleItalic().run())} />
      <ToggleButton label="Bulleted list" title="Bulleted list (Ctrl+Shift+8)" icon={List} pressed={s.bulletList} disabled={off} onClick={run(() => editor.chain().focus().toggleBulletList().run())} />
      <ToggleButton label="Numbered list" title="Numbered list (Ctrl+Shift+7)" icon={ListOrdered} pressed={s.orderedList} disabled={off} onClick={run(() => editor.chain().focus().toggleOrderedList().run())} />
      <ToggleButton label="Checklist" title="Checklist (Ctrl+Shift+9)" icon={ListTodo} pressed={s.taskList} disabled={off} onClick={run(() => editor.chain().focus().toggleTaskList().run())} />
      <ToggleButton label="Link" title="Link" icon={Link} pressed={s.link !== null} disabled={off} onClick={actions.editLink} />
      <ToggleButton label="Code block" title="Code block (Ctrl+Alt+C)" icon={SquareCode} pressed={s.codeBlock} disabled={off} onClick={run(() => editor.chain().focus().toggleCodeBlock().run())} />
      <IconButton label="Insert image" title="Insert image" icon={ImagePlus} disabled={off} onClick={() => actions.insertAttachment('image')} />
      <MenuButton label="More" title="More" icon={Ellipsis} items={moreItems} menuLabel="More" />
      {s.imageSize && editable ? (
        <SegmentedControl<ImageSize> label="Image size" name="image-size" options={IMAGE_SIZE_OPTIONS} value={s.imageSize} onChange={(size) => editor.commands.setImageSize(size)} />
      ) : null}
      {s.link ? <LinkBar href={s.link} editable={editable} onOpen={() => actions.openLink(s.link!)} onEdit={actions.editLink} onRemove={actions.removeLink} /> : null}
    </div>
  );
}
