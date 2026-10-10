import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { isInTable } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { ALargeSmall, Baseline, Bold, Code, Heading, Highlighter, Italic, Link, List, ListOrdered, ListTodo, MessageSquarePlus, SquareCode, Table, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { ImageSize } from '../../shared/editor/doc-schema';
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, TEXT_COLORS, type ColorSwatch } from '../../shared/editor/formatting';
import { IconButton } from '../ui/IconButton';
import type { MenuItem } from '../ui/Menu';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ColorButton, MenuButton } from './bubble-controls';
import { Floating } from './Floating';
import { bubbleKind, selectionBox } from './placement';
import { LinkBar } from './LinkBar';
import { selectedLinkHref } from './link';
import { tableHasHeaderRow, tableMenuItems } from './table-actions';

export interface LinkActions {
  edit(): void;
  remove(): void;
  open(href: string): void;
}

const IMAGE_SIZE_OPTIONS: Array<{ value: ImageSize; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];

const swatches = (colors: readonly ColorSwatch[]) => colors.map((c) => ({ value: c.value, label: c.label, color: c.value }));
const TEXT_SWATCHES = swatches(TEXT_COLORS);
const HIGHLIGHT_SWATCHES = swatches(HIGHLIGHT_COLORS);

function ToggleButton({ pressed, ...rest }: ComponentProps<typeof IconButton> & { pressed: boolean }) {
  return <IconButton aria-pressed={pressed} className={pressed ? 'is-on' : undefined} {...rest} />;
}

