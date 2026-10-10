import { containedDataFile } from './stored-files';

/** The real path of a stored attachment file, or null when it breaks containment (see containedDataFile). */
export function containedAttachmentFile(dataDir: string, relativePath: string): Promise<string | null> {
  return containedDataFile(dataDir, 'attachments', relativePath);
}
