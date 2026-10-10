import { z } from 'zod';
import { HEX_COLOR_RE, type HexColor as HexColorValue } from '../color';
import { DOCUMENT_KINDS } from '../documents/kinds';
import { NameInput, TitleInput } from '../names';
import { Uuid } from './ids';

/** A stored color: lowercase `#rrggbb` only. */
export const HexColor = z.custom<HexColorValue>((v) => typeof v === 'string' && HEX_COLOR_RE.test(v), 'Use a color written as #rrggbb');

export const StickyColorPreset = z.enum(['yellow', 'green', 'blue', 'pink', 'violet', 'gray']);
export type StickyColorPresetType = z.infer<typeof StickyColorPreset>;

/** A sticky's color: a named preset (light and dark variants) or a custom color shown as is. */
export const NoteColor = z.union([StickyColorPreset, HexColor]);
export type NoteColorType = z.infer<typeof NoteColor>;

const Ms = z.number().int();

export const ProjectDto = z.strictObject({ id: Uuid, name: z.string(), favorite: z.boolean(), createdAt: Ms, updatedAt: Ms });
export type ProjectDtoType = z.infer<typeof ProjectDto>;

export const FolderDto = z.strictObject({
  id: Uuid,
  projectId: Uuid.nullable(),
  parentId: Uuid.nullable(),
  name: z.string(),
  favorite: z.boolean(),
  createdAt: Ms,
  updatedAt: Ms,
});
export type FolderDtoType = z.infer<typeof FolderDto>;

export const NoteDto = z.strictObject({
  id: Uuid,
  projectId: Uuid.nullable(),
  folderId: Uuid.nullable(),
  title: z.string(),
  sticky: z.boolean(),
  color: NoteColor.nullable(),
  pinnedAt: Ms.nullable(),
  favorite: z.boolean(),
  revision: z.number().int().min(0),
  /** The note's content is encrypted at rest (D-111); its title stays visible. */
  locked: z.boolean(),
  createdAt: Ms,
  updatedAt: Ms,
});
export type NoteDtoType = z.infer<typeof NoteDto>;

export const NoteSummary = NoteDto.extend({ path: z.array(z.string()) });
export type NoteSummaryType = z.infer<typeof NoteSummary>;

export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
/** Managed: the bytes are stored in Infinity Notes. Linked: they stay in the original file (D-108, D-118). */
export const DocumentStorage = z.enum(['managed', 'linked']);
export type DocumentStorageType = z.infer<typeof DocumentStorage>;

/** A PDF, Word, PowerPoint, Excel, CSV or HTML file kept in the tree next to notes (D-118). */
export const DocumentDto = z.strictObject({
  id: Uuid,
  projectId: Uuid.nullable(),
  folderId: Uuid.nullable(),
  title: z.string(),
  kind: DocumentKindSchema,
  storage: DocumentStorage,
  sizeBytes: z.number().int().min(0),
  revision: z.number().int().min(0),
  favorite: z.boolean(),
  createdAt: Ms,
  updatedAt: Ms,
});
export type DocumentDtoType = z.infer<typeof DocumentDto>;

export const DocumentSummary = DocumentDto.extend({ path: z.array(z.string()) });
export type DocumentSummaryType = z.infer<typeof DocumentSummary>;

export const TreeSnapshot = z.strictObject({
  projects: z.array(ProjectDto),
  folders: z.array(FolderDto),
  notes: z.array(NoteDto),
  documents: z.array(DocumentDto),
});
export type TreeSnapshotType = z.infer<typeof TreeSnapshot>;

export const Location = z.strictObject({ projectId: Uuid.nullable(), folderId: Uuid.nullable() });
export type LocationType = z.infer<typeof Location>;

export const FolderTarget = z.strictObject({ projectId: Uuid.nullable(), parentId: Uuid.nullable() });
export type FolderTargetType = z.infer<typeof FolderTarget>;

const Counts = z.strictObject({ projects: z.number().int(), folders: z.number().int(), notes: z.number().int(), documents: z.number().int() });
export const TrashResult = z.strictObject({ trashBatchId: Uuid, counts: Counts, trashedNoteIds: z.array(Uuid), trashedDocumentIds: z.array(Uuid) });
export type TrashResultType = z.infer<typeof TrashResult>;

