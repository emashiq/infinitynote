import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import { docToText, textToDoc } from '../../shared/text/textarea-doc';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import { isUserEdit, toSavable, type ContentSource, type EditorHost } from './content';
import type { EditorHandle } from './editor-handle';
import { registerEditor } from './editor-registry';
import { plainExtensions, richExtensions } from './extensions';
import type { FileActions } from './file-attachment';
import { FindBar } from './FindBar';
import { findPrefill } from './find-core';
import { applyLink, LINK_OPEN_FAILED, linkHrefAt, removeLink, selectedLinkHref } from './link';
import { LinkDialog } from './LinkDialog';
import { ReferencePicker, type PickedReference } from './ReferencePicker';
import { createPasteProps } from './paste';
import type { CardRequest } from '../reminders/card-request';
import { blockIdAtSelection, chipsMeta, findBlock, REMINDER_CHIP_EVENT, selectionAtBlockStart, type ChipInfo } from './reminder-chips';
import { useStore } from '../state/use-store';
import { DISMISS_FAILED } from '../reminders/suggestion-context';
import { SuggestionBar } from './SuggestionBar';
import { SuggestionDetector } from './suggestion-detector';
import { requestForLive, requestFromText } from './suggestion-requests';
import { textOfBlock } from './block-text';
import { candidateAt, type LiveCandidate } from './suggestions';
import { Toolbar } from './Toolbar';
import type { EditorServices } from './editor-services';
import { attachmentNode, AttachmentUploader, insertBlocks } from './uploader';

/** How long a block a reminder opened stays highlighted. */
export const REVEAL_MS = 2000;

