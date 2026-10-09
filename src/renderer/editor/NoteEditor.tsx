import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import { docToText, textToDoc } from '../../shared/text/textarea-doc';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import { isUserEdit, toSavable, type ContentSource, type EditorHost } from './content';
import { registerEditor } from './editor-registry';
import { plainExtensions, richExtensions } from './extensions';
import { FindBar } from './FindBar';
import { findPrefill } from './find-core';
import { applyLink, LINK_OPEN_FAILED, linkHrefAt, removeLink, selectedLinkHref } from './link';
import { LinkDialog } from './LinkDialog';
import { createPasteProps } from './paste';
import { blockIdAtSelection, chipsMeta, findBlock, REMINDER_CHIP_EVENT, selectionAtBlockStart, type ChipInfo } from './reminder-chips';
import { Toolbar } from './Toolbar';
import type { EditorServices } from './editor-services';
import { attachmentNode, AttachmentUploader, insertBlocks } from './uploader';

/** How long a block a reminder opened stays highlighted. */
export const REVEAL_MS = 2000;

export interface NoteEditorProps {
  host: EditorHost;
  format: 'rich' | 'plain';
  content: RichDocLike | string;
  editable: boolean;
  variant: 'tab' | 'sticky';
  scrollTop: number;
  onScroll: (px: number) => void;
  services: EditorServices;
  /** A new request object opens the find bar (Ctrl+F); the editor then calls onFindRequestHandled. */
  findRequest: object | null;
  onFindRequestHandled: () => void;
  onConvert: (target: 'rich' | 'plain') => void;
  onOpenVersions: () => void;
  /** Receives the editor instance (for example to move focus into it from the title). */
  editorRef?: MutableRefObject<Editor | null>;
  /** Reminder chips of a rich note (D-080); a click calls onChipClick. */
  chips?: readonly ChipInfo[];
  onChipClick?: (reminderId: string) => void;
  /** A block to select, scroll to and highlight (a reminder opened the note); onRevealDone says whether it was found. */
  reveal?: { blockId: string; nonce: number } | null;
  onRevealDone?: (found: boolean) => void;
  /** Toolbar More "Add reminder…" (main window only). */
  onAddReminder?: () => void;
}

/**
 * The one editor for every note (INF-EDIT-01, D-053). It mounts only for the active note tab, saves lazily
 * through the controller (edits mark the note dirty; the controller reads the content when it saves) and owns the
 * paste, upload, link and find behavior. Mount it with a key of the format and content key: content replaced from
 * outside (reload, conversion, restore) creates a fresh editor with a clean undo history.
 */
