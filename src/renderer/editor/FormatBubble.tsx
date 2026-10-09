import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { Bold, ChevronDown, Code, Heading, Italic, Link, List, ListOrdered, ListTodo, SquareCode } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { ImageSize } from '../../shared/editor/doc-schema';
import { IconButton } from '../ui/IconButton';
import { Menu, type MenuItem } from '../ui/Menu';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Floating } from './Floating';
import { bubbleKind, selectionBox } from './placement';
import { LinkBar } from './LinkBar';
import { selectedLinkHref } from './link';

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

function ToggleButton({ pressed, ...rest }: ComponentProps<typeof IconButton> & { pressed: boolean }) {
  return <IconButton aria-pressed={pressed} className={pressed ? 'is-on' : undefined} {...rest} />;
}

/** The Heading button: it opens Paragraph, Heading 1, 2 and 3 below itself. */
function HeadingButton({ items }: { items: MenuItem[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn bubble-menu-btn"
        aria-label="Heading"
        title="Heading (Ctrl+Alt+1, 2, 3)"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Heading size={16} strokeWidth={1.75} aria-hidden />
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      {anchor ? <Menu items={items} anchor={anchor} label="Heading" itemRole="menuitemradio" onClose={() => setAnchor(null)} /> : null}
    </>
  );
}

/** The toolbar's own enabled buttons (not the items of its open Heading menu). */
function bubbleButtons(toolbar: HTMLElement) {
  return [...toolbar.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter((b) => !b.closest('[role="menu"]'));
}

/**
 * The floating formatting toolbar of rich notes (D-102). It appears above selected text (formatting and, inside a
 * link, the link actions), above a selected image (its size presets) and while the cursor is in a link (the link
 * actions). Alt+F10 (a new `request`) shows it at the cursor too and moves the focus into it; Left and Right move
 * between its buttons and Escape returns to the text.
 */
export function FormatBubble({ editor, editable, request, link }: { editor: Editor; editable: boolean; request: object | null; link: LinkActions }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state;
      return {
        anchor: selection.anchor,
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
        link: selectedLinkHref(e.state),
        imageSize: selection instanceof NodeSelection && selection.node.type.name === 'image' ? (selection.node.attrs.size as ImageSize) : null,
      };
    },
  });
  const ref = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
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
  const visible = kind !== null && (s.focused || focusInside);

  // The focus moves into the toolbar once per request; a request the toolbar cannot show is dropped.
  const handledRequest = useRef<object | null>(null);
  useEffect(() => {
    if (!request || request === handledRequest.current) return;
    handledRequest.current = request;
    ref.current?.querySelector<HTMLElement>('button:not([disabled]), input:checked')?.focus();
  });

  if (!visible) return null;

  const run = (fn: () => boolean) => () => void fn();
  const headingItems: MenuItem[] = [
    { id: 'p', label: 'Paragraph', checked: s.heading === 0, onSelect: run(() => editor.chain().focus().setParagraph().run()) },
    ...([1, 2, 3] as const).map((level) => ({
      id: `h${level}`,
      label: `Heading ${level}`,
      checked: s.heading === level,
      onSelect: run(() => editor.chain().focus().setHeading({ level }).run()),
    })),
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
    if (step === 0 || !(e.target instanceof HTMLButtonElement) || e.target.closest('[role="menu"]')) return;
    const buttons = bubbleButtons(e.currentTarget);
    e.preventDefault();
    buttons[(buttons.indexOf(e.target) + step + buttons.length) % buttons.length]?.focus();
  };
  // Pointer presses keep the focus (and the selection) in the text, except on a field (the image size radios), which
  // takes it: the toolbar counts as focused from the press on, so the text's blur does not hide it under the pointer.
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('input')) setFocusInside(true);
    else e.preventDefault();
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocusInside(false);
    if (next !== editor.view.dom) setRequestedAt(null);
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
          <HeadingButton items={headingItems} />
          <ToggleButton label="Bold" title="Bold (Ctrl+B)" icon={Bold} pressed={s.bold} onClick={run(() => editor.chain().focus().toggleBold().run())} />
          <ToggleButton label="Italic" title="Italic (Ctrl+I)" icon={Italic} pressed={s.italic} onClick={run(() => editor.chain().focus().toggleItalic().run())} />
          <ToggleButton label="Inline code" title="Inline code (Ctrl+E)" icon={Code} pressed={s.code} onClick={run(() => editor.chain().focus().toggleCode().run())} />
          <ToggleButton label="Link" title="Link" icon={Link} pressed={s.link !== null} onClick={link.edit} />
          <span className="bubble-separator" aria-hidden />
          <ToggleButton label="Bulleted list" title="Bulleted list (Ctrl+Shift+8)" icon={List} pressed={s.bulletList} onClick={run(() => editor.chain().focus().toggleBulletList().run())} />
          <ToggleButton label="Numbered list" title="Numbered list (Ctrl+Shift+7)" icon={ListOrdered} pressed={s.orderedList} onClick={run(() => editor.chain().focus().toggleOrderedList().run())} />
          <ToggleButton label="Checklist" title="Checklist (Ctrl+Shift+9)" icon={ListTodo} pressed={s.taskList} onClick={run(() => editor.chain().focus().toggleTaskList().run())} />
          <ToggleButton label="Code block" title="Code block (Ctrl+Alt+C)" icon={SquareCode} pressed={s.codeBlock} onClick={run(() => editor.chain().focus().toggleCodeBlock().run())} />
        </>
      ) : null}
      {kind === 'image' && s.imageSize ? (
        <SegmentedControl<ImageSize> label="Image size" name="image-size" options={IMAGE_SIZE_OPTIONS} value={s.imageSize} onChange={(size) => editor.commands.setImageSize(size)} />
      ) : null}
      {kind !== 'image' && s.link ? <LinkBar href={s.link} editable={editable} onOpen={() => link.open(s.link!)} onEdit={link.edit} onRemove={link.remove} /> : null}
    </Floating>
  );
}