/** Reminder suggestions in one note (D-091, D-093): where the card opens and what the note's reminders are. */
export interface SuggestionHost {
  noteId: string;
  noteTitle: string;
  /** The note's live reminders: a confirmed phrase is not suggested again; a changed one offers Update (D-092). */
  reminders: readonly ReminderDtoType[];
  openCard(request: CardRequest): void;
  /** A sticky updates a changed source in the main window ("Open in app to update"); tabs open the update card. */
  openInApp?: (reminderId: string) => void;
}

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
  /** A new request object opens the reference picker (palette "Link to note…"); then onReferenceRequestHandled. */
  referenceRequest?: object | null;
  onReferenceRequestHandled?: () => void;
  onConvert: (target: 'rich' | 'plain') => void;
  onOpenVersions: () => void;
  /** Receives the editor instance, so the title or the sticky can move the focus into it. */
  handle?: EditorHandle;
  /** Reminder chips of a rich note (D-080); a click calls onChipClick. */
  chips?: readonly ChipInfo[];
  onChipClick?: (reminderId: string) => void;
  /** A block to select, scroll to and highlight (a reminder opened the note); onRevealDone says whether it was found. */
  reveal?: { blockId: string; nonce: number } | null;
  onRevealDone?: (found: boolean) => void;
  /** Toolbar More "Add reminder…" (main window only). */
  onAddReminder?: () => void;
  /** Reminder suggestions and More "Create reminder from text"; absent where a note cannot get reminders. */
  suggestions?: SuggestionHost;
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

  // Attached files open through main's validated hand-off on behalf of this note (INF-REF-08).
  const [files] = useState<FileActions>(() => {
    const report = (res: Promise<{ ok: boolean; error?: { message: string } }>) =>
      void res.then((r) => {
        if (!r.ok && r.error) services.notify(r.error.message);
      });
    return {
      open: (attachmentId) => report(services.bridge.attachment.open({ noteId: host.noteId, attachmentId })),
      showInFolder: (attachmentId) => report(services.bridge.attachment.showInFolder({ noteId: host.noteId, attachmentId })),
    };
  });

  const openLink = (href: string) => {
    void services.bridge.shell.openExternal({ url: href }).then((r) => {
      if (!r.ok) services.notify(LINK_OPEN_FAILED);
    });
  };

  const editor = useEditor(
    {
      extensions:
        format === 'rich' ? richExtensions({ uploader, notify: services.notify, files, references: services.references ?? null }) : plainExtensions(),
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
  const { handle } = props;
  useEffect(() => {
    if (!editor) return undefined;
    uploader.bind(editor);
    const source: ContentSource = {
      getContent: () => (format === 'rich' ? toSavable(editor.getJSON()) : docToText(editor.getJSON())),
      getPlainText: () => editor.getText({ blockSeparator: '\n' }),
      blockText: (blockId) => findBlock(editor.state.doc, blockId)?.node.textContent ?? null,
      phraseText: (blockId) => {
        if (blockId === null) return format === 'plain' ? docToText(editor.getJSON()) : null;
        const block = findBlock(editor.state.doc, blockId);
        return block?.node.isTextblock ? textOfBlock(block.node, block.pos + 1).text : null;
      },
      hasPendingUploads: () => uploader.pending() > 0,
      waitForUploads: (ms) => uploader.waitIdle(ms),
    };
    host.attachSource(source);
    const unregister = registerEditor(editor);
    handle?.attach(editor);
    return () => {
      handle?.detach(editor);
      host.detachSource(source);
      unregister();
      uploader.dispose();
    };
  }, [editor, host, uploader, format, handle]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
    editor.view.dom.setAttribute('aria-readonly', String(!editable));
    handle?.editableChanged();
  }, [editor, editable, handle]);

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

  // Note references (D-098): the picker inserts a chip followed by a space, so typing goes on after it.
  const canReference = format === 'rich' && editable && services.references !== undefined;
  const [picker, setPicker] = useState(false);
  const insertReference = (ref: PickedReference) => {
    setPicker(false);
    if (!editor || editor.isDestroyed) return;
    editor
      .chain()
      .focus()
      .insertContent([{ type: 'noteRef', attrs: { ...ref } }, { type: 'text', text: ' ' }])
      .run();
  };
  // A palette request opens the picker once (state adjusted while rendering); the request is then consumed.
  const { referenceRequest, onReferenceRequestHandled } = props;
  const [shownReferenceRequest, setShownReferenceRequest] = useState<object | null>(null);
  if (referenceRequest && referenceRequest !== shownReferenceRequest) {
    setShownReferenceRequest(referenceRequest);
    if (canReference) setPicker(true);
  }
  useEffect(() => {
    if (referenceRequest) onReferenceRequestHandled?.();
  }, [referenceRequest, onReferenceRequestHandled]);

  // Reminder suggestions (D-091): one detector per editor instance; it follows the note's reminders.
  const { suggestions } = props;
  const suggestionSettings = useStore(services.suggestions.settings);
  const noteReminders = useRef<readonly ReminderDtoType[]>([]);
  // Runs before the detector is created, so phrases restored on mount are already filtered.
  useEffect(() => {
    noteReminders.current = suggestions?.reminders ?? [];
  }, [suggestions?.reminders]);
  const [detector, setDetector] = useState<SuggestionDetector | null>(null);
  const suggestNoteId = suggestions?.noteId ?? null;
  useEffect(() => {
    if (!editor || !suggestNoteId) return undefined;
    const d = new SuggestionDetector({ editor, noteId: suggestNoteId, format, context: services.suggestions, reminders: () => noteReminders.current });
    setDetector(d);
    return () => d.dispose();
  }, [editor, suggestNoteId, format, services.suggestions]);
  useEffect(() => detector?.refresh(), [detector, suggestions?.reminders]);

  const noteRef = () => ({ noteId: suggestions!.noteId, noteTitle: suggestions!.noteTitle, format });
  // The card returns the focus to where it was opened from. It opens on the next task, after the More menu has given
  // the focus back to its button, with the editor focused: closing the card returns to the editor, at the phrase.
  const openCard = (request: CardRequest) => {
    setTimeout(() => {
      if (!editor || editor.isDestroyed || !suggestions) return;
      editor.view.focus();
      suggestions.openCard(request);
    }, 0);
  };
  const openLive = (live: LiveCandidate, reminder: ReminderDtoType | null = null) => {
    if (!editor || !suggestions) return;
    const request = requestForLive(editor.state, noteRef(), live, reminder);
    if (request) openCard(request);
  };
  const updateLive = (live: LiveCandidate) => {
    if (!suggestions || !live.updateFor) return;
    if (suggestions.openInApp) suggestions.openInApp(live.updateFor);
    else openLive(live, suggestions.reminders.find((r) => r.id === live.updateFor) ?? null);
  };
  const dismissLive = (live: LiveCandidate) => {
    void detector?.dismiss(live).then((ok) => {
      if (!ok) services.notify(DISMISS_FAILED);
    });
  };

  // More → "Create reminder from text": the selection, else the phrase or paragraph at the cursor (D-089).
  const createFromText = async () => {
    if (!editor || !suggestions) return;
    const { selection } = editor.state;
    const live = selection.empty ? candidateAt(editor.state, selection.from) : null;
    if (live) {
      openLive(live);
      return;
    }
    const context = await services.suggestions.load(suggestions.noteId);
    if (!context || editor.isDestroyed) return;
    const result = requestFromText(editor.state, noteRef(), context);
    if (result.ok) openCard(result.request);
    else if (result.notice) services.notify(result.notice);
  };

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
          createFromText: suggestions ? () => void createFromText() : undefined,
          insertReference: canReference ? () => setPicker(true) : undefined,
        }}
      />
      {find ? <FindBar key={find.nonce} editor={editor} prefill={find.prefill} onClose={() => setFind(null)} /> : null}
      <div ref={scrollRef} className="note-editor-scroll" onScroll={(e) => props.onScroll(Math.round(e.currentTarget.scrollTop))}>
        <EditorContent editor={editor} />
      </div>
      {suggestions && suggestionSettings.suggestFromText ? (
        <SuggestionBar editor={editor} settings={suggestionSettings} updateInApp={suggestions.openInApp !== undefined} onCreate={(live) => openLive(live)} onUpdate={updateLive} onDismiss={dismissLive} />
      ) : null}
      {picker ? (
        <ReferencePicker
          bridge={services.bridge}
          onPick={insertReference}
          onClose={() => {
            setPicker(false);
            editor.commands.focus();
          }}
        />
      ) : null}
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