export const TrashItem = z.strictObject({
  batchId: Uuid,
  kind: z.enum(['project', 'folder', 'note', 'document']),
  id: Uuid,
  label: z.string(),
  /** The kind of a document batch root. */
  documentKind: DocumentKindSchema.nullable(),
  sticky: z.boolean(),
  deletedAt: Ms,
  fromPath: z.array(z.string()),
  contains: z.strictObject({ folders: z.number().int(), notes: z.number().int(), documents: z.number().int() }),
});
export type TrashItemType = z.infer<typeof TrashItem>;

export const TreeChangedReasons = ['create', 'rename', 'move', 'trash', 'restore', 'purge', 'pin', 'favorite', 'sticky', 'lock'] as const;
export const TreeChangedEvent = z.strictObject({
  reason: z.enum(TreeChangedReasons),
  trashedNoteIds: z.array(Uuid),
  trashedDocumentIds: z.array(Uuid),
});
export type TreeChangedEventType = z.infer<typeof TreeChangedEvent>;

// Requests -----------------------------------------------------------------
export const ProjectCreateRequest = z.strictObject({ name: NameInput });
export const ProjectRenameRequest = z.strictObject({ projectId: Uuid, name: NameInput });
export const ProjectIdRequest = z.strictObject({ projectId: Uuid });
export const FolderCreateRequest = z.strictObject({ location: FolderTarget, name: NameInput });
export const FolderRenameRequest = z.strictObject({ folderId: Uuid, name: NameInput });
export const FolderMoveRequest = z.strictObject({ folderId: Uuid, target: FolderTarget });
export const FolderIdRequest = z.strictObject({ folderId: Uuid });
export const NoteCreateRequest = z.strictObject({
  location: Location,
  sticky: z.boolean(),
  title: TitleInput.optional(),
  /** Rich text by default; plain-text notes are created with an empty string (INF-EDIT-04). */
  format: z.enum(['rich', 'plain']).optional(),
});
export const NoteRenameRequest = z.strictObject({ noteId: Uuid, title: TitleInput });
export const NoteMoveRequest = z.strictObject({ noteId: Uuid, target: Location });
export const NoteIdRequest = z.strictObject({ noteId: Uuid });
export const NoteSetPinnedRequest = z.strictObject({ noteId: Uuid, pinned: z.boolean() });
export const ItemKind = z.enum(['project', 'folder', 'note', 'document']);
export type ItemKindType = z.infer<typeof ItemKind>;
export const ItemSetFavoriteRequest = z.strictObject({ kind: ItemKind, id: Uuid, favorite: z.boolean() });
export const TrashRestoreRequest = z.strictObject({ batchId: Uuid });
export const TrashPurgeRequest = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('batch'), batchId: Uuid }),
    z.strictObject({ kind: z.literal('all') }),
  ]),
  confirmed: z.literal(true),
});

// Responses ----------------------------------------------------------------
export const ProjectResponse = z.strictObject({ project: ProjectDto });
export const FolderResponse = z.strictObject({ folder: FolderDto });
export const NoteResponse = z.strictObject({ note: NoteDto });
export const FolderMoveResponse = z.strictObject({
  folder: FolderDto,
  movedFolders: z.number().int(),
  movedNotes: z.number().int(),
});
export const ItemSetFavoriteResponse = z.strictObject({ kind: ItemKind, id: Uuid, favorite: z.boolean() });
export const TrashListResponse = z.strictObject({ items: z.array(TrashItem) });
export const TrashRestoreResponse = z.strictObject({
  kind: ItemKind,
  id: Uuid,
  relocated: z.boolean(),
  location: z.strictObject({ projectId: Uuid.nullable(), folderId: Uuid.nullable() }),
  path: z.array(z.string()),
  restoredNoteIds: z.array(Uuid),
  restoredDocumentIds: z.array(Uuid),
});
export const TrashPurgeResponse = z.strictObject({ purged: Counts });

export type TrashRestoreResponseType = z.infer<typeof TrashRestoreResponse>;
export type FolderMoveResponseType = z.infer<typeof FolderMoveResponse>;
export type TrashPurgeRequestType = z.infer<typeof TrashPurgeRequest>;