/** The toolbar's own enabled buttons (not the items of its open menus and popovers). */
function bubbleButtons(toolbar: HTMLElement) {
  return [...toolbar.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter((b) => !b.closest('[role="menu"], [role="dialog"]'));
}

/**
 * The floating formatting toolbar of rich notes (D-102). It appears above selected text (formatting, font, size and
 * colors, the table actions inside a table and, inside a link, the link actions), above a selected image (its size
 * presets) and while the cursor is in a link (the link actions). Alt+F10 (a new `request`) shows it at the cursor too
 * and moves the focus into it; Left and Right move between its buttons and Escape returns to the text.
 */
export function FormatBubble({
  editor,
  editable,
  request,
  link,
  onComment,
}: {
  editor: Editor;
  editable: boolean;
  request: object | null;
  link: LinkActions;
  /** Comments on the selection (D-165), where the window offers comments. */
  onComment?: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state;
      const style = e.getAttributes('textStyle') as { fontFamily?: string | null; fontSize?: string | null; color?: string | null; backgroundColor?: string | null };
      const inTable = isInTable(e.state);
      return {
        anchor: selection.anchor,
        empty: selection.empty,
        head: selection.head,
        focused: e.isFocused,
        kind: bubbleKind(e.state, { editable, requested: false }),
        requestedKind: bubbleKind(e.state, { editable, requested: true }),
        heading: ([1, 2, 3] as const).find((level) => e.isActive('heading', { level })) ?? 0,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        code: e.isActive('code'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        codeBlock: e.isActive('codeBlock'),
        fontFamily: style.fontFamily ?? null,
        fontSize: style.fontSize ?? null,
        color: style.color ?? null,
        backgroundColor: style.backgroundColor ?? null,
        inTable,
        headerRow: inTable && tableHasHeaderRow(e.state),
        link: selectedLinkHref(e.state),
        imageSize: selection instanceof NodeSelection && selection.node.type.name === 'image' ? (selection.node.attrs.size as ImageSize) : null,
      };
    },
  });
  const ref = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
  // An open color popover keeps the toolbar up, also while the system color dialog it opened has the focus.
  const [popoverOpen, setPopoverOpen] = useState(false);
  // A request shows the toolbar where the cursor was when it was made, until the selection moves.
  const [requestedAt, setRequestedAt] = useState<{ anchor: number; head: number } | null>(null);
  const [shownRequest, setShownRequest] = useState<object | null>(null);
  if (request !== shownRequest) {
    setShownRequest(request);
    if (request) setRequestedAt({ anchor: editor.state.selection.anchor, head: editor.state.selection.head });
  }
  const requested = requestedAt !== null && requestedAt.anchor === s.anchor && requestedAt.head === s.head;
  const kind = requested ? s.requestedKind : s.kind;
  if (kind === null && focusInside) setFocusInside(false);
  const visible = kind !== null && (s.focused || focusInside || popoverOpen);

  // The focus moves into the toolbar once per request; a request the toolbar cannot show is dropped.
  const handledRequest = useRef<object | null>(null);
  useEffect(() => {
    if (!request || request === handledRequest.current) return;
    handledRequest.current = request;
    ref.current?.querySelector<HTMLElement>('button:not([disabled]), input:checked')?.focus();
  });

  if (!visible) return null;

  const run = (fn: () => boolean) => () => void fn();
  const chain = () => editor.chain().focus();
  const headingItems: MenuItem[] = [
    { id: 'p', label: 'Paragraph', checked: s.heading === 0, onSelect: run(() => chain().setParagraph().run()) },
    ...([1, 2, 3] as const).map((level) => ({
      id: `h${level}`,
      label: `Heading ${level}`,
      checked: s.heading === level,
      onSelect: run(() => chain().setHeading({ level }).run()),
    })),
  ];
  const fontItems: MenuItem[] = [
    { id: 'default', label: 'Default', checked: s.fontFamily === null, onSelect: run(() => chain().unsetFontFamily().run()) },
    ...FONT_FAMILIES.map((f) => ({ id: f.key, label: f.label, checked: s.fontFamily === f.key, onSelect: run(() => chain().setFontFamily(f.key).run()) })),
  ];
  const sizeItems: MenuItem[] = [
    { id: 'default', label: 'Default', checked: s.fontSize === null, onSelect: run(() => chain().unsetFontSize().run()) },
    ...FONT_SIZES.map((size) => ({ id: size, label: size.replace('px', ''), checked: s.fontSize === size, onSelect: run(() => chain().setFontSize(size).run()) })),
  ];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setRequestedAt(null);
      editor.view.focus();
      return;
    }
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || !(e.target instanceof HTMLButtonElement) || e.target.closest('[role="menu"], [role="dialog"]')) return;
    const buttons = bubbleButtons(e.currentTarget);
    e.preventDefault();
    buttons[(buttons.indexOf(e.target) + step + buttons.length) % buttons.length]?.focus();
  };
  // Pointer presses keep the focus (and the selection) in the text, except on a field (the image size radios, the
  // custom color fields), which takes it: the toolbar counts as focused from the press on, so the text's blur does not
  // hide it under the pointer.
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('input')) setFocusInside(true);
    else e.preventDefault();
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocusInside(false);
    if (next !== editor.view.dom && !popoverOpen) setRequestedAt(null);
  };

  return (
    <Floating
      elementRef={ref}
      anchor={() => selectionBox(editor.view)}
      side="above"
      align="center"
      className="format-bubble"
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onFocus={() => setFocusInside(true)}
      onBlur={onBlur}
    >
      {kind === 'format' ? (
        <>
          <MenuButton label="Heading" title="Heading (Ctrl+Alt+1, 2, 3)" icon={Heading} items={headingItems} itemRole="menuitemradio" />
          <ToggleButton label="Bold" title="Bold (Ctrl+B)" icon={Bold} pressed={s.bold} onClick={run(() => chain().toggleBold().run())} />
          <ToggleButton label="Italic" title="Italic (Ctrl+I)" icon={Italic} pressed={s.italic} onClick={run(() => chain().toggleItalic().run())} />
          <ToggleButton label="Inline code" title="Inline code (Ctrl+E)" icon={Code} pressed={s.code} onClick={run(() => chain().toggleCode().run())} />
          <ToggleButton label="Link" title="Link" icon={Link} pressed={s.link !== null} onClick={link.edit} />
          <span className="bubble-separator" aria-hidden />
          <MenuButton label="Font" icon={Type} items={fontItems} itemRole="menuitemradio" />
          <MenuButton label="Font size" icon={ALargeSmall} items={sizeItems} itemRole="menuitemradio" />
          <ColorButton
            label="Text color"
            icon={Baseline}
            swatches={TEXT_SWATCHES}
            current={s.color}
            reset="Default"
            onOpenChange={setPopoverOpen}
            onSelect={(color) => void (color ? chain().setColor(color) : chain().unsetColor()).run()}
          />
          <ColorButton
            label="Highlight"
            icon={Highlighter}
            swatches={HIGHLIGHT_SWATCHES}
            current={s.backgroundColor}
            reset="None"
            onOpenChange={setPopoverOpen}
            onSelect={(color) => void (color ? chain().setBackgroundColor(color) : chain().unsetBackgroundColor()).run()}
          />
          <span className="bubble-separator" aria-hidden />
          <ToggleButton label="Bulleted list" title="Bulleted list (Ctrl+Shift+8)" icon={List} pressed={s.bulletList} onClick={run(() => chain().toggleBulletList().run())} />
          <ToggleButton label="Numbered list" title="Numbered list (Ctrl+Shift+7)" icon={ListOrdered} pressed={s.orderedList} onClick={run(() => chain().toggleOrderedList().run())} />
          <ToggleButton label="Checklist" title="Checklist (Ctrl+Shift+9)" icon={ListTodo} pressed={s.taskList} onClick={run(() => chain().toggleTaskList().run())} />
          <ToggleButton label="Code block" title="Code block (Ctrl+Alt+C)" icon={SquareCode} pressed={s.codeBlock} onClick={run(() => chain().toggleCodeBlock().run())} />
          {s.inTable ? <MenuButton label="Table" icon={Table} items={tableMenuItems(editor, s.headerRow)} /> : null}
          {onComment && !s.empty ? (
            <>
              <span className="bubble-separator" aria-hidden />
              <IconButton label="Comment" title="Comment (Ctrl+Alt+M)" icon={MessageSquarePlus} onClick={onComment} />
            </>
          ) : null}
        </>
      ) : null}
      {kind === 'image' && s.imageSize ? (
        <SegmentedControl<ImageSize> label="Image size" name="image-size" options={IMAGE_SIZE_OPTIONS} value={s.imageSize} onChange={(size) => editor.commands.setImageSize(size)} />
      ) : null}
      {kind !== 'image' && s.link ? <LinkBar href={s.link} editable={editable} onOpen={() => link.open(s.link!)} onEdit={link.edit} onRemove={link.remove} /> : null}
    </Floating>
  );
}
