import { actionFor, type AddAction } from '../../shared/attachments/file-choice';
import { ATTACHMENT_MESSAGES, linkedInsteadMessage } from '../../shared/attachments/limits';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';
import type { DocumentDtoType, LocationType } from '../../shared/contracts/hierarchy';
import type { BlankDocumentKind } from '../../shared/documents/kinds';
import type { AttachmentPrefs } from '../editor/uploader';
import type { NoticeStore } from './notice-store';
import type { Store } from './store';
import type { TabsStore } from './tabs-store';
import type { TreeStore } from './tree-store';
import type { UiStore } from './ui-store';

/** Files picked for import, waiting for the "Add files" answer (D-108 rules, D-118). */
export interface PickedDocuments {
  pickId: string;
  files: Array<{ name: string; sizeBytes: number }>;
}

export interface DocumentCommands {
  /** A new blank Word document, spreadsheet or presentation, opened in a tab. */
  createBlank(kind: BlankDocumentKind, location: LocationType): Promise<void>;
  /** "Import file…": the native picker, then copy or link by the "When adding files" setting or the dialog. */
  importFiles(location: LocationType): Promise<void>;
  /** Adds the picked files with the chosen action and opens the first one. */
  addPicked(picked: PickedDocuments, location: LocationType, action: AddAction): Promise<void>;
  /** "Open in Infinity Notes" for a note's attached or linked file. */
  openFromAttachment(noteId: string, attachmentId: string): Promise<void>;
  openFromLink(noteId: string, linkId: string): Promise<void>;
}

export interface DocumentCommandDeps {
  bridge: Pick<InfinityBridge, 'document'>;
  tree: Pick<TreeStore, 'createDocument' | 'reload' | 'reveal'>;
  tabs: Pick<TabsStore, 'openDocument'>;
  ui: Pick<UiStore, 'openDialog'>;
  notices: Pick<NoticeStore, 'push'>;
  attachmentPrefs: Store<AttachmentPrefs>;
}

export function createDocumentCommands(deps: DocumentCommandDeps): DocumentCommands {
  const { bridge, tree, tabs, ui, notices } = deps;

  const open = async (document: DocumentDtoType) => {
    await tree.reload();
    tree.reveal(`document:${document.id}`);
    await tabs.openDocument(document.id);
  };

  const addPicked: DocumentCommands['addPicked'] = async (picked, location, preferred) => {
    const { documentMaxMb } = deps.attachmentPrefs.getState();
    let first: DocumentDtoType | null = null;
    for (const [index, file] of picked.files.entries()) {
      // A picked file has a path, so it can always be linked; one over the copy limit is linked instead (D-108).
      const action = actionFor({ sizeBytes: file.sizeBytes, linkable: true }, preferred, documentMaxMb) ?? 'link';
      if (action !== preferred) notices.push(linkedInsteadMessage(file.name, documentMaxMb), 'info');
      const res = await bridge.document.addPicked({ pickId: picked.pickId, index, action, location });
      if (res.ok) first ??= res.data.document;
      else notices.push(`${file.name}: ${res.error.message}`, 'error');
    }
    if (first) await open(first);
  };

  const fromFile = async (call: Promise<Result<{ document: DocumentDtoType; created: boolean }>>) => {
    const res = await call;
    if (!res.ok) {
      notices.push(res.error.message, 'error');
      return;
    }
    await open(res.data.document);
  };

  return {
    async createBlank(kind, location) {
      const res = await tree.createDocument(location, kind);
      if (!res.ok) notices.push(res.message, 'error');
      else await tabs.openDocument(res.data.document.id);
    },
    async importFiles(location) {
      const res = await bridge.document.pickFiles();
      if (!res.ok) {
        notices.push(res.error.message, 'error');
        return;
      }
      const { canceled, pickId, files, truncated, rejected } = res.data;
      for (const message of new Set(rejected.map((r) => r.message))) notices.push(message, 'error');
      if (truncated) notices.push(ATTACHMENT_MESSAGES.tooManyFiles, 'info');
      if (canceled || pickId === null || files.length === 0) return;
      const mode = deps.attachmentPrefs.getState().addFiles;
      if (mode === 'ask') ui.openDialog({ kind: 'importDocuments', picked: { pickId, files }, location });
      else await addPicked({ pickId, files }, location, mode);
    },
    addPicked,
    openFromAttachment: (noteId, attachmentId) => fromFile(bridge.document.fromAttachment({ noteId, attachmentId })),
    openFromLink: (noteId, linkId) => fromFile(bridge.document.fromLink({ noteId, linkId })),
  };
}
