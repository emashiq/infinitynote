import type { AddAction } from '../../shared/attachments/file-choice';
import type { AttachmentKindName } from '../../shared/attachments/limits';
import type { AddedFileType, AttachmentDtoType, FileLinkDtoType } from '../../shared/contracts/attachments';
import { ok, type Result } from '../../shared/contracts/envelope';

/** One file to add to a note (D-108): dropped, pasted or picked. */
export interface FileSource {
  kind: AttachmentKindName;
  /** The file's name; empty for clipboard data without one. */
  name: string;
  sizeBytes: number;
  /** Whether main can link it: a document on disk. Images are always copied. */
  linkable: boolean;
  /** Copies or links the file; called when its import starts, so the bytes are read only then. */
  add(action: AddAction): Promise<Result<AddedFileType>>;
}

export interface FileSourceIo {
  importBytes: (req: { kind: AttachmentKindName; originalName?: string; bytes: Uint8Array }) => Promise<Result<{ attachment: AttachmentDtoType }>>;
  /** Whether a file is on disk (the preload checks; clipboard data is not), so it can be linked. */
  isOnDisk: (file: File) => boolean;
  /** Links a file on disk; the preload sends its path to main, the page never sees or names it (D-115). */
  linkFile: (file: File) => Promise<Result<{ link: FileLinkDtoType }>>;
}

export function kindOfFile(file: { type: string }): AttachmentKindName {
  return file.type.startsWith('image/') ? 'image' : 'document';
}

/** A dropped or pasted file: its bytes go to main for a copy; a document on disk can be linked instead. */
export function fileSource(file: File, io: FileSourceIo): FileSource {
  const kind = kindOfFile(file);
  const linkable = kind === 'document' && io.isOnDisk(file);
  return {
    kind,
    name: file.name,
    sizeBytes: file.size,
    linkable,
    async add(action) {
      if (action === 'link' && linkable) {
        const res = await io.linkFile(file);
        return res.ok ? ok({ type: 'link', link: res.data.link }) : res;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await io.importBytes({ kind, ...(file.name ? { originalName: file.name } : {}), bytes });
      return res.ok ? ok({ type: 'attachment', attachment: res.data.attachment }) : res;
    },
  };
}

/** Files chosen in main's picker: main keeps their paths and adds each one by its index (attachment:addPicked). */
export function pickedSources(
  pick: { pickId: string; files: ReadonlyArray<{ name: string; sizeBytes: number }> },
  kind: AttachmentKindName,
  addPicked: (req: { pickId: string; index: number; action: AddAction }) => Promise<Result<AddedFileType>>,
): FileSource[] {
  return pick.files.map((file, index) => ({
    kind,
    name: file.name,
    sizeBytes: file.sizeBytes,
    linkable: kind === 'document',
    add: (action) => addPicked({ pickId: pick.pickId, index, action }),
  }));
}
