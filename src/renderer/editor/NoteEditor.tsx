import { posToDOMRect, type JSONContent } from '@tiptap/core';
import { isInTable } from '@tiptap/pm/tables';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { ATTACHMENT_MESSAGES, maxBytes } from '../../shared/attachments/limits';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import type { Result } from '../../shared/contracts/envelope';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import { docToText } from '../../shared/text/textarea-doc';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import { toSavable } from '../../shared/editor/savable';
import { collabSync, receiveSteps, sendableOf, syncVersion } from './collab-sync';
import { isRemote, type ContentSource, type EditorHost } from './content';
import type { EditorHandle } from './editor-handle';
import { registerEditor } from './editor-registry';
import { AddFilesDialog } from './AddFilesDialog';
import { plainExtensions, richExtensions } from './extensions';
import type { FileActions } from './file-attachment';
import type { LinkActions } from './file-link';
import { pickedSources } from './file-sources';
import { FindBar } from './FindBar';
import { findPrefill } from './find-core';
import { FormatBubble } from './FormatBubble';
import { InsertTableDialog } from './InsertTableDialog';
import { applyLink, LINK_OPEN_FAILED, linkHrefAt, removeLink, selectedLinkHref } from './link';
import { LinkDialog } from './LinkDialog';
import { insertItems, noteMenuItems, type NoteActions } from './note-actions';
import { LinkPicker, type PickedLink } from './LinkPicker';
import { LINK_TRIGGER, linkableSelection, type LinkRequest } from './link-trigger';
import { createPasteProps } from './paste';
import type { CardRequest } from '../reminders/card-request';
import { blockIdAtSelection, chipsMeta, findBlock, REMINDER_CHIP_EVENT, selectionAtBlockStart, type ChipInfo } from './reminder-chips';
import { useStore } from '../state/use-store';
import { Menu } from '../ui/Menu';
import { DISMISS_FAILED } from '../reminders/suggestion-context';
import { SuggestionBar } from './SuggestionBar';
import { SuggestionDetector } from './suggestion-detector';
import { requestForLive, requestFromText } from './suggestion-requests';
import { textOfBlock } from './block-text';
import { candidateAt, type LiveCandidate } from './suggestions';
import { useSlashMenu } from './SlashMenu';
import { insertTable, tableHasHeaderRow, tableMenuItems } from './table-actions';
import type { EditorServices } from './editor-services';
import { AttachmentUploader, type FileChoice, type FileChoiceRequest } from './uploader';

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
  /** The editor document for both formats, at live-sync `sync.version` (D-103). */
  content: RichDocLike;
  sync: { version: number; clientID: string };
  editable: boolean;
  variant: 'tab' | 'sticky';
  scrollTop: number;
  onScroll: (px: number) => void;
  services: EditorServices;
  /** A new request object opens the find bar (Ctrl+F); the editor then calls onFindRequestHandled. */
  findRequest: object | null;
  onFindRequestHandled: () => void;
  /** A new request object opens the reference picker (palette "Link to note or document…"); then onReferenceRequestHandled. */
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
  /** "Add reminder…" in the note menus (main window only). */
  onAddReminder?: () => void;
  /** "Float as sticky" in the context menu (tabs only). */
  onFloat?: () => void;
  /** The lock entries of the note menu (tabs only; D-111). */
  lock?: NoteActions['lock'];
  /** Reminder suggestions and "Create reminder from text"; absent where a note cannot get reminders. */
  suggestions?: SuggestionHost;
}

/**
 * The one editor for every note (INF-EDIT-01, D-053). It mounts only for the active note tab, saves lazily
 * through the controller (edits mark the note dirty; the controller reads the content when it saves) and owns the
 * paste, upload, link and find behavior. It has no toolbar row (D-102): formatting floats over the selection (Alt+F10),
 * "/" opens the insert menu and right-click or Shift+F10 the note menu. Mount it with a key of the format and content
 * key: content replaced from outside (reload, conversion, restore) creates a fresh editor with a clean undo history.
 */