export function NoteEditor(props: NoteEditorProps) {
  const { host, format, content, editable, services } = props;
  const [uploader] = useState(
    () => new AttachmentUploader({ importBytes: (req) => services.bridge.attachment.importBytes(req), limits: services.limits, notify: services.notify }),
  );

  const openLink = (href: string) => {
    void services.bridge.shell.openExternal({ url: href }).then((r) => {
      if (!r.ok) services.notify(LINK_OPEN_FAILED);
    });
  };

  const editor = useEditor(
    {
      extensions: format === 'rich' ? richExtensions({ uploader, notify: services.notify }) : plainExtensions(),
      content: (format === 'rich' ? content : textToDoc(content as string)) as JSONContent,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      enableContentCheck: true,
      onContentError: () => host.contentError(),
      editorProps: {
        attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note text', spellcheck: 'false', class: 'note-editor-content' },
        ...createPasteProps({ format, uploader, notify: services.notify, flushPending: () => host.flush() }),
        // Links open only with Ctrl+Click (or Open link); a plain click places the cursor (INF-SEC-01).
        handleClick: (view, pos, event) => {
          if (!(event.ctrlKey || event.metaKey)) return false;
          const href = linkHrefAt(view.state, pos);
          if (!href) return false;
          openLink(href);
          return true;
        },
      },
      onUpdate: ({ transaction }) => {
        if (isUserEdit(transaction)) host.markDirty();
      },
      onBlur: () => void host.flush(),
      onSelectionUpdate: ({ editor: e }) => host.setCursorBlock(blockIdAtSelection(e.state.selection)),
    },
    [],
  );

  // Content source for the controller, the live-editor count and the uploader binding follow the instance.
  const { editorRef } = props;
  useEffect(() => {
    if (!editor) return undefined;
    uploader.bind(editor);
    const source: ContentSource = {
      getContent: () => (format === 'rich' ? toSavable(editor.getJSON()) : docToText(editor.getJSON())),
      getPlainText: () => editor.getText({ blockSeparator: '\n' }),
      blockText: (blockId) => findBlock(editor.state.doc, blockId)?.node.textContent ?? null,
      hasPendingUploads: () => uploader.pending() > 0,
      waitForUploads: (ms) => uploader.waitIdle(ms),
    };
    host.attachSource(source);
    const unregister = registerEditor(editor);
    if (editorRef) editorRef.current = editor;
    return () => {
      if (editorRef?.current === editor) editorRef.current = null;
      host.detachSource(source);
      unregister();
      uploader.dispose();
    };
  }, [editor, host, uploader, format, editorRef]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
    editor.view.dom.setAttribute('aria-readonly', String(!editable));
  }, [editor, editable]);

  // Reminder chips are decorations set by a meta-only transaction: no save, no undo step (D-080). Only a real change is
  // dispatched, so a reminder list that loads while the user types never interrupts the typing.
  const { chips } = props;
  const shownChips = useRef('[]');
  useEffect(() => {
    if (!editor || editor.isDestroyed || format !== 'rich') return;
    const key = JSON.stringify(chips ?? []);
    if (key === shownChips.current) return;
    shownChips.current = key;
    editor.view.dispatch(chipsMeta(editor.state, { chips: chips ?? [] }));
  }, [editor, format, chips]);

  const { onChipClick } = props;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !onChipClick) return undefined;
    const dom = editor.view.dom;
    const onChip = (e: Event) => onChipClick((e as CustomEvent<string>).detail);
    dom.addEventListener(REMINDER_CHIP_EVENT, onChip);
    return () => dom.removeEventListener(REMINDER_CHIP_EVENT, onChip);
  }, [editor, onChipClick]);

  // A reminder opened this note at a block: select its start, scroll to it and highlight it for 2 s.
  const { reveal, onRevealDone } = props;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !reveal) return;
    const target = findBlock(editor.state.doc, reveal.blockId);
    if (target) {
      editor.view.dispatch(chipsMeta(editor.state, { reveal: reveal.blockId }).setSelection(selectionAtBlockStart(editor.state.doc, target)).scrollIntoView());
      editor.commands.focus();
      setTimeout(() => {
        if (!editor.isDestroyed) editor.view.dispatch(chipsMeta(editor.state, { reveal: null }));
      }, REVEAL_MS);
    }
    onRevealDone?.(target !== null);
    // Runs once per request (the nonce); the callback identity does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, reveal?.nonce]);

  // Scroll position: restored once per editor instance, reported as the user scrolls.
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(props.scrollTop);
  useLayoutEffect(() => {
    if (scrollRef.current && initialScroll.current > 0) scrollRef.current.scrollTop = initialScroll.current;
  }, [editor]);

  const [find, setFind] = useState<{ prefill: string; nonce: number } | null>(null);
  const openFind = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setFind((f) => ({ prefill: findPrefill(editor.state.doc.textBetween(from, to, '\n')), nonce: (f?.nonce ?? 0) + 1 }));
  };
  const lastFindRequest = useRef<object | null>(null);
  useEffect(() => {
    if (props.findRequest && props.findRequest !== lastFindRequest.current) {
      lastFindRequest.current = props.findRequest;
      props.onFindRequestHandled();
      openFind();
    }
  });

  const [linkDialog, setLinkDialog] = useState<{ href: string; editing: boolean } | null>(null);

  const insertAttachment = async (kind: AttachmentKindType) => {
    if (!editor) return;
    const res = await services.bridge.attachment.importFromDialog({ kind });
    if (!res.ok) {
      services.notify(kind === 'image' ? ATTACHMENT_MESSAGES.imageFailed : ATTACHMENT_MESSAGES.fileFailed);
      return;
    }
    for (const message of new Set(res.data.rejected.map((r) => r.message))) services.notify(message);
    if (res.data.imported.length === 0 || editor.isDestroyed) return;
    const { from, to } = editor.state.selection;
    insertBlocks(editor, { from, to }, res.data.imported.map((dto) => attachmentNode(dto, dto.originalName)));
    editor.commands.focus();
  };

  if (!editor) return null;
  return (
    <div className={`note-editor note-editor-${props.variant}`}>
      <Toolbar
        editor={editor}
        format={format}
        editable={editable}
        actions={{
          editLink: () => {
            const href = selectedLinkHref(editor.state);
            setLinkDialog({ href: href ?? '', editing: href !== null });
          },
          removeLink: () => removeLink(editor),
          openLink,
          insertAttachment: (kind) => void insertAttachment(kind),
          openFind,
          convert: props.onConvert,
          openVersions: props.onOpenVersions,
          addReminder: props.onAddReminder,
        }}
      />
      {find ? <FindBar key={find.nonce} editor={editor} prefill={find.prefill} onClose={() => setFind(null)} /> : null}
      <div ref={scrollRef} className="note-editor-scroll" onScroll={(e) => props.onScroll(Math.round(e.currentTarget.scrollTop))}>
        <EditorContent editor={editor} />
      </div>
      {linkDialog ? (
        <LinkDialog
          initial={linkDialog.href}
          editing={linkDialog.editing}
          onClose={() => {
            setLinkDialog(null);
            editor.commands.focus();
          }}
          onSave={(href) => {
            setLinkDialog(null);
            applyLink(editor, href);
          }}
          onRemove={() => {
            setLinkDialog(null);
            removeLink(editor);
          }}
        />
      ) : null}
    </div>
  );
}