export function NoteEditor(props: NoteEditorProps) {
  const { host, format, content, editable, services } = props;
  // The "Add files" question (D-108): the uploader waits for the dialog's answer.
  const [fileChoice, setFileChoice] = useState<{ request: FileChoiceRequest; answer: (choice: FileChoice | null) => void } | null>(null);
  const [uploader] = useState(() => {
    const { bridge } = services;
    return new AttachmentUploader({
      importBytes: (req) => bridge.attachment.importBytes(req),
      isOnDisk: (file) => bridge.fileLink.isOnDisk(file),
      linkFile: (file) => bridge.fileLink.createFromFile(file),
      prefs: services.attachmentPrefs,
      notify: services.notify,
      chooseFiles: (request) => new Promise((answer) => setFileChoice({ request, answer })),
      rememberChoice: (action) => services.rememberAddFiles?.(action),
    });
  });
  // An editor that goes away while the dialog is open cancels it.
  const openChoice = useRef(fileChoice);
  useEffect(() => {
    openChoice.current = fileChoice;
  });
  useEffect(() => () => openChoice.current?.answer(null), []);

  // Attached and linked files go through main's validated hand-off on behalf of this note (INF-REF-08, D-108). The note
  // is saved first, so a file added a moment ago is already recorded as the note's.
  const [handoff] = useState<{ files: FileActions; links: LinkActions }>(() => {
    const { bridge, notify } = services;
    const settle = async <T,>(call: () => Promise<Result<T>>): Promise<T | null> => {
      await host.flush();
      const res = await call();
      if (res.ok) return res.data;
      notify(res.error.message);
      return null;
    };
    const link = (linkId: string) => ({ noteId: host.noteId, linkId });
    const documents = services.documents;
    return {
      files: {
        open: (attachmentId) => void settle(() => bridge.attachment.open({ noteId: host.noteId, attachmentId })),
        showInFolder: (attachmentId) => void settle(() => bridge.attachment.showInFolder({ noteId: host.noteId, attachmentId })),
        ...(documents ? { openInApp: (attachmentId: string) => void host.flush().then(() => documents.openAttachment(host.noteId, attachmentId)) } : {}),
      },
      links: {
        status: async (linkId) => {
          const res = await bridge.fileLink.status({ linkId });
          return res.ok ? res.data : null;
        },
        open: async (linkId) => (await settle(() => bridge.fileLink.open(link(linkId)))) !== null,
        showInFolder: async (linkId) => (await settle(() => bridge.fileLink.showInFolder(link(linkId)))) !== null,
        copyIn: async (linkId) => (await settle(() => bridge.fileLink.copyIn(link(linkId))))?.attachment ?? null,
        copyLimitBytes: () => maxBytes(services.attachmentPrefs().documentMaxMb),
        ...(documents ? { openInApp: (linkId: string) => void host.flush().then(() => documents.openLink(host.noteId, linkId)) } : {}),
      },
    };
  });

  // The insert menu sees the editor's keys first while it is open (set after every render).
  const slashKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  // "[[", Ctrl+Shift+L and Ctrl+Shift+K open the link picker in rich notes of windows that can link (the main window);
  // the trigger itself does nothing while the note is read-only.
  const [picker, setPicker] = useState<LinkRequest | null>(null);
  const canLink = format === 'rich' && services.references !== undefined;
  // Comments (D-165): the bubble's Comment and Ctrl+Alt+M in editable rich notes of the main window.
  const { comments } = services;
  const startComment = comments
    ? () => {
        comments.start();
        return true;
      }
    : null;

  const openLink = (href: string) => {
    void services.bridge.shell.openExternal({ url: href }).then((r) => {
      if (!r.ok) services.notify(LINK_OPEN_FAILED);
    });
  };

  const editor = useEditor(
    {
      extensions: [
        ...(format === 'rich'
          ? richExtensions({
              uploader,
              notify: services.notify,
              files: handoff.files,
              links: handoff.links,
              references: services.references ?? null,
              requestLink: (request) => {
                if (!canLink) return false;
                setPicker(request);
                return true;
              },
              startComment,
            })
          : plainExtensions()),
        collabSync(props.sync.version, props.sync.clientID),
      ],
      content: content as JSONContent,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      enableContentCheck: true,
      onContentError: () => host.contentError(),
      editorProps: {
        attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note text', spellcheck: 'false', class: 'note-editor-content' },
        ...createPasteProps({ format, uploader, notify: services.notify, flushPending: () => host.flush() }),
        handleKeyDown: (_view, event) => slashKeys.current(event),
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
        // setEditable reports an update too; only a change of this view's document is sent (D-103).
        if (transaction.docChanged && !isRemote(transaction)) host.markDirty();
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
      version: () => syncVersion(editor),
      sendable: () => sendableOf(editor),
      receive: (version, steps, clientIDs) => receiveSteps(editor, version, steps, clientIDs),
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
    // Read-only text stays reachable from the keyboard: to read, select, find and open the note menu (Shift+F10).
    if (editable) editor.view.dom.removeAttribute('tabindex');
    else editor.view.dom.setAttribute('tabindex', '0');
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
  const [tableDialog, setTableDialog] = useState(false);

  // Links (D-098, D-156): the picker inserts a chip followed by a space, so typing goes on after it; a linked selection
  // is replaced by a chip that shows the selected text.
  const references = services.references;
  const canReference = canLink && editable;
  // The focus moves at once (Tiptap's focus command waits for a frame), so keys typed right after the pick reach the text.
  const insertLink = (link: PickedLink) => {
    const request = picker;
    setPicker(null);
    if (!editor || editor.isDestroyed) return;
    const alias = request?.selection?.text ?? null;
    const chip =
      link.kind === 'note'
        ? { type: 'noteRef', attrs: { noteId: link.noteId, blockId: link.blockId, label: link.label, excerpt: link.excerpt, alias } }
        : { type: 'docRef', attrs: { documentId: link.documentId, target: link.target, label: link.label, alias } };
    const range = request?.selection ?? editor.state.selection;
    editor
      .chain()
      .insertContentAt({ from: range.from, to: range.to }, [chip, { type: 'text', text: ' ' }])
      .scrollIntoView()
      .run();
    editor.view.focus();
  };
  const selectionRequest = (): LinkRequest => {
    const selection = linkableSelection(editor.state);
    return selection ? { selection } : {};
  };
  const closePicker = () => {
    const typed = picker?.typed === true;
    setPicker(null);
    // "[[" that opened the picker comes back when nothing was linked.
    if (typed && !editor.isDestroyed) editor.chain().focus().insertContent(LINK_TRIGGER).run();
    else editor.commands.focus();
  };
  // A palette request opens the picker once (state adjusted while rendering); the request is then consumed.
  const { referenceRequest, onReferenceRequestHandled } = props;
  const [shownReferenceRequest, setShownReferenceRequest] = useState<object | null>(null);
  if (referenceRequest && referenceRequest !== shownReferenceRequest) {
    setShownReferenceRequest(referenceRequest);
    if (canReference) setPicker({});
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
  // The card returns the focus to where it was opened from. It opens on the next task, after a menu has given
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

  // "Create reminder from text": the selection, else the phrase or paragraph at the cursor (D-089).
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

  // The native picker: main keeps the paths; the uploader copies or links each picked file by its index (D-108).
  const insertAttachment = async (kind: AttachmentKindType) => {
    if (!editor) return;
    const res = await services.bridge.attachment.pickFiles({ kind });
    if (!res.ok) {
      services.notify(kind === 'image' ? ATTACHMENT_MESSAGES.imageFailed : ATTACHMENT_MESSAGES.fileFailed);
      return;
    }
    const { pickId, files, truncated, rejected } = res.data;
    for (const message of new Set(rejected.map((r) => r.message))) services.notify(message);
    if (truncated) services.notify(ATTACHMENT_MESSAGES.tooManyFiles);
    if (pickId === null || files.length === 0 || editor.isDestroyed) return;
    const { from, to } = editor.state.selection;
    uploader.addFiles(
      pickedSources({ pickId, files }, kind, (req) => services.bridge.attachment.addPicked(req)),
      { from, to },
    );
    editor.commands.focus();
  };

  const answerFileChoice = (choice: FileChoice | null) => {
    fileChoice?.answer(choice);
    setFileChoice(null);
    editor.commands.focus();
  };

  const actions: NoteActions = {
    insertAttachment: (kind) => void insertAttachment(kind),
    insertTable: format === 'rich' && editable ? () => setTableDialog(true) : undefined,
    insertReference: canReference ? () => setPicker(selectionRequest()) : undefined,
    addReminder: props.onAddReminder,
    createFromText: suggestions ? () => void createFromText() : undefined,
    openFind,
    convert: props.onConvert,
    openVersions: props.onOpenVersions,
    float: props.onFloat,
    lock: props.lock,
  };
  const slash = useSlashMenu(editor, insertItems(editor, actions), format === 'rich' && editable);

  useEffect(() => {
    slashKeys.current = slash.onKeyDown;
  });

  // Alt+F10 in the text shows the formatting toolbar and moves the focus into it; Shift+F10 opens the note menu at the
  // cursor (a right-click opens it at the pointer). Read-only notes get the note menu too.
  const [bubbleRequest, setBubbleRequest] = useState<object | null>(null);
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number } | null>(null);
  const onTextKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== editor.view.dom || e.key !== 'F10' || e.ctrlKey || e.metaKey || e.altKey === e.shiftKey) return;
    e.preventDefault();
    if (e.altKey) {
      setBubbleRequest({});
      return;
    }
    const caret = posToDOMRect(editor.view, editor.state.selection.head, editor.state.selection.head);
    setNoteMenu({ x: caret.left, y: caret.bottom + 4 });
  };

  return (
    <div className={`note-editor note-editor-${props.variant}`}>
      {find ? <FindBar key={find.nonce} editor={editor} prefill={find.prefill} onClose={() => setFind(null)} /> : null}
      <div ref={scrollRef} className="note-editor-scroll" onScroll={(e) => props.onScroll(Math.round(e.currentTarget.scrollTop))}>
        <div
          className="note-editor-surface"
          onKeyDown={onTextKeyDown}
          onContextMenu={(e) => {
            e.preventDefault();
            setNoteMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <EditorContent editor={editor} />
          {format === 'rich' ? (
            <FormatBubble
              editor={editor}
              editable={editable}
              request={bubbleRequest}
              onComment={startComment ? () => void startComment() : undefined}
              link={{
                edit: () => {
                  const href = selectedLinkHref(editor.state);
                  setLinkDialog({ href: href ?? '', editing: href !== null });
                },
                remove: () => removeLink(editor),
                open: openLink,
              }}
            />
          ) : null}
          {slash.element}
        </div>
      </div>
      {noteMenu ? (
        <Menu
          label="Note actions"
          anchor={noteMenu}
          items={noteMenuItems(actions, { format, editable, table: editable && isInTable(editor.state) ? tableMenuItems(editor, tableHasHeaderRow(editor.state)) : [] })}
          onClose={() => setNoteMenu(null)}
        />
      ) : null}
      {suggestions && suggestionSettings.suggestFromText ? (
        <SuggestionBar editor={editor} settings={suggestionSettings} updateInApp={suggestions.openInApp !== undefined} onCreate={(live) => openLive(live)} onUpdate={updateLive} onDismiss={dismissLive} />
      ) : null}
      {picker && references ? (
        <LinkPicker
          bridge={services.bridge}
          initialQuery={picker.selection?.text}
          onPick={insertLink}
          onCreateNote={(title) => references.createNote(host.noteId, title)}
          onClose={closePicker}
        />
      ) : null}
      {tableDialog ? (
        <InsertTableDialog
          onClose={() => {
            setTableDialog(false);
            editor.commands.focus();
          }}
          onInsert={(size) => {
            // The modal dialog keeps the focus out of the text until it is gone.
            flushSync(() => setTableDialog(false));
            insertTable(editor, size);
          }}
        />
      ) : null}
      {fileChoice ? (
        <AddFilesDialog
          request={fileChoice.request}
          canRemember={services.rememberAddFiles !== undefined}
          onChoose={answerFileChoice}
          onCancel={() => answerFileChoice(null)}
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
